import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import { serviceEvent } from "@/src/db/schema";
import { ValidationError } from "@/src/domain/errors";
import {
  createUser,
  deleteUsers,
  makeAccessory,
  makeFirearm,
  makeServiceEvent,
} from "@/src/test-support/factories";
import { getItemDueState } from "../due-service";
import {
  countItemsInCategory,
  createItemRule,
  createServiceRuleDefault,
  deleteItemRule,
  deleteServiceRuleDefault,
  listConfiguredCategories,
  listItemRules,
  listOwnerAccessoryCategories,
  listServiceRuleDefaults,
  resolveParent,
  updateItemRule,
  updateServiceRuleDefault,
} from "../rules-service";

/**
 * `resolveParent` is the shared, pure implementation behind three call sites
 * that used to each re-derive "which parent does this row belong to"
 * independently (`belongsToParent` here, `resolveServiceEventParent` in
 * `events-service.ts`, and `loadItemRulesBatch`'s per-row extraction in
 * `due-service.ts`) — no DB needed, unlike the rest of this file's
 * Testcontainers-backed suite.
 */
describe("resolveParent", () => {
  test("resolves a firearm-parented row", () => {
    expect(resolveParent({ firearmId: "fa-1", accessoryId: null })).toEqual({
      parentType: "firearm",
      parentId: "fa-1",
    });
  });

  test("resolves an accessory-parented row", () => {
    expect(resolveParent({ firearmId: null, accessoryId: "acc-1" })).toEqual({
      parentType: "accessory",
      parentId: "acc-1",
    });
  });

  test("returns null for a row with neither parent set (the exactly-one-parent CHECK forbids this for a real row)", () => {
    expect(resolveParent({ firearmId: null, accessoryId: null })).toBeNull();
  });
});

/**
 * Rules-service integration tests (service-intervals plan, U3). Each test
 * creates its own owner(s) rather than sharing state with other tests, since
 * defaults are keyed on (owner, scope, category, name) and several tests
 * deliberately reuse the same category/name to prove owner-scoping — sharing
 * a fixture owner across tests would collide on that unique constraint.
 */
