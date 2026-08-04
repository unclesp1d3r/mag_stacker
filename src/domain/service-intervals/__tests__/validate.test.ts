import { describe, expect, test } from "bun:test";
import { type ServiceRuleInput, validateServiceRuleSet } from "../validate";

// Pure validator — no DB (U2). Returns EVERY applicable failure code together,
// matching the shape of `validateLogEntry` / `validateMagazine`.
describe("validateServiceRuleSet", () => {
  test("accepts a valid rule with a single threshold set", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalRounds: 500 },
    ];
    expect(validateServiceRuleSet(rules)).toEqual([]);
  });

  test("rejects an empty rule name", () => {
    const rules: ServiceRuleInput[] = [{ name: "", intervalDays: 30 }];
    expect(validateServiceRuleSet(rules)).toContain("emptyName");
  });

  test("rejects a whitespace-only rule name", () => {
    const rules: ServiceRuleInput[] = [{ name: "   ", intervalDays: 30 }];
    expect(validateServiceRuleSet(rules)).toContain("emptyName");
  });

  test("rejects a duplicate name within one submitted set", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalRounds: 500 },
      { name: "Cleaning", intervalDays: 90 },
    ];
    expect(validateServiceRuleSet(rules)).toContain("duplicateName");
  });

  test("accepts the same name across two separate validation calls (only one submitted set)", () => {
    const first = validateServiceRuleSet([
      { name: "Cleaning", intervalRounds: 500 },
    ]);
    const second = validateServiceRuleSet([
      { name: "Cleaning", intervalDays: 90 },
    ]);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  test("rejects a zero threshold", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning", intervalRounds: 0 }];
    expect(validateServiceRuleSet(rules)).toContain("thresholdTooLow");
  });

  test("rejects a negative threshold", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning", intervalDays: -1 }];
    expect(validateServiceRuleSet(rules)).toContain("thresholdTooLow");
  });

  // The form's `toRuleInput` converts threshold strings with `Number()`, not
  // `Number.parseInt` — a value like "1.5" becomes 1.5, which would otherwise
  // pass the below-minimum check (1.5 < 1 is false) and later fail as an
  // unhandled driver error against the integer DB columns.
  test("rejects a fractional threshold", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalRounds: 1.5 },
    ];
    expect(validateServiceRuleSet(rules)).toContain("thresholdTooLow");
  });

  test("rejects a NaN threshold", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalRounds: Number.NaN },
    ];
    expect(validateServiceRuleSet(rules)).toContain("thresholdTooLow");
  });

  test("accepts a rule whose only threshold is intervalSessions", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalSessions: 5 },
    ];
    expect(validateServiceRuleSet(rules)).toEqual([]);
  });

  test("rejects a zero intervalSessions threshold", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", intervalSessions: 0 },
    ];
    expect(validateServiceRuleSet(rules)).toContain("thresholdTooLow");
  });

  test("rejects a rule with no threshold set and not suppressed", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning" }];
    expect(validateServiceRuleSet(rules)).toContain("missingThreshold");
  });

  test("accepts a suppressed rule with no threshold set", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning", suppressed: true }];
    expect(validateServiceRuleSet(rules)).toEqual([]);
  });

  // F7: suppression and thresholds are mutually exclusive on one row (KTD6).
  // A caller submitting both together is a bug — reject it explicitly rather
  // than silently discarding the submitted thresholds.
  test("F7: rejects a suppressed rule that also sets a threshold", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", suppressed: true, intervalRounds: 500 },
    ];
    expect(validateServiceRuleSet(rules)).toEqual(["suppressedWithThresholds"]);
  });

  test("F7: a suppressed rule with a threshold does NOT also raise missingThreshold", () => {
    const rules: ServiceRuleInput[] = [
      { name: "Cleaning", suppressed: true, intervalDays: 30 },
    ];
    const codes = validateServiceRuleSet(rules);
    expect(codes).toContain("suppressedWithThresholds");
    expect(codes).not.toContain("missingThreshold");
  });

  test("returns every applicable code together in one call", () => {
    const rules: ServiceRuleInput[] = [
      { name: "", intervalRounds: 500 },
      { name: "   ", intervalDays: 30 },
      { name: "Cleaning", intervalRounds: 500 },
      { name: "Cleaning", intervalDays: 90 },
      { name: "Barrel", intervalRounds: 0 },
      { name: "Spring", intervalDays: -5 },
      { name: "NoThreshold" },
    ];
    const codes = validateServiceRuleSet(rules);
    expect(codes).toContain("emptyName");
    expect(codes).toContain("duplicateName");
    expect(codes).toContain("thresholdTooLow");
    expect(codes).toContain("missingThreshold");
  });
});
