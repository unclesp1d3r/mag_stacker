import type { ItemDueEntry } from "./due-service";
import type { ServiceParentType } from "./rules-service";

/**
 * Service backlog (R16, U9-adjacent) — pure. Flattens
 * `listDueForVisibleCollection`'s per-item, per-rule due state into one row
 * per DUE item-and-rule pair, each named for display, so `/summary`'s bulk
 * mark-serviced control (the R16 surface: "mark one or many items serviced
 * as of a date in a single action") can show the owner exactly what a
 * selection will mark BEFORE they commit to it, without re-deriving due
 * state (KTD4 — this only reshapes what `due-service.ts` already computed).
 *
 * No DB access here: item display names are supplied by the caller (already
 * loaded, batched, alongside the due entries themselves), matching the
 * load-then-apply-pure-function split every other layer in this feature
 * follows.
 */

/** A generic label used when a name map has no entry for an item (defensive; should not happen in practice). */
const UNKNOWN_ITEM_LABEL = "Unknown item";

export interface BacklogRow {
  parentType: ServiceParentType;
  parentId: string;
  /** Display name resolved by the caller (firearm nickname/name, or accessory brand/model/category). */
  itemName: string;
  ruleName: string;
}

/**
 * One row per DUE rule across the visible collection (items with zero due
 * rules contribute nothing). Sorted by item name, then rule name, for a
 * stable, readable display order — `listDueForVisibleCollection`'s own
 * ordering is by load order, not display order.
 */
export function buildServiceBacklog(
  entries: ItemDueEntry[],
  firearmNames: Map<string, string>,
  accessoryNames: Map<string, string>,
): BacklogRow[] {
  const rows: BacklogRow[] = [];
  for (const entry of entries) {
    const names =
      entry.parentType === "firearm" ? firearmNames : accessoryNames;
    const itemName = names.get(entry.parentId) ?? UNKNOWN_ITEM_LABEL;
    for (const rule of entry.rules) {
      if (!rule.due) continue;
      rows.push({
        parentType: entry.parentType,
        parentId: entry.parentId,
        itemName,
        ruleName: rule.name,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      a.itemName.localeCompare(b.itemName) ||
      a.ruleName.localeCompare(b.ruleName),
  );
}
