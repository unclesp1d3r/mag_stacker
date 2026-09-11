import type { Page } from "@playwright/test";
import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";
import { localDateTimeInput } from "./fixtures/datetime";

/**
 * Ammo reconciliation (#100, plan U5): the Last inventoried column and detail
 * row, the Reconcile form with its live variance preview, the reconciliation
 * history (variance, notes, the Not applied mark for a count dated before a
 * newer one), Low Stock flipping through to `/summary`, the column's real
 * sort wiring, and the sharing gates (an edit grantee reconciles as
 * themselves; a view grantee reads the history but gets no control). One
 * sequential test on a fresh "ammo-reconcile" owner plus two grantee
 * contexts. ARIA roles / accessible names / visible text only — no
 * `data-testid`. The service-layer contract (snapshot semantics, cascade,
 * authorization) is proven in
 * `src/domain/inventory-log/__tests__/service.test.ts`.
 */
const test = authTest("ammo-reconcile");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

/** The reconciliation-history table, distinguished by its Counted column. */
function historyTable(page: Page) {
  return page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: "Counted" }) });
}

function historyRows(page: Page) {
  return historyTable(page).locator("tbody tr");
}

/** The `<dd>` beside a detail-view `<dt>` label. */
function detailValue(page: Page, label: string) {
  return page
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd[1]");
}

/** The form's live preview line ("On record N · Variance X"), not the history's Variance column header. */
function variancePreview(page: Page) {
  return page.getByText(/^On record \d+ · Variance/);
}

async function openReconcileForm(page: Page) {
  await page.getByRole("button", { name: "Reconcile…", exact: true }).click();
  await expect(page.getByLabel("Counted rounds")).toBeVisible();
}

async function submitReconcile(page: Page) {
  await page.getByRole("button", { name: "Reconcile", exact: true }).click();
}

