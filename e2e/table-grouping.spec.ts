import { authTest, expect } from "./fixtures/auth";

/**
 * Magazine roll-up grouping on the shared DataTable (U5/U6): By-type grouping
 * (F1), filter-then-group (AE5), persistence of the grouping mode (R3), and
 * opt-in columns (R5/KTD-4). One sequential test on a fresh "table-grouping"
 * user — it bulk-adds two magazine batches, then drives grouping/filter/
 * persistence. All targeting is by ARIA role / accessible name / visible text
 * (no `data-testid`, AGENTS.md).
 */
const test = authTest("table-grouping");

// Stateful (creates magazines, mutates persisted view state via reload); a retry
// would start from a dirty account.
test.describe.configure({ retries: 0 });

test("by-type grouping, filter-then-group, persistence, and opt-in columns", async ({
  page,
}) => {
  await test.step("bulk-add 3 identical PMAG 30 (9mm)", async () => {
    await page.goto("/magazines");
    // Fresh account has no firearms, so the cold-start is the firearm-first
    // "Set up your inventory" state; open the create form via its magazine CTA.
    await page.getByRole("button", { name: "Start with a magazine" }).click();
    const form = page.locator("form");
    await form.getByRole("tab", { name: "bulk" }).click();
    await form.getByLabel("Brand / model").fill("PMAG 30");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Count").fill("3");
    await page.getByRole("button", { name: "Add 3 magazines" }).click();
    await expect(page.getByText("Seated 3 magazines")).toBeVisible();
  });

  await test.step("bulk-add 2 SR25 Mag (.308)", async () => {
    await page.getByRole("button", { name: "Add magazine" }).click();
    const form = page.locator("form");
    await form.getByRole("tab", { name: "bulk" }).click();
    await form.getByLabel("Brand / model").fill("SR25 Mag");
    await form.getByLabel("Caliber").fill(".308");
    await form.getByLabel("Count").fill("2");
    await page.getByRole("button", { name: "Add 2 magazines" }).click();
    await expect(page.getByText("Seated 2 magazines")).toBeVisible();
  });

  await test.step("By type rolls up owned rows into counted groups (F1, R8, R11, R12)", async () => {
    await page.getByLabel("Group by").selectOption("type");

    // Scope to the group's collapsible trigger (only it carries the "N items"
    // count) so member ShareControl buttons don't make the locator ambiguous
    // once the group is expanded.
    const pmagGroup = page
      .getByRole("button")
      .filter({ hasText: "PMAG 30" })
      .filter({ hasText: "items" });
    const sr25Group = page
      .getByRole("button")
      .filter({ hasText: "SR25 Mag" })
      .filter({ hasText: "items" });
    await expect(pmagGroup).toContainText("3 items");
    await expect(sr25Group).toContainText("2 items");
    // R12: magazine group headers surface total round capacity.
    await expect(pmagGroup).toContainText("rds");

    // R11: collapsed by default — member links are not rendered until expanded.
    await expect(page.getByRole("link", { name: /PMAG 30/ })).toHaveCount(0);
    await expect(pmagGroup).toHaveAttribute("aria-expanded", "false");
    // Activate via keyboard (R15) rather than a pointer click: the Radix trigger
    // re-renders under React Compiler, and Playwright's pointer "stability"
    // actionability check can stall on slower/contended CI runners. focus+Enter
    // avoids the pointer heuristic while still exercising real keyboard operation.
    await pmagGroup.focus();
    await page.keyboard.press("Enter");
    await expect(pmagGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: /PMAG 30/ })).toHaveCount(3);
  });

  await test.step("filter-then-group: a caliber filter narrows which groups build (AE5, R14)", async () => {
    await page.getByLabel("Caliber").selectOption(".308");

    await expect(
      page.getByRole("button").filter({ hasText: "SR25 Mag" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button").filter({ hasText: "PMAG 30" }),
    ).toHaveCount(0);

    // Restore the full set for the persistence step.
    await page.getByLabel("Caliber").selectOption("");
    await expect(
      page.getByRole("button").filter({ hasText: "PMAG 30" }),
    ).toHaveCount(1);
  });

  await test.step("the grouping mode persists across reload (R3)", async () => {
    await page.reload();
    await expect(page.getByLabel("Group by")).toHaveValue("type");
    await expect(
      page.getByRole("button").filter({ hasText: "PMAG 30" }),
    ).toContainText("3 items");
  });

  await test.step("opt-in Notes column is hidden by default and re-revealable (R5, KTD-4)", async () => {
    await page.getByLabel("Group by").selectOption("none");
    await expect(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: "Toggle columns" }).click();
    const notesItem = page.getByRole("menuitemcheckbox", { name: "Notes" });
    await expect(notesItem).toHaveAttribute("aria-checked", "false");
    await notesItem.click();
    await expect(notesItem).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("columnheader", { name: "Notes" }),
    ).toBeVisible();
  });
});
