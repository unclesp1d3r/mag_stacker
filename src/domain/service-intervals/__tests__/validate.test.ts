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

  test("rejects a rule with no threshold set and not suppressed", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning" }];
    expect(validateServiceRuleSet(rules)).toContain("missingThreshold");
  });

  test("accepts a suppressed rule with no threshold set", () => {
    const rules: ServiceRuleInput[] = [{ name: "Cleaning", suppressed: true }];
    expect(validateServiceRuleSet(rules)).toEqual([]);
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
