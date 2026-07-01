import { authTest, expect } from "./fixtures/auth";

/**
 * Three-way theme toggle (R8). next-themes resolves data-theme to only light or
 * dark (never system), so we pin the OS preference to light for a deterministic
 * resolved theme, drive the toggle to a known "Light" start, then assert the
 * aria-label advances Light → Dark → System → Light and data-theme stays
 * light|dark after each click. A console-error listener attached before
 * navigation guards against hydration-time regressions.
 */
const test = authTest("theme");

type ThemeLabel = "Light" | "Dark" | "System";

const NEXT_LABEL: Record<ThemeLabel, string> = {
  Light: "Dark",
  Dark: "System",
  System: "Light",
};

test("theme toggle cycles the three modes without console errors", async ({
  page,
}) => {
  // Ignore only the specific favicon 404 some production builds emit — a
  // narrow allowlist so genuine runtime errors (incl. net::ERR_*) still fail.
  const BENIGN = [/favicon\.ico/i];
  const isBenign = (text: string) =>
    BENIGN.some((pattern) => pattern.test(text));
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isBenign(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (!isBenign(error.message)) consoleErrors.push(error.message);
  });

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/magazines");

  const toggle = page.getByRole("button", { name: /Theme:/ });
  await expect(toggle).toBeVisible();

  const html = page.locator("html");
  const labelOf = (current: ThemeLabel) =>
    `Theme: ${current}. Switch to ${NEXT_LABEL[current]}.`;

  // Drive to a deterministic "Light" start (system → light is one click).
  for (let i = 0; i < 3; i++) {
    const label = await toggle.getAttribute("aria-label");
    if (label?.startsWith("Theme: Light.")) break;
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-label", labelOf("Light"));

  // Assert the full forward cycle AND the exact resolved data-theme after each
  // (with the OS preference pinned to light: Light→light, Dark→dark, and
  // System resolves back to light). Asserting the exact value — not just
  // "not system" — proves the DOM actually followed the label.
  const RESOLVED: Record<ThemeLabel, "light" | "dark"> = {
    Light: "light",
    Dark: "dark",
    System: "light",
  };
  for (const current of ["Light", "Dark", "System"] as const) {
    await expect(toggle).toHaveAttribute("aria-label", labelOf(current));
    await expect(html).toHaveAttribute("data-theme", RESOLVED[current]);
    await toggle.click();
  }
  // One full lap returns to Light.
  await expect(toggle).toHaveAttribute("aria-label", labelOf("Light"));

  expect(consoleErrors).toEqual([]);
});
