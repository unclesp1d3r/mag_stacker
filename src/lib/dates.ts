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
 *
 * Year zero is rejected explicitly: `Date.parse("0000-01-01")` succeeds and
 * round-trips to the same string, so the overflow check above lets it
 * through, but there is no year 0 in the SQL-standard proleptic Gregorian
 * calendar Postgres's `date` type uses — an unguarded year-0000 value would
 * pass validation here and fail downstream as a raw, unhandled driver error.
 */
export function isRealCalendarDate(date: string): boolean {
  if (date.startsWith("0000-")) return false;
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

/**
 * Slack allowed, in calendar days, before a submitted date is treated as
 * genuinely in the future — shared by every not-in-the-future check that
 * compares a submitted date against the SERVER's clock (service-intervals'
 * `servicedOn`, firearms' `acquiredDate`).
 *
 * A not-in-the-future check's `asOf` defaults to the server's own
 * `new Date()`, but the submitter's local calendar day is not the server's:
 * no real timezone runs more than ~26 hours ahead of another, so a
 * submitter's genuine local "today" can read as at most one calendar day
 * ahead of the server. Without this slack, a user east of the server (say,
 * Tokyo against a UTC server) submitting their own local today — exactly
 * what `todayIso()` pre-fills into a form by default — would be rejected as
 * "in the future" for part of every day. Anything beyond this one day of
 * slack is a real future date and stays rejected.
 */
export const FUTURE_DATE_TOLERANCE_DAYS = 1;
