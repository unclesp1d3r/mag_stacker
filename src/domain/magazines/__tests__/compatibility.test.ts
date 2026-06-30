import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { NotFoundError } from "@/src/auth/errors";
import { db } from "@/src/db/client";
import { magazineFirearm } from "@/src/db/schema";
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

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("replaceCompatibility (U6)", () => {
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
