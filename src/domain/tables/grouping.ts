/**
 * Generic owner-scoped roll-up grouping engine (U3, KTD-1). Pure; no React,
 * no TanStack, no DB. Splits an already-filtered row set into owned/borrowed
 * (R10, R14/AE5), assigns owned rows to groups via a caller-supplied key
 * selector, orders groups by count descending then name ascending (R13), and
 * optionally computes a per-group aggregate. Reused by both the magazine and
 * firearm grouping modules (`magazine-groups.ts`, `firearm-groups.ts`).
 */

/** A row's group identity: `key` is stable, `name` is the display label. */
export interface GroupKey {
  key: string;
  name: string;
}

/** One roll-up group: owned members sharing a `keyOf` identity. */
export interface GroupModel<Row, Aggregate = undefined> {
  key: string;
  name: string;
  count: number;
  members: Row[];
  aggregate: Aggregate;
}

export interface BuildGroupsResult<Row, Aggregate = undefined> {
  groups: GroupModel<Row, Aggregate>[];
  borrowed: Row[];
}

export interface BuildGroupsOptions<Row, Aggregate = undefined> {
  /** The viewer's id; rows with a matching `ownerId` are grouped, others are "borrowed". */
  ownerId: string;
  /** Assigns an owned row to a group. */
  keyOf: (row: Row) => GroupKey;
  /** Optional per-group aggregate (e.g. magazine total round capacity, R12). */
  aggregateOf?: (members: Row[]) => Aggregate;
  /**
   * Orders members within a group. When omitted, members keep the relative
   * order they arrived in (stable) — callers that want a specific default
   * (e.g. label ascending for magazines) supply their own comparator.
   */
  memberSort?: (a: Row, b: Row) => number;
}

interface HasOwnerId {
  ownerId: string;
}

/**
 * Splits `rows` into owned/borrowed, groups the owned rows by `keyOf`, and
 * orders groups by count descending then name ascending (R13). `rows` must
 * already be the filtered set the caller wants grouped (R14) — this function
 * never re-reads or re-filters anything. Immutable: never mutates `rows` or
 * any row.
 */
export function buildGroups<Row extends HasOwnerId, Aggregate = undefined>(
  rows: Row[],
  options: BuildGroupsOptions<Row, Aggregate>,
): BuildGroupsResult<Row, Aggregate> {
  const { ownerId, keyOf, aggregateOf, memberSort } = options;

  const owned: Row[] = [];
  const borrowed: Row[] = [];
  for (const row of rows) {
    if (row.ownerId === ownerId) {
      owned.push(row);
    } else {
      borrowed.push(row);
    }
  }

  const groupOrder: string[] = [];
  const groupsByKey = new Map<string, { name: string; members: Row[] }>();
  for (const row of owned) {
    const { key, name } = keyOf(row);
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.members.push(row);
    } else {
      groupsByKey.set(key, { name, members: [row] });
      groupOrder.push(key);
    }
  }

  const groups: GroupModel<Row, Aggregate>[] = groupOrder
    .map((key) => {
      const { name, members } = groupsByKey.get(key) as {
        name: string;
        members: Row[];
      };
      const orderedMembers = memberSort
        ? [...members].sort(memberSort)
        : members;
      const aggregate = aggregateOf
        ? aggregateOf(orderedMembers)
        : (undefined as Aggregate);
      return {
        key,
        name,
        count: orderedMembers.length,
        members: orderedMembers,
        aggregate,
      };
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

  return { groups, borrowed };
}
