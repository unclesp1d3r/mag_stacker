"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/src/domain/action-result";
import { generateLabels } from "@/src/domain/bulkadd/labels";
import { validateMagazine } from "@/src/domain/magazines/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import {
  bulkAddMagazinesAction,
  createMagazineAction,
  updateMagazineAction,
} from "./actions";

export interface FirearmOption {
  id: string;
  name: string;
  /** Non-sensitive disambiguator for same-named firearms (never the serial, R52). */
  hint?: string;
}

export interface MagazineFormValues {
  id?: string;
  brandModel: string;
  caliber: string;
  baseCapacity: string;
  extensionRounds: string;
  label: string;
  acquiredDate: string;
  notes: string;
  compatibleFirearmIds: string[];
}

const DEFAULTS: MagazineFormValues = {
  brandModel: "",
  caliber: "",
  baseCapacity: "10",
  extensionRounds: "0",
  label: "",
  acquiredDate: "",
  notes: "",
  compatibleFirearmIds: [],
};

const PREVIEW_LIMIT = 6;

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

interface MagazineFormProps {
  initial?: MagazineFormValues;
  firearmOptions: FirearmOption[];
  caliberSuggestions: string[];
  /** `touchedId` flashes the just-created/edited row; omitted for bulk adds. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

export function MagazineForm({
  initial,
  firearmOptions,
  caliberSuggestions,
  onDone,
  onCancel,
}: MagazineFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<MagazineFormValues>(initial ?? DEFAULTS);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [count, setCount] = useState("2");
  const [labelPrefix, setLabelPrefix] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const brandId = useId();
  const calId = useId();
  const baseId = useId();
  const extId = useId();
  const labelId = useId();
  const dateId = useId();
  const notesId = useId();
  const countId = useId();
  const prefixId = useId();

  const addCount = mode === "bulk" ? num(count) : 1;

  const labelPreview = useMemo(() => {
    if (mode !== "bulk") return null;
    if (labelPrefix.trim() === "")
      return "No label numbering (enter a prefix to auto-number).";
    const labels = generateLabels(
      labelPrefix,
      Math.max(0, Math.min(num(count), 1000)),
      1,
    );
    if (labels.length === 0) return null;
    const shown = labels.slice(0, PREVIEW_LIMIT).join(", ");
    const extra = labels.length - PREVIEW_LIMIT;
    return extra > 0 ? `${shown} … (+${extra} more)` : shown;
  }, [mode, labelPrefix, count]);

  function set<K extends keyof MagazineFormValues>(
    key: K,
    value: MagazineFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function toggleFirearm(id: string) {
    setValues((v) => ({
      ...v,
      compatibleFirearmIds: v.compatibleFirearmIds.includes(id)
        ? v.compatibleFirearmIds.filter((x) => x !== id)
        : [...v.compatibleFirearmIds, id],
    }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const fields = {
      brandModel: values.brandModel,
      caliber: values.caliber,
      baseCapacity: num(values.baseCapacity),
      extensionRounds: num(values.extensionRounds),
    };
    const found = validateMagazine(fields, addCount);
    setCodes(found);
    if (found.length > 0) return;

    const baseInput = {
      ...fields,
      label: values.label,
      acquiredDate: values.acquiredDate || null,
      notes: values.notes,
      compatibleFirearmIds: values.compatibleFirearmIds,
    };

    startTransition(async () => {
      let result: ActionResult<{ id?: string; created?: number }>;
      if (isEdit && initial?.id) {
        result = await updateMagazineAction(initial.id, baseInput);
      } else if (mode === "bulk") {
        result = await bulkAddMagazinesAction(
          baseInput,
          addCount,
          labelPrefix,
          {
            idempotencyKey: crypto.randomUUID(),
          },
        );
      } else {
        result = await createMagazineAction(baseInput);
      }
      if (result.ok) {
        if (isEdit) {
          toast({ message: "Changes saved", detail: values.brandModel });
        } else if (mode === "bulk") {
          const n = result.data?.created ?? addCount;
          toast({
            message: `Seated ${n} magazine${n === 1 ? "" : "s"}`,
            detail: labelPrefix.trim()
              ? `Label ${labelPrefix.trim()}`
              : undefined,
            tone: "blaze",
          });
        } else {
          toast({ message: "Magazine seated", detail: values.brandModel });
        }
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
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
      <datalist id="magazine-calibers">
        {caliberSuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {!isEdit ? (
        <div
          className="inline-flex w-fit rounded-[var(--radius)] border border-line-strong bg-paper-sunken p-0.5"
          role="tablist"
          aria-label="Add mode"
        >
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-[calc(var(--radius)-2px)] px-3 py-1 text-sm font-medium capitalize transition-colors",
                mode === m
                  ? "bg-paper-raised text-ink shadow-[var(--shadow-raised)]"
                  : "text-ink-soft",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      ) : null}

      <Field
        label="Brand / model"
        controlId={brandId}
        required
        error={firstMessage(codes, ["emptyBrandModel"])}
      >
        <Input
          id={brandId}
          value={values.brandModel}
          onChange={(e) => set("brandModel", e.target.value)}
          aria-invalid={codes.includes("emptyBrandModel")}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Caliber"
          controlId={calId}
          required
          error={firstMessage(codes, ["emptyCaliber"])}
        >
          <Input
            id={calId}
            list="magazine-calibers"
            value={values.caliber}
            onChange={(e) => set("caliber", e.target.value)}
            aria-invalid={codes.includes("emptyCaliber")}
          />
        </Field>
        <Field
          label="Base capacity"
          controlId={baseId}
          required
          error={firstMessage(codes, ["baseCapacityTooLow"])}
        >
          <Input
            id={baseId}
            type="number"
            min={1}
            value={values.baseCapacity}
            onChange={(e) => set("baseCapacity", e.target.value)}
            aria-invalid={codes.includes("baseCapacityTooLow")}
          />
        </Field>
        <Field
          label="Extension rounds"
          controlId={extId}
          error={firstMessage(codes, ["negativeExtensionRounds"])}
        >
          <Input
            id={extId}
            type="number"
            min={0}
            value={values.extensionRounds}
            onChange={(e) => set("extensionRounds", e.target.value)}
            aria-invalid={codes.includes("negativeExtensionRounds")}
          />
        </Field>
      </div>

      {mode === "single" ? (
        <Field label="Label" controlId={labelId}>
          <Input
            id={labelId}
            value={values.label}
            onChange={(e) => set("label", e.target.value)}
          />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Count"
            controlId={countId}
            required
            error={firstMessage(codes, ["addCountTooLow", "addCountTooHigh"])}
          >
            <Input
              id={countId}
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field
            label="Label prefix"
            controlId={prefixId}
            hint={labelPreview ?? undefined}
          >
            <Input
              id={prefixId}
              value={labelPrefix}
              onChange={(e) => setLabelPrefix(e.target.value)}
            />
          </Field>
        </div>
      )}

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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">
          Compatible firearms
        </legend>
        {firearmOptions.length === 0 ? (
          <p className="text-xs text-ink-faint">
            <Link
              href="/firearms"
              className="font-medium text-blaze underline-offset-2 hover:underline"
            >
              Add a firearm
            </Link>{" "}
            first to link compatibility.
          </p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-[var(--radius)] border border-line bg-paper-raised p-1">
            {firearmOptions.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper-sunken"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--blaze)]"
                  checked={values.compatibleFirearmIds.includes(f.id)}
                  onChange={() => toggleFirearm(f.id)}
                />
                <span>{f.name}</span>
                {f.hint ? (
                  <span className="text-xs text-ink-faint">({f.hint})</span>
                ) : null}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending
            ? mode === "bulk"
              ? `Adding ${addCount}…`
              : "Saving…"
            : isEdit
              ? "Save changes"
              : mode === "bulk"
                ? `Add ${addCount || 0} magazines`
                : "Add magazine"}
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
