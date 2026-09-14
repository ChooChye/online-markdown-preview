import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";

/**
 * Site footer. Server Component — no state, no interactivity.
 *
 * Sits under the viewer on every route, so it is deliberately thin: one line of
 * small muted type, minimal vertical padding, nothing that competes with the
 * document being read.
 */
export function Footer() {
  return (
    <footer className="border-border text-fg-muted border-t px-4 py-3 text-xs">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-fg font-medium">{SITE_NAME}</span>
        <span aria-hidden="true" className="opacity-40">
          ·
        </span>
        <span>Runs entirely in your browser.</span>
        <Link
          href="/privacy"
          className="hover:text-fg focus-visible:outline-accent decoration-border ml-auto rounded-sm underline underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Privacy
        </Link>
      </div>
    </footer>
  );
}
