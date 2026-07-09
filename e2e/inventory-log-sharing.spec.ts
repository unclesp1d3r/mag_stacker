import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Inventory log (R7/R8/R12), UI layer, two browser contexts. R7: a firearm
 * edit-grantee can log events, and the entry's actor renders as THAT
 * grantee's name, not the owner's. R8/R12: a view-only grantee (on either a
 * firearm or a magazine) reads the log but gets no "Mark inventoried"/"Log…"
 * controls. The default `authTest` context owns and shares three items; a
 * second browser context carries the grantee's session. Cascade deletion
 * (R13) is covered at the integration layer in
 * `src/domain/inventory-log/__tests__/service.test.ts`. Mirrors
 * `range-sessions-sharing.spec.ts` and `detail-view-sharing.spec.ts`.
 */
const test = authTest("inventory-log-share");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("a firearm edit-grantee logs as themselves; view-grantees get no logging controls", async ({
  page,
  browser,
}) => {
  const grantee = readArtifact().users.find(
    (u) => u.key === "inventory-log-viewer",
  );
  if (!grantee) throw new Error("inventory-log-viewer not seeded");

  await test.step("owner creates two firearms and a magazine", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    let form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Edit Firearm");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    form = page.locator("form");
    await form.getByLabel(/^Name/).fill("View Firearm");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    const magForm = page.locator("form");
    await magForm.getByLabel("Brand / model").fill("View Mag");
    await magForm.getByLabel("Caliber").fill("9mm");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByText("Magazine seated").first()).toBeVisible();
  });

  await test.step("owner logs an entry on View Firearm and View Mag so there is something for a viewer to read", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "View Firearm" }).click();
    await page.getByRole("button", { name: "Mark inventoried" }).click();
    await expect(page.getByText("Marked inventoried").first()).toBeVisible();

    await page.goto("/magazines");
    await page.getByRole("link", { name: "View Mag" }).click();
    await page.getByRole("button", { name: "Mark inventoried" }).click();
    await expect(page.getByText("Marked inventoried").first()).toBeVisible();
  });

  await test.step("owner shares Edit Firearm at edit, and View Firearm + View Mag at view", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Edit Firearm" })
      .getByRole("button", { name: "Share" })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: grantee.email });
    await dialog.getByLabel("Permission").selectOption("edit");
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: grantee.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page
      .getByRole("row")
      .filter({ hasText: "View Firearm" })
      .getByRole("button", { name: "Share" })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: grantee.email });
    // Permission defaults to "view".
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: grantee.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await page.goto("/magazines");
    await page
      .getByRole("row")
      .filter({ hasText: "View Mag" })
      .getByRole("button", { name: "Share" })
      .click();
    dialog = page.getByRole("dialog");
    // Magazines offer view-only sharing — there is no Permission select (R13).
    await expect(dialog.getByLabel("Permission")).toHaveCount(0);
    await dialog.getByLabel("User").selectOption({ label: grantee.email });
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: grantee.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("the grantee logs on the edit-shared firearm, shown as themselves (R7)", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("inventory-log-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "Edit Firearm" }).click();
      await expect(
        gp.getByRole("heading", { level: 1, name: "Edit Firearm" }),
      ).toBeVisible();

      await gp.getByRole("button", { name: "Mark inventoried" }).click();
      await expect(gp.getByText("Marked inventoried").first()).toBeVisible();

      const rows = gp
        .getByRole("table")
        .filter({ has: gp.getByRole("columnheader", { name: "Actor" }) })
        .locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Inventoried");
      // R7: the actor is the grantee who performed the action, not the owner.
      await expect(rows.first()).toContainText("inventory-log-viewer");
    } finally {
      await granteeContext.close();
    }
  });

  await test.step("a view-grantee on the firearm sees the log but no controls (R8/R12)", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("inventory-log-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "View Firearm" }).click();
      await expect(
        gp.getByRole("heading", { level: 1, name: "View Firearm" }),
      ).toBeVisible();

      // Proves the read half of R8, not just the absent-controls half: the
      // owner's earlier "Mark inventoried" entry actually loads for the
      // viewer, attributed to the OWNER (not the viewer themselves).
      const rows = gp
        .getByRole("table")
        .filter({ has: gp.getByRole("columnheader", { name: "Actor" }) })
        .locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Inventoried");
      await expect(rows.first()).toContainText("inventory-log-share");

      await expect(
        gp.getByRole("button", { name: "Mark inventoried" }),
      ).toHaveCount(0);
      await expect(gp.getByRole("button", { name: "Log…" })).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });

  await test.step("a view-grantee on the magazine sees the log but no controls (R8/R12)", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("inventory-log-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/magazines");
      await gp.getByRole("link", { name: "View Mag" }).click();
      await expect(
        gp.getByRole("heading", { level: 1, name: "View Mag" }),
      ).toBeVisible();

      // Same read-path proof as the firearm case above.
      const rows = gp
        .getByRole("table")
        .filter({ has: gp.getByRole("columnheader", { name: "Actor" }) })
        .locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Inventoried");
      await expect(rows.first()).toContainText("inventory-log-share");

      await expect(
        gp.getByRole("button", { name: "Mark inventoried" }),
      ).toHaveCount(0);
      await expect(gp.getByRole("button", { name: "Log…" })).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });
});
