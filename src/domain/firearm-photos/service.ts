import { and, asc, eq, inArray } from "drizzle-orm";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { firearmPhoto } from "@/src/db/schema";
import {
  type DerivativeVariant,
  deletePhotoBlobs,
  deriveKey,
  generateKey,
  storage,
} from "@/src/storage";
import { ValidationError } from "../errors";
import { MAX_PHOTOS_PER_FIREARM } from "./constants";
import { processImage } from "./pipeline";
import {
  assertBatchSize,
  type PhotoUploadValidationCode,
  validatePhotoUpload,
} from "./validate";

/**
 * Firearm-photo service (#9, U4). Photos are a firearm child (R6): no
 * `owner_id`/grants on the table, every read and write resolves through the
 * parent firearm's visibility/authorization exactly like
 * `src/domain/range-sessions/service.ts` — `authorizeUpdate` for writes,
 * `resolvePermission` for reads, authorize-BEFORE-validate so an
 * invisible/forbidden firearm always yields NotFound/NotAuthorized, never a
 * leak that would reveal a photo (or its parent) exists (R70-style
 * existence-hiding).
 */

export type FirearmPhoto = typeof firearmPhoto.$inferSelect;

/** One file offered to `createPhotos`. `filename` is accepted but never
 * persisted — the schema carries no filename column; a caller-facing
 * accessible name is synthesized in the UI (R24, U7). */
export interface CreatePhotoInput {
  bytes: Uint8Array | Buffer;
  mimeType: string;
  sizeBytes: number;
  filename?: string;
}

export type CreatePhotoFailureCode =
  | PhotoUploadValidationCode
  | "processingFailed";

export type CreatePhotoResult =
  | { ok: true; photo: FirearmPhoto }
  | { ok: false; codes: CreatePhotoFailureCode[] };

/** Look up a photo's parent firearm, or not-found if the photo is absent. */
async function firearmIdFor(tx: DbOrTx, id: string): Promise<string> {
  const [row] = await tx
    .select({ firearmId: firearmPhoto.firearmId })
    .from(firearmPhoto)
    .where(eq(firearmPhoto.id, id))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row.firearmId;
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** File extension for a storage key. `validatePhotoUpload` has already
 * rejected any mime type outside the allow-list by the time this runs. */
function extFromMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
}

/**
 * Upload one or more photos to a firearm (F1, R5, R9-R11, R14, R20, R21,
 * R26). Edit access on the firearm is authorized ONCE up front, before any
 * per-file work. The per-request file cap (R26) is enforced next, then the
 * per-firearm quota (R20) against the combined existing + incoming count —
 * exceeding either rejects the whole call before any file is processed.
 * From there each file is evaluated independently (R21): a validation or
 * processing failure on one file never blocks the others, so the caller gets
 * a per-file result in input order. The first photo persisted on a firearm
 * with no existing primary becomes primary; every later photo (in this call
 * or a future one) does not.
 */
export async function createPhotos(
  actorId: string,
  firearmId: string,
  inputs: CreatePhotoInput[],
): Promise<CreatePhotoResult[]> {
  return db.transaction(async (tx) => {
    await authorizeUpdate(tx, actorId, "firearm", firearmId);

    const batchSizeCodes = assertBatchSize(inputs.length);
    if (batchSizeCodes.length > 0) throw new ValidationError(batchSizeCodes);

    const existing = await tx
      .select({
        sortOrder: firearmPhoto.sortOrder,
        isPrimary: firearmPhoto.isPrimary,
      })
      .from(firearmPhoto)
      .where(eq(firearmPhoto.firearmId, firearmId));

    if (existing.length + inputs.length > MAX_PHOTOS_PER_FIREARM) {
      throw new ValidationError(["photoQuotaExceeded"]);
    }

    let nextSortOrder =
      existing.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;
    let hasPrimary = existing.some((p) => p.isPrimary);

    const results: CreatePhotoResult[] = [];
    for (const input of inputs) {
      const codes = validatePhotoUpload(input);
      if (codes.length > 0) {
        results.push({ ok: false, codes });
        continue;
      }

      let processed: Awaited<ReturnType<typeof processImage>>;
      try {
        processed = await processImage(input.bytes, input.mimeType);
      } catch {
        results.push({ ok: false, codes: ["processingFailed"] });
        continue;
      }

      const key = generateKey(extFromMimeType(input.mimeType));
      await storage.save(key, processed.original);
      await storage.save(deriveKey(key, "thumb"), processed.thumb);
      await storage.save(deriveKey(key, "preview"), processed.preview);

      const isPrimary = !hasPrimary;
      const [row] = await tx
        .insert(firearmPhoto)
        .values({
          firearmId,
          storageKey: key,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          width: processed.width,
          height: processed.height,
          caption: "",
          sortOrder: nextSortOrder,
          isPrimary,
        })
        .returning();

      if (isPrimary) hasPrimary = true;
      nextSortOrder += 1;
      results.push({ ok: true, photo: row });
    }
    return results;
  });
}

