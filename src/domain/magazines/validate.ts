/**
 * Magazine validation (U6, parity digest §2). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together (R26). `addCount` is a context parameter:
 * 1 for single add/edit, the requested count for bulk add (U10). Code order
 * matches the parity §12.2 multi-failure example.
 *
 * `context` carries owner-mode and label change-detection for Magpul label
 * constraint (U3, KTD-2). The caller resolves owner mode from the DB; the
 * validator stays pure.
 */

import {
  MAGPUL_LABEL_ALLOWED_RE,
  MAX_LABEL_LENGTH,
  normalizeMagpulLabel,
} from "./constants";

export type MagazineValidationCode =
  | "emptyBrandModel"
  | "emptyCaliber"
  | "baseCapacityTooLow"
  | "baseCapacityInvalid"
  | "negativeExtensionRounds"
  | "extensionRoundsInvalid"
  | "invalidMagpulLabel"
  | "magpulLabelTooLong"
  | "addCountTooLow"
  | "addCountTooHigh";

export const MAX_BULK_ADD_COUNT = 1000;

/**
 * Postgres int4 max (#53). Numeric fields are validated as whole numbers within
 * this bound so an oversized or non-integer value fails with a field error
 * instead of a raw out-of-range DB error. Mirrors `MAX_COUNT` in the ammo
 * validator — see docs/solutions/logic-errors/num-helper-coerces-nan-to-zero-bypassing-ammo-validation.md.
 */
export const MAX_COUNT = 2_147_483_647;

/** True when `n` is a whole number the int4 columns can store. Rejects NaN. */
function isStorableCount(n: number): boolean {
  return Number.isInteger(n) && n <= MAX_COUNT;
}

export interface MagazineFields {
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
}

/**
 * Context for the Magpul label constraint (U3, KTD-2).
 *
 * - `ownerMagpulMode`: the magazine owner's Magpul mode flag. Required — a
 *   caller that supplies this context must state the governing mode, so the
 *   label check can never be silently skipped by forgetting to pass it.
 * - `label`: the submitted label value (undefined → label not being changed)
 * - `previousLabel`: stored label on update; undefined on create (any defined
 *   label is treated as a change)
 */
export interface MagazineValidationContext {
  ownerMagpulMode: boolean;
  label?: string;
  previousLabel?: string;
}

export function validateMagazine(
  input: MagazineFields,
  addCount = 1,
  context?: MagazineValidationContext,
): MagazineValidationCode[] {
  const codes: MagazineValidationCode[] = [];
  if (input.brandModel.trim() === "") codes.push("emptyBrandModel");
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  if (input.baseCapacity < 1) codes.push("baseCapacityTooLow");
  else if (!isStorableCount(input.baseCapacity))
    codes.push("baseCapacityInvalid");
  if (input.extensionRounds < 0) codes.push("negativeExtensionRounds");
  else if (!isStorableCount(input.extensionRounds))
    codes.push("extensionRoundsInvalid");
  if (context?.ownerMagpulMode === true && context.label !== undefined) {
    const isChanged =
      context.previousLabel === undefined ||
      context.label !== context.previousLabel;
    if (isChanged) {
      const normalized = normalizeMagpulLabel(context.label);
      if (!MAGPUL_LABEL_ALLOWED_RE.test(normalized))
        codes.push("invalidMagpulLabel");
      if (normalized.length > MAX_LABEL_LENGTH)
        codes.push("magpulLabelTooLong");
    }
  }
  // `!Number.isInteger` also rejects NaN from an unparseable/cleared bulk-count
  // field (the same class of bug as baseCapacity/extensionRounds above).
  if (!Number.isInteger(addCount) || addCount < 1) codes.push("addCountTooLow");
  if (addCount > MAX_BULK_ADD_COUNT) codes.push("addCountTooHigh");
  return codes;
}

/** Derived, never stored (R25): EffectiveCapacity = BaseCapacity + ExtensionRounds. */
export function effectiveCapacity(m: {
  baseCapacity: number;
  extensionRounds: number;
}): number {
  return m.baseCapacity + m.extensionRounds;
}
