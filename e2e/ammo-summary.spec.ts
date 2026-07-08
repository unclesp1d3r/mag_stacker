import { authTest, expect } from "./fixtures/auth";

/**
 * `/summary` ammo roll-ups + caliber-coverage cross-reference (ammo plan U5,
 * R11/R12, AE3 e2e leg). One sequential test on a fresh "ammo-summary" user:
 * seeds two firearms (distinct calibers) and two ammo lots through the real
 * `/firearms` and `/ammo` UI, then asserts `/summary` renders both roll-up
 * counts and the coverage table with the correct Reason text.
 *
 * Mixed fixture:
 *   - Firearm "Coverage Rifle" (caliber 5.56) — zero ammo lots for 5.56
 *     → caliberCoverage row {5.56, "No ammo"}.
 *   - Firearm "Coverage Pistol" (caliber 9mm) — one low 9mm lot only
 *     → caliberCoverage row {9mm, "Low stock only"}.
 *   - Ammo lot A: caliber 9mm, quantity 0, threshold 10 (low) — the only
 *     9mm lot, so 9mm's coverage reason is "Low stock only", not absent.
 *   - Ammo lot B: caliber .45 ACP, quantity 2, threshold 50 (low) — no
 *     firearm in .45 ACP, so it contributes to the any-lot roll-ups
 *     (ammoEntriesLow/ammoCalibersLow) but not to caliberCoverage.
 *   → ammoEntriesLow == 2, ammoCalibersLow == 2 (9mm, .45 ACP), totalAmmoLots == 2.
 *
 * ASSUMPTION (U4 owns `/ammo` concurrently — not run in this session, so these
 * selectors are inferred from `app/(app)/ammo/{ammo-form,ammo-view,page}.tsx`
 * as they stood at authoring time and may need reconciling against the final
 * U4 UI): field labels "Brand" (optional), "Caliber", "Load type" (optional),
 * "Grain", "Quantity (rounds)", "Low-stock threshold", "Acquired date",
 * "Notes"; submit button "Add lot"; empty-state trigger "Add your first lot";
 * non-empty trigger "Add lot"; toast "Lot logged". Neither `firearms-view.tsx`
 * nor `ammo-view.tsx` render a "Caliber"-labeled filter control once
 * inventory exists (unlike `magazines-view.tsx`'s filter bar, the reason
 * `inventory-crud.spec.ts` scopes its magazine steps to `page.locator("form")`)
 * — confirmed by reading both files at authoring time — but the later steps
 * below still scope to the form defensively, matching that spec's idiom, in
 * case the final U4 UI adds one.
 */
const test = authTest("ammo-summary");

// Never retry: this stateful test mutates the shared per-spec account (creates
// firearms + ammo lots) with no cleanup, so a retry would start from a dirty
// account and its assertions on exact roll-up counts would fail.
test.describe.configure({ retries: 0 });

test("summary shows ammo low-stock roll-ups and caliber coverage for a mixed fixture", async ({
  page,
}) => {
  await test.step("seed a firearm with no ammo for its caliber (5.56)", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await page.getByLabel(/^Name/).fill("Coverage Rifle");
    await page.getByLabel("Caliber").fill("5.56");
    await page.getByLabel(/^Type/).selectOption("rifle");
    await page.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged")).toBeVisible();
  });

  await test.step("seed a firearm whose only ammo will be low (9mm)", async () => {
    await page.getByRole("button", { name: "Add firearm" }).click();
    // Scope to the form: inventory now exists, mirroring
    // inventory-crud.spec.ts's defensive scoping (see file-header note).
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Coverage Pistol");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Coverage Pistol" }),
    ).toHaveCount(1);
  });

  await test.step("add a low 9mm ammo lot", async () => {
    await page.goto("/ammo");
    await page.getByRole("button", { name: "Add your first lot" }).click();
    await page.getByLabel("Caliber").fill("9mm");
    await page.getByLabel("Grain").fill("115");
    await page.getByLabel("Quantity (rounds)").fill("0");
    await page.getByLabel("Low-stock threshold").fill("10");
    await page.getByRole("button", { name: "Add lot" }).click();
    await expect(page.getByText("Lot logged")).toBeVisible();
  });

  await test.step("add a low .45 ACP ammo lot (no matching firearm)", async () => {
    await page.getByRole("button", { name: "Add lot" }).click();
    // Scope to the form: inventory now exists (see file-header note).
    const form = page.locator("form");
    await form.getByLabel("Caliber").fill(".45 ACP");
    await form.getByLabel("Grain").fill("230");
    await form.getByLabel("Quantity (rounds)").fill("2");
    await form.getByLabel("Low-stock threshold").fill("50");
    await page.getByRole("button", { name: "Add lot" }).click();
    // Assert on the row, not the toast — lot A's "Lot logged" toast can
    // still be on screen here, so a toast check can pass against stale UI.
    await expect(
      page.getByRole("row").filter({ hasText: ".45 ACP" }),
    ).toHaveCount(1);
  });

  await test.step("/summary reports both roll-up counts and the coverage table", async () => {
    await page.goto("/summary");

    // Stat cards render as a plain label/value pair with no ARIA role
    // (components/ui/surface.tsx `Stat`) — locate the label text, then assert
    // its containing card also shows the expected value.
    const totalAmmoCard = page.getByText("Total ammo lots").locator("..");
    await expect(totalAmmoCard).toContainText("2");

    const lowLotsCard = page.getByText("Ammo lots low").locator("..");
    await expect(lowLotsCard).toContainText("2");

    const lowCalibersCard = page.getByText("Calibers low").locator("..");
    await expect(lowCalibersCard).toContainText("2");

    await expect(
      page.getByRole("heading", { name: "Caliber coverage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "5.56" }),
    ).toContainText("No ammo");
    await expect(
      page.getByRole("row").filter({ hasText: "9mm" }),
    ).toContainText("Low stock only");
  });
});
