/**
 * Lifts ` ```mermaid ` fences out of the code-block path.
 *
 * Must run BEFORE `rehype-shiki`. Shiki claims every `<pre><code class="language-*">`
 * it finds, and with a fallback language configured it would happily tokenise a
 * Mermaid diagram as plain text and replace the element — after which nothing
 * downstream could tell a diagram from a code block ever again.
 *
 * Running first, this plugin swaps the whole `<pre>` for a single
 * `<mermaid-chart data-mermaid="…">`, which is both invisible to Shiki and a tag
 * name `react-markdown` can map straight to a component.
 */

import { toString } from "hast-util-to-string";
import type rehypeSlug from "rehype-slug";

/*
 * `hast`'s types live in `@types/hast`, which is a transitive dependency and so
 * is not resolvable from application code under pnpm's isolated layout. These
 * aliases recover the real types — not a hand-written approximation — by
 * reading them back off the signature of a hast plugin we do depend on.
 */
type HastTransform = ReturnType<typeof rehypeSlug>;

export type Root = Parameters<HastTransform>[0];
export type RootContent = Root["children"][number];
export type Element = Extract<RootContent, { type: "element" }>;

/** The class `mdast-util-to-hast` puts on a ` ```mermaid ` fence. */
const MERMAID_CLASS = "language-mermaid";

/**
 * Replace every Mermaid code fence with a `<mermaid-chart>` element carrying the
 * diagram source in `data-mermaid`.
 */
export default function rehypeMermaidPlaceholder(): (tree: Root) => undefined {
  return function transform(tree: Root): undefined {
    replaceMermaidBlocks(tree.children);
  };
}

/**
 * Walk a child list, substituting Mermaid `<pre>`s in place and recursing into
 * everything else. Iterative over siblings, recursive over depth — a `<pre>` can
 * sit inside a `<details>`, a list item, or a blockquote.
 */
function replaceMermaidBlocks(nodes: RootContent[]): undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type !== "element") continue;

    const chart = readMermaidSource(node);

    if (chart === undefined) {
      replaceMermaidBlocks(node.children);
      continue;
    }

    nodes[index] = {
      type: "element",
      tagName: "mermaid-chart",
      properties: { dataMermaid: chart },
      children: [],
    };
  }
}

/**
 * The diagram source held by `element`, or `undefined` if it is not a Mermaid
 * code block.
 *
 * An empty fence yields `undefined` too: there is no diagram to draw, and a
 * plain empty code block is a more honest thing to show than a failed render.
 */
function readMermaidSource(element: Element): string | undefined {
  if (element.tagName !== "pre") return undefined;

  const code = element.children.find(
    (child): child is Element => child.type === "element",
  );
  if (!code || code.tagName !== "code") return undefined;

  const classNames = code.properties.className;
  const isMermaid = Array.isArray(classNames)
    ? classNames.includes(MERMAID_CLASS)
    : classNames === MERMAID_CLASS;
  if (!isMermaid) return undefined;

  // `mdast-util-to-hast` appends a newline to every code block; Mermaid is
  // whitespace-sensitive enough that it is worth not handing it trailing blanks.
  const chart = toString(code).replace(/\s+$/, "");
  return chart === "" ? undefined : chart;
}
