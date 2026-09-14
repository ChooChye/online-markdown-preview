"use client";

/**
 * The frontmatter block, shown above the document.
 *
 * Deliberately quiet: collapsed by default, muted, and never wider than the
 * prose it sits on top of. Frontmatter is metadata about the document, not part
 * of it, so it should be findable without ever competing for attention.
 */

import { useMemo } from "react";
import type { Frontmatter } from "@/lib/types";

/** Long values are clamped so one sprawling key cannot dominate the card. */
const MAX_VALUE_LENGTH = 240;

/** Stand-in for a key present but empty. */
const EMPTY_VALUE = "—";

/**
 * Stand-in for a value that cannot be written out at all — a YAML alias
 * pointing at one of its own ancestors. Named rather than shown as
 * {@link EMPTY_VALUE}, which would tell the reader their key was blank when in
 * fact it holds a structure this card cannot flatten.
 */
const CIRCULAR_VALUE = "(circular reference)";

export interface FrontmatterCardProps {
  data: Frontmatter;
}

export function FrontmatterCard({ data }: FrontmatterCardProps) {
  const entries = useMemo(
    () => (data ? Object.entries(data).map(([key, value]) => [key, formatValue(value)] as const) : []),
    [data],
  );

  if (entries.length === 0) return null;

  return (
    <details className="bg-canvas-subtle border-border group mb-6 rounded-md border text-sm">
      <summary className="text-fg-muted flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium select-none [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="text-fg-muted/60 inline-block text-[0.65em] transition-transform duration-150 group-open:rotate-90"
        >
          ▶
        </span>
        <span>Frontmatter</span>
        <span className="text-fg-muted/70 text-xs font-normal">
          {entries.length} {entries.length === 1 ? "key" : "keys"}
        </span>
      </summary>

      <div className="border-border overflow-x-auto border-t">
        <table className="w-full border-collapse text-left">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-border border-b last:border-b-0">
                <th
                  scope="row"
                  className="text-fg-muted w-1/3 min-w-32 px-3 py-1.5 align-top font-mono text-xs font-normal break-words"
                >
                  {key}
                </th>
                <td className="text-fg px-3 py-1.5 align-top break-words">
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Render a YAML value as a single readable line.
 *
 * Arrays are comma-joined, nested objects become compact JSON, and everything
 * is clamped. YAML anchors can produce a circular structure, so the stringify
 * is guarded rather than assumed to succeed.
 */
function formatValue(value: unknown): string {
  return clamp(stringifyValue(value));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;

  if (Array.isArray(value)) {
    const items = value.map((item) => stringifyValue(item)).filter((item) => item !== "");
    return items.length > 0 ? items.join(", ") : EMPTY_VALUE;
  }

  if (typeof value === "string") return value.trim() === "" ? EMPTY_VALUE : value;

  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? EMPTY_VALUE;
    } catch {
      // Circular reference, most likely from a YAML alias pointing at an ancestor.
      return CIRCULAR_VALUE;
    }
  }

  return String(value);
}

function clamp(value: string): string {
  return value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}…`
    : value;
}
