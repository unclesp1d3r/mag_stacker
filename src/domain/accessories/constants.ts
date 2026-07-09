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
