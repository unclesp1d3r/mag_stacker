import { listAmmo } from "@/src/domain/ammo/service";
import { isLowStock } from "@/src/domain/ammo/validate";
import { listFirearms } from "@/src/domain/firearms/service";
import { listMagazines } from "@/src/domain/magazines/service";
import { effectiveCapacity } from "@/src/domain/magazines/validate";
import {
  type ItemDueEntry,
  listDueForVisibleCollection,
} from "@/src/domain/service-intervals/due-service";

/**
 * Inventory summary (U7, parity §7; ammo roll-ups added in the ammo plan's
 * U5; the service due roll-up added in the service-intervals plan's U9).
 * Computed in memory over the requester's VISIBLE inventory snapshot only
 * (R41). The pure `computeSummary` is the parity aggregation; `inventorySummary`
 * loads the viewer-relative snapshot and applies it. Empty inventory yields an
 * all-zero summary, never null (R68).
 */

export interface FirearmIdentity {
  id: string;
  name: string;
  /**
   * Optional (ammo plan KTD6) — deliberately so pre-ammo call sites and test
   * literals that pass `{id, name}` only keep compiling. A firearm without a
   * caliber contributes no `caliberCoverage` row (nothing to cross-reference).
   */
  caliber?: string;
  /**
   * Optional for the same reason `caliber` is: pre-#37 call sites and test
   * literals that pass `{id, name}` keep compiling. Absent means magazine-fed,
   * matching both the column default and every row that predates the flag.
   */
  isMagazineFed?: boolean;
}

export interface MagazineSnapshot {
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
  /** Viewer-relative: unseen firearm references are already dropped (R17a). */
  compatibleFirearmIds: string[];
}

/** Minimal ammo shape `computeSummary` needs — mirrors how `MagazineSnapshot` narrows the row. */
export interface AmmoSnapshot {
  caliber: string;
  quantityRounds: number;
  lowStockThreshold: number;
}

export interface CaliberSummary {
  caliber: string;
  count: number;
  effectiveCapacity: number;
}

export interface FirearmCount {
  id: string;
  name: string;
  count: number;
  /**
   * False for firearms that take no detachable magazines (#37). The summary
   * table renders their count blank rather than `0`, matching the firearms
   * table and detail view.
   */
  isMagazineFed: boolean;
}

/**
 * A firearm caliber the owner has no adequate ammo for (R12/AS2): either zero
 * lots exist for it, or every lot of that caliber is low. Distinct from the
 * any-lot rule behind `ammoCalibersLow` — a caliber with one low lot and one
 * adequate lot is counted there but never appears here.
 */
export interface CaliberCoverage {
  caliber: string;
  reason: "no-ammo" | "low-stock-only";
}

export interface Summary {
  totalMagazines: number;
  /** One row per caliber, sorted alphabetically by caliber (R42). */
  byCaliber: CaliberSummary[];
  /** One row per firearm (incl. zero-count), sorted alphabetically by name (R42). */
  firearmCounts: FirearmCount[];
  /** Count of all visible ammo lots (drives the ammo-only EmptyState gate). */
  totalAmmoLots: number;
  /** Count of lots where `isLowStock` (R11). */
  ammoEntriesLow: number;
  /** Distinct calibers with at least one low lot — any-lot rule (R11/AS2). */
  ammoCalibersLow: number;
  /** Firearm calibers with no ammo, or only low ammo — all-lots rule (R12), sorted alphabetically. */
  caliberCoverage: CaliberCoverage[];
  /** Visible firearms/accessories with at least one due service rule (R19). */
  itemsDue: number;
  /** Total due service rules across the visible collection (R19). */
  rulesDue: number;
}

/**
 * Comparison key for cross-entity caliber matching. Caliber is free text on
 * every entity, so raw equality would let "9MM " vs "9mm" produce a false
 * "No ammo" coverage row (#52); trim + case-fold for matching, display raw.
 */
function caliberKey(caliber: string): string {
  return caliber.trim().toLowerCase();
}

/**
 * Pure aggregation (parity §7.2). Keyed by firearm IDENTITY (id), not name, so
 * two same-named firearms stay distinct (R39). A magazine referencing a firearm
 * absent from `firearms` still counts toward totals/per-caliber but yields no
 * phantom per-firearm entry (R40).
 */
