import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expectRejects } from "@/src/test-support/assertions";
import {
  makeAccessory,
  makeFirearm,
  makeServiceRule,
  makeServiceRuleDefault,
} from "@/src/test-support/factories";
import { db } from "../client";
import {
  accessory,
  firearm,
  serviceEvent,
  serviceRule,
  serviceRuleDefault,
  user,
} from "../schema";

/**
 * `service_rule_default` / `service_rule` / `service_event` schema (U1) — the
 * exactly-one-parent CHECKs (KTD2), the threshold CHECKs (R2), the
 * suppression shape CHECK (KTD6), the uniqueness constraints, and the FK
 * cascade/set-null behavior. Domain-level behavior (authorization,
 * inheritance resolution) lives in later units' service-layer tests; this
 * covers the DB backstops only.
 */
describe("service-intervals schema (U1)", () => {
  const ownerId = `test-user-${randomUUID()}`;

  beforeAll(async () => {
    await db.insert(user).values({
      id: ownerId,
      name: "Service Schema Test",
      email: `${ownerId}@example.test`,
    });
  });

  afterAll(async () => {
    // Cascade removes this user's firearms/accessories, and in turn their
    // service_rule/service_event rows.
    await db.delete(user).where(eq(user.id, ownerId));
  });

  test("a service_rule row with both firearm_id and accessory_id set is rejected", async () => {
    const f = await makeFirearm(ownerId);
    const acc = await makeAccessory(ownerId);

    await expectRejects(() =>
      db.insert(serviceRule).values({
        firearmId: f.id,
        accessoryId: acc.id,
        name: "Cleaning",
        intervalRounds: 500,
      }),
    );
  });

  test("a service_rule row with neither parent set is rejected", async () => {
    await expectRejects(() =>
      db.insert(serviceRule).values({
        name: "Cleaning",
        intervalRounds: 500,
      }),
    );
  });

  test("a service_event row with both parents set is rejected", async () => {
    const f = await makeFirearm(ownerId);
    const acc = await makeAccessory(ownerId);

    await expectRejects(() =>
      db.insert(serviceEvent).values({
        firearmId: f.id,
        accessoryId: acc.id,
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      }),
    );
  });

  test("a service_event row with neither parent set is rejected", async () => {
    await expectRejects(() =>
      db.insert(serviceEvent).values({
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
      }),
    );
  });

  test("a service_rule_default row with all three thresholds null is rejected", async () => {
    await expectRejects(() =>
      db.insert(serviceRuleDefault).values({
        ownerId,
        scope: "firearm",
        category: "rifle",
        name: "No Threshold",
      }),
    );
  });

  test("a service_rule_default row with a zero or negative threshold is rejected", async () => {
    await expectRejects(() =>
      db.insert(serviceRuleDefault).values({
        ownerId,
        scope: "firearm",
        category: "rifle",
        name: "Zero Threshold",
        intervalRounds: 0,
      }),
    );

    await expectRejects(() =>
      db.insert(serviceRuleDefault).values({
        ownerId,
        scope: "firearm",
        category: "rifle",
        name: "Negative Threshold",
        intervalDays: -1,
      }),
    );
  });

  test("a service_rule_default row with an invalid scope is rejected", async () => {
    await expectRejects(() =>
      db.insert(serviceRuleDefault).values({
        ownerId,
        scope: "magazine",
        category: "rifle",
        name: "Bad Scope",
        intervalRounds: 500,
      }),
    );
  });

  test("a suppressed service_rule row carrying a threshold is rejected", async () => {
    const f = await makeFirearm(ownerId);

    await expectRejects(() =>
      db.insert(serviceRule).values({
        firearmId: f.id,
        name: "Cleaning",
        suppressed: true,
        intervalRounds: 500,
      }),
    );
  });

  test("a suppressed service_rule row with no thresholds is accepted", async () => {
    const f = await makeFirearm(ownerId);

    const row = await makeServiceRule(
      { firearmId: f.id },
      { name: "Cleaning", suppressed: true, intervalRounds: null },
    );
    expect(row.suppressed).toBe(true);
    expect(row.intervalRounds).toBeNull();
  });

  test("an unsuppressed service_rule row with no thresholds is rejected", async () => {
    const f = await makeFirearm(ownerId);

    await expectRejects(() =>
      db.insert(serviceRule).values({
        firearmId: f.id,
        name: "Cleaning",
        suppressed: false,
      }),
    );
  });

  test("two service_rule rows with the same name on the same firearm are rejected; the same two names on two different firearms are accepted", async () => {
    const firearmA = await makeFirearm(ownerId);
    const firearmB = await makeFirearm(ownerId);

    await makeServiceRule({ firearmId: firearmA.id }, { name: "Barrel" });
    await expectRejects(() =>
      db.insert(serviceRule).values({
        firearmId: firearmA.id,
        name: "Barrel",
        intervalRounds: 4000,
      }),
    );

    // Same name on a different firearm is fine.
    const rowB = await makeServiceRule(
      { firearmId: firearmB.id },
      { name: "Barrel" },
    );
    expect(rowB.firearmId).toBe(firearmB.id);
  });

  test("two service_rule rows with the same name on two different accessories are accepted (no collision across NULL parents)", async () => {
    const accessoryA = await makeAccessory(ownerId);
    const accessoryB = await makeAccessory(ownerId);

    const rowA = await makeServiceRule(
      { accessoryId: accessoryA.id },
      { name: "Cleaning" },
    );
    const rowB = await makeServiceRule(
      { accessoryId: accessoryB.id },
      { name: "Cleaning" },
    );
    expect(rowA.accessoryId).toBe(accessoryA.id);
    expect(rowB.accessoryId).toBe(accessoryB.id);
  });

  test("deleting a firearm removes its service_rule and service_event rows without a trigger (FK cascade)", async () => {
    const f = await makeFirearm(ownerId);
    const rule = await makeServiceRule({ firearmId: f.id });
    await db.insert(serviceEvent).values({
      firearmId: f.id,
      ruleName: rule.name,
      servicedOn: "2026-01-01",
    });

    await db.delete(firearm).where(eq(firearm.id, f.id));

    const rules = await db
      .select()
      .from(serviceRule)
      .where(eq(serviceRule.firearmId, f.id));
    expect(rules).toHaveLength(0);

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, f.id));
    expect(events).toHaveLength(0);
  });

  test("deleting an accessory removes its service_rule and service_event rows without a trigger (FK cascade)", async () => {
    const acc = await makeAccessory(ownerId);
    const rule = await makeServiceRule({ accessoryId: acc.id });
    await db.insert(serviceEvent).values({
      accessoryId: acc.id,
      ruleName: rule.name,
      servicedOn: "2026-01-01",
    });

    await db.delete(accessory).where(eq(accessory.id, acc.id));

    const rules = await db
      .select()
      .from(serviceRule)
      .where(eq(serviceRule.accessoryId, acc.id));
    expect(rules).toHaveLength(0);

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.accessoryId, acc.id));
    expect(events).toHaveLength(0);
  });

  test("deleting the acting user leaves a service_event row in place with a null actor_id", async () => {
    const actorId = `test-actor-${randomUUID()}`;
    await db.insert(user).values({
      id: actorId,
      name: "Actor",
      email: `${actorId}@example.test`,
    });
    const f = await makeFirearm(ownerId);
    const [event] = await db
      .insert(serviceEvent)
      .values({
        firearmId: f.id,
        ruleName: "Cleaning",
        servicedOn: "2026-01-01",
        actorId,
      })
      .returning();

    await db.delete(user).where(eq(user.id, actorId));

    const [reloaded] = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.id, event.id));
    expect(reloaded).toBeDefined();
    expect(reloaded.actorId).toBeNull();
  });

  test("a service_rule_default row for one owner is a separate row from an identically-named default for another owner", async () => {
    const otherOwnerId = `test-other-owner-${randomUUID()}`;
    await db.insert(user).values({
      id: otherOwnerId,
      name: "Other Owner",
      email: `${otherOwnerId}@example.test`,
    });

    await makeServiceRuleDefault(ownerId, {
      category: "rifle",
      name: "Barrel",
    });
    // Same (scope, category, name) for a different owner is fine — the
    // unique constraint is scoped by owner_id.
    const other = await makeServiceRuleDefault(otherOwnerId, {
      category: "rifle",
      name: "Barrel",
    });
    expect(other.ownerId).toBe(otherOwnerId);

    await db.delete(user).where(eq(user.id, otherOwnerId));
  });

  test("two service_rule_default rows with the same (owner, scope, category, name) are rejected", async () => {
    await makeServiceRuleDefault(ownerId, {
      category: "pistol",
      name: "Cleaning",
    });
    await expectRejects(() =>
      db.insert(serviceRuleDefault).values({
        ownerId,
        scope: "firearm",
        category: "pistol",
        name: "Cleaning",
        intervalDays: 30,
      }),
    );
  });
});
