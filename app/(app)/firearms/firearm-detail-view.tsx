"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import type { Permission } from "@/src/auth/visibility";
import {
  firearmActionLabel,
  firearmTypeLabel,
} from "@/src/domain/firearms/constants";
import { firearmDisplayName, hasNickname } from "@/src/domain/firearms/display";
import { InventoryLogHistory } from "../inventory-log/inventory-log-history";
import { type FirearmPhotoRow, FirearmPhotos } from "./[id]/firearm-photos";
import { deleteFirearmAction } from "./actions";
import { FirearmForm, type FirearmFormValues } from "./firearm-form";
import {
  MountedAccessories,
  type MountedAccessoryRow,
} from "./mounted-accessories";
import { RangeSessionHistory } from "./range-session-history";

export interface FirearmDetail extends FirearmFormValues {
  id: string;
}

interface FirearmDetailViewProps {
  firearm: FirearmDetail;
  permission: Permission;
  magazineCount: number;
  caliberSuggestions: string[];
  manufacturerSuggestions: string[];
  subtypeSuggestions: string[];
  mountedAccessories: MountedAccessoryRow[];
  /** Derived sum of the mounted accessories' `costCents` (null treated as 0); never stored (R11). */
  accessoryValueCents: number;
  /** Server-loaded via `listPhotos`, ordered by `sortOrder` ascending (U7). */
  photos: FirearmPhotoRow[];
}

/** One read-only label/value row. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 wrap-break-word text-sm text-foreground">
        {value}
      </dd>
    </div>
  );
}

function orDash(value: string): ReactNode {
  return value.trim() !== "" ? (
    value
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function FirearmDetailView({
  firearm,
  permission,
  magazineCount,
  caliberSuggestions,
  manufacturerSuggestions,
  subtypeSuggestions,
  mountedAccessories,
  accessoryValueCents,
  photos,
}: FirearmDetailViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Ownership and edit rights derive from the server-resolved permission (single
  // source of truth) — no separate ownerId/currentUserId compare to drift from it.
  const isOwner = permission === "owner";
  const canEdit = permission === "owner" || permission === "edit";
  const del = useDeleteConfirmation<FirearmDetail>({
    entityLabel: "Firearm",
    getName: (item) => firearmDisplayName(item),
    remove: deleteFirearmAction,
    redirectTo: "/firearms",
  });

  // Move focus to the heading on mount so a client navigation (or a browser
  // reload landing here) announces the new page to a screen reader (R16).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const displayName = firearmDisplayName(firearm);

  return (
    <div className="space-y-6">
      <Link
        href="/firearms"
        className="inline-block text-sm font-medium text-primary hover:underline"
      >
        ← Firearms
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
            {hasNickname(firearm) ? (
              <span className="min-w-0 wrap-break-word">{firearm.name}</span>
            ) : null}
            {!isOwner ? (
              <Badge tone="primary">Shared with you · {permission}</Badge>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            <ShareControl
              parentType="firearm"
              parentId={firearm.id}
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
              onClick={() => del.request(firearm)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {editing ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            Edit firearm
          </h2>
          <FirearmForm
            initial={firearm}
            caliberSuggestions={caliberSuggestions}
            manufacturerSuggestions={manufacturerSuggestions}
            subtypeSuggestions={subtypeSuggestions}
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
            <DetailRow label="Product name" value={firearm.name} />
            <DetailRow
              label="Manufacturer"
              value={orDash(firearm.manufacturer)}
            />
            <DetailRow label="Caliber" value={firearm.caliber} />
            <DetailRow label="Type" value={firearmTypeLabel(firearm.type)} />
            <DetailRow
              label="Action"
              value={firearmActionLabel(firearm.action)}
            />
            <DetailRow label="Subtype" value={orDash(firearm.subtype)} />
            <DetailRow
              label="Serial number"
              value={
                <span className="font-mono text-xs">
                  {orDash(firearm.serialNumber)}
                </span>
              }
            />
            <DetailRow
              label="Compatible magazines"
              value={<span className="tabular">{magazineCount}</span>}
            />
            <DetailRow
              label="NFA item"
              value={
                firearm.isNfa ? (
                  <Badge tone="destructive">NFA-regulated</Badge>
                ) : (
                  <span className="text-muted-foreground">No</span>
                )
              }
            />
            <DetailRow
              label="Notes"
              value={
                firearm.notes.trim() !== "" ? (
                  <span className="whitespace-pre-wrap">{firearm.notes}</span>
                ) : (
                  orDash("")
                )
              }
            />
          </dl>
        </Card>
      )}

      <FirearmPhotos
        firearmId={firearm.id}
        firearmName={displayName}
        photos={photos}
        canEdit={canEdit}
      />

      <MountedAccessories
        firearmId={firearm.id}
        accessories={mountedAccessories}
        totalValueCents={accessoryValueCents}
        canEdit={canEdit}
      />

      <RangeSessionHistory
        firearmId={firearm.id}
        firearmName={displayName}
        canEdit={canEdit}
        onChange={() => router.refresh()}
      />

      <InventoryLogHistory
        parentType="firearm"
        parentId={firearm.id}
        canEdit={canEdit}
      />

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${displayName}”?`}
        description="Linked magazines keep their other compatibility. This can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
