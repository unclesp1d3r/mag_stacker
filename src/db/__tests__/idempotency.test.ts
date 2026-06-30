import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createUser, deleteUsers } from "@/src/test-support/factories";
import { db } from "../client";
import { IDEMPOTENCY_WINDOW_MS, withIdempotency } from "../idempotency";
import { firearm, idempotency } from "../schema";

const live = process.env.DATABASE_URL ? describe : describe.skip;

live("withIdempotency (U12, KTD-9)", () => {
  let userA = "";
  let userB = "";
  beforeAll(async () => {
    userA = await createUser("A");
    userB = await createUser("B");
  });
  afterAll(async () => {
    await deleteUsers(userA, userB);
  });

  // Action that records a side effect (a firearm insert) so we can count how
  // many times it actually ran.
  function insertAction(ownerId: string, marker: string) {
    return async (tx: Parameters<Parameters<typeof withIdempotency>[2]>[0]) => {
      const [row] = await tx
        .insert(firearm)
        .values({ ownerId, name: marker, caliber: "9mm" })
        .returning({ id: firearm.id });
      return { id: row.id };
    };
  }

  async function countFirearms(marker: string): Promise<number> {
    const rows = await db
      .select({ id: firearm.id })
      .from(firearm)
      .where(eq(firearm.name, marker));
    return rows.length;
  }

  test("a replayed key within the window returns the original result, running the action once (R69)", async () => {
    const key = `replay-${crypto.randomUUID()}`;
    const marker = `idem-${key}`;
    const first = await withIdempotency(
      userA,
      key,
      insertAction(userA, marker),
    );
    const second = await withIdempotency(
      userA,
      key,
      insertAction(userA, marker),
    );
    expect(second.id).toBe(first.id);
    expect(await countFirearms(marker)).toBe(1);
  });

  test("two concurrent submissions with the same key produce exactly one committed result", async () => {
    const key = `race-${crypto.randomUUID()}`;
    const marker = `idem-${key}`;
    const [r1, r2] = await Promise.all([
      withIdempotency(userA, key, insertAction(userA, marker)),
      withIdempotency(userA, key, insertAction(userA, marker)),
    ]);
    expect(r1.id).toBe(r2.id);
    expect(await countFirearms(marker)).toBe(1); // not two
  });

  test("one user's key cannot suppress another user's create (per-user namespace)", async () => {
    const key = `shared-key-${crypto.randomUUID()}`;
    const markerA = `idem-A-${key}`;
    const markerB = `idem-B-${key}`;
    await withIdempotency(userA, key, insertAction(userA, markerA));
    await withIdempotency(userB, key, insertAction(userB, markerB));
    expect(await countFirearms(markerA)).toBe(1);
    expect(await countFirearms(markerB)).toBe(1);
  });

  test("an expired key is reclaimed and the action runs again", async () => {
    const key = `expired-${crypto.randomUUID()}`;
    const marker = `idem-${key}`;
    // Seed an expired row with a stale stored result.
    await db.insert(idempotency).values({
      userId: userA,
      idempotencyKey: key,
      result: { id: "stale" },
      expiresAt: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS),
    });
    const result = await withIdempotency(
      userA,
      key,
      insertAction(userA, marker),
    );
    expect(result.id).not.toBe("stale");
    expect(await countFirearms(marker)).toBe(1);
    // Cleanup the row we seeded.
    await db
      .delete(idempotency)
      .where(
        and(eq(idempotency.userId, userA), eq(idempotency.idempotencyKey, key)),
      );
  });
});
