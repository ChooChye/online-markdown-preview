"use client";

/* eslint-disable @next/next/no-img-element --
 * next/image is deliberately not used in this file. It would route every remote
 * URL through this origin's image optimizer, which means the server would fetch
 * the reader's document's images — the exact thing this component exists to
 * prevent — and it would also need every possible host allow-listed up front.
 * A plain <img> keeps the request in the reader's browser, aimed only at the
 * host the document named, and only after the reader has asked for it. */

/**
 * ============================================================================
 * Why this file exists
 * ============================================================================
 *
 * Rendering a remote image inside someone else's document is a disclosure. The
 * moment the browser fetches `https://tracker.example/pixel.png`, that host
 * learns the reader's IP address, their user-agent, and the fact that they are
 * reading this particular document. No script is involved; an `<img src>` is
 * enough.
 *
 * A Content-Security-Policy header cannot express what we actually want, which
 * is "block these, unless the reader later decides otherwise". The header is
 * sent once with the page and can only ever be tightened afterwards, never
 * relaxed — so `img-src` has to stay permissive enough for the opted-in case
 * (see the note on that directive in `lib/csp.ts`).
 *
 * So the block is enforced here, in the renderer, by the only mechanism that
 * can change its mind at runtime: a remote image is simply never given a `src`
 * attribute until the reader opts in. No `<img>` element exists for it, no
 * preload, no background-image, no `fetch`. Until then the URL is only ever
 * parsed locally to name its host. This is the email-client model — images off
 * by default, one visible control to turn them on.
 *
 * The opt-in is per-document and lives in memory only. The viewer remounts
 * `RemoteImageProvider` with a fresh `key` for each file, so opening a new
 * document starts blocked again. Nothing is written to localStorage: a choice
 * about one document is not a choice about the next one.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes, ReactElement, ReactNode } from "react";

/* ---------------------------------------------------------------------------
 * Context
 * ------------------------------------------------------------------------ */

export interface RemoteImageContextValue {
  /** False until the reader explicitly asks for this document's images. */
  allowed: boolean;
  /** One-way latch. There is no `disallow` — reload or open another file. */
  allow: () => void;
  /** Called from an effect by each remote `GatedImage`. Ref-counted. */
  register: (url: string) => void;
  unregister: (url: string) => void;
  /** Every distinct remote URL in the document, sorted. */
  remoteUrls: string[];
  /** Every distinct hostname those URLs point at, sorted. */
  hosts: string[];
}

const noop = (): void => {};

/**
 * Fail closed. Without a provider the gate still refuses to load anything; it
 * just has no way to be opened. Better a document that shows placeholders than
 * one that quietly phones home because a wrapper was forgotten.
 */
const BLOCKED_FALLBACK: RemoteImageContextValue = {
  allowed: false,
  allow: noop,
  register: noop,
  unregister: noop,
  remoteUrls: [],
  hosts: [],
};

const RemoteImageContext = createContext<RemoteImageContextValue | null>(null);

let missingProviderWarned = false;

function useRemoteImageGate(): RemoteImageContextValue {
  const value = useContext(RemoteImageContext);

  useEffect(() => {
    if (value !== null || process.env.NODE_ENV === "production" || missingProviderWarned) return;
    missingProviderWarned = true;
    console.warn(
      "[remote-image-gate] No <RemoteImageProvider> above this subtree. Remote images will stay blocked and cannot be unblocked.",
    );
  }, [value]);

  return value ?? BLOCKED_FALLBACK;
}

export function RemoteImageProvider({ children }: { children: ReactNode }): ReactElement {
  const [allowed, setAllowed] = useState(false);
  const [remoteUrls, setRemoteUrls] = useState<string[]>([]);
  /**
   * Ref-counts per URL. The same URL can appear many times in one document, and
   * React 19 StrictMode mounts each effect twice (setup, cleanup, setup) — the
   * counter absorbs both without double-listing or dropping an entry early.
   */
  const countsRef = useRef<Map<string, number>>(new Map());

  const allow = useCallback((): void => {
    setAllowed(true);
  }, []);

  const register = useCallback((url: string): void => {
    const counts = countsRef.current;
    const next = (counts.get(url) ?? 0) + 1;
    counts.set(url, next);
    if (next > 1) return;
    setRemoteUrls((previous) => (previous.includes(url) ? previous : [...previous, url].sort()));
  }, []);

  const unregister = useCallback((url: string): void => {
    const counts = countsRef.current;
    const next = (counts.get(url) ?? 0) - 1;
    if (next > 0) {
      counts.set(url, next);
      return;
    }
    counts.delete(url);
    setRemoteUrls((previous) => (previous.includes(url) ? previous.filter((item) => item !== url) : previous));
  }, []);

  const hosts = useMemo(() => {
    const unique = new Set<string>();
    for (const url of remoteUrls) {
      const host = hostOf(url);
      if (host !== null) unique.add(host);
    }
    return [...unique].sort();
  }, [remoteUrls]);

  const value = useMemo<RemoteImageContextValue>(
    () => ({ allowed, allow, register, unregister, remoteUrls, hosts }),
    [allowed, allow, register, unregister, remoteUrls, hosts],
  );

  return <RemoteImageContext.Provider value={value}>{children}</RemoteImageContext.Provider>;
}

