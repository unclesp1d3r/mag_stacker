/**
 * Service-interval constants (service-intervals plan, U2). Single source for
 * the rule-name/threshold bounds and the inheritance-state union, mirrored by
 * the DB CHECKs in `src/db/inventory-schema.ts` (`service_rule_default`,
 * `service_rule` — every non-null threshold >= 1) and consumed by both
 * `validate.ts` (write path) and `derive.ts` (read path).
 */

/** Minimum value a set threshold (days/sessions/rounds) may carry (R2). */
export const MIN_THRESHOLD = 1;

/**
 * How a resolved rule relates to its item's category default (R5):
 * - `inherited` — no item entry for this rule name; tracks the default as-is.
 * - `overridden` — an item entry exists with its own thresholds.
 * - `item-only` — an item entry exists with no matching default at all.
 *
 * A suppressed item entry is not itself a state here — it removes the rule
 * from the resolved set entirely (KTD6), so it never reaches this union.
 */
export const INHERITANCE_STATES = [
  "inherited",
  "overridden",
  "item-only",
] as const;

export type InheritanceState = (typeof INHERITANCE_STATES)[number];

/** The three axes a rule can set a threshold on (R2, R7). */
export const SERVICE_AXES = ["days", "sessions", "rounds"] as const;

export type ServiceAxis = (typeof SERVICE_AXES)[number];

/**
 * Maximum item+rule pairs one `logServiceEventsBulk` call (R16) may include
 * (F6 fix). A single INSERT binds several parameters per row, so an
 * unbounded batch could exceed the DB driver's bound-parameter ceiling as an
 * unhandled error mid-transaction, holding row locks open in the meantime.
 * Rejecting an over-size batch as a `ValidationError` BEFORE opening the
 * transaction turns that into a clean, expected failure instead. A few
 * hundred is comfortably more than any real "mark this whole visible
 * collection serviced" click would ever submit.
 */
export const MAX_BULK_SERVICE_ITEMS = 200;
