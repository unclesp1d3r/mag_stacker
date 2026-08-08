import { authTest, expect } from "./fixtures/auth";

/**
 * Non-magazine-fed firearms (#37): the form toggle (R2), exclusion from the
 * magazine form's compatible-firearm options (R5), the blank **# Mags** cell
 * (R6), and the guard that refuses the transition while a magazine still lists
 * the firearm (R4). One sequential test on a fresh user — each step builds on
 * the last, mirroring real usage.
 */
const test = authTest("firearm-magazine-fed");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

/**
 * `{ exact: true }` throughout: Playwright's accessible-name matching is
 * substring-based, so a future label addition could otherwise make this
 * ambiguous. See
 * docs/solutions/test-failures/playwright-accessible-name-matches-by-substring.md.
 */
const MAG_FED_LABEL = "This firearm uses detachable magazines";

test("magazine-fed toggle drives options, the # Mags cell, and the guard", async ({
  page,
}) => {
  await test.step("R2: the checkbox is checked by default on create", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await expect(
      page.getByRole("checkbox", { name: MAG_FED_LABEL, exact: true }),
    ).toBeChecked();
  });

  await test.step("create a break-action shotgun with the box unchecked", async () => {
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Stevens 311");
    await form.getByLabel("Caliber").fill("12 gauge");
    await form.getByLabel(/^Type/).selectOption("shotgun");
    await form.getByLabel("Action").selectOption("break");
    await page
      .getByRole("checkbox", { name: MAG_FED_LABEL, exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged")).toBeVisible();
  });

  await test.step("R6: its # Mags cell reads an em dash, not 0", async () => {
    await expect(
      page.getByRole("row").filter({ hasText: "Stevens 311" }),
    ).toContainText("—");
  });

  await test.step("create a magazine-fed pistol; its # Mags reads 0", async () => {
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Glock 19");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    // R2: left checked — the default.
    await expect(
      page.getByRole("checkbox", { name: MAG_FED_LABEL, exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged")).toBeVisible();
    // R9: keyed off the flag, not the count — a magazine-fed firearm with no
    // magazines still shows a real 0.
    await expect(
      page.getByRole("row").filter({ hasText: "Glock 19" }),
    ).toContainText("0");
  });

  await test.step("R5: the magazine form offers only the magazine-fed firearm", async () => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    const compatibility = page.getByRole("group", {
      name: "Compatible firearms",
    });
    await expect(
      compatibility.getByRole("checkbox", { name: "Glock 19", exact: true }),
    ).toBeVisible();
    await expect(
      compatibility.getByRole("checkbox", { name: "Stevens 311", exact: true }),
    ).toHaveCount(0);
  });

  await test.step("attach a magazine to the magazine-fed firearm", async () => {
    const form = page.locator("form");
    await form.getByLabel("Brand / model").fill("Glock OEM");
    await form.getByLabel("Caliber").fill("9mm");
    await page
      .getByRole("group", { name: "Compatible firearms" })
      .getByRole("checkbox", { name: "Glock 19", exact: true })
      .check();
    await page.getByRole("button", { name: "Add magazine" }).click();

    await expect(page.getByText("Magazine seated")).toBeVisible();
  });

  await test.step("R4: the guard blocks unchecking while a magazine lists it", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Glock 19" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("checkbox", { name: MAG_FED_LABEL, exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByText(
        "Remove this firearm's compatible magazines before marking it non-magazine-fed",
      ),
    ).toBeVisible();
    await expect(page.getByText("Changes saved")).toHaveCount(0);
    // The control is flagged invalid but KEEPS the user's unchecked state —
    // reverting it would silently discard what they just did. Nothing
    // persisted, which the reload below proves.
    await expect(
      page.getByRole("checkbox", { name: MAG_FED_LABEL, exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  await test.step("the rejection did not persist: still magazine-fed after a reload", async () => {
    await page.reload();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByRole("checkbox", { name: MAG_FED_LABEL, exact: true }),
    ).toBeChecked();
  });

  await test.step("unlinking the magazine lets the toggle through", async () => {
    await page.goto("/magazines");
    await page.getByRole("link", { name: "Glock OEM" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("group", { name: "Compatible firearms" })
      .getByRole("checkbox", { name: "Glock 19", exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    await page.goto("/firearms");
    await page.getByRole("link", { name: "Glock 19" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("checkbox", { name: MAG_FED_LABEL, exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Changes saved")).toBeVisible();
  });
});
