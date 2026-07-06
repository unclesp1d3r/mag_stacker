import { expect, test } from "@playwright/test";
import { readArtifact } from "./fixtures/auth";

/**
 * Shared DataTable view controls (U1/U2): sort, column show/hide, pagination,
 * and localStorage persistence with no-flash restore. This first spec exercises
 * the flat surface on the admin `/users` table — the simplest consumer of the
 * wrapper (no grouping, no filter) — proving the U1 wrapper + U2 persistence
 * integrate before the grouping-heavy magazines/firearms migrations. Grouping,
 * client-filter, and empty-state coverage land with those tables (U6/U7).
 *
 * `/users` is admin-gated, so this spec drives the real login form with the
 * seeded admin (the per-spec pool users are non-admin). All targeting is by
 * ARIA role / accessible name / visible text — no `data-testid` (AGENTS.md).
 */
// Stateful view-state persistence via reload; a retry would fight leftover
// localStorage. Exactly ONE live admin sign-in for the whole file (see
// beforeAll) — per-test logins would trip the 5/60s sign-in rate limit.
test.describe.configure({ retries: 0 });

// Sign in as the seeded admin once and reuse the session for every test via
// storageState (cookies only — localStorage stays empty, so each test's
// view-state persistence starts clean). Written to the gitignored artifacts dir.
const ADMIN_STORAGE_STATE = "e2e/.artifacts/admin-storage-state.json";

test.beforeAll(async ({ browser }) => {
  const { admin, baseURL } = readArtifact();
  // storageState: undefined clears the file-backed option this file sets via
  // test.use below — the file does not exist until this hook writes it.
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

test.beforeEach(async ({ page }) => {
  await page.goto("/users");
  // Wait past the pre-mount skeleton: the real header is a sortable button.
  await expect(page.getByRole("button", { name: "Email" })).toBeVisible();
});

test("sort toggles aria-sort ascending then descending (R2)", async ({
  page,
}) => {
  const emailHeader = page.getByRole("columnheader", { name: "Email" });
  await expect(emailHeader).toHaveAttribute("aria-sort", "none");

  await page.getByRole("button", { name: "Email" }).click();
  await expect(emailHeader).toHaveAttribute("aria-sort", "ascending");

  await page.getByRole("button", { name: "Email" }).click();
  await expect(emailHeader).toHaveAttribute("aria-sort", "descending");
});

test("column show/hide removes and re-reveals a column (R5, R18, KTD-10)", async ({
  page,
}) => {
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();

  // The menu stays open on toggle, so hide and re-reveal in one pass. Wait on
  // each aria-checked transition so a click never races the prior re-render.
  await page.getByRole("button", { name: "Toggle columns" }).click();
  const nameItem = page.getByRole("menuitemcheckbox", { name: "Name" });
  await expect(nameItem).toHaveAttribute("aria-checked", "true");
  await nameItem.click();
  await expect(nameItem).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveCount(0);

  await nameItem.click();
  await expect(nameItem).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
});

test("the column menu will not let the last visible column be hidden (KTD-10)", async ({
  page,
}) => {
  // Hide every non-actions column except the last; the last must stay disabled.
  const columnLabels = ["Email", "Name", "Role", "Status"];
  await page.getByRole("button", { name: "Toggle columns" }).click();
  for (const label of columnLabels.slice(0, -1)) {
    const item = page.getByRole("menuitemcheckbox", { name: label });
    await item.click();
    // Wait for the hide to land before toggling the next (avoid a click race).
    await expect(item).toHaveAttribute("aria-checked", "false");
  }
  const lastItem = page.getByRole("menuitemcheckbox", {
    name: columnLabels[columnLabels.length - 1],
  });
  await expect(lastItem).toBeDisabled();
});

test("page-size select repaginates and pagination controls are present (R18, KTD-5)", async ({
  page,
}) => {
  // The seeded accounts fit on one page at the default size, so Prev/Next stay
  // disabled here; multi-page prev/next navigation is covered on the magazines
  // table (U6), where the spec creates more than a page of rows. This proves the
  // page-size control live-repaginates and the pagination chrome renders.
  await expect(page.getByText(/Page 1 of/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous page" }),
  ).toBeDisabled();

  // Shrinking to 10 caps the page to a header row + 10 data rows.
  await page.getByLabel("Rows").selectOption("10");
  await expect(page.getByRole("row")).toHaveCount(11);
  await expect(page.getByLabel("Rows")).toHaveValue("10");
});

test("view settings persist across reload with no defaults flash (R3, F2)", async ({
  page,
}) => {
  // Sort descending by email, hide the Name column, and shrink the page size.
  await page.getByRole("button", { name: "Email" }).click();
  await page.getByRole("button", { name: "Email" }).click();
  await page.getByRole("button", { name: "Toggle columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Name" }).click();
  await page.getByLabel("Rows").selectOption("10");

  await page.reload();

  // Restored state is present on the first real paint (the skeleton renders
  // until restore completes, so defaults never settle as a stable frame).
  await expect(
    page.getByRole("columnheader", { name: "Email" }),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("columnheader", { name: "Name" })).toHaveCount(0);
  await expect(page.getByLabel("Rows")).toHaveValue("10");
});

test("every control is keyboard operable with an accessible name (R15)", async ({
  page,
}) => {
  // The sort toggle is a real button reachable and activatable by keyboard.
  const emailSort = page.getByRole("button", { name: "Email" });
  await emailSort.focus();
  await expect(emailSort).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("columnheader", { name: "Email" }),
  ).toHaveAttribute("aria-sort", "ascending");

  // The column menu opens via keyboard and exposes named checkbox items.
  const columnsTrigger = page.getByRole("button", { name: "Toggle columns" });
  await columnsTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Role" }),
  ).toBeVisible();
});