/**
 * A firearm's photos, gallery order. Not-found when the firearm is outside
 * the requester's visible set (existence is never revealed).
 */
export async function listPhotos(
  actorId: string,
  firearmId: string,
): Promise<FirearmPhoto[]> {
  const perm = await resolvePermission(db, actorId, "firearm", firearmId);
  if (perm === null) throw new NotFoundError();
  return db
    .select()
    .from(firearmPhoto)
    .where(eq(firearmPhoto.firearmId, firearmId))
    .orderBy(asc(firearmPhoto.sortOrder));
}

/**
 * Delete a single photo (F3, R19): removes the row and best-effort deletes
 * its original + derivative blobs. If the deleted photo was primary, the
 * next photo by sort order is auto-promoted to primary (R23, AE8); if none
 * remain, the firearm has no primary.
 *
 * The transaction does DB work only (row delete + auto-promotion); blob
 * deletion runs AFTER the transaction resolves, once the row delete has
 * actually committed. If a later statement inside the transaction were to
 * throw, the row delete rolls back — running the blob delete beforehand
 * would have already destroyed bytes a rolled-back (still-live) row points
 * at, leaving no way to recover them.
 */
export async function deletePhoto(
  actorId: string,
  photoId: string,
): Promise<void> {
  const storageKey = await db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, photoId);
    await authorizeUpdate(tx, actorId, "firearm", firearmId);

    const [deleted] = await tx
      .delete(firearmPhoto)
      .where(eq(firearmPhoto.id, photoId))
      .returning();
    if (!deleted) throw new NotFoundError();

    if (deleted.isPrimary) {
      const [next] = await tx
        .select({ id: firearmPhoto.id })
        .from(firearmPhoto)
        .where(eq(firearmPhoto.firearmId, firearmId))
        .orderBy(asc(firearmPhoto.sortOrder))
        .limit(1);
      if (next) {
        await tx
          .update(firearmPhoto)
          .set({ isPrimary: true })
          .where(eq(firearmPhoto.id, next.id));
      }
    }

    return deleted.storageKey;
  });

  await deletePhotoBlobs(storageKey);
}

/**
 * Mark a photo primary, clearing any prior primary on the same firearm in
 * the same transaction (F2, R7 — at most one primary at a time).
 */
export async function setPrimary(
  actorId: string,
  photoId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, photoId);
    await authorizeUpdate(tx, actorId, "firearm", firearmId);

    await tx
      .update(firearmPhoto)
      .set({ isPrimary: false })
      .where(
        and(
          eq(firearmPhoto.firearmId, firearmId),
          eq(firearmPhoto.isPrimary, true),
        ),
      );
    await tx
      .update(firearmPhoto)
      .set({ isPrimary: true })
      .where(eq(firearmPhoto.id, photoId));
  });
}

/**
 * Persist a new gallery order (F3, R15). `orderedPhotoIds` is expected to be
 * every photo id for `firearmId` in its new order; the `firearmId` guard on
 * each update means an id for a different firearm is silently a no-op rather
 * than cross-contaminating another firearm's gallery.
 *
 * `orderedPhotoIds.length` is capped at `MAX_PHOTOS_PER_FIREARM` (mirroring
 * `assertBatchSize` in `validate.ts`) so an authorized editor can't submit an
 * arbitrarily large id list and force that many sequential UPDATEs inside one
 * transaction — a firearm can never legitimately hold more photos than the
 * quota, so any longer list is already invalid. Checked AFTER authorization,
 * matching this module's authorize-before-validate rule (see file doc
 * comment), so an invisible/forbidden firearm still yields NotFound/
 * NotAuthorized rather than leaking a validation result.
 */
