import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` (src/storage/index.ts) is a lazily-constructed singleton, but
// `UPLOAD_DIR` must be set before ANY test body first touches it — set it
// here, ahead of the rest of this file's imports being evaluated (mirrors
// `service.test.ts`).
const uploadDir = mkdtempSync(join(tmpdir(), "photos-serving-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import {
  type CreatePhotoInput,
  type CreatePhotoResult,
  createPhotos,
  type FirearmPhoto,
  getServablePhoto,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/** A small solid-color JPEG upload input, real bytes via `sharp`. */
async function jpegInput(): Promise<CreatePhotoInput> {
  const bytes = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .jpeg()
    .toBuffer();
  return { bytes, mimeType: "image/jpeg" };
}

/** Unwraps an `ok: true` create result, failing the test with the codes otherwise. */
function expectOk(result: CreatePhotoResult): FirearmPhoto {
  if (!result.ok) {
    throw new Error(
      `expected an ok create result, got codes: ${result.codes.join(", ")}`,
    );
  }
  return result.photo;
}

live("getServablePhoto (#9, U6)", () => {
  let owner = "";
  let editor = "";
  let viewer = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("servOwner");
    editor = await createUser("servEditor");
    viewer = await createUser("servViewer");
    stranger = await createUser("servStranger");
  });

  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("owner, edit-grantee, and view-grantee can all read; an actor with no access gets null", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const [created] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photo = expectOk(created);

    for (const actorId of [owner, editor, viewer]) {
      const served = await getServablePhoto(actorId, photo.id, "original");
      expect(served).not.toBeNull();
      expect(served?.mimeType).toBe("image/jpeg");
    }

    const denied = await getServablePhoto(stranger, photo.id, "original");
    expect(denied).toBeNull();
  });

  test("an unknown photo id returns null rather than throwing", async () => {
    const result = await getServablePhoto(
      owner,
      crypto.randomUUID(),
      "original",
    );
    expect(result).toBeNull();
  });

  test("each variant resolves its own distinct blob", async () => {
    const fa = await makeFirearm(owner);
    // Large enough that both the thumb (200px) and preview (1024px) edges
    // actually downscale — a source at or below the preview edge would make
    // the preview a byte-identical no-op resize of the original.
    const bytes = await sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();
    const [created] = await createPhotos(owner, fa.id, [
      { bytes, mimeType: "image/jpeg" },
    ]);
    const photo = expectOk(created);

    const original = await getServablePhoto(owner, photo.id, "original");
    const thumb = await getServablePhoto(owner, photo.id, "thumb");
    const preview = await getServablePhoto(owner, photo.id, "preview");

    expect(original).not.toBeNull();
    expect(thumb).not.toBeNull();
    expect(preview).not.toBeNull();
    expect((original?.bytes.length ?? 0) > 0).toBe(true);
    expect((thumb?.bytes.length ?? 0) > 0).toBe(true);
    expect((preview?.bytes.length ?? 0) > 0).toBe(true);

    // Distinct blobs confirm each variant is read from its own derived key,
    // not all three resolving to the same original bytes.
    expect(thumb?.bytes.equals(original?.bytes as Buffer)).toBe(false);
    expect(preview?.bytes.equals(original?.bytes as Buffer)).toBe(false);
  });
});
