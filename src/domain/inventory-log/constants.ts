/**
 * Inventory-log event-type value sets (U1, KTD3). Single source of truth for
 * which event types are valid per parent family (firearm vs. magazine).
 *
 * Consumed by the pure domain validator (`validate.ts`, R3) and, downstream,
 * the DB `CHECK` constraint (`inventory-schema.ts`) via the existing `inList`
 * helper — the domain validator is the primary gate, the DB constraint is the
 * backstop. Mirrors the shape of `src/domain/firearms/constants.ts`.
 *
 * `ParentType` is reused from `src/auth/visibility.ts` rather than redefined
 * here, so there is a single parent-family union across the codebase.
 */

import type { ParentType } from "@/src/auth/visibility";

/** Event types valid for a firearm parent (R2). */
export const FIREARM_LOG_EVENTS = ["inventoried", "cleaned", "lubed"] as const;

/** Event types valid for a magazine parent (R2). */
export const MAGAZINE_LOG_EVENTS = ["inventoried"] as const;

export type FirearmLogEvent = (typeof FIREARM_LOG_EVENTS)[number];
export type MagazineLogEvent = (typeof MAGAZINE_LOG_EVENTS)[number];
export type EventType = FirearmLogEvent | MagazineLogEvent;

/**
 * Combined, deduped set of every valid event type across parent families.
 * Feeds the DB `CHECK` constraint (R3 backstop) — not itself parent-gated.
 */
export const LOG_EVENT_TYPES: readonly EventType[] = Array.from(
  new Set<EventType>([...FIREARM_LOG_EVENTS, ...MAGAZINE_LOG_EVENTS]),
);

const FIREARM_LOG_EVENT_SET: ReadonlySet<string> = new Set(FIREARM_LOG_EVENTS);
const MAGAZINE_LOG_EVENT_SET: ReadonlySet<string> = new Set(
  MAGAZINE_LOG_EVENTS,
);

/** True when `eventType` is valid for the given parent family (R2/R3). */
export function isValidEventType(
  parentType: ParentType,
  eventType: string,
): boolean {
  const set =
    parentType === "firearm" ? FIREARM_LOG_EVENT_SET : MAGAZINE_LOG_EVENT_SET;
  return set.has(eventType);
}
