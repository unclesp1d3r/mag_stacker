/**
 * Inventory-log entry validation (U1). Pure — no DB, no Next.js. Returns ALL
 * failure codes together (parity with the firearm/magazine/range-session
 * validators). `parentType` must be exactly "firearm" or "magazine" — this is
 * a defense-in-depth boundary check so a bad value is rejected here, before
 * authorization or the DB CHECK constraint, rather than falling through to
 * the magazine branch of `isValidEventType`/authorization. `eventType` must
 * be valid for the entry's `parentType` (R2/R3); `occurredAt` is a full
 * timestamp that must not be in the future (past or now only); `notes` is
 * optional and empty/whitespace-only is accepted as empty-not-null (R5).
 */

import type { ParentType } from "@/src/auth/visibility";
import { isValidEventType } from "./constants";

export type LogEntryValidationCode =
  | "invalidParentType"
  | "invalidEventType"
  | "occurredAtInFuture"
  | "invalidOccurredAt";

export interface LogEntryInput {
  parentType: ParentType;
  parentId: string;
  eventType: string;
  occurredAt: Date | string;
  notes?: string;
}

/** Parses `value` into a `Date`, or `null` when it does not represent a real instant. */
function parseOccurredAt(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateLogEntry(
  input: LogEntryInput,
): LogEntryValidationCode[] {
  const codes: LogEntryValidationCode[] = [];

  if (input.parentType !== "firearm" && input.parentType !== "magazine") {
    codes.push("invalidParentType");
  }

  if (!isValidEventType(input.parentType, input.eventType)) {
    codes.push("invalidEventType");
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  if (occurredAt === null) {
    codes.push("invalidOccurredAt");
  } else if (occurredAt.getTime() > Date.now()) {
    codes.push("occurredAtInFuture");
  }

  return codes;
}
