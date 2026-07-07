"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { COMMON_AMMO_TYPES } from "@/src/domain/ammo/constants";
import { MAX_COUNT, validateAmmo } from "@/src/domain/ammo/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { createAmmoAction, updateAmmoAction } from "./actions";

export interface AmmoFormValues {
  id?: string;
  brand: string;
  caliber: string;
  type: string;
  grain: string;
  quantityRounds: string;
  lowStockThreshold: string;
  acquiredDate: string;
  notes: string;
}

const DEFAULTS: AmmoFormValues = {
  brand: "",
  caliber: "",
  type: "",
  grain: "0",
  quantityRounds: "0",
  lowStockThreshold: "0",
  acquiredDate: "",
  notes: "",
};

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Toast/dialog display label: "Brand Caliber", or just Caliber when brand is unset. */
export function lotDisplayName(
  values: Pick<AmmoFormValues, "brand" | "caliber">,
): string {
  return [values.brand.trim(), values.caliber.trim()]
    .filter((v) => v !== "")
    .join(" ");
}

interface AmmoFormProps {
  initial?: AmmoFormValues;
  /** Calibers seeded from the curated list + the owner's in-use calibers (R60). */
  caliberSuggestions: string[];
  /** `touchedId` flashes the just-created/edited row. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

export function AmmoForm({
  initial,
  caliberSuggestions,
  onDone,
  onCancel,
}: AmmoFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<AmmoFormValues>(initial ?? DEFAULTS);
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const brandId = useId();
  const calId = useId();
  const typeId = useId();
  const grainId = useId();
  const qtyId = useId();
  const thresholdId = useId();
  const dateId = useId();
  const notesId = useId();

  function set<K extends keyof AmmoFormValues>(
    key: K,
    value: AmmoFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const fields = {
      caliber: values.caliber,
      grain: num(values.grain),
      quantityRounds: num(values.quantityRounds),
      lowStockThreshold: num(values.lowStockThreshold),
    };
    const found = validateAmmo(fields);
    setCodes(found);
    if (found.length > 0) {
      // Caliber is the only required field — the rest are numeric floors that
      // the `min={0}` number inputs already keep out of reach in practice.
      if (found.includes("emptyCaliber")) {
        document.getElementById(calId)?.focus();
      }
      return;
    }

    const input = {
      ...fields,
      brand: values.brand,
      type: values.type,
      acquiredDate: values.acquiredDate || null,
      notes: values.notes,
    };

    startTransition(async () => {
      const result =
        isEdit && initial?.id
          ? await updateAmmoAction(initial.id, input)
          : await createAmmoAction(input);
      if (result.ok) {
        toast({
          message: isEdit ? "Changes saved" : "Lot logged",
          detail: lotDisplayName(values),
        });
        onDone(result.data?.id);
      } else if (result.codes) {
        setCodes(result.codes);
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      {/* Reuses the exact native <input list><datalist> mechanism the magazine
          form uses for caliber (ammo plan U4) — both fields accept any typed
          value; these are suggestions only, never a controlled/enum set. */}
      <datalist id="ammo-calibers">
        {caliberSuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="ammo-types">
        {COMMON_AMMO_TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand" controlId={brandId} hint="Optional">
          <Input
            id={brandId}
            value={values.brand}
            onChange={(e) => set("brand", e.target.value)}
          />
        </Field>
        <Field
          label="Caliber"
          controlId={calId}
          required
          error={firstMessage(codes, ["emptyCaliber"])}
        >
          <Input
            id={calId}
            list="ammo-calibers"
            value={values.caliber}
            onChange={(e) => set("caliber", e.target.value)}
            aria-invalid={codes.includes("emptyCaliber")}
          />
        </Field>
      </div>

      <Field
        label="Load type"
        controlId={typeId}
        hint="Optional — e.g. FMJ, JHP"
      >
        <Input
          id={typeId}
          list="ammo-types"
          value={values.type}
          onChange={(e) => set("type", e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Grain"
          controlId={grainId}
          error={firstMessage(codes, ["negativeGrain"])}
        >
          <Input
            id={grainId}
            type="number"
            min={0}
            max={MAX_COUNT}
            value={values.grain}
            onChange={(e) => set("grain", e.target.value)}
            aria-invalid={codes.includes("negativeGrain")}
          />
        </Field>
        <Field
          label="Quantity (rounds)"
          controlId={qtyId}
          error={firstMessage(codes, ["negativeQuantity"])}
        >
          <Input
            id={qtyId}
            type="number"
            min={0}
            max={MAX_COUNT}
            value={values.quantityRounds}
            onChange={(e) => set("quantityRounds", e.target.value)}
            aria-invalid={codes.includes("negativeQuantity")}
          />
        </Field>
        <Field
          label="Low-stock threshold"
          controlId={thresholdId}
          hint="Flags the lot once quantity drops to this level or below"
          error={firstMessage(codes, ["negativeThreshold"])}
        >
          <Input
            id={thresholdId}
            type="number"
            min={0}
            max={MAX_COUNT}
            value={values.lowStockThreshold}
            onChange={(e) => set("lowStockThreshold", e.target.value)}
            aria-invalid={codes.includes("negativeThreshold")}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Acquired date" controlId={dateId}>
          <Input
            id={dateId}
            type="date"
            value={values.acquiredDate}
            onChange={(e) => set("acquiredDate", e.target.value)}
          />
        </Field>
        <Field label="Notes" controlId={notesId}>
          <Textarea
            id={notesId}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add lot"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
