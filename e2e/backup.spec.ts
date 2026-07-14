import { expect, type Page, test } from "@playwright/test";
import { readArtifact, storageStateFor } from "./fixtures/auth";

/**
 * Admin backup screen e2e coverage (encryption-at-rest plan, U7 — R1/R3/R4/
 * R5/R6/R7/R9/R10/R12/R14, AE1-AE4). ARIA roles / accessible names / visible
 * text only — no `data-testid` (AGENTS.md).
 *
 * `/backup` is admin-gated, so this spec drives the real login form with the
 * seeded admin (mirrors `table-view-controls.spec.ts`) rather than the
 * per-spec pool (all non-admin). Exactly ONE live admin sign-in for the whole
 * file, kept well under the 5/60s `/sign-in/email` rate limit alongside
 * `auth.spec.ts`'s 2 and `table-view-controls.spec.ts`'s 1.
 *
 * Test-design note on real vs. mocked restore outcomes: the export flow and
 * the refuse-unless-empty restore flow (AE1) are exercised for REAL against
 * this run's ephemeral Postgres — export never mutates data, and a plain
 * restore on a non-empty instance is refused before touching anything, so
 * both are safe inside the shared, serialized (`workers: 1`) e2e suite. The
 * genuinely destructive force-replace path is proven only up to (and
 * excluding) the final confirm click — actually executing it here would wipe
 * every other spec's seeded users/inventory for the rest of the run. The
 * wrong-password / version-mismatch / rollback / success outcomes are UI
 * branching concerns already covered end-to-end at the service/route level
 * by U5's `restore-service.test.ts` and U6's `routes.test.ts`
 * (`src/backup/__tests__/`); here they're verified by intercepting the
 * restore route's response (`page.route`) and asserting the UI renders each
 * outcome's distinct, actionable copy — never by fabricating a real corrupt
 * bundle or performing a real destructive restore.
 */
test.describe.configure({ retries: 0 });

const ADMIN_STORAGE_STATE = "e2e/.artifacts/backup-admin-storage-state.json";
const RESTORE_ROUTE = "**/api/admin/backup/restore";
const EXPORT_PASSWORD = "correct horse battery staple 42";
const FORCE_REPLACE_PHRASE = "REPLACE ALL DATA";

test.beforeAll(async ({ browser }) => {
  const { admin, baseURL } = readArtifact();
  const context = await browser.newContext({
    baseURL,
    storageState: undefined,
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/magazines/);
  await context.storageState({ path: ADMIN_STORAGE_STATE });
  await context.close();
});

test.use({ storageState: ADMIN_STORAGE_STATE });

/** Fills the restore panel's file + password fields with an inert dummy
 * payload (the byte content is irrelevant for the mocked-outcome cases below —
 * `page.route` answers before the request ever reaches the real server). */
async function fillRestoreDummyFile(page: Page): Promise<void> {
  await page.getByLabel("Backup file").setInputFiles({
    name: "dummy.magstacker-backup",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a real bundle"),
  });
  await page.getByLabel("Restore password").fill("whatever");
}

/** Mocks the restore route's discriminated JSON outcome for one request, then
 * removes the mock so later steps hit the real route again. */
async function mockRestoreOutcome(
  page: Page,
  status: number,
  outcome: string,
  message: string,
): Promise<void> {
  await page.route(RESTORE_ROUTE, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ outcome, message }),
    });
  });
}

