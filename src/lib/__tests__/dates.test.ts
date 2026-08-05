import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  FUTURE_DATE_TOLERANCE_DAYS,
  ISO_DATE,
  isRealCalendarDate,
  todayIso,
} from "@/src/lib/dates";

/**
 * Direct coverage for `src/lib/dates.ts` — extracted from four previously
 * byte-identical copies (firearms' `acquiredDate`, accessories'
 * `installedDate`, range-sessions' `date`, service-intervals' `servicedOn`).
 * This file owns the invariant at its source; it does not replace the
 * indirect coverage still exercised through each consumer's own validator
 * tests (`src/domain/firearms/__tests__/validate.test.ts`,
 * `src/domain/accessories/__tests__/validate.test.ts`,
 * `src/domain/service-intervals/__tests__/validate-event.test.ts`).
 *
 * See `docs/solutions/test-failures/timezone-fragile-date-boundary-tests.md`:
 * calendar-date fixtures are built with `new Date(y, monthIndex, d)` (local
 * frame), never UTC `...Z` literals, unless a test is deliberately pinning an
 * absolute instant (as the `todayIso` TZ tests below do via
 * `setSystemTime`).
 */

describe("isRealCalendarDate", () => {
  test("a real calendar date is accepted", () => {
    expect(isRealCalendarDate("2026-06-15")).toBe(true);
  });

  test("Feb 29 on a leap year is accepted", () => {
    expect(isRealCalendarDate("2024-02-29")).toBe(true);
  });

  test("day-overflow normalization is rejected: Feb 30 (Date.parse silently rolls it to Mar 2)", () => {
    expect(isRealCalendarDate("2026-02-30")).toBe(false);
  });

  test("day-overflow normalization is rejected: Feb 29 on a non-leap year (rolls to Mar 1)", () => {
    expect(isRealCalendarDate("2026-02-29")).toBe(false);
  });

  test("month-overflow is rejected: month 13", () => {
    expect(isRealCalendarDate("2026-13-01")).toBe(false);
  });

  test("year zero is rejected even though Date.parse round-trips it (no year 0 in Postgres's proleptic Gregorian `date`)", () => {
    expect(isRealCalendarDate("0000-01-01")).toBe(false);
  });

  test("a malformed, non-date string is rejected", () => {
    expect(isRealCalendarDate("not-a-date")).toBe(false);
  });

  test("an empty string is rejected", () => {
    expect(isRealCalendarDate("")).toBe(false);
  });
});

describe("ISO_DATE", () => {
  test("accepts a well-formed YYYY-MM-DD string", () => {
    expect(ISO_DATE.test("2026-06-15")).toBe(true);
  });

  test("rejects single-digit month/day (not zero-padded)", () => {
    expect(ISO_DATE.test("2026-6-15")).toBe(false);
  });

  test("rejects a string with no separators", () => {
    expect(ISO_DATE.test("20260615")).toBe(false);
  });

  test("rejects a date-time string (this regex matches shape only, not a bare date)", () => {
    expect(ISO_DATE.test("2026-06-15T00:00:00.000Z")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(ISO_DATE.test("")).toBe(false);
  });
});

describe("todayIso", () => {
  afterEach(() => {
    // Release the pinned system clock so later tests/files see real time.
    setSystemTime();
  });

  test("returns the LOCAL calendar date, not the UTC date, for the current instant", () => {
    const now = new Date();
    // Computed from LOCAL getters (getFullYear/getMonth/getDate), matching
    // what date-fns `format(new Date(), "yyyy-MM-dd")` reads internally —
    // NOT `toISOString().slice(0, 10)` / UTC getters, which is exactly the
    // frame mismatch this extraction fixed.
    const expectedLocal = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    expect(todayIso()).toBe(expectedLocal);
  });

  test("is TZ-stable across a UTC day boundary: an instant just before UTC midnight can already be tomorrow (or still yesterday) locally", () => {
    // Pin an absolute instant (deliberately a UTC literal here — this is
    // simulating the wall clock/system time itself, not a calendar-date
    // fixture, so it's the one place in this file an absolute instant is
    // correct rather than a local-frame `new Date(y, m, d)`).
    const pinnedInstant = new Date(Date.UTC(2026, 0, 15, 23, 30));
    setSystemTime(pinnedInstant);

    // The correct answer depends on the runner's TZ (e.g. UTC-5 keeps this
    // Jan 15 local; UTC+9 rolls it to Jan 16 local) — computed the same way
    // both times so the assertion is correct under any TZ, including the
    // required TZ=Asia/Tokyo and TZ=America/New_York runs.
    const expectedLocal = [
      pinnedInstant.getFullYear(),
      String(pinnedInstant.getMonth() + 1).padStart(2, "0"),
      String(pinnedInstant.getDate()).padStart(2, "0"),
    ].join("-");

    expect(todayIso()).toBe(expectedLocal);
    // A UTC-getter-based implementation (the bug this replaced) would return
    // "2026-01-15" here regardless of TZ; assert we're not that.
    if (process.env.TZ && process.env.TZ !== "UTC") {
      const utcDate = pinnedInstant.toISOString().slice(0, 10);
      // Only meaningfully different from the local date when the runner's TZ
      // actually straddles this boundary instant differently than UTC does.
      if (utcDate !== expectedLocal) {
        expect(todayIso()).not.toBe(utcDate);
      }
    }
  });
});

describe("FUTURE_DATE_TOLERANCE_DAYS", () => {
  test("is exactly one day of slack", () => {
    // Deliberate, not a placeholder: a not-in-the-future check's `asOf`
    // defaults to the SERVER's own `new Date()`, but the value being
    // checked is often the SUBMITTER's own local `todayIso()`. No real
    // timezone runs more than ~26 hours ahead of another, so a genuine local
    // "today" can read as at most one calendar day ahead of the server's
    // clock. Without this one day of slack, a submitter east of the server
    // (e.g. Asia/Tokyo against a UTC server) submitting their own local
    // today — exactly what `todayIso()` pre-fills into a form by default —
    // would be rejected as "in the future" for part of every day. Anything
    // beyond this single day of slack is a genuinely future date and stays
    // rejected.
    expect(FUTURE_DATE_TOLERANCE_DAYS).toBe(1);
  });
});
