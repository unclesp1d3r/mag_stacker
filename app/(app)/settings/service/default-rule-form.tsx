"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/src/domain/action-result";
import { MIN_THRESHOLD } from "@/src/domain/service-intervals/constants";
import {
  type ServiceRuleInput,
  validateServiceRuleSet,
} from "@/src/domain/service-intervals/validate";
import { firstMessage } from "@/src/domain/validation-messages";
import type { CategoryDefaultRule } from "./types";

/**
 * The rule-name-plus-three-thresholds shape shared by every rule-editing
 * surface in the service-intervals feature (U7/U8): `ServiceRuleForm` below
 * is the ONE add/edit form for a name-plus-three-thresholds rule, used for
 * editing a category default (`CategorySectionCard` in
 * `service-defaults-form.tsx`) AND for a firearm/accessory's own item rules
 * (override an inherited default, or add an item-only rule — see
 * `service-rules-panel.tsx` in `app/(app)/firearms/`). Arming a brand-new
 * accessory category (`AddAccessoryCategoryPanel`, also in
 * `service-defaults-form.tsx`) has an extra category field ahead of the rule
 * fields and a different single-button footer, so it composes `ThresholdInputs`
 * and this file's helpers directly rather than wrapping `ServiceRuleForm`.
 *
 * The two prior near-duplicate components (a settings-only `DefaultRuleForm`
 * taking `siblings: CategoryDefaultRule[]`, and a firearms-only
 * `ServiceRuleForm` taking `siblingNames: string[]` plus a `nameLocked` flag)
 * collapsed into this single component once `siblingNames: string[]` proved
 * sufficient for both: `validateServiceRuleSet`'s duplicate-name check only
 * reads `name` off sibling entries, and marking every one `suppressed: true`
 * short-circuits its `missingThreshold`/`thresholdTooLow` checks for a
 * fabricated sibling exactly the way an already-valid real default's
 * thresholds would anyway (they can never fail those checks — they were
 * validated when created).
 */

export interface RuleFieldValues {
  name: string;
  days: string;
  sessions: string;
  rounds: string;
}

export const EMPTY_RULE_VALUES: RuleFieldValues = {
  name: "",
  days: "",
  sessions: "",
  rounds: "",
};

export const NAME_CODES = ["emptyName", "duplicateName"];
export const THRESHOLD_CODES = ["thresholdTooLow", "missingThreshold"];

export function toRuleValues(rule: CategoryDefaultRule): RuleFieldValues {
  return {
    name: rule.name,
    days: rule.intervalDays?.toString() ?? "",
    sessions: rule.intervalSessions?.toString() ?? "",
    rounds: rule.intervalRounds?.toString() ?? "",
  };
}

export function toRuleInput(values: RuleFieldValues): ServiceRuleInput {
  return {
    name: values.name,
    intervalDays: values.days === "" ? null : Number(values.days),
    intervalSessions: values.sessions === "" ? null : Number(values.sessions),
    intervalRounds: values.rounds === "" ? null : Number(values.rounds),
  };
}

interface ThresholdInputsProps {
  values: RuleFieldValues;
  onChange: (axis: "days" | "sessions" | "rounds", value: string) => void;
  ids: { days: string; sessions: string; rounds: string };
  error?: string;
  errorId: string;
  invalid: boolean;
}

/** The three threshold fields shared by every rule form (add or edit). */
export function ThresholdInputs({
  values,
  onChange,
  ids,
  error,
  errorId,
  invalid,
}: ThresholdInputsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Days" controlId={ids.days}>
          <Input
            id={ids.days}
            type="number"
            inputMode="numeric"
            min={MIN_THRESHOLD}
            step={1}
            value={values.days}
            onChange={(e) => onChange("days", e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
        </Field>
        <Field label="Range sessions" controlId={ids.sessions}>
          <Input
            id={ids.sessions}
            type="number"
            inputMode="numeric"
            min={MIN_THRESHOLD}
            step={1}
            value={values.sessions}
            onChange={(e) => onChange("sessions", e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
        </Field>
        <Field label="Rounds fired" controlId={ids.rounds}>
          <Input
            id={ids.rounds}
            type="number"
            inputMode="numeric"
            min={MIN_THRESHOLD}
            step={1}
            value={values.rounds}
            onChange={(e) => onChange("rounds", e.target.value)}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
        </Field>
      </div>
      <p
        id={errorId}
        role={error ? "alert" : undefined}
        className={
          error
            ? "text-xs font-medium text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {error ?? "Set at least one threshold — whichever comes first is due."}
      </p>
    </div>
  );
}

export interface ServiceRuleFormProps {
  initial?: RuleFieldValues;
  /**
   * Every OTHER rule name already in this set (active + suppressed),
   * excluding the one being edited — a category's sibling defaults, or an
   * item's sibling rules. `validateServiceRuleSet` only reads `name` off
   * these (see this file's top comment), so callers pass names, not full
   * rows.
   */
  siblingNames: string[];
  /**
   * Locks the name field — set when overriding a default-backed item rule,
   * whose name must stay the default's name to keep resolving as that same
   * rule. Never set for a category default (its name IS the rule's identity)
   * or an item-only rule (nothing to keep in sync with).
   */
  nameLocked?: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onSubmit: (input: ServiceRuleInput) => Promise<ActionResult<unknown>>;
  onSaved: () => void;
}

/**
 * Add/edit form for one name-plus-three-thresholds rule: a category default,
 * or a firearm/accessory's own item rule (override or item-only). See this
 * file's top comment for how the two prior near-duplicate components merged
 * into this one.
 */
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
    const siblingInputs: ServiceRuleInput[] = siblingNames.map((name) => ({
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
      // Trimmed here (not just left to the server) because the firearms
      // item-rule actions (`overrideServiceRuleAction`,
      // `addItemOnlyRuleAction`) resolve an existing rule by an exact
      // `row.name === name` string match BEFORE any server-side trim runs
      // (`findItemRuleByName` in `service-actions.ts`) — an untrimmed name
      // with incidental whitespace would miss that match and misfire a
      // create instead of an update. A no-op for the category-default path,
      // whose actions look up the target row by id and trim independently.
      const result = await onSubmit({ ...input, name: input.name.trim() });
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
