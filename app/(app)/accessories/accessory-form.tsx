"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ACCESSORY_CATEGORY_SUGGESTIONS } from "@/src/domain/accessories/constants";
import {
  accessoryDisplayName,
  parseCostInputToCents,
} from "@/src/domain/accessories/display";
import {
  MAX_COST_CENTS,
  validateAccessory,
} from "@/src/domain/accessories/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { createAccessoryAction, updateAccessoryAction } from "./actions";

export interface AccessoryFormValues {
  id?: string;
  category: string;
  brand: string;
  model: string;
  serialNumber: string;
  /** ISO date, or `""` when unset. */
  installedDate: string;
  /** Dollars input string (e.g. `"12.50"`), or `""` when unset — mapped to
   * integer `costCents` on submit (see `parseCostInputToCents`). */
  cost: string;
  notes: string;
  isNfa: boolean;
}

const DEFAULTS: AccessoryFormValues = {
  category: "",
  brand: "",
  model: "",
  serialNumber: "",
  installedDate: "",
  cost: "",
  notes: "",
  isNfa: false,
};

const MAX_COST_DOLLARS = MAX_COST_CENTS / 100;

export interface EditableFirearmOption {
  id: string;
  label: string;
}

interface AccessoryFormProps {
  initial?: AccessoryFormValues;
  /**
   * Firearms the actor can mount to (owner or edit permission, R17). Create-
   * only: reassigning an existing accessory's mount goes through the detail
   * view's dedicated mount control (`mountAccessoryAction`), since
   * `updateAccessory` intentionally omits `firearmId`.
   */
  editableFirearms: EditableFirearmOption[];
  /**
   * Pre-selected mount target on create — set when the form is opened from a
   * firearm's detail page ("Add accessory", F1). Ignored on edit.
   */
  initialFirearmId?: string;
  /** `touchedId` flashes the just-created/edited row. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

export function AccessoryForm({
  initial,
  editableFirearms,
  initialFirearmId,
  onDone,
  onCancel,
}: AccessoryFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<AccessoryFormValues>(
    initial ?? DEFAULTS,
  );
  // Mount target is create-only; see the `editableFirearms` prop doc. Pre-fills
  // from `initialFirearmId` when launched from a firearm's detail page (F1),
  // but only if that firearm is actually in the editable set.
  const [firearmId, setFirearmId] = useState(
    initialFirearmId && editableFirearms.some((f) => f.id === initialFirearmId)
      ? initialFirearmId
      : "",
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const categoryId = useId();
  const brandId = useId();
  const modelId = useId();
  const serialId = useId();
  const dateId = useId();
  const costId = useId();
  const notesId = useId();
  const nfaId = useId();
  const mountId = useId();

  function set<K extends keyof AccessoryFormValues>(
    key: K,
    value: AccessoryFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const costCents = parseCostInputToCents(values.cost);
    const fields = {
      category: values.category,
      costCents,
      installedDate: values.installedDate || null,
    };
    const found = validateAccessory(fields);
    setCodes(found);
    if (found.length > 0) {
      if (found.includes("emptyCategory")) {
        document.getElementById(categoryId)?.focus();
      } else if (
        found.includes("negativeCostCents") ||
        found.includes("invalidCostCents")
      ) {
        document.getElementById(costId)?.focus();
      } else if (found.includes("invalidInstalledDate")) {
        document.getElementById(dateId)?.focus();
      }
      return;
    }

    const input = {
      ...fields,
      brand: values.brand,
      model: values.model,
      serialNumber: values.serialNumber,
      notes: values.notes,
      isNfa: values.isNfa,
    };

    startTransition(async () => {
      const result =
        isEdit && initial?.id
          ? await updateAccessoryAction(initial.id, input)
          : await createAccessoryAction({
              ...input,
              firearmId: firearmId || null,
            });
      if (result.ok) {
        toast({
          message: isEdit ? "Changes saved" : "Accessory logged",
          detail: accessoryDisplayName(values),
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
      <datalist id="accessory-categories">
        {ACCESSORY_CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Category"
          controlId={categoryId}
          required
          error={firstMessage(codes, ["emptyCategory"])}
        >
          <Input
            id={categoryId}
            list="accessory-categories"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
            aria-invalid={codes.includes("emptyCategory")}
          />
        </Field>
        <Field label="Brand" controlId={brandId} hint="Optional">
          <Input
            id={brandId}
            value={values.brand}
            onChange={(e) => set("brand", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model" controlId={modelId} hint="Optional">
          <Input
            id={modelId}
            value={values.model}
            onChange={(e) => set("model", e.target.value)}
          />
        </Field>
        <Field label="Serial number" controlId={serialId} hint="Optional">
          <Input
            id={serialId}
            value={values.serialNumber}
            onChange={(e) => set("serialNumber", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Installed date"
          controlId={dateId}
          hint="Optional"
          error={firstMessage(codes, ["invalidInstalledDate"])}
        >
          <Input
            id={dateId}
            type="date"
            value={values.installedDate}
            onChange={(e) => set("installedDate", e.target.value)}
            aria-invalid={codes.includes("invalidInstalledDate")}
          />
        </Field>
        <Field
          label="Cost"
          controlId={costId}
          hint="Optional — dollars"
          error={firstMessage(codes, ["negativeCostCents", "invalidCostCents"])}
        >
          <Input
            id={costId}
            type="number"
            min={0}
            max={MAX_COST_DOLLARS}
            step={0.01}
            value={values.cost}
            onChange={(e) => set("cost", e.target.value)}
            aria-invalid={
              codes.includes("negativeCostCents") ||
              codes.includes("invalidCostCents")
            }
          />
        </Field>
      </div>

      <Field label="Notes" controlId={notesId}>
        <Textarea
          id={notesId}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <label
        htmlFor={nfaId}
        className="flex w-fit cursor-pointer items-center gap-2 text-sm text-foreground"
      >
        <input
          id={nfaId}
          type="checkbox"
          className="size-4 accent-primary"
          checked={values.isNfa}
          onChange={(e) => set("isNfa", e.target.checked)}
        />
        NFA-regulated item
      </label>

      {/* Mount target is create-only (R4/R17) — omitted on edit; reassigning
          an existing accessory uses the detail view's mount control instead. */}
      {!isEdit ? (
        <Field
          label="Mount on firearm"
          controlId={mountId}
          hint={
            editableFirearms.length === 0
              ? "No firearms available — saves unmounted"
              : "Optional — leave unmounted to keep it in the safe"
          }
        >
          <Select
            id={mountId}
            value={firearmId}
            onChange={(e) => setFirearmId(e.target.value)}
            disabled={editableFirearms.length === 0}
          >
            <option value="">Unmounted</option>
            {editableFirearms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add accessory"}
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
