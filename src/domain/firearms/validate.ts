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
 */

import {
  isFirearmAction,
  isFirearmType,
  UNSPECIFIED,
} from "./constants";

export type FirearmValidationCode =
  | "emptyName"
  | "emptyCaliber"
  | "invalidType"
  | "invalidAction"
  | "typeRequired"
  | "actionRequired";

export interface FirearmInput {
  name: string;
  caliber: string;
  type: string;
  action: string;
}

export function validateFirearm(input: FirearmInput): FirearmValidationCode[] {
  const codes: FirearmValidationCode[] = [];
  if (input.name.trim() === "") codes.push("emptyName");
  if (input.caliber.trim() === "") codes.push("emptyCaliber");
  if (!isFirearmType(input.type)) codes.push("invalidType");
  else if (input.type === UNSPECIFIED) codes.push("typeRequired");
  if (!isFirearmAction(input.action)) codes.push("invalidAction");
  else if (input.action === UNSPECIFIED) codes.push("actionRequired");
  return codes;
}
