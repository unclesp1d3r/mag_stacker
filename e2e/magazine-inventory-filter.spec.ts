import type { Page } from "@playwright/test";
import { differenceInCalendarMonths, format } from "date-fns";
import { authTest, expect } from "./fixtures/auth";

/**
 * Inventory-date filter on the magazines list (U4, #70): the "Last
 * inventoried" column renders a formatted date or an em-dash, and the preset
 * filter (plus its AND-combination with the existing caliber filter) narrows
 * the visible rows. One sequential test on a fresh "magazine-inventory-filter"
 * user — each step builds on the last, seeding real `inventoried`
 * inventory-log entries via the "Log…" form (backdated) and "Mark inventoried"
 * (now), so this exercises the real client-side filter against real seeded
 * data rather than mocked rows.
 */
const test = authTest("magazine-inventory-filter");

// Stateful: creates magazines and inventory-log entries; a retry would start
// from a dirty account.
test.describe.configure({ retries: 0 });

const DAY_MS = 86_400_000;

/**
 * The `datetime-local` value for `date`, to the minute, in the browser's local
 * time zone (matches `nowLocal()` in `app/(app)/inventory-log/log-entry-form.tsx`,
 * which the picker itself uses — a timezone-less string is interpreted as
 * local time by both the input and the `Date` constructor).
 */
function localDateTimeInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * Move the open date-range popover's visible month(s) by `delta` months
 * (positive = forward, negative = back) via the shadcn `Calendar`'s (
 * react-day-picker) month-nav buttons, whose accessible names are fixed
 * regardless of which month is showing.
 */
async function navigateCalendarMonths(page: Page, delta: number) {
  if (delta === 0) return;
  const button = page.getByRole("button", {
    name: delta > 0 ? "Go to the Next Month" : "Go to the Previous Month",
  });
  for (let i = 0; i < Math.abs(delta); i++) {
    await button.click();
  }
}

/**
 * Click the day cell for `date` in the currently-visible calendar month(s).
 * react-day-picker labels each day button with the full formatted date
 * (`"PPPP"`, e.g. "Wednesday, June 3rd, 2026" — see `labelDayButton` in
 * react-day-picker), so that's the accessible name to target; the caller is
 * responsible for the month already being in view (`navigateCalendarMonths`).
 */
async function selectCalendarDay(page: Page, date: Date) {
  await page
    .getByRole("button", { name: format(date, "PPPP"), exact: true })
    .click();
}

/**
 * Select a `from`..`to` range in the shadcn `Calendar` date-range picker
 * (react-day-picker), given the popover is already open on today's month.
 * Navigates to `from`'s month, clicks it, then navigates on to `to`'s month
 * (0 or a small forward hop for a tight window like the seeded ranges below)
 * and clicks that day — mirroring how a user would page the calendar rather
 * than typing into a raw `<input type="date">` (replaced by U4's picker).
 */
async function selectCalendarRange(page: Page, from: Date, to: Date) {
  const now = new Date();
  await navigateCalendarMonths(page, differenceInCalendarMonths(from, now));
  await selectCalendarDay(page, from);
  await navigateCalendarMonths(page, differenceInCalendarMonths(to, from));
  await selectCalendarDay(page, to);
}

async function addMagazine(page: Page, brandModel: string, caliber: string) {
  const form = page.locator("form");
  await form.getByLabel("Brand / model").fill(brandModel);
  await form.getByLabel("Caliber").fill(caliber);
  await page.getByRole("button", { name: "Add magazine" }).click();
  await expect(page.getByText("Magazine seated").first()).toBeVisible();
}

/** Logs a backdated "Inventoried" entry on the currently-open magazine detail page. */
async function backdateInventoried(page: Page, daysAgo: number) {
  await page.getByRole("button", { name: "Log…" }).click();
  const form = page.locator("form").last();
  await form
    .getByLabel("Date & time")
    .fill(localDateTimeInput(new Date(Date.now() - daysAgo * DAY_MS)));
  await page.getByRole("button", { name: "Log" }).click();
  await expect(page.getByText("Logged").first()).toBeVisible();
}

function rowFor(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}

