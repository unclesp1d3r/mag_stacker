import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/src/db/client";
import { firearm, magazine, magazineFirearm, user } from "@/src/db/schema";

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

export async function linkMagazineFirearm(
  magazineId: string,
  firearmId: string,
  ordinal = 0,
): Promise<void> {
  await db.insert(magazineFirearm).values({ magazineId, firearmId, ordinal });
}
