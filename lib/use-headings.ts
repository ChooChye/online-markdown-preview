"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Heading } from "@/lib/types";

/**
 * The TOC reads the *rendered DOM*, not the markdown AST. That is deliberate:
 * it keeps this module decoupled from the rendering pipeline, and it picks up
 * headings that arrive through `rehype-raw` from inline HTML — which never
 * appear as heading nodes in the mdast the renderer walks.
 *
 * The cost of reading the DOM is that the DOM is not finished when React
 * commits: Shiki re-renders every code block once its grammar loads, Mermaid
 * swaps a <pre> for an <svg>, KaTeX rewrites math. A one-shot scan on mount
 * would run against a half-built tree. Hence the MutationObserver below.
 */

/** How long the subtree must sit still before a re-scan is worth doing. */
const SCAN_DEBOUNCE_MS = 100;

/** Frames to wait for a container that mounts a commit later than this hook. */
const MAX_ATTACH_FRAMES = 60;

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * Nodes that are inside a heading but are not part of its title:
 * the `rehype-autolink-headings` permalink, icon spans, and anything the
 * pipeline has already marked as decorative for assistive tech.
 */
const DECORATIVE_SELECTOR = '[aria-hidden="true"], .anchor, .heading-anchor, .heading-link';

/** Bare permalink glyphs, for anchors that were not marked decorative. */
const ANCHOR_GLYPHS = new Set(["#", "¶", "§", "∞", "🔗", "link"]);

/** Reading band: from 10% down the viewport to 20% down. */
const BAND_TOP_PCT = 10;
const BAND_BOTTOM_PCT = 80;
const ACTIVE_ROOT_MARGIN = `-${BAND_TOP_PCT}% 0px -${BAND_BOTTOM_PCT}% 0px`;

/** Slack when deciding "the page is scrolled all the way down". */
const BOTTOM_EPSILON_PX = 2;

/**
 * Resolve a heading id to the element `rehype-slug` put it on, scoped to the
 * rendered container when there is one.
 *
 * `CSS.escape` is the whole reason this is a function rather than an inline
 * `querySelector`: a slug is derived from arbitrary heading text, so it can
 * legitimately contain characters — a leading digit, a `.`, a `:` — that make a
 * bare `#id` selector either invalid or a match for something else entirely.
 * Every consumer has to escape it the same way, so there is one copy of the rule.
 */
export function findHeadingElement(
  container: HTMLElement | null,
  id: string,
): HTMLElement | null {
  const scope: ParentNode = container ?? document;
  return scope.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
}

/**
 * Drop a leading or trailing permalink anchor. Done structurally rather than
 * with a regex over the text so a heading legitimately titled "#hashtag"
 * survives intact.
 */
function stripAnchorGlyph(root: HTMLElement): void {
  for (const candidate of [root.firstElementChild, root.lastElementChild]) {
    if (!candidate || candidate.tagName !== "A") continue;
    const label = (candidate.textContent ?? "").trim();
    if (label === "" || ANCHOR_GLYPHS.has(label.toLowerCase())) candidate.remove();
  }
}

function readHeadingText(heading: HTMLHeadingElement): string {
  // `Node.cloneNode` is declared as `(): Node` in lib.dom — it is not
  // polymorphic over `this`, so the element type has to be restored by hand.
  // A clone of an `HTMLHeadingElement` is an `HTMLHeadingElement`.
  const clone = heading.cloneNode(true) as HTMLHeadingElement;
  clone.querySelectorAll(DECORATIVE_SELECTOR).forEach((node) => node.remove());
  stripAnchorGlyph(clone);
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A heading the reader cannot see does not belong in a table of contents.
 * `remark-gfm` emits `<h2 class="sr-only">Footnotes</h2>` above the footnote
 * list, which otherwise shows up as a second, unexplained "Footnotes" entry
 * pointing at nothing visible. Checked by geometry rather than by class name so
 * any visually-hidden heading is covered, however it was hidden.
 */
function isVisuallyHidden(node: HTMLElement): boolean {
  if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
  const rect = node.getBoundingClientRect();
  return rect.width <= 1 || rect.height <= 1;
}

function readHeadings(container: HTMLElement): Heading[] {
  const found: Heading[] = [];
  const seen = new Set<string>();

  for (const node of container.querySelectorAll<HTMLHeadingElement>(HEADING_SELECTOR)) {
    // No id means rehype-slug did not reach it (raw HTML, or an empty heading);
    // there is nothing to scroll to, so it does not belong in the TOC.
    const id = node.id;
    if (!id || seen.has(id)) continue;
    if (isVisuallyHidden(node)) continue;

    const text = readHeadingText(node);
    if (!text) continue;

    const depth = Number.parseInt(node.tagName.slice(1), 10);
    if (!Number.isFinite(depth)) continue;

    seen.add(id);
    found.push({ id, text, depth });
  }

  return found;
}

/**
 * Value equality, so a re-scan that finds nothing new returns the *same array
 * reference*. Downstream that matters: `useActiveHeading` keys its effect on
 * this array, and the observers it builds are not cheap to tear down and
 * rebuild on every Shiki repaint.
 */
function sameHeadings(a: readonly Heading[], b: readonly Heading[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.id !== right.id || left.text !== right.text || left.depth !== right.depth) {
      return false;
    }
  }
  return true;
}

