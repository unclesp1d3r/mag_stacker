"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import type { ShareGrant } from "./actions";

interface GrantsListProps {
  grants: ShareGrant[];
  onRevoke: (granteeId: string) => void;
  pending: boolean;
}

export function GrantsList({ grants, onRevoke, pending }: GrantsListProps) {
  if (grants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Not shared with anyone yet.
      </p>
    );
  }
  return (
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
              <Badge tone={grant.permission === "edit" ? "primary" : "neutral"}>
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
            onClick={() => onRevoke(grant.granteeId)}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
