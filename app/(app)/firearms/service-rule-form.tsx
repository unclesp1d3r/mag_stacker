"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import {
  EMPTY_RULE_VALUES,
  NAME_CODES,
  type RuleFieldValues,
  THRESHOLD_CODES,
  ThresholdInputs,
  toRuleInput,
} from "@/app/(app)/settings/service/default-rule-form";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/src/domain/action-result";
import { validateServiceRuleSet } from "@/src/domain/service-intervals/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import type { RuleThresholdInput } from "./service-actions";

/**
 * The rule-editing form behind the "Override" and "Add item-only rule"
 * actions (U8) — name plus the three threshold fields, reusing the exact
 * field group, codes, and validation messages the service-defaults settings
 * form (`default-rule-form.tsx`, U7) already established, per the plan's
 * explicit instruction to surface the same messages rather than a second
 * copy. Duplicate-name detection is client-side against `siblingNames`
 * (every OTHER rule name already on this item, active or suppressed) before
 * ever calling the server, matching `DefaultRuleForm`'s pattern.
 */

export interface ServiceRuleFormProps {
  initial?: RuleFieldValues;
  /** Every other rule name already on this item (active + suppressed), excluding the one being edited. */
  siblingNames: string[];
  /** Locks the name field — set when overriding a default-backed rule, whose name must stay the default's name to keep resolving as that same rule. */
  nameLocked?: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onSubmit: (input: RuleThresholdInput) => Promise<ActionResult<unknown>>;
  onSaved: () => void;
}

export function ServiceRuleForm({
  initial,
  siblingNames,
  nameLocked = false,
  submitLabel,
  pendingLabel,
  onCancel,
  onSubmit,
  onSaved,
}: ServiceRuleFormProps) {
  const [values, setValues] = useState<RuleFieldValues>(
    initial ?? EMPTY_RULE_VALUES,
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const thresholdsErrorId = useId();
  const ids = { days: useId(), sessions: useId(), rounds: useId() };

  function set(key: keyof RuleFieldValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = toRuleInput(values);
    const siblingInputs = siblingNames.map((name) => ({
      name,
      suppressed: true,
    }));
    const found = validateServiceRuleSet([...siblingInputs, input]);
    setCodes(found);
    setServerError(null);
    if (found.length > 0) {
      const nameInvalid = found.some((c) => NAME_CODES.includes(c));
      document.getElementById(nameInvalid ? nameId : ids.days)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await onSubmit({
        name: input.name.trim(),
        intervalDays: input.intervalDays ?? null,
        intervalSessions: input.intervalSessions ?? null,
        intervalRounds: input.intervalRounds ?? null,
      });
      if (result.ok) {
        onSaved();
      } else if (result.codes) {
        setCodes(result.codes);
      } else {
        setServerError(result.error ?? "Could not save.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-input p-3"
      noValidate
    >
      {serverError ? <Callout tone="destructive">{serverError}</Callout> : null}
      <Field
        label="Rule name"
        controlId={nameId}
        required
        error={firstMessage(codes, NAME_CODES)}
      >
        <Input
          id={nameId}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          aria-invalid={NAME_CODES.some((c) => codes.includes(c))}
          disabled={nameLocked}
        />
      </Field>
      <ThresholdInputs
        values={values}
        onChange={set}
        ids={ids}
        error={firstMessage(codes, THRESHOLD_CODES)}
        errorId={thresholdsErrorId}
        invalid={THRESHOLD_CODES.some((c) => codes.includes(c))}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
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
