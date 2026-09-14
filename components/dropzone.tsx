"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { ACCEPT_ATTRIBUTE, MAX_FILE_LABEL, PRIVACY_TAGLINE } from "@/lib/constants";
import {
  ACCEPTED_EXTENSIONS_LABEL,
  intakeFromClipboard,
  intakeFromDrop,
  intakeFromFiles,
  isEditableEventTarget,
  type IntakeResult,
} from "@/lib/file";
import type { FileRejection, LoadedDocument } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Window-level drop + paste intake                                           */
/* -------------------------------------------------------------------------- */

export interface WindowFileIntakeOptions {
  /** Called once per drop or paste that carried something worth acting on. */
  onIntake: (result: IntakeResult) => void;
  /** Listen only while this is true. Two consumers must never both be enabled. */
  enabled?: boolean;
}

/**
 * Makes the whole window a drop target and a paste target, and reports whether
 * a file is currently being dragged over it.
 *
 * It lives at the window rather than on the drop target itself for one reason
 * that matters here: a file dropped anywhere else on the page makes the browser
 * navigate to it, which would silently throw away the document the user is
 * reading. The default is cancelled everywhere, always.
 *
 * Drag state is tracked with an enter/leave counter so moving across child
 * elements inside the target doesn't flicker the highlight off and on.
 *
 * Exported from this file — rather than a hook module of its own — so the
 * dropzone and the open-document view share one definition of "the user handed
 * us a file".
 */
export function useWindowFileIntake({ onIntake, enabled = true }: WindowFileIntakeOptions): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const handler = useRef(onIntake);

  useEffect(() => {
    handler.current = onIntake;
  }, [onIntake]);

  useEffect(() => {
    if (!enabled) return;

    const carriesFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const handleDragEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      dragDepth.current += 1;
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent): void => {
      // Unconditional: cancelling the default is what stops a stray drop from
      // navigating the tab away from the open document.
      event.preventDefault();
      if (carriesFiles(event) && event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };

    const handleDrop = (event: DragEvent): void => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (!carriesFiles(event)) return;
      void intakeFromDrop(event.dataTransfer).then((result) => handler.current(result));
    };

    const handlePaste = (event: ClipboardEvent): void => {
      if (isEditableEventTarget(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;
      if (data.files.length === 0 && data.getData("text/plain").length === 0) return;
      event.preventDefault();
      void intakeFromClipboard(data).then((result) => handler.current(result));
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
      window.removeEventListener("paste", handlePaste);
      dragDepth.current = 0;
      setIsDragging(false);
    };
  }, [enabled]);

  return enabled && isDragging;
}

/* -------------------------------------------------------------------------- */
/* Dropzone                                                                   */
/* -------------------------------------------------------------------------- */

export interface DropzoneProps {
  /**
   * A document the user successfully opened. `note` carries a quiet aside — the
   * one case today is "you dropped four files, I opened the first Markdown one".
   */
  onDocument: (doc: LoadedDocument, note?: string | null) => void;
  /** A file that was refused. The parent owns the message it hands back as `error`. */
  onReject: (rejection: FileRejection) => void;
  /** The standing rejection to show, or `null`. */
  error: FileRejection | null;
  onDismissError: () => void;
}

/**
 * The empty state, which is also the entire landing page. First thing every
 * visitor sees, so: one target, one instruction, one quiet privacy line.
 */
export function Dropzone({ onDocument, onReject, error, onDismissError }: DropzoneProps) {
  const targetTextId = useId();
  const hintId = useId();

  const handleIntake = useCallback(
    (result: IntakeResult): void => {
      if (result.status === "ignored") return;
      if (result.status === "rejected") {
        onReject(result.rejection);
        return;
      }
      onDocument(result.doc, result.note);
    },
    [onDocument, onReject],
  );

  const isDragging = useWindowFileIntake({ onIntake: handleIntake });

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = Array.from(event.target.files ?? []);
      // Clear it so choosing the same file twice in a row still fires `change`.
      event.target.value = "";
      if (files.length === 0) return;
      void intakeFromFiles(files).then(handleIntake);
    },
    [handleIntake],
  );

  // Escape clears a standing rejection, so the keyboard alone can get back to a
  // clean slate without hunting for the dismiss button.
  useEffect(() => {
    if (!error) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) onDismissError();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [error, onDismissError]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16">
      {/*
        `mx-auto`/`my-auto` centre this box on their own, without relying on the
        parent's `items-center`/`justify-center`. Belt and braces on purpose: a
        `max-w-*` block centred by auto margins stays centred even if the parent
        resolves to `display: block`, or to a flex container whose `align-items`
        falls back to `stretch` — both of which pin the box to the top-left and
        look like a broken layout rather than a missing utility.
      */}
      <div className="mx-auto my-auto w-full max-w-xl">
        {/*
          The label is the target; the file input inside it is visually hidden
          but still focusable, so the browser gives us the click, the Enter/Space
          activation and the correct "opens a file dialog" semantics for free.
          The association is implicit (wrapping) rather than `htmlFor` — one
          association, so there is no way for a click to activate the picker twice.
        */}
        <label
          className={[
            "relative flex w-full cursor-pointer flex-col items-center justify-center gap-4",
            "rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors sm:py-20",
            "focus-within:outline-accent focus-within:outline-2 focus-within:outline-offset-4",
            isDragging
              ? "border-accent bg-canvas-inset"
              : "border-border bg-canvas-subtle hover:border-accent",
          ].join(" ")}
        >
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            onChange={handleInputChange}
            aria-label="Choose a Markdown file"
            aria-describedby={`${targetTextId} ${hintId}`}
            className="sr-only"
          />

          <DocumentIcon className={isDragging ? "text-accent h-10 w-10" : "text-fg-muted h-10 w-10"} />

          <span id={targetTextId} className="flex flex-col items-center gap-1.5">
            <span className="text-fg text-base font-medium">
              {isDragging ? "Drop to open it" : "Drop a Markdown file here"}
            </span>
            <span className="text-fg-muted text-sm">or click to choose one from your computer</span>
          </span>
        </label>

        {error ? (
          <div
            role="alert"
            className="border-danger/40 bg-canvas-subtle mt-4 flex items-start gap-4 rounded-xl border px-4 py-3"
          >
            <p className="text-danger min-w-0 flex-1 text-sm leading-relaxed">{error.message}</p>
            <button
              type="button"
              onClick={onDismissError}
              className="text-fg-muted hover:text-fg focus-visible:outline-accent shrink-0 rounded text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div id={hintId} className="mt-8 flex flex-col items-center gap-2 text-center">
          <p className="text-fg-muted text-sm">
            You can also paste Markdown from your clipboard, anywhere on this page.
          </p>
          <p className="text-fg-muted text-sm">{PRIVACY_TAGLINE}</p>
          <p className="text-fg-muted text-xs">
            {ACCEPTED_EXTENSIONS_LABEL} files only · up to {MAX_FILE_LABEL}
          </p>
        </div>
      </div>
    </main>
  );
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M19 8.5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6.5z" />
      <path d="M12 11v5.5" />
      <path d="m9.75 14.25 2.25 2.25 2.25-2.25" />
    </svg>
  );
}
