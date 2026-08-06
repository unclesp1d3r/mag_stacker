import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Serialized accessories e2e coverage (#23 U9 — AE1, AE2, AE4, AE5).
 *
 * One sequential journey on a fresh "accessories-serialized" user, mirroring
 * accessories.spec.ts: each step builds on the last. ARIA roles / accessible
 * names / visible text only — no `data-testid` (R18).
 *
 * What this proves that the integration tests cannot: that the three new
 * capabilities are actually reachable through the real UI by a real owner, and
 * that a view-only grantee genuinely sees the data with no mutating control
 * rendered — not merely that the server would refuse the write.
 */
const test = authTest("accessories-serialized");

// Never retry: this stateful journey mutates a shared per-spec account with no
// cleanup, so a retry would start dirty and the exact-count assertions fail.
test.describe.configure({ retries: 0 });

test("serialized accessory: type, compatibility, attachments, sharing, and delete cascade", async ({
  page,
  browser,
}) => {
  const viewer = readArtifact().users.find(
    (u) => u.key === "accessories-serialized-viewer",
  );
  if (!viewer) throw new Error("accessories-serialized-viewer not seeded");

  await test.step("seed three firearms to declare compatibility against", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await page.getByLabel(/^Name/).fill("Can Host Alpha");
    await page.getByLabel("Caliber").fill("5.56");
    await page.getByLabel(/^Type/).selectOption("rifle");
    await page.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(
      page.getByRole("link", { name: "Can Host Alpha" }),
    ).toBeVisible();

    for (const [name, caliber] of [
      ["Can Host Bravo", "5.56"],
      ["Can Host Charlie", "300 BLK"],
    ]) {
      await page.getByRole("button", { name: "Add firearm" }).click();
      const form = page.getByRole("form").or(page.locator("form")).last();
      await form.getByLabel(/^Name/).fill(name);
      await form.getByLabel("Caliber").fill(caliber);
      await form.getByLabel(/^Type/).selectOption("rifle");
      await form.getByLabel("Action").selectOption("semi-auto");
      await page.getByRole("button", { name: "Add firearm" }).click();
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });

  await test.step("AE1: create a suppressor with a type, a serial, and three compatible hosts", async () => {
    await page.goto("/accessories");
    await page
      .getByRole("button", { name: /Add (your first )?accessory/ })
      .click();
    const form = page.locator("form").last();

    await form.getByLabel("Type").selectOption("suppressor");
    await form.getByLabel("Brand").fill("SilencerCo");
    await form.getByLabel("Model").fill("Omega 36M");
    await form.getByLabel("Serial number").fill("ABC123");

    // "Fits these firearms" is the compatibility picker — deliberately not the
    // "Mount on firearm" select below it.
    const fits = page.getByRole("group", { name: "Fits these firearms" });
    await fits.getByLabel("Can Host Alpha").check();
    await fits.getByLabel("Can Host Bravo").check();
    await fits.getByLabel("Can Host Charlie").check();

    await page.getByRole("button", { name: "Add accessory" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Omega 36M" }),
    ).toBeVisible();
  });

  await test.step("AE1: all three hosts show on the detail view, and none became the mount", async () => {
    await page.goto("/accessories");
    // The list's primary link renders the category, falling back to the type
    // label when category is blank (#23 R3) — so it reads "Suppressor" here.
    // Filtering by the row keeps this robust regardless of which it shows.
    await page
      .getByRole("row")
      .filter({ hasText: "Omega 36M" })
      .getByRole("link")
      .click();

    await expect(page.getByText("ABC123")).toBeVisible();
    for (const host of [
      "Can Host Alpha",
      "Can Host Bravo",
      "Can Host Charlie",
    ]) {
      await expect(page.getByRole("link", { name: host })).toBeVisible();
    }

    // The decisive AE1 assertion: declaring compatibility did NOT mount it.
    // The mount control still reads unmounted.
    await expect(
      page.getByRole("combobox", { name: "Mount on firearm" }),
    ).toHaveValue("");
  });

  await test.step("AE4: add a piston attachment and confirm it survives a reload", async () => {
    await page.getByRole("button", { name: "Add attachment" }).click();
    const panel = page.locator("form").last();
    await panel.getByLabel("Attachment type").selectOption("piston");
    await panel.getByLabel("Spec").fill("1/2x28");
    await page.getByRole("button", { name: "Add attachment" }).click();

    const attachmentRow = page
      .getByRole("listitem")
      .filter({ hasText: "1/2x28" });
    await expect(attachmentRow).toBeVisible();
    await expect(attachmentRow).toContainText("Piston");

    // AE4's real claim: it PERSISTS, rather than only living in local state.
    await page.reload();
    const afterReload = page
      .getByRole("listitem")
      .filter({ hasText: "1/2x28" });
    await expect(afterReload).toBeVisible();
    await expect(afterReload).toContainText("Piston");
  });

  await test.step("AE2: share the suppressor view-only with a second user", async () => {
    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("share ONE of the three hosts, so the viewer-relative rule is observable", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Can Host Alpha" })
      .getByRole("button", { name: "Share" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
  });

  await test.step("AE2: the grantee sees it listed, with compatibility and attachments but no controls", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("accessories-serialized-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();

      // It appears in their own accessories list — the #8 model could not do
      // this, because the suppressor is unmounted.
      await vp.goto("/accessories");
      await vp
        .getByRole("row")
        .filter({ hasText: "Omega 36M" })
        .getByRole("link")
        .click();

      await expect(vp.getByText("ABC123")).toBeVisible();
      await expect(
        vp.getByRole("listitem").filter({ hasText: "1/2x28" }),
      ).toBeVisible();

      // Compatibility reads are VIEWER-RELATIVE: the grantee sees the one host
      // that was also shared with them, and the other two are dropped rather
      // than leaked. Sharing an accessory must not disclose the identity of
      // firearms the grantee has no access to.
      await expect(
        vp.getByRole("link", { name: "Can Host Alpha" }),
      ).toBeVisible();
      await expect(
        vp.getByRole("link", { name: "Can Host Bravo" }),
      ).toHaveCount(0);
      await expect(
        vp.getByRole("link", { name: "Can Host Charlie" }),
      ).toHaveCount(0);

      // R17: read-only means no mutating affordance is rendered at all.
      await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);
      await expect(
        vp.getByRole("button", { name: "Add attachment" }),
      ).toHaveCount(0);
      await expect(
        vp.getByRole("button", { name: /Remove .* attachment/ }),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });

  await test.step("AE5: deleting the accessory removes it and its children, leaving the firearms", async () => {
    await page.goto("/accessories");
    await page
      .getByRole("row")
      .filter({ hasText: "Omega 36M" })
      .getByRole("button", { name: "Delete" })
      .click();
    // ConfirmDialog renders role="alertdialog" (the app replaced native
    // confirm() with a focus-managed one) — distinct from ShareControl's
    // role="dialog" used above.
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(
      page.getByRole("row").filter({ hasText: "Omega 36M" }),
    ).toHaveCount(0);

    // The hosts it was compatible with are untouched.
    await page.goto("/firearms");
    for (const host of [
      "Can Host Alpha",
      "Can Host Bravo",
      "Can Host Charlie",
    ]) {
      await expect(page.getByRole("link", { name: host })).toBeVisible();
    }
  });

  await test.step("AE5: the grantee can no longer reach the deleted accessory", async () => {
    const viewerContext = await browser.newContext({
      storageState: storageStateFor("accessories-serialized-viewer"),
    });
    try {
      const vp = await viewerContext.newPage();
      await vp.goto("/accessories");
      await expect(
        vp.getByRole("row").filter({ hasText: "Omega 36M" }),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });
});
