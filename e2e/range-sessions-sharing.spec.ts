import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Shot count tracking (#11) — AE2 at the UI layer: a firearm shared VIEW-only
 * lets the sharee read the lifetime total and session history but exposes no
 * Log/Edit/Delete controls (KTD7 permission gating). Two seeded users: the
 * default `authTest` context owns and shares the firearm; a second browser
 * context carries the viewer's session. Server enforcement of the same rule is
 * covered in src/domain/range-sessions/__tests__/service.test.ts.
 */
const test = authTest("range-sessions-share");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("a view-only sharee reads the total and history but sees no session controls", async ({
  page,
  browser,
}) => {
  const viewer = readArtifact().users.find(
    (u) => u.key === "range-sessions-viewer",
  );
  if (!viewer) throw new Error("range-sessions-viewer not seeded");

  await test.step("owner logs a session on a firearm", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Shared Carbine");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    // Sessions live on the firearm detail page now — reach it via the row link.
    await page.getByRole("link", { name: "Shared Carbine" }).click();
    await page.getByRole("button", { name: "Log session" }).click();
    const sessionForm = page.locator("form");
    await sessionForm.getByLabel("Date").fill("2026-03-20");
    await sessionForm.getByLabel("Rounds fired").fill("42");
    await sessionForm.getByRole("button", { name: "Log session" }).click();
    await expect(page.getByText("Session logged").first()).toBeVisible();
    // Back to the list for the (owner-only) quick Share action.
    await page.goto("/firearms");
  });

  await test.step("owner shares the firearm view-only with the viewer", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "Shared Carbine" })
      .getByRole("button", { name: "Share" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    // Permission defaults to "view".
    await dialog.getByRole("button", { name: "Share" }).click();
    // Confirm the grant landed via the "Shared with" list item (scoped to avoid
    // the still-present dropdown option carrying the same email).
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("the viewer reads the total and history but has no controls", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("range-sessions-viewer"),
    });
    try {
      const viewerPage = await viewerContext.newPage();
      await viewerPage.goto("/firearms");

      const row = viewerPage
        .getByRole("row")
        .filter({ hasText: "Shared Carbine" });
      await expect(row).toContainText("42");
      // Open the read-only detail page via the row link.
      await viewerPage.getByRole("link", { name: "Shared Carbine" }).click();

      // Reads the derived total and the logged session.
      await expect(
        viewerPage.getByText("42 rounds fired over 1 session"),
      ).toBeVisible();
      // No write controls: the panel's "Log session" action is gated on edit
      // rights (KTD7), and Edit/Delete are absent for a view-only sharee.
      await expect(
        viewerPage.getByRole("button", { name: "Log session" }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", { name: "Edit" }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", { name: "Delete" }),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
});
