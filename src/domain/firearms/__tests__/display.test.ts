import { describe, expect, test } from "bun:test";
import { firearmDisplayName, hasNickname } from "../display";

// #18 — nickname-primary display resolution. Pure, no DB.
describe("firearmDisplayName (#18)", () => {
  test("returns the nickname when present (Covers AE1)", () => {
    expect(
      firearmDisplayName({ name: "Glock 19 Gen 5", nickname: "Nightstand gun" }),
    ).toBe("Nightstand gun");
  });

  test("returns the raw nickname verbatim, not trimmed", () => {
    expect(
      firearmDisplayName({ name: "Glock 19", nickname: "  Old Reliable  " }),
    ).toBe("  Old Reliable  ");
  });

  test("falls back to the product name when nickname is empty (Covers AE1)", () => {
    expect(
      firearmDisplayName({ name: "M&P Shield Plus", nickname: "" }),
    ).toBe("M&P Shield Plus");
  });

  test("treats a whitespace-only nickname as empty", () => {
    expect(firearmDisplayName({ name: "SIG P320", nickname: "   " })).toBe(
      "SIG P320",
    );
  });
});

describe("hasNickname (#18)", () => {
  test("true when the nickname is non-empty", () => {
    expect(hasNickname({ nickname: "Nightstand gun" })).toBe(true);
  });

  test("false when the nickname is empty", () => {
    expect(hasNickname({ nickname: "" })).toBe(false);
  });

  test("false when the nickname is whitespace-only", () => {
    expect(hasNickname({ nickname: "   " })).toBe(false);
  });
});
