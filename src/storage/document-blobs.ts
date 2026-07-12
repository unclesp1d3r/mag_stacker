import { storage } from "./index";
import type { StorageKey } from "./service";

/**
 * Deletes a firearm document's single blob, best-effort (R18/R19). Unlike
 * `deletePhotoBlobs`, documents have no thumb/preview derivatives (KTD4) — one
 * blob per document — so this removes exactly one key.
 *
 * Best-effort by design: a blob-delete failure here must never surface as a
 * caller-visible error. It leaves an orphaned blob for `orphanSweep` to reclaim
 * later rather than blocking (or half-completing) the caller's delete flow. All
 * call sites invoke this AFTER their delete transaction commits, so the
 * referencing row is already gone by the time the bytes are removed — a
 * blob-delete failure can never leave a live row pointing at a missing blob:
 *   - `deleteDocument` (`src/domain/firearm-documents/service.ts`) calls this
 *     after its delete transaction resolves.
 *   - `deleteFirearm` (`src/domain/firearms/service.ts`) collects the storage
 *     keys inside its delete transaction, then calls this after the row cascade
 *     commits (R19).
 */
export async function deleteDocumentBlob(
  storageKey: StorageKey,
): Promise<void> {
  try {
    await storage.delete(storageKey);
  } catch (error) {
    console.error(
      `storage: failed to delete document blob ${storageKey}`,
      error,
    );
  }
}
