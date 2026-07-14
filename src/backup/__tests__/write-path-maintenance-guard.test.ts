import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { authorizeMount } from "../../auth/accessory-visibility";
import {
  authorizeAndDeleteParent,
  authorizeDelete,
  authorizeOwnerOnlyRead,
  authorizeOwnerOnlyUpdate,
  authorizeUpdate,
  resolveCreateOwner,
} from "../../auth/authorize";
import { NotFoundError } from "../../auth/errors";
import { createGrant, revokeGrant } from "../../auth/grants";
import * as schema from "../../db/schema";
import { accessory, firearm, grant, magazine, user } from "../../db/schema";
import { wipeDatabase } from "../db-import";
import {
  enterMaintenance,
  exitMaintenance,
  MaintenanceModeError,
} from "../maintenance";

/**
 * Integration coverage for the KTD5 write-path enforcement gap: a
 * force-restore's durable maintenance flag must block every ordinary write —
 * not just be checkable from `maintenance.ts`. Exercises the shared
 * write-authorization gates (`authorize.ts`, `accessory-visibility.ts`,
 * `grants.ts`) directly against an isolated Testcontainers Postgres, mirroring
 * `maintenance.test.ts`'s harness. These take `db`/`tx: DbOrTx` as an
 * explicit parameter, so this runs against a dedicated container rather than
 * the app's shared `@/src/db/client` singleton — no risk of leaving the
 * ambient dev DB's maintenance flag stuck active for every other test file in
 * the same `bun test src` run.
 */
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

type Db = NodePgDatabase<typeof schema>;

