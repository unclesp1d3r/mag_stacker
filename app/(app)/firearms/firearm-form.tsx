"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { validateFirearm } from "@/src/domain/firearms/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { createFirearmAction, updateFirearmAction } from "./actions";

export interface FirearmFormValues {
  id?: string;
  name: string;
  manufacturer: string;
  caliber: string;
  serialNumber: string;
  notes: string;
}

interface FirearmFormProps {
  initial?: FirearmFormValues;
  caliberSuggestions: string[];
  manufacturerSuggestions: string[];
  /** `touchedId` flashes the just-created/edited row. */
  onDone: (touchedId?: string) => void;
  onCancel: () => void;
}

const EMPTY: FirearmFormValues = {
  name: "",
  manufacturer: "",
  caliber: "",
  serialNumber: "",
  notes: "",
};

export function FirearmForm({
  initial,
  caliberSuggestions,
  manufacturerSuggestions,
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
  const serialId = useId();
  const notesId = useId();

  function set<K extends keyof FirearmFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validateFirearm(values);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      const focusId = found.includes("emptyName") ? nameId : calId;
      document.getElementById(focusId)?.focus();
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
