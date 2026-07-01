import type { Page } from "@playwright/test";
import { authTest, expect } from "./fixtures/auth";

/**
 * Accessible delete confirmation (R7): the app replaced native confirm() with a
 * focus-managed alertdialog. Each test seeds its own uniquely-named magazine
 * (the "delete-dialog" user accumulates rows across tests under workers:1), then
 * exercises the dialog's a11y contract — role, initial focus, Escape-to-cancel
 * with focus return, and confirm-removes-with-toast.
 */
const test = authTest("delete-dialog");

// Never retry: each test seeds rows into the shared per-spec account with no
// cleanup, so a retry would leave duplicate brands and break strict locators.
test.describe.configure({ retries: 0 });

/** Create a magazine with a unique brand. */
async function seedMagazine(page: Page, brand: string): Promise<void> {
  await page.goto("/magazines");
  const coldStart = page.getByRole("button", { name: "Start with a magazine" });
  // isVisible() returns false for a missing element without throwing.
  if (await coldStart.isVisible()) {
    await coldStart.click();
  } else {
    await page.getByRole("button", { name: "Add magazine" }).click();
  }
  // Scope to the form: the filter bar (present once a magazine exists) shares
  // the "Brand / model" and "Caliber" label text.
  const form = page.locator("form");
  await form.getByLabel("Brand / model").fill(brand);
  await form.getByLabel("Caliber").fill("9mm");
  await page.getByRole("button", { name: "Add magazine" }).click();
  await expect(page.getByText("Magazine seated")).toBeVisible();
}

test.describe("delete confirmation dialog (R7)", () => {
  test("opens an alertdialog with focus on Cancel; Escape cancels and restores focus", async ({
    page,
  }) => {
    const brand = "CancelMe Mag";
    await seedMagazine(page, brand);

    const trigger = page
      .getByRole("row")
      .filter({ hasText: brand })
      .getByRole("button", { name: "Delete" });
    await trigger.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // Initial focus lands on the safe action, not the destructive one.
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Focus returns to the row's Delete trigger.
    await expect(trigger).toBeFocused();
    // Cancel left the row in place.
    await expect(page.getByRole("row").filter({ hasText: brand })).toHaveCount(
      1,
    );
  });

  test("confirming removes the row and shows the removal toast", async ({
    page,
  }) => {
    const brand = "ConfirmDelete Mag";
    await seedMagazine(page, brand);

    await page
      .getByRole("row")
      .filter({ hasText: brand })
      .getByRole("button", { name: "Delete" })
      .click();

    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Magazine removed")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: brand })).toHaveCount(
      0,
    );
  });
});
