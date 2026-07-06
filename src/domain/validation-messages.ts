/**
 * User-facing validation messages (parity §16). The same domain validators run
 * client-side (live feedback, R67) and server-side (re-validation, KTD-2); this
 * maps their codes to text so both surfaces speak identically.
 */

import {
  MAGPUL_LABEL_ALLOWED_DESCRIPTION,
  MAX_LABEL_LENGTH,
} from "./magazines/constants";

export const VALIDATION_MESSAGES: Record<string, string> = {
  emptyName: "Name is required",
  emptyCaliber: "Caliber is required",
  invalidType: "Select a valid firearm type",
  invalidAction: "Select a valid firearm action",
  typeRequired: "Choose a firearm type",
  actionRequired: "Choose a firearm action",
  emptyBrandModel: "Brand/model is required",
  baseCapacityTooLow: "Base capacity must be at least 1",
  negativeExtensionRounds: "Extension rounds cannot be negative",
  invalidMagpulLabel: `Label may only contain ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}`,
  magpulLabelTooLong: `Label must be ${MAX_LABEL_LENGTH} characters or fewer`,
  addCountTooLow: "Count must be at least 1",
  addCountTooHigh: "Count is too large (max 1000)",
  invalidRoundsFired: "Rounds fired must be a whole number of at least 1",
  emptyDate: "Date is required",
  invalidDate: "Enter a valid date",
  invalidEventType: "Select a valid event type",
  occurredAtInFuture: "Date/time cannot be in the future",
  invalidOccurredAt: "Enter a valid date and time",
};

export function messageForCode(code: string): string {
  return VALIDATION_MESSAGES[code] ?? "Invalid value";
}

/** First message for a field, given the codes that apply to it. */
export function firstMessage(
  codes: string[],
  forCodes: string[],
): string | undefined {
  const hit = codes.find((c) => forCodes.includes(c));
  return hit ? messageForCode(hit) : undefined;
}
