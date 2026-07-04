import { desc, eq, inArray, sql } from "drizzle-orm";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { rangeSession } from "@/src/db/schema";
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
    return row;
  });
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
