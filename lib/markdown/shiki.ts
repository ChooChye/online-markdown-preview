/**
 * The syntax highlighter.
 *
 * WHY THIS FILE IS SHAPED LIKE THIS
 * ---------------------------------
 * `react-markdown` runs its unified pipeline **synchronously** — it renders
 * during React's render phase, so a rehype plugin that returns a promise is
 * simply ignored. Shiki's own async conveniences (`lazy: true`, the bundled
 * `createHighlighter`) are therefore unusable here.
 *
 * The way out is to do all the awaiting *outside* the pipeline: the renderer
 * scans the document for fenced languages, loads them into a shared highlighter,
 * and only then hands that fully-loaded instance to the synchronous
 * `rehypeShikiFromHighlighter` from `@shikijs/rehype/core`. Everything exported
 * below exists to serve that sequence.
 *
 * ENGINE
 * ------
 * The JavaScript RegExp engine, not Oniguruma. No WebAssembly means no
 * `wasm-unsafe-eval` in the CSP and no extra network fetch — both of which
 * matter for a viewer whose entire claim is that nothing leaves the browser.
 */

import {
  createHighlighterCore,
  isSpecialLang,
  type DynamicImportLanguageRegistration,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

/** The two themes every code block is tokenised against. */
export const SHIKI_THEMES = {
  light: "github-light",
  dark: "github-dark",
} as const;

/**
 * Grammars loaded before the first paint, chosen to cover the overwhelming
 * majority of README code fences. Each is a dynamic import so the bundler keeps
 * them out of the initial chunk; `createHighlighterCore` awaits them all.
 *
 * Canonical ids only — Shiki registers each grammar's aliases automatically, so
 * `typescript` also answers to `ts`/`mts`/`cts`, and `bash` to `sh`/`shell`/`zsh`.
 *
 * Typed as `DynamicImportLanguageRegistration[]` rather than `LanguageInput[]`
 * so the code-splitting above is enforced rather than merely described:
 * `LanguageInput` also admits an eagerly-evaluated grammar object, which would
 * pull every one of these into the initial chunk without any type error.
 */
const EAGER_LANGUAGES: DynamicImportLanguageRegistration[] = [
  () => import("shiki/langs/typescript.mjs"),
  () => import("shiki/langs/tsx.mjs"),
  () => import("shiki/langs/javascript.mjs"),
  () => import("shiki/langs/jsx.mjs"),
  () => import("shiki/langs/json.mjs"),
  () => import("shiki/langs/bash.mjs"),
  () => import("shiki/langs/python.mjs"),
  () => import("shiki/langs/markdown.mjs"),
  () => import("shiki/langs/yaml.mjs"),
  () => import("shiki/langs/css.mjs"),
  () => import("shiki/langs/html.mjs"),
  () => import("shiki/langs/diff.mjs"),
];

/**
 * Fence languages that are never grammars.
 *
 * `mermaid` is intercepted by `rehype-mermaid-placeholder` and rendered as a
 * diagram; `math` is consumed by `rehype-katex`. Loading a grammar for either
 * would download a chunk that nothing ever tokenises.
 */
const NON_GRAMMAR_LANGUAGES = new Set(["mermaid", "math"]);

/** An opening or closing code fence, indented no more than three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/** The leading identifier of a fence info string: `ts`, `c++`, `objective-c`. */
const LANGUAGE_ID = /^[a-z0-9#+._-]+/i;

/**
 * The highlighter is a singleton. The *promise* is cached rather than the
 * resolved value so that concurrent callers during start-up share one
 * instantiation instead of racing to build several.
 */
let highlighterPromise: Promise<HighlighterCore> | null = null;

/** Lazily built index of every on-demand grammar Shiki ships. */
let languageRegistryPromise: Promise<Map<
  string,
  DynamicImportLanguageRegistration
>> | null = null;

/**
 * The shared highlighter, created on first use.
 *
 * Safe to call from anywhere, any number of times, concurrently. If creation
 * fails the cache is cleared so a later attempt can retry rather than being
 * stuck with a permanently rejected promise.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [githubLight, githubDark],
      langs: EAGER_LANGUAGES,
    }).catch((error: unknown) => {
      highlighterPromise = null;
      throw error;
    });
  }

  return highlighterPromise;
}

/**
 * Load any of `langs` the highlighter does not already have.
 *
 * Unknown ids are ignored in silence: a document is free to write
 * ` ```notalanguage ` and that is not an error worth surfacing to a reader.
 *
 * @returns `true` only when at least one *new* grammar was registered — the
 *   signal the renderer needs to know that re-running the pipeline will now
 *   produce different output.
 */
export async function ensureLanguages(langs: string[]): Promise<boolean> {
  if (langs.length === 0) return false;

  const highlighter = await getHighlighter();
  const loaded = new Set(highlighter.getLoadedLanguages());
  const missing = langs.filter(
    (id) => !loaded.has(id) && !isSpecialLang(id) && !NON_GRAMMAR_LANGUAGES.has(id),
  );
  if (missing.length === 0) return false;

  const registry = await getLanguageRegistry();

  const registrations = await Promise.all(
    missing.map(async (id) => {
      const load = registry.get(id);
      if (!load) return undefined;
      try {
        return (await load()).default;
      } catch (error) {
        // Not an unknown language — `registry.get` already answered that above.
        // Reaching here means a grammar Shiki ships failed to *arrive*: a stale
        // chunk after a deploy, or a network that dropped. The block degrades to
        // unhighlighted either way, but nothing else in the pipeline ever sees
        // this, so it is logged unconditionally: it is a failure that happens
        // against a real network and a dev-only log would never once fire.
        console.warn(`[markdown-preview] the “${id}” grammar failed to load`, error);
        return undefined;
      }
    }),
  );

  const resolved = registrations.filter(
    (registration): registration is LanguageRegistration[] =>
      registration !== undefined,
  );
  if (resolved.length === 0) return false;

  try {
    await highlighter.loadLanguage(...resolved);
  } catch (error) {
    console.warn("[markdown-preview] Shiki rejected a grammar", error);
    // Registration is sequential, so an id that landed before the throw is
    // usable now. Ask the highlighter instead of assuming none did: a blanket
    // `false` would suppress the re-render that applies the ones that worked.
    const registered = new Set(highlighter.getLoadedLanguages());
    return missing.some((id) => registered.has(id));
  }

  return true;
}

/**
 * Every language id fenced in `markdown`, lowercased and deduplicated.
 *
 * Tracks open and close fences so that a ` ``` ` *inside* a code block is not
 * mistaken for the start of a new one, and excludes the fence languages that
 * are handled by other plugins entirely.
 */
export function extractFenceLanguages(markdown: string): string[] {
  const languages = new Set<string>();
  const lines = markdown.split(/\r\n|[\n\r]/);

  /** The fence currently being scanned past, if any. */
  let open: { marker: string; length: number } | null = null;

  for (const line of lines) {
    const match = FENCE.exec(line);
    if (!match) continue;

    const run = match[1];
    const marker = run[0];
    const info = match[2];

    if (open) {
      // A closing fence uses the same character, is at least as long, and
      // carries no info string.
      if (marker === open.marker && run.length >= open.length && info.trim() === "") {
        open = null;
      }
      continue;
    }

    // CommonMark: a backtick fence's info string may not contain a backtick.
    if (marker === "`" && info.includes("`")) continue;

    open = { marker, length: run.length };

    const id = toLanguageId(info);
    if (id && !NON_GRAMMAR_LANGUAGES.has(id)) languages.add(id);
  }

  return [...languages];
}

/** The first identifier of a fence info string, or `""` for a bare fence. */
function toLanguageId(info: string): string {
  const match = LANGUAGE_ID.exec(info.trim());
  return match ? match[0].toLowerCase() : "";
}

/**
 * Shiki's full grammar index, as a `Map` so arbitrary strings from a document
 * can be looked up without asserting them into the bundle's key union.
 *
 * Imported dynamically: the index is a few tens of kilobytes of import thunks
 * and no document that fences only common languages ever needs it.
 */
function getLanguageRegistry(): Promise<
  Map<string, DynamicImportLanguageRegistration>
> {
  if (!languageRegistryPromise) {
    languageRegistryPromise = import("shiki/langs")
      .then(({ bundledLanguages }) => new Map(Object.entries(bundledLanguages)))
      .catch((error: unknown) => {
        languageRegistryPromise = null;
        throw error;
      });
  }

  return languageRegistryPromise;
}
