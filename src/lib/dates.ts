/**
 * Shared calendar-date helpers. Pure — no DB, no Next.js. Used by every
 * domain validator that accepts a plain `YYYY-MM-DD` string (firearms'
 * `acquiredDate`, accessories' `installedDate`, range-sessions' `date`,
 * service-intervals' `servicedOn`) — previously four byte-identical copies,
 * now defined once here — and by client forms that default a date field to
 * today (`range-session-form.tsx`, `log-service-form.tsx`).
 */

import { format } from "date-fns";

/** Matches a `YYYY-MM-DD` string shape; does not by itself confirm the date is real (see `isRealCalendarDate`). */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date. `Date.parse` NORMALIZES day overflow
 * (e.g. `2026-02-31` → Mar 3) instead of returning NaN, so a round-trip
 * compare against the UTC-normalized ISO date is what rejects impossible
 * days — the Postgres `date` cast would otherwise reject them downstream.
 * Deliberately NOT reimplemented with a date-fns call: this depends
 * specifically on `Date.parse`'s overflow-normalization behavior.
 */
export function isRealCalendarDate(date: string): boolean {
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === date;
}

/**
 * Today's calendar date (KTD5 default), LOCAL time, as `YYYY-MM-DD` — the
 * default value a date field opens to (`range-session-form.tsx`'s session
 * date, `log-service-form.tsx`'s serviced-on date). `date-fns`'s `format`
 * reads local Y/M/D getters directly, verified equivalent to this file's
 * prior manual offset-subtraction/`toISOString().slice(0,10)` trick across
 * timezones and date-boundary instants.
 */
export function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}
