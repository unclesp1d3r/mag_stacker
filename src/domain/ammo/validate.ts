/**
 * Ammo validation (ammo plan, R8). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together (parity with the firearm/magazine
 * validators), not first-only. `caliber` is the only required text field
 * (R2/AS3); `brand`/`type`/`notes` are optional free text handled entirely
 * by the service layer's empty-not-null defaulting (R18), so they carry no
 * validation code here.
 */

export type AmmoValidationCode =
  | "emptyCaliber"
  | "negativeGrain"
  | "negativeQuantity"
  | "negativeThreshold";

export interface AmmoFields {
  caliber: string;
  grain: number;
  quantityRounds: number;
  lowStockThreshold: number;
}

export function validateAmmo(input: AmmoFields): AmmoValidationCode[] {
  const codes: AmmoValidationCode[] = [];
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  if (input.grain < 0) codes.push("negativeGrain");
  if (input.quantityRounds < 0) codes.push("negativeQuantity");
  if (input.lowStockThreshold < 0) codes.push("negativeThreshold");
  return codes;
}

/**
 * Derived, never stored (R9): a lot is low-stock when its round count has
 * fallen to or below its own threshold. The single source of truth for
 * low-stock — both the list's inline indicator and the `/summary` roll-ups
 * (R10/R11) call this rather than re-deriving the comparison.
 */
export function isLowStock(ammo: {
  quantityRounds: number;
  lowStockThreshold: number;
}): boolean {
  return ammo.quantityRounds <= ammo.lowStockThreshold;
}
