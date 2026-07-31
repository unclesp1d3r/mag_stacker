import { authTest, expect } from "./fixtures/auth";

/**
 * No route may scroll horizontally at phone width.
 *
 * This is the regression guard for the mobile P0: header cells render their
 * "Actions" label as a `.sr-only` span, which is `position: absolute`. The
 * DataTable's scroll container was `static`, so those spans' containing block
 * resolved past it to the initial containing block and `overflow-x-auto` never
 * clipped them — each sat at the table's full width in document space, widening
 * every table route well past the viewport even though the table itself scrolled
 * correctly. Adding `relative` to the scroller fixed it.
 *
 * Two things this test exists to pin, because both were learned the hard way:
 *
 * 1. **Assert on real scrollability, not just `scrollWidth`.** Playwright's
 *    `isMobile: true` masks this class of bug entirely — it widens the layout
 *    viewport instead of scrolling, so the page reports no overflow. This spec
 *    therefore drives a plain viewport and checks `window.scrollX` actually
 *    stays at 0 after attempting to scroll right.
 * 2. **Assert the page rendered.** A table route that renders zero tables (a
 *    build error, say) trivially has no overflow. Passing on a broken page is
 *    how an earlier iteration of this fix reported success while the app did not
 *    compile.
 *
 * The inner scroll containers must still scroll in place — clipping the overflow
 * away instead of scrolling it would also pass the overflow check while making
 * wide tables unreadable, so that is asserted too.
 */
const test = authTest("responsive-overflow");

/**
 * Ensure the magazines table has rows, and that they are wide enough to overflow
 * a phone viewport.
 *
 * An empty table cannot overflow, so measuring a cold-start account would assert
 * nothing — the original version of this spec passed against the empty state and
 * would not have caught the bug it exists for. Idempotent so each test can call
 * it without depending on another test having run first.
 */
async function ensureWideInventory(page: import("@playwright/test").Page) {
  await page.goto("/magazines");
  // The table mounts client-side, so wait for whichever state the page settles
  // into rather than racing it.
  const table = page.getByRole("table");
  // Two cold-start shapes: an account with no firearms is steered toward adding
  // one first ("Start with a magazine" is the secondary path), while an account
  // that has firearms but no magazines gets "Add your first magazine".
  const firstAdd = page.getByRole("button", {
    name: /Add your first magazine|Start with a magazine/,
  });
  await expect(table.or(firstAdd).first()).toBeVisible();
  if (await table.isVisible()) return;

  const rows = [
    {
      brandModel: "Magpul PMAG 30 GEN M3 Window",
      caliber: "5.56 NATO",
      capacity: "30",
    },
    {
      brandModel: "SIG Sauer P320 Full-Size 21rd",
      caliber: "9mm",
      capacity: "21",
    },
  ];
  for (const [index, row] of rows.entries()) {
    await page
      .getByRole("button", {
        name:
          index === 0
            ? /Add your first magazine|Start with a magazine/
            : /^Add magazine$/,
      })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Brand / model").fill(row.brandModel);
    await form.getByLabel("Caliber").fill(row.caliber);
    await form.getByLabel("Base capacity").fill(row.capacity);
    await page.getByRole("button", { name: "Add magazine" }).click();
    await page
      .getByRole("row")
      .filter({ hasText: row.brandModel })
      .first()
      .waitFor();
  }
}

/** 320 is the narrowest width the project supports; 390 is a common phone. */
const PHONE_WIDTHS = [320, 390] as const;

const TABLE_ROUTES = [
  "/magazines",
  "/firearms",
  "/ammo",
  "/accessories",
] as const;
const OTHER_ROUTES = ["/summary", "/settings"] as const;

test("no route scrolls horizontally at phone width", async ({ page }) => {
  // Measure a populated table — the case that actually overflowed.
  await ensureWideInventory(page);

  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 });

    for (const route of [...TABLE_ROUTES, ...OTHER_ROUTES]) {
      await page.goto(route);
      // Settle layout before measuring; tables mount client-side.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const overflow = await page.evaluate(() => {
        window.scrollTo(9999, 0);
        const scrolledTo = window.scrollX;
        window.scrollTo(0, 0);
        return {
          maxScrollX: scrolledTo,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        };
      });

      expect(
        overflow.maxScrollX,
        `${route} at ${width}px scrolled horizontally to ${overflow.maxScrollX}px`,
      ).toBe(0);
      expect(
        overflow.documentWidth,
        `${route} at ${width}px has a ${overflow.documentWidth}px document in a ${overflow.viewportWidth}px viewport`,
      ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    }
  }
});

test("wide tables scroll inside their own container rather than being clipped", async ({
  page,
}) => {
  await ensureWideInventory(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/magazines");
  await expect(page.getByRole("table")).toBeVisible();

  const scroller = await page.evaluate(() => {
    const table = document.querySelector("table");
    const box = table?.parentElement;
    if (!box) return null;
    box.scrollLeft = 9999;
    const maxScrollLeft = box.scrollLeft;
    box.scrollLeft = 0;
    return {
      clientWidth: box.clientWidth,
      scrollWidth: box.scrollWidth,
      maxScrollLeft,
    };
  });

  expect(scroller).not.toBeNull();
  // The table is wider than its box (that is the whole situation) AND the box
  // can actually be scrolled to reach the rest of it.
  expect(scroller?.scrollWidth).toBeGreaterThan(scroller?.clientWidth ?? 0);
  expect(scroller?.maxScrollLeft ?? 0).toBeGreaterThan(0);
});

test("the primary nav keeps every destination reachable by scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/magazines");

  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();

  // Links are scrolled, never hidden or collapsed behind a menu — a link that
  // is present but unreachable would defeat the point of the scrolling rail.
  const linkCount = await nav.getByRole("link").count();
  expect(linkCount).toBeGreaterThanOrEqual(6);

  const rail = await nav.evaluate((el) => {
    el.scrollLeft = 9999;
    const maxScrollLeft = el.scrollLeft;
    el.scrollLeft = 0;
    return {
      maxScrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  });
  expect(rail.scrollWidth).toBeGreaterThan(rail.clientWidth);
  expect(rail.maxScrollLeft).toBeGreaterThan(0);

  // The last destination is reachable once scrolled.
  await expect(nav.getByRole("link").last()).toBeVisible();
});
