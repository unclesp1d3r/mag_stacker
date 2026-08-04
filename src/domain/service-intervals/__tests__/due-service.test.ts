import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { rangeSessionAccessory } from "@/src/db/schema";
import {
  createUser,
  deleteUsers,
  makeAccessory,
  makeFirearm,
  makeRangeSession,
  makeServiceEvent,
} from "@/src/test-support/factories";
import { getItemDueState, listDueForVisibleCollection } from "../due-service";
import { listServiceHistory, logServiceEvent } from "../events-service";
import { createItemRule, createServiceRuleDefault } from "../rules-service";

/**
 * Due-service integration tests (service-intervals plan, U4). Each test
 * creates its own owner(s), matching the isolation style established in
 * `rules-service.test.ts`. Date fixtures are always built with
 * `new Date(y, monthIndex, d)` (local frame), never UTC `...Z` literals
 * (KTD5, docs/solutions/test-failures/timezone-fragile-date-boundary-tests.md).
 */

function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

/**
 * Counts every SQL round trip issued through `pg`'s `Pool.prototype.query`
 * while `fn` runs — patched at the shared class prototype (not the
 * lazy-proxy `db`/`pool` exports in `src/db/client.ts`, whose `set` trap
 * isn't overridden and so wouldn't reach the real, already-constructed pool
 * instance drizzle holds). `drizzle-orm/node-postgres`'s session always
 * calls `this.client.query(...)` for a non-transactional query — `client`
 * being the pool itself outside a transaction — so this captures exactly
 * the top-level query count `listDueForVisibleCollection` issues.
 */
async function countPoolQueries<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; count: number }> {
  const original = Pool.prototype.query;
  let count = 0;
  Pool.prototype.query = function (
    this: Pool,
    ...args: Parameters<typeof original>
  ) {
    count += 1;
    // biome-ignore lint/suspicious/noExplicitAny: passthrough to the original overloaded pg method
    return (original as any).apply(this, args);
  } as typeof original;
  try {
    const result = await fn();
    return { result, count };
  } finally {
    Pool.prototype.query = original;
  }
}