async function seedOwner(db: Db, label: string): Promise<string> {
  const ownerId = `owner-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: ownerId, name: label, email: `${ownerId}@example.test` });
  return ownerId;
}

async function seedFirearm(db: Db, ownerId: string): Promise<string> {
  const [row] = await db
    .insert(firearm)
    .values({ ownerId, name: "Test FA", caliber: "9mm" })
    .returning({ id: firearm.id });
  return row.id;
}

async function seedMagazine(db: Db, ownerId: string): Promise<string> {
  const [row] = await db
    .insert(magazine)
    .values({
      ownerId,
      brandModel: "Test Mag",
      caliber: "9mm",
      baseCapacity: 15,
    })
    .returning({ id: magazine.id });
  return row.id;
}

async function seedAccessory(db: Db, ownerId: string): Promise<string> {
  const [row] = await db
    .insert(accessory)
    .values({ ownerId, category: "optic" })
    .returning({ id: accessory.id });
  return row.id;
}

describe("write path is blocked during maintenance (KTD5 gap fix)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Db;
  let ownerId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_write_guard_test")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await wipeDatabase(db);
    await exitMaintenance(db);
    ownerId = await seedOwner(db, "Owner");
  });

  afterEach(async () => {
    await exitMaintenance(db);
  });

  describe("with maintenance inactive (or the infra never created)", () => {
    test("create (resolveCreateOwner) proceeds normally", async () => {
      await expect(resolveCreateOwner(db, ownerId, undefined)).resolves.toBe(
        ownerId,
      );
    });

    test("update (authorizeUpdate / authorizeOwnerOnlyUpdate) proceeds normally", async () => {
      const firearmId = await seedFirearm(db, ownerId);
      await expect(
        authorizeUpdate(db, ownerId, "firearm", firearmId),
      ).resolves.toBeUndefined();

      const magazineId = await seedMagazine(db, ownerId);
      await expect(
        authorizeOwnerOnlyUpdate(db, ownerId, "magazine", magazineId),
      ).resolves.toBeUndefined();
    });

    test("delete (authorizeDelete / authorizeAndDeleteParent) proceeds normally", async () => {
      const firearmId = await seedFirearm(db, ownerId);
      await authorizeAndDeleteParent(ownerId, "firearm", firearmId, db);
      const rows = await db
        .select()
        .from(firearm)
        .where(eq(firearm.id, firearmId));
      expect(rows).toHaveLength(0);
    });

    test("grant create/revoke proceeds normally", async () => {
      const firearmId = await seedFirearm(db, ownerId);
      const granteeId = await seedOwner(db, "Grantee");
      await createGrant(db, {
        actorId: ownerId,
        granteeId,
        parentType: "firearm",
        parentId: firearmId,
        permission: "view",
      });
      const rows = await db
        .select()
        .from(grant)
        .where(eq(grant.granteeId, granteeId));
      expect(rows).toHaveLength(1);

      await revokeGrant(db, {
        actorId: ownerId,
        granteeId,
        parentType: "firearm",
        parentId: firearmId,
      });
      const after = await db
        .select()
        .from(grant)
        .where(eq(grant.granteeId, granteeId));
      expect(after).toHaveLength(0);
    });

    test("accessory mount (authorizeMount) proceeds normally", async () => {
      const firearmId = await seedFirearm(db, ownerId);
      const accessoryId = await seedAccessory(db, ownerId);
      await expect(
        authorizeMount(db, ownerId, accessoryId, firearmId),
      ).resolves.toBeUndefined();
    });
  });

  describe("with maintenance active", () => {
    beforeEach(async () => {
      await enterMaintenance(db, "force-restore");
    });

    test("create (resolveCreateOwner) throws MaintenanceModeError", async () => {
      await expect(
        resolveCreateOwner(db, ownerId, undefined),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
    });

    test("update (authorizeUpdate / authorizeOwnerOnlyUpdate) throws MaintenanceModeError", async () => {
      // Seed BEFORE entering maintenance would also work, but seeding a
      // parent here (with maintenance already active on this connection)
      // proves the guard doesn't accidentally block the *test's* setup
      // writes — only calls that go through the guarded helpers.
      await exitMaintenance(db);
      const firearmId = await seedFirearm(db, ownerId);
      const magazineId = await seedMagazine(db, ownerId);
      await enterMaintenance(db, "force-restore");

      await expect(
        authorizeUpdate(db, ownerId, "firearm", firearmId),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
      await expect(
        authorizeOwnerOnlyUpdate(db, ownerId, "magazine", magazineId),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
    });

    test("delete (authorizeDelete / authorizeAndDeleteParent) throws MaintenanceModeError and leaves the row untouched", async () => {
      await exitMaintenance(db);
      const firearmId = await seedFirearm(db, ownerId);
      await enterMaintenance(db, "force-restore");

      await expect(
        authorizeDelete(db, ownerId, "firearm", firearmId),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
      await expect(
        authorizeAndDeleteParent(ownerId, "firearm", firearmId, db),
      ).rejects.toBeInstanceOf(MaintenanceModeError);

      await exitMaintenance(db);
      const rows = await db
        .select()
        .from(firearm)
        .where(eq(firearm.id, firearmId));
      expect(rows).toHaveLength(1); // untouched by the blocked delete
    });

    test("grant create/revoke throws MaintenanceModeError", async () => {
      await exitMaintenance(db);
      const firearmId = await seedFirearm(db, ownerId);
      const granteeId = await seedOwner(db, "Grantee");
      await enterMaintenance(db, "force-restore");

      await expect(
        createGrant(db, {
          actorId: ownerId,
          granteeId,
          parentType: "firearm",
          parentId: firearmId,
          permission: "view",
        }),
      ).rejects.toBeInstanceOf(MaintenanceModeError);

      await expect(
        revokeGrant(db, {
          actorId: ownerId,
          granteeId,
          parentType: "firearm",
          parentId: firearmId,
        }),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
    });

    test("accessory mount (authorizeMount) throws MaintenanceModeError", async () => {
      await exitMaintenance(db);
      const firearmId = await seedFirearm(db, ownerId);
      const accessoryId = await seedAccessory(db, ownerId);
      await enterMaintenance(db, "force-restore");

      await expect(
        authorizeMount(db, ownerId, accessoryId, firearmId),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
    });

    test("a READ (authorizeOwnerOnlyRead) is NOT blocked during maintenance", async () => {
      await exitMaintenance(db);
      const firearmId = await seedFirearm(db, ownerId);
      await enterMaintenance(db, "force-restore");

      await expect(
        authorizeOwnerOnlyRead(db, ownerId, "firearm", firearmId),
      ).resolves.toBeUndefined();
    });

    test("a not-found delete during maintenance still reports MaintenanceModeError, not NotFoundError (write-blocking checked first)", async () => {
      await expect(
        authorizeAndDeleteParent(ownerId, "firearm", randomUUID(), db),
      ).rejects.toBeInstanceOf(MaintenanceModeError);
      // Sanity: outside maintenance, the same call is a NotFoundError.
      await exitMaintenance(db);
      await expect(
        authorizeAndDeleteParent(ownerId, "firearm", randomUUID(), db),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