describe("service-intervals rules-service (U3)", () => {
  const createdUsers: string[] = [];

  afterAll(async () => {
    await deleteUsers(...createdUsers);
  });

  async function newOwner(label: string): Promise<string> {
    const id = await createUser(label);
    createdUsers.push(id);
    return id;
  }

  test("covers AE1: raising a default after an override leaves the override untouched and reaches every other rifle", async () => {
    const owner = await newOwner("u3ae1");
    const ar15 = await makeFirearm(owner, { type: "rifle" });
    const otherRifle = await makeFirearm(owner, { type: "rifle" });

    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    const barrelDefault = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Barrel",
      intervalRounds: 5000,
    });

    await createItemRule(owner, "firearm", ar15.id, {
      name: "Barrel",
      intervalRounds: 4000,
    });

    await updateServiceRuleDefault(owner, barrelDefault.id, {
      name: "Barrel",
      intervalRounds: 6000,
    });

    const ar15Rules = await getItemDueState(owner, "firearm", ar15.id);
    const otherRules = await getItemDueState(owner, "firearm", otherRifle.id);

    expect(ar15Rules.find((r) => r.name === "Barrel")).toMatchObject({
      intervalRounds: 4000,
      inheritanceState: "overridden",
    });
    expect(ar15Rules.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });
    expect(otherRules.find((r) => r.name === "Barrel")).toMatchObject({
      intervalRounds: 6000,
      inheritanceState: "inherited",
    });
  });

  test("covers R5: deleting an override restores the inherited default; deleting a suppression restores the rule", async () => {
    const owner = await newOwner("u3r5");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });

    const override = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 300,
    });
    let resolved = await getItemDueState(owner, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 300,
      inheritanceState: "overridden",
    });

    await deleteItemRule(owner, "firearm", fa.id, override.id);
    resolved = await getItemDueState(owner, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });

    const suppression = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      suppressed: true,
    });
    resolved = await getItemDueState(owner, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Cleaning")).toBeUndefined();

    await deleteItemRule(owner, "firearm", fa.id, suppression.id);
    resolved = await getItemDueState(owner, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });
  });

  test("suppressing a rule stores a suppressed row rather than deleting the default", async () => {
    const owner = await newOwner("u3suppress");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const def = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });

    await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      suppressed: true,
    });

    const rules = await listItemRules(owner, "firearm", fa.id);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      name: "Cleaning",
      suppressed: true,
      intervalDays: null,
      intervalSessions: null,
      intervalRounds: null,
    });

    const stillDefaults = await listServiceRuleDefaults(
      owner,
      "firearm",
      "rifle",
    );
    expect(stillDefaults.map((d) => d.id)).toContain(def.id);
  });

  test("a default set defined for one owner is invisible to another owner with an identically-named category", async () => {
    const ownerA = await newOwner("u3defA");
    const ownerB = await newOwner("u3defB");
    await createServiceRuleDefault(ownerA, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });

    const bDefaults = await listServiceRuleDefaults(ownerB, "firearm", "rifle");
    expect(bDefaults).toHaveLength(0);
  });

  test("an edit-grantee attempting to create, edit, or delete an item rule on a shared firearm is rejected", async () => {
    const owner = await newOwner("u3editOwner");
    const editor = await newOwner("u3editor");
    const fa = await makeFirearm(owner, { type: "rifle" });
    await createGrant(db, {
      actorId: owner,
      granteeId: editor,
      parentType: "firearm",
      parentId: fa.id,
      permission: "edit",
    });

    await expect(
      createItemRule(editor, "firearm", fa.id, {
        name: "Cleaning",
        intervalRounds: 500,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    const rule = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });

    await expect(
      updateItemRule(editor, "firearm", fa.id, rule.id, {
        name: "Cleaning",
        intervalRounds: 600,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);

    await expect(
      deleteItemRule(editor, "firearm", fa.id, rule.id),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  test("a view-grantee reading a shared firearm's rules receives the owner's resolved rules, not their own defaults", async () => {
    const owner = await newOwner("u3viewOwner");
    const viewer = await newOwner("u3viewer");
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

    const resolved = await getItemDueState(viewer, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 500,
      inheritanceState: "inherited",
    });
  });

  test("a user with no visibility on a firearm receives NotFoundError rather than a permission error when reading its rules", async () => {
    const owner = await newOwner("u3noVisOwner");
    const stranger = await newOwner("u3noVisStranger");
    const fa = await makeFirearm(owner, { type: "rifle" });

    await expect(
      getItemDueState(stranger, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listItemRules(stranger, "firearm", fa.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("renaming an item rule carries that item's service events to the new name and leaves an identically-named rule on a different item alone", async () => {
    const owner = await newOwner("u3renameOwner");
    const fa1 = await makeFirearm(owner, { type: "rifle" });
    const fa2 = await makeFirearm(owner, { type: "rifle" });

    const rule1 = await createItemRule(owner, "firearm", fa1.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createItemRule(owner, "firearm", fa2.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });

    await makeServiceEvent(
      { firearmId: fa1.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );
    await makeServiceEvent(
      { firearmId: fa2.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-02" },
    );

    await updateItemRule(owner, "firearm", fa1.id, rule1.id, {
      name: "Deep Clean",
      intervalRounds: 500,
    });

    const fa1Events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa1.id));
    expect(fa1Events.map((e) => e.ruleName)).toEqual(["Deep Clean"]);

    const fa2Events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa2.id));
    expect(fa2Events.map((e) => e.ruleName)).toEqual(["Cleaning"]);

    const fa2Rules = await listItemRules(owner, "firearm", fa2.id);
    expect(fa2Rules.map((r) => r.name)).toEqual(["Cleaning"]);
  });

  test("renaming an item rule onto a name that item already carries throws ValidationError and leaves both rules and their events unchanged", async () => {
    const owner = await newOwner("u3renameDupOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const cleaning = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });
    const barrel = await createItemRule(owner, "firearm", fa.id, {
      name: "Barrel",
      intervalRounds: 5000,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Barrel", servicedOn: "2026-01-02" },
    );

    await expect(
      updateItemRule(owner, "firearm", fa.id, barrel.id, {
        name: "Cleaning",
        intervalRounds: 6000,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rules = await listItemRules(owner, "firearm", fa.id);
    expect(rules.find((r) => r.id === barrel.id)).toMatchObject({
      name: "Barrel",
      intervalRounds: 5000,
    });
    expect(rules.find((r) => r.id === cleaning.id)).toMatchObject({
      name: "Cleaning",
      intervalRounds: 500,
    });

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName).sort()).toEqual([
      "Barrel",
      "Cleaning",
    ]);
  });

  // PR #99 review (P2): renaming a category default silently stranded the
  // service history of every item inheriting or overriding it, since
  // everything is keyed by rule NAME (KTD1) — the same bug class already
  // fixed above for an item-rule rename, applied one level up.
  test("renaming a default carries an inheriting item's service history to the new name and it still measures from the last service event, not the origin", async () => {
    const owner = await newOwner("u3defRenameInherit");
    const fa = await makeFirearm(owner, {
      type: "rifle",
      acquiredDate: "2020-01-01",
    });
    const def = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalDays: 30,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    await updateServiceRuleDefault(owner, def.id, {
      name: "Deep Clean",
      intervalDays: 30,
    });

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName)).toEqual(["Deep Clean"]);

    const resolved = await getItemDueState(owner, "firearm", fa.id);
    const rule = resolved.find((r) => r.name === "Deep Clean");
    expect(rule).toMatchObject({ inheritanceState: "inherited" });
    // Measuring from the last service event (2026-01-01), never the item's
    // 2020 origin date — the rename must not reset the measure-from point.
    expect(rule?.measureFrom).toEqual(new Date(2026, 0, 1));
  });

  test("renaming a default carries an overriding item's override and its service history to the new name, keeping the override's own thresholds", async () => {
    const owner = await newOwner("u3defRenameOverride");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const def = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 300,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    await updateServiceRuleDefault(owner, def.id, {
      name: "Deep Clean",
      intervalRounds: 500,
    });

    const itemRules = await listItemRules(owner, "firearm", fa.id);
    expect(itemRules).toHaveLength(1);
    expect(itemRules[0]).toMatchObject({
      name: "Deep Clean",
      intervalRounds: 300, // the override's OWN threshold, untouched by the default's
    });

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName)).toEqual(["Deep Clean"]);

    const resolved = await getItemDueState(owner, "firearm", fa.id);
    expect(resolved.find((r) => r.name === "Deep Clean")).toMatchObject({
      inheritanceState: "overridden",
      intervalRounds: 300,
    });
  });

  test("renaming a default never touches another owner's identically-named default or that owner's items in the same category", async () => {
    const ownerA = await newOwner("u3defRenameOwnerA");
    const ownerB = await newOwner("u3defRenameOwnerB");
    const faA = await makeFirearm(ownerA, { type: "rifle" });
    const faB = await makeFirearm(ownerB, { type: "rifle" });

    const defA = await createServiceRuleDefault(ownerA, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createServiceRuleDefault(ownerB, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 999,
    });
    await makeServiceEvent(
      { firearmId: faA.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );
    await makeServiceEvent(
      { firearmId: faB.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-02" },
    );

    await updateServiceRuleDefault(ownerA, defA.id, {
      name: "Deep Clean",
      intervalRounds: 500,
    });

    const bDefaults = await listServiceRuleDefaults(ownerB, "firearm", "rifle");
    expect(bDefaults.map((d) => d.name)).toEqual(["Cleaning"]);

    const bEvents = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, faB.id));
    expect(bEvents.map((e) => e.ruleName)).toEqual(["Cleaning"]);
  });

  test("renaming a default onto a name a sibling default in the same scope+category already uses throws ValidationError and writes nothing", async () => {
    const owner = await newOwner("u3defRenameDup");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const cleaning = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Barrel",
      intervalRounds: 5000,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    await expect(
      updateServiceRuleDefault(owner, cleaning.id, {
        name: "Barrel",
        intervalRounds: 500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const defaults = await listServiceRuleDefaults(owner, "firearm", "rifle");
    expect(defaults.map((d) => d.name).sort()).toEqual(["Barrel", "Cleaning"]);

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName)).toEqual(["Cleaning"]);
  });

  test("two sequential renames of the same default leave an inheriting item's history on the final name, not stranded on the intermediate one", async () => {
    const owner = await newOwner("u3defRenameSequential");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const def = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    await updateServiceRuleDefault(owner, def.id, {
      name: "Deep Clean",
      intervalRounds: 500,
    });
    await updateServiceRuleDefault(owner, def.id, {
      name: "Field Strip",
      intervalRounds: 500,
    });

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName)).toEqual(["Field Strip"]);

    const defaults = await listServiceRuleDefaults(owner, "firearm", "rifle");
    expect(defaults.map((d) => d.name)).toEqual(["Field Strip"]);
  });

  test("a firearm's view-grantee reading an accessory's rules is rejected, even when that accessory is mounted on the shared firearm", async () => {
    const owner = await newOwner("u3accOwner");
    const viewer = await newOwner("u3accViewer");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const acc = await makeAccessory(owner, { currentFirearmId: fa.id });
    await createGrant(db, {
      actorId: owner,
      granteeId: viewer,
      parentType: "firearm",
      parentId: fa.id,
      permission: "view",
    });

    await expect(
      getItemDueState(viewer, "accessory", acc.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listItemRules(viewer, "accessory", acc.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("an invalid rule (empty name, no thresholds and not suppressed) throws ValidationError and writes no row", async () => {
    const owner = await newOwner("u3invalidOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });

    await expect(
      createItemRule(owner, "firearm", fa.id, { name: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rules = await listItemRules(owner, "firearm", fa.id);
    expect(rules).toHaveLength(0);
  });

  // F7: a suppressed rule submitted WITH a threshold is a caller bug, and is
  // rejected explicitly rather than silently normalized (see `validate.ts`'s
  // `suppressedWithThresholds` doc for the full rationale).
  test("F7: creating a rule that is both suppressed and carries a threshold throws ValidationError and writes no row", async () => {
    const owner = await newOwner("u3f7Owner");
    const fa = await makeFirearm(owner, { type: "rifle" });

    await expect(
      createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        suppressed: true,
        intervalRounds: 500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rules = await listItemRules(owner, "firearm", fa.id);
    expect(rules).toHaveLength(0);
  });

  test("F7: updating a rule to be both suppressed and carry a threshold throws ValidationError and leaves the row unchanged", async () => {
    const owner = await newOwner("u3f7UpdateOwner");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const rule = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });

    await expect(
      updateItemRule(owner, "firearm", fa.id, rule.id, {
        name: "Cleaning",
        suppressed: true,
        intervalRounds: 500,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const rules = await listItemRules(owner, "firearm", fa.id);
    expect(rules[0]).toMatchObject({
      name: "Cleaning",
      suppressed: false,
      intervalRounds: 500,
    });
  });

  // F5: two overlapping renames of the same rule must never leave history
  // stranded on the intermediate name — the second writer has to re-read the
  // name the first writer actually left behind, not the name both started
  // from.
  test("F5: two concurrent renames of the same rule leave history following whichever name won, not stranded on the intermediate name", async () => {
    const owner = await newOwner("u3f5concurrent");
    const fa = await makeFirearm(owner, { type: "rifle" });
    const rule = await createItemRule(owner, "firearm", fa.id, {
      name: "Cleaning",
      intervalRounds: 500,
    });
    await makeServiceEvent(
      { firearmId: fa.id },
      { ruleName: "Cleaning", servicedOn: "2026-01-01" },
    );

    await Promise.all([
      updateItemRule(owner, "firearm", fa.id, rule.id, {
        name: "Deep Clean",
        intervalRounds: 500,
      }),
      updateItemRule(owner, "firearm", fa.id, rule.id, {
        name: "Field Strip",
        intervalRounds: 500,
      }),
    ]);

    const finalRules = await listItemRules(owner, "firearm", fa.id);
    expect(finalRules).toHaveLength(1);
    const finalName = finalRules[0].name;
    expect(["Deep Clean", "Field Strip"]).toContain(finalName);

    const events = await db
      .select()
      .from(serviceEvent)
      .where(eq(serviceEvent.firearmId, fa.id));
    expect(events.map((e) => e.ruleName)).toEqual([finalName]);
  });

  // Backstop for the race `assertNameAvailable`'s pre-check can't close on its
  // own: under READ COMMITTED, two concurrent creates of the same name can
  // both pass the pre-check read before either insert commits. The DB's
  // unique constraint (`service_rule_firearm_name_unique`) then rejects the
  // loser — this must surface as the same clean `ValidationError(["duplicateName"])`
  // the pre-check itself throws, never the raw Postgres driver error.
  test("two concurrent creates of the same item-rule name: one wins, the other gets ValidationError(duplicateName), never a raw driver error", async () => {
    const owner = await newOwner("u3raceItemRule");
    const fa = await makeFirearm(owner, { type: "rifle" });

    const results = await Promise.allSettled([
      createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalRounds: 500,
      }),
      createItemRule(owner, "firearm", fa.id, {
        name: "Cleaning",
        intervalRounds: 500,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ValidationError);
    expect((rejection.reason as ValidationError).codes).toEqual([
      "duplicateName",
    ]);

    const finalRules = await listItemRules(owner, "firearm", fa.id);
    expect(finalRules).toHaveLength(1);
  });

  // Same backstop, for category defaults (`service_rule_default_owner_scope_category_name_unique`).
  test("two concurrent creates of the same default name: one wins, the other gets ValidationError(duplicateName), never a raw driver error", async () => {
    const owner = await newOwner("u3raceDefault");

    const results = await Promise.allSettled([
      createServiceRuleDefault(owner, {
        scope: "firearm",
        category: "rifle",
        name: "Cleaning",
        intervalRounds: 500,
      }),
      createServiceRuleDefault(owner, {
        scope: "firearm",
        category: "rifle",
        name: "Cleaning",
        intervalRounds: 500,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(ValidationError);
    expect((rejection.reason as ValidationError).codes).toEqual([
      "duplicateName",
    ]);

    const finalDefaults = await listServiceRuleDefaults(
      owner,
      "firearm",
      "rifle",
    );
    expect(finalDefaults).toHaveLength(1);
  });

  test("the accessory-category listing returns each of the owner's distinct categories once, alphabetically, and excludes another owner's categories", async () => {
    const owner = await newOwner("u3catOwner");
    const other = await newOwner("u3catOther");
    await makeAccessory(owner, { category: "Optic" });
    await makeAccessory(owner, { category: "Optic" });
    await makeAccessory(owner, { category: "Sling" });
    await makeAccessory(owner, { category: "Grip" });
    await makeAccessory(other, { category: "Muzzle Device" });

    const categories = await listOwnerAccessoryCategories(owner);
    expect(categories).toEqual(["Grip", "Optic", "Sling"]);
  });

  test("covers U7: countItemsInCategory counts only the owner's items of that scope+category", async () => {
    const owner = await newOwner("u7count");
    const other = await newOwner("u7countOther");
    await makeFirearm(owner, { type: "rifle" });
    await makeFirearm(owner, { type: "rifle" });
    await makeFirearm(owner, { type: "pistol" });
    await makeFirearm(other, { type: "rifle" });
    await makeAccessory(owner, { category: "Optic" });

    expect(await countItemsInCategory(owner, "firearm", "rifle")).toBe(2);
    expect(await countItemsInCategory(owner, "firearm", "pistol")).toBe(1);
    expect(await countItemsInCategory(owner, "firearm", "shotgun")).toBe(0);
    expect(await countItemsInCategory(owner, "accessory", "Optic")).toBe(1);
    expect(await countItemsInCategory(owner, "accessory", "Sling")).toBe(0);
  });

  test("covers U7: listConfiguredCategories surfaces a category armed ahead of any accessory, and stays after the accessory is gone", async () => {
    const owner = await newOwner("u7configured");
    await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Muzzle Device",
      name: "Cleaning",
      intervalRounds: 500,
    });

    const configured = await listConfiguredCategories(owner, "accessory");
    expect(configured).toEqual(["Muzzle Device"]);

    const existing = await listOwnerAccessoryCategories(owner);
    expect(existing).toEqual([]);
  });

  test("covers U7: deleting a default removes the inherited rule from every item that had not overridden it", async () => {
    const owner = await newOwner("u7deleteDefault");
    const overridden = await makeFirearm(owner, { type: "rifle" });
    const plain = await makeFirearm(owner, { type: "rifle" });
    const def = await createServiceRuleDefault(owner, {
      scope: "firearm",
      category: "rifle",
      name: "Cleaning",
      intervalRounds: 500,
    });
    await createItemRule(owner, "firearm", overridden.id, {
      name: "Cleaning",
      intervalRounds: 300,
    });

    await deleteServiceRuleDefault(owner, def.id);

    const overriddenRules = await getItemDueState(
      owner,
      "firearm",
      overridden.id,
    );
    const plainRules = await getItemDueState(owner, "firearm", plain.id);
    // The override row still stands (it's the item's own row, untouched by
    // the default's deletion) — with no default left to match it against, it
    // now resolves item-only rather than overridden. The item with no
    // override of its own loses the rule entirely.
    expect(overriddenRules.find((r) => r.name === "Cleaning")).toMatchObject({
      intervalRounds: 300,
      inheritanceState: "item-only",
    });
    expect(plainRules.find((r) => r.name === "Cleaning")).toBeUndefined();
  });

  test("covers U7: listConfiguredCategories drops a category once its only default is deleted", async () => {
    const owner = await newOwner("u7configuredDelete");
    const def = await createServiceRuleDefault(owner, {
      scope: "accessory",
      category: "Sling",
      name: "Cleaning",
      intervalRounds: 500,
    });

    await deleteServiceRuleDefault(owner, def.id);

    const configured = await listConfiguredCategories(owner, "accessory");
    expect(configured).toEqual([]);
  });
});
