import { describe, expect, test } from "bun:test";
import { ACCESSORY_CATEGORY_SUGGESTIONS } from "../constants";
import {
  type AccessoryFields,
  MAX_COST_CENTS,
  validateAccessory,
} from "../validate";

const base: AccessoryFields = {
  category: "optic",
};

describe("validateAccessory", () => {
  test("a valid minimal accessory (category only) returns no codes", () => {
    expect(validateAccessory(base)).toEqual([]);
  });

  test("blank category (incl. whitespace-only) yields emptyCategory", () => {
    expect(validateAccessory({ ...base, category: "" })).toEqual([
      "emptyCategory",
    ]);
    expect(validateAccessory({ ...base, category: "   " })).toEqual([
      "emptyCategory",
    ]);
  });

  test("negative costCents yields negativeCostCents", () => {
    expect(validateAccessory({ ...base, costCents: -1 })).toEqual([
      "negativeCostCents",
    ]);
  });

  test("costCents above int4 max yields invalidCostCents (#53)", () => {
    expect(
      validateAccessory({ ...base, costCents: MAX_COST_CENTS + 1 }),
    ).toEqual(["invalidCostCents"]);
    expect(validateAccessory({ ...base, costCents: MAX_COST_CENTS })).toEqual(
      [],
    );
  });

  test("non-integer costCents yields invalidCostCents", () => {
    expect(validateAccessory({ ...base, costCents: 12.5 })).toEqual([
      "invalidCostCents",
    ]);
  });

  test("null costCents is ok (unset cost is unknown, not zero)", () => {
    expect(validateAccessory({ ...base, costCents: null })).toEqual([]);
  });

  test("undefined costCents is ok", () => {
    expect(validateAccessory({ ...base, costCents: undefined })).toEqual([]);
  });

  test("invalid installedDate string yields invalidInstalledDate", () => {
    expect(validateAccessory({ ...base, installedDate: "not-a-date" })).toEqual(
      ["invalidInstalledDate"],
    );
    expect(validateAccessory({ ...base, installedDate: "2026-02-31" })).toEqual(
      ["invalidInstalledDate"],
    );
  });

  test("valid installedDate is ok", () => {
    expect(validateAccessory({ ...base, installedDate: "2026-01-15" })).toEqual(
      [],
    );
  });

  test("null installedDate is ok (unset)", () => {
    expect(validateAccessory({ ...base, installedDate: null })).toEqual([]);
  });

  test("returns all failure codes together, not first-only", () => {
    const codes = validateAccessory({
      category: "",
      costCents: -1,
      installedDate: "bogus",
    });
    expect(codes).toContain("emptyCategory");
    expect(codes).toContain("negativeCostCents");
    expect(codes).toContain("invalidInstalledDate");
    expect(codes).toHaveLength(3);
  });
});

describe("ACCESSORY_CATEGORY_SUGGESTIONS", () => {
  test("contains suppressor and optic", () => {
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("suppressor");
    expect(ACCESSORY_CATEGORY_SUGGESTIONS).toContain("optic");
  });
});
