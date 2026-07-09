"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  FIREARM_ACTIONS,
  FIREARM_TYPES,
  firearmActionLabel,
  firearmTypeLabel,
  UNSPECIFIED,
} from "@/src/domain/firearms/constants";
import { firearmDisplayName } from "@/src/domain/firearms/display";
import {
  type FirearmValidationCode,
  validateFirearm,
} from "@/src/domain/firearms/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { createFirearmAction, updateFirearmAction } from "./actions";

export interface FirearmFormValues {
  id?: string;
  name: string;
  nickname: string;
  manufacturer: string;
  caliber: string;
  type: string;
  action: string;
  subtype: string;
  serialNumber: string;
  notes: string;
}

interface FirearmFormProps {
  initial?: FirearmFormValues;
  caliberSuggestions: string[];
  manufacturerSuggestions: string[];
  subtypeSuggestions: string[];
  /** `touchedId` flashes the just-created/edited row. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

const EMPTY: FirearmFormValues = {
  name: "",
  nickname: "",
  manufacturer: "",
  caliber: "",
  type: UNSPECIFIED,
  action: UNSPECIFIED,
  subtype: "",
  serialNumber: "",
  notes: "",
};

const TYPE_CODES: FirearmValidationCode[] = ["invalidType", "typeRequired"];
const ACTION_CODES: FirearmValidationCode[] = [
  "invalidAction",
  "actionRequired",
];

interface ClassificationSelectProps {
  id: string;
  label: string;
  options: readonly string[];
  labelFor: (value: string) => string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  codes: string[];
  fieldCodes: FirearmValidationCode[];
}

/** A required taxonomy select (Type / Action) with its placeholder option. */
function ClassificationSelect({
  id,
  label,
  options,
  labelFor,
  placeholder,
  value,
  onChange,
  codes,
  fieldCodes,
}: ClassificationSelectProps) {
  return (
    <Field
      label={label}
      controlId={id}
      required
      error={firstMessage(codes, fieldCodes)}
    >
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={fieldCodes.some((c) => codes.includes(c))}
      >
        {/* Placeholder first (the sentinel is last in the value set). */}
        <option value={UNSPECIFIED}>{placeholder}</option>
        {options
          .filter((o) => o !== UNSPECIFIED)
          .map((o) => (
            <option key={o} value={o}>
              {labelFor(o)}
            </option>
          ))}
      </Select>
    </Field>
  );
}

export function FirearmForm({
  initial,
  caliberSuggestions,
  manufacturerSuggestions,
  subtypeSuggestions,
  onDone,
  onCancel,
}: FirearmFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<FirearmFormValues>(initial ?? EMPTY);
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const nicknameId = useId();
  const mfrId = useId();
  const calId = useId();
  const typeId = useId();
  const actionId = useId();
  const subtypeId = useId();
  const notesId = useId();
  const serialId = useId();

  function set<K extends keyof FirearmFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Focus the first failing field in document order — generalized from the
  // original two-way branch so the new required selects are reachable (R9).
  const focusOrder: Array<{ codes: FirearmValidationCode[]; id: string }> = [
    { codes: ["emptyName"], id: nameId },
    { codes: ["emptyCaliber"], id: calId },
    { codes: TYPE_CODES, id: typeId },
    { codes: ACTION_CODES, id: actionId },
  ];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateFirearm(values);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      const target = focusOrder.find((f) =>
        found.some((c) => f.codes.includes(c)),
      );
      if (target) document.getElementById(target.id)?.focus();
      return;
    }
    startTransition(async () => {
      const result =
        isEdit && initial?.id
          ? await updateFirearmAction(initial.id, values)
          : await createFirearmAction(values);
      if (result.ok) {
        toast({
          message: isEdit ? "Changes saved" : "Firearm logged",
          detail: firearmDisplayName(values),
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
      <datalist id="firearm-calibers">
        {caliberSuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="firearm-manufacturers">
        {manufacturerSuggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="firearm-subtypes">
        {subtypeSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <Field
        label="Name"
        controlId={nameId}
        required
        error={firstMessage(codes, ["emptyName"])}
      >
        <Input
          id={nameId}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          aria-invalid={codes.includes("emptyName")}
        />
      </Field>
      <Field
        label="Nickname"
        controlId={nicknameId}
        hint="Optional — a personal name, shown first in your list."
      >
        <Input
          id={nicknameId}
          value={values.nickname}
          onChange={(e) => set("nickname", e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Manufacturer" controlId={mfrId}>
          <Input
            id={mfrId}
            list="firearm-manufacturers"
            value={values.manufacturer}
            onChange={(e) => set("manufacturer", e.target.value)}
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
            list="firearm-calibers"
            value={values.caliber}
            onChange={(e) => set("caliber", e.target.value)}
            aria-invalid={codes.includes("emptyCaliber")}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ClassificationSelect
          id={typeId}
          label="Type"
          options={FIREARM_TYPES}
          labelFor={firearmTypeLabel}
          placeholder="Select a type…"
          value={values.type}
          onChange={(v) => set("type", v)}
          codes={codes}
          fieldCodes={TYPE_CODES}
        />
        <ClassificationSelect
          id={actionId}
          label="Action"
          options={FIREARM_ACTIONS}
          labelFor={firearmActionLabel}
          placeholder="Select an action…"
          value={values.action}
          onChange={(v) => set("action", v)}
          codes={codes}
          fieldCodes={ACTION_CODES}
        />
      </div>
      <Field
        label="Subtype"
        controlId={subtypeId}
        hint="Optional — e.g. striker-fired, DA/SA, AR-pattern."
      >
        <Input
          id={subtypeId}
          list="firearm-subtypes"
          value={values.subtype}
          onChange={(e) => set("subtype", e.target.value)}
        />
      </Field>
      <Field
        label="Serial number"
        controlId={serialId}
        hint="Never exported to CSV."
      >
        <Input
          id={serialId}
          value={values.serialNumber}
          onChange={(e) => set("serialNumber", e.target.value)}
        />
      </Field>
      <Field label="Notes" controlId={notesId}>
        <Textarea
          id={notesId}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add firearm"}
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
