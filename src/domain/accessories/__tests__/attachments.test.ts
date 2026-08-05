import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { accessoryAttachment } from "@/src/db/schema";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
  updateAttachment,
  validateAttachment,
} from "@/src/domain/accessories/attachments";
import { ATTACHMENT_TYPES } from "@/src/domain/accessories/constants";
import {
  createAccessory,
  deleteAccessory,
} from "@/src/domain/accessories/service";
import { ValidationError } from "@/src/domain/errors";
import { expectRejects } from "@/src/test-support/assertions";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";

describe("validateAttachment", () => {
  for (const type of ATTACHMENT_TYPES) {
    test(`${type} is an accepted attachment type`, () => {
      expect(validateAttachment({ type })).toEqual([]);
    });
  }

  test("a type outside the controlled set is rejected", () => {
    expect(validateAttachment({ type: "scope ring" })).toEqual([
      "invalidAttachmentType",
    ]);
  });

  test("a blank type is rejected", () => {
    expect(validateAttachment({ type: "" })).toEqual(["invalidAttachmentType"]);
  });
});

describe("accessory attachments — owner CRUD", () => {
  let owner: string;
  let accessoryId: string;

  beforeAll(async () => {
    owner = await createUser("AttachOwner");
    accessoryId = (await createAccessory(owner, { type: "suppressor" })).id;
  });

  afterAll(async () => {
    await deleteUsers(owner);
  });

  test("AE4: a created attachment reads back with its spec", async () => {
    const created = await createAttachment(owner, accessoryId, {
      type: "piston",
      spec: "1/2x28",
    });
    expect(created.type).toBe("piston");
    expect(created.spec).toBe("1/2x28");

    const listed = await listAttachments(owner, accessoryId);
    expect(listed.map((a) => a.id)).toContain(created.id);
  });

  test("optional fields default to empty rather than null (R18)", async () => {
    const created = await createAttachment(owner, accessoryId, {
      type: "mount",
    });
    expect(created.spec).toBe("");
    expect(created.serialNumber).toBe("");
    expect(created.notes).toBe("");
  });

  test("attachments list in creation order", async () => {
    const isolatedAccessory = (
      await createAccessory(owner, { type: "suppressor" })
    ).id;
    const first = await createAttachment(owner, isolatedAccessory, {
      type: "mount",
      spec: "first",
    });
    const second = await createAttachment(owner, isolatedAccessory, {
      type: "end cap",
      spec: "second",
    });
    const listed = await listAttachments(owner, isolatedAccessory);
    expect(listed.map((a) => a.id)).toEqual([first.id, second.id]);
  });

  test("updating changes the stored spec", async () => {
    const created = await createAttachment(owner, accessoryId, {
      type: "piston",
      spec: "before",
    });
    const updated = await updateAttachment(owner, created.id, {
      type: "piston",
      spec: "after",
    });
    expect(updated.spec).toBe("after");
  });

  test("deleting removes just that attachment", async () => {
    const isolatedAccessory = (
      await createAccessory(owner, { type: "suppressor" })
    ).id;
    const keep = await createAttachment(owner, isolatedAccessory, {
      type: "mount",
    });
    const drop = await createAttachment(owner, isolatedAccessory, {
      type: "piston",
    });
    await deleteAttachment(owner, drop.id);

    const listed = await listAttachments(owner, isolatedAccessory);
    expect(listed.map((a) => a.id)).toEqual([keep.id]);
  });

  test("an invalid type is rejected by the validator and writes no row", async () => {
    const before = await listAttachments(owner, accessoryId);
    await expect(
      createAttachment(owner, accessoryId, { type: "scope ring" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await listAttachments(owner, accessoryId);
    expect(after.length).toBe(before.length);
  });

  test("the DB CHECK rejects an out-of-set type even when the validator is bypassed", async () => {
    await expectRejects(() =>
      db
        .insert(accessoryAttachment)
        .values({ accessoryId, type: "scope ring" }),
    );
  });

  test("an unknown attachment id is not-found on update and delete", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(
      updateAttachment(owner, missing, { type: "mount" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteAttachment(owner, missing)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("AE5: deleting the accessory cascades its attachments away", async () => {
    const doomed = (await createAccessory(owner, { type: "suppressor" })).id;
    const attachment = await createAttachment(owner, doomed, {
      type: "end cap",
    });
    await deleteAccessory(owner, doomed);

    const orphans = await db
      .select()
      .from(accessoryAttachment)
      .where(eq(accessoryAttachment.id, attachment.id));
    expect(orphans).toEqual([]);
  });
});

/**
 * R13 — attachments carry no permissions of their own, so every one of these
 * asserts the PARENT's permission is what decides. A viewer reads but cannot
 * write; a stranger cannot even tell the attachment exists.
 */
describe("accessory attachments — authorization resolves through the parent", () => {
  let owner: string;
  let editor: string;
  let viewer: string;
  let stranger: string;
  let hostFirearm: string;
  let mountedAccessoryId: string;
  let attachmentId: string;

  beforeAll(async () => {
    owner = await createUser("AttachAuthOwner");
    editor = await createUser("AttachAuthEditor");
    viewer = await createUser("AttachAuthViewer");
    stranger = await createUser("AttachAuthStranger");

    // Inherited permission via the mounted firearm is #8's shipped path and
    // still the one in force until U4 adds direct accessory grants.
    hostFirearm = (await makeFirearm(owner, { name: "Attach Host" })).id;
    mountedAccessoryId = (
      await createAccessory(owner, {
        type: "suppressor",
        firearmId: hostFirearm,
      })
    ).id;
    attachmentId = (
      await createAttachment(owner, mountedAccessoryId, {
        type: "piston",
        spec: "1/2x28",
      })
    ).id;

    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: hostFirearm,
      permission: "edit",
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: hostFirearm,
      permission: "view",
    });
  });

  afterAll(async () => {
    await deleteUsers(owner, editor, viewer, stranger);
  });

  test("an edit-grantee on the host firearm can create, update, and delete", async () => {
    const created = await createAttachment(editor, mountedAccessoryId, {
      type: "mount",
      spec: "editor-made",
    });
    const updated = await updateAttachment(editor, created.id, {
      type: "mount",
      spec: "editor-edited",
    });
    expect(updated.spec).toBe("editor-edited");
    await deleteAttachment(editor, created.id);
  });

  test("a view-grantee can read the list", async () => {
    const listed = await listAttachments(viewer, mountedAccessoryId);
    expect(listed.map((a) => a.id)).toContain(attachmentId);
  });

  test("a view-grantee cannot create, update, or delete (403, not 404)", async () => {
    await expect(
      createAttachment(viewer, mountedAccessoryId, { type: "mount" }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(
      updateAttachment(viewer, attachmentId, { type: "piston" }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(deleteAttachment(viewer, attachmentId)).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  test("a stranger gets not-found on read and every write — never 403, which would confirm it exists", async () => {
    await expect(
      listAttachments(stranger, mountedAccessoryId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createAttachment(stranger, mountedAccessoryId, { type: "mount" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateAttachment(stranger, attachmentId, { type: "piston" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteAttachment(stranger, attachmentId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
