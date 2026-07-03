import { authTest, expect } from "./fixtures/auth";

/**
 * Firearm nickname (#18): optional owner nickname distinct from the product
 * name, shown nickname-primary with a product-name secondary line; the delete
 * confirmation names the firearm by its displayed label. Covers AE1/AE3. One
 * sequential test on a fresh "firearm-nickname" user — each step builds on the
 * last.
 */
const test = authTest("firearm-nickname");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("nickname-primary display, fallback, and delete label", async ({
  page,
}) => {
  await test.step("AE1: create with a nickname → nickname primary, product name secondary", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Glock 19 Gen 5");
    await form.getByLabel("Nickname", { exact: true }).fill("Nightstand gun");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged").first()).toBeVisible();
    // The row leads with the nickname and carries the product name alongside it.
    const row = page.getByRole("row").filter({ hasText: "Nightstand gun" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Glock 19 Gen 5");
  });

  await test.step("AE1: create without a nickname → product name only", async () => {
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("M&P Shield Plus");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged").first()).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "M&P Shield Plus" }),
    ).toHaveCount(1);
  });

  await test.step("a whitespace-only nickname falls back to the product name", async () => {
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Zulu Product");
    await form.getByLabel("Nickname", { exact: true }).fill("   ");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("bolt");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged").first()).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Zulu Product" }),
    ).toHaveCount(1);
  });

  await test.step("editing a firearm to add a nickname flips it to nickname-primary", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "M&P Shield Plus" })
      .getByRole("button", { name: "Edit" })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Nickname", { exact: true }).fill("Backup");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Changes saved").first()).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Backup" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("M&P Shield Plus");
  });

  await test.step("AE3: the delete confirmation names the firearm by its nickname", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "Nightstand gun" })
      .getByRole("button", { name: "Delete" })
      .click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // R6: the confirmation echoes the displayed label (the nickname), not the
    // product name.
    await expect(dialog).toContainText("Nightstand gun");
    await expect(dialog).not.toContainText("Glock 19 Gen 5");

    // Leave the row in place — this assertion is about the label, not deletion.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("row").filter({ hasText: "Nightstand gun" }),
    ).toHaveCount(1);
  });
});
