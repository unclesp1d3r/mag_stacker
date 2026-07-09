"use client";

import type { FormEvent } from "react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { ParentType } from "@/src/auth/visibility";
import type { EventType } from "@/src/domain/inventory-log/constants";
import { validateLogEntry } from "@/src/domain/inventory-log/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { logEventAction } from "./log-actions";

// Codes that belong to the event-type field. `invalidParentType` is a
// defense-in-depth boundary check in the validator (it should never fire
// from this form, since `parentType` is fixed by the surrounding page), but
// it must still render — and steal focus — on the event-type field rather
// than being silently swallowed.
const EVENT_TYPE_CODES = ["invalidEventType", "invalidParentType"];
const OCCURRED_AT_CODES = ["occurredAtInFuture", "invalidOccurredAt"];

/** Display label for a stored event type ("cleaned" -> "Cleaned"). */
export function eventTypeLabel(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

/**
 * The `datetime-local` value for "now", to the minute, in the browser's local
 * time zone (matches the `<input type="datetime-local">` wire format, which
 * carries no timezone of its own).
 */
function nowLocal(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

interface LogEntryFormProps {
  parentType: ParentType;
  parentId: string;
  /** The parent-appropriate event-type set (R11) — firearm surfaces maintenance types. */
  eventTypes: readonly EventType[];
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Inline "Log…" form (U4). Plain `useState` (not react-hook-form), mirroring
 * `range-session-form.tsx`: client-side validate via the domain validator for
 * instant feedback, then call the server action; merge its `ActionResult.codes`
 * into the same error state so both validation paths render identically.
 */
export function LogEntryForm({
  parentType,
  parentId,
  eventTypes,
  onDone,
  onCancel,
}: LogEntryFormProps) {
  const { toast } = useToast();
  const [eventType, setEventType] = useState<string>(eventTypes[0] ?? "");
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const eventTypeId = useId();
  const occurredAtId = useId();
  const notesId = useId();

  /**
   * Move focus to the first invalid field so a screen-reader user gets a
   * cue after either validation path — client-side (below) or the
   * server-side `result.codes` branch, which previously set codes but never
   * moved focus (WCAG 2.2 AA). Event-type errors take priority since they
   * render first in the form.
   */
  function focusFirstInvalid(found: readonly string[]): void {
    if (found.length === 0) return;
    const targetId = EVENT_TYPE_CODES.some((c) => found.includes(c))
      ? eventTypeId
      : occurredAtId;
    document.getElementById(targetId)?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The datetime-local value has no timezone of its own; the Date
    // constructor treats a timezone-less date-time string as local time,
    // matching what the picker showed the user.
    const occurredAtDate = new Date(occurredAt);
    const found = validateLogEntry({
      parentType,
      parentId,
      eventType,
      occurredAt: occurredAtDate,
    });
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      focusFirstInvalid(found);
      return;
    }
    startTransition(async () => {
      const result = await logEventAction({
        parentType,
        parentId,
        eventType,
        occurredAt: occurredAtDate,
        notes,
      });
      if (result.ok) {
        toast({ message: "Logged", detail: eventTypeLabel(eventType) });
        onDone();
      } else if (result.codes) {
        setCodes(result.codes);
        focusFirstInvalid(result.codes);
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Event type"
          controlId={eventTypeId}
          required
          error={firstMessage(codes, EVENT_TYPE_CODES)}
        >
          <Select
            id={eventTypeId}
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            aria-invalid={EVENT_TYPE_CODES.some((c) => codes.includes(c))}
          >
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {eventTypeLabel(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Date & time"
          controlId={occurredAtId}
          required
          error={firstMessage(codes, OCCURRED_AT_CODES)}
        >
          <Input
            id={occurredAtId}
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            aria-invalid={OCCURRED_AT_CODES.some((c) => codes.includes(c))}
          />
        </Field>
      </div>
      <Field label="Notes" controlId={notesId}>
        <Textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log"}
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
