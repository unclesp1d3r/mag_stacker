import { asc, eq, type InferInsertModel, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds } from "@/src/auth/visibility";
import type { DbOrTx } from "@/src/db/client";

/**
 * The shared "this item is compatible with these firearms" relation.
 *
 * Two parents use it, and they must behave identically (#23 KTD3):
 * `magazine_firearm` (#8-era) and `accessory_firearm` (#23). The rules that
 * matter are not the SQL — they are the invariants:
 *
 * - de-duplicate preserving FIRST-occurrence order, so ordinals match the
 *   sequence the caller supplied and no composite-PK conflict is possible;
 * - every firearm must be VISIBLE to the acting user before it is linked, so
 *   a crafted payload cannot attach a firearm the actor cannot see (and
 *   cross-owner shared firearms remain legitimately linkable);
 * - replace atomically (delete-all then reinsert) inside the caller's
 *   transaction, so a rejected id rolls back the surrounding scalar write too;
 * - reads are VIEWER-RELATIVE: a firearm outside the reader's visible set is
 *   dropped from the result rather than leaking its id.
 *
 * That visibility gate is the reason this is shared rather than copied. A
 * second hand-maintained copy means a second place an authorization fix has to
 * land, and the copy that gets missed is the one that leaks.
 *
 * Only the row SHAPE differs between parents (`magazineId` vs `accessoryId`),
 * which is what {@link CompatibilityRelation.buildRow} supplies — drizzle's
 * `.values()` is keyed by model property name, so it cannot be derived from a
 * column reference.
 *
 * The interface is generic over its table so `buildRow` is checked against
 * that table's real insert model. Without it `buildRow` returned
 * `Record<string, unknown>`, and a binding that named the wrong key (or wired
 * the wrong column) type-checked cleanly and only failed at runtime — which is
 * precisely the drift this shared core exists to prevent.
 */
export interface CompatibilityRelation<TTable extends PgTable = PgTable> {
  /** The join table itself. */
  table: TTable;
  /** The parent-id column (`magazine_id`, `accessory_id`, ...). */
  parentIdColumn: PgColumn;
  /** The `firearm_id` column. */
  firearmIdColumn: PgColumn;
  /** The `ordinal` column the stable read order is defined by. */
  ordinalColumn: PgColumn;
  /** Build one insertable row; keyed by the table's model property names. */
  buildRow: (
    parentId: string,
    firearmId: string,
    ordinal: number,
  ) => InferInsertModel<TTable>;
}

/**
 * De-duplicate firearm ids preserving FIRST-occurrence order.
 *
 * Collapsing duplicates before ordinals are assigned is what prevents a
 * composite-PK conflict, and preserving first-occurrence order is what keeps
 * the stored ordinals matching the order the caller actually asked for.
 */
export function dedupeFirearmIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Atomically replace a parent's compatibility set, returning the de-duplicated
 * ids in the order they were stored.
 *
 * Throws {@link NotFoundError} for a firearm the actor cannot see, which rolls
 * back the surrounding transaction so a partially-applied scalar update cannot
 * survive a rejected compatibility list. Must run inside a transaction.
 */
export async function replaceCompatibility(
  tx: DbOrTx,
  relation: CompatibilityRelation,
  actorId: string,
  parentId: string,
  firearmIds: string[],
): Promise<string[]> {
  const deduped = dedupeFirearmIds(firearmIds);

  if (deduped.length > 0) {
    const visible = await getVisibleIds(tx, actorId, "firearm");
    for (const id of deduped) {
      if (!visible.has(id)) {
        throw new NotFoundError(
          `compatible firearm ${id} is not visible to the actor`,
        );
      }
    }
  }

  await tx.delete(relation.table).where(eq(relation.parentIdColumn, parentId));
  if (deduped.length > 0) {
    await tx
      .insert(relation.table)
      .values(
        deduped.map((firearmId, ordinal) =>
          relation.buildRow(parentId, firearmId, ordinal),
        ),
      );
  }
  return deduped;
}

/**
 * One parent's compatible firearm ids in ordinal order, dropping any outside
 * the requester's visible firearm set (viewer-relative).
 */
export async function loadCompatibility(
  db: DbOrTx,
  relation: CompatibilityRelation,
  actorId: string,
  parentId: string,
): Promise<string[]> {
  const visible = await getVisibleIds(db, actorId, "firearm");
  const rows = await db
    .select({ firearmId: relation.firearmIdColumn })
    .from(relation.table)
    .where(eq(relation.parentIdColumn, parentId))
    .orderBy(asc(relation.ordinalColumn));
  return rows.map((r) => r.firearmId as string).filter((id) => visible.has(id));
}

/**
 * Batched viewer-relative compatibility for many parents at once — the list
 * views' N+1 guard. Takes the requester's already-computed visible firearm set
 * so it is not re-derived per parent.
 */
export async function loadCompatibilityBatch(
  db: DbOrTx,
  relation: CompatibilityRelation,
  visibleFirearmIds: Set<string>,
  parentIds: string[],
): Promise<Map<string, string[]>> {
  const byParent = new Map<string, string[]>();
  if (parentIds.length === 0) return byParent;
  const rows = await db
    .select({
      parentId: relation.parentIdColumn,
      firearmId: relation.firearmIdColumn,
    })
    .from(relation.table)
    .where(inArray(relation.parentIdColumn, parentIds))
    .orderBy(asc(relation.ordinalColumn));
  for (const row of rows) {
    const firearmId = row.firearmId as string;
    if (!visibleFirearmIds.has(firearmId)) continue; // viewer-relative drop
    const parentId = row.parentId as string;
    const list = byParent.get(parentId) ?? [];
    list.push(firearmId);
    byParent.set(parentId, list);
  }
  return byParent;
}
