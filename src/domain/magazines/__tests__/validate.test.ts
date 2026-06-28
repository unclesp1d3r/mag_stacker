import { describe, expect, test } from "bun:test";
import { effectiveCapacity, validateMagazine } from "../validate";

// Parity digest §12.2.
describe("validateMagazine (parity §2)", () => {
  test("valid magazine returns no codes", () => {
    expect(
      validateMagazine(
        {
          brandModel: "Magpul GL9",
          caliber: "9mm",
          baseCapacity: 15,
          extensionRounds: 0,
        },
        1,
      ),
    ).toEqual([]);
  });

  test("covers AE1: blank brand/model, blank caliber, base 0, ext -1 returns all four failures", () => {
    expect(
      validateMagazine(
        { brandModel: "  ", caliber: "", baseCapacity: 0, extensionRounds: -1 },
        1,
      ),
    ).toEqual([
      "emptyBrandModel",
      "emptyCaliber",
      "baseCapacityTooLow",
      "negativeExtensionRounds",
    ]);
  });

  test("addCount 0 → addCountTooLow; 1001 → addCountTooHigh; 1000 is valid", () => {
    const base = {
      brandModel: "X",
      caliber: "9mm",
      baseCapacity: 15,
      extensionRounds: 0,
    };
    expect(validateMagazine(base, 0)).toEqual(["addCountTooLow"]);
    expect(validateMagazine(base, 1001)).toEqual(["addCountTooHigh"]);
    expect(validateMagazine(base, 1000)).toEqual([]);
  });

  test("all five failures at once (parity §12.2 multi-failure example)", () => {
    expect(
      validateMagazine(
        { brandModel: "  ", caliber: "", baseCapacity: 0, extensionRounds: -1 },
        0,
      ),
    ).toEqual([
      "emptyBrandModel",
      "emptyCaliber",
      "baseCapacityTooLow",
      "negativeExtensionRounds",
      "addCountTooLow",
    ]);
  });

  test("covers AE2: effective capacity is base + extension, computed", () => {
    expect(effectiveCapacity({ baseCapacity: 15, extensionRounds: 2 })).toBe(
      17,
    );
  });
});
