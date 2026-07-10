import path from "node:path";
import { authTest, expect } from "./fixtures/auth";

/**
 * Firearm photo management e2e coverage (#9 U7 — R15, R17, R21-R25).
 * One sequential test on a fresh "firearm-photos" user: each step builds on
 * the last (mirrors accessories.spec.ts / range-sessions.spec.ts).
 * ARIA roles / accessible names / visible text only — no `data-testid`.
 */
const test = authTest("firearm-photos");

// Stateful, no per-step cleanup — a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const VALID_PHOTO_1 = path.join(FIXTURES_DIR, "sample-photo-1.jpg");
const VALID_PHOTO_2 = path.join(FIXTURES_DIR, "sample-photo-2.jpg");
const INVALID_FILE = path.join(FIXTURES_DIR, "not-an-image.txt");

test("upload, mixed-validity batch, primary, keyboard reorder, delete, and empty state", async ({
  page,
}) => {
  const gallery = page.getByRole("list", { name: "Photo gallery" });

  await test.step("create a firearm with no photos → empty-state placeholder renders", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    await page.getByLabel(/^Name/).fill("Gallery Rifle");
    await page.getByLabel("Caliber").fill("5.56");
    await page.getByLabel(/^Type/).selectOption("rifle");
    await page.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("link", { name: "Gallery Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Gallery Rifle" }),
    ).toBeVisible();

    await expect(page.getByText("No photos yet")).toBeVisible();
    await expect(gallery.getByRole("listitem")).toHaveCount(0);
    // The upload control still renders alongside the empty-state placeholder
    // (R22 — the placeholder never hides the affordance).
    await expect(page.getByLabel("Upload photos")).toBeVisible();
  });

  await test.step("upload two valid photos → both appear, first is auto-primary (F1)", async () => {
    await page
      .getByLabel("Upload photos")
      .setInputFiles([VALID_PHOTO_1, VALID_PHOTO_2]);
    await expect(page.getByText("2 photos uploaded")).toBeVisible();
    await expect(gallery.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("No photos yet")).toHaveCount(0);
    await expect(
      gallery.getByRole("listitem").first().getByText("Primary"),
    ).toBeVisible();
  });

  await test.step("caption the first two photos so later steps can identify them by name", async () => {
    await page.getByRole("button", { name: "Add caption for photo 1" }).click();
    await page.getByLabel("Caption for photo 1").fill("Front");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Front")).toBeVisible();

    await page.getByRole("button", { name: "Add caption for photo 2" }).click();
    await page.getByLabel("Caption for photo 2").fill("Side");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Side")).toBeVisible();
  });

  await test.step("mixed-validity batch: one valid photo + one invalid file → the valid one persists, the invalid one is rejected with a reason (AE7)", async () => {
    await page
      .getByLabel("Upload photos")
      .setInputFiles([VALID_PHOTO_1, INVALID_FILE]);

    await expect(page.getByText("1 photo uploaded")).toBeVisible();
    await expect(gallery.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText(/not-an-image\.txt/)).toBeVisible();
    await expect(page.getByText(/unsupported file type/)).toBeVisible();

    await page.getByRole("button", { name: "Add caption for photo 3" }).click();
    await page.getByLabel("Caption for photo 3").fill("Detail");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Detail")).toBeVisible();
  });

  await test.step("gallery order is Front, Side, Detail", async () => {
    const items = gallery.getByRole("listitem");
    await expect(items.nth(0)).toContainText("Front");
    await expect(items.nth(1)).toContainText("Side");
    await expect(items.nth(2)).toContainText("Detail");
  });

  await test.step("mark 'Detail' primary (F2/AE1)", async () => {
    await page.getByRole("button", { name: "Set photo 3 as primary" }).click();
    const detailItem = gallery.getByRole("listitem").filter({
      hasText: "Detail",
    });
    await expect(detailItem.getByText("Primary")).toBeVisible();
    const frontItem = gallery.getByRole("listitem").filter({
      hasText: "Front",
    });
    await expect(frontItem.getByText("Primary")).toHaveCount(0);
    // The primary preview slot swaps to the newly-primary photo.
    await expect(page.getByRole("figure").getByText("Detail")).toBeVisible();
  });

  await test.step("keyboard-operable reorder: move 'Detail' up from position 3 to 2 (R24)", async () => {
    await page.getByRole("button", { name: "Move photo 3 up" }).click();
    const items = gallery.getByRole("listitem");
    await expect(items.nth(0)).toContainText("Front");
    await expect(items.nth(1)).toContainText("Detail");
    await expect(items.nth(2)).toContainText("Side");
  });

  await test.step("delete the primary photo ('Detail') → the next photo by sort order auto-promotes to primary (F3/AE8)", async () => {
    await page.getByRole("button", { name: "Delete photo 2" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Delete this photo?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Photo deleted")).toBeVisible();

    await expect(gallery.getByRole("listitem")).toHaveCount(2);
    await expect(
      gallery.getByRole("listitem").filter({ hasText: "Detail" }),
    ).toHaveCount(0);

    const frontItem = gallery.getByRole("listitem").filter({
      hasText: "Front",
    });
    await expect(frontItem.getByText("Primary")).toBeVisible();
    await expect(page.getByRole("figure").getByText("Front")).toBeVisible();
  });

  await test.step("a second, photo-less firearm shows the empty-state placeholder (R22)", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Empty Rifle");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel(/^Type/).selectOption("pistol");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();

    await page.getByRole("link", { name: "Empty Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Empty Rifle" }),
    ).toBeVisible();
    await expect(page.getByText("No photos yet")).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Photo gallery" }).getByRole("listitem"),
    ).toHaveCount(0);
  });
});
