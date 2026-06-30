import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Database } from "@/src/db/client";
import type * as FactoriesType from "@/src/test-support/factories";
import {
  calibersForFilter,
  calibersForInput,
  distinctCalibers,
  manufacturers,
  standardCalibers,
} from "../reference";

// ---------------------------------------------------------------------------
// Gate: skip live tests when DATABASE_URL is not configured.
// ---------------------------------------------------------------------------

const live = process.env.DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Pure tests — always run, zero DB connection required (R74).
// ---------------------------------------------------------------------------

describe("standardCalibers", () => {
  test("returns exactly 107 calibers", () => {
    expect(standardCalibers()).toHaveLength(107);
  });

  test("is sorted ascending", () => {
    // Arrange
    const calibers = standardCalibers();
    // Act
    const sorted = [...calibers].sort((a, b) => a.localeCompare(b));
    // Assert
    expect(calibers).toEqual(sorted);
  });

  test("excludes section header strings", () => {
    const calibers = standardCalibers();
    expect(calibers).not.toContain("Cartridge");
    expect(calibers).not.toContain("Common Rifle Caliber Name");
    expect(calibers).not.toContain("Handgun Cartridge");
  });

  test("contains no blank entries", () => {
    const calibers = standardCalibers();
    expect(calibers.every((c) => c.length > 0)).toBe(true);
  });

  test("includes known rifle calibers", () => {
    const calibers = standardCalibers();
    expect(calibers).toContain(".308 Winchester");
    expect(calibers).toContain("6.5 Creedmoor");
    expect(calibers).toContain(".300 Win Mag");
  });

  test("includes known handgun calibers", () => {
    const calibers = standardCalibers();
    expect(calibers).toContain("9mm Luger");
    expect(calibers).toContain(".45 ACP");
    expect(calibers).toContain(".357 Magnum");
  });

  test("returns an array, never null — R68", () => {
    // R68: every list-returning operation returns an explicit empty collection,
    // never null/absent. The curated list is never empty, but the contract must
    // hold for the return type itself.
    const calibers = standardCalibers();
    expect(Array.isArray(calibers)).toBe(true);
  });

  test("returns a fresh array on each call — R59", () => {
    // Arrange
    const first = standardCalibers();
    // Act: mutate the returned array
    first.push("__MUTATION__");
    // Assert: next call is unaffected
    const second = standardCalibers();
    expect(second).not.toContain("__MUTATION__");
    expect(second).toHaveLength(107);
  });
});

describe("manufacturers", () => {
  test("returns exactly 188 manufacturers", () => {
    expect(manufacturers()).toHaveLength(188);
  });

  test("is sorted ascending", () => {
    const mfgs = manufacturers();
    const sorted = [...mfgs].sort((a, b) => a.localeCompare(b));
    expect(mfgs).toEqual(sorted);
  });

  test("contains no blank entries", () => {
    const mfgs = manufacturers();
    expect(mfgs.every((m) => m.length > 0)).toBe(true);
  });

  test("includes well-known manufacturers", () => {
    const mfgs = manufacturers();
    expect(mfgs).toContain("Glock");
    expect(mfgs).toContain("Smith & Wesson");
    expect(mfgs).toContain("Ruger");
    expect(mfgs).toContain("Remington Arms");
    expect(mfgs).toContain("SIG Sauer");
  });

  test("returns an array, never null — R68", () => {
    // R68: every list-returning operation returns an explicit empty collection,
    // never null/absent.
    const mfgs = manufacturers();
    expect(Array.isArray(mfgs)).toBe(true);
  });

  test("returns a fresh array on each call — R59", () => {
    // Arrange
    const first = manufacturers();
    // Act: mutate the returned array
    first.push("__MUTATION__");
    // Assert: next call is unaffected
    const second = manufacturers();
    expect(second).not.toContain("__MUTATION__");
    expect(second).toHaveLength(188);
  });
});

// ---------------------------------------------------------------------------
// Live tests — require DATABASE_URL.
// ---------------------------------------------------------------------------

