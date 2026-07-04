import { describe, expect, test } from "bun:test";
import {
  generateLabels,
  nextLabelStart,
  nextStartForPrefixes,
} from "../labels";

// Parity digest §12.4 — exact tables.
describe("generateLabels (parity §10.3)", () => {
  test.each([
    ["AR-", 2, 1, ["AR-01", "AR-02"]],
    ["AR-", 1, 1, ["AR-01"]],
    ["", 4, 1, ["", "", "", ""]],
    ["   ", 3, 1, ["", "", ""]],
    ["AR-", 0, 1, []],
    ["AR-", 2, 3, ["AR-03", "AR-04"]],
    ["AR-", 2, 99, ["AR-099", "AR-100"]],
  ] as const)("(%s, %d, start %d)", (prefix, count, start, expected) => {
    expect(generateLabels(prefix, count, start)).toEqual([...expected]);
  });

  test("count 99 from start 1 stays width 2 (last = AR-99)", () => {
    const labels = generateLabels("AR-", 99, 1);
    expect(labels[0]).toBe("AR-01");
    expect(labels[98]).toBe("AR-99");
  });

  test("count 100 from start 1 grows to width 3 (AR-001 … AR-100)", () => {
    const labels = generateLabels("AR-", 100, 1);
    expect(labels[0]).toBe("AR-001");
    expect(labels[99]).toBe("AR-100");
  });

  test("count 150 from start 1 (AR-001 … AR-150)", () => {
    const labels = generateLabels("AR-", 150, 1);
    expect(labels[0]).toBe("AR-001");
    expect(labels[149]).toBe("AR-150");
  });
});

describe("nextLabelStart (parity §10.4 / §12.4)", () => {
  test.each([
    [[], "AR-", 1],
    [["AR-01", "AR-02", "AR-03", "", "GL9-07"], "AR-", 4],
    [["AR-01", "AR-02", "AR-03", "", "GL9-07"], "GL9-", 8],
    [["AR-", "AR-custom", "AR-1a", "AR-0", "AR-00"], "AR-", 1],
    [["", ""], "", 1],
  ] as const)("%j prefix %s → %d", (labels, prefix, expected) => {
    expect(nextLabelStart([...labels], prefix)).toBe(expected);
  });
});

describe("nextStartForPrefixes (#22)", () => {
  test("maps each prefix to its next start; unmatched prefix → 1", () => {
    // Covers R5: next start continues past the highest matching label per prefix.
    const map = nextStartForPrefixes(
      ["US01", "US03", "AR02"],
      ["US", "AR", "MP"],
    );
    expect(map).toEqual({ US: 4, AR: 3, MP: 1 });
  });

  test("empty prefix list yields an empty map", () => {
    expect(nextStartForPrefixes(["US01"], [])).toEqual({});
  });
});
