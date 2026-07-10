import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` (src/storage/index.ts) is a lazily-constructed singleton, but
// `UPLOAD_DIR` must be set before ANY test body first touches it — set it
// here, ahead of the rest of this file's imports being evaluated.
const uploadDir = mkdtempSync(join(tmpdir(), "photos-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeFirearmPhoto,
} from "@/src/test-support/factories";
import { MAX_PHOTOS_PER_FIREARM } from "../constants";
import {
  type CreatePhotoInput,
  type CreatePhotoResult,
  createPhotos,
  deletePhoto,
  type FirearmPhoto,
  listPhotos,
  primaryThumbnailsFor,
  reorderPhotos,
  setPrimary,
} from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/** A small solid-color JPEG upload input, real bytes via `sharp`. */
async function jpegInput(
  overrides: Partial<CreatePhotoInput> = {},
): Promise<CreatePhotoInput> {
  const bytes = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  })
    .jpeg()
    .toBuffer();
  return {
    bytes,
    mimeType: "image/jpeg",
    sizeBytes: bytes.length,
    ...overrides,
  };
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

live("firearm-photo service (#9, U4)", () => {
  let owner = "";
  let editor = "";
  let viewer = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("fpOwner");
    editor = await createUser("fpEditor");
    viewer = await createUser("fpViewer");
    stranger = await createUser("fpStranger");
  });

  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("covers AE3: an edit-grantee can create; a view-grantee cannot; an invisible firearm is not-found", async () => {
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

    const [editorResult] = await createPhotos(editor, fa.id, [
      await jpegInput(),
    ]);
    expectOk(editorResult);

    await expect(
      createPhotos(viewer, fa.id, [await jpegInput()]),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    await expect(
      createPhotos(stranger, fa.id, [await jpegInput()]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("covers AE7: a mixed-validity batch returns per-file results without blocking valid files", async () => {
    const fa = await makeFirearm(owner);
    const valid1 = await jpegInput();
    const invalid = await jpegInput({ mimeType: "image/svg+xml" });
    const valid2 = await jpegInput();

    const results = await createPhotos(owner, fa.id, [valid1, invalid, valid2]);

    expect(results).toHaveLength(3);
    expectOk(results[0]);
    expect(results[1]).toEqual({ ok: false, codes: ["disallowedMimeType"] });
    expectOk(results[2]);

    const photos = await listPhotos(owner, fa.id);
    expect(photos).toHaveLength(2);
  });

  test("the first uploaded photo auto-becomes primary; a second does not", async () => {
    const fa = await makeFirearm(owner);
    const [first] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [second] = await createPhotos(owner, fa.id, [await jpegInput()]);

    expect(expectOk(first).isPrimary).toBe(true);
    expect(expectOk(second).isPrimary).toBe(false);
  });

  test("covers AE1: setPrimary clears the prior primary — exactly one primary after", async () => {
    const fa = await makeFirearm(owner);
    const [a] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [b] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photoA = expectOk(a);
    const photoB = expectOk(b);
    expect(photoA.isPrimary).toBe(true);

    await setPrimary(owner, photoB.id);

    const photos = await listPhotos(owner, fa.id);
    const primaries = photos.filter((p) => p.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(photoB.id);
  });

  test("covers AE8: deletePhoto on a non-primary leaves primary unchanged; on the primary auto-promotes the next by sort order", async () => {
    const fa = await makeFirearm(owner);
    const [a] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [b] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [c] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photoA = expectOk(a);
    const photoB = expectOk(b);
    const photoC = expectOk(c);
    expect(photoA.isPrimary).toBe(true);

    // Deleting a non-primary (C) leaves A primary.
    await deletePhoto(owner, photoC.id);
    let photos = await listPhotos(owner, fa.id);
    expect(photos.find((p) => p.id === photoA.id)?.isPrimary).toBe(true);

    // Deleting the primary (A) auto-promotes the next by sort order (B).
    await deletePhoto(owner, photoA.id);
    photos = await listPhotos(owner, fa.id);
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe(photoB.id);
    expect(photos[0].isPrimary).toBe(true);
  });

  test("delete removes the original and derivative blobs from UPLOAD_DIR", async () => {
    const fa = await makeFirearm(owner);
    const [created] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photo = expectOk(created);

    expect(existsSync(join(uploadDir, photo.storageKey))).toBe(true);
    expect(existsSync(join(uploadDir, `${photo.storageKey}.thumb`))).toBe(true);
    expect(existsSync(join(uploadDir, `${photo.storageKey}.preview`))).toBe(
      true,
    );

    await deletePhoto(owner, photo.id);

    expect(existsSync(join(uploadDir, photo.storageKey))).toBe(false);
    expect(existsSync(join(uploadDir, `${photo.storageKey}.thumb`))).toBe(
      false,
    );
    expect(existsSync(join(uploadDir, `${photo.storageKey}.preview`))).toBe(
      false,
    );
  });

  test("reorderPhotos persists the new order", async () => {
    const fa = await makeFirearm(owner);
    const [a] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [b] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const [c] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photoA = expectOk(a);
    const photoB = expectOk(b);
    const photoC = expectOk(c);

    await reorderPhotos(owner, fa.id, [photoC.id, photoA.id, photoB.id]);

    const photos = await listPhotos(owner, fa.id);
    expect(photos.map((p) => p.id)).toEqual([photoC.id, photoA.id, photoB.id]);
  });

  test("quota: exceeding MAX_PHOTOS_PER_FIREARM is rejected", async () => {
    const fa = await makeFirearm(owner);
    for (let i = 0; i < MAX_PHOTOS_PER_FIREARM; i++) {
      await makeFirearmPhoto(fa.id, i);
    }

    await expect(
      createPhotos(owner, fa.id, [await jpegInput()]),
    ).rejects.toBeInstanceOf(ValidationError);

    const photos = await listPhotos(owner, fa.id);
    expect(photos).toHaveLength(MAX_PHOTOS_PER_FIREARM);
  });

  test("primaryThumbnailsFor returns one entry per firearm-with-primary in a single lookup, excludes firearms the actor can't see", async () => {
    const withPrimary = await makeFirearm(owner);
    await makeFirearmPhoto(withPrimary.id, 0, { isPrimary: true });

    const withoutPrimary = await makeFirearm(owner);
    await makeFirearmPhoto(withoutPrimary.id, 0, { isPrimary: false });

    const hidden = await makeFirearm(stranger);
    await makeFirearmPhoto(hidden.id, 0, { isPrimary: true });

    const result = await primaryThumbnailsFor(owner, [
      withPrimary.id,
      withoutPrimary.id,
      hidden.id,
    ]);

    expect(result.size).toBe(1);
    expect(result.has(withPrimary.id)).toBe(true);
    expect(result.has(withoutPrimary.id)).toBe(false);
    expect(result.has(hidden.id)).toBe(false);
  });
});
