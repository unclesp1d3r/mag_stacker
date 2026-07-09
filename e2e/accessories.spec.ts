import { readFile } from "node:fs/promises";
import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Accessories e2e coverage (accessory plan U8, AE1/AE2/AE4/AE5 e2e legs). One
 * sequential test on a fresh "accessories" user: each step builds on the last,
 * mirroring ammo.spec.ts / detail-view-sharing.spec.ts. workers:1 keeps
 * ordering deterministic. ARIA roles / accessible names / visible text only —
 * no `data-testid`.
 *
 * Fixture shape:
 *   - Firearm "Accessory Host A" (5.56) and "Accessory Host B" (9mm).
 *   - A magazine, seeded only to satisfy the CSV export button's
 *     inventory-exists gate (mirrors inventory-crud.spec.ts).
 *   - Accessory "Optic" (Vortex Viper PST, serial SN-OPTIC-UNMOUNTED) — never
 *     mounted, for the AE1 invisibility check.
 *   - Accessory "Light" (Surefire X300, serial SN-LIGHT-NFA, $100.00, NFA) —
 *     mounted on Host A, then moved to Host B (the move-mount scenario), then
 *     shared read-only via Host B (AE1/AE5).
 *   - Accessory "Rail" ($50.00) and "Sling" (costless) — both mounted on Host
 *     A throughout, for the AE2 valuation roll-up (two costed + one costless).
 */
const test = authTest("accessories");

// Never retry: this stateful test mutates the shared per-spec account (creates
// firearms, a magazine, and several accessories) with no cleanup, so a retry
// would start from a dirty account and its exact-count assertions would fail.
test.describe.configure({ retries: 0 });

