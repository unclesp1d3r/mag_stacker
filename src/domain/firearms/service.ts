import { eq, inArray, sql } from "drizzle-orm";
import {
  authorizeAndDeleteParent,
  authorizeUpdate,
  resolveCreateOwner,
} from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import { firearm } from "@/src/db/schema";
import { ValidationError } from "../errors";
import { type FirearmInput, validateFirearm } from "./validate";

/**
 * Firearm service (U5). Visibility-scoped CRUD/list to the parity floor. Every
 * read/write resolves through the U4 scoping layer (R66). Validation runs before
 * any write (R21); raw values are persisted (R18).
 */

export type Firearm = typeof firearm.$inferSelect;

export interface FirearmCreateInput extends FirearmInput {
  /** Optional owner nickname; empty-not-null when omitted (#18, R18). */
  nickname?: string;
  manufacturer?: string;
  /** Optional free-text subtype; empty-not-null when omitted (R3/R18). */
  subtype?: string;
  serialNumber?: string;
  notes?: string;
  /** Create-on-behalf target owner; defaults to the acting user (KTD-5). */
  ownerId?: string;
}

export type FirearmUpdateInput = Omit<FirearmCreateInput, "ownerId">;

function persistableFields(input: FirearmCreateInput | FirearmUpdateInput) {
  return {
    // Raw values persisted verbatim (R18/R19); optional text is empty-not-null.
    name: input.name,
    // Nickname is a display label, so trim it on write (unlike the verbatim
    // fields): a stored nickname never carries leading/trailing whitespace, which
    // keeps the list sort key equal to firearmDisplayName without any SQL-side
    // trimming, and collapses a whitespace-only entry to "" (no nickname) (#18).
    nickname: (input.nickname ?? "").trim(),
    caliber: input.caliber,
    // Controlled taxonomy — validated real by validateFirearm before persist (U3).
    type: input.type,
    action: input.action,
    subtype: input.subtype ?? "",
    manufacturer: input.manufacturer ?? "",
    serialNumber: input.serialNumber ?? "",
    notes: input.notes ?? "",
  };
}

export async function createFirearm(
  actorId: string,
  input: FirearmCreateInput,
): Promise<Firearm> {
  const codes = validateFirearm(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);
    const [row] = await tx
      .insert(firearm)
      .values({ ownerId, ...persistableFields(input) })
      .returning();
    return row;
  });
}

export async function updateFirearm(
  actorId: string,
  id: string,
  input: FirearmUpdateInput,
): Promise<Firearm> {
  const codes = validateFirearm(input);
  if (codes.length > 0) throw new ValidationError(codes);

  return db.transaction(async (tx) => {
    await authorizeUpdate(tx, actorId, "firearm", id);
    const [row] = await tx
      .update(firearm)
      .set({ ...persistableFields(input), updatedAt: new Date() })
      .where(eq(firearm.id, id))
      .returning();
    if (!row) throw new NotFoundError();
    return row;
  });
}

/** Owner-only delete; removes this firearm's join rows + grants (R23, R35, R17b). */
export async function deleteFirearm(
  actorId: string,
  id: string,
): Promise<void> {
  await authorizeAndDeleteParent(actorId, "firearm", id);
}

/** Get a single firearm, or not-found if it is outside the requester's visible set. */
export async function getFirearm(
  actorId: string,
  id: string,
): Promise<Firearm> {
  const perm = await resolvePermission(db, actorId, "firearm", id);
  if (perm === null) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(firearm)
    .where(eq(firearm.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

/**
 * Owned + shared firearms ordered by the displayed label ascending; always an
 * array (R22, R68). The sort key is `firearmDisplayName`'s output: the nickname
 * when present, else the product name (#18). Because the service trims the
 * nickname on write (see `persistableFields`), a stored nickname is already
 * whitespace-normalized, so a plain `coalesce(nullif(nickname, ''), name)`
 * matches what the list shows without any SQL-side trimming.
 */
export async function listFirearms(actorId: string): Promise<Firearm[]> {
  const visible = await getVisibleIds(db, actorId, "firearm");
  if (visible.size === 0) return [];
  return db
    .select()
    .from(firearm)
    .where(inArray(firearm.id, [...visible]))
    .orderBy(sql`coalesce(nullif(${firearm.nickname}, ''), ${firearm.name})`);
}
