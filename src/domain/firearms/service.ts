import { eq, inArray, sql } from "drizzle-orm";
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
import { firearm, firearmDocument, firearmPhoto } from "@/src/db/schema";
import { logAction } from "@/src/lib/logging";
import { deleteDocumentBlob, deletePhotoBlobs } from "@/src/storage";
import { ValidationError } from "../errors";
import { firearmDisplayName } from "./display";
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
  /** NFA-regulated item flag (#8); no validation constraint. */
  isNfa?: boolean;
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
    isNfa: input.isNfa ?? false,
  };
}

export async function createFirearm(
  actorId: string,
  input: FirearmCreateInput,
): Promise<Firearm> {
  const codes = validateFirearm(input);
  if (codes.length > 0) throw new ValidationError(codes);

  const row = await db.transaction(async (tx) => {
    const ownerId = await resolveCreateOwner(tx, actorId, input.ownerId);
    const [created] = await tx
      .insert(firearm)
      .values({ ownerId, ...persistableFields(input) })
      .returning();
    return created;
  });
  // Emitted AFTER the tx commits (KTD-5) — a rolled-back create logs nothing.
  logAction({
    verb: "created",
    objectType: "firearm",
    objectLabel: firearmDisplayName(row),
  });
  return row;
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

/**
 * Owner-only delete; removes this firearm's join rows + grants (R23, R35,
 * R17b) and best-effort deletes its photo AND document blobs (R8, R19, KTD8).
 *
 * Blob deletion runs AFTER the delete transaction commits, mirroring
 * `deletePhoto` (`src/domain/firearm-photos/service.ts`). The pre-delete hook
 * only READS the firearm's storage keys (safe — the rows still exist inside
 * the transaction); the actual `deletePhotoBlobs`/`deleteDocumentBlob` calls
 * happen once the row cascade has committed. Deleting blobs before commit would
 * be unsafe: if the row delete rolls back (a DB error, or the
 * `deleted.length === 0` concurrent-delete race in `authorizeAndDeleteParent`),
 * the child rows survive but their bytes would already be gone — a live row
 * pointing at a missing blob, which `orphanSweep` cannot repair (it only
 * reclaims UNreferenced blobs). The reverse residue — a committed delete whose
 * post-commit blob cleanup fails — is the benign case `orphanSweep` handles.
 *
 * Document blobs (R19) share this cleanup so ATF forms/receipts are never left
 * to the bare FK cascade when a firearm is deleted through THIS function.
 *
 * Caveat — the owning-user-account clause of R19 is NOT covered here: user
 * deletion is a raw DB delete whose `owner_id` FK cascade drops firearm (and
 * firearm_document) rows directly, without ever calling this function, so this
 * hook never runs for that path. Those blobs are reclaimed only by `orphanSweep`
 * (the backstop), which has no scheduler wired up. Fully closing the user-delete
 * clause needs a dedicated pre-delete cleanup on the account-deletion path
 * (follow-up); this gap is pre-existing for photos too.
 */
export async function deleteFirearm(
  actorId: string,
  id: string,
): Promise<void> {
  const photoKeys: string[] = [];
  const documentKeys: string[] = [];
  let deletedName: { name: string; nickname: string } | undefined;
  await authorizeAndDeleteParent(
    actorId,
    "firearm",
    id,
    db,
    async (tx, fid) => {
      const [row] = await tx
        .select({ name: firearm.name, nickname: firearm.nickname })
        .from(firearm)
        .where(eq(firearm.id, fid))
        .limit(1);
      deletedName = row;

      const photos = await tx
        .select({ storageKey: firearmPhoto.storageKey })
        .from(firearmPhoto)
        .where(eq(firearmPhoto.firearmId, fid));
      photoKeys.push(...photos.map((photo) => photo.storageKey));

      const documents = await tx
        .select({ storageKey: firearmDocument.storageKey })
        .from(firearmDocument)
        .where(eq(firearmDocument.firearmId, fid));
      documentKeys.push(...documents.map((doc) => doc.storageKey));
    },
  );

  // Emitted AFTER the tx commits (KTD-5) — a rolled-back delete logs nothing.
  if (deletedName) {
    logAction({
      verb: "deleted",
      objectType: "firearm",
      objectLabel: firearmDisplayName(deletedName),
    });
  }

  await Promise.all([
    ...photoKeys.map((key) => deletePhotoBlobs(key)),
    ...documentKeys.map((key) => deleteDocumentBlob(key)),
  ]);
}

/** Get a single firearm, or not-found if it is outside the requester's visible set. */
export async function getFirearm(
  actorId: string,
  id: string,
): Promise<{ firearm: Firearm; permission: Permission }> {
  const permission = await resolvePermission(db, actorId, "firearm", id);
  if (permission === null) throw new NotFoundError();
  const [row] = await db
    .select()
    .from(firearm)
    .where(eq(firearm.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  // Return the viewer's permission alongside the row so the caller doesn't
  // re-resolve it (one query, and no read-vs-permission race between two calls).
  return { firearm: row, permission };
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
