"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/feedback";
import type { ShareGrant } from "./actions";

interface GrantsListProps {
  grants: ShareGrant[];
  onRevoke: (granteeId: string) => void;
  pending: boolean;
}

export function GrantsList({ grants, onRevoke, pending }: GrantsListProps) {
  /**
   * Revoking is destructive and was firing straight off the click — the only
   * destructive action in the app without a confirm step. It doesn't go through
   * `useDeleteConfirmation` because that hook owns toasting and refreshing,
   * which `ShareControl` already does for this action; all that's missing here
   * is the confirm gate, so this holds just the pending target.
   */
  const [confirming, setConfirming] = useState<ShareGrant | null>(null);
  if (grants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not shared with anyone yet.
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2">
        {grants.map((grant) => (
          <li
            key={grant.granteeId}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-foreground">
                {grant.granteeEmail}
              </p>
              <div className="mt-1 flex gap-1">
                <Badge
                  tone={grant.permission === "edit" ? "primary" : "neutral"}
                >
                  {grant.permission}
                </Badge>
                {grant.allowCreateOnBehalf ? (
                  <Badge tone="ok">can add</Badge>
                ) : null}
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(grant)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirming !== null}
        title="Revoke access?"
        description={
          confirming
            ? `${confirming.granteeEmail} will immediately lose access to this item.`
            : ""
        }
        confirmLabel="Revoke"
        pending={pending}
        pendingLabel="Revoking…"
        onConfirm={() => {
          if (confirming) onRevoke(confirming.granteeId);
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
