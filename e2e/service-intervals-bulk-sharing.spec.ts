import { isoDateDaysAgo } from "@/src/demo/inventory";
import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Regression coverage for the code-review finding: a view-only grantee's
 * `/summary` bulk mark-serviced checklist must never offer a row for an item
 * they cannot log service on (KTD3). `listDueForVisibleCollection` legitimately
 * includes a shared firearm at every visibility tier — the roll-up counts are
 * information, not an action, and stay unchanged (`service-intervals-bulk.spec.ts`
 * covers the roll-up/owner path) — but `logServiceEventsBulk` only ever
 * authorizes an owner or edit-grantee, never a view-only one. Before the fix,
 * a view-grantee saw the shared firearm's due rule as a selectable checkbox
 * that would throw (and roll back the whole batch) if checked and submitted.
 *
 * Distinct owner user from `service-intervals-bulk` (that spec's account has
 * its own, unrelated due backlog) sharing into the existing
 * `service-intervals-viewer` grantee (already used as a grantee elsewhere,
 * carries no firearms of its own).
 */
const test = authTest("service-intervals-bulk-share");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("a view-only grantee's bulk backlog excludes the shared firearm; an edit-grantee's includes and can act on it", async ({
  page,
  browser,
}) => {
  const grantee = readArtifact().users.find(
    (u) => u.key === "service-intervals-viewer",
  );
  if (!grantee) throw new Error("service-intervals-viewer not seeded");

  await test.step("owner creates two rifles, both well past a week old", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    let form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Bulk Share Edit Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(30));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Bulk Share View Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(30));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();
  });

  await test.step("owner arms the Rifle category with a 7-day Cleaning rule — both rifles become due", async () => {
    await page.goto("/settings/service");
    const rifleSection = page.getByRole("region", { name: "Rifle" });
    await rifleSection.getByRole("button", { name: "Add rule" }).click();
    const form = rifleSection.locator("form");
    await form.getByLabel("Rule name").fill("Cleaning");
    await form.getByLabel("Days").fill("7");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Rifle rule added")).toBeVisible();
  });

  await test.step("owner shares one rifle at edit and the other at view", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Bulk Share Edit Rifle" })
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
      .filter({ hasText: "Bulk Share View Rifle" })
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

  await test.step("the owner's own bulk backlog still offers both shared rifles (owner permission on both)", async () => {
    await page.goto("/summary");
    const control = page.getByRole("region", { name: "Mark service due" });
    await expect(
      control.getByRole("checkbox", {
        name: "Bulk Share Edit Rifle — Cleaning",
      }),
    ).toBeVisible();
    await expect(
      control.getByRole("checkbox", {
        name: "Bulk Share View Rifle — Cleaning",
      }),
    ).toBeVisible();
  });

  await test.step("the grantee's bulk backlog offers the edit-shared rifle but never the view-only one", async () => {
    const granteeContext = await browser.newContext({
      storageState: storageStateFor("service-intervals-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/summary");
      const control = gp.getByRole("region", { name: "Mark service due" });

      // The roll-up is informational and legitimately includes BOTH shared
      // firearms' due state (KTD3) — unchanged by this fix. Only the
      // ACTIONABLE checklist below narrows to what the grantee can log.
      await expect(
        gp.getByText(/items due for service across \d+ rules/),
      ).toBeVisible();

      await expect(
        control.getByRole("checkbox", {
          name: "Bulk Share Edit Rifle — Cleaning",
        }),
      ).toBeVisible();
      await expect(
        control.getByRole("checkbox", {
          name: "Bulk Share View Rifle — Cleaning",
        }),
      ).toHaveCount(0);

      await control
        .getByRole("checkbox", { name: "Bulk Share Edit Rifle — Cleaning" })
        .click();
      await control.getByRole("button", { name: "Mark serviced" }).click();
      await expect(gp.getByText("Marked 1 rule serviced")).toBeVisible();

      // Confirms the offered row was genuinely actionable, not merely absent
      // from the exclusion — it cleared after being marked serviced.
      await expect(
        control.getByRole("checkbox", {
          name: "Bulk Share Edit Rifle — Cleaning",
        }),
      ).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });
});
