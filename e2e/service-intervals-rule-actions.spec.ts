import { authTest, expect } from "./fixtures/auth";

/**
 * Regression coverage for the code-review finding: "Suppress" on an
 * item-only rule silently destroyed its thresholds with no honest path back
 * (KTD6's exactly-one-of-thresholds-or-suppressed CHECK forces a suppressed
 * row's thresholds to null, and "Restore" only ever deletes the row — there
 * is no default underneath an item-only rule for that deletion to fall back
 * to). The fix: an item-only rule now offers "Remove" (delete the row
 * outright, with a toast that says so) instead of "Suppress". `inherited`
 * and `overridden` rules keep "Suppress" exactly as before — this spec
 * proves both halves: the new item-only affordance, and that the
 * pre-existing inherited/overridden suppress-then-restore cycle is
 * untouched.
 */
const test = authTest("service-intervals-rule-actions");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("an item-only rule offers Remove (not Suppress) and deletes on click; inherited/overridden rules keep Suppress unchanged", async ({
  page,
}) => {
  await test.step("owner creates a rifle", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Rule Actions Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();
    await page.getByRole("link", { name: "Rule Actions Rifle" }).click();
  });

  await test.step("an item-only rule offers Remove, never Suppress or Override", async () => {
    await page.getByRole("button", { name: "Add item-only rule" }).click();
    const addForm = page.locator("form");
    await addForm.getByLabel("Rule name").fill("Recoil spring");
    await addForm.getByLabel("Days").fill("90");
    await addForm.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Item-only rule added")).toBeVisible();

    const panel = page.getByRole("region", { name: "Service rules" });
    await expect(
      panel.getByRole("row").filter({ hasText: "Recoil spring" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove Recoil spring" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Suppress Recoil spring" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Override Recoil spring" }),
    ).toHaveCount(0);
  });

  await test.step("Remove deletes the item-only rule outright — it never lands in Suppressed rules", async () => {
    await page.getByRole("button", { name: "Remove Recoil spring" }).click();
    await expect(page.getByText("Recoil spring removed")).toBeVisible();

    const panel = page.getByRole("region", { name: "Service rules" });
    await expect(
      panel.getByRole("row").filter({ hasText: "Recoil spring" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Restore Recoil spring" }),
    ).toHaveCount(0);
  });

  await test.step("owner arms the Rifle category with a Cleaning default — the rifle inherits it", async () => {
    await page.goto("/settings/service");
    const rifleSection = page.getByRole("region", { name: "Rifle" });
    await rifleSection.getByRole("button", { name: "Add rule" }).click();
    const form = rifleSection.locator("form");
    await form.getByLabel("Rule name").fill("Cleaning");
    await form.getByLabel("Days").fill("180");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Rifle rule added")).toBeVisible();

    await page.goto("/firearms");
    await page.getByRole("link", { name: "Rule Actions Rifle" }).click();
  });

  await test.step("the inherited Cleaning rule offers Suppress (unchanged) — not Remove", async () => {
    await expect(
      page.getByRole("button", { name: "Suppress Cleaning" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove Cleaning" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reset Cleaning to inherited" }),
    ).toHaveCount(0);
  });

  await test.step("overriding Cleaning keeps Suppress (not Remove) and adds Reset to inherited", async () => {
    await page.getByRole("button", { name: "Override Cleaning" }).click();
    const overrideForm = page.locator("form");
    await overrideForm.getByLabel("Days").fill("30");
    await overrideForm.getByRole("button", { name: "Save override" }).click();
    await expect(page.getByText("Cleaning updated")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Reset Cleaning to inherited" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Suppress Cleaning" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove Cleaning" }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Reset Cleaning to inherited" })
      .click();
    await expect(page.getByText("Cleaning reset to inherited")).toBeVisible();
  });

  await test.step("suppressing then restoring the inherited Cleaning rule still behaves exactly as before", async () => {
    await page.getByRole("button", { name: "Suppress Cleaning" }).click();
    await expect(page.getByText("Cleaning suppressed")).toBeVisible();

    const panel = page.getByRole("region", { name: "Service rules" });
    await expect(
      panel.getByRole("row").filter({ hasText: "Cleaning" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Restore Cleaning" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Restore Cleaning" }).click();
    await expect(page.getByText("Cleaning restored")).toBeVisible();
    await expect(
      panel.getByRole("row").filter({ hasText: "Cleaning" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Suppress Cleaning" }),
    ).toBeVisible();
  });
});
