import type { Page } from "@playwright/test";
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
 * `YYYY-MM-DD` for a `<input type="date">` value, in the browser's LOCAL day
 * (matches `dayBoundaryMs` in `src/domain/magazines/inventory-filter.ts`,
 * which resolves `InventoryFilter.after`/`before` against the viewer's local
 * calendar day, not UTC).
 */
function dayInput(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
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

  await test.step("Custom range reveals After/Before and narrows to that window", async () => {
    await page.getByLabel("Caliber").selectOption("");
    await page.getByLabel("Last inventoried").selectOption("custom");

    const after = page.getByLabel("After");
    const before = page.getByLabel("Before");
    await expect(after).toBeVisible();
    await expect(before).toBeVisible();

    // Beta was backdated ~100 days ago; bound the range tightly around it —
    // wide enough to absorb clock drift between seeding and this assertion,
    // narrow enough to exclude Gamma's ~120-day-old entry.
    const center = new Date(Date.now() - 100 * DAY_MS);
    await after.fill(dayInput(new Date(center.getTime() - 3 * DAY_MS)));
    await before.fill(dayInput(new Date(center.getTime() + 3 * DAY_MS)));

    await expect(rowFor(page, "Filter Mag Beta")).toHaveCount(1);
    await expect(rowFor(page, "Filter Mag Alpha")).toHaveCount(0); // never -> no custom-range match
    await expect(rowFor(page, "Filter Mag Gamma")).toHaveCount(0); // outside the window
    await expect(rowFor(page, "Filter Mag Delta")).toHaveCount(0); // outside the window
  });
});
