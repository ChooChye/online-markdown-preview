/**
 * Shared contracts for the viewer. Every module codes against these shapes.
 * Do not redefine these types locally — import from here.
 */

/** Parsed YAML frontmatter. `null` when the document has none. */
export type Frontmatter = Record<string, unknown> | null;

/** A document currently open in the viewer. Exactly one at a time. */
export interface LoadedDocument {
  /** Display name: the file name, or "Pasted document" for clipboard input. */
  name: string;
  /** How it arrived. */
  source: "file" | "paste";
  /** Full original text, frontmatter included. Shown verbatim in Raw mode. */
  raw: string;
  /** Byte length of `raw`. */
  size: number;
  /** Epoch ms, for React keys and remounts. */
  loadedAt: number;
}

/** A heading scraped from the rendered DOM, used by the TOC. */
export interface Heading {
  /** `id` attribute placed by rehype-slug. */
  id: string;
  /** Visible text content. */
  text: string;
  /** 1 for h1 … 6 for h6. */
  depth: number;
}

/** Which pane the viewer is showing. */
export type ViewMode = "preview" | "raw";

/** Why a dropped file was refused. */
export type RejectionReason = "extension" | "size" | "empty" | "read-error";

export interface FileRejection {
  reason: RejectionReason;
  /** User-facing sentence, already written for display. */
  message: string;
}
