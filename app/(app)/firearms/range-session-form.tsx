"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { validateRangeSession } from "@/src/domain/range-sessions/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import {
  logRangeSessionAction,
  updateRangeSessionAction,
} from "./session-actions";

export interface RangeSessionFormValues {
  id?: string;
  date: string;
  /** Held as a string for the input; parsed to a number on submit. */
  roundsFired: string;
  notes: string;
}

const DATE_CODES = ["emptyDate", "invalidDate"];
const ROUNDS_CODES = ["invalidRoundsFired"];

/** Today's calendar date (KTD5 default), local time. */
function todayIso(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

interface RangeSessionFormProps {
  firearmId: string;
  initial?: RangeSessionFormValues;
  onDone: () => void;
  onCancel: () => void;
}

export function RangeSessionForm({
  firearmId,
  initial,
  onDone,
  onCancel,
}: RangeSessionFormProps) {
  const { toast } = useToast();
  const isEdit = Boolean(initial?.id);
  const [values, setValues] = useState<RangeSessionFormValues>(
    initial ?? { date: todayIso(), roundsFired: "", notes: "" },
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const roundsId = useId();
  const notesId = useId();

  function set<K extends keyof RangeSessionFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roundsFired = Number(values.roundsFired);
    const found = validateRangeSession({
      firearmId,
      date: values.date,
      roundsFired,
    });
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      document
        .getElementById(
          found.includes("invalidRoundsFired") ? roundsId : dateId,
        )
        ?.focus();
      return;
    }
    startTransition(async () => {
      const payload = { date: values.date, roundsFired, notes: values.notes };
      const result =
        isEdit && initial?.id
          ? await updateRangeSessionAction(initial.id, payload)
          : await logRangeSessionAction({ firearmId, ...payload });
      if (result.ok) {
        toast({
          message: isEdit ? "Session updated" : "Session logged",
          detail: `${roundsFired} rounds`,
        });
        onDone();
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Date"
          controlId={dateId}
          required
          error={firstMessage(codes, DATE_CODES)}
        >
          <Input
            id={dateId}
            type="date"
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            aria-invalid={DATE_CODES.some((c) => codes.includes(c))}
          />
        </Field>
        <Field
          label="Rounds fired"
          controlId={roundsId}
          required
          error={firstMessage(codes, ROUNDS_CODES)}
        >
          <Input
            id={roundsId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={values.roundsFired}
            onChange={(e) => set("roundsFired", e.target.value)}
            aria-invalid={codes.includes("invalidRoundsFired")}
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
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Log session"}
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
