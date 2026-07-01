import { authTest, expect } from "./fixtures/auth";

/**
 * Controls-gating once inventory exists, plus CRUD with completion feedback and
 * CSV export (R5, R6). One sequential test on a fresh "inventory-crud" user:
 * each step builds on the last, and the toasts/rows accumulate as real usage
 * would. workers:1 keeps the ordering deterministic.
 */
const test = authTest("inventory-crud");

const MAG_BRAND = "Magpul PMAG 17";
const BULK_BRAND = "BulkBatch Mag";

test("inventory CRUD, completion feedback, and controls-gating", async ({
  page,
}) => {
  await test.step("create a firearm → 'Firearm logged'", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await page.getByLabel("Name").fill("Glock 19");
    await page.getByLabel("Caliber").fill("9mm");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Glock 19" }),
    ).toHaveCount(1);
  });

  await test.step("empty magazines still hides the inventory controls", async () => {
    await page.goto("/magazines");
    await expect(page.getByLabel(/Search brand \/ model/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(
      0,
    );
  });

  await test.step("create a magazine → 'Magazine seated' and controls appear", async () => {
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    // Scope to the form: once inventory exists the filter bar adds its own
    // "Search brand / model" and "Caliber" labels that would otherwise collide.
    const form = page.locator("form");
    await form.getByLabel("Brand / model").fill(MAG_BRAND);
    await form.getByLabel("Caliber").fill("9mm");
    await page.getByRole("button", { name: "Add magazine" }).click();

    await expect(page.getByText("Magazine seated")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: MAG_BRAND }),
    ).toHaveCount(1);

    // Now that inventory exists, the gated controls render.
    await expect(page.getByLabel(/Search brand \/ model/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export CSV" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add magazine" }),
    ).toBeVisible();
  });

  await test.step("bulk-add 3 → 'Seated 3 magazines'", async () => {
    await page.getByRole("button", { name: "Add magazine" }).click();
    const form = page.locator("form");
    await form.getByRole("tab", { name: "bulk" }).click();
    await form.getByLabel("Brand / model").fill(BULK_BRAND);
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Count").fill("3");
    await page.getByRole("button", { name: "Add 3 magazines" }).click();

    await expect(page.getByText("Seated 3 magazines")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: BULK_BRAND }),
    ).toHaveCount(3);
  });

  await test.step("edit a magazine → 'Changes saved'", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: MAG_BRAND })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.locator("form").getByLabel("Notes").fill("Range mag");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Changes saved")).toBeVisible();
  });

  await test.step("export → download + 'Inventory exported'", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("magstacker-inventory.csv");
    await expect(page.getByText("Inventory exported")).toBeVisible();
  });

  await test.step("filter with no matches keeps the bar and shows the no-match state", async () => {
    await page.getByLabel(/Search brand \/ model/).fill("zzz-no-such-magazine");

    await expect(
      page.getByRole("heading", { name: "No magazines match your filters" }),
    ).toBeVisible();
    await expect(page.getByLabel(/Search brand \/ model/)).toBeVisible();
  });
});
