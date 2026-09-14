"use client";

/**
 * The rendering pipeline.
 *
 * Emits document content only — no wrapping element. The viewer shell supplies
 * the `<article className="markdown-body">` this renders into.
 */

import { useEffect, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import type { PluggableList } from "unified";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { Options as AutolinkOptions } from "rehype-autolink-headings";
import rehypeKatex from "rehype-katex";
import type { Options as KatexOptions } from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import type { RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import type { HighlighterCore } from "shiki/core";

import { GatedImage } from "@/components/remote-image-gate";
import { MermaidBlock } from "@/components/mermaid-block";
import rehypeMermaidPlaceholder from "@/lib/markdown/rehype-mermaid-placeholder";
import { DATA_IMAGE_URL, sanitizeSchema } from "@/lib/markdown/sanitize-schema";
import {
  SHIKI_THEMES,
  ensureLanguages,
  extractFenceLanguages,
  getHighlighter,
} from "@/lib/markdown/shiki";

import "katex/dist/katex.min.css";

/** Absolute web links get opened in a new tab; `#anchor` links do not. */
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

/**
 * `remark-frontmatter` is defence in depth. `parseFrontmatter` has normally
 * already removed the block before the body reaches this component, but a
 * document opened by some other path must never render its own YAML as prose.
 */
const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkMath,
  [remarkFrontmatter, ["yaml"]],
];

/** Without this `remark-rehype` discards raw HTML and `rehype-raw` gets nothing. */
const REMARK_REHYPE_OPTIONS = { allowDangerousHtml: true } as const;

/**
 * react-markdown's `defaultUrlTransform` allows only `http`, `https`, `ircs`,
 * `mailto`, and `xmpp`, and returns `''` for anything else — which silently
 * emptied the `src` of every inline `data:image/...` payload, so an embedded
 * image arrived at `GatedImage` with no source at all and was reported as a
 * missing file.
 *
 * Inline images are re-admitted here, and only inline images: the pattern is
 * the same one `sanitize-schema` enforces, imported rather than copied so the
 * two can never drift. Everything else still goes through the default, and by
 * this point `rehype-sanitize` has already vetted every URL in the tree — this
 * runs afterwards, while React elements are being built.
 */
function urlTransform(url: string): string {
  return DATA_IMAGE_URL.test(url) ? url : defaultUrlTransform(url);
}

/**
 * GitHub-style heading anchors: a `#` hung in the left gutter, revealed on
 * hover. `prepend` puts the link first so `markdown.css` can float it out of
 * the text flow, and `aria-hidden` + `tabIndex: -1` keep a link that merely
 * repeats the heading out of the tab order and the accessibility tree.
 */
const AUTOLINK_OPTIONS: AutolinkOptions = {
  behavior: "prepend",
  properties: {
    className: ["heading-anchor"],
    ariaHidden: "true",
    tabIndex: -1,
  },
  content: { type: "text", value: "#" },
};

/**
 * KaTeX runs on author-supplied TeX, so the two unbounded knobs get bounds:
 * `maxSize` caps `\rule`-style dimensions and `maxExpand` caps macro expansion.
 * `trust` stays at its default of `false`, which is what blocks `\href` from
 * carrying a `javascript:` URL and `\includegraphics` from loading anything.
 */
const KATEX_OPTIONS = {
  maxSize: 100,
  maxExpand: 1000,
  strict: false,
  errorColor: "#cf222e",
} as const satisfies KatexOptions;

const SHIKI_OPTIONS: RehypeShikiCoreOptions = {
  themes: SHIKI_THEMES,
  /**
   * Mandatory. `false` makes Shiki emit **both** `--shiki-light` and
   * `--shiki-dark` on every token instead of baking one theme's colours into
   * `color:`. The stylesheet then switches themes with a CSS rule, so toggling
   * dark mode costs nothing and never re-tokenises the document.
   */
  defaultColor: false,
  /** Unknown fence languages still get a themed code block rather than none. */
  fallbackLanguage: "text",
  onError: (error: unknown) => {
    // A grammar that cannot tokenise one block leaves that block unhighlighted.
    // It must never take the whole document down with it.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[markdown-renderer] syntax highlighting failed", error);
    }
  },
};

/** Props react-markdown hands the `<mermaid-chart>` placeholder element. */
interface MermaidChartProps extends ExtraProps {
  "data-mermaid"?: string;
}

/**
 * `Components` is keyed by `keyof JSX.IntrinsicElements`, which cannot describe
 * the custom element `rehype-mermaid-placeholder` introduces. Intersecting adds
 * the key without loosening any of the built-in ones.
 */
type MarkdownComponents = Components & {
  "mermaid-chart": ComponentType<MermaidChartProps>;
};

