import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authorizeOwnerOnlyUpdate } from "@/src/auth/authorize";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeMagazine,
} from "@/src/test-support/factories";
import { updateMagazine } from "../service";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * Magazine editing is owner-only (R13/AE6) — a deliberate divergence from the
 * shared owner+edit update gate. An `edit`-grantee who can modify a firearm must
 * be rejected server-side when they try to modify a magazine, not merely hidden
 * from the button in the UI.
 */
live("magazine owner-only update (R13)", () => {
  let owner = "";
  let editGrantee = "";
  let viewGrantee = "";

  beforeAll(async () => {
    owner = await createUser("mag-owner");
    editGrantee = await createUser("mag-editor");
    viewGrantee = await createUser("mag-viewer");
  });
  afterAll(async () => {
    await deleteUsers(owner, editGrantee, viewGrantee);
  });

  test("authorizeOwnerOnlyUpdate: owner passes, edit/view forbidden, outsider not-found", async () => {
    const mag = await makeMagazine(owner);
    await createGrant(db, {
      actorId: owner,
      granteeId: editGrantee,
      parentType: "magazine",
      parentId: mag.id,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewGrantee,
      parentType: "magazine",
      parentId: mag.id,
      permission: "view",
    });

    await expect(
      authorizeOwnerOnlyUpdate(db, owner, "magazine", mag.id),
    ).resolves.toBeUndefined();
    await expect(
      authorizeOwnerOnlyUpdate(db, editGrantee, "magazine", mag.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(
      authorizeOwnerOnlyUpdate(db, viewGrantee, "magazine", mag.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const outsider = await createUser("mag-outsider");
    await expect(
      authorizeOwnerOnlyUpdate(db, outsider, "magazine", mag.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await deleteUsers(outsider);
  });

  test("updateMagazine rejects an edit-grantee and permits the owner (AE6)", async () => {
    const mag = await makeMagazine(owner, {
      brandModel: "PMAG",
      caliber: "5.56",
      baseCapacity: 30,
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: editGrantee,
      parentType: "magazine",
      parentId: mag.id,
      permission: "edit",
    });

    const input = {
      brandModel: mag.brandModel,
      caliber: mag.caliber,
      baseCapacity: mag.baseCapacity,
      extensionRounds: mag.extensionRounds,
    };

    await expect(
      updateMagazine(editGrantee, mag.id, input),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const updated = await updateMagazine(owner, mag.id, {
      ...input,
      notes: "owner-edited",
    });
    expect(updated.notes).toBe("owner-edited");
  });
});
