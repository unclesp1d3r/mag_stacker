import { deriveKey, storage } from "./index";
import type { StorageKey } from "./service";

/**
 * Deletes a photo's original + derivative blobs, best-effort (R8/R19): the
 * caller's row delete has already committed by the time this runs, so a
 * blob-delete failure here must never surface as a caller-visible error — it
 * leaves an orphaned blob for `orphanSweep` (U5) to reclaim later, rather
 * than blocking (or half-completing) the caller's delete flow. Shared by
 * `deletePhoto` (`src/domain/firearm-photos/service.ts`) and
 * `cleanupFirearmPhotoBlobs` (`src/domain/firearms/service.ts`).
 */
export async function deletePhotoBlobs(storageKey: StorageKey): Promise<void> {
  const keys = [
    storageKey,
    deriveKey(storageKey, "thumb"),
    deriveKey(storageKey, "preview"),
  ];
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (error) {
        console.error(`storage: failed to delete photo blob ${key}`, error);
      }
    }),
  );
}
