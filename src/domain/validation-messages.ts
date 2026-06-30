/**
 * User-facing validation messages (parity §16). The same domain validators run
 * client-side (live feedback, R67) and server-side (re-validation, KTD-2); this
 * maps their codes to text so both surfaces speak identically.
 */
export const VALIDATION_MESSAGES: Record<string, string> = {
  emptyName: "Name is required",
  emptyCaliber: "Caliber is required",
  emptyBrandModel: "Brand/model is required",
  baseCapacityTooLow: "Base capacity must be at least 1",
  negativeExtensionRounds: "Extension rounds cannot be negative",
  addCountTooLow: "Count must be at least 1",
  addCountTooHigh: "Count is too large (max 1000)",
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
