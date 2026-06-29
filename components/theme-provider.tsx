"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider (next-themes). Drives `data-theme` on <html>, detects the OS
 * preference, persists the user's choice, and injects a blocking script so the
 * theme is correct before first paint. Default is "system" — a dark-OS user
 * gets the Field Console automatically.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark"]}
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
