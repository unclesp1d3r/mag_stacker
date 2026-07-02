"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/input";
import { Card, PageHeader } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import {
  FIREARM_TYPES,
  firearmActionLabel,
  firearmTypeLabel,
} from "@/src/domain/firearms/constants";
import { deleteFirearmAction } from "./actions";
import { FirearmForm, type FirearmFormValues } from "./firearm-form";

/** Filter sentinel: show every type. */
const ALL_TYPES = "all";

export interface FirearmListItem extends FirearmFormValues {
  id: string;
  ownerId: string;
  magazineCount: number;
}

interface FirearmsViewProps {
  firearms: FirearmListItem[];
  currentUserId: string;
  showSerial: boolean;
  caliberSuggestions: string[];
  manufacturerSuggestions: string[];
  subtypeSuggestions: string[];
}

type FormState = { open: false } | { open: true; initial?: FirearmFormValues };

export function FirearmsView({
  firearms,
  currentUserId,
  showSerial,
  caliberSuggestions,
  manufacturerSuggestions,
  subtypeSuggestions,
}: FirearmsViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const [typeFilter, setTypeFilter] = useState<string>(ALL_TYPES);
  const filterId = useId();
  const { flashId, flash } = useRowFlash();

  // Types actually present in the visible list, in canonical order (includes the
  // `unspecified` sentinel when backfilled rows are present) — used to build the
  // filter options so owners can't pick a type with no rows behind it.
  const presentTypes = FIREARM_TYPES.filter((t) =>
    firearms.some((f) => f.type === t),
  );
  const filtered =
    typeFilter === ALL_TYPES
      ? firearms
      : firearms.filter((f) => f.type === typeFilter);
  const del = useDeleteConfirmation<FirearmListItem>({
    entityLabel: "Firearm",
    getName: (item) => item.name,
    remove: deleteFirearmAction,
  });

  function refresh(touchedId?: string) {
    setForm({ open: false });
    if (touchedId) flash(touchedId);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Firearms"
        description="Your collection and anything shared with you."
        actions={
          // The cold-start empty state carries its own CTA; only show the
          // toolbar button once there's a collection to act on.
          !form.open && firearms.length > 0 ? (
            <Button onClick={() => setForm({ open: true })}>Add firearm</Button>
          ) : null
        }
      />

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">
            {form.initial ? "Edit firearm" : "New firearm"}
          </h2>
          <FirearmForm
            initial={form.initial}
            caliberSuggestions={caliberSuggestions}
            manufacturerSuggestions={manufacturerSuggestions}
            subtypeSuggestions={subtypeSuggestions}
            onDone={refresh}
            onCancel={() => setForm({ open: false })}
          />
        </Card>
      ) : null}

      {firearms.length === 0 && !form.open ? (
        <EmptyState
          title="No firearms yet"
          description="Add your first firearm to start tracking magazine compatibility."
          action={
            <Button onClick={() => setForm({ open: true })}>
              Add your first firearm
            </Button>
          }
        />
      ) : firearms.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-sm text-ink-faint">
              Filter by type
            </label>
            <Select
              id={filterId}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-auto min-w-40"
            >
              <option value={ALL_TYPES}>All types</option>
              {presentTypes.map((t) => (
                <option key={t} value={t}>
                  {firearmTypeLabel(t)}
                </option>
              ))}
            </Select>
          </div>

          {filtered.length === 0 ? (
            // Filtered to zero — distinct from the cold-start empty state, which
            // is reserved for owning no firearms at all.
            <p className="rounded-[var(--radius)] border border-line bg-paper-raised px-4 py-6 text-center text-sm text-ink-faint">
              No firearms match this filter.
            </p>
          ) : (
            <DataTable>
              <THead>
                <TH>Name</TH>
                <TH>Caliber</TH>
                <TH>Type</TH>
                <TH>Action</TH>
                {showSerial ? <TH>Serial</TH> : null}
                <TH className="text-right"># Mags</TH>
                <TH className="text-right">Actions</TH>
              </THead>
              <tbody>
                {filtered.map((item) => (
                  <TRow key={item.id} flash={item.id === flashId}>
                    <TD className="font-medium">{item.name}</TD>
                    <TD className="tabular">{item.caliber}</TD>
                    <TD>{firearmTypeLabel(item.type)}</TD>
                    <TD>{firearmActionLabel(item.action)}</TD>
                    {showSerial ? (
                      <TD className="font-mono text-xs">{item.serialNumber}</TD>
                    ) : null}
                    <TD className="text-right tabular">{item.magazineCount}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {item.ownerId === currentUserId ? (
                          <ShareControl
                            parentType="firearm"
                            parentId={item.id}
                            itemName={item.name}
                          />
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ open: true, initial: item })}
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
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={del.target !== null}
        title={`Delete “${del.target?.name}”?`}
        description="Linked magazines keep their other compatibility. This can’t be undone."
        pending={del.pending}
        onConfirm={del.confirm}
        onCancel={del.cancel}
      />
    </div>
  );
}
