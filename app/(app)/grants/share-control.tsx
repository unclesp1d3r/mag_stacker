"use client";

import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { Kicker } from "@/components/ui/typography";
import type { ParentType } from "@/src/auth/visibility";
import {
  loadShareState,
  revokeGrantAction,
  type ShareGrant,
  type ShareState,
  shareItemAction,
} from "./actions";
import { GrantsList } from "./grants-list";

interface ShareControlProps {
  parentType: ParentType;
  parentId: string;
  itemName: string;
}

/**
 * Owner-only share entry point (U16, F4/F5). Pick a grantee, a permission, and —
 * for edit grants — an "allow adding records owned by me" toggle (create-on-
 * behalf, KTD-5). Lists active grants with immediate revoke (R15).
 */
export function ShareControl({
  parentType,
  parentId,
  itemName,
}: ShareControlProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ShareState | null>(null);
  const [granteeId, setGranteeId] = useState("");
  const [permission, setPermission] = useState<"view" | "edit">("view");
  const [allowCreate, setAllowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState(false);
  /** True while `GrantsList`'s revoke confirmation is open — see the Escape handler. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const granteeSel = useId();
  const permSel = useId();
  const titleId = useId();

  const reload = useCallback(() => {
    startTransition(async () => {
      const result = await loadShareState(parentType, parentId);
      if (result.ok && result.data) setState(result.data);
      else
        setError(
          result.ok ? null : (result.error ?? "Could not load sharing."),
        );
    });
  }, [parentType, parentId]);

  useEffect(() => {
    if (open) {
      setError(null);
      reload();
    }
  }, [open, reload]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A nested revoke confirmation owns Escape while it is open; closing this
      // panel too would discard the whole sharing context over a cancel.
      if (e.key === "Escape" && !confirmOpen) setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirmOpen]);

  function onShare() {
    if (!granteeId) return;
    startTransition(async () => {
      const result = await shareItemAction(
        parentType,
        parentId,
        granteeId,
        permission,
        permission === "edit" ? allowCreate : false,
      );
      if (result.ok) {
        setGranteeId("");
        setAllowCreate(false);
        reload();
      } else {
        setError(result.error ?? "Could not share.");
      }
    });
  }

  /**
   * Returns whether the revoke succeeded so `GrantsList` can keep its
   * confirmation open (showing the error in place) instead of dismissing as
   * though the grant were gone. Not wrapped in `startTransition` because the
   * caller awaits this — a transition's callback cannot be awaited from outside,
   * so the pending flag is tracked explicitly instead.
   */
  async function onRevoke(targetGranteeId: string): Promise<boolean> {
    setRevoking(true);
    try {
      const result = await revokeGrantAction(
        parentType,
        parentId,
        targetGranteeId,
      );
      if (result.ok) {
        reload();
        return true;
      }
      setError(result.error ?? "Could not revoke.");
      return false;
    } finally {
      setRevoking(false);
    }
  }

  const grants: ShareGrant[] = state?.grants ?? [];
  const candidates = state?.candidates ?? [];
  // Magazine actions are owner-only (R13): editing is not shareable, so an
  // `edit` grant would be inert. Offer view-only for magazines. Firearms, ammo
  // and accessories are all edit-capable-shareable (ammo plan KTD4; #23 R7) —
  // an edit grant on any of them lets the grantee update the record.
  //
  // Deliberately an allowlist, not `!== "magazine"`: a parent type added later
  // must default to view-only until someone decides otherwise, rather than
  // silently becoming edit-shareable the moment it joins `ParentType`.
  const canGrantEdit =
    parentType === "firearm" ||
    parentType === "ammo" ||
    parentType === "accessory";

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Share
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/30 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-[var(--shadow-pop)]"
          >
            <h2
              id={titleId}
              className="text-base font-semibold text-foreground"
            >
              Share “{itemName}”
            </h2>
            <p className="mt-1 mb-4 text-xs text-ink-soft">
              Grant another user view or edit access to this item.
            </p>

            {error ? (
              <div className="mb-3">
                <Callout tone="destructive">{error}</Callout>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div>
                <label
                  htmlFor={granteeSel}
                  className="mb-1 block text-sm font-medium text-foreground"
                >
                  User
                </label>
                <Select
                  id={granteeSel}
                  value={granteeId}
                  onChange={(e) => setGranteeId(e.target.value)}
                >
                  <option value="">Select a user…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email}
                    </option>
                  ))}
                </Select>
              </div>
              {canGrantEdit ? (
                <div>
                  <label
                    htmlFor={permSel}
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    Permission
                  </label>
                  <Select
                    id={permSel}
                    value={permission}
                    onChange={(e) =>
                      setPermission(e.target.value as "view" | "edit")
                    }
                  >
                    <option value="view">View — can read</option>
                    <option value="edit">Edit — can read and modify</option>
                  </Select>
                </div>
              ) : (
                <p className="text-xs text-ink-soft">
                  Shared as{" "}
                  <span className="font-medium text-foreground">view</span> —
                  magazine editing stays with the owner.
                </p>
              )}
              {canGrantEdit && permission === "edit" ? (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={allowCreate}
                    onChange={(e) => setAllowCreate(e.target.checked)}
                  />
                  Allow adding records owned by me
                </label>
              ) : null}
              <Button onClick={onShare} disabled={pending || !granteeId}>
                {pending ? "Working…" : "Share"}
              </Button>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <Kicker as="h3" className="mb-2">
                Shared with
              </Kicker>
              <GrantsList
                grants={grants}
                onRevoke={onRevoke}
                pending={pending || revoking}
                onConfirmOpenChange={setConfirmOpen}
              />
            </div>

            <div className="mt-5 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
