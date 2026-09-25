/**
 * Pure helpers for ammo reconciliation display (#100 U4). No React, no DB, so
 * the Reconcile form's live preview and the history's Variance / Not applied
 * cells are unit-testable in isolation.
 */

import { isStorableCount } from "@/src/domain/ammo/validate";

/** Unicode minus, matching the app's typographic em dash for absent values. */
const MINUS = "−";
const NO_VALUE = "—";

/** Variance is the observation minus the record (R4): `counted − recorded`. */
export function computeVariance(counted: number, recorded: number): number {
  return counted - recorded;
}

/** Signed rendering: `+20`, `−20`, or a plain `0`. */
export function formatVariance(variance: number): string {
  if (variance > 0) return `+${variance}`;
  if (variance < 0) return `${MINUS}${Math.abs(variance)}`;
  return "0";
}

/**
 * Parse a numeric text input without laundering bad input into a value.
 * Cleared (`Number("")` is 0!) or unparseable text becomes NaN so the domain
 * validator rejects it visibly (see
 * docs/solutions/logic-errors/num-helper-coerces-nan-to-zero-bypassing-ammo-validation.md).
 */
export function parseCountInput(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/**
 * The form's live variance preview (R12): an em dash until the field holds a
 * storable whole number, then the signed variance against the quantity on
 * record. The server snapshot is authoritative; this is a courtesy.
 */
export function previewVariance(
  countedInput: string,
  quantityOnRecord: number,
): string {
  const counted = parseCountInput(countedInput);
  if (Number.isNaN(counted) || counted < 0 || !isStorableCount(counted)) {
    return NO_VALUE;
  }
  return formatVariance(computeVariance(counted, quantityOnRecord));
}

interface DatedEntry {
  id: string;
  occurredAt: Date | string;
  createdAt: Date | string;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Whether a reconciliation's count owned the lot's quantity when it was
 * written (KTD5). The service skips the quantity update when a later-dated
 * count already existed, and that condition is fully derivable from the
 * history: the entry is NOT applied when some other entry is dated later
 * and was created earlier.
 */
export function isCountApplied(
  entry: DatedEntry,
  entries: readonly DatedEntry[],
): boolean {
  const occurred = ms(entry.occurredAt);
  const created = ms(entry.createdAt);
  return !entries.some(
    (other) =>
      other.id !== entry.id &&
      ms(other.occurredAt) > occurred &&
      ms(other.createdAt) < created,
  );
}
