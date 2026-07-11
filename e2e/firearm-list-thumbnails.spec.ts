import type { Page } from "@playwright/test";
import { authTest, expect, readArtifact } from "./fixtures/auth";

/**
 * Primary-photo thumbnails on the firearm list (U8; R16, R17, R18, R22;
 * AE6): a firearm with a primary photo shows its thumbnail via the batched
 * `primaryThumbnailsFor` lookup threaded through the page loader; a firearm
 * with no primary shows a fixed-size neutral placeholder — no broken image,
 * no row-height shift.
 *
 * Getting a firearm into "has a primary photo" state depends on U7's
 * detail-view upload control (`app/(app)/firearms/[id]/firearm-photos.tsx`):
 * an "Upload photos" file input that uploads on `change` (no separate submit
 * button) and, per the Planning Contract's "first photo on a firearm with no
 * primary auto-becomes primary" rule, needs no separate set-primary step.
 */
const test = authTest("firearm-list-thumbnails");

// Never retry: creates two firearms with no cleanup on a fresh per-spec
// account, mirroring inventory-crud.spec.ts's stateful-test convention.
test.describe.configure({ retries: 0 });

const PHOTO_FIREARM = "Photo Thumbnail Test Rifle";
const NO_PHOTO_FIREARM = "No Photo Test Pistol";
const SAMPLE_PHOTO = "e2e/fixtures/sample-photo-1.jpg";

/** Minimal valid "Add firearm" submission (Type/Action are required, R7). */
async function addFirearm(
  page: Page,
  name: string,
  opts: { first: boolean },
): Promise<void> {
  await page
    .getByRole("button", {
      name: opts.first ? "Add your first firearm" : "Add firearm",
    })
    .click();
  const form = page.locator("form");
  await form.getByLabel(/^Name/).fill(name);
  await form.getByLabel("Caliber").fill("9mm");
  await form.getByLabel(/^Type/).selectOption("pistol");
  await form.getByLabel("Action").selectOption("semi-auto");
  await page.getByRole("button", { name: "Add firearm" }).click();
  await page.getByRole("link", { name }).first().waitFor();
}

test("firearm list shows the primary thumbnail, and a neutral placeholder when there is none", async ({
  page,
}) => {
  await test.step("create two firearms: one gets a photo, one doesn't", async () => {
    await page.goto("/firearms");
    await addFirearm(page, PHOTO_FIREARM, { first: true });
    await addFirearm(page, NO_PHOTO_FIREARM, { first: false });
  });

  await test.step("upload a photo on the first firearm's detail page", async () => {
    await page.getByRole("link", { name: PHOTO_FIREARM }).first().click();
    await expect(
      page.getByRole("heading", { name: PHOTO_FIREARM, level: 1 }),
    ).toBeVisible();

    // Upload has no separate submit step — selecting a file triggers it
    // on `change` (firearm-photos.tsx `handleFilesSelected`).
    await page.getByLabel("Upload photos").setInputFiles(SAMPLE_PHOTO);

    // Deterministic completion signal: the success toast from
    // `handleFilesSelected`, then the newly-primary photo rendered under
    // the detail page's own "Primary photo" section (accessible name is
    // the caption, or `${firearmName} — photo ${position}` when
    // uncaptioned — `getByRole` string matching is substring-based, so
    // matching on the firearm name alone is sufficient here).
    await expect(page.getByText(/1 photo uploaded/)).toBeVisible();
    // Two `<img>`s now share this accessible name (the "Primary photo"
    // preview and the one gallery thumbnail both fall back to the same
    // uncaptioned name) — `.first()` avoids a strict-mode violation.
    await expect(
      page.getByRole("img", { name: PHOTO_FIREARM }).first(),
    ).toBeVisible();
  });

  let thumbUrl = "";

  await test.step("the list shows the primary thumbnail via the /thumb variant", async () => {
    await page.goto("/firearms");
    const photoRow = page.getByRole("row").filter({ hasText: PHOTO_FIREARM });
    const thumb = photoRow.getByRole("img", { name: PHOTO_FIREARM });
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute("src", /\/api\/photos\/[^/]+\/thumb$/);
    // Resolve to an absolute URL against the app origin so the request in the
    // next step targets the serving route directly.
    const src = (await thumb.getAttribute("src")) ?? "";
    thumbUrl = new URL(src, readArtifact().baseURL).href;
  });

  await test.step("the serving route sends an image content-type with the nosniff header (R13)", async () => {
    const res = await page.request.get(thumbUrl);
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toMatch(/^image\//);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  // The serving route's unauthenticated-request rejection (401 on no session)
  // is covered by the route's explicit `getCurrentUser()` guard plus the
  // domain-layer authz coverage in
  // `src/domain/firearm-photos/__tests__/serving.test.ts` (getServablePhoto
  // returns null for a no-access actor -> 404) and AE2. It is not asserted here
  // because the pre-minted-session e2e harness cannot construct a genuinely
  // sessionless browser context to exercise it cleanly.

  await test.step("a firearm with no primary shows the placeholder, never a broken image", async () => {
    const noPhotoRow = page
      .getByRole("row")
      .filter({ hasText: NO_PHOTO_FIREARM });
    // The placeholder is decorative (`aria-hidden`) and carries no accessible
    // name, so its absence from the accessibility tree — zero `img` roles in
    // this row — is the correct proxy for "no broken image, no reflow".
    await expect(noPhotoRow.getByRole("img")).toHaveCount(0);
  });
});
