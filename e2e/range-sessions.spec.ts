import { authTest, expect } from "./fixtures/auth";

/**
 * Shot count tracking (#11): log range sessions per firearm and see a DERIVED
 * lifetime round total that updates as sessions are logged and deleted. Covers
 * AE1 end-to-end through the real UI (log → total → history → delete decrements).
 * AE2 (view-only sharees cannot mutate sessions) is proven at the integration
 * layer in src/domain/range-sessions/__tests__/service.test.ts — the single-user
 * e2e harness has no two-user sharing flow. One sequential test on a fresh
 * "range-sessions" user; each step builds on the last.
 */
const test = authTest("range-sessions");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("derived lifetime total tracks logged and deleted sessions", async ({
  page,
}) => {
  await test.step("a new firearm starts at zero rounds", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Range Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();

    await expect(page.getByText("Firearm logged").first()).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Range Rifle" });
    await expect(row).toContainText("0");
  });

  await test.step("logging a session sets the derived total", async () => {
    // Sessions now live on the firearm detail page — reach it via the row link.
    await page.getByRole("link", { name: "Range Rifle" }).click();
    await page.getByRole("button", { name: "Log session" }).click();

    const form = page.locator("form");
    await form.getByLabel("Date").fill("2026-03-15");
    await form.getByLabel("Rounds fired").fill("137");
    await form.getByRole("button", { name: "Log session" }).click();

    await expect(page.getByText("Session logged").first()).toBeVisible();
    await expect(
      page.getByText("137 rounds fired over 1 session"),
    ).toBeVisible();
  });

  await test.step("a second session sums into the total", async () => {
    await page.getByRole("button", { name: "Log session" }).click();
    const form = page.locator("form");
    await form.getByLabel("Date").fill("2026-03-16");
    await form.getByLabel("Rounds fired").fill("88");
    await form.getByRole("button", { name: "Log session" }).click();

    await expect(
      page.getByText("225 rounds fired over 2 sessions"),
    ).toBeVisible();
    // The firearms list reflects the derived total; return to the detail page.
    await page.goto("/firearms");
    await expect(
      page.getByRole("row").filter({ hasText: "Range Rifle" }),
    ).toContainText("225");
    await page.getByRole("link", { name: "Range Rifle" }).click();
  });

  await test.step("deleting a session decreases the total", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "88" })
      .getByRole("button", { name: "Delete" })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Session removed").first()).toBeVisible();
    await expect(
      page.getByText("137 rounds fired over 1 session"),
    ).toBeVisible();
  });
});
