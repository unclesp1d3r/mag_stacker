import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ParentType } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import {
  ammo,
  firearm,
  inventoryLog,
  magazine,
  magazineFirearm,
  rangeSession,
  user,
} from "@/src/db/schema";

/**
 * DB factories for integration tests (U4+). Each test creates isolated users
 * (random ids) and tears them down via `deleteUsers`, whose ON DELETE CASCADE
 * removes all owned firearms, magazines, joins, and grants.
 *
 * Imported only by *.test.ts.
 */

export async function createUser(label = "u"): Promise<string> {
  const id = `test-${label}-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id, name: label, email: `${id}@example.test` });
  return id;
}

export async function deleteUsers(...ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(user).where(eq(user.id, id));
  }
}

export async function makeFirearm(
  ownerId: string,
  overrides: Partial<typeof firearm.$inferInsert> = {},
): Promise<typeof firearm.$inferSelect> {
  const [row] = await db
    .insert(firearm)
    .values({ ownerId, name: "Test FA", caliber: "9mm", ...overrides })
    .returning();
  return row;
}

export async function makeMagazine(
  ownerId: string,
  overrides: Partial<typeof magazine.$inferInsert> = {},
): Promise<typeof magazine.$inferSelect> {
  const [row] = await db
    .insert(magazine)
    .values({
      ownerId,
      brandModel: "Test MG",
      caliber: "9mm",
      baseCapacity: 15,
      ...overrides,
    })
    .returning();
  return row;
}

export async function makeAmmo(
  ownerId: string,
  overrides: Partial<typeof ammo.$inferInsert> = {},
): Promise<typeof ammo.$inferSelect> {
  const [row] = await db
    .insert(ammo)
    .values({
      ownerId,
      brand: "Test Ammo Co",
      caliber: "9mm",
      type: "FMJ",
      grain: 115,
      quantityRounds: 100,
      lowStockThreshold: 0,
      ...overrides,
    })
    .returning();
  return row;
}

export async function linkMagazineFirearm(
  magazineId: string,
  firearmId: string,
  ordinal = 0,
): Promise<void> {
  await db.insert(magazineFirearm).values({ magazineId, firearmId, ordinal });
}

export async function makeRangeSession(
  firearmId: string,
  overrides: Partial<typeof rangeSession.$inferInsert> = {},
): Promise<typeof rangeSession.$inferSelect> {
  const [row] = await db
    .insert(rangeSession)
    .values({ firearmId, date: "2026-01-01", roundsFired: 50, ...overrides })
    .returning();
  return row;
}

/**
 * Insert an inventory-log row directly (U5). `actor_id` is a real FK to `user`
 * (`ON DELETE SET NULL`), so callers must always supply a valid user id via
 * `overrides.actorId` — there is no sensible default actor to fall back to.
 * `overrides` excludes `parentType`/`parentId`: those are separate params, so
 * a caller can't accidentally insert a row for a different parent than the
 * one it passed explicitly.
 */
export async function makeLogEntry(
  parentType: ParentType,
  parentId: string,
  overrides: Partial<
    Omit<typeof inventoryLog.$inferInsert, "parentType" | "parentId">
  > & { actorId: string },
): Promise<typeof inventoryLog.$inferSelect> {
  const [row] = await db
    .insert(inventoryLog)
    .values({
      eventType: "inventoried",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
      parentType,
      parentId,
    })
    .returning();
  return row;
}
