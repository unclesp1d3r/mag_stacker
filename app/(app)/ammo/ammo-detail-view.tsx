"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DetailRow, orDash } from "@/components/ui/detail-row";
import { Badge } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { Data } from "@/components/ui/typography";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import type { Permission } from "@/src/auth/visibility";
import { isLowStock } from "@/src/domain/ammo/validate";
import { deleteAmmoAction } from "./actions";
import { AmmoForm, type AmmoFormValues, lotDisplayName } from "./ammo-form";

export interface AmmoDetail extends AmmoFormValues {
  id: string;
}

interface AmmoDetailViewProps {
  ammo: AmmoDetail;
  permission: Permission;
  caliberSuggestions: string[];
}

export function AmmoDetailView({
  ammo,
  permission,
  caliberSuggestions,
}: AmmoDetailViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Ammo is edit-capable-shareable like firearms (not owner-only like
  // magazines): ownership and edit rights both derive from the server-resolved
  // permission — the single source of truth (ammo plan KTD4).
  const isOwner = permission === "owner";
  const canEdit = permission === "owner" || permission === "edit";
  const del = useDeleteConfirmation<AmmoDetail>({
    entityLabel: "Lot",
    getName: lotDisplayName,
    remove: deleteAmmoAction,
    redirectTo: "/ammo",
  });

  // Move focus to the heading on mount so a client navigation (or a browser
  // reload landing here) announces the new page to a screen reader (R16).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const displayName = lotDisplayName(ammo);
  const low = isLowStock({
    quantityRounds: Number(ammo.quantityRounds),
    lowStockThreshold: Number(ammo.lowStockThreshold),
  });

  return (
    <div className="space-y-6">
      <Link
        href="/ammo"
        className="inline-block text-sm font-medium text-primary hover:underline"
      >
        ← Ammo
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 space-y-1">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-pretty wrap-break-word text-[1.75rem] font-bold leading-none tracking-[-0.02em] text-foreground outline-none"
          >
            {displayName}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {low ? <Badge tone="destructive">Low stock</Badge> : null}
            {!isOwner ? (
              <Badge tone="primary">Shared with you · {permission}</Badge>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            <ShareControl
              parentType="ammo"
              parentId={ammo.id}
              itemName={displayName}
            />
          ) : null}
          {canEdit && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => del.request(ammo)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {editing ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            Edit lot
          </h2>
          <AmmoForm
            initial={ammo}
            caliberSuggestions={caliberSuggestions}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <Card>
          <dl>
            <DetailRow label="Brand" value={orDash(ammo.brand)} />
            <DetailRow label="Caliber" value={ammo.caliber} />
            <DetailRow label="Load type" value={orDash(ammo.type)} />
            <DetailRow label="Grain" value={<Data>{ammo.grain}</Data>} />
            <DetailRow
              label="Quantity (rounds)"
              value={<Data>{ammo.quantityRounds}</Data>}
            />
            <DetailRow
              label="Low-stock threshold"
              value={<Data>{ammo.lowStockThreshold}</Data>}
            />
            <DetailRow
              label="Acquired date"
              value={orDash(ammo.acquiredDate)}
            />
            <DetailRow
              label="Notes"
              value={
                ammo.notes.trim() !== "" ? (
                  <span className="whitespace-pre-wrap">{ammo.notes}</span>
                ) : (
                  orDash("")
                )
              }
            />
          </dl>
        </Card>
      )}

      {/* Ammo is deliberately excluded from inventory_log (see the
          `inventory_log_parent_type_valid` CHECK and ammo plan U4 notes) — no
          InventoryLogHistory here, unlike firearm/magazine detail views. */}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${displayName}”?`}
        description="This removes the lot from your inventory and can't be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
