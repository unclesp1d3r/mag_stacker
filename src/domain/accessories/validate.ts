/**
 * Accessory validation (#accessory-nfa plan). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together (parity with the ammo/firearm/magazine
 * validators), not first-only. `category` is the only required text field
 * (mirrors ammo's `caliber`); `brand`/`model`/`serialNumber`/`notes` are
 * optional free text handled entirely by the service layer's empty-not-null
 * defaulting (R18), so they carry no validation code here. `costCents` is
 * nullable (unset cost is unknown, not zero — KTD-7-style) and, when present,
 * must be a non-negative integer within the int4 bound (#53). `installedDate`
 * is nullable and, when present, must be a real ISO calendar date (mirrors
 * range-sessions' `date` check).
 */

export type AccessoryValidationCode =
  | "emptyCategory"
  | "negativeCostCents"
  | "invalidCostCents"
  | "invalidInstalledDate";

/**
 * Upper bound for `costCents`: Postgres int4 max (#53). Validated here so an
 * oversized or non-integer value fails with a field error instead of a raw
 * out-of-range DB error; the form mirrors it as the input's `max`.
 */
export const MAX_COST_CENTS = 2_147_483_647;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date. `Date.parse` NORMALIZES day overflow
 * (e.g. `2026-02-31` → Mar 3) instead of returning NaN, so a round-trip
 * compare against the UTC-normalized ISO date is what rejects impossible
 * days — the Postgres `date` cast would otherwise reject them downstream.
 */
function isRealCalendarDate(date: string): boolean {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === date;
}

export interface AccessoryFields {
  category: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  installedDate?: string | null;
  costCents?: number | null;
  notes?: string;
  isNfa?: boolean;
}

export function validateAccessory(
  input: AccessoryFields,
): AccessoryValidationCode[] {
  const codes: AccessoryValidationCode[] = [];

  if (input.category.trim() === "") codes.push("emptyCategory");

  if (input.costCents !== null && input.costCents !== undefined) {
    if (input.costCents < 0) codes.push("negativeCostCents");
    else if (
      !Number.isInteger(input.costCents) ||
      input.costCents > MAX_COST_CENTS
    ) {
      codes.push("invalidCostCents");
    }
  }

  if (input.installedDate !== null && input.installedDate !== undefined) {
    const date = input.installedDate.trim();
    if (date === "" || !ISO_DATE.test(date) || !isRealCalendarDate(date)) {
      codes.push("invalidInstalledDate");
    }
  }

  return codes;
}
