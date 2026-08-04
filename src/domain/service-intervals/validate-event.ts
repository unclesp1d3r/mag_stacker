/**
 * Service-event validation (service-intervals plan, U8). Pure — no DB, no
 * Next.js — mirroring `validate.ts`'s split from `rules-service.ts`, so
 * `log-service-form.tsx` (a client component) can import this module
 * without ever pulling `events-service.ts` (which imports `@/src/db/client`
 * and, transitively, the server-only `pg` package) into the browser bundle.
 */

import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  FUTURE_DATE_TOLERANCE_DAYS,
  ISO_DATE,
  isRealCalendarDate,
} from "@/src/lib/dates";

export interface ServiceEventInput {
  ruleName: string;
  servicedOn: string;
  notes?: string;
}

export type ServiceEventValidationCode =
  | "emptyRuleName"
  | "emptyServicedOn"
  | "invalidServicedOn"
  | "servicedOnInFuture"
  // Thrown by `events-service.ts` (DB-backed; never by the pure validators in
  // this file) — `ruleNotFound` when a submitted `ruleName` no longer
  // resolves against the item's current effective rule set (F2 fix, guards
  // against a rule renamed between render and submit), `bulkTooLarge` when a
  // `logServiceEventsBulk` call exceeds `MAX_BULK_SERVICE_ITEMS` (F6 fix).
  // Both live on this union anyway so every caller of `logServiceEvent` /
  // `logServiceEventsBulk` sees one complete set of possible failure codes.
  | "ruleNotFound"
  | "bulkTooLarge";

/**
 * `servicedOn` must be non-empty, a real calendar date, and not more than
 * `FUTURE_DATE_TOLERANCE_DAYS` after `asOf` (U8's log-service form contract)
 * — a service event records something that already happened (R14), so a
 * future date is rejected the same way both here and in the client form that
 * reuses this validator.
 *
 * The one-day tolerance (F1 fix) exists because `asOf` defaults to the
 * SERVER's clock, not the submitter's: a user whose local calendar day is
 * genuinely ahead of the server's (server on UTC, submitter east of it)
 * would otherwise have their own local "today" — exactly what the client
 * form's `todayIso()` pre-fills — rejected as future for part of every day.
 * See `FUTURE_DATE_TOLERANCE_DAYS`'s doc in `src/lib/dates.ts` for the full
 * rationale; a date more than one day ahead is still a genuine future date
 * and stays rejected.
 *
 * `asOf` defaults to "now" but is an explicit parameter so this stays a pure,
 * deterministic function for tests (KTD5's local-frame calendar-day compare,
 * via `date-fns`'s `differenceInCalendarDays`, matching `derive.ts`).
 */
export function validateServicedOn(
  servicedOn: string,
  asOf: Date = new Date(),
): Array<"emptyServicedOn" | "invalidServicedOn" | "servicedOnInFuture"> {
  const codes: Array<
    "emptyServicedOn" | "invalidServicedOn" | "servicedOnInFuture"
  > = [];
  const trimmed = (servicedOn ?? "").trim();
  if (trimmed === "") {
    codes.push("emptyServicedOn");
  } else if (!ISO_DATE.test(trimmed) || !isRealCalendarDate(trimmed)) {
    codes.push("invalidServicedOn");
  } else if (
    differenceInCalendarDays(parseISO(trimmed), asOf) >
    FUTURE_DATE_TOLERANCE_DAYS
  ) {
    codes.push("servicedOnInFuture");
  }
  return codes;
}

/**
 * Exported for reuse by both `events-service.ts` (server, re-validates
 * before every write) and `log-service-form.tsx` (client, same codes/
 * messages for immediate feedback) — matching the reuse pattern
 * `validateServiceRuleSet` already establishes for the defaults form.
 */
export function validateServiceEventInput(
  input: ServiceEventInput,
  asOf: Date = new Date(),
): ServiceEventValidationCode[] {
  const codes: ServiceEventValidationCode[] = [];
  if (input.ruleName.trim() === "") codes.push("emptyRuleName");
  codes.push(...validateServicedOn(input.servicedOn, asOf));
  return codes;
}
