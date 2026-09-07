"use client";

import type { FormEvent } from "react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Data } from "@/components/ui/typography";
import { MAX_COUNT } from "@/src/domain/ammo/validate";
import { validateLogEntry } from "@/src/domain/inventory-log/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import { reconcileAmmoAction } from "../inventory-log/log-actions";
import { nowLocal } from "../inventory-log/log-entry-form";
import { parseCountInput, previewVariance } from "./variance";

const COUNTED_CODES = [
  "countedRoundsRequired",
  "negativeCountedRounds",
  "invalidCountedRounds",
  // Defense-in-depth codes that cannot fire from this fixed-parent form but
  // must still render (and steal focus) on the count field if they ever do.
  "countedRoundsNotAllowed",
  "invalidParentType",
  "invalidEventType",
];
const OCCURRED_AT_CODES = ["occurredAtInFuture", "invalidOccurredAt"];

interface ReconcileFormProps {
  ammoId: string;
  /** The lot's quantity on record right now — the preview's baseline (R12). */
  quantityOnRecord: number;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Inline "Reconcile…" form (#100 U4, R12). Mirrors `log-entry-form.tsx`:
 * plain `useState`, client-side validation via the domain validator for
 * instant feedback, then the server action; its `ActionResult.codes` merge
 * into the same error state so both paths render identically. The counted
 * field starts empty and the live variance reads an em dash until it parses
 * as a whole number; the preview lives in a polite live region linked to the
 * field so a screen-reader user hears it change (WCAG 2.2 AA).
 */
export function ReconcileForm({
  ammoId,
  quantityOnRecord,
  onDone,
  onCancel,
}: ReconcileFormProps) {
  const { toast } = useToast();
  const [counted, setCounted] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [notes, setNotes] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const countedId = useId();
  const previewId = useId();
  const occurredAtId = useId();
  const notesId = useId();

  const countedInvalid = COUNTED_CODES.some((c) => codes.includes(c));
  const occurredAtInvalid = OCCURRED_AT_CODES.some((c) => codes.includes(c));

  function focusFirstInvalid(found: readonly string[]): void {
    if (found.length === 0) return;
    const targetId = COUNTED_CODES.some((c) => found.includes(c))
      ? countedId
      : occurredAtId;
    document.getElementById(targetId)?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The datetime-local value has no timezone; the Date constructor treats
    // it as local time, matching what the picker showed the user.
    const occurredAtDate = new Date(occurredAt);
    const countedRounds = parseCountInput(counted);
    const found = validateLogEntry({
      parentType: "ammo",
      parentId: ammoId,
      eventType: "inventoried",
      occurredAt: occurredAtDate,
      countedRounds,
    });
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      focusFirstInvalid(found);
      return;
    }
    startTransition(async () => {
      const result = await reconcileAmmoAction(ammoId, {
        countedRounds,
        occurredAt: occurredAtDate,
        notes,
      });
      if (result.ok) {
        toast({ message: "Reconciled", detail: `${countedRounds} rounds` });
        onDone();
      } else if (result.codes) {
        setCodes(result.codes);
        focusFirstInvalid(result.codes);
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  const countedDescribedBy = [
    previewId,
    countedInvalid ? `${countedId}-error` : null,
  ]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Counted rounds"
          controlId={countedId}
          required
          error={firstMessage(codes, COUNTED_CODES)}
        >
          <Input
            id={countedId}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_COUNT}
            step={1}
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            aria-invalid={countedInvalid}
            aria-describedby={countedDescribedBy}
          />
          <p
            id={previewId}
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            On record <Data>{quantityOnRecord}</Data> · Variance{" "}
            <Data>{previewVariance(counted, quantityOnRecord)}</Data>
          </p>
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
            aria-invalid={occurredAtInvalid}
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
          {pending ? "Saving…" : "Reconcile"}
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