live("distinctCalibers", () => {
  let db: Database;
  let makeFirearm: typeof FactoriesType.makeFirearm;
  let makeMagazine: typeof FactoriesType.makeMagazine;
  let createUser: typeof FactoriesType.createUser;
  let deleteUsers: typeof FactoriesType.deleteUsers;

  let ownerAId: string;
  let ownerBId: string;

  beforeAll(async () => {
    // Lazy-load to avoid triggering requireDatabaseUrl() at module level.
    const clientMod = await import("@/src/db/client");
    db = clientMod.db;
    const factMod = await import("@/src/test-support/factories");
    makeFirearm = factMod.makeFirearm;
    makeMagazine = factMod.makeMagazine;
    createUser = factMod.createUser;
    deleteUsers = factMod.deleteUsers;

    ownerAId = await createUser("reftest-owner-a");
    ownerBId = await createUser("reftest-owner-b");
  });

  afterAll(async () => {
    await deleteUsers(ownerAId, ownerBId);
  });

  test("returns calibers from user's visible firearms", async () => {
    // Arrange
    await makeFirearm(ownerAId, { caliber: "6.5 Creedmoor" });
    // Act
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert
    expect(calibers).toContain("6.5 Creedmoor");
  });

  test("returns calibers from user's visible magazines", async () => {
    // Arrange
    await makeMagazine(ownerAId, { caliber: ".40 S&W" });
    // Act
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert
    expect(calibers).toContain(".40 S&W");
  });

  test("excludes blank caliber values", async () => {
    // Arrange: create a firearm with an empty caliber
    await makeFirearm(ownerAId, { caliber: "" });
    // Act
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert
    expect(calibers.every((c) => c.length > 0)).toBe(true);
  });

  test("excludes calibers from another user's items", async () => {
    // Arrange
    await makeFirearm(ownerBId, { caliber: "7mm Remington Magnum" });
    // Act: query as ownerA
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert: ownerA cannot see ownerB's caliber
    expect(calibers).not.toContain("7mm Remington Magnum");
  });

  test("returns results sorted ascending", async () => {
    // Act
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert
    const sorted = [...calibers].sort((a, b) => a.localeCompare(b));
    expect(calibers).toEqual(sorted);
  });

  test("deduplicates across firearms and magazines", async () => {
    // Arrange: same caliber on both a firearm and a magazine
    await makeFirearm(ownerAId, { caliber: "9mm Luger" });
    await makeMagazine(ownerAId, { caliber: "9mm Luger" });
    // Act
    const calibers = await distinctCalibers(db, ownerAId);
    // Assert: appears only once
    expect(calibers.filter((c) => c === "9mm Luger")).toHaveLength(1);
  });
});

live("calibersForInput", () => {
  let db: Database;
  let makeFirearm: typeof FactoriesType.makeFirearm;
  let createUser: typeof FactoriesType.createUser;
  let deleteUsers: typeof FactoriesType.deleteUsers;

  let ownerId: string;

  beforeAll(async () => {
    const clientMod = await import("@/src/db/client");
    db = clientMod.db;
    const factMod = await import("@/src/test-support/factories");
    makeFirearm = factMod.makeFirearm;
    createUser = factMod.createUser;
    deleteUsers = factMod.deleteUsers;

    ownerId = await createUser("reftest-input-owner");
  });

  afterAll(async () => {
    await deleteUsers(ownerId);
  });

  test("includes curated calibers even when inventory is empty", async () => {
    // Act
    const calibers = await calibersForInput(db, ownerId);
    // Assert
    expect(calibers).toContain(".308 Winchester");
    expect(calibers).toContain("9mm Luger");
  });

  test("includes a non-curated caliber from inventory (R60 union)", async () => {
    // Arrange: add a caliber that does not appear in the curated list
    const unusual = "9mm Makarov + P";
    await makeFirearm(ownerId, { caliber: unusual });
    // Act
    const calibers = await calibersForInput(db, ownerId);
    // Assert: union includes the custom entry
    expect(calibers).toContain(unusual);
    // …and still includes curated entries
    expect(calibers).toContain("9mm Luger");
  });

  test("result is sorted ascending", async () => {
    const calibers = await calibersForInput(db, ownerId);
    const sorted = [...calibers].sort((a, b) => a.localeCompare(b));
    expect(calibers).toEqual(sorted);
  });
});

live("calibersForFilter", () => {
  let db: Database;
  let makeFirearm: typeof FactoriesType.makeFirearm;
  let createUser: typeof FactoriesType.createUser;
  let deleteUsers: typeof FactoriesType.deleteUsers;

  let ownerId: string;

  beforeAll(async () => {
    const clientMod = await import("@/src/db/client");
    db = clientMod.db;
    const factMod = await import("@/src/test-support/factories");
    makeFirearm = factMod.makeFirearm;
    createUser = factMod.createUser;
    deleteUsers = factMod.deleteUsers;

    ownerId = await createUser("reftest-filter-owner");
  });

  afterAll(async () => {
    await deleteUsers(ownerId);
  });

  test("returns only calibers present in inventory (R60 filter path)", async () => {
    // Arrange
    await makeFirearm(ownerId, { caliber: ".45 ACP" });
    // Act
    const calibers = await calibersForFilter(db, ownerId);
    // Assert: contains what was stored
    expect(calibers).toContain(".45 ACP");
    // Assert: does NOT include curated-only entries absent from inventory
    // (pick one very unlikely to appear in test data)
    expect(calibers).not.toContain(".30-378 Weatherby Magnum");
  });

  test("returns empty array when user has no inventory", async () => {
    const emptyUserId = await createUser("reftest-filter-empty");
    try {
      const calibers = await calibersForFilter(db, emptyUserId);
      expect(calibers).toEqual([]);
    } finally {
      await deleteUsers(emptyUserId);
    }
  });
});