describe("service-intervals due-service (U4)", () => {
  const createdUsers: string[] = [];

  afterAll(async () => {
    await deleteUsers(...createdUsers);
  });

  async function newOwner(label: string): Promise<string> {
    const id = await createUser(label);
    createdUsers.push(id);
    return id;
  }

  test("covers AE3: cold start counts from the acquired date", async () => {
    const owner = await newOwner("u4ae3");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: "2026-01-01",
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await makeRangeSession(fa.id, { date: "2026-01-10", roundsFired: 700 });
    await makeRangeSession(fa.id, { date: "2026-01-20", roundsFired: 700 });

    const rules = await getItemDueState(
      owner,
      "firearm",
      fa.id,
      localDate(2026, 0, 31),
    );
    const cleaning = rules.find((r) => r.name === "Cleaning");

    expect(cleaning?.due).toBe(true);
    expect(cleaning?.trippedAxis).toBe("rounds");
    expect(cleaning?.counts).toEqual({ days: 30, sessions: 2, rounds: 1400 });
  });

  // Accessory acquiredDate (added during implementation — see the plan's
  // "Scope added during implementation" note; KTD9 updated to resolve an
  // accessory's origin the same way a firearm's does). Parallels AE3 above
  // exactly, on the accessory side, and is the direct proof for the feature:
  // a backdated accessory reads due on day one where an otherwise-identical
  // one with no acquired date does not.
  test("an accessory with a backdated acquired date is due on day one; an otherwise-identical one with no acquired date is not", async () => {
    const owner = await newOwner("u4accAcquiredColdStart");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const backdated = await makeAccessory(owner, {
      category: "Optic",
      currentFirearmId: fa.id,
      acquiredDate: "2024-01-01",
    });
    const undated = await makeAccessory(owner, {
      category: "Optic",
      currentFirearmId: fa.id,
    });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Optic",
      name: "Cleaning",
      intervalDays: 180,
    });

    const asOf = localDate(2026, 0, 1);
    const backdatedRules = await getItemDueState(
      owner,
      "accessory",
      backdated.id,
      asOf,
    );
    const undatedRules = await getItemDueState(
      owner,
      "accessory",
      undated.id,
      asOf,
    );
    const backdatedCleaning = backdatedRules.find((r) => r.name === "Cleaning");
    const undatedCleaning = undatedRules.find((r) => r.name === "Cleaning");

    expect(backdatedCleaning?.due).toBe(true);
    expect(backdatedCleaning?.trippedAxis).toBe("days");
    expect(backdatedCleaning?.measureFrom.getTime()).toBe(
      localDate(2024, 0, 1).getTime(),
    );
    // The undated accessory was just created (its origin is `createdAt`,
    // effectively "now") — nowhere near 180 days elapsed.
    expect(undatedCleaning?.due).toBe(false);
  });

  test("covers AE4: a suppressor mounted on 2 of 5 post-service sessions counts only those two sessions and their rounds", async () => {
    const owner = await newOwner("u4ae4");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const suppressor = await makeAccessory(owner, {
      category: "Suppressor",
      currentFirearmId: fa.id,
    });
    await makeServiceEvent(
      { accessoryId: suppressor.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );
    await createItemRule(owner, "accessory", suppressor.id, {
      name: "Cleaning",
      intervalRounds: 1,
    });

    const sessions = [];
    for (const date of [
      "2026-01-05",
      "2026-01-10",
      "2026-01-15",
      "2026-01-20",
      "2026-01-25",
    ]) {
      sessions.push(await makeRangeSession(fa.id, { date, roundsFired: 100 }));
    }
    // Snapshot only 2 of the 5 sessions as mounted on the suppressor —
    // mirrors `snapshotMountedAccessories`' per-session join without going
    // through mount/unmount cycles the test doesn't otherwise need.
    await db.insert(rangeSessionAccessory).values([
      { rangeSessionId: sessions[1].id, accessoryId: suppressor.id },
      { rangeSessionId: sessions[3].id, accessoryId: suppressor.id },
    ]);

    const rules = await getItemDueState(
      owner,
      "accessory",
      suppressor.id,
      localDate(2026, 0, 31),
    );
    const cleaning = rules.find((r) => r.name === "Cleaning");

    expect(cleaning?.counts.sessions).toBe(2);
    expect(cleaning?.counts.rounds).toBe(200);
  });

  test("covers AE6: a firearm with a service event three months old measures from that date, and the event appears in history", async () => {
    const owner = await newOwner("u4ae6");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: "2025-01-01",
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    // Stands in for a U5-converted `cleaned` entry — the resulting
    // service_event row is identical either way.
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    const rules = await getItemDueState(
      owner,
      "firearm",
      fa.id,
      localDate(2026, 3, 1), // April 1 — three months after the Jan 1 event
    );
    const cleaning = rules.find((r) => r.name === "Cleaning");
    expect(cleaning?.measureFrom.getTime()).toBe(
      localDate(2026, 0, 1).getTime(),
    );
    expect(cleaning?.counts.days).toBe(90);

    const history = await listServiceHistory(owner, "firearm", fa.id);
    expect(history.map((e) => e.ruleName)).toContain("Cleaning");
    expect(history.find((e) => e.ruleName === "Cleaning")?.servicedOn).toBe(
      "2026-01-01",
    );
  });

  test("covers R14: logging service resets that rule's counts to zero and leaves every other rule at its prior counts", async () => {
    const owner = await newOwner("u4r14");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: "2026-01-01",
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 10_000,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Barrel",
      intervalRounds: 10_000,
    });
    await makeRangeSession(fa.id, { date: "2026-02-01", roundsFired: 300 });
    await makeRangeSession(fa.id, { date: "2026-03-01", roundsFired: 200 });

    const asOf = localDate(2026, 5, 1); // June 1
    const before = await getItemDueState(owner, "firearm", fa.id, asOf);
    const barrelBefore = before.find((r) => r.name === "Barrel");
    expect(barrelBefore?.counts).toEqual({
      days: 151,
      sessions: 2,
      rounds: 500,
    });

    await logServiceEvent(owner, "firearm", fa.id, {
      ruleName: "Cleaning",
      servicedOn: "2026-06-01",
    });

    const after = await getItemDueState(owner, "firearm", fa.id, asOf);
    const cleaningAfter = after.find((r) => r.name === "Cleaning");
    const barrelAfter = after.find((r) => r.name === "Barrel");

    expect(cleaningAfter?.counts).toEqual({ days: 0, sessions: 0, rounds: 0 });
    expect(barrelAfter?.counts).toEqual(barrelBefore?.counts);
  });

  test("a firearm with no acquired date measures from its creation date", async () => {
    const owner = await newOwner("u4noAcquired");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 1,
    });

    const rules = await getItemDueState(owner, "firearm", fa.id, new Date());
    const cleaning = rules.find((r) => r.name === "Cleaning");
    expect(cleaning?.measureFrom.getTime()).toBe(fa.createdAt.getTime());
  });

  // No `acquiredDate` is set here — with one unset, `createdAt` is still the
  // fallback origin (KTD9), so this stays valid alongside the acquiredDate
  // cold-start test above.
  test("an accessory with no acquired date measures from its creation date, not its installed date", async () => {
    const owner = await newOwner("u4accCreatedAt");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, {
      category: "Optic",
      currentFirearmId: fa.id,
      installedDate: "2020-01-01",
    });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Optic",
      name: "Cleaning",
      intervalRounds: 1,
    });

    const rules = await getItemDueState(owner, "accessory", acc.id, new Date());
    const cleaning = rules.find((r) => r.name === "Cleaning");
    expect(cleaning?.measureFrom.getTime()).toBe(acc.createdAt.getTime());
    expect(cleaning?.measureFrom.getTime()).not.toBe(
      localDate(2020, 0, 1).getTime(),
    );
  });

  test("collection-wide due resolution never surfaces another owner's accessory mounted on a shared firearm (KTD3: accessory service is owner-only throughout)", async () => {
    const owner = await newOwner("u4collectionAccLeakOwner");
    const grantee = await newOwner("u4collectionAccLeakGrantee");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, {
      category: "Optic",
      currentFirearmId: fa.id,
    });
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Optic",
      name: "Cleaning",
      intervalRounds: 1,
    });

    const entries = await listDueForVisibleCollection(grantee, new Date());
    expect(entries.some((e) => e.parentId === acc.id)).toBe(false);
  });

  test("collection-wide due resolution over an owner with no defaults anywhere returns an empty result, not an error", async () => {
    const owner = await newOwner("u4collectionEmpty");
    await makeFirearm(owner, { type: "rifle" });
    await makeAccessory(owner, { category: "Optic" });

    const entries = await listDueForVisibleCollection(owner, new Date());
    expect(entries).toEqual([]);
  });

  test("collection-wide due resolution includes a shared firearm using its OWNER's defaults, not the viewer's", async () => {
    const owner = await newOwner("u4collectionOwner");
    const viewer = await newOwner("u4collectionViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    // The viewer's OWN identically-named category default must never leak in.
    await createServiceRuleDefault(viewer, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 999,
    });

    const entries = await listDueForVisibleCollection(viewer, new Date());
    const entry = entries.find((e) => e.parentId === fa.id);
    expect(entry?.rules.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });
  });

  test("collection-wide due resolution issues a bounded number of queries regardless of how many items are visible", async () => {
    const smallOwner = await newOwner("u4boundedSmall");
    await createServiceRuleDefault(smallOwner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await makeFirearm(smallOwner, { type: "rifle" });
    await makeFirearm(smallOwner, { type: "rifle" });

    const largeOwner = await newOwner("u4boundedLarge");
    await createServiceRuleDefault(largeOwner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    for (let i = 0; i < 15; i += 1) {
      await makeFirearm(largeOwner, { type: "rifle" });
    }

    const { result: smallEntries, count: smallCount } = await countPoolQueries(
      () => listDueForVisibleCollection(smallOwner, new Date()),
    );
    const { result: largeEntries, count: largeCount } = await countPoolQueries(
      () => listDueForVisibleCollection(largeOwner, new Date()),
    );

    expect(smallEntries).toHaveLength(2);
    expect(largeEntries).toHaveLength(15);
    // The whole point: 15 items issue exactly as many queries as 2 — no
    // per-item query hiding in the loop.
    expect(largeCount).toBe(smallCount);
  });

  test("an accessory whose only mounted sessions belong to a firearm the actor cannot see contributes no rounds", async () => {
    const owner = await newOwner("u4accInvisibleOwner");
    const stranger = await newOwner("u4accInvisibleStranger");
    const strangerFa = await makeFirearm(stranger, { type: "rifle" });
    const acc = await makeAccessory(owner, { category: "Optic" });
    const session = await makeRangeSession(strangerFa.id, {
      date: "2026-01-05",
      roundsFired: 200,
    });
    // Direct join insert: simulates a mount snapshot the app itself could
    // never produce (mounting requires the accessory and firearm to share an
    // owner, see `authorizeMount`) — this proves the defensive
    // visible-firearm restriction structurally, mirroring
    // `accessoryRoundsFired`'s analogous guard in
    // `src/domain/range-sessions/service.ts`.
    await db
      .insert(rangeSessionAccessory)
      .values({ rangeSessionId: session.id, accessoryId: acc.id });
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Optic",
      name: "Cleaning",
      intervalRounds: 1,
    });

    const rules = await getItemDueState(
      owner,
      "accessory",
      acc.id,
      localDate(2026, 1, 1),
    );
    const cleaning = rules.find((r) => r.name === "Cleaning");
    expect(cleaning?.counts.sessions).toBe(0);
    expect(cleaning?.counts.rounds).toBe(0);
  });
});
