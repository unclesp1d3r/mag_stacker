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
 *
 * `entries` comes from `listDueForVisibleCollection`, which is ALSO what
 * feeds the `/summary` roll-up counts (`inventorySummary`) — it deliberately
 * includes a shared firearm at every visibility tier, because an owner's due
 * state on a shared item is legitimate information for a view-grantee to
 * see (R19's roll-up). This checklist is a WRITE surface, not a read one:
 * `logServiceEventsBulk`'s per-family authorization (KTD3) allows a firearm
 * edit-grantee to log service but never a view-only one, and accessories are
 * owner-only throughout. Offering a view-grantee a checkbox that
 * authorization will only ever reject is a read surface promising a write
 * action it can't deliver — and because the bulk write is one transaction,
 * checking that box also rolls back every other legitimate row in the same
 * submission. `actionableFirearmIds` — the firearm ids the actor holds
 * owner or edit permission on, per `visibleFirearmPermissions` — filters
 * those rows out here, at the one place this checklist is built, rather
 * than by loosening `logServiceEventsBulk`'s authorization itself. Accessory
 * rows need no equivalent filter: `listDueForVisibleCollection` already
 * scopes its accessory set to `owner_id = actorId` (KTD3), so every
 * accessory entry reaching this function is already actionable.
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
  actionableFirearmIds: Set<string>,
): BacklogRow[] {
  const rows: BacklogRow[] = [];
  for (const entry of entries) {
    if (
      entry.parentType === "firearm" &&
      !actionableFirearmIds.has(entry.parentId)
    ) {
      continue; // view-only grantee: excluded from the write checklist (KTD3), still counted in the roll-up
    }
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
