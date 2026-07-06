import { describe, expect, test } from "bun:test";
import { type LogEntryInput, validateLogEntry } from "../validate";

const base: LogEntryInput = {
  parentType: "firearm",
  parentId: "f1",
  eventType: "inventoried",
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("validateLogEntry", () => {
  test("firearm accepts inventoried, cleaned, and lubed", () => {
    for (const eventType of ["inventoried", "cleaned", "lubed"]) {
      expect(validateLogEntry({ ...base, eventType })).toEqual([]);
    }
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

  test("magazine rejects cleaned and lubed", () => {
    for (const eventType of ["cleaned", "lubed"]) {
      expect(
        validateLogEntry({ ...base, parentType: "magazine", eventType }),
      ).toContain("invalidEventType");
    }
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
