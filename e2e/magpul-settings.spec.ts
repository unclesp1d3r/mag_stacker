import { authTest, expect } from "./fixtures/auth";

/**
 * Settings toggle (U6, R1) and integration with the magazine form.
 *
 * The "magpul-settings" user starts with Magpul mode off. The spec walks
 * through enabling the toggle, verifying persistence (AE9), and checking that
 * an existing nonconforming label is shown verbatim until edited (AE7/AE8).
 * All assertions use ARIA roles / accessible names / visible text — no
 * data-testid.
 */
const test = authTest("magpul-settings");

// No retries: state accumulates across steps (magazine created, mode toggled).
test.describe.configure({ retries: 0 });

const NONCONFORMING_LABEL = "range gun";
const MAG_BRAND = "Test Mag";

test("Settings toggle, grandfather behavior, and persistence", async ({
  page,
}) => {
  await test.step("settings page is reachable via nav and shows toggle off", async () => {
    await page.goto("/settings");
    await expect(
      page.getByRole("checkbox", { name: /Magpul mode/ }),
    ).not.toBeChecked();
  });

  await test.step("create a magazine with a nonconforming label while mode is off", async () => {
    await page.goto("/magazines");
    // Cold start: no firearms → "Set up your inventory" empty state.
    await page.getByRole("button", { name: "Start with a magazine" }).click();
    const form = page.locator("form");
    await form.getByLabel("Brand / model").fill(MAG_BRAND);
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Label", { exact: true }).fill(NONCONFORMING_LABEL);
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByText("Magazine seated")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: MAG_BRAND }),
    ).toHaveCount(1);
  });

  await test.step("toggle Magpul mode on via Settings nav link", async () => {
    await page.getByRole("link", { name: "Settings" }).click();
    // The toggle saves via a fire-and-forget transition; wait for the server
    // action's POST to resolve so the write has committed before we navigate
    // away and read the flag back (otherwise the next page can race the write).
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === "POST" && res.status() === 200,
      ),
      page.getByRole("checkbox", { name: /Magpul mode/ }).check(),
    ]);
    await expect(
      page.getByRole("checkbox", { name: /Magpul mode/ }),
    ).toBeChecked();
  });

  await test.step("magazines label field shows the Magpul hint after mode is enabled", async () => {
    await page.goto("/magazines");
    await page
      .getByRole("row")
      .filter({ hasText: MAG_BRAND })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByText(/Max 4/)).toBeVisible();
  });

  await test.step("existing nonconforming label shows verbatim until edited (AE7)", async () => {
    const labelInput = page
      .locator("form")
      .getByLabel("Label", { exact: true });
    await expect(labelInput).toHaveValue(NONCONFORMING_LABEL);
  });

  await test.step("editing the label field applies the mask (AE8)", async () => {
    const labelInput = page
      .locator("form")
      .getByLabel("Label", { exact: true });
    await labelInput.fill("ar15");
    await expect(labelInput).toHaveValue("AR15");
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("Magpul mode persists across page reload (AE9)", async () => {
    await page.goto("/settings");
    await expect(
      page.getByRole("checkbox", { name: /Magpul mode/ }),
    ).toBeChecked();
  });
});
