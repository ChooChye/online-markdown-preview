/**
 * The sanitize schema. This is the trust boundary for hostile documents.
 *
 * WHERE THIS RUNS IN THE PIPELINE
 * -------------------------------
 * `rehype-raw` parses the document's embedded HTML, then `rehype-sanitize` runs
 * with this schema, and only *afterwards* do `rehype-slug`,
 * `rehype-autolink-headings`, Shiki and KaTeX add markup of their own. That
 * order is deliberate:
 *
 *   - Everything author-controlled passes through the filter below.
 *   - Everything the pipeline generates — Shiki's hundreds of inline-styled
 *     `<span>`s, KaTeX's MathML and `.katex-*` trees, slugged heading ids,
 *     anchor links — is produced *after* the filter and is therefore never
 *     stripped. Sanitizing last would destroy all of it.
 *
 * So this schema only ever needs to describe what a *document* may contain, not
 * what our own plugins emit.
 *
 * WHAT IS NEVER ALLOWED
 * ---------------------
 * `script`, `style`, `iframe`, `object`, `embed`, `form`, `link`, `meta`,
 * `base` (and friends) are listed in `strip`, which drops the element *and its
 * contents* rather than unwrapping it. Every `on*` handler is dropped because
 * no attribute definition below matches one, and `javascript:` / `vbscript:` /
 * `data:text/html` URLs fail the protocol and value checks on `href` and `src`.
 *
 * A NOTE ON REMOTE RESOURCES
 * --------------------------
 * Privacy is this product's headline claim, and `<img>` is the only element
 * with an opt-in gate in front of it (`components/remote-image-gate`). Any other
 * element that can fetch a third-party URL without the reader asking —
 * `<source srcset>`, `<video src|poster>`, `<audio src>` — would quietly defeat
 * that gate, so their URLs are restricted to same-document and `data:` values.
 * A `<picture>` with remote `<source>`s degrades to its `<img>` fallback, which
 * *is* gated. See `lib/csp.ts` for the matching header.
 */

import { defaultSchema } from "rehype-sanitize";
import type { Options as SanitizeSchema } from "rehype-sanitize";

type AttributeDefinitions = NonNullable<
  NonNullable<SanitizeSchema["attributes"]>[string]
>;
type PropertyDefinition = AttributeDefinitions[number];

/** A URL with no scheme at all: `./a.png`, `/a.png`, `#anchor`, `?q=1`. */
const RELATIVE_URL = /^(?![a-z][a-z0-9+.-]*:)/i;

/** An absolute web URL. */
const HTTP_URL = /^https?:\/\//i;

/**
 * An inline image payload. Deliberately enumerates image media types so that
 * `data:text/html,<script>…</script>` cannot ride in on an attribute whose
 * protocol allow-list has to contain `data` for base64 images to work at all.
 */
export const DATA_IMAGE_URL =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)[;,]/i;

