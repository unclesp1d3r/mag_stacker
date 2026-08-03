import type { Page } from "@playwright/test";
import { authTest, expect } from "./fixtures/auth";
import { trackConsoleErrors } from "./fixtures/console-errors";
import { expectNoHorizontalOverflow } from "./fixtures/overflow";

/**
 * Coverage for the Magpul dot-matrix label (issue #20, U7; R6, R13, R14).
 *
 * `src/data/magpul-glyphs.txt` now carries all 36 transcribed Magpul glyphs
 * (`0`-`9`, `A`-`Z`), so `resolveDotMatrix` renders a real matrix and
 * `DotMatrixLabel` draws it. These assertions exercise the acceptance
 * examples from `docs/plans/2026-08-02-001-feat-magazine-dot-matrix-label-plan.md`:
 *  - AE1 — a 4-cell magazine renders every character of a label that fits.
 *  - AE2 / AE8 — a 2-cell GL9 magazine renders only the trailing digits when
 *    the label overflows, with an accessible name naming exactly what was
 *    drawn, and the stored label still reads in full as text.
 *  - AE6 — Magpul mode off suppresses the matrix entirely, whatever the
 *    label contains.
 *  - R9a — a hyphenated label drops the hyphen (Magpul's sheet has no glyph
 *    for it) and says so.
 *  - R4 / R9 message wording, which is asserted nowhere else as *rendered*
 *    text in its Callout.
 *
 * AE1 also reads the drawn dots back out of the SVG, which is the only check
 * anywhere that spans the whole chain — fixture file, parser, resolver, and
 * the geometry that turns a glyph cell into circles.
 *
 * Two personas, both reused rather than newly seeded:
 *  - "magpul-mode" (already seeded with `magpulMode: true` by the launcher)
 *    for the on cases. That account is also used by `magpul-mode.spec.ts`,
 *    whose first step depends on a cold-start "Start with a magazine" empty
 *    state (no firearms, no magazines). This spec restores that invariant by
 *    deleting every magazine it creates before each test ends, so the two
 *    specs stay compatible regardless of which runs first in a full-suite
 *    run.
 *  - "theme" (plain, `magpulMode` off by default) for the off case — chosen
 *    because `theme.spec.ts` only needs the theme toggle to be visible on
 *    `/magazines` and never asserts on magazine/firearm counts, so a
 *    create-then-delete round trip here cannot disturb it. Also restored by
 *    deletion at the end.
 */

const magpulTest = authTest("magpul-mode");
magpulTest.describe.configure({ retries: 0 });

/**
 * The dots AE1's `US04` must produce, restated here from Magpul's sheet
 * rather than imported from the fixture — an assertion built out of the same
 * data it is checking would pass no matter how wrong that data became.
 * Row-major within each cell, cells left to right, matching the render order
 * in `dot-matrix-label.tsx`.
 */
const EXPECTED_US04_DOTS = [
  ["#.#", "#.#", "#.#", "#.#", "###"], // U
  ["###", "#..", "###", "..#", "###"], // S
  ["###", "#.#", "#.#", "#.#", "###"], // 0
  ["#.#", "#.#", "###", "..#", "..#"], // 4
]
  .flat()
  .join("");

/** Painted dots render at r=5, unpainted at r=3 (KTD6); 4 splits them. */
const PAINTED_RADIUS_THRESHOLD = 4;

/** Reads the rendered matrix back as a `#`/`.` string, in DOM order. */
async function readDrawnDots(page: Page): Promise<string> {
  return await page
    .getByRole("img", { name: /^Dot pattern to paint/ })
    .locator("circle")
    .evaluateAll(
      (circles, threshold) =>
        circles
          .map((circle) =>
            Number(circle.getAttribute("r")) > threshold ? "#" : ".",
          )
          .join(""),
      PAINTED_RADIUS_THRESHOLD,
    );
}

