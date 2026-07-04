import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Read-only detail view (#19), UI layer. The owner sees full actions on the
 * dedicated detail routes; a view-only grantee gets read-only pages — including
 * the firearm serial (R4) and read-only range-session history (R14) — with no
 * Edit/Delete/Share (R7); a no-access URL resolves as not-found without exposing
 * fields (R9); deleting from the detail page returns to the list (R15). Two
 * seeded users: the default context owns and shares; a second context carries
 * the viewer's session. Server-side magazine owner-only enforcement (AE6) is
 * covered in src/domain/magazines/__tests__/authorize-owner-only.test.ts.
 */
const test = authTest("detail-view-owner");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("permission-gated read-only detail routes", async ({ page, browser }) => {
  const viewer = readArtifact().users.find(
    (u) => u.key === "detail-view-viewer",
  );
  if (!viewer) throw new Error("detail-view-viewer not seeded");

  await test.step("owner creates a firearm (with serial) and a magazine", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Detail Rifle");
    await form.getByLabel("Manufacturer").fill("Colt");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Subtype").fill("AR-pattern");
    await form.getByLabel("Serial number").fill("SN-DETAIL-01");
    await form.getByLabel("Notes").fill("Range only.");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    // A second firearm shared at EDIT exercises the firearm edit-grantee tier.
    await page.getByRole("button", { name: "Add firearm" }).click();
    const editForm = page.locator("form");
    await editForm.getByLabel(/^Name/).fill("Edit Rifle");
    await editForm.getByLabel("Caliber").fill("9mm");
    await editForm.getByLabel(/^Type/).selectOption("pistol");
    await editForm.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    const magForm = page.locator("form");
    await magForm.getByLabel("Brand / model").fill("Detail Mag");
    await magForm.getByLabel("Caliber").fill("5.56");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByText("Magazine seated").first()).toBeVisible();
  });

  await test.step("owner detail pages expose Edit/Delete/Share and the serial (AE2)", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Detail Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Detail Rifle" }),
    ).toBeVisible();
    // R2/R5: every field renders, including ones omitted from the list.
    await expect(page.getByText("SN-DETAIL-01")).toBeVisible();
    await expect(page.getByText("Colt")).toBeVisible();
    await expect(page.getByText("AR-pattern")).toBeVisible();
    await expect(page.getByText("Range only.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();

    await page.goto("/magazines");
    await page.getByRole("link", { name: "Detail Mag" }).click();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  });

  await test.step("owner shares both records view-only with the viewer", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Detail Rifle" })
      .getByRole("button", { name: "Share" })
      .click();
    const faDialog = page.getByRole("dialog");
    await faDialog.getByLabel("User").selectOption({ label: viewer.email });
    await faDialog.getByRole("button", { name: "Share" }).click();
    await expect(
      faDialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await faDialog.getByRole("button", { name: "Done" }).click();

    await page.goto("/magazines");
    await page
      .getByRole("row")
      .filter({ hasText: "Detail Mag" })
      .getByRole("button", { name: "Share" })
      .click();
    const magDialog = page.getByRole("dialog");
    // Magazines offer view-only sharing — there is no Permission select (R13).
    await expect(magDialog.getByLabel("Permission")).toHaveCount(0);
    await magDialog.getByLabel("User").selectOption({ label: viewer.email });
    await magDialog.getByRole("button", { name: "Share" }).click();
    await expect(
      magDialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await magDialog.getByRole("button", { name: "Done" }).click();

    // Share the second firearm at EDIT to exercise the edit-grantee tier.
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Edit Rifle" })
      .getByRole("button", { name: "Share" })
      .click();
    const editDialog = page.getByRole("dialog");
    await editDialog.getByLabel("User").selectOption({ label: viewer.email });
    await editDialog.getByLabel("Permission").selectOption("edit");
    await editDialog.getByRole("button", { name: "Share" }).click();
    await expect(
      editDialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await editDialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("view-only grantee gets read-only pages; serial visible, no controls (AE1/AE5/AE7)", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("detail-view-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();

      await vp.goto("/firearms");
      await vp.getByRole("link", { name: "Detail Rifle" }).click();
      // AE5: the serial is visible to a view-only firearm grantee.
      await expect(vp.getByText("SN-DETAIL-01")).toBeVisible();
      await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);
      // AE7: session history is read-only — no logging control.
      await expect(vp.getByRole("button", { name: "Log session" })).toHaveCount(
        0,
      );

      await vp.goto("/magazines");
      await vp.getByRole("link", { name: "Detail Mag" }).click();
      // AE1: magazine view-grantee sees a read-only page with no actions.
      await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);

      // Firearm edit-grantee tier: Edit is available, Delete/Share are not (R8).
      await vp.goto("/firearms");
      await vp.getByRole("link", { name: "Edit Rifle" }).click();
      await expect(vp.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });

  await test.step("a no-access detail URL resolves as not-found for both entities (AE4/R9)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`/firearms/${fakeId}`);
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
    await page.goto(`/magazines/${fakeId}`);
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
    // A malformed (non-uuid) id resolves as not-found too, never a 500.
    await page.goto("/firearms/not-a-real-id");
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
  });

  await test.step("owner deletes the firearm from its detail page and lands on the list (AE3)", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Detail Rifle" }).click();
    // Wait for the detail page so Delete resolves to the page action, not one of
    // the list rows' owner-only quick-Delete buttons.
    await expect(
      page.getByRole("heading", { level: 1, name: "Detail Rifle" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL(/\/firearms$/);
    await expect(
      page.getByRole("row").filter({ hasText: "Detail Rifle" }),
    ).toHaveCount(0);
  });

  await test.step("owner deletes the magazine from its detail page and lands on the list (AE3)", async () => {
    await page.goto("/magazines");
    await page.getByRole("link", { name: "Detail Mag" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Detail Mag" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL(/\/magazines$/);
    await expect(
      page.getByRole("row").filter({ hasText: "Detail Mag" }),
    ).toHaveCount(0);
  });
});