/** `language-ts`, `language-c++`, `language-objective-c`, `language-math`, … */
const LANGUAGE_CLASS = /^language-[\w#+.-]+$/i;

/**
 * Classes `remark-math` puts on the element holding TeX. `rehype-katex` reads
 * them to decide inline vs. display mode, so they must survive the filter.
 */
const MATH_CLASSES = ["math", "math-inline", "math-display"] as const;

/** ARIA attributes the default schema allows in several places. */
const ARIA = ["ariaDescribedBy", "ariaLabel", "ariaLabelledBy"] as const;

/**
 * The default definitions for `tagName`, minus any definition for the given
 * property names.
 *
 * `hast-util-sanitize` resolves a property against the *first* definition whose
 * name matches, so tightening an attribute the default schema already allows
 * means replacing its entry, not appending a second one.
 */
function defaultsFor(
  tagName: string,
  ...replaced: readonly string[]
): PropertyDefinition[] {
  const definitions = defaultSchema.attributes?.[tagName] ?? [];
  return definitions.filter((definition) => {
    const name = typeof definition === "string" ? definition : definition[0];
    return !replaced.includes(name);
  });
}

/**
 * Tags real-world READMEs use, on top of the GitHub-flavoured defaults.
 *
 * `mermaid-chart` is the custom element `rehype-mermaid-placeholder` produces.
 * That plugin runs after sanitization, so the entry here only matters for a
 * document that writes the tag by hand — which is exactly why it is listed
 * explicitly rather than left to chance.
 */
const EXTRA_TAG_NAMES = [
  "abbr",
  "audio",
  "caption",
  "col",
  "colgroup",
  "figcaption",
  "figure",
  "mark",
  "mermaid-chart",
  "video",
] as const;

/**
 * Dropped along with their contents.
 *
 * Anything *not* in `tagNames` is unwrapped (its children survive), which is the
 * right default for unknown markup but wrong for elements whose text content is
 * itself the payload — a `<style>` body would otherwise be dumped into the page
 * as prose, and an `<svg>` would leave a trail of path data behind.
 */
const STRIPPED_TAG_NAMES = [
  "applet",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "link",
  "meta",
  "noscript",
  "object",
  "option",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
] as const;

/**
 * The schema handed to `rehype-sanitize`.
 *
 * Anything not named here is removed. Keys omitted from this object fall back
 * to `defaultSchema`, which is GitHub's own sanitation policy.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,

  tagNames: [...(defaultSchema.tagNames ?? []), ...EXTRA_TAG_NAMES],

  strip: [...(defaultSchema.strip ?? []), ...STRIPPED_TAG_NAMES],

  /**
   * Elements that only make sense inside a particular container. Without this
   * a stray `<td>` or `<source>` can break out of the structure it belongs to.
   */
  ancestors: {
    ...defaultSchema.ancestors,
    caption: ["table"],
    col: ["colgroup", "table"],
    colgroup: ["table"],
    dd: ["dl"],
    dt: ["dl"],
    figcaption: ["figure"],
    source: ["audio", "picture", "video"],
    summary: ["details"],
  },

  attributes: {
    ...defaultSchema.attributes,

    /**
     * `language-*` for Shiki, `math-*` for KaTeX. Both plugins read these
     * classes off the document's own `<pre>`/`<code>` before replacing them.
     */
    code: [
      ...defaultsFor("code", "className"),
      ["className", LANGUAGE_CLASS, ...MATH_CLASSES],
    ],
    pre: [
      ...defaultsFor("pre", "className"),
      ["className", LANGUAGE_CLASS, ...MATH_CLASSES],
    ],

    /** The wrappers `remark-math` may use for inline and display math. */
    span: [...defaultsFor("span", "className"), ["className", ...MATH_CLASSES]],
    div: [...defaultsFor("div", "className"), ["className", ...MATH_CLASSES]],

    /**
     * GFM task lists. `required` (inherited from the default schema) forces
     * every surviving `input` to `type="checkbox" disabled`, so a
     * `type="submit"` loses its submit behaviour — and `form` is stripped
     * outright, leaving nothing to submit to.
     */
    input: [
      ["type", "checkbox"],
      ["disabled", true],
      "checked",
      ["className", "task-list-item", "task-list-item-checkbox"],
    ],

    /**
     * Remote images are allowed through the filter and gated at render time by
     * `components/remote-image-gate`; nothing loads until the reader asks.
     */
    img: [
      ...defaultsFor("img", "src"),
      ["src", HTTP_URL, DATA_IMAGE_URL, RELATIVE_URL],
      "alt",
      "title",
    ],

    /** No gate exists for `<source>`, so no third-party fetches from it. */
    source: [
      ...defaultsFor("source", "srcSet"),
      ["srcSet", RELATIVE_URL, DATA_IMAGE_URL],
      ["src", RELATIVE_URL, DATA_IMAGE_URL],
      "media",
      "sizes",
      "type",
    ],

    /** Likewise for media: the browser would preload metadata unprompted. */
    video: [
      ...ARIA,
      ["src", RELATIVE_URL],
      ["poster", RELATIVE_URL],
      ["preload", "none", "metadata", "auto"],
      "controls",
      "loop",
      "muted",
      "playsInline",
    ],
    audio: [
      ...ARIA,
      ["src", RELATIVE_URL],
      ["preload", "none", "metadata", "auto"],
      "controls",
      "loop",
      "muted",
    ],

    /** Ordered lists that continue a count, or use letters/roman numerals. */
    ol: [
      ...defaultsFor("ol"),
      "start",
      ["type", "1", "a", "A", "i", "I"],
    ],

    /** Collapsible sections, the single most common raw-HTML block in a README. */
    details: [...ARIA, "open"],

    /** GFM table alignment. */
    th: [...ARIA, ["align", "left", "center", "right", "justify"], "colSpan", "rowSpan", "scope"],
    td: [...ARIA, ["align", "left", "center", "right", "justify"], "colSpan", "rowSpan"],

    /** The chart source carried by the placeholder element. */
    "mermaid-chart": ["dataMermaid"],

    /**
     * Applies to every element. Inherited wholesale from the default schema,
     * which is a closed list of harmless presentational and metadata
     * attributes — notably containing no `on*` handler and no URL-bearing
     * property, so neither can slip in on a tag that lacks a specific rule.
     *
     * `id` is on this list, which is what lets heading anchors work: ids must
     * survive the filter for `rehype-autolink-headings` to have something to
     * point at. See `clobber` below for why they are not rewritten.
     */
    "*": [...(defaultSchema.attributes?.["*"] ?? [])],
  },

  /**
   * Schemes allowed on URL-bearing properties. A value with no scheme (a
   * relative path or a bare `#anchor`) is always permitted; anything with a
   * scheme must name one of these. This is what keeps `javascript:` and
   * `vbscript:` out of `href`.
   *
   * `src` has to include `data` for inline base64 images to work at all; the
   * per-element value allow-lists above narrow that to image media types, so
   * `data:text/html` never survives.
   */
  protocols: {
    ...defaultSchema.protocols,
    cite: ["http", "https"],
    href: ["http", "https", "mailto", "tel"],
    longDesc: ["http", "https"],
    poster: ["http", "https"],
    src: ["http", "https", "data"],
  },

  /**
   * DOM-clobbering defence, narrowed to `name`.
   *
   * The default list also rewrites `id` and the `aria-*` properties that
   * reference one, prefixing each with `user-content-`. That breaks in-document
   * links, because the sanitizer prefixes the *targets* and cannot rewrite the
   * `href`s that point at them — `remark-gfm` footnotes, which arrive with a
   * `user-content-` prefix of their own, end up as `user-content-user-content-fn-1`
   * with every reference pointing somewhere that no longer exists.
   *
   * Dropping `id` from the list costs very little. Named access on `document`
   * — the vector that actually reaches application code — keys off `name`,
   * which is still rewritten here, and off `id` only for `object`/`embed`/
   * `applet` (stripped outright) and for `img` elements that also carry a
   * `name` (rewritten). What remains is named access on `window`, which only
   * creates properties that do not already exist, so it cannot shadow anything
   * the framework or this app reads.
   *
   * Footnote ids keep the `user-content-` prefix regardless: `remark-gfm`
   * applies it upstream, consistently across both the ids and the links.
   */
  clobber: ["name"],
  clobberPrefix: "user-content-",

  /** HTML comments and doctypes are never content. Both stay off. */
  allowComments: false,
  allowDoctypes: false,
};