const plainTest = authTest("theme");
plainTest.describe.configure({ retries: 0 });

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
  "AE1: a 4-cell magazine with Magpul mode on renders every character of a label that fits, and the label still reads as text",
  async ({ page }) => {
    // "LR/SR" normalizes to a substring containing the floorplate.ts "LRSR"
    // token, so this brandModel resolves to a *matched* (verified) 4-cell
    // floorplate rather than the unrecognized-model fallback.
    const brandModel = "Magpul PMAG 20 LR/SR GEN M3";
    const label = "US04";

    // Attached before the magazine is created and before the first
    // navigation, so it captures console errors from the whole add-magazine
    // flow and the initial detail render, not just the reload below.
    const consoleErrors = trackConsoleErrors(page);

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("img", {
          name: "Dot pattern to paint on a 4-cell floorplate: U S 0 4",
          exact: true,
        }),
      ).toBeVisible();

      // The accessible name above proves which characters were chosen; this
      // proves the dots actually drawn for them are the right shape. A row
      // shift anywhere between the fixture file and the SVG fails here.
      expect(await readDrawnDots(page)).toBe(EXPECTED_US04_DOTS);

      await page.setViewportSize({ width: 320, height: 844 });
      await page.reload();
      await expect(
        page.getByRole("heading", { level: 1, name: brandModel }),
      ).toBeVisible();

      await expectNoHorizontalOverflow(page, "magazine detail page at 320px");
      expect(consoleErrors).toEqual([]);
    } finally {
      // This persona is shared with magpul-mode.spec.ts, whose first step
      // requires a zero-magazine cold start; an assertion failure above must
      // not leak this magazine and cause a confusing failure over there.
      await deleteFromDetailPage(page);
    }
  },
);

magpulTest(
  "AE2/AE8: a 2-cell GL9 magazine with Magpul mode on renders only the trailing digits of an overflowing label, with an accessible name naming exactly what was drawn",
  async ({ page }) => {
    // "GL9" matches the floorplate.ts GL9-family token, resolving to a
    // matched 2-cell floorplate. The 4-character label overflows it, so only
    // the trailing digit run ("04") is drawn (R8).
    const brandModel = "Magpul GL9";
    const label = "US04";

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      // The stored label still renders in full as text (R13) even though
      // the matrix draws only its trailing digits.
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("img", {
          name: "Dot pattern to paint on a 2-cell floorplate: 0 4",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await deleteFromDetailPage(page);
    }
  },
);

magpulTest(
  "R9a: a hyphenated label drops the hyphen from the drawn pattern and says which character was left out",
  async ({ page }) => {
    // Magpul's sheet carries no hyphen glyph, but #21's validator permits one
    // in a stored label — so this is ordinary user input typed through the
    // real form, not legacy data.
    const brandModel = "Magpul PMAG 20 LR/SR GEN M3";
    const label = "A-1";

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      // The stored label still reads in full (R13); only the pattern drops it.
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("img", {
          name: "Dot pattern to paint on a 4-cell floorplate: A 1",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'Left out of the pattern: "-" — the Magpul floorplate font has no glyph for it.',
        ),
      ).toBeVisible();
    } finally {
      await deleteFromDetailPage(page);
    }
  },
);

magpulTest(
  "AE3/R4: an unrecognized model renders every character and tells the owner to confirm the cell count first",
  async ({ page }) => {
    const brandModel = "Some Unknown Brand 30rd";
    const label = "AR12";

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      await expect(
        page.getByRole("img", {
          name: "Dot pattern to paint on a 4-cell floorplate: A R 1 2",
          exact: true,
        }),
      ).toBeVisible();
      // R4's caveat wording, as actually rendered — the fallback cell count is
      // a guess, and this is the only thing telling the owner so before they
      // put permanent paint on a floorplate.
      await expect(
        page.getByText(
          "Model not recognized — confirm this floorplate has 4 dot cells before painting.",
        ),
      ).toBeVisible();
    } finally {
      await deleteFromDetailPage(page);
    }
  },
);

magpulTest(
  "AE9/R9: an all-digit label longer than the floorplate renders no matrix and states that it does not fit",
  async ({ page }) => {
    // GL9 is a *matched* 2-cell model, so the message carries no unverified
    // clause — that pairing is what makes the exact wording assertable here.
    const brandModel = "Magpul GL9";
    const label = "1234";

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      await expect(
        page.getByRole("img", { name: /Dot pattern to paint/ }),
      ).toHaveCount(0);
      await expect(
        page.getByText("This label does not fit this magazine's floorplate."),
      ).toBeVisible();
    } finally {
      await deleteFromDetailPage(page);
    }
  },
);

plainTest(
  "AE6: magazine detail page with Magpul mode off is unaffected by the dot-matrix feature",
  async ({ page }) => {
    const brandModel = "Non-Magpul Coverage Mag";
    const label = "raw-label";

    try {
      await addMagazineAndOpenDetail(page, brandModel, label);

      // Off mode never applies the Magpul input mask (magazine-form.tsx
      // handleLabelChange), so the label round-trips exactly as typed.
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("img", { name: /Dot pattern to paint/ }),
      ).toHaveCount(0);
    } finally {
      await deleteFromDetailPage(page);
    }
  },
);
