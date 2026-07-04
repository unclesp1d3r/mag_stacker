/**
 * Range-session validation (#11). Pure — no DB, no Next.js. Returns ALL failure
 * codes together (parity with the firearm/magazine validators). `roundsFired`
 * must be a whole number >= 1 (KTD4); `date` must be a non-empty, parseable ISO
 * calendar date (KTD5 — any valid date, no future-date restriction in v1).
 */

export type RangeSessionValidationCode =
  | "invalidRoundsFired"
  | "emptyDate"
  | "invalidDate";

export interface RangeSessionInput {
  firearmId: string;
  date: string;
  roundsFired: number;
  ammoId?: string | null;
  notes?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date. `Date.parse` NORMALIZES day overflow
 * (e.g. `2026-02-31` → Mar 3) instead of returning NaN, so a round-trip compare
 * against the UTC-normalized ISO date is what rejects impossible days — the
 * Postgres `date` cast would otherwise reject them downstream.
 */
function isRealCalendarDate(date: string): boolean {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === date;
}

export function validateRangeSession(
  input: RangeSessionInput,
): RangeSessionValidationCode[] {
  const codes: RangeSessionValidationCode[] = [];

  if (!Number.isInteger(input.roundsFired) || input.roundsFired < 1) {
    codes.push("invalidRoundsFired");
  }

  const date = (input.date ?? "").trim();
  if (date === "") codes.push("emptyDate");
  else if (!ISO_DATE.test(date) || !isRealCalendarDate(date)) {
    codes.push("invalidDate");
  }

  return codes;
}
