import { describe, expect, test } from "bun:test";
import {
  type ServiceEventInput,
  validateServicedOn,
  validateServiceEventInput,
} from "../validate-event";

/**
 * Pure validator tests (F8: `validate-event.ts` had no test file at all).
 * Mirrors `firearms/__tests__/validate.test.ts`'s style. Date fixtures are
 * always built with local Y/M/D components (`new Date(y, monthIndex, d)`),
 * never UTC `...Z` literals, per KTD5 — this file is run under UTC,
 * TZ=Asia/Tokyo, and TZ=America/New_York.
 */
function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe("validateServicedOn", () => {
  test("an empty string returns emptyServicedOn", () => {
    expect(validateServicedOn("")).toEqual(["emptyServicedOn"]);
  });

  test("a whitespace-only string is treated as empty", () => {
    expect(validateServicedOn("   ")).toEqual(["emptyServicedOn"]);
  });

  test.each(["not-a-date", "2026-13-01", "2026-02-30"])(
    "%s is not a real calendar date and returns invalidServicedOn",
    (value) => {
      const asOf = localDate(2026, 5, 15);
      expect(validateServicedOn(value, asOf)).toEqual(["invalidServicedOn"]);
    },
  );

  test("a real calendar date on or before asOf is valid", () => {
    const asOf = localDate(2026, 5, 15);
    expect(validateServicedOn("2026-06-15", asOf)).toEqual([]);
    expect(validateServicedOn("2026-06-01", asOf)).toEqual([]);
  });

  // F1: asOf defaults to the SERVER's clock, not the submitter's — a
  // submitter's local calendar day can genuinely run up to one day ahead of
  // it (no real timezone is more than ~26 hours ahead of another), so a
  // one-day tolerance is required before a submitted date is treated as
  // genuinely in the future.
  describe("F1: one-day future tolerance", () => {
    test("the server's own today is accepted", () => {
      const asOf = localDate(2026, 5, 15);
      expect(validateServicedOn("2026-06-15", asOf)).toEqual([]);
    });

    test("one day after the server's today is accepted (the timezone-ahead submitter case)", () => {
      const asOf = localDate(2026, 5, 15);
      expect(validateServicedOn("2026-06-16", asOf)).toEqual([]);
    });

    test("two days after the server's today is rejected as genuinely in the future", () => {
      const asOf = localDate(2026, 5, 15);
      expect(validateServicedOn("2026-06-17", asOf)).toEqual([
        "servicedOnInFuture",
      ]);
    });

    test("many days after the server's today is rejected", () => {
      const asOf = localDate(2026, 5, 15);
      expect(validateServicedOn("2026-07-01", asOf)).toEqual([
        "servicedOnInFuture",
      ]);
    });
  });
});

describe("validateServiceEventInput", () => {
  const asOf = localDate(2026, 5, 15);

  test("a valid rule name and date pass with no codes", () => {
    const input: ServiceEventInput = {
      ruleName: "Cleaning",
      servicedOn: "2026-06-01",
    };
    expect(validateServiceEventInput(input, asOf)).toEqual([]);
  });

  test("an empty rule name returns emptyRuleName", () => {
    const input: ServiceEventInput = { ruleName: "", servicedOn: "2026-06-01" };
    expect(validateServiceEventInput(input, asOf)).toEqual(["emptyRuleName"]);
  });

  test("a whitespace-only rule name is treated as empty", () => {
    const input: ServiceEventInput = {
      ruleName: "   ",
      servicedOn: "2026-06-01",
    };
    expect(validateServiceEventInput(input, asOf)).toEqual(["emptyRuleName"]);
  });

  test("an empty rule name and an empty date combine, not short-circuit", () => {
    const input: ServiceEventInput = { ruleName: "", servicedOn: "" };
    expect(validateServiceEventInput(input, asOf)).toEqual([
      "emptyRuleName",
      "emptyServicedOn",
    ]);
  });

  test("a future date more than the one-day tolerance combines with a valid rule name into just servicedOnInFuture", () => {
    const input: ServiceEventInput = {
      ruleName: "Cleaning",
      servicedOn: "2026-06-20",
    };
    expect(validateServiceEventInput(input, asOf)).toEqual([
      "servicedOnInFuture",
    ]);
  });
});
