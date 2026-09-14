"use client";

/**
 * Mermaid diagrams for the markdown viewer.
 *
 * Three things drive the shape of this file:
 *
 * 1. Mermaid is roughly half a megabyte of grammars. It is imported with a
 *    dynamic `import("mermaid")` the first time a block actually mounts, and the
 *    module promise is memoised at module scope so a document with twenty
 *    diagrams downloads it once — and a document with none never downloads it.
 * 2. The source comes from a file a stranger dropped on the page, so mermaid runs
 *    at `securityLevel: "strict"` (its output is DOMPurify-sanitised before it is
 *    handed back) and we deliberately never call the returned `bindFunctions`,
 *    which is what would attach a document's `click` directives to the DOM.
 * 3. Half-written diagrams are normal, not exceptional. A parse failure shows the
 *    source and mermaid's complaint; it never propagates to the parent.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useTheme } from "next-themes";
import type { Mermaid, MermaidConfig } from "mermaid";

/**
 * The one copy of mermaid, shared by every block. `import()` returns the same
 * promise for repeat calls, but caching it here also skips the extra microtask
 * hop and keeps the "loaded exactly once" guarantee explicit.
 */
let mermaidModule: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= import("mermaid").then((module) => module.default);
  return mermaidModule;
}

/**
 * Mermaid keeps a single global config and a single global diagram-directive
 * scope, so two blocks initialising and rendering concurrently can read each
 * other's settings. Chaining every `initialize` + `render` pair through one
 * queue makes each block's configuration atomic with its own render.
 */
let renderChain: Promise<void> = Promise.resolve();

function enqueueRender(task: () => Promise<void>): void {
  const run = renderChain.then(task, task);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
}

/**
 * `suppressErrorRendering` stops mermaid from injecting its own "Syntax error"
 * diagram into the page; we present failures ourselves. `fontFamily: "inherit"`
 * makes both mermaid's off-screen measuring pass and the injected SVG use the
 * document font, so label boxes match the text they end up containing.
 */
const BASE_MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  fontFamily: "inherit",
} as const satisfies MermaidConfig;

type DiagramState =
  | { status: "pending" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

/**
 * `useId()` is unique but not guaranteed to be a valid CSS identifier, and
 * mermaid feeds the id straight into `querySelector` while it cleans up its
 * scratch nodes. Strip it down to a selector-safe token.
 */
function toDomId(reactId: string): string {
  return `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Mermaid throws `Error`s, `DetailedError`s (a `str` field), and bare strings. */
function describeMermaidError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    for (const [key, value] of Object.entries(error)) {
      if ((key === "message" || key === "str") && typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return "Mermaid could not parse this diagram.";
}

/**
 * Mermaid renders into a scratch `<div id="d{id}">` parked on `<body>` and only
 * removes it on the paths it anticipates. Anything of ours still sitting
 * directly on `<body>` after a render — success, failure, or an abandoned
 * request — is swept up here. The `parentElement` check is what keeps this from
 * ever touching the SVG we inject into our own container, which carries the
 * same id.
 */
function purgeStrayMermaidNodes(domId: string): void {
  if (typeof document === "undefined") return;
  for (const strayId of [domId, `d${domId}`, `i${domId}`]) {
    const stray = document.getElementById(strayId);
    if (stray !== null && stray.parentElement === document.body) stray.remove();
  }
}

export function MermaidBlock({ chart }: { chart: string }): ReactElement | null {
  const source = chart.trim();
  const domId = toDomId(useId());
  const { resolvedTheme } = useTheme();
  const [state, setState] = useState<DiagramState>({ status: "pending" });
  /** Monotonic request counter; a result that is not the latest is discarded. */
  const requestRef = useRef(0);

  useEffect(() => {
    if (source.length === 0) return;
    // next-themes reports `undefined` until it has read the class off <html>.
    // Waiting one tick beats rendering the light palette and instantly
    // re-rendering it dark.
    if (resolvedTheme === undefined) return;

    const requestId = ++requestRef.current;
    let active = true;
    const isStale = (): boolean => !active || requestRef.current !== requestId;

    enqueueRender(async () => {
      try {
        const mermaid = await loadMermaid();
        if (isStale()) return;
        // Mermaid caches theme variables globally and bakes them into the SVG,
        // so a theme flip means re-initialising and re-rendering. There is no
        // supported way to recolour an SVG it has already produced.
        mermaid.initialize({
          ...BASE_MERMAID_CONFIG,
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const { svg } = await mermaid.render(domId, source);
        if (isStale()) return;
        setState({ status: "ready", svg });
      } catch (error) {
        if (isStale()) return;
        setState({ status: "error", message: describeMermaidError(error) });
      } finally {
        purgeStrayMermaidNodes(domId);
      }
    });

    return () => {
      active = false;
    };
  }, [source, resolvedTheme, domId]);

  // A block unmounted mid-render leaves its scratch node behind; the queued task
  // still sweeps it, but this covers an unmount that happens first.
  useEffect(() => () => purgeStrayMermaidNodes(domId), [domId]);

  if (source.length === 0) return null;

  if (state.status === "error") {
    return (
      <div className="border-border my-4 overflow-hidden rounded-lg border">
        <p className="text-attention border-border bg-canvas-subtle border-b px-3 py-2 text-xs">
          This diagram could not be parsed. Showing its source instead.
        </p>
        <pre className="bg-canvas-inset overflow-x-auto px-3 py-3 text-xs leading-relaxed">
          <code className="font-mono">{source}</code>
        </pre>
        <p className="text-fg-muted border-border bg-canvas-subtle border-t px-3 py-2 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap">
          {state.message}
        </p>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      // The SVG is centred and capped at the column width, so the page body
      // never gains a horizontal scrollbar. The wrapper scrolls on its own for
      // the diagram types that emit a fixed pixel width regardless.
      <div className="my-4 overflow-x-auto">
        <div
          className="[&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full"
          // Safe: mermaid sanitises its output with DOMPurify at
          // securityLevel "strict" before returning the string.
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Rendering diagram"
      className="border-border bg-canvas-subtle my-4 h-24 animate-pulse rounded-lg border"
    />
  );
}