test("Last inventoried column, presets, and caliber intersection", async ({
  page,
}) => {
  // Four magazines + three backdated/marked log entries + a reload-free
  // multi-step filter flow comfortably exceeds the 30s default on CI.
  test.setTimeout(90_000);

  await test.step("seed: never / stale-9mm / stale-.308 / fresh-9mm", async () => {
    await page.goto("/magazines");
    // A fresh account has no firearms yet, so the cold-start empty state
    // offers "Start with a magazine" rather than the ordinary "Add your
    // first magazine" CTA (see inventory-log.spec.ts for that variant).
    await page.getByRole("button", { name: "Start with a magazine" }).click();
    await addMagazine(page, "Filter Mag Alpha", "9mm"); // never inventoried

    await page.getByRole("button", { name: "Add magazine" }).click();
    await addMagazine(page, "Filter Mag Beta", "9mm"); // stale, matching caliber

    await page.getByRole("button", { name: "Add magazine" }).click();
    await addMagazine(page, "Filter Mag Gamma", ".308"); // stale, other caliber

    await page.getByRole("button", { name: "Add magazine" }).click();
    await addMagazine(page, "Filter Mag Delta", "9mm"); // fresh, matching caliber
  });

  await test.step("backdate Beta (100d) and Gamma (120d); mark Delta inventoried now", async () => {
    await page.getByRole("link", { name: "Filter Mag Beta" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Filter Mag Beta" }),
    ).toBeVisible();
    await backdateInventoried(page, 100);

    await page.goto("/magazines");
    await page.getByRole("link", { name: "Filter Mag Gamma" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Filter Mag Gamma" }),
    ).toBeVisible();
    await backdateInventoried(page, 120);

    await page.goto("/magazines");
    await page.getByRole("link", { name: "Filter Mag Delta" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Filter Mag Delta" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark inventoried" }).click();
    await expect(page.getByText("Marked inventoried").first()).toBeVisible();

    await page.goto("/magazines");
  });

  await test.step("the Last inventoried column shows an em-dash for never, a date for inventoried", async () => {
    await expect(
      page.getByRole("columnheader", { name: "Last inventoried" }),
    ).toBeVisible();
    await expect(rowFor(page, "Filter Mag Alpha")).toContainText("—");
    await expect(rowFor(page, "Filter Mag Beta")).not.toContainText("—");
    await expect(rowFor(page, "Filter Mag Delta")).not.toContainText("—");
  });

  await test.step('"Over 90 days" narrows to the stale and never-inventoried rows', async () => {
    await page.getByLabel("Last inventoried").selectOption("d90");

    await expect(rowFor(page, "Filter Mag Alpha")).toHaveCount(1); // never -> maximally stale
    await expect(rowFor(page, "Filter Mag Beta")).toHaveCount(1); // 100 days
    await expect(rowFor(page, "Filter Mag Gamma")).toHaveCount(1); // 120 days
    await expect(rowFor(page, "Filter Mag Delta")).toHaveCount(0); // just now
  });

  await test.step("combining with a caliber filter narrows to the intersection", async () => {
    await page.getByLabel("Caliber").selectOption("9mm");

    await expect(rowFor(page, "Filter Mag Alpha")).toHaveCount(1);
    await expect(rowFor(page, "Filter Mag Beta")).toHaveCount(1);
    // Gamma is stale but .308, excluded by the caliber filter.
    await expect(rowFor(page, "Filter Mag Gamma")).toHaveCount(0);
    await expect(rowFor(page, "Filter Mag Delta")).toHaveCount(0);
  });

  await test.step("Custom range opens a date-range picker and narrows to that window", async () => {
    await page.getByLabel("Caliber").selectOption("");
    await page.getByLabel("Last inventoried").selectOption("custom");

    const trigger = page.getByRole("button", {
      name: "Last inventoried date range",
    });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("Pick a date range");
    await trigger.click();

    // Beta was backdated ~100 days ago; bound the range tightly around it —
    // wide enough to absorb clock drift between seeding and this assertion,
    // narrow enough to exclude Gamma's ~120-day-old entry.
    const center = new Date(Date.now() - 100 * DAY_MS);
    const from = new Date(center.getTime() - 3 * DAY_MS);
    const to = new Date(center.getTime() + 3 * DAY_MS);
    await selectCalendarRange(page, from, to);

    await expect(rowFor(page, "Filter Mag Beta")).toHaveCount(1);
    await expect(rowFor(page, "Filter Mag Alpha")).toHaveCount(0); // never -> no custom-range match
    await expect(rowFor(page, "Filter Mag Gamma")).toHaveCount(0); // outside the window
    await expect(rowFor(page, "Filter Mag Delta")).toHaveCount(0); // outside the window
  });

  // PR #72's "transient inverted range" regression (After later than Before
  // silently wiping the custom-range panel) no longer applies: the range
  // picker's own two-endpoint selection can't produce an inverted `after` >
  // `before` pair in the first place, so there's nothing to reach the UI in
  // an invalid shape. The underlying guard — `sanitizeInventoryFilter`
  // falling back to `{ preset: "all" }` for a persisted/raw inverted range —
  // is still covered at the domain level in
  // `src/domain/magazines/__tests__/inventory-filter.test.ts`.
});

/**
 * KTD-7 regression (PR #72 re-review): `viewState.filters.inventory` is
 * restored from localStorage via `mergeOverDefaults`
 * (`src/domain/tables/view-state-storage.ts`), which merges `filters` only
 * ONE level deep with no validation of the nested `inventory` object. A
 * structurally-broken persisted value (`null`, a non-object, an unrecognized
 * `preset`) used to reach an unconditional `.preset` read on the raw-display
 * path in `magazines-view.tsx` and throw, crashing the whole page. A separate,
 * fresh user (rather than reusing "magazine-inventory-filter") keeps this
 * localStorage-corruption scenario isolated from that spec's stateful,
 * multi-step flow.
 */
const corruptTest = authTest("magazine-inventory-filter-corrupt");

corruptTest.describe.configure({ retries: 0 });

corruptTest(
  "a structurally corrupt persisted inventory filter falls back to All instead of crashing the page",
  async ({ page }) => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Start with a magazine" }).click();
    await addMagazine(page, "Corrupt State Mag", "9mm");

    // Directly overwrite the table's persisted view-state envelope with a
    // structurally-broken `inventory` filter. Key/version/envelope shape
    // mirror `viewStateStorageKey("magazines")` and `VIEW_STATE_VERSION` in
    // `src/domain/tables/view-state-storage.ts`.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "magstacker:table:magazines:v1",
        JSON.stringify({
          version: 1,
          state: { filters: { inventory: null } },
        }),
      );
    });
    await page.reload();

    // No crash: the page renders normally, the seeded magazine is still
    // there, and the filter control falls back to "All" rather than throwing
    // on `null.preset`.
    await expect(
      page.getByRole("columnheader", { name: "Last inventoried" }),
    ).toBeVisible();
    await expect(page.getByLabel("Last inventoried")).toHaveValue("all");
    await expect(rowFor(page, "Corrupt State Mag")).toHaveCount(1);
  },
);
