import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeMagazine,
} from "@/src/test-support/factories";
import { getPrefixData, listPrefixes, recordPrefix } from "../prefixes";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("magazine label prefixes (#22)", () => {
  let userA = "";
  let userB = "";

  beforeAll(async () => {
    userA = await createUser("pfxA");
    userB = await createUser("pfxB");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  test("recordPrefix inserts once and is idempotent (R1)", async () => {
    const owner = await createUser("pfx-idem");
    await recordPrefix(db, owner, "US");
    await recordPrefix(db, owner, "US");
    expect(await listPrefixes(owner)).toEqual(["US"]);
    await deleteUsers(owner);
  });

  test("recordPrefix skips empty / whitespace-only prefixes", async () => {
    const owner = await createUser("pfx-empty");
    await recordPrefix(db, owner, "");
    await recordPrefix(db, owner, "   ");
    expect(await listPrefixes(owner)).toEqual([]);
    await deleteUsers(owner);
  });

  test("listPrefixes is owner-scoped and alphabetical (R4)", async () => {
    await recordPrefix(db, userA, "US");
    await recordPrefix(db, userA, "AR");
    await recordPrefix(db, userB, "GL");
    expect(await listPrefixes(userA)).toEqual(["AR", "US"]);
    expect(await listPrefixes(userB)).toEqual(["GL"]);
  });

  test("getPrefixData returns the list plus a next-start map from all labels (R5)", async () => {
    const owner = await createUser("pfx-data");
    await recordPrefix(db, owner, "US");
    await recordPrefix(db, owner, "AR");
    await makeMagazine(owner, { label: "US01" });
    await makeMagazine(owner, { label: "US03" });
    await makeMagazine(owner, { label: "AR02" });
    const { prefixes, nextStart } = await getPrefixData(owner);
    expect(prefixes).toEqual(["AR", "US"]);
    expect(nextStart).toEqual({ US: 4, AR: 3 });
    await deleteUsers(owner);
  });
});
