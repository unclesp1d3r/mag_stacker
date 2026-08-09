import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { magazineFirearm } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeMagazine,
} from "@/src/test-support/factories";
import { dedupeFirearmIds, replaceCompatibility } from "../compatibility";

describe("dedupeFirearmIds (pure, KTD-8/R34)", () => {
  test("collapses duplicates preserving first-occurrence order", () => {
    expect(dedupeFirearmIds(["a", "b", "a", "c", "b"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  test("empty stays empty", () => {
    expect(dedupeFirearmIds([])).toEqual([]);
  });
});

describe("replaceCompatibility (U6)", () => {
  let userA = "";

  beforeAll(async () => {
    userA = await createUser("A");
  });
  afterAll(async () => {
    await deleteUsers(userA);
  });

  async function orderedLinks(magazineId: string): Promise<string[]> {
    const rows = await db
      .select({ firearmId: magazineFirearm.firearmId })
      .from(magazineFirearm)
      .where(eq(magazineFirearm.magazineId, magazineId))
      .orderBy(asc(magazineFirearm.ordinal));
    return rows.map((r) => r.firearmId);
  }

  test("assigns ordinals 0,1,2 in caller order; replacing [A,B] with [B,C] yields [B,C]", async () => {
    const a = await makeFirearm(userA, { name: "A" });
    const b = await makeFirearm(userA, { name: "B" });
    const c = await makeFirearm(userA, { name: "C" });
    const mag = await makeMagazine(userA);

    await db.transaction((tx) =>
      replaceCompatibility(tx, userA, mag.id, [a.id, b.id]),
    );
    expect(await orderedLinks(mag.id)).toEqual([a.id, b.id]);

    await db.transaction((tx) =>
      replaceCompatibility(tx, userA, mag.id, [b.id, c.id]),
    );
    expect(await orderedLinks(mag.id)).toEqual([b.id, c.id]); // A's row gone
  });

  test("a duplicate reference collapses to one before ordinals are assigned (R34)", async () => {
    const a = await makeFirearm(userA, { name: "A" });
    const b = await makeFirearm(userA, { name: "B" });
    const mag = await makeMagazine(userA);
    await db.transaction((tx) =>
      replaceCompatibility(tx, userA, mag.id, [a.id, b.id, a.id, b.id]),
    );
    expect(await orderedLinks(mag.id)).toEqual([a.id, b.id]);
  });

  test("updating to an empty set removes all links (R31)", async () => {
    const a = await makeFirearm(userA, { name: "A" });
    const mag = await makeMagazine(userA);
    await db.transaction((tx) =>
      replaceCompatibility(tx, userA, mag.id, [a.id]),
    );
    await db.transaction((tx) => replaceCompatibility(tx, userA, mag.id, []));
    expect(await orderedLinks(mag.id)).toEqual([]);
  });

  test("a link to a firearm the actor cannot see fails and rolls back (R37)", async () => {
    const userB = await createUser("B");
    const bFirearm = await makeFirearm(userB, { name: "B private" });
    const mag = await makeMagazine(userA);
    await expect(
      db.transaction((tx) =>
        replaceCompatibility(tx, userA, mag.id, [bFirearm.id]),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await orderedLinks(mag.id)).toEqual([]);
    await deleteUsers(userB);
  });
});

describe("replaceCompatibility — non-magazine-fed firearms (#37 R5)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("MagFedCompatA");
    userB = await createUser("MagFedCompatB");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("rejects linking a magazine to a firearm that takes no detachable magazines", async () => {
    const revolver = await makeFirearm(userA, {
      name: "Revolver",
      isMagazineFed: false,
    });
    const mag = await makeMagazine(userA);

    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await replaceCompatibility(tx, userA, mag.id, [revolver.id]);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).codes).toContain(
      "compatibleFirearmNotMagazineFed",
    );

    // Nothing was written — the throw rolled the transaction back.
    const rows = await db
      .select()
      .from(magazineFirearm)
      .where(eq(magazineFirearm.magazineId, mag.id));
    expect(rows).toHaveLength(0);
  });

  test("rejects a mixed list, so one bad id blocks the whole replace", async () => {
    const ok = await makeFirearm(userA, { name: "Pistol" });
    const revolver = await makeFirearm(userA, {
      name: "Revolver 2",
      isMagazineFed: false,
    });
    const mag = await makeMagazine(userA);

    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await replaceCompatibility(tx, userA, mag.id, [ok.id, revolver.id]);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const rows = await db
      .select()
      .from(magazineFirearm)
      .where(eq(magazineFirearm.magazineId, mag.id));
    expect(rows).toHaveLength(0);
  });

  test("the check is not visibility-scoped away: a shared non-magazine-fed firearm is still rejected", async () => {
    const revolver = await makeFirearm(userB, {
      name: "Shared Revolver",
      isMagazineFed: false,
    });
    await createGrant(db, {
      actorId: userB,
      granteeId: userA,
      parentType: "firearm",
      parentId: revolver.id,
      permission: "edit",
    });
    const mag = await makeMagazine(userA);

    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await replaceCompatibility(tx, userA, mag.id, [revolver.id]);
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
  });

  test("magazine-fed firearms still link normally, and clearing still works", async () => {
    const fa = await makeFirearm(userA, { name: "Normal Pistol" });
    const mag = await makeMagazine(userA);

    await db.transaction(async (tx) => {
      await replaceCompatibility(tx, userA, mag.id, [fa.id]);
    });
    expect(await orderedLinksFor(mag.id)).toEqual([fa.id]);

    await db.transaction(async (tx) => {
      await replaceCompatibility(tx, userA, mag.id, []);
    });
    expect(await orderedLinksFor(mag.id)).toEqual([]);
  });

  async function orderedLinksFor(magazineId: string): Promise<string[]> {
    const rows = await db
      .select({ firearmId: magazineFirearm.firearmId })
      .from(magazineFirearm)
      .where(eq(magazineFirearm.magazineId, magazineId))
      .orderBy(asc(magazineFirearm.ordinal));
    return rows.map((r) => r.firearmId);
  }
});
