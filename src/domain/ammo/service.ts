import { asc, eq, inArray } from "drizzle-orm";
import {
  authorizeAndDeleteParent,
  authorizeUpdate,
  resolveCreateOwner,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import {
  getVisibleIds,
  type Permission,
  resolvePermission,
} from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { ammo } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { type AmmoFields, validateAmmo } from "./validate";

/**
 * Ammo service (ammo plan U3). Visibility-scoped CRUD mirroring
 * `src/domain/firearms/service.ts` exactly — ammo is edit-capable-shareable
 * like firearms (not owner-only like magazines), so it uses `authorizeUpdate`
 * (owner or edit-grantee), not `authorizeOwnerOnlyUpdate`. Every read/write
 * resolves through the shared auth scoping layer (R3/R4). Validation runs
 * before any write (R8); raw values are persisted (R18) except where noted.
 */

export type Ammo = typeof ammo.$inferSelect;

export interface AmmoInput extends AmmoFields {
  /** Optional brand; empty-not-null when omitted (R2/R18). */
  brand?: string;
  /** Optional load type (free text with UI suggestions, R6). */
  type?: string;
  /** Calendar date `YYYY-MM-DD`, or null when unset (KTD-7). */
  acquiredDate?: string | null;
  notes?: string;
}

export interface AmmoCreateInput extends AmmoInput {
  /** Create-on-behalf target owner; defaults to the acting user (KTD-5). */
  ownerId?: string;
}

export type AmmoUpdateInput = Omit<AmmoCreateInput, "ownerId">;

function persistableFields(input: AmmoCreateInput | AmmoUpdateInput) {
  return {
    // Raw values persisted verbatim (R18/R19); optional text is empty-not-null.
    brand: input.brand ?? "",
    caliber: input.caliber,
    type: input.type ?? "",
    grain: input.grain,
    quantityRounds: input.quantityRounds,
    lowStockThreshold: input.lowStockThreshold,
    acquiredDate: input.acquiredDate ?? null,
    notes: input.notes ?? "",
  };
}

export async function createAmmo(
  actorId: string,
  input: AmmoCreateInput,
): Promise<Ammo> {
  const codes = validateAmmo(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);
    const [row] = await tx
      .insert(ammo)
      .values({ ownerId, ...persistableFields(input) })
      .returning();
    return row;
  });
}

export async function updateAmmo(
  actorId: string,
  id: string,
  input: AmmoUpdateInput,
): Promise<Ammo> {
  const codes = validateAmmo(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await authorizeUpdate(tx, actorId, "ammo", id);
    const [row] = await tx
      .update(ammo)
      .set({ ...persistableFields(input), updatedAt: new Date() })
      .where(eq(ammo.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Owner-only delete; removes this lot's grants via the DB cleanup trigger (R17b-style). */
export async function deleteAmmo(actorId: string, id: string): Promise<void> {
  await authorizeAndDeleteParent(actorId, "ammo", id);
}

/** Get a single ammo lot, or not-found if it is outside the requester's visible set. */
export async function getAmmo(
  actorId: string,
  id: string,
): Promise<{ ammo: Ammo; permission: Permission }> {
  const permission = await resolvePermission(db, actorId, "ammo", id);
  if (permission === null) throw new NotFoundError();
  const [row] = await db.select().from(ammo).where(eq(ammo.id, id)).limit(1);
  if (!row) throw new NotFoundError();
  // Return the viewer's permission alongside the row so the caller doesn't
  // re-resolve it (one query, and no read-vs-permission race between two calls).
  return { ammo: row, permission };
}

/**
 * Owned + shared ammo lots ordered by caliber, then brand, then grain
 * (ascending); always an array (R68-style). Records sharing brand/caliber/
 * type/grain are never merged (R7) — they list as separate rows.
 */
export async function listAmmo(actorId: string): Promise<Ammo[]> {
  const visible = await getVisibleIds(db, actorId, "ammo");
  if (visible.size === 0) return [];
  return db
    .select()
    .from(ammo)
    .where(inArray(ammo.id, [...visible]))
    .orderBy(asc(ammo.caliber), asc(ammo.brand), asc(ammo.grain));
}
