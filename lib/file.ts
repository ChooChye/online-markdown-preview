/**
 * Turning something the user handed us into a `LoadedDocument` — and nothing else.
 *
 * Every function here runs in the browser against a `File` or a `DataTransfer`
 * the user themselves produced. There is deliberately no `fetch`, no upload and
 * no persistence anywhere in this module: the text goes from the user's disk
 * into a React state variable and no further. Keep it that way.
 */

import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/constants";
import type { FileRejection, LoadedDocument } from "@/lib/types";

/** Display name for documents that arrived through the clipboard. */
const PASTED_DOCUMENT_NAME = "Pasted document";

/** `".md"` today — reads as `".md or .markdown"` if the accepted list ever grows. */
export const ACCEPTED_EXTENSIONS_LABEL = joinWithOr(ACCEPTED_EXTENSIONS);

function joinWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** 1024-based, to match `MAX_FILE_LABEL` ("2 MB" for 2 × 1024 × 1024 bytes). */
const BYTE_UNITS = ["KB", "MB", "GB"] as const;

/** Human-readable byte count: `0 B`, `812 B`, `4.2 KB`, `1.3 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // One decimal below 10 (4.2 KB), none above it (812 KB), never a bare ".0".
  const rounded = value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "");
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** Narrows the result of a read to the failure case. */
export function isRejection(value: LoadedDocument | FileRejection): value is FileRejection {
  return "reason" in value;
}

/** Lowercased extension including the dot, or `""` for `README` and `.gitignore`. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/** True when the name ends in an extension this viewer opens. */
export function hasAcceptedExtension(fileName: string): boolean {
  const extensions: readonly string[] = ACCEPTED_EXTENSIONS;
  return extensions.includes(extensionOf(fileName));
}

/** UTF-8 byte length, matching what `File.size` reports for a UTF-8 file. */
function byteLength(text: string): number {
  if (typeof TextEncoder === "undefined") return text.length;
  return new TextEncoder().encode(text).length;
}

/**
 * `subject` is already-quoted and sentence-initial, e.g. `“notes.md”` or
 * `The pasted text`.
 */
function rejectEmpty(subject: string, raw: string): FileRejection {
  return {
    reason: "empty",
    message:
      raw.length === 0
        ? `${subject} is empty — there is nothing to preview.`
        : `${subject} contains only blank space — there is nothing to preview.`,
  };
}

function rejectSize(subject: string, bytes: number): FileRejection {
  return {
    reason: "size",
    message: `${subject} is ${formatBytes(bytes)}, over the ${MAX_FILE_LABEL} limit. Documents that big stall the browser while they render.`,
  };
}

/**
 * Read a file the user picked, dropped or pasted.
 *
 * Checks run in the cheapest-first order — name, then size, then contents — so
 * a 4 GB video is refused without ever being read into memory. Every refusal
 * names the actual file and says what would have worked.
 */
export async function readMarkdownFile(file: File): Promise<LoadedDocument | FileRejection> {
  const subject = `“${file.name}”`;

  if (!hasAcceptedExtension(file.name)) {
    return {
      reason: "extension",
      message: `${subject} isn’t a ${ACCEPTED_EXTENSIONS_LABEL} file. This viewer opens Markdown files only.`,
    };
  }

  if (file.size > MAX_FILE_BYTES) {
    return rejectSize(subject, file.size);
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch (cause) {
    // Worth surfacing: this is usually a file that moved out from under the
    // picker, and the user can only fix it if they know it happened.
    console.error("[markdown-preview] could not read the selected file", cause);
    return {
      reason: "read-error",
      message: `Couldn’t read ${subject}. It may have been moved or renamed since you picked it — try choosing it again.`,
    };
  }

  if (raw.trim().length === 0) {
    return rejectEmpty(subject, raw);
  }

  return {
    name: file.name,
    source: "file",
    raw,
    size: file.size,
    loadedAt: Date.now(),
  };
}

/** Build a document out of Markdown pasted straight from the clipboard. */
export function documentFromPastedText(text: string): LoadedDocument | FileRejection {
  const subject = "The pasted text";
  const size = byteLength(text);

  if (size > MAX_FILE_BYTES) {
    return rejectSize(subject, size);
  }

  if (text.trim().length === 0) {
    return rejectEmpty(subject, text);
  }

  return {
    name: PASTED_DOCUMENT_NAME,
    source: "paste",
    raw: text,
    size,
    loadedAt: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Intake — the shared drop / paste / file-picker pipeline                     */
/* -------------------------------------------------------------------------- */

/**
 * The outcome of one drop, paste or file-picker selection. `ignored` covers the
 * everyday non-events — an empty clipboard, a drag that carried no files — that
 * must never produce an error message.
 */
export type IntakeResult =
  | { status: "loaded"; doc: LoadedDocument; note: string | null }
  | { status: "rejected"; rejection: FileRejection }
  | { status: "ignored" };

const IGNORED: IntakeResult = { status: "ignored" };

/**
 * Open one document out of a set of files. Several files at once is a normal
 * accident, so the first Markdown file wins and the rest are mentioned quietly
 * in `note`. If none qualify, the first file produces the extension rejection —
 * that way the message names something the user actually recognises.
 */
export async function intakeFromFiles(files: readonly File[]): Promise<IntakeResult> {
  if (files.length === 0) return IGNORED;

  const markdown = files.filter((file) => hasAcceptedExtension(file.name));
  const chosen = markdown.length > 0 ? markdown[0] : files[0];
  const ignoredCount = files.length - 1;
  const note =
    markdown.length > 0 && ignoredCount > 0
      ? `Opened “${chosen.name}” — ${ignoredCount} other ${ignoredCount === 1 ? "file was" : "files were"} ignored.`
      : null;

  const result = await readMarkdownFile(chosen);
  return isRejection(result)
    ? { status: "rejected", rejection: result }
    : { status: "loaded", doc: result, note };
}

/**
 * Files only. Dropping selected text or a link is ignored on purpose — the
 * clipboard is the path for loose text.
 *
 * A `DataTransfer` is emptied the moment its event handler returns, so the file
 * list is pulled out synchronously before the first `await`.
 */
export async function intakeFromDrop(transfer: DataTransfer | null): Promise<IntakeResult> {
  if (!transfer) return IGNORED;
  const files = Array.from(transfer.files);
  return intakeFromFiles(files);
}

/**
 * A pasted file if there is one, otherwise the plain text. Same synchronous-read
 * rule as {@link intakeFromDrop}.
 */
export async function intakeFromClipboard(transfer: DataTransfer | null): Promise<IntakeResult> {
  if (!transfer) return IGNORED;

  const files = Array.from(transfer.files);
  if (files.length > 0) return intakeFromFiles(files);

  const text = transfer.getData("text/plain");
  // Nothing on the clipboard at all is a non-event, not a mistake to report.
  if (text.length === 0) return IGNORED;

  const result = documentFromPastedText(text);
  return isRejection(result)
    ? { status: "rejected", rejection: result }
    : { status: "loaded", doc: result, note: null };
}

/**
 * True for anything the user could be typing into. Window-level paste handling
 * has to step aside for real form fields.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
