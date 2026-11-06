import { describe, expect, test } from "bun:test";
import {
  computeVariance,
  formatVariance,
  isCountApplied,
  parseCountInput,
  previewVariance,
} from "../variance";

/**
 * Pure helpers behind the Reconcile form's live preview and the
 * reconciliation history's Variance / Not applied cells (#100 U4, R4, R12,
 * R13, KTD5). No React, no DB.
 */
describe("computeVariance / formatVariance", () => {
  test("variance is counted minus on record, signed", () => {
    expect(computeVariance(480, 500)).toBe(-20);
    expect(computeVariance(520, 500)).toBe(20);
    expect(computeVariance(100, 100)).toBe(0);
  });

  test("formats a leading sign for non-zero and a plain 0", () => {
    expect(formatVariance(-20)).toBe("−20");
    expect(formatVariance(20)).toBe("+20");
    expect(formatVariance(0)).toBe("0");
  });
});

describe("parseCountInput", () => {
  test("maps empty and non-numeric text to NaN, never 0", () => {
    expect(Number.isNaN(parseCountInput(""))).toBe(true);
    expect(Number.isNaN(parseCountInput("   "))).toBe(true);
    expect(Number.isNaN(parseCountInput("abc"))).toBe(true);
    expect(parseCountInput("0")).toBe(0);
    expect(parseCountInput("480")).toBe(480);
  });
});

describe("previewVariance", () => {
  test("renders an em dash until the field parses as a whole number", () => {
    expect(previewVariance("", 500)).toBe("—");
    expect(previewVariance("abc", 500)).toBe("—");
    expect(previewVariance("1.5", 500)).toBe("—");
    expect(previewVariance("-1", 500)).toBe("—");
  });

  test("renders the signed variance for a valid count", () => {
    expect(previewVariance("480", 500)).toBe("−20");
    expect(previewVariance("500", 500)).toBe("0");
    expect(previewVariance("510", 500)).toBe("+10");
  });
});

describe("isCountApplied (KTD5)", () => {
  const day = 24 * 60 * 60 * 1000;
  const t0 = new Date("2026-03-01T00:00:00.000Z").getTime();
  const todayCount = {
    id: "today",
    occurredAt: new Date(t0),
    createdAt: new Date(t0 + 1000),
  };
  const lateOlderCount = {
    id: "older-entered-later",
    occurredAt: new Date(t0 - 7 * day),
    createdAt: new Date(t0 + 2000),
  };
  const earlyOlderCount = {
    id: "older-entered-earlier",
    occurredAt: new Date(t0 - 30 * day),
    createdAt: new Date(t0 - 30 * day),
  };
  const entries = [todayCount, lateOlderCount, earlyOlderCount];

  test("an entry dated before a later-dated entry that was created earlier is not applied", () => {
    expect(isCountApplied(lateOlderCount, entries)).toBe(false);
  });

  test("the newest-dated entry and an older entry entered in order are applied", () => {
    expect(isCountApplied(todayCount, entries)).toBe(true);
    expect(isCountApplied(earlyOlderCount, entries)).toBe(true);
  });

  test("a lone entry is applied", () => {
    expect(isCountApplied(todayCount, [todayCount])).toBe(true);
  });
});
