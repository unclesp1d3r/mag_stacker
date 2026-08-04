/**
 * Firearm validation (U5, parity digest §1; extended by the taxonomy plan U3).
 * Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together, not first-only (R20). Trimming is applied
 * only for the empty check; the raw value is what gets persisted (R18/R19).
 *
 * `type`/`action` are gated against the controlled sets (KTD-C): a value outside
 * the set yields `invalidType`/`invalidAction` (R6, reachable only via a crafted
 * request), and the `unspecified` sentinel yields `typeRequired`/`actionRequired`
 * (R7 — a real category must be chosen on every write, including edits of a
 * backfilled row).
 *
 * `acquiredDate` is nullable and, when present, must be a real ISO calendar
 * date (service-intervals plan R22, mirrors `accessories.installedDate` /
 * range-sessions' `date` check). Unlike `magazine`/`ammo`'s acquired date —
 * which the service layer persists unvalidated — a firearm's feeds the
 * service-interval origin date (KTD9), so a malformed value is rejected here
 * rather than left to the Postgres `date` cast.
 */

import { ISO_DATE, isRealCalendarDate } from "@/src/lib/dates";
import { isFirearmAction, isFirearmType, UNSPECIFIED } from "./constants";

export type FirearmValidationCode =
  | "emptyName"
  | "emptyCaliber"
  | "invalidType"
  | "invalidAction"
  | "typeRequired"
  | "actionRequired"
  | "invalidAcquiredDate";

export interface FirearmInput {
  name: string;
  caliber: string;
  type: string;
  action: string;
  /** ISO calendar date (`YYYY-MM-DD`), or null/undefined when unset. */
  acquiredDate?: string | null;
}

export function validateFirearm(input: FirearmInput): FirearmValidationCode[] {
  const codes: FirearmValidationCode[] = [];
  if (input.name.trim() === "") codes.push("emptyName");
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  if (!isFirearmType(input.type)) codes.push("invalidType");
  else if (input.type === UNSPECIFIED) codes.push("typeRequired");
  if (!isFirearmAction(input.action)) codes.push("invalidAction");
  else if (input.action === UNSPECIFIED) codes.push("actionRequired");
  if (input.acquiredDate !== null && input.acquiredDate !== undefined) {
    const date = input.acquiredDate.trim();
    if (date === "" || !ISO_DATE.test(date) || !isRealCalendarDate(date)) {
      codes.push("invalidAcquiredDate");
    }
  }
  return codes;
}
