/**
 * Service-interval derivation core (service-intervals plan, U2). Pure — no
 * DB, no Drizzle, no `src/db/client`. Every surface (item detail, `/summary`
 * roll-up, list indicators) reads this module's output; nothing above it
 * decides due state (KTD4).
 *
 * Every calendar comparison happens in the local frame (KTD5): dates are
 * plain `Date` values built from local year/month/day components (never a
 * UTC `...Z` instant), and day differences are computed with `date-fns`'s
 * `differenceInCalendarDays`, which compares local calendar days regardless
 * of the runner's timezone offset.
 */

import { differenceInCalendarDays } from "date-fns";
import type { InheritanceState, ServiceAxis } from "./constants";

/** The three threshold axes a rule may set (nullable = "not tracked on this axis"). */
export interface Thresholds {
  intervalDays: number | null;
  intervalSessions: number | null;
  intervalRounds: number | null;
}

/** A category default rule (owner-scoped, keyed by category + name). */
export interface DefaultRule extends Thresholds {
  name: string;
}

/**
 * An item's own rule row — an override (thresholds set, not suppressed), a
 * suppression (`suppressed: true`, no thresholds), or an item-only rule with
 * no matching default (also thresholds set, not suppressed; indistinguishable
 * from an override at this shape — `resolveEffectiveRules` is what tells them
 * apart, by checking against the defaults set).
 */
export interface ItemRule extends Thresholds {
  name: string;
  suppressed: boolean;
}

/** One rule in an item's effective, resolved rule set. */
export interface ResolvedRule extends Thresholds {
  name: string;
  inheritanceState: InheritanceState;
}

function extractThresholds(rule: Thresholds): Thresholds {
  return {
    intervalDays: rule.intervalDays,
    intervalSessions: rule.intervalSessions,
    intervalRounds: rule.intervalRounds,
  };
}

/**
 * Resolve an item's effective rule set from its owner's category defaults and
 * the item's own rule rows (R4, R5, KTD6).
 *
 * - A default with no matching item rule resolves `inherited`.
 * - A default with a matching, unsuppressed item rule resolves `overridden`,
 *   using the item's own thresholds.
 * - A default with a matching, SUPPRESSED item rule contributes nothing — the
 *   suppression removes that default from the resolved set entirely.
 * - An item rule with no matching default resolves `item-only`, unaffected by
 *   any default in the set.
 * - A suppressed item rule with no matching default contributes nothing and
 *   raises no error.
 */
export function resolveEffectiveRules(
  defaults: DefaultRule[],
  itemRules: ItemRule[],
): ResolvedRule[] {
  const itemRuleByName = new Map(itemRules.map((rule) => [rule.name, rule]));
  const matchedItemRuleNames = new Set<string>();
  const resolved: ResolvedRule[] = [];

  for (const def of defaults) {
    const itemRule = itemRuleByName.get(def.name);
    if (itemRule === undefined) {
      resolved.push({
        name: def.name,
        inheritanceState: "inherited",
        ...extractThresholds(def),
      });
      continue;
    }

    matchedItemRuleNames.add(itemRule.name);
    if (itemRule.suppressed) continue; // KTD6: suppression removes the default.

    resolved.push({
      name: itemRule.name,
      inheritanceState: "overridden",
      ...extractThresholds(itemRule),
    });
  }

  for (const itemRule of itemRules) {
    if (matchedItemRuleNames.has(itemRule.name)) continue; // already resolved above
    if (itemRule.suppressed) continue; // suppressed with no matching default: nothing

    resolved.push({
      name: itemRule.name,
      inheritanceState: "item-only",
      ...extractThresholds(itemRule),
    });
  }

  return resolved;
}

/** One range session's date and rounds fired, as folded by `elapsedCounts`. */
export interface SessionRow {
  date: Date;
  roundsFired: number;
}

export interface ElapsedCounts {
  days: number;
  sessions: number;
  rounds: number;
}

/**
 * Fold a measure-from date and an item's session rows into elapsed days,
 * sessions, and rounds (R7, R8, R9, KTD4).
 *
 * `asOf` is the reference "now" the day axis measures against — an explicit
 * parameter (never `Date.now()` internally) so this stays a pure, fully
 * deterministic function.
 *
 * Sessions are counted only when STRICTLY AFTER the measure-from date
 * (KTD10) — a session on the same calendar day as the measure-from date does
 * not count toward sessions or rounds — AND no later than `asOf` (F4 fix).
 * Range-session dates are deliberately allowed in the future by their own
 * validation (unrelated to this fix, and not changed here), so without this
 * upper bound a session logged for next month would immediately inflate
 * today's session/round counts and could trip a threshold for something
 * that has not happened yet. A session dated exactly `asOf` still counts —
 * only STRICTLY later than `asOf` is excluded.
 */
export function elapsedCounts(
  measureFrom: Date,
  sessions: SessionRow[],
  asOf: Date,
): ElapsedCounts {
  const days = Math.max(0, differenceInCalendarDays(asOf, measureFrom));

  let sessionCount = 0;
  let roundsTotal = 0;
  for (const session of sessions) {
    if (differenceInCalendarDays(session.date, measureFrom) <= 0) continue;
    if (differenceInCalendarDays(session.date, asOf) > 0) continue;
    sessionCount += 1;
    roundsTotal += session.roundsFired;
  }

  return { days, sessions: sessionCount, rounds: roundsTotal };
}

export interface DueResult {
  due: boolean;
  trippedAxis: ServiceAxis | null;
}

/**
 * A rule is due when any threshold it sets is met or exceeded (R7, R11) — the
 * comparison is met-or-exceeded, not strictly-exceeded. Checked in a fixed
 * days/sessions/rounds order so the reported `trippedAxis` is deterministic
 * when more than one axis has tripped.
 */
export function isDue(
  thresholds: Thresholds,
  counts: ElapsedCounts,
): DueResult {
  const checks: Array<[ServiceAxis, number | null, number]> = [
    ["days", thresholds.intervalDays, counts.days],
    ["sessions", thresholds.intervalSessions, counts.sessions],
    ["rounds", thresholds.intervalRounds, counts.rounds],
  ];

  for (const [axis, threshold, elapsed] of checks) {
    if (threshold !== null && elapsed >= threshold) {
      return { due: true, trippedAxis: axis };
    }
  }

  return { due: false, trippedAxis: null };
}
