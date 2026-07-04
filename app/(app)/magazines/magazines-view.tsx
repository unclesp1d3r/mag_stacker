"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { deleteMagazineAction } from "./actions";
import { type FirearmOption, MagazineForm } from "./magazine-form";

export interface MagazineListItem {
  id: string;
  ownerId: string;
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
  label: string;
  acquiredDate: string | null;
  notes: string;
  compatibleFirearmIds: string[];
  compatibleFirearmNames: string[];
}

interface MagazinesViewProps {
  magazines: MagazineListItem[];
  currentUserId: string;
  firearmOptions: FirearmOption[];
  caliberSuggestions: string[];
  /** The owner's used label prefixes, offered as single-add suggestions (#22). */
  prefixOptions: string[];
  /** `prefix -> next sequence number` for single-add label prefill (#22). */
  prefixNextStart: Record<string, number>;
  /** When true the magazine form enforces PMAG dot-matrix label constraints. */
  magpulMode: boolean;
  /** True when a filter is active (distinguishes empty inventory from zero results). */
  filtered: boolean;
}

// Create-only form state. New magazines are always owned by the current user, so
// the create form uses their own Magpul mode directly. Editing now lives on the
// magazine detail page (owner-only), not here.
type FormState = { open: false } | { open: true; magpulMode: boolean };

export function MagazinesView({
  magazines,
  currentUserId,
  firearmOptions,
  caliberSuggestions,
  prefixOptions,
  prefixNextStart,
  magpulMode,
  filtered,
}: MagazinesViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const { flashId, flash } = useRowFlash();
  const del = useDeleteConfirmation<MagazineListItem>({
    entityLabel: "Magazine",
    getName: (item) => item.brandModel,
    remove: deleteMagazineAction,
  });

  // Same-named magazines get a suffix on the row link's accessible name so a
  // screen-reader link list stays unambiguous (R17).
  const nameCounts = new Map<string, number>();
  for (const m of magazines)
    nameCounts.set(m.brandModel, (nameCounts.get(m.brandModel) ?? 0) + 1);
  function linkLabel(item: MagazineListItem): string | undefined {
    return (nameCounts.get(item.brandModel) ?? 0) > 1
      ? `${item.brandModel}, ${item.label || item.caliber}`
      : undefined;
  }

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  function openCreate() {
    setForm({ open: true, magpulMode });
  }

  return (
    <div className="space-y-5">
      {/* When the inventory is truly empty the empty state owns the add CTA;
          show this toolbar button only once there are rows (or a filter). */}
      {!form.open && (magazines.length > 0 || filtered) ? (
        <div className="flex justify-end">
          <Button onClick={openCreate}>Add magazine</Button>
        </div>
      ) : null}

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">New magazine</h2>
          <MagazineForm
            firearmOptions={firearmOptions}
            caliberSuggestions={caliberSuggestions}
            prefixOptions={prefixOptions}
            prefixNextStart={prefixNextStart}
            magpulMode={form.magpulMode}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {magazines.length === 0 && !form.open ? (
        filtered ? (
          <EmptyState
            title="No magazines match your filters"
            description="Try clearing or widening the filters above."
          />
        ) : firearmOptions.length === 0 ? (
          // Cold start: no firearms and no magazines. Point at the path to the
          // payoff — compatibility mapping needs a firearm first.
          <EmptyState
            title="Set up your inventory"
            description="MagStacker maps which magazines fit which firearms. Start with a firearm, then add the magazines that feed it."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={() => router.push("/firearms")}>
                  Add a firearm
                </Button>
                <Button variant="ghost" onClick={openCreate}>
                  Start with a magazine
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState
            title="No magazines yet"
            description="Add a magazine — single, or bulk-add a labeled batch."
            action={
              <Button onClick={openCreate}>Add your first magazine</Button>
            }
          />
        )
      ) : magazines.length > 0 ? (
        <DataTable>
          <THead>
            <TH>Brand / model</TH>
            <TH>Caliber</TH>
            <TH className="text-right">Eff. cap.</TH>
            <TH>Label</TH>
            <TH>Compatible</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <tbody>
            {magazines.map((item) => (
              <TRow key={item.id} flash={item.id === flashId}>
                <TD className="font-medium">
                  <Link
                    href={`/magazines/${item.id}`}
                    aria-label={linkLabel(item)}
                    className="text-blaze hover:underline"
                  >
                    {item.brandModel}
                  </Link>
                </TD>
                <TD className="tabular">{item.caliber}</TD>
                <TD className="text-right tabular">
                  {item.baseCapacity + item.extensionRounds}
                </TD>
                <TD className="font-mono text-xs">{item.label}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {item.compatibleFirearmNames.map((name) => (
                      <Badge key={name} tone="neutral">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </TD>
                <TD className="text-right">
                  {item.ownerId === currentUserId ? (
                    <div className="flex justify-end gap-1">
                      <ShareControl
                        parentType="magazine"
                        parentId={item.id}
                        itemName={item.brandModel}
                      />
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => del.request(item)}
                      >
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </TD>
              </TRow>
            ))}
          </tbody>
        </DataTable>
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target?.brandModel}”?`}
        description="This removes the magazine from your inventory and can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
