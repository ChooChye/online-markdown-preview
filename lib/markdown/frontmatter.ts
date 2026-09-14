/**
 * Frontmatter splitting.
 *
 * A leading `---` fence pair is peeled off the document, parsed as YAML, and
 * handed to the viewer separately so the body can be rendered on its own.
 *
 * Three properties matter more than completeness here:
 *
 * 1. Nothing throws. A viewer for arbitrary dropped files must survive garbage
 *    input; a broken fence just means "this document has no frontmatter".
 * 2. A leading `---` that is really a thematic break (no closing fence) stays in
 *    the body, exactly as remark would treat it.
 * 3. Malformed YAML leaves the document untouched. We would rather show the
 *    reader the bytes they opened than silently swallow a block we could not
 *    understand.
 */

import { parse as parseYaml } from "yaml";
import type { DocumentOptions, ParseOptions, SchemaOptions, ToJSOptions } from "yaml";
import type { Frontmatter } from "@/lib/types";

/** The exact option bag `yaml`'s `parse` accepts. */
type YamlParseOptions = ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions;

export interface ParsedFrontmatter {
  /** Parsed mapping, or `null` when absent, empty, malformed, or not a mapping. */
  data: Frontmatter;
  /** The document with a well-formed frontmatter block removed. */
  body: string;
}

/**
 * Byte-order mark some editors prepend to UTF-8 files. It is an encoding
 * artefact rather than content, and left in place it would stop the first line
 * from being recognised as either a fence or a heading, so it is always removed.
 */
const BYTE_ORDER_MARK = "﻿";

/** `---` on the very first line, trailing spaces tolerated. */
const OPENING_FENCE = /^-{3}[ \t]*\r?\n/;

/** `---` alone on a line, anywhere after the opening fence. */
const CLOSING_FENCE = /^-{3}[ \t]*(?:\r?\n|$)/gm;

/**
 * YAML parse settings.
 *
 * `core` is the YAML 1.2 core schema: strings, numbers, booleans, null, maps
 * and sequences. It carries no language-specific tags, so a hostile document
 * cannot reach a constructor the way `!!js/function` allows in other parsers.
 * `maxAliasCount` caps alias expansion (the "billion laughs" shape), and
 * `logLevel: "silent"` keeps a reader's typo out of their console.
 */
const YAML_OPTIONS = {
  schema: "core",
  version: "1.2",
  logLevel: "silent",
  prettyErrors: false,
  maxAliasCount: 100,
  // Duplicate keys are a warning-worthy mistake, not a reason to refuse to
  // render a document. Last one wins.
  uniqueKeys: false,
} as const satisfies YamlParseOptions;

/** Outcome of parsing the fenced region. */
type FenceResult =
  | { ok: true; data: Frontmatter }
  | { ok: false };

/**
 * Split a raw markdown document into its frontmatter and its body.
 *
 * Never throws. When there is no frontmatter — or the YAML inside the fence
 * cannot be parsed — the document is returned unchanged with `data: null`.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const source = raw.startsWith(BYTE_ORDER_MARK)
    ? raw.slice(BYTE_ORDER_MARK.length)
    : raw;

  const opening = OPENING_FENCE.exec(source);
  if (!opening) return { data: null, body: source };

  const fenceStart = opening[0].length;

  // Search for the closing fence from just after the opening one. Mutating
  // `lastIndex` is safe because the regex is module-private and reset below.
  CLOSING_FENCE.lastIndex = fenceStart;
  const closing = CLOSING_FENCE.exec(source);
  CLOSING_FENCE.lastIndex = 0;

  // No closing fence: the leading `---` is a thematic break. Leave it alone.
  if (!closing) return { data: null, body: source };

  const result = parseFence(source.slice(fenceStart, closing.index));

  // Unparseable YAML: keep the document whole rather than deleting a block the
  // reader may well want to see.
  if (!result.ok) return { data: null, body: source };

  return { data: result.data, body: source.slice(closing.index + closing[0].length) };
}

/**
 * Parse the fenced region.
 *
 * Yields `data: null` for an empty fence, and for a root-level sequence or
 * scalar — valid YAML, but not frontmatter any consumer can key into.
 */
function parseFence(yamlSource: string): FenceResult {
  if (yamlSource.trim() === "") return { ok: true, data: null };

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlSource, YAML_OPTIONS);
  } catch {
    return { ok: false };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: true, data: null };
  }

  const data = parsed as Record<string, unknown>;
  return { ok: true, data: Object.keys(data).length > 0 ? data : null };
}
