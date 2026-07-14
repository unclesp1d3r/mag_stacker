"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./button";

/**
 * Accessible destructive-action confirmation (replaces native `confirm()`).
 *
 * Matches the app's modal vocabulary (fixed overlay + raised panel), and hardens
 * the keyboard path: `role="alertdialog"`, focus moves to the *non-destructive*
 * Cancel on open, Tab is trapped within the panel, Escape and backdrop click
 * cancel, and focus returns to the trigger on close. The destructive control
 * uses the shared `destructive` button so it reads consistently with row actions.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  /**
   * Disables the confirm control independent of `pending` — for a type-to-confirm
   * guard (e.g. the backup force-replace phrase, R7) where confirmation should stay
   * unavailable until the operator has proven intent, not just while an operation
   * is in flight.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  pendingLabel = "Deleting…",
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Initial focus on the safe action; restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, [open]);

  // Escape cancels; Tab is trapped within the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal is a convenience; Escape and Cancel are the primary paths.
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/30 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-pop)]"
      >
        <h2
          id={titleId}
          className="text-pretty text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-1.5 text-sm text-ink-soft">
            {description}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
