"use client";

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
import {
  type FirearmOption,
  MagazineForm,
  type MagazineFormValues,
} from "./magazine-form";

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
  /** When true the magazine form enforces PMAG dot-matrix label constraints. */
  magpulMode: boolean;
  /** True when a filter is active (distinguishes empty inventory from zero results). */
  filtered: boolean;
}

// `magpulMode` is resolved per-open: the label mask applies only when the
// current user OWNS the magazine being edited (self-owned → their session flag
// is the owner's flag). Editing a shared magazine you don't own never masks —
// the owner's mode governs and the domain layer stays authoritative (KTD-6),
// so we never mangle another owner's label client-side.
type FormState =
  | { open: false }
  | { open: true; initial?: MagazineFormValues; magpulMode: boolean };

function toFormValues(item: MagazineListItem): MagazineFormValues {
  return {
    id: item.id,
    brandModel: item.brandModel,
    caliber: item.caliber,
    baseCapacity: String(item.baseCapacity),
    extensionRounds: String(item.extensionRounds),
    label: item.label,
    acquiredDate: item.acquiredDate ?? "",
    notes: item.notes,
    compatibleFirearmIds: item.compatibleFirearmIds,
  };
}

export function MagazinesView({
  magazines,
  currentUserId,
  firearmOptions,
  caliberSuggestions,
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

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* When the inventory is truly empty the empty state owns the add CTA;
          show this toolbar button only once there are rows (or a filter). */}
      {!form.open && (magazines.length > 0 || filtered) ? (
        <div className="flex justify-end">
          <Button onClick={() => setForm({ open: true, magpulMode })}>
            Add magazine
          </Button>
        </div>
      ) : null}

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">
            {form.initial ? "Edit magazine" : "New magazine"}
          </h2>
          <MagazineForm
            initial={form.initial}
            firearmOptions={firearmOptions}
            caliberSuggestions={caliberSuggestions}
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
                <Button
                  variant="ghost"
                  onClick={() => setForm({ open: true, magpulMode })}
                >
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
              <Button onClick={() => setForm({ open: true, magpulMode })}>
                Add your first magazine
              </Button>
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
                <TD className="font-medium">{item.brandModel}</TD>
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
                  <div className="flex justify-end gap-1">
                    {item.ownerId === currentUserId ? (
                      <ShareControl
                        parentType="magazine"
                        parentId={item.id}
                        itemName={item.brandModel}
                      />
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setForm({
                          open: true,
                          initial: toFormValues(item),
                          magpulMode:
                            magpulMode && item.ownerId === currentUserId,
                        })
                      }
                    >
                      Edit
                    </Button>
                    {item.ownerId === currentUserId ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => del.request(item)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
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
