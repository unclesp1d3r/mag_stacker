import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  listVisibleAccessoryIds,
  resolveAccessoryPermission,
} from "@/src/auth/accessory-visibility";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import {
  accessory,
  rangeSession,
  rangeSessionAccessory,
} from "@/src/db/schema";
import { ValidationError } from "../errors";
import { type RangeSessionInput, validateRangeSession } from "./validate";

/**
 * Range-session service (#11). Sessions are a firearm child (R62): every read and
 * write resolves through the parent firearm's visibility/authorization, so the
 * table carries no owner_id and no own grant family. Write access needs edit on
 * the firearm — including delete (KTD3), deliberately looser than firearm delete.
 * The lifetime round total is DERIVED here by summing rows (KTD1); there is no
 * stored counter.
 */

export type RangeSession = typeof rangeSession.$inferSelect;

export type RangeSessionCreateInput = RangeSessionInput;
export type RangeSessionUpdateInput = Omit<RangeSessionInput, "firearmId">;

function persistableFields(input: Omit<RangeSessionInput, "firearmId">) {
  return {
    // Raw values persisted verbatim (empty-not-null for notes, null ammo seam).
    date: input.date,
    roundsFired: input.roundsFired,
    ammoId: input.ammoId ?? null,
    notes: input.notes ?? "",
  };
}

/** Look up a session's parent firearm, or not-found if the session is absent. */
async function firearmIdFor(tx: DbOrTx, id: string): Promise<string> {
  const [row] = await tx
    .select({ firearmId: rangeSession.firearmId })
    .from(rangeSession)
    .where(eq(rangeSession.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.firearmId;
}

export async function createRangeSession(
  actorId: string,
  input: RangeSessionCreateInput,
): Promise<RangeSession> {
  const codes = validateRangeSession(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    // Edit on the parent firearm is required to log a session (KTD2/KTD3).
    await authorizeUpdate(tx, actorId, "firearm", input.firearmId);
    const [row] = await tx
      .insert(rangeSession)
      .values({ firearmId: input.firearmId, ...persistableFields(input) })
      .returning();
    await snapshotMountedAccessories(tx, row.id, input.firearmId);
    return row;
  });
}

/**
 * Snapshot the firearm's currently-mounted accessories into
 * `range_session_accessory` at session-create time (R19) — the only mount
 * history v1 keeps. A firearm with no accessories mounted inserts nothing.
 * Must run inside the same transaction as the session insert.
 */
async function snapshotMountedAccessories(
  tx: DbOrTx,
  rangeSessionId: string,
  firearmId: string,
): Promise<void> {
  const mounted = await tx
    .select({ id: accessory.id })
    .from(accessory)
    .where(eq(accessory.currentFirearmId, firearmId));
  if (mounted.length === 0) return;
  await tx
    .insert(rangeSessionAccessory)
    .values(mounted.map((a) => ({ rangeSessionId, accessoryId: a.id })));
}

export async function updateRangeSession(
  actorId: string,
  id: string,
  input: RangeSessionUpdateInput,
): Promise<RangeSession> {
  return db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, id);
    // Authorize before validating so an invisible/forbidden firearm always
    // yields NotFound/NotAuthorized — never a ValidationError that would reveal
    // the session exists (R70 existence-hiding).
    await authorizeUpdate(tx, actorId, "firearm", firearmId);
    const codes = validateRangeSession({ firearmId, ...input });
    if (codes.length > 0) throw new ValidationError(codes);
    const [row] = await tx
      .update(rangeSession)
      .set({ ...persistableFields(input), updatedAt: new Date() })
      .where(eq(rangeSession.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Delete a session; edit on the parent firearm suffices (KTD3). */
export async function deleteRangeSession(
  actorId: string,
  id: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, id);
    await authorizeUpdate(tx, actorId, "firearm", firearmId);
    await tx.delete(rangeSession).where(eq(rangeSession.id, id));
  });
}

/**
 * A firearm's sessions, newest first. Not-found when the firearm is outside the
 * requester's visible set (existence is never revealed, R70).
 */
export async function listSessionsForFirearm(
  actorId: string,
  firearmId: string,
): Promise<RangeSession[]> {
  const perm = await resolvePermission(db, actorId, "firearm", firearmId);
  if (perm === null) throw new NotFoundError();
  return db
    .select()
    .from(rangeSession)
    .where(eq(rangeSession.firearmId, firearmId))
    .orderBy(desc(rangeSession.date), desc(rangeSession.createdAt));
}

/**
 * Derived lifetime round total per visible firearm (KTD1): `sum(rounds_fired)`
 * grouped by firearm over the actor's visible set. A firearm with no sessions is
 * absent from the map (the page reads it as 0, R6). The sum is cast to a JS
 * number — the pg driver returns bigint as a string.
 *
 * Pass `visibleIds` when the caller already resolved the visible firearm set
 * (e.g. the firearms page derives it from `visibleFirearmPermissions`) to avoid
 * re-deriving owned∪granted a second time; omit it and it resolves its own.
 */
