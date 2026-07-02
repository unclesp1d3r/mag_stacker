import { describe, expect, test } from "bun:test";
import {
  effectiveCapacity,
  type MagazineValidationCode,
  validateMagazine,
} from "../validate";

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

  test("all seven failures at once (parity §12.2 multi-failure, including magpul codes)", () => {
    expect(
      validateMagazine(
        { brandModel: "  ", caliber: "", baseCapacity: 0, extensionRounds: -1 },
        0,
        { ownerMagpulMode: true, label: "A.TOOOO" },
      ),
    ).toEqual([
      "emptyBrandModel",
      "emptyCaliber",
      "baseCapacityTooLow",
      "negativeExtensionRounds",
      "invalidMagpulLabel",
      "magpulLabelTooLong",
      "addCountTooLow",
    ]);
  });

  test("covers AE2 (parity): effective capacity is base + extension, computed", () => {
    expect(effectiveCapacity({ baseCapacity: 15, extensionRounds: 2 })).toBe(
      17,
    );
  });
});

describe("validateMagazine — Magpul label constraint (U3)", () => {
  const base = {
    brandModel: "Magpul GL9",
    caliber: "9mm",
    baseCapacity: 15,
    extensionRounds: 0,
  };

  const cases: Array<{
    desc: string;
    label: string | undefined;
    ownerMagpulMode: boolean;
    previousLabel: string | undefined;
    expected: MagazineValidationCode[];
  }> = [
    {
      desc: 'AE1 (magpul): "ar-1" normalizes to "AR-1" — passes',
      label: "ar-1",
      ownerMagpulMode: true,
      previousLabel: undefined,
      expected: [],
    },
    {
      desc: 'AE2 (magpul): "AR-15" (5 chars) → magpulLabelTooLong',
      label: "AR-15",
      ownerMagpulMode: true,
      previousLabel: undefined,
      expected: ["magpulLabelTooLong"],
    },
    {
      desc: 'AE3 (magpul): "A.R" (dot, 3 chars) → invalidMagpulLabel only',
      label: "A.R",
      ownerMagpulMode: true,
      previousLabel: undefined,
      expected: ["invalidMagpulLabel"],
    },
    {
      desc: 'AE4 (magpul): "A.TOOOO" → both invalidMagpulLabel and magpulLabelTooLong',
      label: "A.TOOOO",
      ownerMagpulMode: true,
      previousLabel: undefined,
      expected: ["invalidMagpulLabel", "magpulLabelTooLong"],
    },
    {
      desc: "AE5 (magpul): mode off — no label codes regardless of label value",
      label: "AR.TOOLONG",
      ownerMagpulMode: false,
      previousLabel: undefined,
      expected: [],
    },
    {
      desc: "AE6 (magpul): label undefined in context — no check (label not being set)",
      label: undefined,
      ownerMagpulMode: true,
      previousLabel: undefined,
      expected: [],
    },
    {
      desc: "AE7 (magpul): label unchanged vs previousLabel — no check (grandfather, KTD-3)",
      label: "AR.15",
      ownerMagpulMode: true,
      previousLabel: "AR.15",
      expected: [],
    },
  ];

  for (const {
    desc,
    label,
    ownerMagpulMode,
    previousLabel,
    expected,
  } of cases) {
    test(desc, () => {
      expect(
        validateMagazine(base, 1, { ownerMagpulMode, label, previousLabel }),
      ).toEqual(expected);
    });
  }
});
