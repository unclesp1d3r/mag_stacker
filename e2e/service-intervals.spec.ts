import { isoDateDaysAgo } from "@/src/demo/inventory";
import { authTest, expect } from "./fixtures/auth";

/**
 * Service interval tracking (issue #10), full flow — the settings-to-due-to-
 * logged path the plan's Definition of Done names for U7 explicitly: a
 * default set from settings changes due state across the collection with no
 * item visited (F1), and logging service from the item's detail view clears
 * it again (F2). A second rifle exercises F3/AE1 — overriding one rule keeps
 * it standing after the category default it diverged from later changes.
 *
 * One sequential test on a fresh "service-intervals" user; each step builds
 * on the last (mirrors accessories.spec.ts / inventory-log-sharing.spec.ts).
 * `isoDateDaysAgo` is the same local-frame helper the demo seed uses
 * (`src/demo/inventory.ts`), reused here so the fixture dates stay relative
 * to "now" rather than drifting stale. ARIA roles, accessible names, and
 * visible text only — no `data-testid`. The grantee-permission gate (KTD3)
 * is covered separately in `service-intervals-sharing.spec.ts`.
 */
const test = authTest("service-intervals");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("a rifle default marks items due with no visit, logging service clears it, and an override survives a later default change", async ({
  page,
}) => {
  await test.step("owner creates two rifles with different acquired dates", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    let form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Interval Rifle One");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    // Well past any threshold below (KTD9: origin date, no service point yet).
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(30));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Interval Rifle Two");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    // Barely acquired — under the Cleaning default below, over the Barrel
    // override applied to it later.
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(2));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();
  });

  await test.step("no rifle is marked due before any default exists", async () => {
    await page.goto("/firearms");
    await expect(page.getByText("Service due")).toHaveCount(0);
  });

  await test.step("owner arms the Rifle category from settings — no item visited (F1)", async () => {
    await page.goto("/settings");
    await page
      .getByRole("link", { name: "Manage service-interval defaults" })
      .click();
    await expect(page).toHaveURL(/\/settings\/service$/);

    const rifleSection = page.getByRole("region", { name: "Rifle" });

    await rifleSection.getByRole("button", { name: "Add rule" }).click();
    let form = rifleSection.locator("form");
    await form.getByLabel("Rule name").fill("Cleaning");
    await form.getByLabel("Days").fill("7");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Rifle rule added").first()).toBeVisible();

    await rifleSection.getByRole("button", { name: "Add rule" }).click();
    form = rifleSection.locator("form");
    await form.getByLabel("Rule name").fill("Barrel");
    await form.getByLabel("Days").fill("400");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Rifle rule added").last()).toBeVisible();
  });

  await test.step("Interval Rifle One is marked due on its list row; Interval Rifle Two is not (F1, R20)", async () => {
    await page.goto("/firearms");
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "Interval Rifle One" })
        .getByText("Service due"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "Interval Rifle Two" })
        .getByText("Service due"),
    ).toHaveCount(0);
  });

  await test.step("the /summary roll-up counts the one due item and rule (R19)", async () => {
    await page.goto("/summary");
    await expect(
      page.getByText("1 item due for service across 1 rule"),
    ).toBeVisible();
  });

  await test.step("Interval Rifle One's panel shows a mix — Cleaning due, Barrel not (R18)", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Interval Rifle One" }).click();

    const panel = page.getByRole("region", { name: "Service rules" });
    const cleaningRow = panel.getByRole("row").filter({ hasText: "Cleaning" });
    await expect(cleaningRow.getByText("Due")).toBeVisible();
    await expect(cleaningRow).toContainText("of 7 days");

    const barrelRow = panel.getByRole("row").filter({ hasText: "Barrel" });
    await expect(barrelRow.getByText("Due")).toHaveCount(0);
    await expect(barrelRow).toContainText("of 400 days");
  });

  await test.step("logging service against Cleaning clears its due state (F2)", async () => {
    await page.getByRole("button", { name: "Log service — Cleaning" }).click();
    const form = page.locator("form");
    await form
      .getByLabel("Notes")
      .fill("Wiped down and lubed after the range.");
    await form.getByRole("button", { name: "Log service" }).click();
    await expect(page.getByText("Logged service — Cleaning")).toBeVisible();

    const panel = page.getByRole("region", { name: "Service rules" });
    const cleaningRow = panel.getByRole("row").filter({ hasText: "Cleaning" });
    await expect(cleaningRow.getByText("Due")).toHaveCount(0);

    const history = page.getByRole("region", { name: "Service history" });
    await expect(history).toContainText("Cleaning");
    await expect(history).toContainText(
      "Wiped down and lubed after the range.",
    );
  });

  await test.step("the list row and roll-up both clear once the only due rule is logged", async () => {
    await page.goto("/firearms");
    await expect(page.getByText("Service due")).toHaveCount(0);

    await page.goto("/summary");
    await expect(
      page.getByText("0 items due for service across 0 rules"),
    ).toBeVisible();
  });

  await test.step("overriding Barrel on Interval Rifle Two diverges it from the rifle default (F3)", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Interval Rifle Two" }).click();

    await page.getByRole("button", { name: "Override Barrel" }).click();
    const form = page.locator("form");
    await form.getByLabel("Days").fill("1");
    await page.getByRole("button", { name: "Save override" }).click();
    await expect(page.getByText("Barrel updated")).toBeVisible();

    const panel = page.getByRole("region", { name: "Service rules" });
    const barrelRow = panel.getByRole("row").filter({ hasText: "Barrel" });
    await expect(barrelRow.getByText("Overridden")).toBeVisible();
    await expect(barrelRow.getByText("Due")).toBeVisible();
    await expect(barrelRow).toContainText("of 1 day");
  });

  await test.step("raising the rifle Barrel default reaches Interval Rifle One but leaves Interval Rifle Two's override standing (F3, AE1)", async () => {
    await page.goto("/settings/service");
    const rifleSection = page.getByRole("region", { name: "Rifle" });
    await rifleSection
      .getByRole("row")
      .filter({ hasText: "Barrel" })
      .getByRole("button", { name: "Edit" })
      .click();
    const form = rifleSection.locator("form");
    await form.getByLabel("Days").fill("1000");
    await rifleSection.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Barrel updated")).toBeVisible();

    await page.goto("/firearms");
    await page.getByRole("link", { name: "Interval Rifle One" }).click();
    const oneBarrelRow = page
      .getByRole("region", { name: "Service rules" })
      .getByRole("row")
      .filter({ hasText: "Barrel" });
    await expect(oneBarrelRow.getByText("Inherited")).toBeVisible();
    await expect(oneBarrelRow).toContainText("of 1000 days");

    await page.goto("/firearms");
    await page.getByRole("link", { name: "Interval Rifle Two" }).click();
    const twoBarrelRow = page
      .getByRole("region", { name: "Service rules" })
      .getByRole("row")
      .filter({ hasText: "Barrel" });
    await expect(twoBarrelRow.getByText("Overridden")).toBeVisible();
    await expect(twoBarrelRow).toContainText("of 1 day");
  });

  await test.step("correcting the Cleaning entry's date and notes, then deleting it (correction path)", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Interval Rifle One" }).click();

    const history = page.getByRole("region", { name: "Service history" });
    await history
      .getByRole("button", { name: /^Edit service — Cleaning/ })
      .click();

    const editForm = history.locator("form");
    await editForm.getByLabel("Date serviced").fill(isoDateDaysAgo(1));
    await editForm
      .getByLabel("Notes")
      .fill("Corrected: actually cleaned yesterday.");
    await editForm.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Cleaning entry updated")).toBeVisible();
    await expect(history).toContainText(
      "Corrected: actually cleaned yesterday.",
    );

    await history
      .getByRole("button", { name: /^Delete service — Cleaning/ })
      .click();
    await expect(page.getByText("Cleaning entry deleted")).toBeVisible();
    await expect(history.getByText("No service logged yet")).toBeVisible();

    // With no service event left for Cleaning, due state falls back to the
    // firearm's acquired date (30 days ago) — well past the 7-day threshold.
    const panel = page.getByRole("region", { name: "Service rules" });
    const cleaningRow = panel.getByRole("row").filter({ hasText: "Cleaning" });
    await expect(cleaningRow.getByText("Due")).toBeVisible();
  });
});
