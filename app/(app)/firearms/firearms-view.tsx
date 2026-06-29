"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { useDeleteConfirmation } from "@/hooks/use-delete-confirmation";
import { useRowFlash } from "@/hooks/use-row-flash";
import { deleteFirearmAction } from "./actions";
import { FirearmForm, type FirearmFormValues } from "./firearm-form";

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
}

type FormState = { open: false } | { open: true; initial?: FirearmFormValues };

export function FirearmsView({
  firearms,
  currentUserId,
  showSerial,
  caliberSuggestions,
  manufacturerSuggestions,
}: FirearmsViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const { flashId, flash } = useRowFlash();
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
        <DataTable>
          <THead>
            <TH>Name</TH>
            <TH>Caliber</TH>
            {showSerial ? <TH>Serial</TH> : null}
            <TH className="text-right"># Mags</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <tbody>
            {firearms.map((item) => (
              <TRow key={item.id} flash={item.id === flashId}>
                <TD className="font-medium">{item.name}</TD>
                <TD className="tabular">{item.caliber}</TD>
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
