/**
 * Magazine validation (U6, parity digest §2). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together (R26). `addCount` is a context parameter:
 * 1 for single add/edit, the requested count for bulk add (U10). Code order
 * matches the parity §12.2 multi-failure example.
 */

export type MagazineValidationCode =
  | "emptyBrandModel"
  | "emptyCaliber"
  | "baseCapacityTooLow"
  | "negativeExtensionRounds"
  | "addCountTooLow"
  | "addCountTooHigh";

export const MAX_BULK_ADD_COUNT = 1000;

export interface MagazineFields {
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
}

export function validateMagazine(
  input: MagazineFields,
  addCount = 1,
): MagazineValidationCode[] {
  const codes: MagazineValidationCode[] = [];
  if (input.brandModel.trim() === "") codes.push("emptyBrandModel");
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  if (input.baseCapacity < 1) codes.push("baseCapacityTooLow");
  if (input.extensionRounds < 0) codes.push("negativeExtensionRounds");
  if (addCount < 1) codes.push("addCountTooLow");
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