export async function reorderPhotos(
  actorId: string,
  firearmId: string,
  orderedPhotoIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await authorizeUpdate(tx, actorId, "firearm", firearmId);

    if (orderedPhotoIds.length > MAX_PHOTOS_PER_FIREARM) {
      throw new ValidationError(["tooManyPhotos"]);
    }

    for (const [index, photoId] of orderedPhotoIds.entries()) {
      await tx
        .update(firearmPhoto)
        .set({ sortOrder: index })
        .where(
          and(
            eq(firearmPhoto.id, photoId),
            eq(firearmPhoto.firearmId, firearmId),
          ),
        );
    }
  });
}

/** Set (or clear) a photo's caption (F3, R15). Empty-not-null. */
export async function setCaption(
  actorId: string,
  photoId: string,
  caption: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const firearmId = await firearmIdFor(tx, photoId);
    await authorizeUpdate(tx, actorId, "firearm", firearmId);
    await tx
      .update(firearmPhoto)
      .set({ caption })
      .where(eq(firearmPhoto.id, photoId));
  });
}

export interface PrimaryThumbnail {
  id: string;
  mimeType: string;
}

/**
 * Batched primary-photo lookup for a set of firearms (R18, U8 seed): one
 * query, not N per-row fetches. Scoped to the actor's visible set — a
 * firearm the actor can't see is silently excluded from the result rather
 * than throwing, since this powers list/search rendering across many
 * firearms at once, not a single-item detail fetch.
 */
export async function primaryThumbnailsFor(
  actorId: string,
  firearmIds: string[],
): Promise<Map<string, PrimaryThumbnail>> {
  if (firearmIds.length === 0) return new Map();
  const visible = await getVisibleIds(db, actorId, "firearm");
  const targetIds = firearmIds.filter((id) => visible.has(id));
  if (targetIds.length === 0) return new Map();

  const rows = await db
    .select({
      firearmId: firearmPhoto.firearmId,
      id: firearmPhoto.id,
      mimeType: firearmPhoto.mimeType,
    })
    .from(firearmPhoto)
    .where(
      and(
        inArray(firearmPhoto.firearmId, targetIds),
        eq(firearmPhoto.isPrimary, true),
      ),
    );
  return new Map(
    rows.map((row) => [row.firearmId, { id: row.id, mimeType: row.mimeType }]),
  );
}

/** A servable photo variant: the original or one of its derivatives. */
export type PhotoVariant = "original" | DerivativeVariant;

export interface ServablePhoto {
  bytes: Buffer;
  mimeType: string;
}

/**
 * Resolve a photo's bytes + stored MIME type for authenticated streaming
 * (U6, KTD6, R12, R13). Authz is resolved against the PARENT FIREARM via
 * `resolvePermission` — any visibility level (owner/edit/view) can read, per
 * the read/write split (R12 vs R14: reads need only visibility, writes need
 * edit). Returns null when the photo id doesn't exist OR the actor holds no
 * permission on its parent firearm — the two cases are indistinguishable to
 * the caller so the Route Handler maps both to a bare 404 without revealing
 * which one occurred (existence-hiding, AE2).
 */
export async function getServablePhoto(
  actorId: string,
  photoId: string,
  variant: PhotoVariant,
): Promise<ServablePhoto | null> {
  const [row] = await db
    .select({
      firearmId: firearmPhoto.firearmId,
      storageKey: firearmPhoto.storageKey,
      mimeType: firearmPhoto.mimeType,
    })
    .from(firearmPhoto)
    .where(eq(firearmPhoto.id, photoId))
    .limit(1);
  if (!row) return null;

  const permission = await resolvePermission(
    db,
    actorId,
    "firearm",
    row.firearmId,
  );
  if (permission === null) return null;

  const key =
    variant === "original"
      ? row.storageKey
      : deriveKey(row.storageKey, variant);
  const bytes = await storage.read(key);
  return { bytes, mimeType: row.mimeType };
}
