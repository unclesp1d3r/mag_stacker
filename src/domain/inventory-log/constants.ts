/**
 * Inventory-log parent families and event-type value sets (inventory-log
 * plan U1/KTD3; ammo added by the reconciliation plan, #100, KTD1/KTD4).
 * Single source of truth for which parent families carry log entries and
 * which event types are valid for each.
 *
 * Consumed by the pure domain validator (`validate.ts`, R3) and, downstream,
 * the DB `CHECK` constraints (`inventory-schema.ts`) via the existing `inList`
 * helper — the domain validator is the primary gate, the DB constraint is the
 * backstop. Mirrors the shape of `src/domain/firearms/constants.ts`.
 *
 * `ParentType` is reused from `src/auth/visibility.ts` rather than redefined
 * here, so there is a single parent-family union across the codebase;
 * `LogParentType` narrows it to the families that participate in the log.
 * Every dispatch on the family below is exhaustive (a `Record` keyed by
 * `LogParentType`), so adding a family without an entry is a compile error
 * rather than a silent fall-through to another family's rules (see
 * docs/solutions/logic-errors/non-exhaustive-union-dispatch-silently-routes-to-wrong-table.md).
 */

import type { ParentType } from "@/src/auth/visibility";

/** Parent families that carry inventory-log entries (accessory does not). */
export const LOG_PARENT_TYPES = ["firearm", "magazine", "ammo"] as const;

export type LogParentType = (typeof LOG_PARENT_TYPES)[number];

/**
 * The families whose entries are bare check-ins (no counted figure). Ammo is
 * excluded (#100): its entries are reconciliations that require a count, so
 * the generic "Mark inventoried" / "Log…" UI cannot apply to a lot.
 */
export type GenericLogParentType = Exclude<LogParentType, "ammo">;

/**
 * Event types valid for a firearm parent (R2). `cleaned` and `lubed` were
 * retired here by the service-intervals plan's U5 (R13) — logging service
 * against a named `service_rule` (see `src/domain/service-intervals/`) is now
 * the single way to record either act, and every pre-existing `cleaned`/
 * `lubed` row was converted to a `service_event` by that unit's migration.
 */
export const FIREARM_LOG_EVENTS = ["inventoried"] as const;

/** Event types valid for a magazine parent (R2). */
export const MAGAZINE_LOG_EVENTS = ["inventoried"] as const;

/**
 * Event types valid for an ammo parent (#100, R1). The one event is a
 * reconciliation: an `inventoried` entry that also carries the counted rounds
 * (see `validate.ts` and the `counted_rounds` column).
 */
export const AMMO_LOG_EVENTS = ["inventoried"] as const;

export type FirearmLogEvent = (typeof FIREARM_LOG_EVENTS)[number];
export type MagazineLogEvent = (typeof MAGAZINE_LOG_EVENTS)[number];
export type AmmoLogEvent = (typeof AMMO_LOG_EVENTS)[number];
export type EventType = FirearmLogEvent | MagazineLogEvent | AmmoLogEvent;

const LOG_PARENT_TYPE_SET: ReadonlySet<string> = new Set(LOG_PARENT_TYPES);

/** Exhaustive per-family event sets — a missing family fails to compile. */
const LOG_EVENT_SETS: Record<LogParentType, ReadonlySet<string>> = {
  firearm: new Set(FIREARM_LOG_EVENTS),
  magazine: new Set(MAGAZINE_LOG_EVENTS),
  ammo: new Set(AMMO_LOG_EVENTS),
};

/** True when `parentType` is a family that carries log entries. */
export function isLogParentType(
  parentType: ParentType | string,
): parentType is LogParentType {
  return LOG_PARENT_TYPE_SET.has(parentType);
}

/**
 * True when `eventType` is valid for the given parent family (R2/R3). A
 * non-log family has no valid event types at all.
 */
export function isValidEventType(
  parentType: ParentType,
  eventType: string,
): boolean {
  if (!isLogParentType(parentType)) return false;
  return LOG_EVENT_SETS[parentType].has(eventType);
}
