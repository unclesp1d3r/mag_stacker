"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider (next-themes). Drives `data-theme` on <html>, detects the OS
 * preference, persists the user's choice, and injects a blocking script so the
 * theme is correct before first paint. Default is "system" — a dark-OS user
 * gets the Field Console automatically.
 *
 * `MotionConfig reducedMotion="user"` makes every Motion animation (toast
 * entrance, theme-toggle icon) honor `prefers-reduced-motion` — transforms drop
 * to instant, opacity crossfades remain. CSS animations are handled separately
 * by the reduced-motion rule in globals.css.
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
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemeProvider>
  );
}
