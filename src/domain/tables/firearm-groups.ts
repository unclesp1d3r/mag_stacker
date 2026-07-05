/**
 * Firearm roll-up key selector (U4). Pure; reuses the U3 `buildGroups`
 * engine unchanged for owned/borrowed split, ordering, and member sort.
 * Structural row type — only the fields grouping needs, not the app-layer
 * `FirearmListItem`.
 */

import { firearmTypeLabel } from "@/src/domain/firearms/constants";
import type { GroupKey } from "@/src/domain/tables/grouping";

/** The minimal firearm fields the grouping engine and key selector need. */
export interface FirearmGroupRow {
  ownerId: string;
  type: string;
}

/**
 * By-type identity (R7): key is the raw stored `type`, name is its friendly
 * display label. No aggregate is supplied when wiring this into
 * `buildGroups` — firearm group headers are count-only (KTD-6).
 */
export function firearmByTypeKey(f: FirearmGroupRow): GroupKey {
  return { key: f.type, name: firearmTypeLabel(f.type) };
}
