import { describe, expect, test } from "bun:test";
import { type RangeSessionInput, validateRangeSession } from "../validate";

const base: RangeSessionInput = {
  firearmId: "f1",
  date: "2026-01-01",
  roundsFired: 50,
};

describe("validateRangeSession", () => {
  test("accepts a valid session", () => {
    expect(validateRangeSession(base)).toEqual([]);
  });

  test("rejects rounds fired below 1, non-integer, or NaN", () => {
    for (const roundsFired of [0, -3, 2.5, Number.NaN]) {
      expect(validateRangeSession({ ...base, roundsFired })).toContain(
        "invalidRoundsFired",
      );
    }
    expect(validateRangeSession({ ...base, roundsFired: 1 })).toEqual([]);
    expect(validateRangeSession({ ...base, roundsFired: 250 })).toEqual([]);
  });

  test("flags empty or whitespace-only dates as emptyDate", () => {
    expect(validateRangeSession({ ...base, date: "" })).toContain("emptyDate");
    expect(validateRangeSession({ ...base, date: "   " })).toContain(
      "emptyDate",
    );
  });

  test("flags unparseable or out-of-range dates as invalidDate", () => {
    expect(validateRangeSession({ ...base, date: "not-a-date" })).toContain(
      "invalidDate",
    );
    expect(validateRangeSession({ ...base, date: "2026-13-40" })).toContain(
      "invalidDate",
    );
  });

  test("returns multiple codes together, not first-only", () => {
    const codes = validateRangeSession({ ...base, roundsFired: 0, date: "" });
    expect(codes).toContain("invalidRoundsFired");
    expect(codes).toContain("emptyDate");
  });
});
