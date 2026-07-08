/**
 * Ammo load-type suggestions (ammo plan, KTD: load type is NOT an enum).
 *
 * `type` (the "load type" — FMJ, JHP, ...) is free text, exactly like caliber
 * (R6). This list only seeds the UI combobox with common values; it is never
 * validated against and never becomes a DB CHECK constraint — real-world load
 * types proliferate (+P, frangible, tracer, wadcutter, ...) and a hard enum
 * would reject genuine entries until a code change. Any string the owner types
 * is accepted and persisted verbatim.
 */
export const COMMON_AMMO_TYPES = [
  "FMJ",
  "JHP",
  "HP",
  "Match",
  "Soft Point",
  "Subsonic",
] as const;
