import { randomUUID } from "node:crypto";
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
  setCaption,
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

  test("deletePhoto: a view-grantee is not authorized; a stranger and an unknown photo id are not-found", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const photo = await makeFirearmPhoto(fa.id, 0);

    await expect(deletePhoto(viewer, photo.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(deletePhoto(stranger, photo.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Unknown photo id — exercises `firearmIdFor`'s not-found path directly,
    // independent of the parent-firearm authz checked above.
    await expect(deletePhoto(owner, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // None of the rejected calls actually deleted the photo.
    const photos = await listPhotos(owner, fa.id);
    expect(photos).toHaveLength(1);
  });

  test("setPrimary: a view-grantee is not authorized; a stranger and an unknown photo id are not-found", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const photo = await makeFirearmPhoto(fa.id, 0);

    await expect(setPrimary(viewer, photo.id)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(setPrimary(stranger, photo.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(setPrimary(owner, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("reorderPhotos: a view-grantee is not authorized; a stranger is not-found", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const photo = await makeFirearmPhoto(fa.id, 0);

    // `reorderPhotos` authorizes on `firearmId` directly (no `firearmIdFor`
    // lookup — unlike the photo-id-keyed mutations above), so its not-found
    // coverage is the invisible-firearm case, mirrored from AE3.
    await expect(
      reorderPhotos(viewer, fa.id, [photo.id]),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(
      reorderPhotos(stranger, fa.id, [photo.id]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("setCaption: a view-grantee is not authorized; a stranger and an unknown photo id are not-found", async () => {
    const fa = await makeFirearm(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    const photo = await makeFirearmPhoto(fa.id, 0);

    await expect(setCaption(viewer, photo.id, "nope")).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
    await expect(setCaption(stranger, photo.id, "nope")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      setCaption(owner, randomUUID(), "nope"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listPhotos: a stranger is not-found (existence-hiding); a view-grantee can read", async () => {
    const fa = await makeFirearm(owner);
    await makeFirearmPhoto(fa.id, 0);
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });

    await expect(listPhotos(stranger, fa.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A read needs only visibility, not edit (R12): a view-grantee succeeds.
    const asViewer = await listPhotos(viewer, fa.id);
    expect(asViewer).toHaveLength(1);
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

  test("createPhotos: an allowed-MIME file with undecodable bytes fails as processingFailed, leaving survivors gapless with exactly one primary", async () => {
    const fa = await makeFirearm(owner);
    const valid1 = await jpegInput();
    // Allowed MIME + within the size cap, so it clears validatePhotoUpload, but
    // the bytes aren't a decodable image — processImage throws, exercising the
    // per-file processingFailed catch path. Distinct from AE7's SVG case, which
    // is rejected at validation and never reaches processing.
    const corrupt: CreatePhotoInput = {
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      mimeType: "image/jpeg",
    };
    const valid2 = await jpegInput();

    const results = await createPhotos(owner, fa.id, [valid1, corrupt, valid2]);

    expect(results).toHaveLength(3);
    const first = expectOk(results[0]);
    expect(results[1]).toEqual({ ok: false, codes: ["processingFailed"] });
    const third = expectOk(results[2]);

    const photos = await listPhotos(owner, fa.id);
    expect(photos.map((p) => p.id)).toEqual([first.id, third.id]);
    // The failed middle file consumes no sort slot — survivors stay gapless.
    expect(photos.map((p) => p.sortOrder)).toEqual([0, 1]);
    // Primary goes to the first SUCCESSFUL insert, not the first input.
    const primaries = photos.filter((p) => p.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(first.id);
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

  test("reorderPhotos: an id from another firearm is a silent no-op, never re-parenting or reordering it", async () => {
    const faA = await makeFirearm(owner);
    const photoA1 = expectOk(
      (await createPhotos(owner, faA.id, [await jpegInput()]))[0],
    );
    const photoA2 = expectOk(
      (await createPhotos(owner, faA.id, [await jpegInput()]))[0],
    );

    const faB = await makeFirearm(owner);
    const photoB1 = expectOk(
      (await createPhotos(owner, faB.id, [await jpegInput()]))[0],
    );

    // Firearm B's photo id is smuggled into firearm A's reorder payload. The
    // compound (id, firearmId) guard means B's photo is untouched — not
    // re-parented into A's gallery, not reordered — while A's own ids reorder
    // by their payload positions (A2 at 0, A1 at 2).
    await reorderPhotos(owner, faA.id, [photoA2.id, photoB1.id, photoA1.id]);

    const aPhotos = await listPhotos(owner, faA.id);
    expect(aPhotos.map((p) => p.id)).toEqual([photoA2.id, photoA1.id]);
    const bPhotos = await listPhotos(owner, faB.id);
    expect(bPhotos.map((p) => p.id)).toEqual([photoB1.id]);
    expect(bPhotos[0].sortOrder).toBe(photoB1.sortOrder);
  });

  test("reorderPhotos rejects an id list longer than MAX_PHOTOS_PER_FIREARM (DoS cap)", async () => {
    const fa = await makeFirearm(owner);
    const [created] = await createPhotos(owner, fa.id, [await jpegInput()]);
    const photo = expectOk(created);

    const oversized = Array.from(
      { length: MAX_PHOTOS_PER_FIREARM + 1 },
      () => photo.id,
    );

    await expect(reorderPhotos(owner, fa.id, oversized)).rejects.toBeInstanceOf(
      ValidationError,
    );

    // Rejected before any UPDATE runs — the existing order is untouched.
    const photos = await listPhotos(owner, fa.id);
    expect(photos.map((p) => p.id)).toEqual([photo.id]);
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
