/**
 * Service-rule validation (service-intervals plan, U2). Pure — no DB, no
 * Next.js. Returns ALL failure codes together over a submitted SET of rules
 * (a category default set, or one item's rules), matching the all-codes-
 * together shape of `validateLogEntry` / `validateMagazine`. Duplicate-name
 * detection only makes sense across a set, so this validator always takes an
 * array rather than one rule at a time.
 */

import { MIN_THRESHOLD } from "./constants";

export type ServiceRuleValidationCode =
  | "emptyName"
  | "duplicateName"
  | "thresholdTooLow"
  | "missingThreshold";

export interface ServiceRuleInput {
  name: string;
  suppressed?: boolean;
  intervalDays?: number | null;
  intervalSessions?: number | null;
  intervalRounds?: number | null;
}

function isSetThreshold(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

function hasAnyThreshold(rule: ServiceRuleInput): boolean {
  return (
    isSetThreshold(rule.intervalDays) ||
    isSetThreshold(rule.intervalSessions) ||
    isSetThreshold(rule.intervalRounds)
  );
}

function hasThresholdBelowMin(rule: ServiceRuleInput): boolean {
  return [rule.intervalDays, rule.intervalSessions, rule.intervalRounds].some(
    (value) => isSetThreshold(value) && value < MIN_THRESHOLD,
  );
}

/**
 * Validate a submitted set of service rules (a category default set, or one
 * item's rule rows), returning every applicable failure code across the
 * whole set (R2, KTD6):
 * - `emptyName` — a rule name is empty or whitespace-only.
 * - `duplicateName` — two rules in this same set share a (trimmed) name.
 * - `thresholdTooLow` — a set threshold is below `MIN_THRESHOLD` (zero or negative).
 * - `missingThreshold` — a rule sets no threshold and is not suppressed.
 */
export function validateServiceRuleSet(
  rules: ServiceRuleInput[],
): ServiceRuleValidationCode[] {
  const codes = new Set<ServiceRuleValidationCode>();
  const seenNames = new Set<string>();

  for (const rule of rules) {
    const trimmedName = rule.name.trim();
    if (trimmedName === "") {
      codes.add("emptyName");
    } else if (seenNames.has(trimmedName)) {
      codes.add("duplicateName");
    } else {
      seenNames.add(trimmedName);
    }

    if (hasThresholdBelowMin(rule)) codes.add("thresholdTooLow");

    if (rule.suppressed !== true && !hasAnyThreshold(rule)) {
      codes.add("missingThreshold");
    }
  }

  return [...codes];
}
