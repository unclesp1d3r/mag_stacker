import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` is a lazily-constructed singleton; `UPLOAD_DIR` must be set before
// any test body first touches it.
const uploadDir = mkdtempSync(join(tmpdir(), "documents-service-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { ValidationError } from "@/src/domain/errors";
import { activeStorageRoot } from "@/src/storage";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeFirearmDocument,
} from "@/src/test-support/factories";
import { MAX_DOCUMENTS_PER_FIREARM, MAX_FILE_SIZE_BYTES } from "../constants";
import {
  createDocuments,
  deleteDocument,
  getServableDocument,
  listDocuments,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .png()
    .toBuffer();
}

function blobExists(key: string): boolean {
  return existsSync(join(activeStorageRoot(), key));
}

live("firearm-documents service (U5)", () => {
  let owner = "";
  let grantee = "";

  beforeAll(async () => {
    owner = await createUser("doc-owner");
    grantee = await createUser("doc-grantee");
  });
  afterAll(async () => {
    await deleteUsers(owner, grantee);
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("owner uploads a valid PDF and image — rows created, blobs stored", async () => {
    const fa = await makeFirearm(owner);
    const png = await pngBytes();
    const results = await createDocuments(owner, fa.id, [
      {
        bytes: PDF_BYTES,
        mimeType: "application/pdf",
        filename: "receipt.pdf",
      },
      { bytes: png, mimeType: "image/png", filename: "warranty.png" },
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    for (const r of results) {
      if (r.ok) expect(blobExists(r.document.storageKey)).toBe(true);
    }
    const rows = await listDocuments(owner, fa.id);
    expect(rows).toHaveLength(2);
  });

  test("a per-file disallowed MIME is rejected while siblings succeed", async () => {
    const fa = await makeFirearm(owner);
    const results = await createDocuments(owner, fa.id, [
      { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "ok.pdf" },
      {
        bytes: Buffer.from("PK\x03\x04zip"),
        mimeType: "application/zip",
        filename: "bad.zip",
      },
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    if (!results[1].ok)
      expect(results[1].codes).toContain("disallowedMimeType");
  });

  test("an oversized file is rejected (fileTooLarge)", async () => {
    const fa = await makeFirearm(owner);
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
    big.write("%PDF-1.4\n"); // valid magic so only the size check fails
    const [result] = await createDocuments(owner, fa.id, [
      { bytes: big, mimeType: "application/pdf", filename: "huge.pdf" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.codes).toContain("fileTooLarge");
  });

  test("a batch over the per-request cap is rejected", async () => {
    const fa = await makeFirearm(owner);
    const inputs = Array.from({ length: 11 }, (_, i) => ({
      bytes: PDF_BYTES,
      mimeType: "application/pdf",
      filename: `f${i}.pdf`,
    }));
    await expect(createDocuments(owner, fa.id, inputs)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("uploading over the per-firearm cap is rejected", async () => {
    const fa = await makeFirearm(owner);
    // Fill to the cap with direct factory rows, then attempt one more upload.
    for (let i = 0; i < MAX_DOCUMENTS_PER_FIREARM; i++) {
      await makeFirearmDocument(fa.id);
    }
    await expect(
      createDocuments(owner, fa.id, [
        { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "over.pdf" },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("edit- and view-grantee uploads are refused (owner-only, R8)", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    await expect(
      createDocuments(grantee, fa.id, [
        { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "x.pdf" },
      ]),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("upload to an unseen firearm is not-found (AE3)", async () => {
    const stranger = await createUser("doc-stranger");
    const fa = await makeFirearm(owner);
    await expect(
      createDocuments(stranger, fa.id, [
        { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "x.pdf" },
      ]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await deleteUsers(stranger);
  });

  test("content-sniff mismatch: HTML bytes declared image/png are rejected (R5)", async () => {
    const fa = await makeFirearm(owner);
    const [result] = await createDocuments(owner, fa.id, [
      {
        bytes: Buffer.from("<html><body>not a png</body></html>"),
        mimeType: "image/png",
        filename: "sneaky.png",
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.codes).toContain("contentMismatch");
  });

  test("a filename with path separators and control chars is stored sanitized (R3)", async () => {
    const fa = await makeFirearm(owner);
    const [result] = await createDocuments(owner, fa.id, [
      {
        bytes: PDF_BYTES,
        mimeType: "application/pdf",
        filename: "../../etc/pa\r\nsswd.pdf",
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.filename).not.toContain("/");
      expect(result.document.filename).not.toContain("\n");
      expect(result.document.filename).not.toContain("\r");
    }
  });

  test("listDocuments returns most-recent-first (R25)", async () => {
    const fa = await makeFirearm(owner);
    const older = await makeFirearmDocument(fa.id, {
      filename: "older.pdf",
      uploadedAt: new Date(Date.now() - 60_000),
    });
    const newer = await makeFirearmDocument(fa.id, {
      filename: "newer.pdf",
      uploadedAt: new Date(),
    });
    const rows = await listDocuments(owner, fa.id);
    expect(rows[0].id).toBe(newer.id);
    expect(rows[1].id).toBe(older.id);
  });

  test("listDocuments by a non-owner is refused (R16)", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await expect(listDocuments(grantee, fa.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  test("deleteDocument removes the row and blob; non-owner delete is refused and retains the blob", async () => {
    const fa = await makeFirearm(owner);
    const [uploaded] = await createDocuments(owner, fa.id, [
      { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "del.pdf" },
    ]);
    if (!uploaded.ok) throw new Error("upload failed");
    const doc = uploaded.document;

    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    // Edit-grantee cannot delete; blob retained.
    await expect(deleteDocument(grantee, doc.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    expect(blobExists(doc.storageKey)).toBe(true);

    // Owner deletes: row and blob gone.
    await deleteDocument(owner, doc.id);
    expect(blobExists(doc.storageKey)).toBe(false);
    const rows = await listDocuments(owner, fa.id);
    expect(rows.find((r) => r.id === doc.id)).toBeUndefined();
  });

  test("getServableDocument returns bytes for the owner, throws for a non-owner", async () => {
    const fa = await makeFirearm(owner);
    const [uploaded] = await createDocuments(owner, fa.id, [
      { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "serve.pdf" },
    ]);
    if (!uploaded.ok) throw new Error("upload failed");
    const doc = uploaded.document;

    const servable = await getServableDocument(owner, doc.id);
    expect(servable).not.toBeNull();
    expect(servable?.mimeType).toBe("application/pdf");
    expect(servable?.filename).toBe("serve.pdf");

    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await expect(getServableDocument(grantee, doc.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  test("getServableDocument returns null for an unknown document id", async () => {
    expect(
      await getServableDocument(owner, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
