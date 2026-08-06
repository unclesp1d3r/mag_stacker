import { describe, expect, test } from "bun:test";
import {
  accessoryDisplayName,
  costCentsToInputValue,
  formatCostCents,
  parseCostInputToCents,
} from "../display";

/**
 * `accessoryDisplayName` is the ONLY implementation of the accessory label
 * fallback — the accessories list, the accessory detail heading, and the
 * firearm detail page's mounted-accessories panel all route through it.
 *
 * That consolidation is the point: #23 relaxed `category` to optional, and a
 * second hand-written copy of this chain on the firearm page kept falling
 * through to an empty string, rendering a link with no accessible name. These
 * tests pin the fallback so the regression cannot come back through any of the
 * three surfaces.
 */
describe("accessoryDisplayName", () => {
  const base = { type: "suppressor", category: "", brand: "", model: "" };

  test("prefers brand + model when both are present", () => {
    expect(
      accessoryDisplayName({
        ...base,
        brand: "SilencerCo",
        model: "Omega 36M",
      }),
    ).toBe("SilencerCo Omega 36M");
  });

  test("uses whichever of brand or model is present alone", () => {
    expect(accessoryDisplayName({ ...base, brand: "SilencerCo" })).toBe(
      "SilencerCo",
    );
    expect(accessoryDisplayName({ ...base, model: "Omega 36M" })).toBe(
      "Omega 36M",
    );
  });

  test("falls back to category when brand and model are empty", () => {
    expect(accessoryDisplayName({ ...base, category: "red dot mount" })).toBe(
      "red dot mount",
    );
  });

  test("falls back to the TYPE LABEL when category is also empty (#23 R3)", () => {
    // The regression this exists to prevent: an accessory created with only a
    // type would otherwise render as "" — a link with no accessible name.
    expect(accessoryDisplayName(base)).toBe("Suppressor");
    expect(accessoryDisplayName({ ...base, type: "muzzle device" })).toBe(
      "Muzzle device",
    );
  });

  test("never returns an empty string for any valid accessory shape", () => {
    for (const type of ["suppressor", "optic", "light", "laser", "other"]) {
      expect(accessoryDisplayName({ ...base, type }).trim()).not.toBe("");
    }
  });

  test("whitespace-only brand/model/category do not win over the type label", () => {
    expect(
      accessoryDisplayName({
        ...base,
        brand: "   ",
        model: "  ",
        category: "   ",
      }),
    ).toBe("Suppressor");
  });

  test("an unknown stored type degrades to the raw value rather than empty", () => {
    // Defensive: a row written before a type was retired should still label.
    expect(accessoryDisplayName({ ...base, type: "bipod" })).toBe("bipod");
  });
});

describe("cost formatting helpers", () => {
  test("formatCostCents renders dollars, or null when unset", () => {
    expect(formatCostCents(1250)).toBe("$12.50");
    expect(formatCostCents(0)).toBe("$0.00");
    expect(formatCostCents(null)).toBeNull();
  });

  test("costCentsToInputValue round-trips through parseCostInputToCents", () => {
    expect(parseCostInputToCents(costCentsToInputValue(1250))).toBe(1250);
    expect(costCentsToInputValue(null)).toBe("");
    expect(parseCostInputToCents("")).toBeNull();
  });
});
