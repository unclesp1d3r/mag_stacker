import { describe, expect, test } from "bun:test";
import {
  type AmmoFields,
  isLowStock,
  MAX_COUNT,
  validateAmmo,
} from "../validate";

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

  test("MAX_COUNT itself is storable; one above is not (int4 boundary, #53)", () => {
    expect(validateAmmo({ ...base, quantityRounds: MAX_COUNT })).toEqual([]);
    expect(validateAmmo({ ...base, quantityRounds: MAX_COUNT + 1 })).toEqual([
      "invalidQuantity",
    ]);
  });

  test("oversized grain and threshold yield invalidGrain / invalidThreshold (#53)", () => {
    expect(validateAmmo({ ...base, grain: MAX_COUNT + 1 })).toEqual([
      "invalidGrain",
    ]);
    expect(validateAmmo({ ...base, lowStockThreshold: MAX_COUNT + 1 })).toEqual(
      ["invalidThreshold"],
    );
  });

  test("non-integer and NaN counts are rejected, not passed to the DB (#53)", () => {
    expect(validateAmmo({ ...base, grain: 3.5 })).toEqual(["invalidGrain"]);
    expect(validateAmmo({ ...base, quantityRounds: Number.NaN })).toEqual([
      "invalidQuantity",
    ]);
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
