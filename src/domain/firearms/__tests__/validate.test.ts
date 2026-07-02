import { describe, expect, test } from "bun:test";
import { messageForCode } from "../../validation-messages";
import { validateFirearm } from "../validate";

// A valid real classification, reused so the empty-field cases below isolate
// the name/caliber checks (U3 made type/action required on FirearmInput).
const CLASS = { type: "pistol", action: "semi-auto" } as const;

// Parity digest §12.1 — exact acceptance pairs (AE1).
describe("validateFirearm (parity §1)", () => {
  test('("Glock 19","9mm") is valid', () => {
    expect(
      validateFirearm({ name: "Glock 19", caliber: "9mm", ...CLASS }),
    ).toEqual([]);
  });

  test('("","9mm") returns ["emptyName"]', () => {
    expect(validateFirearm({ name: "", caliber: "9mm", ...CLASS })).toEqual([
      "emptyName",
    ]);
  });

  test('("AR-15","  ") returns ["emptyCaliber"] (whitespace-only treated as empty)', () => {
    expect(validateFirearm({ name: "AR-15", caliber: "  ", ...CLASS })).toEqual(
      ["emptyCaliber"],
    );
  });

  test('("","") returns both failures, not first-only (R20)', () => {
    expect(validateFirearm({ name: "", caliber: "", ...CLASS })).toEqual([
      "emptyName",
      "emptyCaliber",
    ]);
  });

  test("whitespace-only name is treated as empty", () => {
    expect(validateFirearm({ name: "   ", caliber: "9mm", ...CLASS })).toEqual([
      "emptyName",
    ]);
  });

  test("a non-empty value with surrounding whitespace is valid (persisted verbatim by the service)", () => {
    expect(
      validateFirearm({ name: "  Glock 19  ", caliber: " 9mm ", ...CLASS }),
    ).toEqual([]);
  });
});

// Taxonomy validation (U3, R6/R7).
describe("validateFirearm — taxonomy (U3)", () => {
  test("covers AE2: unspecified type/action with valid name/caliber requires a real choice", () => {
    expect(
      validateFirearm({
        name: "Glock 19",
        caliber: "9mm",
        type: "unspecified",
        action: "unspecified",
      }),
    ).toEqual(["typeRequired", "actionRequired"]);
  });

  test("covers AE3: out-of-set values yield invalidType/invalidAction (R6)", () => {
    const codes = validateFirearm({
      name: "Glock 19",
      caliber: "9mm",
      type: "blaster",
      action: "phaser",
    });
    expect(codes).toContain("invalidType");
    expect(codes).toContain("invalidAction");
    expect(codes).not.toContain("typeRequired");
  });

  test("real selections add no taxonomy codes; only name/caliber failures surface", () => {
    expect(validateFirearm({ name: "", caliber: "", ...CLASS })).toEqual([
      "emptyName",
      "emptyCaliber",
    ]);
  });

  test("all-fields-invalid returns every applicable code together (R20)", () => {
    expect(
      validateFirearm({
        name: "",
        caliber: "",
        type: "unspecified",
        action: "unspecified",
      }),
    ).toEqual(["emptyName", "emptyCaliber", "typeRequired", "actionRequired"]);
  });

  test("messageForCode returns a non-default string for each new code", () => {
    for (const code of [
      "invalidType",
      "invalidAction",
      "typeRequired",
      "actionRequired",
    ]) {
      expect(messageForCode(code)).not.toBe("Invalid value");
    }
  });
});
