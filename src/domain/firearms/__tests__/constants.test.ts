import { describe, expect, test } from "bun:test";
import {
  FIREARM_ACTIONS,
  FIREARM_TYPES,
  firearmActionLabel,
  firearmTypeLabel,
  isFirearmAction,
  isFirearmType,
  isRealFirearmAction,
  isRealFirearmType,
} from "../constants";

describe("firearm taxonomy constants (U1)", () => {
  test("membership: every set value is a member; unknown slugs are not", () => {
    for (const t of FIREARM_TYPES) expect(isFirearmType(t)).toBe(true);
    for (const a of FIREARM_ACTIONS) expect(isFirearmAction(a)).toBe(true);
    expect(isFirearmType("blaster")).toBe(false);
    expect(isFirearmAction("phaser")).toBe(false);
  });

  test("isRealFirearmType: rejects the sentinel and empty, accepts a real type", () => {
    expect(isRealFirearmType("unspecified")).toBe(false);
    expect(isRealFirearmType("")).toBe(false);
    expect(isRealFirearmType("pistol")).toBe(true);
  });

  test("isRealFirearmAction: rejects the sentinel and empty, accepts a real action", () => {
    expect(isRealFirearmAction("unspecified")).toBe(false);
    expect(isRealFirearmAction("")).toBe(false);
    expect(isRealFirearmAction("semi-auto")).toBe(true);
  });

  test("display-label map returns a label for every value, including the sentinel", () => {
    for (const t of FIREARM_TYPES) expect(firearmTypeLabel(t)).toBeTruthy();
    for (const a of FIREARM_ACTIONS) expect(firearmActionLabel(a)).toBeTruthy();
    expect(firearmTypeLabel("unspecified")).toBe("Unspecified");
    expect(firearmActionLabel("unspecified")).toBe("Unspecified");
    expect(firearmActionLabel("semi-auto")).toBe("Semi-automatic");
    expect(firearmTypeLabel("pcc")).toBe("PCC");
  });

  test("unknown slug falls back to the raw value", () => {
    expect(firearmTypeLabel("blaster")).toBe("blaster");
    expect(firearmActionLabel("phaser")).toBe("phaser");
  });
});