/**
 * Headings currently present in the rendered container, in document order.
 *
 * @param containerRef Element wrapping the rendered markdown.
 * @param contentKey   Changes when a different document is loaded; forces a
 *                     fresh scan and a fresh observer.
 */
export function useHeadings(
  containerRef: RefObject<HTMLElement | null>,
  contentKey: string | number,
): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let attachAttempts = 0;

    const scan = (container: HTMLElement): void => {
      if (disposed) return;
      const next = readHeadings(container);
      setHeadings((previous) => (sameHeadings(previous, next) ? previous : next));
    };

    /**
     * Trailing-edge debounce, then a frame. The timeout coalesces the burst of
     * mutations a syntax-highlight or diagram swap produces; the rAF makes sure
     * the scan reads geometry-settled DOM rather than racing the same paint.
     */
    const schedule = (container: HTMLElement): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = 0;
          scan(container);
        });
      }, SCAN_DEBOUNCE_MS);
    };

    const attach = (): void => {
      if (disposed) return;
      const container = containerRef.current;
      if (!container) {
        // The content pane can mount a commit after the TOC. Retry briefly
        // rather than silently rendering an empty sidebar forever.
        if (attachAttempts >= MAX_ATTACH_FRAMES) {
          setHeadings((previous) => (previous.length === 0 ? previous : []));
          return;
        }
        attachAttempts += 1;
        frame = requestAnimationFrame(attach);
        return;
      }

      // First paint is usually already correct; do not make the reader wait
      // out the debounce for a TOC that could be shown immediately.
      scan(container);

      observer = new MutationObserver(() => schedule(container));
      observer.observe(container, {
        childList: true,
        subtree: true,
        // Heading text can be rewritten in place (a text node swap) without any
        // element being added or removed.
        characterData: true,
      });
    };

    attach();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [containerRef, contentKey]);

  return headings;
}

/**
 * Scroll-spy over the same headings.
 *
 * `headings` is expected to be the referentially-stable array `useHeadings`
 * returns; passing a freshly-built array on every render would rebuild the
 * observers each time.
 *
 * @returns The id of the heading whose section the reader is in, or `null`
 *          when there are no headings.
 */
export function useActiveHeading(
  headings: readonly Heading[],
  containerRef: RefObject<HTMLElement | null>,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;

    const container = containerRef.current;
    const cache = new Map<string, HTMLElement>();
    const inBand = new Set<string>();
    let frame = 0;
    let disposed = false;

    /**
     * Self-healing lookup: the renderer can replace a heading node while
     * keeping its id (a re-render of the same document), which would leave a
     * cached reference detached and reporting an all-zero rect.
     */
    const lookup = (id: string): HTMLElement | null => {
      const cached = cache.get(id);
      if (cached && cached.isConnected) return cached;
      const found = findHeadingElement(container, id);
      if (found) cache.set(id, found);
      else cache.delete(id);
      return found;
    };

    const resolve = (): void => {
      if (disposed) return;

      const first = headings[0];
      const last = headings[headings.length - 1];
      if (!first || !last) return;

      // Edge case 1 — the bottom. The closing sections sit below the band and
      // can never enter it, so the last heading would otherwise never light up.
      const viewportBottom = window.scrollY + window.innerHeight;
      if (document.documentElement.scrollHeight - viewportBottom <= BOTTOM_EPSILON_PX) {
        setActiveId(last.id);
        return;
      }

      // Inside the band, the deepest-down heading wins: it is the one the
      // reader has most recently scrolled past.
      let candidate: string | null = null;
      for (const heading of headings) {
        if (inBand.has(heading.id)) candidate = heading.id;
      }

      // Mid-section, nothing is in the band. Fall back to geometry: the last
      // heading whose top has already passed above the band.
      if (candidate === null) {
        const bandTop = window.innerHeight * (BAND_TOP_PCT / 100);
        for (const heading of headings) {
          const element = lookup(heading.id);
          if (!element) continue;
          if (element.getBoundingClientRect().top <= bandTop) candidate = heading.id;
          else break;
        }
      }

      // Edge case 2 — the top. Above the first heading there is no "previous"
      // section, so the document's opening heading is the honest answer.
      setActiveId(candidate ?? first.id);
    };

    const schedule = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        resolve();
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (!id) continue;
          if (entry.isIntersecting) inBand.add(id);
          else inBand.delete(id);
        }
        schedule();
      },
      { rootMargin: ACTIVE_ROOT_MARGIN, threshold: 0 },
    );

    for (const heading of headings) {
      const element = lookup(heading.id);
      if (element) observer.observe(element);
    }

    // The observer alone cannot see the two edge cases above — neither fires an
    // entry when you scroll the last screenful. Capture phase so a nested
    // scroll container is covered as well as the window.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [headings, containerRef]);

  // Derived rather than reset in the effect: when a new document loads, the id
  // held in state belongs to the old one. Discarding it here means the TOC is
  // simply unmarked for the one frame before `resolve` runs, instead of briefly
  // highlighting a heading that no longer exists.
  return activeId !== null && headings.some((heading) => heading.id === activeId)
    ? activeId
    : null;
}
