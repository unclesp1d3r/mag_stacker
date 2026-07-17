import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` is a lazily-constructed singleton, but `UPLOAD_DIR` must be set
// before ANY test body first touches it — set it here, ahead of the rest of
// this file's imports being evaluated (mirrors `document-blobs.test.ts`).
const uploadDir = mkdtempSync(join(tmpdir(), "orphan-sweep-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, describe, expect, spyOn, test } from "bun:test";
import {
  activeStorageRoot,
  generateKey,
  LocalFilesystemAdapter,
  storage,
} from "@/src/storage";
import { orphanSweep } from "@/src/storage/orphan-sweep";

const live = process.env.DATABASE_URL ? describe : describe.skip;

function blobPath(key: string): string {
  return join(activeStorageRoot(), key);
}

live("orphan sweep per-key delete failure (U5 logging migration)", () => {
  afterAll(() => {
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("a delete failure on one orphan key is swallowed (logged, not thrown) and the sweep still reclaims the rest", async () => {
    const failingKey = generateKey("pdf");
    const okKey = generateKey("pdf");
    await storage.save(failingKey, new Uint8Array([1]));
    await storage.save(okKey, new Uint8Array([2]));

    // Fail only `failingKey`'s delete, regardless of call order (the sweep's
    // per-key deletes run concurrently via `Promise.all`) — every other key,
    // including `okKey`, still goes through the real adapter.
    const originalDelete = LocalFilesystemAdapter.prototype.delete;
    const deleteSpy = spyOn(LocalFilesystemAdapter.prototype, "delete");
    deleteSpy.mockImplementation(function (
      this: LocalFilesystemAdapter,
      key: string,
    ) {
      if (key === failingKey) {
        return Promise.reject(new Error("simulated delete failure"));
      }
      return originalDelete.call(this, key);
    });

    let result: Awaited<ReturnType<typeof orphanSweep>>;
    try {
      // Behavior-preserving check (plan Unit U5): `orphanSweep` must not
      // throw or abort the rest of the sweep just because one key's delete
      // failed — the failure is caught, logged, and skipped per-key.
      result = await orphanSweep({ minAgeMs: 0 });
    } finally {
      deleteSpy.mockRestore();
    }

    expect(result.deletedKeys).toContain(okKey);
    expect(result.deletedKeys).not.toContain(failingKey);
    // The failing key's blob is still on disk (its delete never succeeded);
    // the other key's blob is gone.
    expect(existsSync(blobPath(failingKey))).toBe(true);
    expect(existsSync(blobPath(okKey))).toBe(false);
  });
});