test("export, refuse-unless-empty restore, force-replace guard, and outcome messaging", async ({
  page,
  browser,
}) => {
  await test.step("non-admin cannot reach /backup or see its nav link (R14)", async () => {
    const nonAdminContext = await browser.newContext({
      storageState: storageStateFor("onboarding"),
    });
    try {
      const nonAdminPage = await nonAdminContext.newPage();
      await nonAdminPage.goto("/magazines");
      await expect(
        nonAdminPage.getByRole("link", { name: "Backup" }),
      ).toHaveCount(0);

      await nonAdminPage.goto("/backup");
      await expect(nonAdminPage).toHaveURL(/\/magazines/);
      await expect(
        nonAdminPage.getByRole("heading", { level: 1, name: "Backup" }),
      ).toHaveCount(0);
    } finally {
      await nonAdminContext.close();
    }
  });

  await test.step("seed one firearm as this admin (guarantees a non-empty instance for the refuse-unless-empty check below, independent of other specs' run order)", async () => {
    await page.goto("/firearms");
    const coldStart = page.getByRole("button", {
      name: "Add your first firearm",
    });
    if (await coldStart.isVisible()) {
      await coldStart.click();
    } else {
      await page.getByRole("button", { name: "Add firearm" }).click();
    }
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Backup Spec Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();
  });

  await test.step("the no-recovery warning is visible and Export stays disabled until password, confirmation, and acknowledgement are all satisfied (R12)", async () => {
    await page.goto("/backup");
    await expect(
      page.getByRole("heading", { level: 1, name: "Backup" }),
    ).toBeVisible();

    await expect(page.getByText(/no password recovery/i)).toBeVisible();

    const exportButton = page.getByRole("button", { name: "Export backup" });
    await expect(exportButton).toBeDisabled();

    await page.getByLabel("Export password").fill(EXPORT_PASSWORD);
    await page.getByLabel("Confirm password").fill("a different password");
    await expect(exportButton).toBeDisabled();

    await page.getByLabel("Confirm password").fill(EXPORT_PASSWORD);
    await expect(exportButton).toBeDisabled(); // acknowledgement checkbox still unticked

    await page
      .getByLabel(
        "I understand this backup cannot be recovered without this password.",
      )
      .check();
    await expect(exportButton).toBeEnabled();
  });

  let bundlePath: string;

  await test.step("export downloads a real, non-empty encrypted bundle via a navigation-triggered download, not fetch()+blob (R1/R3/R4/R13)", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export backup" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^magstacker-backup-.*\.magstacker-backup$/,
    );
    const path = await download.path();
    if (!path)
      throw new Error("export download did not resolve to a local path");
    bundlePath = path;

    await expect(
      page.getByText("Export started — check your browser's downloads."),
    ).toBeVisible();
  });

  await test.step("a plain restore of the real bundle on this non-empty instance is refused, with no data changed (R6/AE1)", async () => {
    await page.getByLabel("Backup file").setInputFiles(bundlePath);
    await page.getByLabel("Restore password").fill(EXPORT_PASSWORD);
    await page.getByRole("button", { name: "Restore" }).click();

    await expect(
      page.getByText("Restore refused — instance is not empty"),
    ).toBeVisible();
    await expect(page.getByText(/already holds inventory data/i)).toBeVisible();

    // No data changed: the seeded firearm from the earlier step is still there.
    await page.goto("/firearms");
    await expect(page.getByText("Backup Spec Rifle")).toBeVisible();
  });

  await test.step("force-replace stays disabled until the exact phrase is typed, and is never actually confirmed here (R7/AE2)", async () => {
    await page.goto("/backup");
    await page.getByLabel("Backup file").setInputFiles(bundlePath);
    await page.getByLabel("Restore password").fill(EXPORT_PASSWORD);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(
      page.getByText("Restore refused — instance is not empty"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Force replace…" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole("button", {
      name: "Force replace",
    });
    await expect(confirmButton).toBeDisabled();

    const phraseInput = dialog.getByLabel(
      `Type ${FORCE_REPLACE_PHRASE} to confirm`,
    );
    await phraseInput.fill("replace all data"); // wrong case — must not match
    await expect(confirmButton).toBeDisabled();
    await phraseInput.fill(FORCE_REPLACE_PHRASE.slice(0, -1)); // partial
    await expect(confirmButton).toBeDisabled();

    await phraseInput.fill(FORCE_REPLACE_PHRASE);
    await expect(confirmButton).toBeEnabled();

    // Deliberately cancel rather than confirm — a real force-replace would
    // wipe the whole shared e2e instance for every other spec in this run.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("wrong-password, version-mismatch, and rollback outcomes each render distinct, actionable messages (AE3/AE4, R7 rollback)", async () => {
    await mockRestoreOutcome(
      page,
      400,
      "wrong_password_or_tampered",
      "bundle failed to authenticate: wrong password",
    );
    await fillRestoreDummyFile(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(
      page.getByText("Restore refused — could not authenticate the backup"),
    ).toBeVisible();
    await expect(page.getByText(/check the password/i)).toBeVisible();
    await page.unroute(RESTORE_ROUTE);

    await mockRestoreOutcome(
      page,
      409,
      "version_mismatch",
      "bundle backupFormatVersion 99 is incompatible",
    );
    await fillRestoreDummyFile(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(
      page.getByText("Restore refused — incompatible backup version"),
    ).toBeVisible();
    await expect(page.getByText(/incompatible version/i)).toBeVisible();
    await page.unroute(RESTORE_ROUTE);

    await mockRestoreOutcome(
      page,
      500,
      "rolled_back",
      "force-restore promotion failed and was rolled back",
    );
    await fillRestoreDummyFile(page);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restore failed — rolled back")).toBeVisible();
    await expect(page.getByText(/automatically rolled back/i)).toBeVisible();
    await page.unroute(RESTORE_ROUTE);
  });

  await test.step("a successful restore invalidates the session and redirects to login (R10) — run LAST, this signs the browser out", async () => {
    await mockRestoreOutcome(page, 200, "ok", "restore completed successfully");
    await fillRestoreDummyFile(page);
    await page.getByRole("button", { name: "Restore" }).click();

    await expect(page).toHaveURL(/\/login\?restored=1/);
    await expect(page.getByText("Instance restored")).toBeVisible();
    await page.unroute(RESTORE_ROUTE);
  });
});
