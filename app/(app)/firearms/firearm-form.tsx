"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  FIREARM_ACTIONS,
  FIREARM_TYPES,
  firearmActionLabel,
  firearmTypeLabel,
  UNSPECIFIED,
} from "@/src/domain/firearms/constants";
import { validateFirearm } from "@/src/domain/firearms/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { createFirearmAction, updateFirearmAction } from "./actions";

export interface FirearmFormValues {
  id?: string;
  name: string;
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
  manufacturer: "",
  caliber: "",
  type: UNSPECIFIED,
  action: UNSPECIFIED,
  subtype: "",
  serialNumber: "",
  notes: "",
};

const TYPE_CODES = ["invalidType", "typeRequired"];
const ACTION_CODES = ["invalidAction", "actionRequired"];

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
  const focusOrder: Array<{ codes: string[]; id: string }> = [
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
          detail: values.name,
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
      {serverError ? <Callout tone="danger">{serverError}</Callout> : null}
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
        <Field
          label="Type"
          controlId={typeId}
          required
          error={firstMessage(codes, TYPE_CODES)}
        >
          <Select
            id={typeId}
            value={values.type}
            onChange={(e) => set("type", e.target.value)}
            aria-invalid={TYPE_CODES.some((c) => codes.includes(c))}
          >
            {FIREARM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === UNSPECIFIED ? "Select a type…" : firearmTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Action"
          controlId={actionId}
          required
          error={firstMessage(codes, ACTION_CODES)}
        >
          <Select
            id={actionId}
            value={values.action}
            onChange={(e) => set("action", e.target.value)}
            aria-invalid={ACTION_CODES.some((c) => codes.includes(c))}
          >
            {FIREARM_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === UNSPECIFIED
                  ? "Select an action…"
                  : firearmActionLabel(a)}
              </option>
            ))}
          </Select>
        </Field>
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
