import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { createMagazine } from "@/src/domain/magazines/service";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeLogEntry,
  makeMagazine,
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

live("listMagazinesFiltered — lastInventoriedAt (U2, #70)", () => {
  let owner = "";
  let grantee = "";
  let stranger = "";

  beforeAll(async () => {
    owner = await createUser("lastInvOwner");
    grantee = await createUser("lastInvGrantee");
    stranger = await createUser("lastInvStranger");
  });
  afterAll(async () => {
    await deleteUsers(owner, grantee, stranger);
  });

  test("a magazine with inventoried entries returns the max occurredAt as lastInventoriedAt", async () => {
    const mag = await makeMagazine(owner);
    await makeLogEntry("magazine", mag.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await makeLogEntry("magazine", mag.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const rows = await listMagazinesFiltered(owner, {});
    const row = rows.find((r) => r.id === mag.id);
    expect(row?.lastInventoriedAt?.toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  test("a magazine with no inventoried entries has a null lastInventoriedAt", async () => {
    const mag = await makeMagazine(owner);

    const rows = await listMagazinesFiltered(owner, {});
    const row = rows.find((r) => r.id === mag.id);
    expect(row?.lastInventoriedAt).toBeNull();
  });

  test("visibility scoping: a shared magazine appears with its lastInventoriedAt; an unshared one is absent entirely", async () => {
    const shared = await makeMagazine(owner, { brandModel: "Shared Mag" });
    await makeLogEntry("magazine", shared.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "magazine",
      parentId: shared.id,
      permission: "view",
    });

    const notShared = await makeMagazine(stranger, {
      brandModel: "Not Shared Mag",
    });

    const rows = await listMagazinesFiltered(grantee, {});
    const sharedRow = rows.find((r) => r.id === shared.id);
    expect(sharedRow?.lastInventoriedAt?.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(rows.some((r) => r.id === notShared.id)).toBe(false);
  });
});
