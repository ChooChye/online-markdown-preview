"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { Dropzone, useWindowFileIntake } from "@/components/dropzone";
import { FrontmatterCard } from "@/components/frontmatter-card";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { RemoteImageBar, RemoteImageProvider } from "@/components/remote-image-gate";
import { TocSidebar } from "@/components/toc-sidebar";
import { ViewerHeader, viewerPanelId, viewerTabId } from "@/components/viewer-header";
import { isEditableEventTarget, type IntakeResult } from "@/lib/file";
import { parseFrontmatter, type ParsedFrontmatter } from "@/lib/markdown/frontmatter";
import type { FileRejection, LoadedDocument, ViewMode } from "@/lib/types";

/** Stands in while no document is open, so the parse memo can stay unconditional. */
const EMPTY_PARSE: ParsedFrontmatter = { data: null, body: "" };

/**
 * The composition root. Every piece of application state lives here and nowhere
 * else; everything below is presentational.
 *
 * The document is held in `useState` and only there. No localStorage, no
 * sessionStorage, no IndexedDB — a reload must land the user back on an empty
 * dropzone, because "nothing is kept" is the product.
 */
export function Viewer() {
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [error, setError] = useState<FileRejection | null>(null);
  /** Quiet aside about how the document arrived. Never an error. */
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);

  const announcementSeq = useRef(0);
  const articleRef = useRef<HTMLElement | null>(null);

  const announce = useCallback((text: string): void => {
    // The id keys the paragraph inside a permanently-mounted live region, so
    // even a repeated message is re-announced.
    announcementSeq.current += 1;
    setAnnouncement({ id: announcementSeq.current, text });
  }, []);

  const openDocument = useCallback(
    (next: LoadedDocument, note?: string | null): void => {
      setDoc(next);
      setMode("preview");
      setError(null);
      setNotice(note ?? null);
      announce(note ? `${next.name} loaded. ${note}` : `${next.name} loaded`);
    },
    [announce],
  );

  const closeDocument = useCallback((): void => {
    setDoc(null);
    setMode("preview");
    setError(null);
    setNotice(null);
    announce("Document closed. Ready for another file.");
  }, [announce]);

  const dismissError = useCallback((): void => setError(null), []);
  const dismissNotice = useCallback((): void => setNotice(null), []);

  const handleIntake = useCallback(
    (result: IntakeResult): void => {
      if (result.status === "ignored") return;
      if (result.status === "rejected") {
        setError(result.rejection);
        setNotice(null);
        return;
      }
      openDocument(result.doc, result.note);
    },
    [openDocument],
  );

  // While a document is open the dropzone is gone, so the viewer itself takes
  // over drop and paste: a new file replaces the old one without closing first.
  const isDragging = useWindowFileIntake({ onIntake: handleIntake, enabled: doc !== null });

  useEffect(() => {
    if (!doc) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableEventTarget(event.target)) return;
      closeDocument();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [doc, closeDocument]);

  // `doc` is immutable and replaced wholesale, so depending on the object is
  // exactly as tight as depending on `doc.raw` — and keeps the lint rule honest.
  const { data: frontmatter, body } = useMemo(
    () => (doc ? parseFrontmatter(doc.raw) : EMPTY_PARSE),
    [doc],
  );

  const liveRegion = (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement ? <p key={announcement.id}>{announcement.text}</p> : null}
    </div>
  );

  if (!doc) {
    return (
      <div className="flex flex-1 flex-col">
        {liveRegion}
        <Dropzone
          onDocument={openDocument}
          onReject={setError}
          error={error}
          onDismissError={dismissError}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {liveRegion}

      <DocumentErrorBoundary key={doc.loadedAt} fileName={doc.name} onReset={closeDocument}>
        <RemoteImageProvider key={doc.loadedAt}>
          <ViewerHeader doc={doc} mode={mode} onModeChange={setMode} onClose={closeDocument} />
          <RemoteImageBar />

          {error ? (
            <div
              role="alert"
              className="border-danger/40 bg-canvas-subtle mx-auto mt-3 flex w-full max-w-6xl items-start gap-4 rounded-xl border px-4 py-3"
            >
              <p className="text-danger min-w-0 flex-1 text-sm leading-relaxed">{error.message}</p>
              <DismissButton onClick={dismissError} />
            </div>
          ) : null}

          {notice && !error ? (
            <div className="mx-auto mt-3 flex w-full max-w-6xl items-start gap-4 px-4">
              <p className="text-fg-muted min-w-0 flex-1 text-xs leading-relaxed">{notice}</p>
              <DismissButton onClick={dismissNotice} />
            </div>
          ) : null}

          <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 lg:gap-10">
            {mode === "preview" ? (
              <TocSidebar containerRef={articleRef} contentKey={doc.loadedAt} />
            ) : null}

            <main className="min-w-0 flex-1 py-8">
              {/*
                Both panes stay mounted. Switching to Raw and back must not make
                Shiki re-highlight the whole document.
              */}
              <div
                id={viewerPanelId("preview")}
                role="tabpanel"
                aria-labelledby={viewerTabId("preview")}
                hidden={mode !== "preview"}
              >
                <FrontmatterCard data={frontmatter} />
                <article ref={articleRef} className="markdown-body">
                  <MarkdownRenderer markdown={body} />
                </article>
              </div>

              <pre
                id={viewerPanelId("raw")}
                role="tabpanel"
                aria-labelledby={viewerTabId("raw")}
                tabIndex={0}
                hidden={mode !== "raw"}
                className="text-fg focus-visible:outline-accent text-sm leading-relaxed break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-offset-4 font-[family-name:var(--font-geist-mono)]"
              >
                {doc.raw}
              </pre>
            </main>
          </div>
        </RemoteImageProvider>
      </DocumentErrorBoundary>

      {isDragging ? (
        <div className="bg-canvas/85 pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
          <p className="border-accent text-fg rounded-2xl border-2 border-dashed px-8 py-6 text-center text-base font-medium">
            Drop to open it here — this replaces “{doc.name}”.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-fg-muted hover:text-fg focus-visible:outline-accent shrink-0 rounded text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      Dismiss
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Error boundary                                                             */
/* -------------------------------------------------------------------------- */

interface DocumentErrorBoundaryProps {
  fileName: string;
  onReset: () => void;
  children: ReactNode;
}

interface DocumentErrorBoundaryState {
  failed: boolean;
}

/**
 * The single class component in the app: React still has no hook equivalent for
 * `getDerivedStateFromError`. Keeps one malformed document — a pathological
 * table, a broken diagram, a renderer edge case — from white-screening the app.
 *
 * Keyed on `doc.loadedAt` by its parent, so the next document always starts from
 * a clean boundary.
 */
class DocumentErrorBoundary extends Component<
  DocumentErrorBoundaryProps,
  DocumentErrorBoundaryState
> {
  state: DocumentErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DocumentErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never swallowed: whoever hits this needs a stack to report.
    console.error(
      `[markdown-preview] rendering “${this.props.fileName}” failed`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h2 className="text-fg text-lg font-medium">This document couldn’t be rendered</h2>
        <p className="text-fg-muted mt-3 text-sm leading-relaxed">
          Something in “{this.props.fileName}” broke the renderer. Nothing left this browser — the
          file was never uploaded, and it is gone from memory now.
        </p>
        <p className="text-fg-muted mt-2 text-xs">
          The details are in your browser’s developer console.
        </p>
        <button
          type="button"
          onClick={this.props.onReset}
          className="border-border text-fg hover:bg-canvas-inset focus-visible:outline-accent mt-6 rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Try another file
        </button>
      </main>
    );
  }
}
