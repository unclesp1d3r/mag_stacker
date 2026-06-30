import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  linkMagazineFirearm,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import { createGrant } from "../grants";
import { getVisibleIds, isVisible, resolvePermission } from "../visibility";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("visibility (U4)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("covers AE3: B's visible set excludes A's unshared records", async () => {
    const fa = await makeFirearm(userA, { name: "A private" });
    const visibleToB = await getVisibleIds(db, userB, "firearm");
    expect(visibleToB.has(fa.id)).toBe(false);
    const visibleToA = await getVisibleIds(db, userA, "firearm");
    expect(visibleToA.has(fa.id)).toBe(true);
    expect(await resolvePermission(db, userB, "firearm", fa.id)).toBeNull();
    expect(await resolvePermission(db, userA, "firearm", fa.id)).toBe("owner");
  });

  test("a granted item enters the grantee's visible set with the granted permission", async () => {
    const view = await makeFirearm(userA, { name: "shared view" });
    const edit = await makeFirearm(userA, { name: "shared edit" });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: view.id,
      permission: "view",
    });
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "firearm",
      parentId: edit.id,
      permission: "edit",
    });

    const visible = await getVisibleIds(db, userB, "firearm");
    expect(visible.has(view.id)).toBe(true);
    expect(visible.has(edit.id)).toBe(true);
    expect(await resolvePermission(db, userB, "firearm", view.id)).toBe("view");
    expect(await resolvePermission(db, userB, "firearm", edit.id)).toBe("edit");
  });

  test("grants never cascade across the magazine↔firearm compatibility link (R37a)", async () => {
    const fa = await makeFirearm(userA, { name: "linked FA" });
    const mag = await makeMagazine(userA, { brandModel: "linked MG" });
    await linkMagazineFirearm(mag.id, fa.id);
    // Share the magazine with B at edit.
    await createGrant(db, {
      actorId: userA,
      granteeId: userB,
      parentType: "magazine",
      parentId: mag.id,
      permission: "edit",
    });

    // B sees the magazine but NOT the firearm it links to.
    expect(await isVisible(db, userB, "magazine", mag.id)).toBe(true);
    expect(await isVisible(db, userB, "firearm", fa.id)).toBe(false);
  });
});
