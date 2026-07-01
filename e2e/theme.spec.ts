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

const NEXT_LABEL: Record<string, string> = {
  Light: "Dark",
  Dark: "System",
  System: "Light",
};

test("theme toggle cycles the three modes without console errors", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/magazines");

  const toggle = page.getByRole("button", { name: /Theme:/ });
  await expect(toggle).toBeVisible();

  const html = page.locator("html");
  const labelOf = (current: string) =>
    `Theme: ${current}. Switch to ${NEXT_LABEL[current]}.`;

  // Drive to a deterministic "Light" start (system → light is one click).
  for (let i = 0; i < 3; i++) {
    const label = await toggle.getAttribute("aria-label");
    if (label?.startsWith("Theme: Light.")) break;
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-label", labelOf("Light"));

  // Now assert the full forward cycle and the resolved attribute after each.
  for (const current of ["Light", "Dark", "System"] as const) {
    await expect(toggle).toHaveAttribute("aria-label", labelOf(current));
    await expect(html).toHaveAttribute("data-theme", /^(light|dark)$/);
    await toggle.click();
  }
  // One full lap returns to Light.
  await expect(toggle).toHaveAttribute("aria-label", labelOf("Light"));

  expect(consoleErrors).toEqual([]);
});
