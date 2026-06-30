"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";

/**
 * The "readout" — machined completion feedback (delight through craft, U-wide).
 *
 * Product register: delight belongs to moments, not pages. Successful mutations
 * used to land silently; this confirms them like an instrument readout — a lit
 * status pip, the action stated plainly, a mono sub-line for the specifics.
 * Motion conveys state (something just happened) and settles fast (ease-out
 * expo, ~220ms). a11y is built in, not bolted on: the region is an `aria-live`
 * status, every toast is keyboard-dismissable, and the timed auto-dismiss is
 * never the only way to perceive the message.
 */

type ToastTone = "ok" | "blaze" | "danger" | "neutral";

interface ToastInput {
  message: string;
  /** Optional mono sub-line: the specific item, filename, or count detail. */
  detail?: string;
  tone?: ToastTone;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

interface ToastApi {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_MS: Record<ToastTone, number> = {
  ok: 4000,
  blaze: 4500,
  neutral: 4000,
  danger: 6500,
};

// Lit status pip — the gauge tells you which kind of event landed.
const PIP: Record<ToastTone, string> = {
  ok: "bg-[var(--ok)] shadow-[0_0_8px_var(--ok)]",
  blaze: "bg-blaze shadow-[var(--glow-blaze)]",
  danger: "bg-danger shadow-[0_0_8px_var(--danger)]",
  neutral: "bg-ink-faint",
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ message, detail, tone = "ok" }: ToastInput) => {
      const id = nextId.current++;
      setItems((current) => [...current, { id, message, detail, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[tone]),
      );
    },
    [dismiss],
  );

  // Clear any pending auto-dismiss timers if the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <output
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 pb-4 sm:items-end sm:px-6 sm:pb-6"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius)] border border-line-strong bg-paper-raised px-3.5 py-3 shadow-[var(--shadow-pop)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  PIP[item.tone],
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-ink">
                  {item.message}
                </p>
                {item.detail ? (
                  <p className="mt-0.5 truncate font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-faint">
                    {item.detail}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="-mr-1.5 -mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] text-ink-faint transition-colors hover:text-ink"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </output>
    </ToastContext.Provider>
  );
}
