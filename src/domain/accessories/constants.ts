/**
 * Accessory classification value sets.
 *
 * TWO classifications coexist deliberately (#23 KD4), and they answer
 * different questions:
 *
 * - `type` (this file's `ACCESSORY_TYPES`) is the STRUCTURAL discriminator —
 *   "which subtype's rules apply". It is controlled, required, validated, and
 *   backed by a DB CHECK, and it is the seam future per-type detail tables
 *   (`accessory_optic`, ...) key off of (#23 KTD2).
 * - `category` (`ACCESSORY_CATEGORY_SUGGESTIONS`) stays free text — "what does
 *   the owner call it". #8's decision that the long tail (rail, bipod, red dot
 *   mount) must not be forced into an enum is NOT reversed.
 *
 * Dropping `category` in favor of `type` would flatten those genuine long-tail
 * values to `other`; requiring both would make the form ask for two
 * overlapping required classifications. So `type` carries the required
 * classification and `category` relaxed to optional.
 */

/**
 * Controlled accessory `type` values (#23 R1). `suppressor` is the
 * fully-supported serialized subtype for this slice; the rest are the
 * classifications the shipped `category` suggestions already surfaced, so the
 * backfill (#23 R2) maps most existing rows by exact lowercase match.
 *
 * Consumed by the domain validator (`validate.ts`), the DB CHECK
 * (`inventory-schema.ts`), and the form's select — no set is duplicated across
 * those surfaces. Mirrors `src/domain/firearms/constants.ts`.
 */
export const ACCESSORY_TYPES = [
  "suppressor",
  "optic",
  "light",
  "laser",
  "muzzle device",
  "other",
] as const;

export type AccessoryType = (typeof ACCESSORY_TYPES)[number];

const ACCESSORY_TYPE_SET: ReadonlySet<string> = new Set(ACCESSORY_TYPES);

/** True when `value` is a member of the controlled `type` set. */
export function isAccessoryType(value: string): value is AccessoryType {
  return ACCESSORY_TYPE_SET.has(value);
}

/** Presentation labels for every `type` value. */
export const ACCESSORY_TYPE_LABELS: Record<AccessoryType, string> = {
  suppressor: "Suppressor",
  optic: "Optic",
  light: "Light",
  laser: "Laser",
  "muzzle device": "Muzzle device",
  other: "Other",
};

/** Display label for a stored `type`, falling back to the raw value if unknown. */
export function accessoryTypeLabel(value: string): string {
  return isAccessoryType(value) ? ACCESSORY_TYPE_LABELS[value] : value;
}

/**
 * Controlled `accessory_attachment.type` values (#23 R11) — the mounting
 * hardware that makes a serialized accessory fit a given host. Kept
 * deliberately small: an attachment is a physical part, not a taxonomy, and
 * `other` absorbs anything the list doesn't name.
 */
export const ATTACHMENT_TYPES = [
  "mount",
  "piston",
  "end cap",
  "muzzle device",
  "other",
] as const;

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

const ATTACHMENT_TYPE_SET: ReadonlySet<string> = new Set(ATTACHMENT_TYPES);

/** True when `value` is a member of the controlled attachment `type` set. */
export function isAttachmentType(value: string): value is AttachmentType {
  return ATTACHMENT_TYPE_SET.has(value);
}

/** Presentation labels for every attachment `type` value. */
export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  mount: "Mount",
  piston: "Piston",
  "end cap": "End cap",
  "muzzle device": "Muzzle device",
  other: "Other",
};

/** Display label for a stored attachment `type`, falling back to the raw value. */
export function attachmentTypeLabel(value: string): string {
  return isAttachmentType(value) ? ATTACHMENT_TYPE_LABELS[value] : value;
}

/**
 * Accessory category suggestions (#8 plan).
 *
 * `category` is free text, exactly like ammo's `caliber`/`type` (R6-style).
 * This list only seeds the UI combobox with common values; it is never
 * validated against and never becomes a DB CHECK constraint — real-world
 * accessory categories proliferate (rail, bipod, red dot mount, ...) and a
 * hard enum would reject genuine entries until a code change. Any string the
 * owner types is accepted and persisted verbatim.
 */
export const ACCESSORY_CATEGORY_SUGGESTIONS = [
  "trigger",
  "barrel",
  "sight",
  "optic",
  "suppressor",
  "grip",
  "stock",
  "muzzle device",
  "light",
  "laser",
  "sling",
  "magwell",
  "other",
] as const;
