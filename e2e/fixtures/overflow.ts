import { expect, type Page } from "@playwright/test";

/**
 * Fails if the document is wider than the viewport (originally inlined in
 * magazine-dot-matrix.spec.ts; the same formula, `+1` tolerance, and message
 * template are also used inline in responsive-overflow.spec.ts). The `+1`
 * tolerance absorbs sub-pixel rounding across browsers.
 */
const OVERFLOW_TOLERANCE_PX = 1;

export async function expectNoHorizontalOverflow(
  page: Page,
  contextLabel: string,
): Promise<void> {
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.documentWidth,
    `${contextLabel} has a ${overflow.documentWidth}px document in a ${overflow.viewportWidth}px viewport`,
  ).toBeLessThanOrEqual(overflow.viewportWidth + OVERFLOW_TOLERANCE_PX);
}
