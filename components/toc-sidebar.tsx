"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactElement, RefObject, SVGProps } from "react";
import { findHeadingElement, useActiveHeading, useHeadings } from "@/lib/use-headings";
import type { Heading } from "@/lib/types";

/** A single heading is not a table of contents; it is a title. */
const MIN_HEADINGS = 2;

/** Indent, in px, of a top-level entry and of each nested level below it. */
const INDENT_BASE_PX = 12;
const INDENT_STEP_PX = 12;

/** Beyond this the indent stops growing, or deep trees run off the column. */
const MAX_INDENT_LEVEL = 3;

/**
 * Fallback clearance for the sticky header, applied only when the rendered
 * heading has no `scroll-margin-top` of its own.
 */
const HEADER_OFFSET_PX = 80;

const DESKTOP_QUERY = "(min-width: 1024px)";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ICON_PROPS: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
  className: "size-4",
};

function ListIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 6h12" />
      <path d="M9 12h12" />
      <path d="M9 18h12" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </svg>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg {...ICON_PROPS}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

/**
 * Scroll a heading into view without touching the URL. A `#hash` here would
 * push a history entry per click and turn Back into a TOC-rewind button, which
 * in a single-screen app with no routing state is worse than useless.
 */
function scrollToHeading(id: string, container: HTMLElement | null): void {
  const target = findHeadingElement(container, id);
  if (!target) return;

  // Defer to the stylesheet if the markdown styles already clear the header.
  const existing = window.getComputedStyle(target).scrollMarginTop;
  if (!Number.parseFloat(existing)) {
    target.style.scrollMarginTop = `${HEADER_OFFSET_PX}px`;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

interface TocListProps {
  headings: readonly Heading[];
  activeId: string | null;
  /** Depth of the shallowest heading present, used as the indent origin. */
  baseDepth: number;
  onSelect: (id: string) => void;
}

function TocList({ headings, activeId, baseDepth, onSelect }: TocListProps): ReactElement {
  return (
    <ul className="space-y-0.5 text-sm">
      {headings.map((heading) => {
        const level = Math.min(Math.max(heading.depth - baseDepth, 0), MAX_INDENT_LEVEL);
        const isActive = heading.id === activeId;

        return (
          <li key={heading.id}>
            <button
              type="button"
              onClick={() => onSelect(heading.id)}
              aria-current={isActive ? "location" : undefined}
              title={heading.text}
              style={{ paddingInlineStart: `${INDENT_BASE_PX + level * INDENT_STEP_PX}px` }}
              className={`block w-full cursor-pointer border-l-2 py-1 pe-2 text-left leading-snug transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current ${
                isActive
                  ? "text-accent border-current font-medium"
                  : "text-fg-muted hover:text-fg hover:border-border border-transparent"
              }`}
            >
              <span className="line-clamp-2">{heading.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export interface TocSidebarProps {
  /** Element wrapping the rendered markdown. Headings are read from inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** Changes when a different document is loaded. */
  contentKey: string | number;
}

/**
 * Table of contents built from the rendered DOM.
 *
 * Desktop: a sticky column. Mobile: a floating button opening a modal sheet.
 * Renders nothing when the document has fewer than two headings.
 */
export function TocSidebar({ containerRef, contentKey }: TocSidebarProps) {
  const headings = useHeadings(containerRef, contentKey);
  const activeId = useActiveHeading(headings, containerRef);

  // The sheet stores *which document* it was opened for rather than a bare
  // boolean, so loading a new document closes it by derivation — no effect, and
  // no window in which the old document's TOC is still on screen.
  const [openForKey, setOpenForKey] = useState<string | number | null>(null);
  const isDrawerOpen = openForKey === contentKey;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drawerTitleId = useId();

  const openDrawer = useCallback(() => setOpenForKey(contentKey), [contentKey]);
  const closeDrawer = useCallback(() => setOpenForKey(null), []);

  const handleSelect = useCallback(
    (id: string) => {
      setOpenForKey(null);
      // One frame of slack so the sheet's scroll lock is released before the
      // smooth scroll starts; otherwise the animation is swallowed.
      requestAnimationFrame(() => scrollToHeading(id, containerRef.current));
    },
    [containerRef],
  );

  // Widening past the breakpoint reveals the sticky column; the sheet would
  // otherwise linger, open but display:none, holding focus hostage.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const handleChange = () => {
      if (query.matches) setOpenForKey(null);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [isDrawerOpen]);

  // Modal behaviour: Escape to dismiss, focus trapped inside, focus returned to
  // the trigger on close, and the page behind held still.
  useEffect(() => {
    if (!isDrawerOpen) return;

    const panel = panelRef.current;
    if (!panel) return;

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    focusables()[0]?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenForKey(null);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      // `preventScroll` so returning focus never competes with the smooth
      // scroll a selection kicks off on the very next frame.
      trigger?.focus({ preventScroll: true });
    };
  }, [isDrawerOpen]);

  if (headings.length < MIN_HEADINGS) return null;

  // Most READMEs open at h2. Normalise so the shallowest heading present sits
  // at the base indent instead of leaving a permanent empty gutter.
  const baseDepth = headings.reduce(
    (shallowest, heading) => Math.min(shallowest, heading.depth),
    Number.POSITIVE_INFINITY,
  );

  const list = (
    <TocList
      headings={headings}
      activeId={activeId}
      baseDepth={baseDepth}
      onSelect={handleSelect}
    />
  );

  return (
    <>
      <nav
        aria-label="Table of contents"
        className="border-border sticky top-16 hidden max-h-[calc(100dvh-6rem)] w-60 shrink-0 self-start overflow-y-auto border-s py-1 lg:block"
      >
        <p className="text-fg-muted mb-2 px-3 text-xs font-semibold tracking-wide uppercase">
          On this page
        </p>
        {list}
      </nav>

      <div className="lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={openDrawer}
          aria-expanded={isDrawerOpen}
          aria-haspopup="dialog"
          className="bg-canvas-subtle text-fg border-border fixed end-4 bottom-4 z-40 inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <ListIcon />
          Contents
        </button>

        {isDrawerOpen && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={closeDrawer}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={drawerTitleId}
              className="bg-canvas border-border relative flex max-h-[75dvh] w-full flex-col rounded-t-xl border-t shadow-2xl"
            >
              <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
                <h2 id={drawerTitleId} className="text-fg text-sm font-semibold">
                  Contents
                </h2>
                <button
                  type="button"
                  onClick={closeDrawer}
                  aria-label="Close table of contents"
                  className="text-fg-muted hover:text-fg hover:bg-canvas-subtle inline-flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                >
                  <CloseIcon />
                </button>
              </div>
              <nav
                aria-label="Table of contents"
                className="flex-1 overflow-y-auto px-2 py-3"
              >
                {list}
              </nav>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
