"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/src/domain/action-result";
import type { ServiceEventRow } from "@/src/domain/service-intervals/events-service";
import {
  type ServiceEventInput,
  validateServiceEventInput,
} from "@/src/domain/service-intervals/validate-event";
import { firstMessage } from "@/src/domain/validation-messages";

/**
 * The log-service action form (U8, R14) — one rule, a date, and optional
 * notes. `ruleName` is fixed by which rule's "Log service" button opened
 * this form (not a user-facing field), matching F2's per-rule logging flow.
 * Validated client-side with the SAME `validateServiceEventInput` the
 * server enforces (`events-service.ts`), including the future-date rejection
 * (`servicedOnInFuture`) — a service event records something that already
 * happened.
 */

const DATE_CODES = [
  "emptyServicedOn",
  "invalidServicedOn",
  "servicedOnInFuture",
];

/** Today's calendar date (KTD5 default), local time — mirrors `range-session-form.tsx`'s `todayIso`. */
function todayIso(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

export interface LogServiceFormProps {
  ruleName: string;
  onSubmit: (
    input: ServiceEventInput,
  ) => Promise<ActionResult<{ event: ServiceEventRow }>>;
  onCancel: () => void;
  onSaved: () => void;
}

export function LogServiceForm({
  ruleName,
  onSubmit,
  onCancel,
  onSaved,
}: LogServiceFormProps) {
  const [servicedOn, setServicedOn] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const notesId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ServiceEventInput = { ruleName, servicedOn, notes };
    const found = validateServiceEventInput(input);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      document.getElementById(dateId)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await onSubmit(input);
      if (result.ok) {
        onSaved();
      } else if (result.codes) {
        setCodes(result.codes);
      } else {
        setServerError(result.error ?? "Could not log service.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      aria-label={`Log service — ${ruleName}`}
      className="flex flex-col gap-3 rounded-md border border-input p-3"
      noValidate
    >
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      <Field
        label="Date serviced"
        controlId={dateId}
        required
        error={firstMessage(codes, DATE_CODES)}
      >
        <Input
          id={dateId}
          type="date"
          value={servicedOn}
          onChange={(e) => setServicedOn(e.target.value)}
          aria-invalid={DATE_CODES.some((c) => codes.includes(c))}
        />
      </Field>
      <Field label="Notes" controlId={notesId}>
        <Textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Logging…" : "Log service"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
