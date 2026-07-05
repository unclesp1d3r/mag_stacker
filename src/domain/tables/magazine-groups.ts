/**
 * Magazine roll-up key selectors (U3). Pure; feeds `buildGroups` from
 * `grouping.ts`. Structural row type — only the fields grouping needs, not
 * the app-layer `MagazineListItem`.
 */

import type { GroupKey } from "@/src/domain/tables/grouping";

/** Sentinel group for a label matching none of the owner's recorded prefixes (R9). */
const UNPREFIXED_KEY = "__unprefixed__";
const UNPREFIXED_NAME = "Unprefixed";

/** The minimal magazine fields the grouping engine and key selectors need. */
export interface MagazineGroupRow {
  ownerId: string;
  label: string;
  brandModel: string;
  caliber: string;
  baseCapacity: number;
  extensionRounds: number;
}

/**
 * By-type identity (R8): magazines sharing brandModel + caliber + baseCapacity
 * + extensionRounds are the same "type" of magazine.
 */
export function magazineByTypeKey(m: MagazineGroupRow): GroupKey {
  const key = `${m.brandModel}|${m.caliber}|${m.baseCapacity}|${m.extensionRounds}`;
  const totalCapacity = m.baseCapacity + m.extensionRounds;
  const name = `${m.brandModel} · ${totalCapacity}rd (${m.caliber})`;
  return { key, name };
}

/**
 * By-label-prefix (R9): a magazine joins the *longest* recorded prefix its
 * label starts with (AE1); a label matching no recorded prefix falls into
 * "Unprefixed" (AE2). Reuses the `startsWith` matching semantics from
 * `src/domain/bulkadd/labels.ts`. Does not mutate the caller's `prefixes`.
 */
export function magazineByPrefixKey(
  m: MagazineGroupRow,
  prefixes: string[],
): GroupKey {
  const longestFirst = [...prefixes].sort((a, b) => b.length - a.length);
  const match = longestFirst.find((prefix) => m.label.startsWith(prefix));
  if (match === undefined) {
    return { key: UNPREFIXED_KEY, name: UNPREFIXED_NAME };
  }
  return { key: match, name: match };
}

/** Total round capacity across a group's members (R12): Σ(baseCapacity + extensionRounds). */
export function magazineCapacityAggregate(members: MagazineGroupRow[]): number {
  return members.reduce(
    (sum, m) => sum + m.baseCapacity + m.extensionRounds,
    0,
  );
}

/** Default member order within a group: label ascending (R13). */
export function magazineLabelAscending(
  a: MagazineGroupRow,
  b: MagazineGroupRow,
): number {
  return a.label.localeCompare(b.label);
}
