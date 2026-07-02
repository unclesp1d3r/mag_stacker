/**
 * Firearm taxonomy value sets (U1, KTD-A). Single source of truth for the
 * controlled `type` / `action` categories.
 *
 * Consumed by the domain validator (`validate.ts`, R6/R7), the DB check
 * constraints (`inventory-schema.ts`, R4/R26), and the form option lists
 * (`firearm-form.tsx`, R9) — no value set is duplicated across those surfaces.
 * The lists evolve through migrations, not a UI (KTD-A). Mirrors the shape of
 * `src/domain/magazines/constants.ts`.
 *
 * `unspecified` is a valid *stored* sentinel so backfilled rows pass the DB
 * constraint (R12), but it is not a *real* selection — the domain layer rejects
 * it on write (R7). Use `isRealFirearmType` / `isRealFirearmAction` to test for
 * a genuine choice.
 */

/** The stored sentinel for an unclassified firearm (backfill + placeholder). */
export const UNSPECIFIED = "unspecified";

/** Controlled firearm `type` values, including the `unspecified` sentinel (R1). */
export const FIREARM_TYPES = [
  "pistol",
  "revolver",
  "rifle",
  "shotgun",
  "pcc",
  "other",
  UNSPECIFIED,
] as const;

/** Controlled firearm `action` values, including the `unspecified` sentinel (R2). */
export const FIREARM_ACTIONS = [
  "semi-auto",
  "bolt",
  "lever",
  "pump",
  "break",
  "single-shot",
  UNSPECIFIED,
] as const;

export type FirearmType = (typeof FIREARM_TYPES)[number];
export type FirearmAction = (typeof FIREARM_ACTIONS)[number];

const FIREARM_TYPE_SET: ReadonlySet<string> = new Set(FIREARM_TYPES);
const FIREARM_ACTION_SET: ReadonlySet<string> = new Set(FIREARM_ACTIONS);

/** True when `value` is a member of the controlled `type` set (any member). */
export function isFirearmType(value: string): value is FirearmType {
  return FIREARM_TYPE_SET.has(value);
}

/** True when `value` is a member of the controlled `action` set (any member). */
export function isFirearmAction(value: string): value is FirearmAction {
  return FIREARM_ACTION_SET.has(value);
}

/** True only for a *real* type — in-set and not the `unspecified` sentinel (R7). */
export function isRealFirearmType(value: string): boolean {
  return value !== UNSPECIFIED && FIREARM_TYPE_SET.has(value);
}

/** True only for a *real* action — in-set and not the `unspecified` sentinel (R7). */
export function isRealFirearmAction(value: string): boolean {
  return value !== UNSPECIFIED && FIREARM_ACTION_SET.has(value);
}

/**
 * Presentation labels for every `type` / `action` value, including the sentinel
 * (`unspecified` → "Unspecified"), so the list column and filter render a
 * friendly label for backfilled rows rather than the raw slug.
 */
export const FIREARM_TYPE_LABELS: Record<FirearmType, string> = {
  pistol: "Pistol",
  revolver: "Revolver",
  rifle: "Rifle",
  shotgun: "Shotgun",
  pcc: "PCC",
  other: "Other",
  unspecified: "Unspecified",
};

export const FIREARM_ACTION_LABELS: Record<FirearmAction, string> = {
  "semi-auto": "Semi-automatic",
  bolt: "Bolt-action",
  lever: "Lever-action",
  pump: "Pump-action",
  break: "Break-action",
  "single-shot": "Single-shot",
  unspecified: "Unspecified",
};

/** Display label for a stored `type`, falling back to the raw value if unknown. */
export function firearmTypeLabel(value: string): string {
  return isFirearmType(value) ? FIREARM_TYPE_LABELS[value] : value;
}

/** Display label for a stored `action`, falling back to the raw value if unknown. */
export function firearmActionLabel(value: string): string {
  return isFirearmAction(value) ? FIREARM_ACTION_LABELS[value] : value;
}
