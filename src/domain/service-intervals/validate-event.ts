/**
 * Service-event validation (service-intervals plan, U8). Pure — no DB, no
 * Next.js — mirroring `validate.ts`'s split from `rules-service.ts`, so
 * `log-service-form.tsx` (a client component) can import this module
 * without ever pulling `events-service.ts` (which imports `@/src/db/client`
 * and, transitively, the server-only `pg` package) into the browser bundle.
 */

import { differenceInCalendarDays, parseISO } from "date-fns";
import { ISO_DATE, isRealCalendarDate } from "@/src/lib/dates";

export interface ServiceEventInput {
  ruleName: string;
  servicedOn: string;
  notes?: string;
}

export type ServiceEventValidationCode =
  | "emptyRuleName"
  | "emptyServicedOn"
  | "invalidServicedOn"
  | "servicedOnInFuture";

/**
 * `servicedOn` must be non-empty, a real calendar date, and not later than
 * `asOf` (U8's log-service form contract) — a service event records
 * something that already happened (R14), so a future date is rejected the
 * same way both here and in the client form that reuses this validator.
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
  } else if (differenceInCalendarDays(parseISO(trimmed), asOf) > 0) {
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
