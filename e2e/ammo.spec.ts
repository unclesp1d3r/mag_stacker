import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Ammo inventory surface (ammo plan U4): empty state, create/edit with caliber
 * and load-type suggestions, the derived low-stock indicator, delete
 * confirmation, keyboard operability, and edit-capable sharing (unlike
 * magazines, which are view-only-shareable). One sequential test on a fresh
 * "ammo" user — each step builds on the last, mirroring
 * `inventory-crud.spec.ts`. workers:1 keeps ordering deterministic. ARIA
 * roles / accessible names / visible text only — no `data-testid`.
 */
const test = authTest("ammo");

// Never retry: this stateful test mutates the shared per-spec account (creates
// several lots) with no cleanup, so a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("ammo CRUD, low-stock indicator, suggestions, and edit-capable sharing", async ({
  page,
  browser,
}) => {
  await test.step("empty inventory renders the empty state (R13)", async () => {
    await page.goto("/ammo");
    await expect(
      page.getByRole("heading", { name: "No ammo on hand" }),
    ).toBeVisible();
  });

  await test.step("add a lot → 'Lot logged' and it appears in the list (R13)", async () => {
    await page.getByRole("button", { name: "Add your first lot" }).click();
    const form = page.locator("form");
    await form.getByLabel("Brand").fill("Federal");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Load type").fill("FMJ");
    await form.getByLabel("Quantity (rounds)").fill("100");
    await form.getByLabel("Low-stock threshold").fill("20");
    await page.getByRole("button", { name: "Add lot" }).click();

    await expect(page.getByText("Lot logged")).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Federal" }),
    ).toHaveCount(1);
  });

  await test.step("a lot at/below its threshold shows 'Low stock'; one above does not (AE2/R10)", async () => {
    await page.getByRole("button", { name: "Add lot" }).click();
    const form = page.locator("form");
    await form.getByLabel("Brand").fill("LowAmmoBrand");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Quantity (rounds)").fill("5");
    await form.getByLabel("Low-stock threshold").fill("20");
    await page.getByRole("button", { name: "Add lot" }).click();
    // `.last()`: the previous lot's "Lot logged" toast can still be on
    // screen, so an unscoped getByText is a strict-mode violation here.
    await expect(page.getByText("Lot logged").last()).toBeVisible();

    const lowRow = page.getByRole("row").filter({ hasText: "LowAmmoBrand" });
    await expect(lowRow.getByText("Low stock")).toBeVisible();

    // The Federal lot (100 rounds, threshold 20) sits above its threshold and
    // carries no low-stock badge — text label only, never color alone.
    const okRow = page.getByRole("row").filter({ hasText: "Federal" });
    await expect(okRow.getByText("Low stock")).toHaveCount(0);
  });

  await test.step("caliber and load-type suggestion fields accept a typed off-list value (AE5/R5/R6)", async () => {
    await page.getByRole("button", { name: "Add lot" }).click();
    const form = page.locator("form");

    const caliberInput = form.getByLabel("Caliber");
    await expect(caliberInput).toHaveAttribute("list", "ammo-calibers");
    await expect(
      page.locator("datalist#ammo-calibers option").first(),
    ).toBeAttached();

    const typeInput = form.getByLabel("Load type");
    await expect(typeInput).toHaveAttribute("list", "ammo-types");
    await expect(
      page.locator('datalist#ammo-types option[value="FMJ"]'),
    ).toHaveCount(1);

    // Both fields accept a value that is not in their suggestion list.
    await caliberInput.fill(".458 SOCOM");
    await typeInput.fill("Frangible+P Custom");
    await form.getByLabel("Quantity (rounds)").fill("50");
    await page.getByRole("button", { name: "Add lot" }).click();

    await expect(page.getByText("Lot logged").last()).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: ".458 SOCOM" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("row").filter({ hasText: "Frangible+P Custom" }),
    ).toHaveCount(1);
  });

  await test.step("every control is keyboard operable with an accessible name (R14)", async () => {
    const addButton = page.getByRole("button", { name: "Add lot" });
    await addButton.focus();
    await expect(addButton).toBeFocused();
    await page.keyboard.press("Enter");

    const form = page.locator("form");
    await expect(form.getByLabel("Caliber")).toBeVisible();
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await cancelButton.focus();
    await expect(cancelButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
  });

  await test.step("delete opens ConfirmDialog; confirming removes the lot and toasts (R13)", async () => {
    const trigger = page
      .getByRole("row")
      .filter({ hasText: "LowAmmoBrand" })
      .getByRole("button", { name: "Delete" });
    await trigger.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Lot removed")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("row").filter({ hasText: "LowAmmoBrand" }),
    ).toHaveCount(0);
  });

  await test.step("the ammo detail offers an edit grant via share-control, unlike magazines (R4/KTD4)", async () => {
    const viewer = readArtifact().users.find((u) => u.key === "ammo-viewer");
    if (!viewer) throw new Error("ammo-viewer not seeded");

    await page
      .getByRole("row")
      .filter({ hasText: "Federal" })
      .getByRole("link")
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: /Federal/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    // Ammo is edit-capable-shareable (unlike magazines' view-only sharing): the
    // Permission select is present and offers "edit".
    await expect(dialog.getByLabel("Permission")).toBeVisible();
    await dialog.getByLabel("Permission").selectOption("edit");
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    const viewerContext = await browser.newContext({
      storageState: storageStateFor("ammo-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();
      await vp.goto("/ammo");
      await vp
        .getByRole("row")
        .filter({ hasText: "Federal" })
        .getByRole("link")
        .click();
      // Edit-grantee tier: Edit is available; Delete/Share are owner-only and
      // stay absent (mirrors the firearm edit-grantee tier).
      await expect(vp.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });

  await test.step("a no-access ammo detail URL resolves as not-found (R9)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`/ammo/${fakeId}`);
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
    // A malformed (non-uuid) id resolves as not-found too, never a 500.
    await page.goto("/ammo/not-a-real-id");
    await expect(
      page.getByRole("heading", { name: "Not found" }),
    ).toBeVisible();
  });
});
