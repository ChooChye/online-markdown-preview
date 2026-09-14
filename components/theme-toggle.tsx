"use client";

import { useSyncExternalStore } from "react";
import type { ReactElement, SVGProps } from "react";
import { useTheme } from "next-themes";

/** The three settings the button cycles through, in order. */
type ThemeSetting = "light" | "dark" | "system";

/** Clicking while on the key moves to the value. */
const NEXT_THEME: Record<ThemeSetting, ThemeSetting> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/** Header chrome gets the full square; the footer's one line of small type gets the compact one. */
type ToggleSize = "md" | "sm";

/** Square button edge, in Tailwind sizing units. The placeholder matches it exactly. */
const BUTTON_SIZE_CLASS: Record<ToggleSize, string> = {
  md: "size-9",
  sm: "size-7",
};

const ICON_SIZE_CLASS: Record<ToggleSize, string> = {
  md: "size-[18px]",
  sm: "size-[15px]",
};

const ICON_PROPS: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
};

function SunIcon({ className }: { className: string }): ReactElement {
  return (
    <svg {...ICON_PROPS} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M6.34 17.66l-1.41 1.41" />
      <path d="M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className: string }): ReactElement {
  return (
    <svg {...ICON_PROPS} className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function MonitorIcon({ className }: { className: string }): ReactElement {
  return (
    <svg {...ICON_PROPS} className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

const THEME_ICON: Record<ThemeSetting, (props: { className: string }) => ReactElement> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

function isThemeSetting(value: string | undefined): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * "Has this component hydrated yet?" as an external store rather than an effect.
 * The server snapshot is `false`, so SSR and the hydration render agree on the
 * placeholder; React then re-reads the client snapshot and swaps in the button.
 */
const subscribeToNothing = () => () => {};
const getMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

/**
 * Cycles light → dark → system. Reads `theme` (the stored *setting*) rather than
 * `resolvedTheme`, because the third state is "follow the OS" — a fact
 * `resolvedTheme` erases by collapsing it to light or dark.
 */
export function ThemeToggle({ size = "md" }: { size?: ToggleSize } = {}) {
  const { theme, setTheme } = useTheme();

  // `theme` is undefined during SSR and on the very first client render, so the
  // real button cannot be rendered yet without risking a hydration mismatch or a
  // wrong-icon flash. Hold the exact same box until the provider has read storage.
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getMountedSnapshot,
    getServerMountedSnapshot,
  );

  if (!mounted) {
    return <div className={BUTTON_SIZE_CLASS[size]} aria-hidden="true" />;
  }

  const current: ThemeSetting = isThemeSetting(theme) ? theme : "light";
  const next = NEXT_THEME[current];
  const label = `Theme: ${current}. Switch to ${next}.`;
  const Icon = THEME_ICON[current];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={`${BUTTON_SIZE_CLASS[size]} text-fg-muted hover:text-fg hover:bg-canvas-subtle border-border inline-flex cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current`}
    >
      <Icon className={ICON_SIZE_CLASS[size]} />
    </button>
  );
}
