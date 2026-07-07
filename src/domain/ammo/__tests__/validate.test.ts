import { describe, expect, test } from "bun:test";
import { type AmmoFields, isLowStock, validateAmmo } from "../validate";

const base: AmmoFields = {
  caliber: "9mm",
  grain: 115,
  quantityRounds: 100,
  lowStockThreshold: 10,
};

describe("validateAmmo", () => {
  test("a valid lot returns no codes", () => {
    expect(validateAmmo(base)).toEqual([]);
  });

  test("blank caliber (incl. whitespace-only) yields emptyCaliber", () => {
    expect(validateAmmo({ ...base, caliber: "" })).toEqual(["emptyCaliber"]);
    expect(validateAmmo({ ...base, caliber: "   " })).toEqual(["emptyCaliber"]);
  });

  test("negative grain yields negativeGrain", () => {
    expect(validateAmmo({ ...base, grain: -1 })).toEqual(["negativeGrain"]);
  });

  test("negative quantityRounds yields negativeQuantity", () => {
    expect(validateAmmo({ ...base, quantityRounds: -1 })).toEqual([
      "negativeQuantity",
    ]);
  });

  test("negative lowStockThreshold yields negativeThreshold", () => {
    expect(validateAmmo({ ...base, lowStockThreshold: -1 })).toEqual([
      "negativeThreshold",
    ]);
  });

  test("returns all failure codes together, not first-only", () => {
    const codes = validateAmmo({
      caliber: "",
      grain: -1,
      quantityRounds: -1,
      lowStockThreshold: -1,
    });
    expect(codes).toContain("emptyCaliber");
    expect(codes).toContain("negativeGrain");
    expect(codes).toContain("negativeQuantity");
    expect(codes).toContain("negativeThreshold");
    expect(codes).toHaveLength(4);
  });
});

describe("isLowStock", () => {
  test("quantity equal to threshold is low stock (boundary)", () => {
    expect(isLowStock({ quantityRounds: 10, lowStockThreshold: 10 })).toBe(
      true,
    );
  });

  test("quantity one above threshold is not low stock", () => {
    expect(isLowStock({ quantityRounds: 11, lowStockThreshold: 10 })).toBe(
      false,
    );
  });

  test("quantity below threshold is low stock", () => {
    expect(isLowStock({ quantityRounds: 5, lowStockThreshold: 10 })).toBe(true);
  });
});
