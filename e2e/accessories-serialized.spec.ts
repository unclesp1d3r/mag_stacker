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

  await test.step("edit an existing attachment through the UI", async () => {
    await page.getByRole("button", { name: /Edit .* attachment/ }).click();
    const editPanel = page.locator("form").last();
    await editPanel.getByLabel("Spec").fill("5/8x24");
    await page.getByRole("button", { name: "Save attachment" }).click();

    const row = page.getByRole("listitem").filter({ hasText: "5/8x24" });
    await expect(row).toBeVisible();
    await expect(page.getByText("1/2x28")).toHaveCount(0);
  });

  await test.step("edit the accessory itself: change type and drop one compatible host", async () => {
    // `exact: true` matters: Playwright matches accessible names by SUBSTRING
    // by default, so a bare "Edit" also matches "Edit Piston attachment" and
    // `.first()` would be resolving by DOM order rather than by name.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const form = page.locator("form").last();

    await form.getByLabel("Type").selectOption("muzzle device");
    // Deselecting must actually remove the pairing, not merely re-order it.
    await form
      .getByRole("group", { name: "Fits these firearms" })
      .getByLabel("Can Host Charlie")
      .uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByRole("link", { name: "Can Host Charlie" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Can Host Alpha" }),
    ).toBeVisible();

    // Reopen and assert the new type actually PERSISTED. Without this the step
    // proves only the compatibility half: a write path that silently dropped
    // `type` would still pass every assertion above.
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("form").last().getByLabel("Type")).toHaveValue(
      "muzzle device",
    );

    // Restore it, and assert THAT save landed too. The check here used to be
    // the serial number, which was already on screen before the step ran and
    // so only proved the form had closed.
    await page
      .locator("form")
      .last()
      .getByLabel("Type")
      .selectOption("suppressor");
    await page.getByRole("button", { name: "Save changes" }).click();

    // Wait for the save to actually settle before reopening: the form closing
    // is the signal the write landed and the detail view refreshed. Reopening
    // immediately reads the PREVIOUS form's value and fails under load.
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator("form").last().getByLabel("Type")).toHaveValue(
      "suppressor",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
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
      // The edited spec (the attachment was updated from 1/2x28 earlier in
      // this journey) — proves the grantee reads current state, not a stale
      // snapshot from when the share was created.
      await expect(
        vp.getByRole("listitem").filter({ hasText: "5/8x24" }),
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
      // Bare "Edit" matches by substring, so this covers the accessory-level
      // control AND every "Edit <type> attachment" button in one assertion.
      await expect(vp.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(vp.getByRole("button", { name: "Share" })).toHaveCount(0);
      await expect(
        vp.getByRole("button", { name: "Add attachment" }),
      ).toHaveCount(0);
      await expect(
        vp.getByRole("button", { name: /^Edit .* attachment$/ }),
      ).toHaveCount(0);
      await expect(
        vp.getByRole("button", { name: /^Remove .* attachment$/ }),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  });

  await test.step("re-sharing at EDIT gives the grantee mutating controls", async () => {
    // #23 made accessories edit-shareable alongside firearms and ammo, so the
    // Permission select is offered for them (magazines stay view-only).
    await page.goto("/accessories");
    await page
      .getByRole("row")
      .filter({ hasText: "Omega 36M" })
      .getByRole("button", { name: "Share" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User").selectOption({ label: viewer.email });
    await dialog.getByLabel("Permission").selectOption("edit");
    await dialog.getByRole("button", { name: "Share" }).click();
    await expect(
      dialog.getByRole("listitem").filter({ hasText: viewer.email }),
    ).toBeVisible();
    // Navigate away rather than clicking Done: re-granting an EXISTING share
    // re-renders the dialog, so a click racing that re-render can land on a
    // detached node. The Done button's own behavior is already covered by the
    // first share step above; this step is about the grantee's controls.
    await page.goto("/accessories");

    const editorContext = await browser.newContext({
      storageState: storageStateFor("accessories-serialized-viewer"),
    });
    try {
      const ep = await editorContext.newPage();
      await ep.goto("/accessories");
      await ep
        .getByRole("row")
        .filter({ hasText: "Omega 36M" })
        .getByRole("link")
        .click();

      // Edit affordances appear for an edit-grantee...
      await expect(
        ep.getByRole("button", { name: "Edit", exact: true }),
      ).toBeVisible();
      await expect(
        ep.getByRole("button", { name: "Add attachment" }),
      ).toBeVisible();
      // ...but sharing onward and deleting remain owner-only.
      await expect(ep.getByRole("button", { name: "Share" })).toHaveCount(0);
      await expect(ep.getByRole("button", { name: "Delete" })).toHaveCount(0);
    } finally {
      await editorContext.close();
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
