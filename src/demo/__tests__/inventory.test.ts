import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  MAGPUL_LABEL_ALLOWED_RE,
  MAX_LABEL_LENGTH,
} from "@/src/domain/magazines/constants";
import { ISO_DATE, todayIso } from "@/src/lib/dates";
import {
  bulkMagazines,
  DEMO_ACCESSORIES,
  DEMO_AMMO,
  DEMO_FIREARMS,
  isoDateDaysAgo,
} from "../inventory";

/**
 * Pure unit tests for the demo dataset — no database needed.
 *
 * `bulkMagazines()` previously generated `AR-01` / `P320-01` style labels, which
 * exceed the Magpul dot-matrix budget. Nothing caught it because the seed script
 * has no test coverage and the seeded admin defaults to `magpulMode: false`, so
 * `createMagazine` never applied the label rule. These assertions hold the
 * dataset to the same constraint the domain enforces.
 */
describe("bulkMagazines (demo dataset)", () => {
  const magazines = bulkMagazines();

  test("every generated label fits the Magpul label rule", () => {
    for (const m of magazines) {
      expect(m.label).toBeDefined();
      const label = m.label ?? "";
      expect(label.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
      expect(MAGPUL_LABEL_ALLOWED_RE.test(label)).toBe(true);
    }
  });

  test("labels are unique, so no two magazines collide", () => {
    const labels = magazines.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("labels are zero-padded so they sort lexically as they sort numerically", () => {
    const arLabels = magazines
      .filter((m) => m.label?.startsWith("AR"))
      .map((m) => m.label ?? "");
    expect(arLabels[0]).toBe("AR01");
    expect([...arLabels].sort()).toEqual(arLabels);
  });

  test("extensionRounds defaults to 0 for lines that do not declare it", () => {
    // The 5.56 line declares none; the Glock line declares 2.
    const ar = magazines.find((m) => m.label?.startsWith("AR"));
    const gl = magazines.find((m) => m.label?.startsWith("GL"));
    expect(ar?.extensionRounds).toBe(0);
    expect(gl?.extensionRounds).toBe(2);
  });

  test("every magazine carries the caliber and prefix its line declares", () => {
    for (const m of magazines) {
      expect(m.caliber).not.toBe("");
      expect(m.label?.startsWith(m.labelPrefix ?? "")).toBe(true);
    }
  });

  test("produces a dense enough set to exercise pagination", () => {
    // The point of the bulk set is a table that actually paginates.
    expect(magazines.length).toBeGreaterThan(25);
  });
});

describe("demo dataset integrity", () => {
  test("every accessory mount names a declared firearm", () => {
    const names = new Set<string>(DEMO_FIREARMS.map((f) => f.name));
    for (const a of DEMO_ACCESSORIES) {
      if (a.mount) expect(names.has(a.mount)).toBe(true);
    }
  });

  test("every ammo lot has a caliber some firearm can use", () => {
    // Not a hard domain rule, but a demo set whose ammo matches no firearm
    // makes the summary's by-caliber roll-up read as broken.
    const calibers = new Set<string>(DEMO_FIREARMS.map((f) => f.caliber));
    for (const lot of DEMO_AMMO) {
      expect(calibers.has(lot.caliber)).toBe(true);
    }
  });

  test("firearm names are unique, so mount resolution is unambiguous", () => {
    const names = DEMO_FIREARMS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * F8: `isoDateDaysAgo` had no unit test despite being pure, TZ-sensitive,
 * local-frame date arithmetic (KTD5) now used by e2e specs. No fixed "now"
 * is asserted here — these check relative, local-frame properties that hold
 * regardless of the runner's actual clock or timezone.
 */
describe("isoDateDaysAgo", () => {
  // `isoDateDaysAgo` and `todayIso` each read the system clock independently
  // (`new Date()` inside their own bodies, no shared reference-date
  // parameter), so two calls straddling local midnight would disagree on the
  // day even though both implementations are correct. Freezing the clock for
  // this describe block (local noon, clear of any DST transition) removes
  // that race without widening either function's signature just for a test.
  beforeEach(() => {
    setSystemTime(new Date(2026, 5, 15, 12));
  });

  afterEach(() => {
    setSystemTime();
  });

  test("zero days ago is today's local calendar date", () => {
    expect(isoDateDaysAgo(0)).toBe(todayIso());
  });

  test("returns a well-formed ISO calendar date for a typical offset", () => {
    expect(ISO_DATE.test(isoDateDaysAgo(45))).toBe(true);
  });

  test("is local-frame calendar-day arithmetic, exact regardless of runner timezone", () => {
    const ninetyDaysAgo = isoDateDaysAgo(90);
    const today = isoDateDaysAgo(0);
    expect(
      differenceInCalendarDays(parseISO(today), parseISO(ninetyDaysAgo)),
    ).toBe(90);
  });

  test("crossing a year boundary (the SBR's 900-day acquiredDaysAgo) still resolves to a real, correctly-offset calendar date", () => {
    const longAgo = isoDateDaysAgo(900);
    expect(ISO_DATE.test(longAgo)).toBe(true);
    expect(
      differenceInCalendarDays(parseISO(todayIso()), parseISO(longAgo)),
    ).toBe(900);
  });
});
