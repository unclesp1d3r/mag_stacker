"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import type { Permission } from "@/src/auth/visibility";
import {
  accessoryDisplayName,
  formatCostCents,
  parseCostInputToCents,
} from "@/src/domain/accessories/display";
import type { EditableFirearmOption } from "./accessory-form";
import { AccessoryForm, type AccessoryFormValues } from "./accessory-form";
import { deleteAccessoryAction, mountAccessoryAction } from "./actions";

export interface AccessoryDetail extends AccessoryFormValues {
  id: string;
  currentFirearmId: string | null;
}

interface AccessoryDetailViewProps {
  accessory: AccessoryDetail;
  permission: Permission;
  /** Firearms the actor can mount to (owner or edit permission, R17). */
  editableFirearms: EditableFirearmOption[];
  /** Display names for every firearm visible to the actor, for the read-only
   * "current firearm" link even when it falls outside `editableFirearms`. */
  firearmNames: Record<string, string>;
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

/**
 * The mount/move control (R4/R17): a select bound to the accessory's current
 * firearm, calling `mountAccessoryAction` directly on change — separate from
 * `AccessoryForm`'s edit-in-place, since `updateAccessory` intentionally
 * omits `firearmId` (mount is a distinct op).
 */
function MountControl({
  accessoryId,
  currentFirearmId,
  editableFirearms,
  displayName,
  onChanged,
}: {
  accessoryId: string;
  currentFirearmId: string | null;
  editableFirearms: EditableFirearmOption[];
  displayName: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    const firearmId = value === "" ? null : value;
    startTransition(async () => {
      const result = await mountAccessoryAction(accessoryId, firearmId);
      if (result.ok) {
        toast({
          message: firearmId ? "Moved" : "Unmounted",
          detail: displayName,
        });
        onChanged();
      } else {
        toast({
          message: result.error ?? "Could not update mount.",
          tone: "destructive",
        });
      }
    });
  }

  return (
    <Select
      aria-label="Mount on firearm"
      value={currentFirearmId ?? ""}
      onChange={(e) => handleChange(e.target.value)}
      disabled={pending || editableFirearms.length === 0}
      className="max-w-xs"
    >
      <option value="">Unmounted</option>
      {editableFirearms.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
        </option>
      ))}
    </Select>
  );
}

export function AccessoryDetailView({
  accessory,
  permission,
  editableFirearms,
  firearmNames,
}: AccessoryDetailViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Ownership and edit rights derive from the server-resolved permission
  // (single source of truth) — a mounted accessory inherits its firearm's
  // permission, an unmounted one is owner-only (R7/R9).
  const isOwner = permission === "owner";
  const canEdit = permission === "owner" || permission === "edit";
  const del = useDeleteConfirmation<AccessoryDetail>({
    entityLabel: "Accessory",
    getName: (item) => accessoryDisplayName(item),
    remove: deleteAccessoryAction,
    redirectTo: "/accessories",
  });

  // Move focus to the heading on mount so a client navigation (or a browser
  // reload landing here) announces the new page to a screen reader (R16).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const displayName = accessoryDisplayName(accessory);
  const formattedCost = formatCostCents(parseCostInputToCents(accessory.cost));

  return (
    <div className="space-y-6">
      <Link
        href="/accessories"
        className="inline-block text-sm font-medium text-primary hover:underline"
      >
        ← Accessories
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
            {accessory.isNfa ? <Badge tone="destructive">NFA</Badge> : null}
            {!isOwner ? (
              <Badge tone="primary">Shared with you · {permission}</Badge>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Accessories are not independently shareable (R7) — no
              ShareControl here, unlike firearms/ammo. */}
          {canEdit && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => del.request(accessory)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </header>

      {editing ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-foreground">
            Edit accessory
          </h2>
          <AccessoryForm
            initial={accessory}
            editableFirearms={editableFirearms}
            currentFirearmId={accessory.currentFirearmId}
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
            <DetailRow label="Category" value={accessory.category} />
            <DetailRow label="Brand" value={orDash(accessory.brand)} />
            <DetailRow label="Model" value={orDash(accessory.model)} />
            <DetailRow
              label="Serial number"
              value={
                <span className="font-mono text-xs">
                  {orDash(accessory.serialNumber)}
                </span>
              }
            />
            <DetailRow
              label="Current firearm"
              value={
                canEdit ? (
                  <MountControl
                    accessoryId={accessory.id}
                    currentFirearmId={accessory.currentFirearmId}
                    editableFirearms={editableFirearms}
                    displayName={displayName}
                    onChanged={() => router.refresh()}
                  />
                ) : accessory.currentFirearmId ? (
                  <Link
                    href={`/firearms/${accessory.currentFirearmId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {firearmNames[accessory.currentFirearmId] ??
                      "Unknown firearm"}
                  </Link>
                ) : (
                  orDash("")
                )
              }
            />
            <DetailRow
              label="Installed date"
              value={orDash(accessory.installedDate)}
            />
            <DetailRow
              label="Cost"
              value={
                formattedCost ?? (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
            <DetailRow
              label="NFA-regulated"
              value={accessory.isNfa ? "Yes" : "No"}
            />
            <DetailRow
              label="Notes"
              value={
                accessory.notes.trim() !== "" ? (
                  <span className="whitespace-pre-wrap">{accessory.notes}</span>
                ) : (
                  orDash("")
                )
              }
            />
          </dl>
        </Card>
      )}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${displayName}”?`}
        description="This removes the accessory from your inventory and can't be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
