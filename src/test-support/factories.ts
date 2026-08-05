import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ParentType } from "@/src/auth/visibility";
import { db } from "@/src/db/client";
import {
  accessory,
  ammo,
  firearm,
  firearmDocument,
  firearmPhoto,
  inventoryLog,
  magazine,
  magazineFirearm,
  rangeSession,
  serviceEvent,
  serviceRule,
  serviceRuleDefault,
  user,
} from "@/src/db/schema";

/**
 * `service_rule` and `service_event` each attach to exactly one of a firearm
 * or an accessory (KTD2) — narrower than `ParentType`
 * (`@/src/auth/visibility`), which excludes accessory (it isn't a grantable
 * parent type). Callers pass one variant; the factory spreads it onto the
 * insert alongside the other fixed defaults.
 */
type ServiceParent = { firearmId: string } | { accessoryId: string };

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

/**
 * Insert an accessory row directly (U8). A couple of earlier accessory specs
 * (`src/auth/__tests__/accessory-visibility.test.ts`,
 * `src/domain/accessories/__tests__/service.test.ts`) still seed rows with
 * their own inline copies; new tests should prefer this shared factory.
 * `currentFirearmId` defaults unset (unmounted); pass it via `overrides` to
 * seed a mounted accessory.
 */
export async function makeAccessory(
  ownerId: string,
  overrides: Partial<typeof accessory.$inferInsert> = {},
): Promise<typeof accessory.$inferSelect> {
  const [row] = await db
    .insert(accessory)
    .values({
      ownerId,
      category: "Optic",
      brand: "Test Accessory Co",
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
 * Insert a firearm-document row directly (#12). No `owner_id`/grants — the row
 * is a firearm child, authorized owner-only through `firearmId` (KTD1). Single
 * blob, no derivatives; the default row is a small PDF receipt.
 */
export async function makeFirearmDocument(
  firearmId: string,
  overrides: Partial<
    Omit<typeof firearmDocument.$inferInsert, "firearmId">
  > = {},
): Promise<typeof firearmDocument.$inferSelect> {
  const [row] = await db
    .insert(firearmDocument)
    .values({
      // Flat, separator-free, extension-bearing key matching production shape
      // (`generateKey(ext)`); single blob, no derivatives.
      storageKey: `${randomUUID()}.pdf`,
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      docType: "receipt",
      ...overrides,
      firearmId,
    })
    .returning();
  return row;
}

/**
 * Insert a firearm-photo row directly (U2/U4). No `owner_id`/grants — the row
 * is a firearm child and inherits authz through `firearmId` (R6). `sortOrder`
 * has no sensible default (callers place it in the gallery), so it's a
 * required param rather than an overridable default.
 */
export async function makeFirearmPhoto(
  firearmId: string,
  sortOrder: number,
  overrides: Partial<
    Omit<typeof firearmPhoto.$inferInsert, "firearmId" | "sortOrder">
  > = {},
): Promise<typeof firearmPhoto.$inferSelect> {
  const [row] = await db
    .insert(firearmPhoto)
    .values({
      // Flat, separator-free, extension-bearing key matching production shape
      // (`generateKey(ext)` — see src/storage/keys.ts); a `test/…` prefix would
      // contradict the separator-free invariant the orphan sweep relies on.
      storageKey: `${randomUUID()}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      width: 800,
      height: 600,
      ...overrides,
      firearmId,
      sortOrder,
    })
    .returning();
  return row;
}

/**
 * Insert a service-rule-default row directly (service-intervals plan, U1).
 * Owner-scoped configuration, no parent item — defaults to a firearm-scope
 * "rifle" category "Cleaning" rule with a single rounds threshold, since at
 * least one threshold must be set (R2).
 */
export async function makeServiceRuleDefault(
  ownerId: string,
  overrides: Partial<
    Omit<typeof serviceRuleDefault.$inferInsert, "ownerId">
  > = {},
): Promise<typeof serviceRuleDefault.$inferSelect> {
  const [row] = await db
    .insert(serviceRuleDefault)
    .values({
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
      ...overrides,
      ownerId,
    })
    .returning();
  return row;
}

/**
 * Insert a service-rule row directly (service-intervals plan, U1). `parent`
 * carries exactly one of `firearmId`/`accessoryId` (KTD2); `overrides`
 * excludes both so a caller can't accidentally attach the row to a different
 * parent than the one passed explicitly. Defaults to an unsuppressed
 * "Cleaning" rule with a single rounds threshold.
 */
export async function makeServiceRule(
  parent: ServiceParent,
  overrides: Partial<
    Omit<typeof serviceRule.$inferInsert, "firearmId" | "accessoryId">
  > = {},
): Promise<typeof serviceRule.$inferSelect> {
  const suppressed = overrides.suppressed ?? false;
  const [row] = await db
    .insert(serviceRule)
    .values({
      name: "Cleaning",
      intervalRounds: 500,
      ...overrides,
      // A suppressed rule must carry no thresholds (DB CHECK
      // `service_rule_suppressed_thresholds_consistent`) — force them null
      // here so callers don't have to remember to null all three
      // themselves, and so the constraint failure can't turn into an opaque
      // Postgres error instead of the intended row shape.
      ...(suppressed
        ? { intervalDays: null, intervalSessions: null, intervalRounds: null }
        : {}),
      ...parent,
    })
    .returning();
  return row;
}

/**
 * Insert a service-event row directly (service-intervals plan, U1). `parent`
 * carries exactly one of `firearmId`/`accessoryId` (KTD2), matching
 * `makeServiceRule`. `actorId` is a nullable FK (`ON DELETE SET NULL`), so
 * unlike `makeLogEntry` it has no required override — omit it to test the
 * "acting user later deleted" case directly.
 */
export async function makeServiceEvent(
  parent: ServiceParent,
  overrides: Partial<
    Omit<typeof serviceEvent.$inferInsert, "firearmId" | "accessoryId">
  > = {},
): Promise<typeof serviceEvent.$inferSelect> {
  const [row] = await db
    .insert(serviceEvent)
    .values({
      ruleName: "Cleaning",
      servicedOn: "2026-01-01",
      ...overrides,
      ...parent,
    })
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