export function computeSummary(
  firearms: FirearmIdentity[],
  magazines: MagazineSnapshot[],
  ammo: AmmoSnapshot[] = [],
  dueEntries: ItemDueEntry[] = [],
): Summary {
  // Keyed by the normalized caliber (trim + case-fold) so "9mm" and "9MM " group
  // as one row — the same matching `computeAmmoRollups` uses (#52), keeping a
  // single `Summary` from grouping caliber two different ways. Display uses the
  // first-seen raw string.
  const countByCaliber = new Map<string, number>();
  const effectiveByCaliber = new Map<string, number>();
  const displayByCaliber = new Map<string, string>();
  const countByFirearmId = new Map<string, number>();

  for (const mag of magazines) {
    const key = caliberKey(mag.caliber);
    if (!displayByCaliber.has(key)) displayByCaliber.set(key, mag.caliber);
    countByCaliber.set(key, (countByCaliber.get(key) ?? 0) + 1);
    effectiveByCaliber.set(
      key,
      (effectiveByCaliber.get(key) ?? 0) + effectiveCapacity(mag),
    );
    for (const firearmId of mag.compatibleFirearmIds) {
      countByFirearmId.set(
        firearmId,
        (countByFirearmId.get(firearmId) ?? 0) + 1,
      );
    }
  }

  const byCaliber: CaliberSummary[] = [...countByCaliber.keys()]
    .map((key) => ({
      caliber: displayByCaliber.get(key) ?? key,
      count: countByCaliber.get(key) ?? 0,
      effectiveCapacity: effectiveByCaliber.get(key) ?? 0,
    }))
    .sort((a, b) => a.caliber.localeCompare(b.caliber));

  const firearmCounts: FirearmCount[] = firearms
    .map((f) => ({
      id: f.id,
      name: f.name,
      count: countByFirearmId.get(f.id) ?? 0,
      isMagazineFed: f.isMagazineFed ?? true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { ammoEntriesLow, ammoCalibersLow, caliberCoverage } =
    computeAmmoRollups(firearms, ammo);
  const { itemsDue, rulesDue } = computeServiceRollup(dueEntries);

  return {
    totalMagazines: magazines.length,
    byCaliber,
    firearmCounts,
    totalAmmoLots: ammo.length,
    ammoEntriesLow,
    ammoCalibersLow,
    caliberCoverage,
    itemsDue,
    rulesDue,
  };
}

/**
 * Ammo roll-ups (ammo plan U5, R11/R12). `ammoCalibersLow` is the any-lot rule
 * (a caliber counts if any of its lots is low); `caliberCoverage` is the
 * all-lots rule restricted to calibers present on the owner's firearms (a
 * caliber counts only if it has zero lots, or every lot is low) — the two
 * intentionally diverge for a caliber with one low lot and one adequate lot.
 */
function computeAmmoRollups(
  firearms: FirearmIdentity[],
  ammo: AmmoSnapshot[],
): Pick<Summary, "ammoEntriesLow" | "ammoCalibersLow" | "caliberCoverage"> {
  const lowCalibers = new Set<string>();
  const lotsByCaliber = new Map<string, AmmoSnapshot[]>();
  let ammoEntriesLow = 0;

  for (const lot of ammo) {
    const key = caliberKey(lot.caliber);
    const lots = lotsByCaliber.get(key) ?? [];
    lots.push(lot);
    lotsByCaliber.set(key, lots);
    if (isLowStock(lot)) {
      ammoEntriesLow += 1;
      lowCalibers.add(key);
    }
  }

  // Normalized key -> first-seen display string (trimmed raw), so two
  // firearms entered as "9MM" and "9mm " yield one coverage row.
  const firearmCalibers = new Map<string, string>();
  for (const f of firearms) {
    const raw = f.caliber?.trim() ?? "";
    if (raw === "") continue;
    const key = caliberKey(raw);
    if (!firearmCalibers.has(key)) firearmCalibers.set(key, raw);
  }

  const caliberCoverage: CaliberCoverage[] = [...firearmCalibers.entries()]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .flatMap(([key, caliber]): CaliberCoverage[] => {
      const lots = lotsByCaliber.get(key) ?? [];
      if (lots.length === 0) return [{ caliber, reason: "no-ammo" }];
      if (lots.every((lot) => isLowStock(lot))) {
        return [{ caliber, reason: "low-stock-only" }];
      }
      return [];
    });

  return {
    ammoEntriesLow,
    ammoCalibersLow: lowCalibers.size,
    caliberCoverage,
  };
}

/**
 * Service due roll-up (service-intervals plan U9, R19/R20/R21, KTD4). Folds
 * `listDueForVisibleCollection`'s per-item, per-rule due state — already
 * derived in a bounded number of queries, never re-derived here — into two
 * counts: breadth (`itemsDue`, items with at least one due rule) and volume
 * (`rulesDue`, total due rules across the visible collection). An item that
 * is due only because of an accessory mounted to it does NOT contribute here
 * on the firearm's account — `listDueForVisibleCollection` already returns
 * the firearm and the accessory as separate entries, so the accessory's due
 * rule only ever counts toward the accessory's own entry.
 */
function computeServiceRollup(
  entries: ItemDueEntry[],
): Pick<Summary, "itemsDue" | "rulesDue"> {
  let itemsDue = 0;
  let rulesDue = 0;
  for (const entry of entries) {
    const dueRuleCount = entry.rules.filter((rule) => rule.due).length;
    if (dueRuleCount > 0) itemsDue += 1;
    rulesDue += dueRuleCount;
  }
  return { itemsDue, rulesDue };
}

/**
 * Load the requester's viewer-relative visible inventory and summarize it.
 * Accepts an optional pre-fetched `dueEntries` (already the same batched,
 * bounded load `listDueForVisibleCollection` returns) so a caller that also
 * needs the raw entries — e.g. to mark individual rows due, R20 — can fetch
 * once and pass the result here instead of triggering the full due-resolution
 * pipeline (defaults + item rules + last-service-points + session rows) a
 * second time. When omitted, behavior is identical to before: this function
 * fetches it itself.
 *
 * Also accepts an optional pre-fetched `firearms` (the same visible-firearm
 * set `listFirearms` would return) so a caller that has already loaded it —
 * e.g. the firearms list page — can skip `listFirearms`'s two round trips
 * (`getVisibleIds` + select) a second time. When omitted, this function
 * fetches it itself, identical to before.
 */
export async function inventorySummary(
  actorId: string,
  dueEntries?: ItemDueEntry[],
  firearms?: FirearmIdentity[],
): Promise<Summary> {
  const [resolvedFirearms, magazines, ammoLots, resolvedDueEntries] =
    await Promise.all([
      firearms ?? listFirearms(actorId),
      listMagazines(actorId),
      listAmmo(actorId),
      dueEntries ?? listDueForVisibleCollection(actorId),
    ]);
  const ammo: AmmoSnapshot[] = ammoLots.map((lot) => ({
    caliber: lot.caliber,
    quantityRounds: lot.quantityRounds,
    lowStockThreshold: lot.lowStockThreshold,
  }));
  return computeSummary(resolvedFirearms, magazines, ammo, resolvedDueEntries);
}
