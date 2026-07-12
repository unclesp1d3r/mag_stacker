import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` is a lazily-constructed singleton, but `UPLOAD_DIR` must be set
// before ANY test body first touches it — set it here, ahead of the rest of
// this file's imports being evaluated.
const uploadDir = mkdtempSync(join(tmpdir(), "documents-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { firearm, firearmDocument, user } from "@/src/db/schema";
import { deleteFirearm } from "@/src/domain/firearms/service";
import {
  activeStorageRoot,
  deleteDocumentBlob,
  generateKey,
  storage,
} from "@/src/storage";
import { orphanSweep } from "@/src/storage/orphan-sweep";

const live = process.env.DATABASE_URL ? describe : describe.skip;

function blobPath(key: string): string {
  return join(activeStorageRoot(), key);
}

async function writeDoc(
  firearmId: string,
  bytes = new Uint8Array([1, 2, 3, 4]),
): Promise<string> {
  const key = generateKey("pdf");
  await storage.save(key, bytes);
  await db.insert(firearmDocument).values({
    firearmId,
    storageKey: key,
    filename: "doc.pdf",
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    docType: "receipt",
  });
  return key;
}

live("document blob cleanup (U3)", () => {
  const ownerId = `test-user-${randomUUID()}`;
  let firearmId: string;

  beforeAll(async () => {
    await db.insert(user).values({
      id: ownerId,
      name: "Doc Blob Test",
      email: `${ownerId}@example.test`,
    });
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Blob FA", caliber: "9mm" })
      .returning();
    firearmId = f.id;
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, ownerId));
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("deleteDocumentBlob removes a written blob", async () => {
    const key = generateKey("pdf");
    await storage.save(key, new Uint8Array([9, 9, 9]));
    expect(existsSync(blobPath(key))).toBe(true);

    await deleteDocumentBlob(key);

    expect(existsSync(blobPath(key))).toBe(false);
  });

  test("deleteDocumentBlob is a best-effort no-op on a missing key", async () => {
    // Must not throw even though the key never existed.
    await deleteDocumentBlob(generateKey("pdf"));
    expect(true).toBe(true);
  });

  test("deleting the parent firearm removes its document blobs, not just the rows", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Cascade Blob FA", caliber: "9mm" })
      .returning();
    const key = await writeDoc(f.id);
    expect(existsSync(blobPath(key))).toBe(true);

    await deleteFirearm(ownerId, f.id);

    // Row gone (FK cascade) AND blob gone (R19 eager cleanup).
    const rows = await db
      .select()
      .from(firearmDocument)
      .where(eq(firearmDocument.firearmId, f.id));
    expect(rows).toHaveLength(0);
    expect(existsSync(blobPath(key))).toBe(false);
  });

  test("orphan sweep does not delete a blob referenced by a firearm_document row", async () => {
    const referenced = await writeDoc(firearmId);
    // An unreferenced stray blob written straight to storage.
    const orphan = generateKey("pdf");
    await storage.save(orphan, new Uint8Array([7, 7]));

    const result = await orphanSweep({ minAgeMs: 0 });

    expect(existsSync(blobPath(referenced))).toBe(true);
    expect(existsSync(blobPath(orphan))).toBe(false);
    expect(result.deletedKeys).toContain(orphan);
    expect(result.deletedKeys).not.toContain(referenced);
  });
});
