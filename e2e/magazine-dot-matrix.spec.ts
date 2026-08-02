import type { Page } from "@playwright/test";
import { authTest, expect } from "./fixtures/auth";

/**
 * Ships-dark coverage for the Magpul dot-matrix label (issue #20, U7; R6,
 * R13, R14).
 *
 * `src/data/magpul-glyphs.txt` carries zero glyph rows until Magpul's
 * diagram is transcribed, so `resolveDotMatrix` returns `hidden` for every
 * magazine today (KTD3) and `DotMatrixLabel` renders nothing. That suppressed
 * state IS the shipped behavior, not a placeholder — these assertions prove
 * it holds through the real render path rather than skipping coverage until
 * the transcription lands. Once a matrix can render, its accessible name
 * will read `Dot pattern to paint on a <N>-cell floorplate: <chars>`; the
 * transcription PR should extend this file with that assertion rather than
 * rewrite it.
 *
 * Two personas, both reused rather than newly seeded:
 *  - "magpul-mode" (already seeded with `magpulMode: true` by the launcher)
 *    for the on case. That account is also used by `magpul-mode.spec.ts`,
 *    whose first step depends on a cold-start "Start with a magazine" empty
 *    state (no firearms, no magazines). This spec restores that invariant by
 *    deleting the magazine it creates before the test ends, so the two specs
 *    stay compatible regardless of which runs first in a full-suite run.
 *  - "theme" (plain, `magpulMode` off by default) for the off case — chosen
 *    because `theme.spec.ts` only needs the theme toggle to be visible on
 *    `/magazines` and never asserts on magazine/firearm counts, so a
 *    create-then-delete round trip here cannot disturb it. Also restored by
 *    deletion at the end.
 */

const magpulTest = authTest("magpul-mode");
magpulTest.describe.configure({ retries: 0 });

const plainTest = authTest("theme");
plainTest.describe.configure({ retries: 0 });

/** Ignore only the favicon 404 some production builds emit, same allowlist as theme.spec.ts. */
const BENIGN_CONSOLE_PATTERNS = [/favicon\.ico/i];
function isBenignConsoleText(text: string): boolean {
  return BENIGN_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Attach console/page-error listeners before any navigation the caller wants covered. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isBenignConsoleText(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!isBenignConsoleText(error.message)) errors.push(error.message);
  });
  return errors;
}

/**
 * Creates one magazine via the real add-magazine form and opens its detail
 * page. Handles both cold-start empty-state button variants (no firearms yet
 * vs. firearms but no magazines) since which one a given persona sees depends
 * on state left behind by other specs sharing that persona.
 */
async function addMagazineAndOpenDetail(
  page: Page,
  brandModel: string,
  label: string,
): Promise<void> {
  await page.goto("/magazines");
  await page
    .getByRole("button", {
      name: /Add your first magazine|Start with a magazine|^Add magazine$/,
    })
    .click();
  const form = page.locator("form");
  await form.getByLabel(/^Brand \/ model/).fill(brandModel);
  await form.getByLabel(/^Caliber/).fill("5.56 NATO");
  if (label !== "") {
    await form.getByLabel("Label", { exact: true }).fill(label);
  }
  await page.getByRole("button", { name: "Add magazine" }).click();
  await expect(page.getByText("Magazine seated").first()).toBeVisible();

  await page.goto("/magazines");
  await page.getByRole("link", { name: brandModel }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: brandModel }),
  ).toBeVisible();
}

/** Deletes the magazine from its own detail page, restoring the persona's
 * magazine list to empty for whichever spec shares this account. */
async function deleteFromDetailPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/magazines$/);
}

magpulTest(
  "magazine detail page with Magpul mode on shows the label as text and no dot-matrix graphic while the glyph table is empty",
  async ({ page }) => {
    const brandModel = "Dot Matrix Coverage PMAG";
    const label = "US04";

    await addMagazineAndOpenDetail(page, brandModel, label);

    await expect(page.getByText(label, { exact: true })).toBeVisible();
    // KTD3: an empty glyph table suppresses the matrix entirely — no
    // img-role graphic is drawn at all, painted or not.
    await expect(
      page.getByRole("img", { name: /Dot pattern to paint/ }),
    ).toHaveCount(0);

    const consoleErrors = trackConsoleErrors(page);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: brandModel }),
    ).toBeVisible();

    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(
      overflow.documentWidth,
      `magazine detail page at 320px has a ${overflow.documentWidth}px document in a ${overflow.viewportWidth}px viewport`,
    ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    expect(consoleErrors).toEqual([]);

    await deleteFromDetailPage(page);
  },
);

plainTest(
  "magazine detail page with Magpul mode off is unaffected by the dot-matrix feature",
  async ({ page }) => {
    const brandModel = "Non-Magpul Coverage Mag";
    const label = "raw-label";

    await addMagazineAndOpenDetail(page, brandModel, label);

    // Off mode never applies the Magpul input mask (magazine-form.tsx
    // handleLabelChange), so the label round-trips exactly as typed.
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Dot pattern to paint/ }),
    ).toHaveCount(0);

    await deleteFromDetailPage(page);
  },
);
