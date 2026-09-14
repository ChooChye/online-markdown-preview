/** Hard limits and shared copy. Single source of truth. */

/** Only real markdown files. Everything else is refused with a clear message. */
export const ACCEPTED_EXTENSIONS = [".md"] as const;

/** MIME types the OS may report for a .md file; used to hint the file picker. */
export const ACCEPT_ATTRIBUTE = ".md,text/markdown";

/** Above this, rendering (especially Mermaid) janks the main thread. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const MAX_FILE_LABEL = "2 MB";

/** Shown under the dropzone. The whole pitch in one line. */
export const PRIVACY_TAGLINE = "Your file never leaves this browser.";

export const SITE_NAME = "Markdown Preview";

export const SITE_DESCRIPTION =
  "Drop a markdown file and read it rendered. Everything happens in your browser — the file is never uploaded.";
