import { describe, expect, test } from "bun:test";
import { validateFirearm } from "../validate";

// Parity digest §12.1 — exact acceptance pairs (AE1).
describe("validateFirearm (parity §1)", () => {
  test('("Glock 19","9mm") is valid', () => {
    expect(validateFirearm({ name: "Glock 19", caliber: "9mm" })).toEqual([]);
  });

  test('("","9mm") returns ["emptyName"]', () => {
    expect(validateFirearm({ name: "", caliber: "9mm" })).toEqual([
      "emptyName",
    ]);
  });

  test('("AR-15","  ") returns ["emptyCaliber"] (whitespace-only treated as empty)', () => {
    expect(validateFirearm({ name: "AR-15", caliber: "  " })).toEqual([
      "emptyCaliber",
    ]);
  });

  test('("","") returns both failures, not first-only (R20)', () => {
    expect(validateFirearm({ name: "", caliber: "" })).toEqual([
      "emptyName",
      "emptyCaliber",
    ]);
  });

  test("whitespace-only name is treated as empty", () => {
    expect(validateFirearm({ name: "   ", caliber: "9mm" })).toEqual([
      "emptyName",
    ]);
  });

  test("a non-empty value with surrounding whitespace is valid (persisted verbatim by the service)", () => {
    expect(validateFirearm({ name: "  Glock 19  ", caliber: " 9mm " })).toEqual(
      [],
    );
  });
});
