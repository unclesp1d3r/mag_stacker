/**
 * Inventory-log entry validation (U1). Pure — no DB, no Next.js. Returns ALL
 * failure codes together (parity with the firearm/magazine/range-session
 * validators). `parentType` must be a log parent family (`LOG_PARENT_TYPES`:
 * firearm, magazine, ammo) — this is a defense-in-depth boundary check so a
 * bad value is rejected here, before authorization or the DB CHECK
 * constraint. `eventType` must be valid for the entry's `parentType` (R2/R3);
 * `occurredAt` is a full timestamp that must not be in the future (past or
 * now only); `notes` is optional and empty/whitespace-only is accepted as
 * empty-not-null (R5).
 *
 * Ammo entries are reconciliations (#100): `countedRounds` is required and
 * must be a whole number from 0 to the int4 maximum; any other family must
 * not carry one (R2, AE10). The on-record snapshot (`recordedRounds`) is not
 * an input — the service reads it under a row lock (KTD2/KTD3).
 */

import type { ParentType } from "@/src/auth/visibility";
import { isStorableCount } from "../ammo/validate";
import { isLogParentType, isValidEventType } from "./constants";

export type LogEntryValidationCode =
  | "invalidParentType"
  | "invalidEventType"
  | "occurredAtInFuture"
  | "invalidOccurredAt"
  | "countedRoundsRequired"
  | "countedRoundsNotAllowed"
  | "negativeCountedRounds"
  | "invalidCountedRounds";

export interface LogEntryInput {
  parentType: ParentType;
  parentId: string;
  eventType: string;
  occurredAt: Date | string;
  notes?: string;
  /** Physically counted rounds — required for an `ammo` parent, absent otherwise. */
  countedRounds?: number;
}

/** Parses `value` into a `Date`, or `null` when it does not represent a real instant. */
function parseOccurredAt(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateCountedRounds(input: LogEntryInput): LogEntryValidationCode[] {
  const isAmmo = input.parentType === "ammo";
  if (input.countedRounds === undefined) {
    return isAmmo ? ["countedRoundsRequired"] : [];
  }
  if (!isAmmo) return ["countedRoundsNotAllowed"];
  if (input.countedRounds < 0) return ["negativeCountedRounds"];
  if (!isStorableCount(input.countedRounds)) return ["invalidCountedRounds"];
  return [];
}

export function validateLogEntry(
  input: LogEntryInput,
): LogEntryValidationCode[] {
  const codes: LogEntryValidationCode[] = [];

  if (!isLogParentType(input.parentType)) {
    codes.push("invalidParentType");
  }

  // Event validity is reported only for a log family — a non-log family
  // already failed above, and its event set is empty by definition.
  if (
    isLogParentType(input.parentType) &&
    !isValidEventType(input.parentType, input.eventType)
  ) {
    codes.push("invalidEventType");
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  if (occurredAt === null) {
    codes.push("invalidOccurredAt");
  } else if (occurredAt.getTime() > Date.now()) {
    codes.push("occurredAtInFuture");
  }

  codes.push(...validateCountedRounds(input));

  return codes;
}
