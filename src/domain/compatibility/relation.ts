import {
  and,
  asc,
  eq,
  type InferInsertModel,
  inArray,
  notInArray,
} from "drizzle-orm";
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
 * - replace atomically (delete then reinsert) inside the caller's transaction,
 *   so a rejected id rolls back the surrounding scalar write too;
 * - reads are VIEWER-RELATIVE: a firearm outside the reader's visible set is
 *   dropped from the result rather than leaking its id;
 * - writes are VIEWER-RELATIVE TOO: the replace is scoped to the actor's
 *   visible set, so a list built from a filtered read cannot delete the links
 *   it was never shown.
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
 * that table's real insert model. The parameter has NO default: a default of
 * `PgTable` would let a binding omit the argument and silently fall back to
 * the unchecked shape, which is the hole this exists to close.
 *
 * Still open: the three column fields are bare `PgColumn` and are not tied to
 * `TTable`, so pointing one at another table's column still compiles. That is
 * also why the `as string` casts at the read sites below are load-bearing
 * rather than vestigial. Without it `buildRow` returned
 * `Record<string, unknown>`, and a binding that named the wrong key (or wired
 * the wrong column) type-checked cleanly and only failed at runtime — which is
 * precisely the drift this shared core exists to prevent.
 */
/**
 * The read-side shape: everything except `buildRow`. The read paths never
 * build a row, and Drizzle's `.from()` will not accept a generic table
 * parameter, so they take this narrower, non-generic view.
 */
export interface CompatibilityColumns {
  /** The join table itself. */
  table: PgTable;
  /** The parent-id column (`magazine_id`, `accessory_id`, ...). */
  parentIdColumn: PgColumn;
  /** The `firearm_id` column. */
  firearmIdColumn: PgColumn;
  /** The `ordinal` column the stable read order is defined by. */
  ordinalColumn: PgColumn;
}

export interface CompatibilityRelation<TTable extends PgTable>
  extends CompatibilityColumns {
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
 * A parent's stored rows, UNFILTERED — the only read here that is not
 * viewer-relative, because the write path needs to know about the rows it must
 * not touch. Takes the non-generic column view for the same reason the public
 * read paths do: Drizzle's `.from()` rejects a generic table parameter.
 */
async function loadStoredRows(
  db: DbOrTx,
  relation: CompatibilityColumns,
  parentId: string,
): Promise<{ firearmId: string; ordinal: number }[]> {
  const rows = await db
    .select({
      firearmId: relation.firearmIdColumn,
      ordinal: relation.ordinalColumn,
    })
    .from(relation.table)
    .where(eq(relation.parentIdColumn, parentId));
  return rows.map((row) => ({
    firearmId: row.firearmId as string,
    ordinal: row.ordinal as number,
  }));
}

/**
 * Replace the portion of a parent's compatibility set that the actor can see,
 * returning the de-duplicated ids in the order they were stored.
 *
 * The replace is scoped to the actor's visible firearms, and that scoping is
 * load-bearing rather than a refinement. Reads are viewer-relative, so the list
 * a caller submits was necessarily built from a FILTERED view — an editor with
 * a grant on the accessory but not on one of its hosts is handed a short list
 * and has no way to know it. A delete-all would read that unavoidable omission
 * as a deletion and silently destroy links the actor was never shown, with no
 * error and nothing to tell the owner. So links outside the visible set are
 * left exactly as they are; "omission clears" still holds, but only over what
 * the actor could actually see.
 *
 * Preserved rows keep their stored ordinals and the replaced ones are appended
 * after the highest of them, so the surviving order is stable and the actor's
 * requested order is honored within their own slice.
 *
 * Throws {@link NotFoundError} for a firearm the actor cannot see, which rolls
 * back the surrounding transaction so a partially-applied scalar update cannot
 * survive a rejected compatibility list. Must run inside a transaction.
 */
export async function replaceCompatibility<TTable extends PgTable>(
  tx: DbOrTx,
  relation: CompatibilityRelation<TTable>,
  actorId: string,
  parentId: string,
  firearmIds: string[],
): Promise<string[]> {
  const deduped = dedupeFirearmIds(firearmIds);

  // Always resolved, even for an empty list: the visible set is what bounds the
  // delete, so clearing needs it just as much as linking does.
  const visible = await getVisibleIds(tx, actorId, "firearm");
  for (const id of deduped) {
    if (!visible.has(id)) {
      throw new NotFoundError(
        `compatible firearm ${id} is not visible to the actor`,
      );
    }
  }

  const existing = await loadStoredRows(tx, relation, parentId);
  const preserved = existing.filter((row) => !visible.has(row.firearmId));

  if (preserved.length === 0) {
    await tx
      .delete(relation.table)
      .where(eq(relation.parentIdColumn, parentId));
  } else {
    await tx.delete(relation.table).where(
      and(
        eq(relation.parentIdColumn, parentId),
        notInArray(
          relation.firearmIdColumn,
          preserved.map((row) => row.firearmId),
        ),
      ),
    );
  }

  if (deduped.length > 0) {
    // Preserved rows are never among `deduped` (they are invisible to the
    // actor, and every submitted id passed the visibility gate), so appending
    // past their highest ordinal cannot collide on the composite PK either.
    const firstOrdinal =
      preserved.reduce((highest, row) => Math.max(highest, row.ordinal), -1) +
      1;
    await tx
      .insert(relation.table)
      .values(
        deduped.map((firearmId, offset) =>
          relation.buildRow(parentId, firearmId, firstOrdinal + offset),
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
  relation: CompatibilityColumns,
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
  relation: CompatibilityColumns,
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
