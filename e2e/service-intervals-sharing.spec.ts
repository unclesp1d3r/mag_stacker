import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Service interval tracking (issue #10), the KTD3 permission gate — the same
 * shape as `inventory-log-sharing.spec.ts` and `range-sessions-sharing.spec.ts`:
 * the default `authTest` context owns and shares two firearms plus one
 * mounted accessory; a second browser context carries the grantee's session.
 *
 * KTD3: an edit-grantee on a firearm may log service but never configure
 * rules; a view-grantee gets neither; accessories are owner-only throughout,
 * so a firearm grantee's inherited accessory access never extends to that
 * accessory's OWN service configuration or history, however much of the rest
 * of the accessory record they can see. Each firearm carries one item-only
 * rule (added by the owner) so a grantee has something to observe — due
 * state itself is out of scope here (that's `service-intervals.spec.ts`).
 */
const test = authTest("service-intervals-share");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("an edit-grantee logs service but gets no rule actions; a view-grantee gets neither; accessory service stays owner-only", async ({
  page,
  browser,
}) => {
  const grantee = readArtifact().users.find(
    (u) => u.key === "service-intervals-viewer",
  );
  if (!grantee) throw new Error("service-intervals-viewer not seeded");

  await test.step("owner creates two rifles, each with an item-only Cleaning rule", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    let form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Grantee Edit Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Grantee View Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();

    for (const name of ["Grantee Edit Rifle", "Grantee View Rifle"]) {
      await page.goto("/firearms");
      await page.getByRole("link", { name }).click();
      await page.getByRole("button", { name: "Add item-only rule" }).click();
      const ruleForm = page.locator("form");
      await ruleForm.getByLabel("Rule name").fill("Cleaning");
      await ruleForm.getByLabel("Days").fill("1");
      await ruleForm.getByRole("button", { name: "Add rule" }).click();
      await expect(page.getByText("Item-only rule added")).toBeVisible();
    }
  });

  await test.step("owner mounts an accessory on the edit-shared firearm", async () => {
    await page.goto("/accessories");
    await page
      .getByRole("button", { name: "Add your first accessory" })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Category").fill("Optic");
    await form.getByLabel("Model").fill("Shared Optic");
    await form
      .getByLabel("Mount on firearm")
      .selectOption({ label: "Grantee Edit Rifle" });
    await page.getByRole("button", { name: "Add accessory" }).click();
    await expect(page.getByText("Accessory logged").first()).toBeVisible();
  });

  await test.step("owner shares Grantee Edit Rifle at edit and Grantee View Rifle at view", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Grantee Edit Rifle" })
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
      .filter({ hasText: "Grantee View Rifle" })
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
  });

  await test.step("the edit-grantee logs service but sees no rule-management actions", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("service-intervals-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "Grantee Edit Rifle" }).click();

      const panel = gp.getByRole("region", { name: "Service rules" });
      await expect(
        panel.getByRole("row").filter({ hasText: "Cleaning" }),
      ).toBeVisible();
      await expect(
        gp.getByRole("button", { name: "Log service — Cleaning" }),
      ).toBeVisible();
      await expect(
        gp.getByRole("button", { name: "Override Cleaning" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("button", { name: "Suppress Cleaning" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("button", { name: "Add item-only rule" }),
      ).toHaveCount(0);

      await gp.getByRole("button", { name: "Log service — Cleaning" }).click();
      const form = gp.locator("form");
      await form.getByLabel("Notes").fill("Serviced by the edit grantee.");
      await form.getByRole("button", { name: "Log service" }).click();
      await expect(gp.getByText("Logged service — Cleaning")).toBeVisible();

      // The history names the ACTING grantee, not the owner (mirrors R7's
      // inventory-log actor rule, carried into service events by KTD3).
      const history = gp.getByRole("region", { name: "Service history" });
      await expect(history).toContainText("Cleaning");
      await expect(history).toContainText("service-intervals-viewer");
    } finally {
      await granteeContext.close();
    }
  });

  await test.step("the view-grantee sees the rule but no log-service control and no rule actions", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("service-intervals-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "Grantee View Rifle" }).click();

      const panel = gp.getByRole("region", { name: "Service rules" });
      await expect(
        panel.getByRole("row").filter({ hasText: "Cleaning" }),
      ).toBeVisible();
      await expect(
        gp.getByRole("button", { name: "Log service — Cleaning" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("button", { name: "Override Cleaning" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("button", { name: "Suppress Cleaning" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("button", { name: "Add item-only rule" }),
      ).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });

  await test.step("accessory service configuration never reaches the firearm's grantee, mounted or not", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("service-intervals-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "Grantee Edit Rifle" }).click();
      // The mounted accessory is visible (inherited edit permission) — reach
      // its own detail page via that inheritance, the exact path that would
      // leak service configuration if KTD3's accessory gate had a hole.
      await gp.getByRole("link", { name: "Shared Optic" }).click();
      await expect(
        gp.getByRole("heading", { level: 1, name: "Shared Optic" }),
      ).toBeVisible();

      await expect(
        gp.getByRole("region", { name: "Service rules" }),
      ).toHaveCount(0);
      await expect(
        gp.getByRole("region", { name: "Service history" }),
      ).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });
});
