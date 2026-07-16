import { and, asc, eq, inArray } from "drizzle-orm";
import { authorizeUpdate } from "@/src/auth/authorize";
import { NotFoundError } from "@/src/auth/errors";
import { getVisibleIds, resolvePermission } from "@/src/auth/visibility";
import { type DbOrTx, db } from "@/src/db/client";
import { firearm, firearmPhoto } from "@/src/db/schema";
import { childLogger } from "@/src/lib/logging";
import {
  deletePhotoBlobs,
  deriveKey,
  generateKey,
  storage,
} from "@/src/storage";
import { ValidationError } from "../errors";
import {
  type AllowedMimeType,
  isAllowedMimeType,
  MAX_PHOTOS_PER_FIREARM,
} from "./constants";
import { processImage } from "./pipeline";
import type { PhotoUrlVariant } from "./urls";
import {
  assertBatchSize,
  type BatchSizeValidationCode,
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

const log = childLogger("firearm-photos");

export type FirearmPhoto = typeof firearmPhoto.$inferSelect;

/** One file offered to `createPhotos`. `filename` is accepted but never
 * persisted — the schema carries no filename column; a caller-facing
 * accessible name is synthesized in the UI (R24, U7). */
export interface CreatePhotoInput {
  bytes: Uint8Array | Buffer;
  mimeType: string;
  filename?: string;
}

export type CreatePhotoFailureCode =
  | PhotoUploadValidationCode
  | "processingFailed";

export type CreatePhotoResult =
  | { ok: true; photo: FirearmPhoto }
  | { ok: false; codes: CreatePhotoFailureCode[] };

/**
 * Every code a `createPhotos` call can surface: the per-file
 * `CreatePhotoFailureCode`s plus the whole-call codes thrown as a
 * `ValidationError` (the batch-size cap and the per-firearm quota). Exported as
 * the single source of truth for the upload UI's message map, which would
 * otherwise re-derive the set by hand and silently fall back to a generic
 * message when a new code is added here.
 */
export type CreatePhotoErrorCode =
  | CreatePhotoFailureCode
  | BatchSizeValidationCode
  | "photoQuotaExceeded";

/** The full photo-service failure vocabulary, adding `reorderPhotos`' cap. */
export type PhotoServiceErrorCode = CreatePhotoErrorCode | "tooManyPhotos";

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

const EXTENSION_BY_MIME_TYPE: Record<AllowedMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** File extension for a storage key. `validatePhotoUpload` has already
 * rejected any mime type outside the allow-list by the time this runs. */
function extFromMimeType(mimeType: AllowedMimeType): string {
  return EXTENSION_BY_MIME_TYPE[mimeType];
}

/** A file that cleared validation + processing: its original/derivative blobs
 * are already written to storage, awaiting its DB row. `index` ties the row
 * back to the right slot of the returned per-file result array. */
interface PreparedPhoto {
  index: number;
  key: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * Upload one or more photos to a firearm (F1, R5, R9-R11, R14, R20, R21,
 * R26). Edit access is authorized up front (before any per-file work), then
 * the per-request cap (R26) and an optimistic per-firearm quota check (R20)
 * reject an over-limit call before anything is processed.
 *
 * Each file is then decoded, re-encoded, and written to storage INDEPENDENTLY
 * and OUTSIDE any transaction (R21): a validation, processing, or storage
 * failure on one file becomes that file's result without aborting the batch or
 * holding a DB connection during the CPU/IO work (a partial blob write is
 * cleaned up in place). Only the successful files' row inserts run in a short
 * transaction that re-authorizes, locks the firearm row, and re-checks the
 * quota atomically against concurrent uploads. If that transaction rolls back,
 * the already-written blobs for the batch are deleted directly rather than
 * left for the orphan sweep. The caller gets a per-file result in input order;
 * the first photo persisted on a firearm with no existing primary becomes
 * primary, every later one does not.
 */
export async function createPhotos(
  actorId: string,
  firearmId: string,
  inputs: CreatePhotoInput[],
): Promise<CreatePhotoResult[]> {
  // Authorize first (existence-hiding), then the per-request cap, then an
  // optimistic quota check — all before any file is read, decoded, or written.
  await authorizeUpdate(db, actorId, "firearm", firearmId);

  const batchSizeCodes = assertBatchSize(inputs.length);
  if (batchSizeCodes.length > 0) throw new ValidationError(batchSizeCodes);

  // Optimistic (unlocked) quota check: reject an obviously-over-quota batch
  // before wasting any sharp work or blob write. The authoritative, race-safe
  // check runs under a row lock in the transaction below. Reads all photo ids
  // for the firearm — bounded by MAX_PHOTOS_PER_FIREARM, so trivially small.
  const existingIds = await db
    .select({ id: firearmPhoto.id })
    .from(firearmPhoto)
    .where(eq(firearmPhoto.firearmId, firearmId));
  if (existingIds.length + inputs.length > MAX_PHOTOS_PER_FIREARM) {
    throw new ValidationError([
      "photoQuotaExceeded",
    ] satisfies PhotoServiceErrorCode[]);
  }

  // Process every file OUTSIDE any transaction (R21): decode/re-encode with
  // sharp and write its blobs per file, so a validation, processing, or
  // storage failure on one file becomes that file's result without aborting
  // the batch or holding a DB connection during the CPU/IO work. Each success
  // yields a `PreparedPhoto` whose blobs are already on disk, awaiting its row.
  const results = new Array<CreatePhotoResult>(inputs.length);
  const prepared: PreparedPhoto[] = [];
  for (const [index, input] of inputs.entries()) {
    // Size is the actual uploaded-buffer length, not a caller-declared field
    // (the two can't drift). Used for both the size-cap check and the stored
    // `size_bytes`.
    const sizeBytes = input.bytes.byteLength;
    const codes = validatePhotoUpload({ mimeType: input.mimeType, sizeBytes });
    if (codes.length > 0) {
      results[index] = { ok: false, codes };
      continue;
    }
    // Re-narrow `input.mimeType` from `string` to `AllowedMimeType` (validation
    // already guaranteed membership) so the validated-boundary type threads
    // into the pipeline rather than a bare `string`. Unreachable in practice.
    if (!isAllowedMimeType(input.mimeType)) {
      results[index] = { ok: false, codes: ["disallowedMimeType"] };
      continue;
    }

    let processed: Awaited<ReturnType<typeof processImage>>;
    try {
      processed = await processImage(input.bytes, input.mimeType);
    } catch (error) {
      // Dynamic values (incl. the user-controlled mimeType) go as structured
      // fields, never in the message string (js/tainted-format-string).
      log.error(
        { err: error, firearmId, mimeType: input.mimeType },
        "processImage failed",
      );
      results[index] = { ok: false, codes: ["processingFailed"] };
      continue;
    }

    const key = generateKey(extFromMimeType(input.mimeType));
    try {
      await storage.save(key, processed.original);
      await storage.save(deriveKey(key, "thumb"), processed.thumb);
      await storage.save(deriveKey(key, "preview"), processed.preview);
    } catch (error) {
      // A partial write can leave 0-3 blobs behind for this key; delete them
      // best-effort so a storage failure doesn't leak, and report this file as
      // failed without touching the others.
      log.error({ err: error, firearmId }, "storage.save failed");
      await deletePhotoBlobs(key);
      results[index] = { ok: false, codes: ["processingFailed"] };
      continue;
    }

    prepared.push({
      index,
      key,
      mimeType: input.mimeType,
      sizeBytes,
      width: processed.width,
      height: processed.height,
    });
  }

  if (prepared.length === 0) return results;

  // Short transaction: only DB work runs here (no sharp/IO), so the connection
  // is held just for the inserts. Re-authorize under the lock in case a grant
  // was revoked during the (possibly seconds-long) processing above, lock the
  // firearm row so the quota read + inserts are atomic against a concurrent
  // upload (mirrors `updateMagazine`), then insert the prepared rows.
  try {
    await db.transaction(async (tx) => {
      await authorizeUpdate(tx, actorId, "firearm", firearmId);
      const [lockedFirearm] = await tx
        .select({ id: firearm.id })
        .from(firearm)
        .where(eq(firearm.id, firearmId))
        .for("update")
        .limit(1);
      if (!lockedFirearm) throw new NotFoundError();

      const existing = await tx
        .select({
          sortOrder: firearmPhoto.sortOrder,
          isPrimary: firearmPhoto.isPrimary,
        })
        .from(firearmPhoto)
        .where(eq(firearmPhoto.firearmId, firearmId));

      // Authoritative, race-safe quota check — counts the prepared (would-
      // succeed) files, since failed files never persist.
      if (existing.length + prepared.length > MAX_PHOTOS_PER_FIREARM) {
        throw new ValidationError([
          "photoQuotaExceeded",
        ] satisfies PhotoServiceErrorCode[]);
      }

      let nextSortOrder =
        existing.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;
      let hasPrimary = existing.some((p) => p.isPrimary);

      for (const p of prepared) {
        const isPrimary = !hasPrimary;
        const [row] = await tx
          .insert(firearmPhoto)
          .values({
            firearmId,
            storageKey: p.key,
            mimeType: p.mimeType,
            sizeBytes: p.sizeBytes,
            width: p.width,
            height: p.height,
            caption: "",
            sortOrder: nextSortOrder,
            isPrimary,
          })
          .returning();
        if (isPrimary) hasPrimary = true;
        nextSortOrder += 1;
        results[p.index] = { ok: true, photo: row };
      }
    });
  } catch (error) {
    // The transaction rolled back, so none of the prepared rows persisted —
    // every prepared blob is now orphaned. Reclaim them directly (best-effort)
    // rather than leaning on the sweep, then surface the failure.
    await Promise.all(prepared.map((p) => deletePhotoBlobs(p.key)));
    throw error;
  }

  return results;
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
      throw new ValidationError([
        "tooManyPhotos",
      ] satisfies PhotoServiceErrorCode[]);
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

/** A servable photo variant: the original or one of its derivatives. Aliased
 * from the client-safe `PHOTO_VARIANTS` source of truth (`urls.ts`) so the
 * server and client agree on the vocabulary without a second declaration. */
export type PhotoVariant = PhotoUrlVariant;

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