export async function lifetimeRoundTotals(
  actorId: string,
  visibleIds?: Set<string>,
): Promise<Map<string, number>> {
  const visible = visibleIds ?? (await getVisibleIds(db, actorId, "firearm"));
  if (visible.size === 0) return new Map();
  const rows = await db
    .select({
      // sum(integer) is bigint; the pg driver returns it as a string. Keep it
      // bigint (no ::int, which would overflow past int4) and parse at the edge.
      firearmId: rangeSession.firearmId,
      total: sql<string>`coalesce(sum(${rangeSession.roundsFired}), 0)`,
    })
    .from(rangeSession)
    .where(inArray(rangeSession.firearmId, [...visible]))
    .groupBy(rangeSession.firearmId);
  return new Map(rows.map((r) => [r.firearmId, Number(r.total)]));
}

/**
 * Derived rounds-fired total for one accessory (U7 seed for future
 * range-performance logging): `sum(rounds_fired)` over every session the
 * accessory was linked to via `range_session_accessory`, regardless of
 * whether the accessory is still mounted on that session's firearm today —
 * but ONLY over sessions whose firearm is in the requester's visible set.
 * Without that filter, a visible (e.g. currently-owned) accessory that once
 * rode on a firearm the actor can't see would leak that firearm's rounds
 * fired into the total the moment the accessory is remounted. Not-found when
 * the accessory itself is outside the requester's visible set (R70).
 */
export async function accessoryRoundsFired(
  actorId: string,
  accessoryId: string,
): Promise<number> {
  const permission = await resolveAccessoryPermission(db, actorId, accessoryId);
  if (permission === null) throw new NotFoundError();
  const visibleFirearmIds = await getVisibleIds(db, actorId, "firearm");
  if (visibleFirearmIds.size === 0) return 0;
  const [row] = await db
    .select({
      // sum(integer) is bigint; the pg driver returns it as a string.
      total: sql<string>`coalesce(sum(${rangeSession.roundsFired}), 0)`,
    })
    .from(rangeSessionAccessory)
    .innerJoin(
      rangeSession,
      eq(rangeSessionAccessory.rangeSessionId, rangeSession.id),
    )
    .where(
      and(
        eq(rangeSessionAccessory.accessoryId, accessoryId),
        inArray(rangeSession.firearmId, [...visibleFirearmIds]),
      ),
    );
  return Number(row?.total ?? 0);
}

/** One linked accessory as seen by a particular viewer (U7). */
export type SessionAccessoryLink =
  | {
      id: string;
      visible: true;
      category: string;
      brand: string;
      model: string;
    }
  | { id: string; visible: false };

/**
 * The accessories linked to a session (U7), gated by the VIEWER'S CURRENT
 * permission on each — not the permission at session-create time. A join row
 * whose `accessory_id` has gone null (the accessory was deleted, R19) carries
 * no identifiable accessory and is omitted entirely. A join row whose
 * accessory the viewer can no longer see (e.g. it has since been unmounted,
 * R7) is returned as a `{ id, visible: false }` placeholder. When visible,
 * this function only ever fetches category/brand/model — never serial or
 * cost — so the placeholder branch has nothing sensitive to withhold; it
 * exists purely to avoid naming an accessory the viewer can no longer see.
 * Not-found when the session's parent firearm is outside the requester's
 * visible set (R70 existence-hiding).
 */
export async function listSessionAccessories(
  actorId: string,
  rangeSessionId: string,
): Promise<SessionAccessoryLink[]> {
  const firearmId = await firearmIdFor(db, rangeSessionId);
  const perm = await resolvePermission(db, actorId, "firearm", firearmId);
  if (perm === null) throw new NotFoundError();

  const links = await db
    .select({ accessoryId: rangeSessionAccessory.accessoryId })
    .from(rangeSessionAccessory)
    .where(
      and(
        eq(rangeSessionAccessory.rangeSessionId, rangeSessionId),
        isNotNull(rangeSessionAccessory.accessoryId),
      ),
    );
  const linkedIds = links
    .map((link) => link.accessoryId)
    .filter((id): id is string => id !== null);
  if (linkedIds.length === 0) return [];

  // Compute the viewer's visible accessory set once (instead of resolving
  // permission per linked accessory) and batch-fetch the visible rows in a
  // single `inArray` query — avoids the prior per-accessory N+1.
  const visibleAccessoryIds = await listVisibleAccessoryIds(db, actorId);
  const visibleLinkedIds = linkedIds.filter((id) =>
    visibleAccessoryIds.has(id),
  );
  const rows =
    visibleLinkedIds.length === 0
      ? []
      : await db
          .select({
            id: accessory.id,
            category: accessory.category,
            brand: accessory.brand,
            model: accessory.model,
          })
          .from(accessory)
          .where(inArray(accessory.id, visibleLinkedIds));
  const rowById = new Map(rows.map((row) => [row.id, row]));

  return linkedIds.map((id): SessionAccessoryLink => {
    const row = rowById.get(id);
    // A visible id whose row vanished between the two queries (e.g. a
    // concurrent delete) falls back to the same placeholder as "not visible".
    if (!row) return { id, visible: false };
    return {
      id,
      visible: true,
      category: row.category,
      brand: row.brand,
      model: row.model,
    };
  });
}
