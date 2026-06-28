"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShareControl } from "@/app/(app)/grants/share-control";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
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
  const [pending, startTransition] = useTransition();

  function refresh() {
    setForm({ open: false });
    router.refresh();
  }

  function onDelete(item: FirearmListItem) {
    if (
      !confirm(
        `Delete "${item.name}"? Linked magazines keep their other compatibility.`,
      )
    )
      return;
    startTransition(async () => {
      await deleteFirearmAction(item.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Firearms"
        description="Your collection and anything shared with you."
        actions={
          !form.open ? (
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
              <TRow key={item.id}>
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
                        disabled={pending}
                        onClick={() => onDelete(item)}
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
    </div>
  );
}
