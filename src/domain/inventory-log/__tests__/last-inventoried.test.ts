import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeFirearm,
  makeLogEntry,
  makeMagazine,
} from "@/src/test-support/factories";
import { loadLastInventoriedBatch } from "../last-inventoried";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("loadLastInventoriedBatch (U1)", () => {
  let owner = "";

  beforeAll(async () => {
    owner = await createUser("lastInvOwner");
  });
  afterAll(async () => {
    await deleteUsers(owner);
  });

  test("returns the max occurredAt for a magazine with several inventoried entries", async () => {
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
    await makeLogEntry("magazine", mag.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const result = await loadLastInventoriedBatch(db, "magazine", [mag.id]);
    expect(result.get(mag.id)?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  test("returns that entry's occurredAt for a parent with a single inventoried entry", async () => {
    const mag = await makeMagazine(owner);
    await makeLogEntry("magazine", mag.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const result = await loadLastInventoriedBatch(db, "magazine", [mag.id]);
    expect(result.get(mag.id)?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("a parent with no inventoried entries is absent from the map", async () => {
    const mag = await makeMagazine(owner);

    const result = await loadLastInventoriedBatch(db, "magazine", [mag.id]);
    expect(result.has(mag.id)).toBe(false);
  });

  test("only inventoried entries and only the requested parentType contribute", async () => {
    const mag = await makeMagazine(owner);
    await makeLogEntry("magazine", mag.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const fa = await makeFirearm(owner);
    await makeLogEntry("firearm", fa.id, {
      actorId: owner,
      eventType: "inventoried",
      occurredAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await makeLogEntry("firearm", fa.id, {
      actorId: owner,
      eventType: "cleaned",
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    // A magazine-scoped call must ignore both the firearm's inventoried entry
    // and its cleaned entry (wrong parentType entirely).
    const result = await loadLastInventoriedBatch(db, "magazine", [
      mag.id,
      fa.id,
    ]);
    expect(result.get(mag.id)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(result.has(fa.id)).toBe(false);

    // A firearm-scoped call sees only its own inventoried entry, not cleaned.
    const firearmResult = await loadLastInventoriedBatch(db, "firearm", [
      fa.id,
    ]);
    expect(firearmResult.get(fa.id)?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  test("an empty parentIds list returns an empty map with no error", async () => {
    const result = await loadLastInventoriedBatch(db, "magazine", []);
    expect(result.size).toBe(0);
  });
});
