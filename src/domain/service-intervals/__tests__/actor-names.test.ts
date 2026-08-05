import { describe, expect, test } from "bun:test";
import { UNKNOWN_ACTOR_LABEL, withActorNames } from "../actor-names";
import type { ServiceEventRow } from "../events-service";

/**
 * `withActorNames` unit tests (service-intervals plan). No fixture users are
 * created here on purpose — every case below constructs its own
 * `ServiceEventRow`-shaped object rather than persisting one, since
 * `withActorNames` only ever reads the fields on the row it's handed; the
 * lookup-miss case in particular needs an `actorId` that is well-formed but
 * matches no `user` row, which is simplest to model directly rather than by
 * creating and deleting a real account.
 */

function makeEvent(overrides: Partial<ServiceEventRow> = {}): ServiceEventRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    firearmId: "22222222-2222-2222-2222-222222222222",
    accessoryId: null,
    ruleName: "Cleaning",
    servicedOn: "2026-01-01",
    actorId: null,
    notes: "",
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

describe("service-intervals actor-names withActorNames", () => {
  test("a null actorId resolves to UNKNOWN_ACTOR_LABEL", async () => {
    const [entry] = await withActorNames([makeEvent({ actorId: null })]);
    expect(entry.actorName).toBe(UNKNOWN_ACTOR_LABEL);
  });

  test("a non-null actorId whose account no longer exists resolves to UNKNOWN_ACTOR_LABEL, never the raw id", async () => {
    const missingActorId = "99999999-9999-9999-9999-999999999999";
    const [entry] = await withActorNames([
      makeEvent({ actorId: missingActorId }),
    ]);
    expect(entry.actorName).toBe(UNKNOWN_ACTOR_LABEL);
    expect(entry.actorName).not.toBe(missingActorId);
  });
});
