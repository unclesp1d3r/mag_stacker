import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import { escapeLike, listMagazinesFiltered } from "../filter";

describe("escapeLike (pure, R50)", () => {
  test("escapes %, _, and backslash", () => {
    expect(escapeLike("50%_x\\y")).toBe("50\\%\\_x\\\\y");
  });
});

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("listMagazinesFiltered (U9)", () => {
  let userA = "";
  let firearmId = "";

  beforeAll(async () => {
    userA = await createUser("A");
    const fa = await makeFirearm(userA, { name: "Glock 19" });
    firearmId = fa.id;
    await createMagazine(userA, {
      brandModel: "Magpul PMAG",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
      compatibleFirearmIds: [firearmId],
    });
    await createMagazine(userA, {
      brandModel: "ETS 50% Drum",
      caliber: "9mm",
      baseCapacity: 50,
      extensionRounds: 0,
    });
    await createMagazine(userA, {
      brandModel: "OEM 5.56",
      caliber: "5.56",
      baseCapacity: 30,
      extensionRounds: 0,
    });
  });
  afterAll(async () => {
    await deleteUsers(userA);
  });

  test("no filters returns the full visible list ordered by brand/model (R49)", async () => {
    const all = await listMagazinesFiltered(userA, {});
    const names = all.map((m) => m.brandModel);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain("Magpul PMAG");
    expect(names).toContain("OEM 5.56");
  });

  test("brand/model is a case-insensitive substring (R49)", async () => {
    const res = await listMagazinesFiltered(userA, { brandModel: "magpul" });
    expect(res.map((m) => m.brandModel)).toEqual(["Magpul PMAG"]);
  });

  test("caliber filter is exact-match, not substring (R49)", async () => {
    const exact = await listMagazinesFiltered(userA, { caliber: "5.56" });
    expect(exact.map((m) => m.brandModel)).toEqual(["OEM 5.56"]);
    const partial = await listMagazinesFiltered(userA, { caliber: "5" });
    expect(partial).toHaveLength(0); // not a substring match
  });

  test("a brand/model query containing % matches it literally (R50)", async () => {
    const res = await listMagazinesFiltered(userA, { brandModel: "50%" });
    expect(res.map((m) => m.brandModel)).toEqual(["ETS 50% Drum"]);
  });

  test("the three filters combine with AND", async () => {
    const res = await listMagazinesFiltered(userA, {
      brandModel: "PMAG",
      caliber: "9mm",
      compatibleFirearmId: firearmId,
    });
    expect(res.map((m) => m.brandModel)).toEqual(["Magpul PMAG"]);

    // Same firearm but wrong caliber narrows to nothing.
    const none = await listMagazinesFiltered(userA, {
      caliber: "5.56",
      compatibleFirearmId: firearmId,
    });
    expect(none).toHaveLength(0);
  });

  test("the compatible-firearm filter returns only magazines linked to that firearm", async () => {
    const res = await listMagazinesFiltered(userA, {
      compatibleFirearmId: firearmId,
    });
    expect(res.map((m) => m.brandModel)).toEqual(["Magpul PMAG"]);
  });
});
