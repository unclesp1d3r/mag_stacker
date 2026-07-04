"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/src/domain/action-result";

interface DeleteConfirmation<T> {
  /** The item awaiting confirmation, or null when the dialog is closed. */
  target: T | null;
  /** Open the confirmation for an item. */
  request: (item: T) => void;
  /** Run the delete, toast the result, refresh, and close. */
  confirm: () => void;
  /** Dismiss without deleting. */
  cancel: () => void;
  pending: boolean;
}

/**
 * Shared "confirm, then delete" flow for an inventory row (magazines, firearms).
 * Pessimistic: runs the server action, toasts success/failure, then refreshes.
 * The view owns the dialog copy; this owns the state machine and side effects.
 */
export function useDeleteConfirmation<T extends { id: string }>({
  entityLabel,
  getName,
  remove,
  redirectTo,
}: {
  /** Capitalized noun for the success toast, e.g. "Magazine". */
  entityLabel: string;
  getName: (item: T) => string;
  remove: (id: string) => Promise<ActionResult>;
  /**
   * Where to go after a successful delete. Omitted on list views (stay and
   * refresh in place); set to the list path on a detail view, where the deleted
   * record's own page no longer exists.
   */
  redirectTo?: string;
}): DeleteConfirmation<T> {
  const router = useRouter();
  const { toast } = useToast();
  const [target, setTarget] = useState<T | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const item = target;
    if (!item) return;
    startTransition(async () => {
      const result = await remove(item.id);
      if (result.ok) {
        toast({
          message: `${entityLabel} removed`,
          detail: getName(item),
          tone: "neutral",
        });
        setTarget(null);
        // On a detail view the deleted record's page is gone — navigate to the
        // list. On a list view stay put and refresh in place.
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
        return;
      }
      toast({ message: result.error ?? "Could not delete.", tone: "danger" });
      setTarget(null);
    });
  }

  return {
    target,
    request: setTarget,
    confirm,
    cancel: () => setTarget(null),
    pending,
  };
}
