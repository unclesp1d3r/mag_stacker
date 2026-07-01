import { authTest, expect } from "./fixtures/auth";

/**
 * Cold-start onboarding and controls-gating on an empty account (R5). The
 * "onboarding" user is pre-seeded with no inventory, so it always sees the
 * cold-start surface.
 */
const test = authTest("onboarding");

const SEARCH_LABEL = /Search brand \/ model/;

test.describe("onboarding cold-start (R5)", () => {
  test("empty magazines shows onboarding CTAs and hides inventory controls", async ({
    page,
  }) => {
    await page.goto("/magazines");

    await expect(
      page.getByRole("heading", { name: "Set up your inventory" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add a firearm" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start with a magazine" }),
    ).toBeVisible();

    // Controls only make sense once inventory exists — absent on a cold start.
    await expect(page.getByLabel(SEARCH_LABEL)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Add magazine" }),
    ).toHaveCount(0);
  });

  test("'Add a firearm' navigates to the firearms cold-start", async ({
    page,
  }) => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Add a firearm" }).click();

    await expect(page).toHaveURL(/\/firearms/);
    await expect(
      page.getByRole("heading", { name: "No firearms yet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add your first firearm" }),
    ).toBeVisible();
    // The empty state carries the only CTA; no toolbar "Add firearm" button.
    await expect(
      page.getByRole("button", { name: "Add firearm", exact: true }),
    ).toHaveCount(0);
  });

  test("the magazine form points at /firearms when no firearms exist", async ({
    page,
  }) => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Start with a magazine" }).click();

    const link = page.getByRole("link", { name: "Add a firearm" });
    await expect(link).toHaveAttribute("href", "/firearms");
    await expect(page.getByText("first to link compatibility.")).toBeVisible();
  });
});
