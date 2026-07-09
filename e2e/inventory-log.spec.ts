import type { Page } from "@playwright/test";
import { authTest, expect } from "./fixtures/auth";

/**
 * Inventory log (R7-R13), UI layer, single-user. Covers R9 (newest-first),
 * R10 ("Mark inventoried"), R11 ("Log…" form incl. per-parent event-type set),
 * and R12 (ARIA targeting, no data-testid) through the real browser on one
 * seeded "inventory-log" user. Sharing/actor-attribution (R7/R8) is covered in
 * `inventory-log-sharing.spec.ts`; cascade deletion (R13) is proven at the
 * integration layer in `src/domain/inventory-log/__tests__/service.test.ts` and
 * need not be re-proven here. One sequential test on a fresh user; each step
 * builds on the last. Mirrors `range-sessions.spec.ts`.
 */
const test = authTest("inventory-log");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

/** The inventory-log DataTable, distinguished from any other table on the
 * page (e.g. range sessions) by its unique "Actor" column. */
function logTable(page: Page) {
  return page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: "Actor" }) });
}

/**
 * Matches a rendered "9:00" wall-clock time regardless of locale (12h "9:00
 * AM" or 24h with an optional leading zero, "09:00"), while still rejecting
 * a shifted hour like "8:00", "10:00", or "14:00" — the kind of drift a
 * doubled-offset / local-as-UTC datetime-local bug would produce. The
 * leading digit-boundary check (no digit immediately before "9") excludes
 * "19:00" so a +10h shift is still caught.
 */
const NINE_OCLOCK_LOCAL = /\b0?9:00\b/;

test("logs, orders newest-first, and gates event types per parent", async ({
  page,
}) => {
  await test.step("create a firearm and open its detail page", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Log Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("link", { name: "Log Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Log Rifle" }),
    ).toBeVisible();
  });

  await test.step("Mark inventoried adds an entry without a manual reload (R10)", async () => {
    await page.getByRole("button", { name: "Mark inventoried" }).click();
    await expect(page.getByText("Marked inventoried").first()).toBeVisible();

    const rows = logTable(page).locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Inventoried");
    // The actor is this seeded user, identified by name (R9's "who" is a name,
    // not a raw id) — the launcher names each seeded user after its spec key.
    await expect(rows.first()).toContainText("inventory-log");
  });

  await test.step("Log… records a backdated maintenance entry above an older one (R9/R11)", async () => {
    await page.getByRole("button", { name: "Log…" }).click();
    let form = page.locator("form").last();
    await form.getByLabel("Event type").selectOption("lubed");
    await form.getByLabel("Date & time").fill("2026-01-15T09:00");
    await form.getByLabel("Notes").fill("First scheduled lube");
    await form.getByRole("button", { name: "Log" }).click();
    await expect(page.getByText("Logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Log…" }).click();
    form = page.locator("form").last();
    await form.getByLabel("Event type").selectOption("cleaned");
    await form.getByLabel("Date & time").fill("2026-03-01T09:00");
    await form.getByLabel("Notes").fill("Field strip and clean");
    await form.getByRole("button", { name: "Log" }).click();
    await expect(page.getByText("Logged").first()).toBeVisible();

    // Newest-first (R9): the just-marked "now" entry stays on top, the more
    // recently-dated "cleaned" entry sorts above the older "lubed" entry, and
    // the maintenance type + notes render for it.
    const rows = logTable(page).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Inventoried");
    await expect(rows.nth(1)).toContainText("Cleaned");
    await expect(rows.nth(1)).toContainText("Field strip and clean");
    // The entered "2026-03-01T09:00" local wall-clock time must render as
    // 9:00, not shifted by a doubled-offset / local-as-UTC bug (R9).
    await expect(rows.nth(1)).toContainText(NINE_OCLOCK_LOCAL);
    await expect(rows.nth(2)).toContainText("Lubed");
    await expect(rows.nth(2)).toContainText("First scheduled lube");
  });

  await test.step("a magazine only offers the 'inventoried' event type (R11)", async () => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    const magForm = page.locator("form");
    await magForm.getByLabel("Brand / model").fill("Log Mag");
    await magForm.getByLabel("Caliber").fill("5.56");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByText("Magazine seated").first()).toBeVisible();

    await page.getByRole("link", { name: "Log Mag" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Log Mag" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Mark inventoried" }).click();
    await expect(page.getByText("Marked inventoried").first()).toBeVisible();
    const rows = logTable(page).locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Inventoried");

    await page.getByRole("button", { name: "Log…" }).click();
    const eventSelect = page.locator("form").last().getByLabel("Event type");
    await expect(eventSelect.locator("option")).toHaveCount(1);
    await expect(eventSelect.locator("option").first()).toHaveText(
      "Inventoried",
    );
  });
});
