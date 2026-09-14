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
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
