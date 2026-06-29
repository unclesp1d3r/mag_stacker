"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "./cn";

type Choice = "light" | "dark" | "system";

const SUN =
  "M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z";
const MOON = "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z";
const AUTO = "M12 3a9 9 0 0 0 0 18V3Z";

const ICON: Record<Choice, string> = { light: SUN, dark: MOON, system: AUTO };
const NEXT: Record<Choice, Choice> = {
  light: "dark",
  dark: "system",
  system: "light",
};
const LABEL: Record<Choice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Cycles theme Light → Dark → System. The icon swaps with a small rotate +
 * crossfade (Motion) — an engineered touch, not bounce. Renders nothing until
 * mounted to avoid a hydration mismatch on the theme attribute.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = (mounted ? (theme as Choice) : "system") ?? "system";

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[current])}
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[NEXT[current]]}.`}
      title={`Theme: ${LABEL[current]}`}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-[var(--radius)] border border-line-strong",
        "bg-paper-raised text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={current}
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <path d={ICON[current]} />
        </motion.svg>
      </AnimatePresence>
    </button>
  );
}