test("accessory CRUD, mount move, valuation, NFA display, sharing inheritance, and CSV exclusion", async ({
  page,
  browser,
}) => {
  let firearmAId = "";
  let firearmBId = "";

  await test.step("seed two firearms and a magazine", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await page.getByLabel(/^Name/).fill("Accessory Host A");
    await page.getByLabel("Caliber").fill("5.56");
    await page.getByLabel(/^Type/).selectOption("rifle");
    await page.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Accessory Host B");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();

    // Capture both ids from the list's row links (no extra navigation) so
    // later steps can jump straight to a firearm's detail page and the
    // sharing step can build the viewer's URL.
    const hostAHref = await page
      .getByRole("link", { name: "Accessory Host A" })
      .getAttribute("href");
    const hostBHref = await page
      .getByRole("link", { name: "Accessory Host B" })
      .getAttribute("href");
    firearmAId = hostAHref?.split("/firearms/")[1] ?? "";
    firearmBId = hostBHref?.split("/firearms/")[1] ?? "";
    expect(firearmAId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firearmBId).toMatch(/^[0-9a-f-]{36}$/);

    // A magazine only so the CSV export button's inventory-exists gate opens
    // (mirrors inventory-crud.spec.ts) — not otherwise used by this spec.
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add your first magazine" }).click();
    const magForm = page.locator("form");
    await magForm.getByLabel("Brand / model").fill("Accessory Spec Mag");
    await magForm.getByLabel("Caliber").fill("9mm");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByText("Magazine seated")).toBeVisible();
  });

  let opticId = "";

  await test.step("create an unmounted accessory (Optic) → 'Accessory logged'", async () => {
    await page.goto("/accessories");
    await page
      .getByRole("button", { name: "Add your first accessory" })
      .click();
    const form = page.locator("form");
    await form.getByLabel("Category").fill("Optic");
    await form.getByLabel("Brand").fill("Vortex");
    await form.getByLabel("Model").fill("Viper PST");
    await form.getByLabel("Serial number").fill("SN-OPTIC-UNMOUNTED");
    await page.getByRole("button", { name: "Add accessory" }).click();

    await expect(page.getByText("Accessory logged").first()).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Optic" });
    await expect(row).toHaveCount(1);
    // Unmounted: the "Mounted on" column has no firearm link.
    await expect(row.getByRole("link")).toHaveCount(1); // only the category link

    await row.getByRole("link", { name: "Optic" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Vortex Viper PST" }),
    ).toBeVisible();
    opticId = page.url().split("/accessories/")[1];
    expect(opticId).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "← Accessories" }).click();
  });

  await test.step("create a mounted accessory (Light, NFA) on Host A → row shows category/cost/NFA/mount (R1)", async () => {
    await page.getByRole("button", { name: "Add accessory" }).click();
    const form = page.locator("form");
    await form.getByLabel("Category").fill("Light");
    await form.getByLabel("Brand").fill("Surefire");
    await form.getByLabel("Model").fill("X300");
    await form.getByLabel("Serial number").fill("SN-LIGHT-NFA");
    await form.getByLabel("Cost").fill("100.00");
    await form.getByLabel("NFA-regulated item").check();
    await form
      .getByLabel("Mount on firearm")
      .selectOption({ label: "Accessory Host A" });
    await page.getByRole("button", { name: "Add accessory" }).click();

    await expect(page.getByText("Accessory logged").last()).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Light" });
    await expect(row).toContainText("$100.00");
    await expect(row.getByText("NFA")).toBeVisible();
    await expect(
      row.getByRole("link", { name: "Accessory Host A" }),
    ).toBeVisible();
  });

  await test.step("mount two more accessories on Host A: Rail ($50) and Sling (costless)", async () => {
    await page.getByRole("button", { name: "Add accessory" }).click();
    const railForm = page.locator("form");
    await railForm.getByLabel("Category").fill("Rail");
    await railForm.getByLabel("Cost").fill("50.00");
    await railForm
      .getByLabel("Mount on firearm")
      .selectOption({ label: "Accessory Host A" });
    await page.getByRole("button", { name: "Add accessory" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Rail" }),
    ).toContainText("$50.00");

    await page.getByRole("button", { name: "Add accessory" }).click();
    const slingForm = page.locator("form");
    await slingForm.getByLabel("Category").fill("Sling");
    await slingForm
      .getByLabel("Mount on firearm")
      .selectOption({ label: "Accessory Host A" });
    await page.getByRole("button", { name: "Add accessory" }).click();
    const slingRow = page.getByRole("row").filter({ hasText: "Sling" });
    await expect(slingRow).toBeVisible();
    await expect(slingRow).toContainText("—");
  });

  await test.step("Host A's detail page sums the mounted total: two costed + one costless = $150.00 (AE2)", async () => {
    await page.goto(`/firearms/${firearmAId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Accessory Host A" }),
    ).toBeVisible();

    const summary = page.getByText(/total value/);
    await expect(summary).toHaveText("3 accessories · $150.00 total value");

    const lightItem = page.getByRole("listitem").filter({
      hasText: "Surefire X300",
    });
    await expect(lightItem).toContainText("$100.00");
    await expect(lightItem.getByText("NFA")).toBeVisible();

    const railItem = page.getByRole("listitem").filter({ hasText: "Rail" });
    await expect(railItem).toContainText("$50.00");

    const slingItem = page.getByRole("listitem").filter({ hasText: "Sling" });
    await expect(slingItem).toContainText("—");

    // The unmounted Optic never appears here and never contributes to the
    // total — it simply isn't in the mounted list at all.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Optic" }),
    ).toHaveCount(0);
  });

  await test.step("move Light from Host A to Host B via the detail view's mount control (R2)", async () => {
    await page.goto("/accessories");
    await page
      .getByRole("row")
      .filter({ hasText: "Light" })
      .getByRole("link", { name: "Light" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Surefire X300" }),
    ).toBeVisible();
    // Serial + cost persisted from creation, visible before the move.
    await expect(page.getByText("SN-LIGHT-NFA")).toBeVisible();
    await expect(page.getByText("$100.00")).toBeVisible();

    await page
      .getByLabel("Mount on firearm")
      .selectOption({ label: "Accessory Host B" });
    await expect(page.getByText("Moved")).toBeVisible();

    // Cost + serial persist across the move — same detail page, refreshed.
    await expect(page.getByText("SN-LIGHT-NFA")).toBeVisible();
    await expect(page.getByText("$100.00")).toBeVisible();
    await expect(page.getByLabel("Mount on firearm")).toHaveValue(firearmBId);
  });

  await test.step("Light leaves Host A's mounted section; Host A's total drops to $50.00", async () => {
    await page.goto(`/firearms/${firearmAId}`);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Surefire X300" }),
    ).toHaveCount(0);
    await expect(page.getByText(/total value/)).toHaveText(
      "2 accessories · $50.00 total value",
    );
  });

  await test.step("Light appears in Host B's mounted section with cost preserved; total is $100.00", async () => {
    await page.goto(`/firearms/${firearmBId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Accessory Host B" }),
    ).toBeVisible();

    await expect(page.getByText(/total value/)).toHaveText(
      "1 accessory · $100.00 total value",
    );
    const lightItem = page.getByRole("listitem").filter({
      hasText: "Surefire X300",
    });
    await expect(lightItem).toContainText("$100.00");
    await expect(lightItem.getByText("NFA")).toBeVisible();
  });

  await test.step("owner shares Host B view-only with a second user", async () => {
    const viewer = readArtifact().users.find(
      (u) => u.key === "accessories-viewer",
    );
    if (!viewer) throw new Error("accessories-viewer not seeded");

    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Accessory Host B" })
      .getByRole("button", { name: "Share" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    // Default permission is "view" — left untouched (AE1 needs a view grant).
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("view-grantee sees the mounted accessory read-only with its NFA marker (AE1/AE5), but never the owner's unmounted accessory", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("accessories-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();

      await vp.goto(`/firearms/${firearmBId}`);
      await expect(
        vp.getByRole("heading", { level: 1, name: "Accessory Host B" }),
      ).toBeVisible();
      const lightItem = vp.getByRole("listitem").filter({
        hasText: "Surefire X300",
      });
      await expect(lightItem).toBeVisible();
      await expect(lightItem).toContainText("$100.00");
      // AE5: the NFA marker renders for a view-grantee too.
      await expect(lightItem.getByText("NFA")).toBeVisible();
      // Read-only: no "Add accessory" link (canEdit is false for a viewer).
      await expect(vp.getByRole("link", { name: "Add accessory" })).toHaveCount(
        0,
      );

      await vp.goto("/accessories");
      // The mounted-and-shared Light is visible (inherits Host B's grant)...
      await expect(
        vp.getByRole("row").filter({ hasText: "Light" }),
      ).toHaveCount(1);
      // ...but the owner's unmounted Optic is not visible anywhere: absent
      // from the list...
      await expect(
        vp.getByRole("row").filter({ hasText: "Optic" }),
      ).toHaveCount(0);
      // Rail/Sling (mounted on the NOT-shared Host A) are likewise invisible.
      await expect(vp.getByRole("row").filter({ hasText: "Rail" })).toHaveCount(
        0,
      );
      await expect(
        vp.getByRole("row").filter({ hasText: "Sling" }),
      ).toHaveCount(0);

      // ...and a direct URL to it resolves as not-found (R9-style), never
      // revealing its existence.
      await vp.goto(`/accessories/${opticId}`);
      await expect(
        vp.getByRole("heading", { name: "Not found" }),
      ).toBeVisible();

      // The visible mounted accessory's own detail page is read-only too.
      await vp.goto("/accessories");
      await vp
        .getByRole("row")
        .filter({ hasText: "Light" })
        .getByRole("link", { name: "Light" })
        .click();
      await expect(
        vp.getByRole("heading", { level: 1, name: "Surefire X300" }),
      ).toBeVisible();
      await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });

  await test.step("exported inventory CSV never includes an accessory serial number (AE4)", async () => {
    await page.goto("/magazines");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("magstacker-inventory.csv");
    const path = await download.path();
    if (!path) throw new Error("download did not resolve to a local path");
    const csv = await readFile(path, "utf8");

    // Accessories are entirely absent from the export — no accessory serial
    // number ever appears, regardless of mount state.
    expect(csv).not.toContain("SN-LIGHT-NFA");
    expect(csv).not.toContain("SN-OPTIC-UNMOUNTED");
  });
});
