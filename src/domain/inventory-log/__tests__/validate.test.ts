import { describe, expect, test } from "bun:test";
import { MAX_COUNT } from "@/src/domain/ammo/validate";
import { type LogEntryInput, validateLogEntry } from "../validate";

const base: LogEntryInput = {
  parentType: "firearm",
  parentId: "f1",
  eventType: "inventoried",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("validateLogEntry", () => {
  test("firearm accepts inventoried", () => {
    expect(validateLogEntry({ ...base, eventType: "inventoried" })).toEqual([]);
  });

  test("magazine accepts inventoried", () => {
    expect(
      validateLogEntry({
        ...base,
        parentType: "magazine",
        eventType: "inventoried",
      }),
    ).toEqual([]);
  });

  // Covers R13/KTD1/KTD7 (service-intervals plan, U5): cleaned/lubed are
  // retired firearm event types, converted to service events. Neither parent
  // family accepts them any more.
  test("firearm and magazine both reject cleaned and lubed (retired, U5)", () => {
    for (const eventType of ["cleaned", "lubed"]) {
      expect(validateLogEntry({ ...base, eventType })).toContain(
        "invalidEventType",
      );
      expect(
        validateLogEntry({ ...base, parentType: "magazine", eventType }),
      ).toContain("invalidEventType");
    }
  });

  test("an invalid parentType is rejected", () => {
    expect(
      validateLogEntry({
        // @ts-expect-error intentionally invalid at the domain boundary
        parentType: "not-a-real-parent",
        parentId: base.parentId,
        eventType: base.eventType,
        occurredAt: base.occurredAt,
      }),
    ).toEqual(["invalidParentType"]);
  });

  // Ammo joined the log in #100 (reconciliation). An ammo entry must carry the
  // counted rounds (R2); accessory is still not a log parent.
  test("ammo accepts inventoried with countedRounds (#100, R1/R2)", () => {
    expect(
      validateLogEntry({ ...base, parentType: "ammo", countedRounds: 480 }),
    ).toEqual([]);
  });

  test("ammo without countedRounds is rejected (R2)", () => {
    expect(validateLogEntry({ ...base, parentType: "ammo" })).toEqual([
      "countedRoundsRequired",
    ]);
  });

  test("countedRounds accepts 0 and MAX_COUNT, rejects negative, fractional, NaN, and over-max (R2)", () => {
    const ammo = { ...base, parentType: "ammo" as const };
    expect(validateLogEntry({ ...ammo, countedRounds: 0 })).toEqual([]);
    expect(validateLogEntry({ ...ammo, countedRounds: MAX_COUNT })).toEqual([]);
    expect(validateLogEntry({ ...ammo, countedRounds: -1 })).toEqual([
      "negativeCountedRounds",
    ]);
    expect(validateLogEntry({ ...ammo, countedRounds: 1.5 })).toEqual([
      "invalidCountedRounds",
    ]);
    expect(validateLogEntry({ ...ammo, countedRounds: Number.NaN })).toEqual([
      "invalidCountedRounds",
    ]);
    expect(validateLogEntry({ ...ammo, countedRounds: MAX_COUNT + 1 })).toEqual(
      ["invalidCountedRounds"],
    );
  });

  // Covers AE10: a firearm or magazine entry cannot smuggle a count.
  test("countedRounds on a firearm or magazine entry is rejected (AE10)", () => {
    expect(validateLogEntry({ ...base, countedRounds: 10 })).toEqual([
      "countedRoundsNotAllowed",
    ]);
    expect(
      validateLogEntry({ ...base, parentType: "magazine", countedRounds: 10 }),
    ).toEqual(["countedRoundsNotAllowed"]);
  });

  test("accessory is a valid ParentType but not a log parent", () => {
    expect(validateLogEntry({ ...base, parentType: "accessory" })).toEqual([
      "invalidParentType",
    ]);
  });

  test("ammo rejects a retired or unknown event type", () => {
    expect(
      validateLogEntry({
        ...base,
        parentType: "ammo",
        eventType: "cleaned",
        countedRounds: 1,
      }),
    ).toEqual(["invalidEventType"]);
  });

  test("a valid parentType does not trigger invalidParentType", () => {
    expect(validateLogEntry(base)).not.toContain("invalidParentType");
    expect(validateLogEntry({ ...base, parentType: "magazine" })).not.toContain(
      "invalidParentType",
    );
  });

  test("unknown event type is rejected for both parents", () => {
    expect(
      validateLogEntry({ ...base, eventType: "not-a-real-event" }),
    ).toContain("invalidEventType");
    expect(
      validateLogEntry({
        ...base,
        parentType: "magazine",
        eventType: "not-a-real-event",
      }),
    ).toContain("invalidEventType");
  });

  test("past occurredAt passes", () => {
    expect(
      validateLogEntry({
        ...base,
        occurredAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  test("occurredAt of now passes", () => {
    expect(validateLogEntry({ ...base, occurredAt: new Date() })).toEqual([]);
  });

  test("future occurredAt is rejected", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(validateLogEntry({ ...base, occurredAt: future })).toContain(
      "occurredAtInFuture",
    );
  });

  test("accepts occurredAt as an ISO string too", () => {
    expect(
      validateLogEntry({ ...base, occurredAt: "2026-01-01T00:00:00.000Z" }),
    ).toEqual([]);
  });

  test("rejects an unparseable occurredAt", () => {
    expect(validateLogEntry({ ...base, occurredAt: "not-a-date" })).toContain(
      "invalidOccurredAt",
    );
  });

  test("empty or omitted notes pass", () => {
    expect(validateLogEntry({ ...base, notes: "" })).toEqual([]);
    expect(validateLogEntry({ ...base, notes: undefined })).toEqual([]);
    const { notes: _notes, ...withoutNotes } = { ...base, notes: "x" };
    expect(validateLogEntry(withoutNotes)).toEqual([]);
  });

  test("a whitespace-only note is accepted as empty-not-null", () => {
    expect(validateLogEntry({ ...base, notes: "   " })).toEqual([]);
  });

  test("returns multiple codes together, not first-only", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const codes = validateLogEntry({
      ...base,
      eventType: "not-a-real-event",
      occurredAt: future,
    });
    expect(codes).toContain("invalidEventType");
    expect(codes).toContain("occurredAtInFuture");
  });
});
