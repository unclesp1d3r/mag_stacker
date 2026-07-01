import { expect, test } from "@playwright/test";
import { readArtifact } from "./fixtures/auth";

/**
 * Login-form coverage (R4). This is the one spec that drives the real UI login
 * and touches the live /sign-in/email endpoint — every other spec loads a
 * pre-seeded session (KTD3/KTD4). It uses the seeded admin from the run
 * artifact and keeps total sign-in attempts under the 5/60s rate-limit cap.
 */
const { admin } = readArtifact();

test.describe("login form (R4)", () => {
  test("valid credentials redirect to /magazines", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/magazines/);
  });

  test("wrong password shows an inline, non-revealing error and stays on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill("wrong-password-attempt");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Filter by text to exclude Next.js's empty __next-route-announcer__ alert.
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Incorrect email or password." });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
