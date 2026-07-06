"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/src/domain/action-result";
import { generateLabels } from "@/src/domain/bulkadd/labels";
import {
  MAGPUL_LABEL_ALLOWED_DESCRIPTION,
  MAGPUL_LABEL_DISALLOWED_CHAR_RE,
  MAX_LABEL_LENGTH,
} from "@/src/domain/magazines/constants";
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
  /** The owner's used label prefixes, offered as a datalist for auto-numbering (#22). */
  prefixOptions?: string[];
  /** `prefix -> next sequence number` for single-add label prefill (#22). */
  prefixNextStart?: Record<string, number>;
  /** When true the label field enforces PMAG dot-matrix character constraints. */
  magpulMode: boolean;
  /** `touchedId` flashes the just-created/edited row; omitted for bulk adds. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

export function MagazineForm({
  initial,
  firearmOptions,
  caliberSuggestions,
  prefixOptions = [],
  prefixNextStart = {},
  magpulMode,
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
  const [liveAnnounce, setLiveAnnounce] = useState("");
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    };
  }, []);

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
      labelPrefix.trim(),
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

  function handleLabelChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (!magpulMode) {
      set("label", raw);
      return;
    }
    const upper = raw.toUpperCase();
    const filtered = upper.replace(MAGPUL_LABEL_DISALLOWED_CHAR_RE, "");
    const masked = filtered.slice(0, MAX_LABEL_LENGTH);
    const hadDrop = filtered !== upper || masked !== filtered;
    if (hadDrop) {
      if (announceTimer.current) clearTimeout(announceTimer.current);
      setLiveAnnounce(
        `Filtered to ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}, max ${MAX_LABEL_LENGTH} characters`,
      );
      announceTimer.current = setTimeout(() => setLiveAnnounce(""), 2_000);
    }
    set("label", masked);
  }

  // Apply the Magpul character constraint to a raw prefix (uppercase + filter to
  // the allowed set), announcing when anything was dropped; off-mode passes
  // through untouched. The 4-char cap spans prefix + the auto-number, so it's
  // enforced authoritatively in the domain layer on submit, not by length here.
  // Shared by the bulk and single-add prefix inputs.
  function filterPrefix(raw: string): string {
    if (!magpulMode) return raw;
    const upper = raw.toUpperCase();
    const filtered = upper.replace(MAGPUL_LABEL_DISALLOWED_CHAR_RE, "");
    if (filtered !== upper) {
      if (announceTimer.current) clearTimeout(announceTimer.current);
      setLiveAnnounce(`Filtered to ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}`);
      announceTimer.current = setTimeout(() => setLiveAnnounce(""), 2_000);
    }
    return filtered;
  }

  function handlePrefixChange(e: ChangeEvent<HTMLInputElement>) {
    setLabelPrefix(filterPrefix(e.target.value));
  }

  // Compute the auto-numbered label for a prefix (#22): `prefix + next number`,
  // continuing past the owner's highest matching label. Empty prefix ⇒ no label.
  // A prefix not in the server-computed map starts at 1 (a freshly typed one).
  function prefillLabel(rawPrefix: string): string {
    // Trim to match what the server stores and keys the next-start map by, so a
    // pasted "US " resolves to the real next number instead of falling back to 1.
    const prefix = rawPrefix.trim();
    if (prefix === "") return "";
    const start = Object.hasOwn(prefixNextStart, prefix)
      ? prefixNextStart[prefix]
      : 1;
    const [label] = generateLabels(prefix, 1, start);
    return label ?? "";
  }

  // Single-add prefix control: filter to the allowed set under Magpul mode (like
  // the bulk prefix), then prefill the editable label. Re-prefills on every
  // prefix change; a manual label edit persists until the prefix changes again.
  function handleSinglePrefixChange(e: ChangeEvent<HTMLInputElement>) {
    const prefix = filterPrefix(e.target.value);
    setLabelPrefix(prefix);
    set("label", prefillLabel(prefix));
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
          labelPrefix.trim(),
          {
            idempotencyKey: crypto.randomUUID(),
          },
        );
      } else {
        result = await createMagazineAction(
          baseInput,
          labelPrefix.trim() || undefined,
        );
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
      <datalist id="magazine-prefixes">
        {prefixOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {!isEdit ? (
        <div
          className="inline-flex w-fit rounded-md border border-input bg-muted p-0.5"
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
                "rounded-sm px-3 py-1 text-sm font-medium capitalize transition-colors",
                mode === m
                  ? "bg-card text-foreground shadow-[var(--shadow-raised)]"
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
        <div className="grid gap-4 sm:grid-cols-2">
          {!isEdit ? (
            <Field
              label="Label prefix"
              controlId={prefixId}
              hint="Optional — pick or type to auto-number"
            >
              <Input
                id={prefixId}
                list="magazine-prefixes"
                value={labelPrefix}
                onChange={handleSinglePrefixChange}
                placeholder="e.g. US"
              />
            </Field>
          ) : null}
          <Field
            label="Label"
            controlId={labelId}
            hint={
              magpulMode
                ? `Max ${MAX_LABEL_LENGTH} · ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}`
                : undefined
            }
            error={firstMessage(codes, [
              "invalidMagpulLabel",
              "magpulLabelTooLong",
            ])}
          >
            <Input
              id={labelId}
              value={values.label}
              onChange={handleLabelChange}
              aria-invalid={
                codes.includes("invalidMagpulLabel") ||
                codes.includes("magpulLabelTooLong")
              }
            />
          </Field>
        </div>
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
            hint={
              magpulMode
                ? [
                    `Max ${MAX_LABEL_LENGTH} incl. number · ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}`,
                    labelPreview,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : (labelPreview ?? undefined)
            }
            error={
              magpulMode
                ? firstMessage(codes, [
                    "invalidMagpulLabel",
                    "magpulLabelTooLong",
                  ])
                : undefined
            }
          >
            <Input
              id={prefixId}
              list="magazine-prefixes"
              value={labelPrefix}
              onChange={handlePrefixChange}
              aria-invalid={
                magpulMode &&
                (codes.includes("invalidMagpulLabel") ||
                  codes.includes("magpulLabelTooLong"))
              }
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
        <legend className="text-sm font-medium text-foreground">
          Compatible firearms
        </legend>
        {firearmOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <Link
              href="/firearms"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Add a firearm
            </Link>{" "}
            first to link compatibility.
          </p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-card p-1">
            {firearmOptions.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={values.compatibleFirearmIds.includes(f.id)}
                  onChange={() => toggleFirearm(f.id)}
                />
                <span>{f.name}</span>
                {f.hint ? (
                  <span className="text-xs text-muted-foreground">
                    ({f.hint})
                  </span>
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
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnounce}
      </span>
    </form>
  );
}
