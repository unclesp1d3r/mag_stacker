"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  ACCESSORY_CATEGORY_SUGGESTIONS,
  ACCESSORY_TYPES,
  accessoryTypeLabel,
} from "@/src/domain/accessories/constants";
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
  /** Controlled structural discriminator (#23 R1/R14). Required. */
  type: string;
  /** Free-text descriptive kind (#23 R3). Optional since the type select
   * took over the required classification. */
  category: string;
  brand: string;
  model: string;
  serialNumber: string;
  /** ISO date, or `""` when unset. */
  installedDate: string;
  /** ISO date, or `""` when unset — mirrors `firearm.acquiredDate` (R22),
   * added during implementation. Unlike `installedDate`, clearing and
   * re-mounting never touches this field. */
  acquiredDate: string;
  /** Dollars input string (e.g. `"12.50"`), or `""` when unset — mapped to
   * integer `costCents` on submit (see `parseCostInputToCents`). */
  cost: string;
  notes: string;
  isNfa: boolean;
}

const DEFAULTS: AccessoryFormValues = {
  // Deliberately blank rather than pre-selecting "other": a silent default
  // would let an owner save every accessory as unclassified without ever
  // seeing the question, which is exactly what the discriminator exists to
  // prevent. The empty option below is not submittable.
  type: "",
  category: "",
  brand: "",
  model: "",
  serialNumber: "",
  installedDate: "",
  acquiredDate: "",
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
  /**
   * The accessory's current mount on edit (ignored on create, where the mount
   * select below drives it instead). Gates the "Installed date" field (R6) —
   * an unmounted accessory can never carry an installed date, so the field is
   * hidden and submits nothing until a mount exists.
   */
  currentFirearmId?: string | null;
  /**
   * The owner's own previously-typed categories, alphabetically (KTD8's
   * `listOwnerAccessoryCategories`, reused here per the plan's deferred-
   * to-follow-up item) — merged into the category datalist alongside the
   * static `ACCESSORY_CATEGORY_SUGGESTIONS` so a category the owner already
   * uses (and that a default set may already key on, KD10) is suggested
   * before it's retyped with a diverging spelling. Free entry is still fully
   * permitted — this is suggestion only, never validated membership (KD10
   * stays exact-string, free text; nothing here rejects an unlisted value).
   */
  ownerCategories?: string[];
  /** `touchedId` flashes the just-created/edited row. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

export function AccessoryForm({
  initial,
  editableFirearms,
  initialFirearmId,
  currentFirearmId,
  ownerCategories = [],
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

  // The "Installed date" field only makes sense once a mount exists (R6): on
  // create, that's whatever the mount select below currently holds; on edit,
  // the mount select isn't shown at all, so it's the accessory's existing
  // `currentFirearmId` (fixed for the form's lifetime — reassignment happens
  // via the detail view's mount control, not this form).
  const isMounted = isEdit ? Boolean(currentFirearmId) : firearmId !== "";

  const typeId = useId();
  const categoryId = useId();
  const brandId = useId();
  const modelId = useId();
  const serialId = useId();
  const dateId = useId();
  const acquiredDateId = useId();
  const costId = useId();
  const notesId = useId();
  const nfaId = useId();
  const mountId = useId();

  // Merge the owner's real categories with the static suggestions,
  // deduplicated, alphabetical after the static list — case-sensitive (KD10
  // is exact-string matching, so "Optic" and "optic" are deliberately kept
  // as distinct suggestions rather than folded together).
  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>(ACCESSORY_CATEGORY_SUGGESTIONS);
    const merged: string[] = [...ACCESSORY_CATEGORY_SUGGESTIONS];
    for (const category of ownerCategories) {
      if (!seen.has(category)) {
        seen.add(category);
        merged.push(category);
      }
    }
    return merged;
  }, [ownerCategories]);

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
      type: values.type,
      category: values.category,
      costCents,
      // Hidden/unmounted → submits nothing (R6); the service layer also
      // backstops this on both create and update.
      installedDate: isMounted ? values.installedDate || null : null,
      // Unlike installedDate, acquiredDate is never gated by mount state —
      // it records ownership, not mounting — and blanking it persists as
      // null (clearable), matching firearm.acquiredDate (R22).
      acquiredDate: values.acquiredDate || null,
    };
    const found = validateAccessory(fields);
    setCodes(found);
    if (found.length > 0) {
      if (found.includes("invalidAccessoryType")) {
        document.getElementById(typeId)?.focus();
      } else if (
        found.includes("negativeCostCents") ||
        found.includes("invalidCostCents")
      ) {
        document.getElementById(costId)?.focus();
      } else if (found.includes("invalidInstalledDate")) {
        document.getElementById(dateId)?.focus();
      } else if (
        found.includes("invalidAcquiredDate") ||
        found.includes("acquiredDateInFuture")
      ) {
        document.getElementById(acquiredDateId)?.focus();
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
        {categorySuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Type is the required, controlled classification (#23 R1/R14) —
            it decides which subtype's rules apply and is what future
            per-type detail tables key off. Category below stays free text. */}
        <Field
          label="Type"
          controlId={typeId}
          required
          error={firstMessage(codes, ["invalidAccessoryType"])}
        >
          <Select
            id={typeId}
            value={values.type}
            onChange={(e) => set("type", e.target.value)}
            aria-invalid={codes.includes("invalidAccessoryType")}
          >
            <option value="">Select a type…</option>
            {ACCESSORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {accessoryTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        {/* Category is free text and OPTIONAL (#23 R3/KD4) — it captures what
            the owner calls the thing ("red dot mount", "bipod"), which the
            controlled type set deliberately does not enumerate. */}
        <Field label="Category" controlId={categoryId} hint="Optional">
          <Input
            id={categoryId}
            list="accessory-categories"
            value={values.category}
            onChange={(e) => set("category", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
        {/* Acquired date (R22-parity, added during implementation) — unlike
            installed date, never gated by mount state: it records ownership,
            not mounting, so it's always available and always clearable. */}
        <Field
          label="Acquired date"
          controlId={acquiredDateId}
          hint="Optional"
          error={firstMessage(codes, [
            "invalidAcquiredDate",
            "acquiredDateInFuture",
          ])}
        >
          <Input
            id={acquiredDateId}
            type="date"
            value={values.acquiredDate}
            onChange={(e) => set("acquiredDate", e.target.value)}
            aria-invalid={
              codes.includes("invalidAcquiredDate") ||
              codes.includes("acquiredDateInFuture")
            }
          />
        </Field>
        {/* Installed date requires a mount (R6) — hidden and submits nothing
            until one exists: the mount select below on create, or the
            accessory's existing mount on edit. */}
        {isMounted ? (
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
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
            onChange={(e) => {
              const next = e.target.value;
              setFirearmId(next);
              // Clearing the mount hides the installed-date field again;
              // drop any value it held so it can't resurface stale if the
              // owner re-mounts before saving (R6).
              if (next === "") set("installedDate", "");
            }}
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