/** Bridges the placeholder element to the diagram renderer. */
function MermaidChart({ "data-mermaid": chart }: MermaidChartProps) {
  if (!chart) return null;
  return <MermaidBlock chart={chart} />;
}

/**
 * Anchors that leave the page open in a new tab and carry no referrer
 * relationship back to it. In-page `#anchor` links are left exactly as they are.
 */
function MarkdownLink({
  node,
  href,
  children,
  ...rest
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  // Pulled out of `rest` only so react-markdown's hast node never reaches the DOM.
  void node;

  const isExternal = typeof href === "string" && ABSOLUTE_HTTP_URL.test(href);

  return (
    <a
      {...rest}
      href={href}
      {...(isExternal
        ? { target: "_blank", rel: "noopener noreferrer nofollow" }
        : {})}
    >
      {children}
    </a>
  );
}

const COMPONENTS: MarkdownComponents = {
  a: MarkdownLink,
  img: GatedImage,
  "mermaid-chart": MermaidChart,
};

/** What the async highlighter hand-off tracks between renders. */
interface HighlighterState {
  instance: HighlighterCore | null;
  /**
   * Bumped whenever a new grammar is registered. The highlighter is a singleton,
   * so its identity never changes after the first load — without a counter,
   * React would see an unchanged value and skip the re-render that would
   * actually apply the language that just finished loading.
   */
  revision: number;
}

const INITIAL_HIGHLIGHTER_STATE: HighlighterState = {
  instance: null,
  revision: 0,
};

export function MarkdownRenderer({ markdown }: { markdown: string }) {
  const [highlighter, setHighlighter] = useState<HighlighterState>(
    INITIAL_HIGHLIGHTER_STATE,
  );

  useEffect(() => {
    let cancelled = false;

    /*
     * Shiki's language loading is async but unified runs synchronously inside
     * React's render, so every grammar the document needs has to be resident
     * *before* the plugin is attached. Until that resolves the document renders
     * without the Shiki plugin — plain `<pre><code>`, readable immediately and
     * never blank.
     *
     * `cancelled` covers both hazards: unmounting mid-load, and a new document
     * arriving while the previous document's grammars are still in flight (the
     * stale effect's cleanup runs first, so its late resolution is discarded).
     */
    void (async () => {
      try {
        const loadedNewLanguage = await ensureLanguages(
          extractFenceLanguages(markdown),
        );
        const instance = await getHighlighter();
        if (cancelled) return;

        setHighlighter((previous) =>
          previous.instance === instance && !loadedNewLanguage
            ? previous
            : { instance, revision: previous.revision + 1 },
        );
      } catch (error) {
        // Highlighting is an enhancement. Losing it costs the reader nothing
        // but colour, so the document keeps rendering unhighlighted.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[markdown-renderer] highlighter unavailable", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [markdown]);

  /**
   * Rebuilt only when the highlighter gains a grammar — otherwise unified would
   * assemble a fresh processor on every unrelated re-render.
   *
   * ORDER IS LOAD-BEARING:
   *
   *  1. `rehype-raw`      parse the document's embedded HTML into real nodes.
   *  2. `rehype-sanitize` filter everything author-controlled. Must come after
   *                       raw (or there is nothing to filter) and before every
   *                       plugin below (or their generated markup gets stripped).
   *  3. `rehype-slug`     give headings ids.
   *  4. `rehype-autolink` link headings to those ids.
   *  5. `rehype-katex`    render math.
   *  6. mermaid placeholder  lift diagram fences out of the code-block path.
   *  7. `rehype-shiki`    highlight everything still left in a `<pre><code>`.
   *
   * Steps 5 and 6 both run before Shiki for the same reason: Shiki claims *any*
   * `pre > code[class*="language-"]`, and with `fallbackLanguage` set it claims
   * them even when it has no grammar. `remark-math` emits display math as
   * `<pre><code class="language-math math-display">`, so leaving KaTeX until
   * after Shiki would hand it a tokenised code block with the math classes
   * already destroyed. KaTeX going first consumes those elements and leaves
   * Shiki nothing but genuine code.
   */
  const rehypePlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [
      rehypeRaw,
      [rehypeSanitize, sanitizeSchema],
      rehypeSlug,
      [rehypeAutolinkHeadings, AUTOLINK_OPTIONS],
      [rehypeKatex, KATEX_OPTIONS],
      rehypeMermaidPlaceholder,
    ];

    if (highlighter.instance) {
      plugins.push([
        rehypeShikiFromHighlighter,
        highlighter.instance,
        SHIKI_OPTIONS,
      ]);
    }

    return plugins;
  }, [highlighter]);

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
      rehypePlugins={rehypePlugins}
      components={COMPONENTS}
      urlTransform={urlTransform}
    >
      {markdown}
    </Markdown>
  );
}
