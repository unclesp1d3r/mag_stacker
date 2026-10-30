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
import { loadLastInventoriedBatch } from "@/src/domain/inventory-log/last-inventoried";
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

/**
 * A lot with its derived Last Inventoried attached (#100 R15): the
 * `occurredAt` of its latest `inventoried` log entry, or `null` when it has
 * never been counted. Derived, never stored.
 */
export type AmmoListRow = Ammo & { lastInventoriedAt: Date | null };

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
  /** Create-on-behalf target owner; defaults to the acting user (KTD7). */
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

/**
 * Get a single ammo lot, or not-found if it is outside the requester's visible
 * set. Also carries the lot's Last Inventoried (#100 R15), loaded for this one
 * id only after visibility resolved.
 */
export async function getAmmo(
  actorId: string,
  id: string,
): Promise<{
  ammo: Ammo;
  permission: Permission;
  lastInventoriedAt: Date | null;
}> {
  const permission = await resolvePermission(db, actorId, "ammo", id);
  if (permission === null) throw new NotFoundError();
  const [row] = await db.select().from(ammo).where(eq(ammo.id, id)).limit(1);
  if (!row) throw new NotFoundError();
  const byId = await loadLastInventoriedBatch(db, "ammo", [row.id]);
  // Return the viewer's permission alongside the row so the caller doesn't
  // re-resolve it (one query, and no read-vs-permission race between two calls).
  return { ammo: row, permission, lastInventoriedAt: byId.get(row.id) ?? null };
}

/**
 * Owned + shared ammo lots ordered by caliber, then brand, then grain
 * (ascending); always an array (R68-style). Records sharing brand/caliber/
 * type/grain are never merged (R7) — they list as separate rows. Each row
 * carries its Last Inventoried, batch-loaded in one grouped query over the
 * already visibility-scoped ids (#100 R15/R17, KTD7) — the loader trusts its
 * id input, so this call site is the scoping boundary.
 */
export async function listAmmo(actorId: string): Promise<AmmoListRow[]> {
  const visible = await getVisibleIds(db, actorId, "ammo");
  if (visible.size === 0) return [];
  const visibleIds = [...visible];
  // Independent queries over the same scoped id set — run them concurrently
  // on the shared pool (mirrors `listMagazinesFiltered`).
  const [rows, byId] = await Promise.all([
    db
      .select()
      .from(ammo)
      .where(inArray(ammo.id, visibleIds))
      .orderBy(asc(ammo.caliber), asc(ammo.brand), asc(ammo.grain)),
    loadLastInventoriedBatch(db, "ammo", visibleIds),
  ]);
  return rows.map((r) => ({
    ...r,
    lastInventoriedAt: byId.get(r.id) ?? null,
  }));
}
