"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Thin wrapper around next-themes so `app/layout.tsx` (a Server Component)
 * can mount a client-only provider without itself becoming a client module.
 *
 * `attribute="class"` writes `.dark` onto <html>, which is what the Tailwind v4
 * dark variant keys off. <html> already carries `suppressHydrationWarning`,
 * which the blocking inline script next-themes injects requires.
 *
 * A first visit lands on light regardless of the OS setting; `enableSystem` keeps
 * "follow the OS" available as the third state of the toggle for anyone who picks
 * it, and that choice is what persists.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
