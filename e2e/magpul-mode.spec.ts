import { authTest, expect } from "./fixtures/auth";

/**
 * Magpul mode label input mask in the magazine form (U5, R9).
 *
 * The "magpul-mode" user has Magpul mode pre-enabled by the launcher via a
 * direct Drizzle update after account creation. All assertions use ARIA roles
 * / accessible names / visible text — no data-testid.
 */
const test = authTest("magpul-mode");

// No retries: the user account accumulates state (a magazine is created in
// step 2 and re-used in later steps).
test.describe.configure({ retries: 0 });

test("label input mask is active when Magpul mode is on", async ({ page }) => {
  await test.step("open the add-magazine form (cold start)", async () => {
    await page.goto("/magazines");
    // Cold start: no firearms, no magazines → "Set up your inventory" empty state.
    await page.getByRole("button", { name: "Start with a magazine" }).click();
  });

  await test.step("label field shows Magpul mode hint text", async () => {
    await expect(page.getByText(/Max 4/)).toBeVisible();
  });

  await test.step("fill with lowercase + invalid chars → transformed to uppercase A-Z/0-9/-", async () => {
    const labelInput = page.locator("form").getByLabel("Label");
    await labelInput.fill("ar!15");
    await expect(labelInput).toHaveValue("AR15");
  });

  await test.step("fill beyond 4 characters → truncated to 4", async () => {
    const labelInput = page.locator("form").getByLabel("Label");
    await labelInput.fill("ABCDE");
    await expect(labelInput).toHaveValue("ABCD");
  });

  await test.step("filter runs before cap: 'AB.CDE' → 'ABCD' (not 'ABC')", async () => {
    // Distinguishes filter-then-cap from cap-then-filter: dropping the '.' first
    // yields "ABCDE" → capped "ABCD"; capping first would give "AB.C" → "ABC".
    const labelInput = page.locator("form").getByLabel("Label");
    await labelInput.fill("AB.CDE");
    await expect(labelInput).toHaveValue("ABCD");
  });

  await test.step("a valid label passes through unchanged", async () => {
    const labelInput = page.locator("form").getByLabel("Label");
    await labelInput.fill("AR15");
    await expect(labelInput).toHaveValue("AR15");
  });

  await test.step("cancel closes the form", async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("form")).not.toBeVisible();
  });
});
