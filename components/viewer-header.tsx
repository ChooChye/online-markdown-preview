"use client";

import { useCallback, useRef } from "react";
import type { KeyboardEvent } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { formatBytes } from "@/lib/file";
import type { LoadedDocument, ViewMode } from "@/lib/types";

interface ViewModeOption {
  value: ViewMode;
  label: string;
}

const VIEW_MODES: readonly ViewModeOption[] = [
  { value: "preview", label: "Preview" },
  { value: "raw", label: "Raw" },
];

/** Shared with the viewer so the tabs and their panels can point at each other. */
export const viewerTabId = (mode: ViewMode): string => `viewer-tab-${mode}`;
export const viewerPanelId = (mode: ViewMode): string => `viewer-panel-${mode}`;

export interface ViewerHeaderProps {
  doc: LoadedDocument;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onClose: () => void;
}

/**
 * The one piece of chrome above an open document: what you are reading, which
 * pane you are in, and the way out.
 *
 * At 375px the size label is the only thing that drops; the mode control and the
 * close button stay put.
 */
export function ViewerHeader({ doc, mode, onModeChange, onClose }: ViewerHeaderProps) {
  const tabRefs = useRef<Partial<Record<ViewMode, HTMLButtonElement | null>>>({});

  /**
   * Arrow keys move between tabs and select as they go (the automatic-activation
   * tablist pattern), because switching panes here is instant and reversible.
   */
  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const current = VIEW_MODES.findIndex((option) => option.value === mode);
      let nextIndex: number;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (current + 1) % VIEW_MODES.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (current - 1 + VIEW_MODES.length) % VIEW_MODES.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = VIEW_MODES.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const next = VIEW_MODES[nextIndex];
      onModeChange(next.value);
      tabRefs.current[next.value]?.focus();
    },
    [mode, onModeChange],
  );

  return (
    <header className="bg-canvas/80 border-border sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <p className="text-fg truncate text-sm font-medium" title={doc.name}>
            {doc.name}
          </p>
          <span className="text-fg-muted hidden shrink-0 text-xs tabular-nums sm:inline">
            {formatBytes(doc.size)}
          </span>
        </div>

        <div
          role="tablist"
          aria-label="View mode"
          aria-orientation="horizontal"
          onKeyDown={handleTabKeyDown}
          className="border-border bg-canvas-inset flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5"
        >
          {VIEW_MODES.map((option) => {
            const selected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                id={viewerTabId(option.value)}
                aria-selected={selected}
                aria-controls={viewerPanelId(option.value)}
                tabIndex={selected ? 0 : -1}
                ref={(node) => {
                  tabRefs.current[option.value] = node;
                }}
                onClick={() => onModeChange(option.value)}
                className={[
                  "focus-visible:outline-accent rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1",
                  selected ? "bg-canvas text-fg shadow-sm" : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document"
            title="Close document (Esc)"
            className="text-fg-muted hover:text-fg hover:bg-canvas-inset focus-visible:outline-accent flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