/* ---------------------------------------------------------------------------
 * The bar
 * ------------------------------------------------------------------------ */

/** Beyond this many hosts the list stops being something a reader can weigh. */
const MAX_NAMED_HOSTS = 3;

function buildSummary(imageCount: number, hosts: string[]): string {
  const images = `${imageCount} ${imageCount === 1 ? "image" : "images"}`;
  const sites = `${hosts.length} external ${hosts.length === 1 ? "site" : "sites"}`;
  const named = hosts.length > 0 && hosts.length <= MAX_NAMED_HOSTS ? ` (${hosts.join(", ")})` : "";
  return `This document loads ${images} from ${sites}${named}.`;
}

/**
 * Sits directly under the header. Renders nothing once the reader has opted in,
 * and nothing at all for a document with no remote images.
 *
 * Dismissal is local state on purpose: this component lives inside the
 * per-document `RemoteImageProvider`, so the viewer's `key` change remounts it
 * and a new file gets a fresh bar.
 */
export function RemoteImageBar(): ReactElement | null {
  const { allowed, allow, remoteUrls, hosts } = useRemoteImageGate();
  const [dismissed, setDismissed] = useState(false);

  if (allowed || dismissed || remoteUrls.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="External images in this document"
      className="border-border bg-canvas-subtle flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2"
    >
      <div className="min-w-0 flex-1">
        {/* Polite: this is a fact about the document, not an interruption. */}
        <p aria-live="polite" className="text-fg text-sm">
          {buildSummary(remoteUrls.length, hosts)}
        </p>
        <p className="text-fg-muted text-xs">Loading them lets those sites see your IP address.</p>
      </div>

      {/* accent-emphasis, not accent: white on the dark-mode accent (#4493f8)
          is 3.1:1 and fails AA. accent-emphasis (#1f6feb) is 4.7:1. */}
      <button
        type="button"
        onClick={allow}
        className="bg-accent-emphasis focus-visible:outline-accent shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Load images
      </button>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss without loading images"
        className="text-fg-muted hover:text-fg hover:bg-canvas-inset focus-visible:outline-accent shrink-0 rounded-md p-1.5 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <CloseGlyph />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Source classification
 * ------------------------------------------------------------------------ */

type Classification =
  /** `data:` / `blob:` — carried inside the document, reaches no network. */
  | { kind: "inline"; url: string }
  /** Absolute http(s) or protocol-relative. One fetch away from a disclosure. */
  | { kind: "remote"; url: string; host: string }
  /** A path with nowhere to resolve against. Cannot load, and never will. */
  | { kind: "unresolvable"; path: string };

function hostOf(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

/**
 * Everything that is not plainly inline or plainly remote is treated as
 * unresolvable — including exotic schemes like `file:` — because the one thing
 * we must never do is hand an unclassified string to the browser as a `src`.
 */
function classifySrc(src: string | undefined): Classification {
  const value = (src ?? "").trim();
  if (value.length === 0) return { kind: "unresolvable", path: "" };

  const scheme = value.slice(0, 5).toLowerCase();
  if (scheme.startsWith("data:") || scheme.startsWith("blob:")) {
    return { kind: "inline", url: value };
  }

  // `//host/x.png` resolves against the page's scheme; this page is https (and
  // the CSP upgrades insecure requests anyway), so normalise it for display.
  const absolute = value.startsWith("//") ? `https:${value}` : value;
  if (/^https?:\/\//i.test(absolute)) {
    const host = hostOf(absolute);
    if (host !== null) return { kind: "remote", url: absolute, host };
  }

  return { kind: "unresolvable", path: value };
}

/* ---------------------------------------------------------------------------
 * Layout reservation
 * ------------------------------------------------------------------------ */

/**
 * Keeps a placeholder from collapsing to a hairline. Kept in lockstep with the
 * `min-h-7` utility used when no dimensions are declared at all — both are
 * 1.75rem.
 */
const MIN_PLACEHOLDER_HEIGHT = "1.75rem";

function toNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function toCssLength(value: number | string | undefined): string | undefined {
  const numeric = toNumber(value);
  if (numeric !== null) return `${numeric}px`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

/**
 * Reserve the box the real image will occupy, so opting in does not shove the
 * surrounding text around.
 *
 * When both dimensions are numeric this uses `aspect-ratio` rather than a fixed
 * height, because the loaded image renders with `max-w-full h-auto` — it keeps
 * its ratio while shrinking to a narrow column, and the placeholder has to do
 * exactly the same thing to match it at every width.
 */
function reservedBoxStyle(
  width: number | string | undefined,
  height: number | string | undefined,
): CSSProperties | undefined {
  const numericWidth = toNumber(width);
  const numericHeight = toNumber(height);
  if (numericWidth !== null && numericHeight !== null && numericWidth > 0 && numericHeight > 0) {
    return {
      width: `${numericWidth}px`,
      maxWidth: "100%",
      aspectRatio: `${numericWidth} / ${numericHeight}`,
    };
  }

  const cssWidth = toCssLength(width);
  const cssHeight = toCssLength(height);
  if (cssWidth === undefined && cssHeight === undefined) return undefined;
  return {
    width: cssWidth,
    height: cssHeight,
    maxWidth: "100%",
    minHeight: MIN_PLACEHOLDER_HEIGHT,
  };
}

/* ---------------------------------------------------------------------------
 * Placeholders
 * ------------------------------------------------------------------------ */

type PlaceholderTone = "gated" | "missing" | "failed";

const TONE_CLASSES: Record<PlaceholderTone, string> = {
  /** A decision is pending: a dashed edge reads as "not yet", not "broken". */
  gated: "border border-dashed border-border bg-canvas-subtle",
  /** Nothing to decide: a flat inset panel with no edge reads as a footnote. */
  missing: "bg-canvas-inset",
  /** Tried and did not arrive: same muted panel, but with a settled border. */
  failed: "border border-border bg-canvas-inset",
};

interface ImagePlaceholderProps {
  tone: PlaceholderTone;
  glyph: ReactNode;
  /** Terse visible text. Truncates rather than wrapping into a wall. */
  label: ReactNode;
  /** The full sentence, for assistive tech and the hover title. */
  description: string;
  action?: ReactNode;
  boxStyle?: CSSProperties;
}

/**
 * Built entirely from phrasing content (`span`, `code`, `button`, `svg`).
 * Markdown images live inside a `<p>`, and a `<div>` in there would be invalid
 * HTML that the browser silently splits the paragraph around.
 */
function ImagePlaceholder({
  tone,
  glyph,
  label,
  description,
  action,
  boxStyle,
}: ImagePlaceholderProps): ReactElement {
  const boxed = boxStyle !== undefined;
  return (
    <span
      // `role="img"` makes the children presentational, which is right for a
      // static note but would bury an interactive control, so anything with an
      // action becomes a group instead.
      role={action === undefined ? "img" : "group"}
      aria-label={description}
      title={description}
      style={boxStyle}
      className={joinClasses(
        "text-fg-muted inline-flex max-w-full items-center overflow-hidden rounded-md align-middle text-xs leading-tight",
        boxed ? "justify-center gap-1.5 p-2" : "min-h-7 gap-1.5 px-2 py-1",
        TONE_CLASSES[tone],
      )}
    >
      <span className="shrink-0" aria-hidden="true">
        {glyph}
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {action}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * GatedImage
 * ------------------------------------------------------------------------ */

export interface GatedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /**
   * react-markdown hands the hast node to every mapped component. It is read
   * here only so it is never spread onto a DOM element.
   */
  node?: unknown;
}

/**
 * The component react-markdown maps `img` to.
 *
 * The privacy guarantee lives in the branches below: a remote URL reaches an
 * `<img src>` on exactly one path, and that path requires `allowed` to be true,
 * which only a click on `allow()` can make it.
 */
export function GatedImage(props: GatedImageProps): ReactElement {
  const { src, alt, title, width, height, className } = props;
  const { allowed, allow, register, unregister } = useRemoteImageGate();

  // React 19's `src` is a union with an experimental non-string member, so it is
  // narrowed here rather than widening the classifier. Anything that is not a
  // string cannot be a URL, and falls through to the unresolvable branch —
  // which is the safe direction: it never becomes a request.
  const srcString = typeof src === "string" ? src : undefined;

  // Memoised so the registration effect below keys off the URL, not off a fresh
  // object identity on every render.
  const classification = useMemo(() => classifySrc(srcString), [srcString]);
  const remoteUrl = classification.kind === "remote" ? classification.url : null;

  // Which URL failed, rather than a bare "did it fail" flag: if React reuses
  // this instance for a different src, the failure stops applying on its own,
  // with no effect needed to reset it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = remoteUrl !== null && failedUrl === remoteUrl;

  // Registration happens in an effect, never during render: it writes to the
  // provider's state, and render must stay free of side effects.
  useEffect(() => {
    if (remoteUrl === null) return;
    register(remoteUrl);
    return () => unregister(remoteUrl);
  }, [remoteUrl, register, unregister]);

  const altText = alt?.trim() ?? "";
  const boxStyle = reservedBoxStyle(width, height);

  // data: and blob: are part of the document itself. Nothing leaves the browser,
  // so there is nothing to consent to.
  if (classification.kind === "inline") {
    return (
      <img
        src={classification.url}
        alt={altText}
        title={title}
        width={width}
        height={height}
        decoding="async"
        className={joinClasses("h-auto max-w-full", className)}
      />
    );
  }

  // A single dropped .md file has no folder around it, so a relative path has
  // nothing to resolve against — now or ever. This is an explanation, not a
  // failure, and it is not registered as remote because it triggers no request.
  if (classification.kind === "unresolvable") {
    const path = classification.path.length > 0 ? classification.path : "(no source)";
    return (
      <ImagePlaceholder
        tone="missing"
        glyph={<DocumentGlyph />}
        boxStyle={boxStyle}
        description={`${altText.length > 0 ? `${altText}. ` : ""}This document points to ${path}, which is stored next to it. Only the .md file was opened, so that file is not here.`}
        label={
          <>
            <code className="font-mono">{path}</code>
            <span> — not included with this file</span>
          </>
        }
      />
    );
  }

  const { url, host } = classification;

  if (allowed && !failed) {
    return (
      <img
        src={url}
        alt={altText}
        title={title}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        // Belt and braces with the site-wide Referrer-Policy header: the host
        // learns what it must to serve the bytes, and not which page asked.
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        className={joinClasses("h-auto max-w-full", className)}
      />
    );
  }

  if (allowed && failed) {
    return (
      <ImagePlaceholder
        tone="failed"
        glyph={<UnavailableGlyph />}
        boxStyle={boxStyle}
        description={`${altText.length > 0 ? `${altText}. ` : ""}${url} did not load.`}
        label={
          <>
            <code className="font-mono">{url}</code>
            <span> — did not load</span>
          </>
        }
      />
    );
  }

  // Blocked. No <img> is created, so the browser has no reason to contact host.
  return (
    <ImagePlaceholder
      tone="gated"
      glyph={<ImageGlyph />}
      boxStyle={boxStyle}
      description={`${altText.length > 0 ? `${altText}. ` : ""}Image from ${host}, not loaded. Loading it lets ${host} see your IP address.`}
      label={
        <>
          <span className="text-fg font-medium">{host}</span>
          {altText.length > 0 ? <span> · {altText}</span> : null}
        </>
      }
      action={
        <button
          type="button"
          onClick={allow}
          aria-label="Load this document's images"
          className="border-border text-accent hover:border-accent focus-visible:outline-accent shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Load
        </button>
      }
    />
  );
}

/* ---------------------------------------------------------------------------
 * Bits
 * ------------------------------------------------------------------------ */

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

function ImageGlyph(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <circle cx="5.5" cy="6.5" r="1.1" />
      <path d="M2.25 11.5 6 8.25l2.75 2.25L11 8.75l2.75 2.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DocumentGlyph(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.25 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.5z"
        strokeLinejoin="round"
      />
      <path d="M9.25 1.75V5.5H13" strokeLinejoin="round" />
    </svg>
  );
}

function UnavailableGlyph(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M2.5 13.5 13.5 2.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}
