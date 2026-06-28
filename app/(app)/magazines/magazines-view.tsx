"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/surface";
import { DataTable, TD, TH, THead, TRow } from "@/components/ui/table";
import { deleteMagazineAction } from "./actions";
import {
  type FirearmOption,
  MagazineForm,
  type MagazineFormValues,
} from "./magazine-form";

export interface MagazineListItem {
  id: string;
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
  firearmOptions: FirearmOption[];
  caliberSuggestions: string[];
  /** True when a filter is active (distinguishes empty inventory from zero results). */
  filtered: boolean;
}

type FormState = { open: false } | { open: true; initial?: MagazineFormValues };

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
  firearmOptions,
  caliberSuggestions,
  filtered,
}: MagazinesViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ open: false });
  const [pending, startTransition] = useTransition();

  function refresh() {
    setForm({ open: false });
    router.refresh();
  }

  function onDelete(item: MagazineListItem) {
    if (!confirm(`Delete "${item.brandModel}"?`)) return;
    startTransition(async () => {
      await deleteMagazineAction(item.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {!form.open ? (
          <Button onClick={() => setForm({ open: true })}>Add magazine</Button>
        ) : null}
      </div>

      {form.open ? (
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-ink">
            {form.initial ? "Edit magazine" : "New magazine"}
          </h2>
          <MagazineForm
            initial={form.initial}
            firearmOptions={firearmOptions}
            caliberSuggestions={caliberSuggestions}
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
        ) : (
          <EmptyState
            title="No magazines yet"
            description="Add a magazine — single, or bulk-add a labeled batch."
            action={
              <Button onClick={() => setForm({ open: true })}>
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
              <TRow key={item.id}>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setForm({ open: true, initial: toFormValues(item) })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => onDelete(item)}
                    >
                      Delete
                    </Button>
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
