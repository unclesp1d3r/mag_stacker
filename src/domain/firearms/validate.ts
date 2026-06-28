/**
 * Firearm validation (U5, parity digest §1). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together, not first-only (R20). Trimming is applied
 * only for the empty check; the raw value is what gets persisted (R18/R19).
 */

export type FirearmValidationCode = "emptyName" | "emptyCaliber";

export interface FirearmInput {
  name: string;
  caliber: string;
}

export function validateFirearm(input: FirearmInput): FirearmValidationCode[] {
  const codes: FirearmValidationCode[] = [];
  if (input.name.trim() === "") codes.push("emptyName");
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  return codes;
}
