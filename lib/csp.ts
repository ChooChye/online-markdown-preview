/**
 * The Content-Security-Policy, in one place so `next.config.ts` can serve it
 * and `/privacy` can show readers the exact policy their browser is enforcing.
 */

export interface CspDirective {
  name: string;
  value: string;
  /** Plain-English note rendered next to the directive on /privacy. */
  note?: string;
}

/** Production directives, in the order they are sent. */
export const CSP_DIRECTIVES: readonly CspDirective[] = [
  { name: "default-src", value: "'self'" },
  {
    name: "script-src",
    value: "'self' 'unsafe-inline'",
    note: "Covers Next.js's own inline bootstrap. Nothing from your document can reach a script context — every script tag, event handler, and javascript: URL is stripped before render.",
  },
  {
    name: "style-src",
    value: "'self' 'unsafe-inline'",
    note: "Syntax highlighting and math rendering emit inline styles.",
  },
  {
    name: "img-src",
    value: "'self' data: blob: https:",
    note: "Permissive by necessity: a header sent once cannot be loosened later when you choose to load a document's images. The blocking is done by the renderer instead — no remote image gets a src until you ask for it.",
  },
  { name: "font-src", value: "'self' data:" },
  {
    name: "connect-src",
    value: "'self'",
    note: "The one that matters. This page cannot open a network connection to any host but its own, so the document you are reading cannot be sent anywhere. The only same-origin call is the anonymous pageview count, which never sees your document.",
  },
  { name: "worker-src", value: "'self' blob:", note: "Diagram rendering." },
  { name: "object-src", value: "'none'" },
  { name: "base-uri", value: "'self'" },
  { name: "form-action", value: "'self'" },
  { name: "frame-ancestors", value: "'none'", note: "This page cannot be embedded in another site." },
  { name: "upgrade-insecure-requests", value: "" },
];

/** Serialize to a header value. Dev needs eval and a websocket for HMR. */
export function buildCsp(isDev: boolean): string {
  return CSP_DIRECTIVES.map(({ name, value }) => {
    let v = value;
    if (isDev && name === "script-src") v = `${v} 'unsafe-eval'`;
    if (isDev && name === "connect-src") v = `${v} ws: http://localhost:*`;
    return v ? `${name} ${v}` : name;
  }).join("; ");
}
