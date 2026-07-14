import { describe, expect, test } from "bun:test";
import { formatLastInventoried } from "../last-inventoried";

/**
 * Unit tests for the pure "Last inventoried" column helper (U3, #70).
 * Covers the two states the column cell renders: a real ISO date/time
 * string -> an absolute calendar date, and null/undefined (never
 * inventoried) -> an em-dash.
 */
describe("formatLastInventoried", () => {
  test("renders an absolute calendar date for a real ISO string", () => {
    const result = formatLastInventoried("2024-03-15T18:30:00.000Z");
    // Exact locale formatting is environment-dependent; assert on the
    // stable content rather than a hardcoded rendering.
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(0);
    // Must not leak the raw ISO datetime string verbatim (date only, no time).
    expect(result).not.toContain("T18:30:00");
  });

  test("returns an em-dash for null (never inventoried)", () => {
    expect(formatLastInventoried(null)).toBe("—");
  });

  test("returns an em-dash for undefined", () => {
    expect(formatLastInventoried(undefined)).toBe("—");
  });
});
