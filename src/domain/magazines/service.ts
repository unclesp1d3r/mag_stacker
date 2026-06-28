import { asc, eq, inArray } from "drizzle-orm";
import {
  authorizeAndDeleteParent,
  authorizeUpdate,
  resolveCreateOwner,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { magazine } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { loadCompatibilityBatch, replaceCompatibility } from "./compatibility";
import { type MagazineFields, validateMagazine } from "./validate";

/**
 * Magazine service (U6). Visibility-scoped CRUD with atomic compatibility-set
 * replacement (ordinal ordering, duplicate collapse, visible-firearm FK scoping)
 * to the parity floor. Reads are viewer-relative (R17a). No caliber-match
 * enforcement (R36).
 */

export type MagazineRow = typeof magazine.$inferSelect;
export type MagazineWithCompatibility = MagazineRow & {
  compatibleFirearmIds: string[];
};

export interface MagazineInput extends MagazineFields {
  label?: string;
  /** Calendar date `YYYY-MM-DD`, or null when unset (KTD-7). */
  acquiredDate?: string | null;
  notes?: string;
  compatibleFirearmIds?: string[];
}

export interface MagazineCreateInput extends MagazineInput {
  /** Create-on-behalf target owner; defaults to the acting user (KTD-5). */
  ownerId?: string;
}

function scalarFields(input: MagazineInput) {
  return {
    brandModel: input.brandModel,
    caliber: input.caliber,
    baseCapacity: input.baseCapacity,
    extensionRounds: input.extensionRounds,
    label: input.label ?? "",
    acquiredDate: input.acquiredDate ?? null,
    notes: input.notes ?? "",
  };
}

/** Attach viewer-relative compatibility (ordinal order, unseen firearms dropped). */
async function attachCompatibility(
  database: DbOrTx,
  actorId: string,
  rows: MagazineRow[],
): Promise<MagazineWithCompatibility[]> {
  if (rows.length === 0) return [];
  const visibleFirearms = await getVisibleIds(database, actorId, "firearm");
  const byMag = await loadCompatibilityBatch(
    database,
    visibleFirearms,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    compatibleFirearmIds: byMag.get(r.id) ?? [],
  }));
}

export async function createMagazine(
  actorId: string,
  input: MagazineCreateInput,
): Promise<MagazineWithCompatibility> {
  const codes = validateMagazine(input, 1);
  if (codes.length > 0) throw new ValidationError(codes);

  const row = await db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);
    const [created] = await tx
      .insert(magazine)
      .values({ ownerId, ...scalarFields(input) })
      .returning();
    await replaceCompatibility(
      tx,
      actorId,
      created.id,
      input.compatibleFirearmIds ?? [],
    );
    return created;
  });
  const [withCompat] = await attachCompatibility(db, actorId, [row]);
  return withCompat;
}

export async function updateMagazine(
  actorId: string,
  id: string,
  input: MagazineInput,
): Promise<MagazineWithCompatibility> {
  const codes = validateMagazine(input, 1);
  if (codes.length > 0) throw new ValidationError(codes);

  const row = await db.transaction(async (tx) => {
    await authorizeUpdate(tx, actorId, "magazine", id);
    const [updated] = await tx
      .update(magazine)
      .set({ ...scalarFields(input), updatedAt: new Date() })
      .where(eq(magazine.id, id))
      .returning();
    if (!updated) throw new NotFoundError();
    // A bad/unseeable link throws here, rolling back the scalar update too (R32).
    await replaceCompatibility(
      tx,
      actorId,
      id,
      input.compatibleFirearmIds ?? [],
    );
    return updated;
  });
  const [withCompat] = await attachCompatibility(db, actorId, [row]);
  return withCompat;
}

/** Owner-only delete; cascades join rows + grants (R35, R17b). */
export async function deleteMagazine(
  actorId: string,
  id: string,
): Promise<void> {
  await authorizeAndDeleteParent(actorId, "magazine", id);
}

export async function getMagazine(
  actorId: string,
  id: string,
): Promise<MagazineWithCompatibility> {
  const perm = await resolvePermission(db, actorId, "magazine", id);
  if (perm === null) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(magazine)
    .where(eq(magazine.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  const [withCompat] = await attachCompatibility(db, actorId, [row]);
  return withCompat;
}

/** Owned + shared magazines ordered by brand/model ascending; always an array (R27/R68). */
export async function listMagazines(
  actorId: string,
): Promise<MagazineWithCompatibility[]> {
  const visible = await getVisibleIds(db, actorId, "magazine");
  if (visible.size === 0) return [];
  const rows = await db
    .select()
    .from(magazine)
    .where(inArray(magazine.id, [...visible]))
    .orderBy(asc(magazine.brandModel));
  return attachCompatibility(db, actorId, rows);
}
