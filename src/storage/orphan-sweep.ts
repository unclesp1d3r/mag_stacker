import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/src/db/client";
import { firearmPhoto } from "@/src/db/schema";
import { activeStorageRoot, deriveKey, storage } from "./index";

/**
 * Minimum age a blob must reach before the sweep will reclaim it. Guards
 * in-flight uploads: `createPhotos` writes a file's blobs to storage BEFORE
 * committing its `firearm_photo` row, so a just-written blob is momentarily
 * unreferenced and would otherwise look orphaned. One hour is far longer than
 * any upload's blob-write-to-commit window, and a genuinely leaked blob is in
 * no hurry to be reclaimed — a later sweep gets it.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Reclaims blobs left orphaned by a partial delete failure (R8, U5): a
 * `firearm_photo` row delete's best-effort blob cleanup (see
 * `deletePhotoBlobs` in `src/storage/photo-blobs.ts`, called from both
 * `cleanupFirearmPhotoBlobs` in `src/domain/firearms/service.ts` and
 * `deletePhoto` in `src/domain/firearm-photos/service.ts`) can leave a blob
 * behind when a single `storage.delete` call throws. This sweep is the
 * reclaim path: any file directly under `UPLOAD_DIR` whose key (or derivative
 * key) is not referenced by a live `firearm_photo` row is deleted.
 *
 * Local-filesystem specific by design: it lists `UPLOAD_DIR` directly with
 * `node:fs` rather than through the `StorageService` interface, because the
 * interface (R1/R2) intentionally carries only the methods v1 consumers need
 * and a future S3-compatible adapter (deferred per the plan) would require
 * its own listing strategy anyway — adding a `list()` method now would be
 * speculative (YAGNI). The scan is non-recursive because `generateKey` (and
 * `deriveKey`, by suffix) never emit a path separator, so every stored blob
 * lives flat at the root.
 *
 * On-demand utility — no scheduler is wired up (left open in the plan);
 * call it manually, from a maintenance script, or from a future cron/route
 * handler.
 */
export interface OrphanSweepOptions {
  /** Minimum age (ms) an unreferenced blob must have before it is reclaimed;
   * younger ones are left in place (they may be an in-flight upload whose row
   * hasn't committed yet). Defaults to `ORPHAN_MIN_AGE_MS`; pass `0` in tests
   * that assert the reclaim path on freshly-written fixtures. */
  minAgeMs?: number;
}

export interface OrphanSweepResult {
  /** Keys deleted because no `firearm_photo` row referenced them. */
  deletedKeys: string[];
  /** Total files scanned under `UPLOAD_DIR`. */
  scannedCount: number;
  /** Unreferenced blobs left in place because they were younger than
   * `minAgeMs` (possibly an in-flight upload). */
  skippedRecentCount: number;
}

export async function orphanSweep(
  options: OrphanSweepOptions = {},
): Promise<OrphanSweepResult> {
  const minAgeMs = options.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const uploadDir = activeStorageRoot();
  const entries = await readdir(uploadDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      // A fresh install may not have created UPLOAD_DIR yet — nothing to
      // sweep, not an error. Any other failure (permissions, I/O) is a real
      // problem and must not be swallowed silently.
      if (error.code === "ENOENT") return [];
      console.error(
        `storage: orphanSweep failed to read UPLOAD_DIR (${uploadDir})`,
        error,
      );
      throw error;
    },
  );
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const rows = await db
    .select({ storageKey: firearmPhoto.storageKey })
    .from(firearmPhoto);
  const ownedKeys = new Set<string>();
  for (const row of rows) {
    ownedKeys.add(row.storageKey);
    ownedKeys.add(deriveKey(row.storageKey, "thumb"));
    ownedKeys.add(deriveKey(row.storageKey, "preview"));
  }

  // `storage.delete` is idempotent (no-op on a missing key), so the orphan
  // deletes have no ordering dependency on one another and can run
  // concurrently rather than one at a time. Best-effort per key (like
  // `deletePhotoBlobs`): a single delete failure (permissions, transient FS
  // error) is logged and skipped so the rest of the sweep still reclaims —
  // this is a cleanup utility, one bad key must not abort the whole run.
  const orphanKeys = fileNames.filter((key) => !ownedKeys.has(key));
  const now = Date.now();
  const deletedKeys: string[] = [];
  let skippedRecentCount = 0;
  await Promise.all(
    orphanKeys.map(async (key) => {
      try {
        const info = await stat(join(uploadDir, key));
        // Clamp to >= 0: `mtimeMs` is a sub-ms float while `now` is integer ms,
        // so a just-written file can read as slightly "in the future" (negative
        // age). A negative age is a brand-new file — treat it as age 0, never as
        // "old enough to reclaim". With `minAgeMs: 0` (tests) nothing is skipped.
        const ageMs = Math.max(0, now - info.mtimeMs);
        if (ageMs < minAgeMs) {
          // Too recent to be safely reclaimed — a blob written just before its
          // row committed (an in-flight upload) is momentarily unreferenced.
          skippedRecentCount += 1;
          return;
        }
        await storage.delete(key);
        deletedKeys.push(key);
      } catch (error) {
        console.error(`storage: orphanSweep failed to delete ${key}`, error);
      }
    }),
  );
  return { deletedKeys, scannedCount: fileNames.length, skippedRecentCount };
}
