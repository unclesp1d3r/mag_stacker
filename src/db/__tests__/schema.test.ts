import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  ammo,
  firearm,
  grant,
  magazine,
  magazineFirearm,
  user,
} from "../schema";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * Assert an awaitable (incl. a Drizzle query builder, which is thenable but not
 * a real Promise — bun's `expect().rejects` mishandles it) rejects.
 */
async function expectRejects(awaitable: PromiseLike<unknown>): Promise<void> {
  let threw = false;
  try {
    await awaitable;
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

live("core inventory schema (U3)", () => {
  const ownerId = `test-user-${randomUUID()}`;

  beforeAll(async () => {
    await db.insert(user).values({
      id: ownerId,
      name: "Schema Test",
      email: `${ownerId}@example.test`,
    });
  });

  afterAll(async () => {
    // Cascades remove this user's firearms, magazines, joins, and grants.
    await db.delete(user).where(eq(user.id, ownerId));
  });

  test("inserting a firearm without owner_id fails (ownership mandatory, R8)", async () => {
    await expectRejects(
      db.execute(
        sql`insert into firearm (name, caliber) values ('Glock 19', '9mm')`,
      ),
    );
  });

  test("inserting a magazine without owner_id fails (ownership mandatory, R8)", async () => {
    await expectRejects(
      db.execute(
        sql`insert into magazine (brand_model, caliber, base_capacity) values ('PMAG', '9mm', 15)`,
      ),
    );
  });

  test("capacity CHECK constraints reject base_capacity = 0 and extension_rounds = -1 (R26)", async () => {
    await expectRejects(
      db.insert(magazine).values({
        ownerId,
        brandModel: "Bad",
        caliber: "9mm",
        baseCapacity: 0,
      }),
    );

    await expectRejects(
      db.insert(magazine).values({
        ownerId,
        brandModel: "Bad",
        caliber: "9mm",
        baseCapacity: 10,
        extensionRounds: -1,
      }),
    );
  });

  test("grant parent_type and permission CHECKs reject unknown values", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Check FA", caliber: "9mm" })
      .returning();
    await expectRejects(
      db.insert(grant).values({
        ownerId,
        granteeId: ownerId,
        parentType: "ammunition", // not an allowed family
        parentId: f.id,
        permission: "view",
      }),
    );
    await expectRejects(
      db.insert(grant).values({
        ownerId,
        granteeId: ownerId,
        parentType: "firearm",
        parentId: f.id,
        permission: "owner", // not an allowed permission
      }),
    );
  });

  test("duplicate (magazine_id, firearm_id) join insert is rejected by the composite PK (R34)", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Dup FA", caliber: "9mm" })
      .returning();
    const [m] = await db
      .insert(magazine)
      .values({
        ownerId,
        brandModel: "Dup MG",
        caliber: "9mm",
        baseCapacity: 15,
      })
      .returning();

    await db
      .insert(magazineFirearm)
      .values({ magazineId: m.id, firearmId: f.id, ordinal: 0 });
    await expectRejects(
      db
        .insert(magazineFirearm)
        .values({ magazineId: m.id, firearmId: f.id, ordinal: 1 }),
    );
  });

  test("deleting a firearm cascades its join rows and leaves linked magazines intact (R35)", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Cascade FA", caliber: "9mm" })
      .returning();
    const [m] = await db
      .insert(magazine)
      .values({
        ownerId,
        brandModel: "Cascade MG",
        caliber: "9mm",
        baseCapacity: 15,
      })
      .returning();
    await db
      .insert(magazineFirearm)
      .values({ magazineId: m.id, firearmId: f.id, ordinal: 0 });

    await db.delete(firearm).where(eq(firearm.id, f.id));

    const joins = await db
      .select()
      .from(magazineFirearm)
      .where(eq(magazineFirearm.firearmId, f.id));
    expect(joins).toHaveLength(0);
    const mags = await db.select().from(magazine).where(eq(magazine.id, m.id));
    expect(mags).toHaveLength(1); // magazine survives
  });

  test("deleting a magazine cascades its join rows and leaves firearms intact (R35)", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Survive FA", caliber: "9mm" })
      .returning();
    const [m] = await db
      .insert(magazine)
      .values({
        ownerId,
        brandModel: "Delete MG",
        caliber: "9mm",
        baseCapacity: 15,
      })
      .returning();
    await db
      .insert(magazineFirearm)
      .values({ magazineId: m.id, firearmId: f.id, ordinal: 0 });

    await db.delete(magazine).where(eq(magazine.id, m.id));

    const joins = await db
      .select()
      .from(magazineFirearm)
      .where(eq(magazineFirearm.magazineId, m.id));
    expect(joins).toHaveLength(0);
    const fas = await db.select().from(firearm).where(eq(firearm.id, f.id));
    expect(fas).toHaveLength(1); // firearm survives
  });

  test("deleting a parent removes its grant rows via the cleanup trigger (R17b backstop)", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Granted FA", caliber: "9mm" })
      .returning();
    await db.insert(grant).values({
      ownerId,
      granteeId: ownerId,
      parentType: "firearm",
      parentId: f.id,
      permission: "view",
    });

    await db.delete(firearm).where(eq(firearm.id, f.id));

    const grants = await db
      .select()
      .from(grant)
      .where(and(eq(grant.parentType, "firearm"), eq(grant.parentId, f.id)));
    expect(grants).toHaveLength(0);
  });

  test("ammo CHECK constraints reject negative grain, quantity, and threshold", async () => {
    await expectRejects(
      db.insert(ammo).values({ ownerId, caliber: "9mm", grain: -1 }),
    );

    await expectRejects(
      db.insert(ammo).values({ ownerId, caliber: "9mm", quantityRounds: -1 }),
    );

    await expectRejects(
      db
        .insert(ammo)
        .values({ ownerId, caliber: "9mm", lowStockThreshold: -1 }),
    );
  });

  test("deleting an ammo lot removes its grant rows via the cleanup trigger (R17b backstop)", async () => {
    const [lot] = await db
      .insert(ammo)
      .values({ ownerId, caliber: "9mm" })
      .returning();
    await db.insert(grant).values({
      ownerId,
      granteeId: ownerId,
      parentType: "ammo",
      parentId: lot.id,
      permission: "view",
    });

    await db.delete(ammo).where(eq(ammo.id, lot.id));

    const grants = await db
      .select()
      .from(grant)
      .where(and(eq(grant.parentType, "ammo"), eq(grant.parentId, lot.id)));
    expect(grants).toHaveLength(0);
  });

  test("visibility indexes exist on owner_id and grant (grantee_id, parent_type) (R72)", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const names = rows.rows.map((r) => r.indexname);
    expect(names).toContain("firearm_owner_id_idx");
    expect(names).toContain("magazine_owner_id_idx");
    expect(names).toContain("ammo_owner_id_idx");
    expect(names).toContain("grant_grantee_parent_type_idx");
  });
});
