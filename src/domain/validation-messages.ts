/**
 * User-facing validation messages (parity §16). The same domain validators run
 * client-side (live feedback, R67) and server-side (re-validation, KTD-2); this
 * maps their codes to text so both surfaces speak identically.
 */

import {
  MAGPUL_LABEL_ALLOWED_DESCRIPTION,
  MAX_LABEL_LENGTH,
} from "./magazines/constants";
import { MAX_BULK_SERVICE_ITEMS } from "./service-intervals/constants";

export const VALIDATION_MESSAGES: Record<string, string> = {
  emptyName: "Name is required",
  emptyCaliber: "Caliber is required",
  invalidType: "Select a valid firearm type",
  invalidAction: "Select a valid firearm action",
  typeRequired: "Choose a firearm type",
  actionRequired: "Choose a firearm action",
  invalidAcquiredDate: "Enter a valid acquired date",
  acquiredDateInFuture: "Acquired date cannot be in the future",
  emptyBrandModel: "Brand/model is required",
  baseCapacityTooLow: "Base capacity must be at least 1",
  baseCapacityInvalid:
    "Base capacity must be a whole number of at most 2,147,483,647",
  negativeExtensionRounds: "Extension rounds cannot be negative",
  extensionRoundsInvalid:
    "Extension rounds must be a whole number of at most 2,147,483,647",
  invalidMagpulLabel: `Label may only contain ${MAGPUL_LABEL_ALLOWED_DESCRIPTION}`,
  magpulLabelTooLong: `Label must be ${MAX_LABEL_LENGTH} characters or fewer`,
  addCountTooLow: "Count must be at least 1",
  addCountTooHigh: "Count is too large (max 1000)",
  invalidRoundsFired: "Rounds fired must be a whole number of at least 1",
  emptyDate: "Date is required",
  invalidDate: "Enter a valid date",
  invalidParentType: "Invalid inventory item type",
  invalidEventType: "Select a valid event type",
  occurredAtInFuture: "Date/time cannot be in the future",
  invalidOccurredAt: "Enter a valid date and time",
  negativeGrain: "Grain cannot be negative",
  negativeQuantity: "Quantity cannot be negative",
  negativeThreshold: "Low-stock threshold cannot be negative",
  invalidGrain: "Grain must be a whole number of at most 2,147,483,647",
  invalidQuantity: "Quantity must be a whole number of at most 2,147,483,647",
  invalidThreshold:
    "Low-stock threshold must be a whole number of at most 2,147,483,647",
  invalidAccessoryType: "Select a valid accessory type",
  invalidAttachmentType: "Select a valid attachment type",
  negativeCostCents: "Cost cannot be negative",
  invalidCostCents: "Enter a valid cost (up to $21,474,836.47)",
  invalidInstalledDate: "Enter a valid installed date",
  duplicateName: "A rule with this name already exists here",
  thresholdTooLow: "Thresholds must be at least 1",
  missingThreshold: "Set at least one threshold (days, sessions, or rounds)",
  emptyRuleName: "Rule name is required",
  invalidScope: "Select a valid scope (firearm or accessory)",
  invalidCategory: "Category must be text",
  invalidRuleName: "Rule name must be text",
  emptyServicedOn: "Date is required",
  invalidServicedOn: "Enter a valid date",
  servicedOnInFuture: "Date cannot be in the future",
  ruleNotFound:
    "This rule no longer exists on this item — refresh and try again",
  bulkTooLarge: `Cannot mark more than ${MAX_BULK_SERVICE_ITEMS} items serviced at once`,
  suppressedWithThresholds:
    "A suppressed rule cannot also set thresholds — clear them or turn off suppression",
  // Deliberately generic (#37 KTD2): the blocking magazine may belong to
  // another owner and must not be named or counted here.
  magazineFedHasCompatibleMagazines:
    "Remove this firearm's compatible magazines before marking it non-magazine-fed",
  // The write-side half of the same invariant (#37 R5): a magazine cannot be
  // declared compatible with a firearm that takes no detachable magazines.
  compatibleFirearmNotMagazineFed:
    "One or more selected firearms do not use detachable magazines",
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
