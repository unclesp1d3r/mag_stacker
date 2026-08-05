/**
 * Accessory validation (#8 plan). Pure — no DB, no Next.js.
 *
 * Returns ALL failure codes together (parity with the ammo/firearm/magazine
 * validators), not first-only. `type` is the only required field (#23 R1) —
 * it must name a member of the controlled `ACCESSORY_TYPES` set, mirroring
 * `validateFirearm`'s `isFirearmType` check. `category` was required under #8
 * and is now optional free text (#23 R3): `type` carries the required
 * classification, so demanding both would make the form ask for two
 * overlapping required answers. `brand`/`model`/`serialNumber`/`notes` are
 * optional free text handled entirely by the service layer's empty-not-null
 * defaulting (R18), so they carry no validation code here. `costCents` is
 * nullable (unset cost is unknown, not zero) and, when present,
 * must be a non-negative integer within the int4 bound (#53). `installedDate`
 * is nullable and, when present, must be a real ISO calendar date (mirrors
 * range-sessions' `date` check).
 *
 * `acquiredDate` is nullable and, when present, must be a real ISO calendar
 * date, and not more than `FUTURE_DATE_TOLERANCE_DAYS` after `asOf` — added
 * during implementation, mirroring `firearm.acquiredDate`'s validator
 * (service-intervals plan R22/KTD9) exactly, including the same one-
 * calendar-day future tolerance and the same reason for it: `asOf` is the
 * SERVER's clock, and a submitter whose local calendar day genuinely runs
 * ahead of it must not be rejected for submitting their own today. It also
 * feeds the service-interval origin date (`due-service.ts`), so a future
 * value would silently freeze that accessory's due state until the clock
 * caught up — rejected here rather than left to the Postgres `date` cast.
 */

import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  FUTURE_DATE_TOLERANCE_DAYS,
  ISO_DATE,
  isRealCalendarDate,
} from "@/src/lib/dates";
import { isAccessoryType } from "./constants";

export type AccessoryValidationCode =
  | "invalidAccessoryType"
  | "negativeCostCents"
  | "invalidCostCents"
  | "invalidInstalledDate"
  | "invalidAcquiredDate"
  | "acquiredDateInFuture";

/**
 * Upper bound for `costCents`: Postgres int4 max (#53). Validated here so an
 * oversized or non-integer value fails with a field error instead of a raw
 * out-of-range DB error; the form mirrors it as the input's `max`.
 */
export const MAX_COST_CENTS = 2_147_483_647;

export interface AccessoryFields {
  /** Controlled structural discriminator (#23 R1). Required. */
  type: string;
  /** Free-text descriptive kind (#23 R3). Optional; empty-not-null on persist. */
  category?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  installedDate?: string | null;
  /** ISO calendar date, or null/undefined when unset. See file header. */
  acquiredDate?: string | null;
  costCents?: number | null;
  notes?: string;
  isNfa?: boolean;
}

/**
 * `asOf` is the reference "now" the not-in-the-future `acquiredDate` check
 * compares against — an explicit parameter (default `new Date()`, the
 * server's clock) so this stays a pure, deterministic function for tests,
 * mirroring `validateFirearm`'s shape exactly.
 */
export function validateAccessory(
  input: AccessoryFields,
  asOf: Date = new Date(),
): AccessoryValidationCode[] {
  const codes: AccessoryValidationCode[] = [];

  // Blank and out-of-set both land here: an unset select and a crafted payload
  // are the same failure to the owner ("pick a real type"), and the
  // `accessory_type_valid` CHECK backstops whatever slips past.
  if (!isAccessoryType(input.type)) codes.push("invalidAccessoryType");

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

  if (input.acquiredDate !== null && input.acquiredDate !== undefined) {
    const date = input.acquiredDate.trim();
    if (date === "" || !ISO_DATE.test(date) || !isRealCalendarDate(date)) {
      codes.push("invalidAcquiredDate");
    } else if (
      differenceInCalendarDays(parseISO(date), asOf) >
      FUTURE_DATE_TOLERANCE_DAYS
    ) {
      codes.push("acquiredDateInFuture");
    }
  }

  return codes;
}
