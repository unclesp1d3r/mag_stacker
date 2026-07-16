import { childLogger } from "@/src/lib/logging";
import { deriveKey, storage } from "./index";
import type { StorageKey } from "./service";

const log = childLogger("storage");

/**
 * Deletes a photo's original + derivative blobs, best-effort (R8/R19): a
 * blob-delete failure here must never surface as a caller-visible error — it
 * leaves an orphaned blob for `orphanSweep` (U5) to reclaim later, rather
 * than blocking (or half-completing) the caller's delete flow.
 *
 * Both call sites invoke this AFTER their delete transaction has committed, so
 * the referencing row is already gone by the time the bytes are removed — a
 * blob-delete failure can never leave a live row pointing at a missing blob:
 *   - `deletePhoto` (`src/domain/firearm-photos/service.ts`) calls this after
 *     its `db.transaction` resolves.
 *   - `deleteFirearm` (`src/domain/firearms/service.ts`) collects the storage
 *     keys inside its delete transaction, then calls this after the row
 *     cascade commits.
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
        log.error({ err: error, key }, "failed to delete photo blob");
      }
    }),
  );
}
