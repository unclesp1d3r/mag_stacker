import { authTest, expect } from "./fixtures/auth";

/**
 * Firearms taxonomy: required type/action on write (R6/R7), the list Type
 * column (R10), and the client-side type filter (R11). Covers AE1/AE2/AE4. One
 * sequential test on a fresh "firearm-taxonomy" user — each step builds on the
 * last, mirroring real usage.
 */
const test = authTest("firearm-taxonomy");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("required classification, Type column, and type filter", async ({
  page,
}) => {
  await test.step("AE2: creating without a type/action is blocked", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel("Name", { exact: true }).fill("Glock 19");
    await form.getByLabel("Caliber").fill("9mm");
    // Leave Type/Action at their placeholder and submit.
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Choose a firearm type")).toBeVisible();
    await expect(page.getByText("Choose a firearm action")).toBeVisible();
    // Nothing persisted.
    await expect(page.getByText("Firearm logged")).toHaveCount(0);
  });

  await test.step("completing the classification creates the firearm", async () => {
    const form = page.locator("form");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Subtype").fill("Striker-fired");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged")).toBeVisible();
    // R10: the Type shows in the list.
    await expect(
      page.getByRole("row").filter({ hasText: "Glock 19" }),
    ).toContainText("Pistol");
  });

  await test.step("add a second firearm of a different type", async () => {
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel("Name", { exact: true }).fill("Remington 700");
    await form.getByLabel("Caliber").fill(".308");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("bolt");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Remington 700" }),
    ).toContainText("Rifle");
  });

  await test.step("AE4: filtering by type narrows to that type; All restores", async () => {
    await page.getByLabel("Filter by type").selectOption("pistol");
    await expect(
      page.getByRole("row").filter({ hasText: "Glock 19" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("row").filter({ hasText: "Remington 700" }),
    ).toHaveCount(0);

    await page.getByLabel("Filter by type").selectOption("all");
    await expect(
      page.getByRole("row").filter({ hasText: "Remington 700" }),
    ).toHaveCount(1);
  });

  await test.step("AE1 (UI): reverting type to the placeholder blocks the save", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "Glock 19" })
      .getByRole("button", { name: "Edit" })
      .click();
    const form = page.locator("form");
    await form.getByLabel(/^Type/).selectOption("unspecified");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Choose a firearm type")).toBeVisible();
    await expect(page.getByText("Changes saved")).toHaveCount(0);
  });
});