test("reconcile flow, history, Low Stock, column sort, and sharing gates", async ({
  page,
  browser,
}) => {
  await test.step("add a lot; the Last inventoried column shows an em dash (AE8)", async () => {
    await page.goto("/ammo");
    await page.getByRole("button", { name: "Add your first lot" }).click();
    const form = page.locator("form");
    await form.getByLabel("Brand").fill("Federal");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Quantity (rounds)").fill("500");
    await form.getByLabel("Low-stock threshold").fill("50");
    await page.getByRole("button", { name: "Add lot" }).click();
    await expect(page.getByText("Lot logged").first()).toBeVisible();

    await expect(
      page.getByRole("columnheader", { name: "Last inventoried" }),
    ).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Federal" });
    await expect(row).toContainText("—");
  });

  await test.step("the detail shows an em dash and an empty history (AE8, R13)", async () => {
    await page
      .getByRole("row")
      .filter({ hasText: "Federal" })
      .getByRole("link")
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Federal/ }),
    ).toBeVisible();
    await expect(detailValue(page, "Last inventoried")).toHaveText("—");
    await expect(
      page.getByRole("heading", { name: "Reconciliation history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No reconciliations yet" }),
    ).toBeVisible();
  });

  await test.step("reconcile 500 -> 480: preview reads −20, then history, quantity, and date update (AE1, R12, R13, R14)", async () => {
    await openReconcileForm(page);
    // Empty field: the preview is an em dash, not NaN.
    await expect(variancePreview(page)).toContainText("—");
    await page.getByLabel("Counted rounds").fill("480");
    await expect(variancePreview(page)).toContainText("−20");
    await submitReconcile(page);
    await expect(page.getByText("Reconciled").first()).toBeVisible();

    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toContainText("480");
    await expect(historyRows(page).first()).toContainText("−20");
    await expect(detailValue(page, "Quantity (rounds)")).toHaveText("480");
    await expect(detailValue(page, "Last inventoried")).not.toHaveText("—");
  });

  await test.step("a count equal to the quantity records variance 0 (AE2)", async () => {
    await openReconcileForm(page);
    await page.getByLabel("Counted rounds").fill("480");
    await expect(variancePreview(page)).toContainText("0");
    await submitReconcile(page);
    await expect(page.getByText("Reconciled").first()).toBeVisible();
    await expect(historyRows(page)).toHaveCount(2);
    await expect(historyRows(page).first()).toContainText("0");
  });

  await test.step("empty and negative counts show a field error and do not submit", async () => {
    await openReconcileForm(page);
    await submitReconcile(page);
    await expect(page.getByText("Enter the rounds you counted")).toBeVisible();
    await page.getByLabel("Counted rounds").fill("-1");
    await submitReconcile(page);
    await expect(
      page.getByText("Counted rounds cannot be negative"),
    ).toBeVisible();
    await expect(historyRows(page)).toHaveCount(2);
    await page
      .getByRole("button", { name: "Cancel", exact: true })
      .first()
      .click();
  });

  await test.step("reconciling below the threshold flips Low stock on the detail, list, and summary (AE4, R6, R14)", async () => {
    await openReconcileForm(page);
    await page.getByLabel("Counted rounds").fill("40");
    await submitReconcile(page);
    await expect(page.getByText("Reconciled").first()).toBeVisible();
    await expect(page.getByText("Low stock").first()).toBeVisible();
    await expect(detailValue(page, "Quantity (rounds)")).toHaveText("40");

    await page.goto("/ammo");
    const row = page.getByRole("row").filter({ hasText: "Federal" });
    await expect(row.getByText("Low stock")).toBeVisible();

    await page.goto("/summary");
    const lowLotsCard = page.getByText("Ammo lots low").locator("..");
    await expect(lowLotsCard).toContainText("1");
  });

  await test.step("a count dated before the newest one is recorded but not applied (AE9, R13)", async () => {
    await page.goto("/ammo");
    await page
      .getByRole("row")
      .filter({ hasText: "Federal" })
      .getByRole("link")
      .click();
    const dateBefore = await detailValue(page, "Last inventoried").innerText();

    await openReconcileForm(page);
    await page.getByLabel("Counted rounds").fill("320");
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await page.getByLabel("Date & time").fill(localDateTimeInput(lastWeek));
    await submitReconcile(page);
    await expect(page.getByText("Reconciled").first()).toBeVisible();

    await expect(historyRows(page)).toHaveCount(4);
    // Newest-dated first: today's 40 stays on top; the back-dated 320 is last
    // and marked, and the quantity did not move.
    await expect(historyRows(page).first()).toContainText("40");
    const backDated = historyRows(page).filter({ hasText: "320" });
    await expect(backDated).toContainText("Not applied");
    await expect(historyRows(page).first()).not.toContainText("Not applied");
    await expect(detailValue(page, "Quantity (rounds)")).toHaveText("40");
    await expect(detailValue(page, "Last inventoried")).toHaveText(dateBefore);
  });

  await test.step("a note shows in the history row (R12, R13)", async () => {
    await openReconcileForm(page);
    await page.getByLabel("Counted rounds").fill("40");
    await page.getByLabel("Notes").fill("Box damaged");
    await submitReconcile(page);
    await expect(page.getByText("Reconciled").first()).toBeVisible();
    await expect(historyRows(page).first()).toContainText("Box damaged");
  });

  await test.step("the Last inventoried column sorts a never-counted lot to the stale end both ways (R16)", async () => {
    await page.goto("/ammo");
    await page.getByRole("button", { name: "Add lot" }).click();
    const form = page.locator("form");
    await form.getByLabel("Brand").fill("Hornady");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Quantity (rounds)").fill("100");
    await page.getByRole("button", { name: "Add lot" }).click();
    await expect(page.getByText("Lot logged").first()).toBeVisible();

    const sortButton = page
      .getByRole("columnheader", { name: "Last inventoried" })
      .getByRole("button");
    const bodyRows = page.getByRole("table").first().locator("tbody tr");

    // A numeric accessor toggles to descending first (newest first): the
    // never-counted lot is maximally stale, so it drops to the bottom.
    await sortButton.click();
    await expect(bodyRows.first()).toContainText("Federal");
    await expect(bodyRows.last()).toContainText("Hornady");
    // Ascending (oldest first): never-counted rises to the top.
    await sortButton.click();
    await expect(bodyRows.first()).toContainText("Hornady");
    await expect(bodyRows.last()).toContainText("Federal");
  });

  await test.step("owner shares Federal at edit with the editor and at view with the viewer", async () => {
    const users = readArtifact().users;
    const editor = users.find((u) => u.key === "ammo-reconcile-editor");
    const viewer = users.find((u) => u.key === "ammo-reconcile-viewer");
    if (!editor || !viewer) throw new Error("reconcile grantees not seeded");

    await page
      .getByRole("row")
      .filter({ hasText: "Federal" })
      .getByRole("button", { name: "Share" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: editor.email });
    await dialog.getByLabel("Permission").selectOption("edit");
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: editor.email }),
    ).toBeVisible();
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    await dialog.getByLabel("Permission").selectOption("view");
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("the edit grantee reconciles and is attributed by name (AE6, R8, R9)", async () => {
    const editorContext = await browser.newContext({
      storageState: storageStateFor("ammo-reconcile-editor"),
    });
    try {
      const ep = await editorContext.newPage();
      await ep.goto("/ammo");
      await ep
        .getByRole("row")
        .filter({ hasText: "Federal" })
        .getByRole("link")
        .click();
      await openReconcileForm(ep);
      await ep.getByLabel("Counted rounds").fill("39");
      await submitReconcile(ep);
      await expect(ep.getByText("Reconciled").first()).toBeVisible();
      await expect(historyRows(ep).first()).toContainText("39");
      await expect(historyRows(ep).first()).toContainText(
        "ammo-reconcile-editor",
      );
    } finally {
      await editorContext.close();
    }
  });

  await test.step("the view grantee reads the history and Last inventoried but has no Reconcile control (AE5, R8, R9)", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("ammo-reconcile-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();
      await vp.goto("/ammo");
      await vp
        .getByRole("row")
        .filter({ hasText: "Federal" })
        .getByRole("link")
        .click();
      await expect(
        vp.getByRole("heading", { name: "Reconciliation history" }),
      ).toBeVisible();
      await expect(historyRows(vp)).toHaveCount(6);
      await expect(historyRows(vp).first()).toContainText(
        "ammo-reconcile-editor",
      );
      await expect(detailValue(vp, "Last inventoried")).not.toHaveText("—");
      await expect(
        vp.getByRole("button", { name: "Reconcile…", exact: true }),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
});
