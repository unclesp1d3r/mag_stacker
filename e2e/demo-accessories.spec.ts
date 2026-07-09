import { authTest } from "./fixtures/auth";
import {
  captureThemed,
  demoContext,
  sbrFirearmId,
  seedDemoData,
  skipUnlessDemo,
} from "./fixtures/demo-seed";

/**
 * README demo assets for the accessories feature (issue #8). Gated behind
 * DEMO=1 — regenerate with:
 *   DEMO=1 bun run test:e2e e2e/demo-accessories.spec.ts
 */
const test = authTest("demo-accessories");
test.describe.configure({ retries: 0 });

test("capture accessories README screenshots", async ({ browser }) => {
  skipUnlessDemo(test);
  const ctx = await demoContext(browser, "demo-accessories");
  const page = await ctx.newPage();
  try {
    await seedDemoData(page);

    // Accessories list — light + dark pair.
    await page.goto("/accessories");
    await page.getByRole("heading", { name: "Accessories" }).waitFor();
    await captureThemed(page, "light", "accessories-light.png");
    await captureThemed(page, "dark", "accessories-dark.png");

    // Firearm detail: mounted-accessories section + value total + NFA flag (hero).
    const sbr = await sbrFirearmId(page);
    await page.goto(`/firearms/${sbr}`);
    await page.getByText(/total value/).waitFor();
    await captureThemed(page, "dark", "firearm-accessories.png", {
      fullPage: true,
    });

    // Accessory detail — the NFA suppressor.
    await page.goto("/accessories");
    await page
      .getByRole("row")
      .filter({ hasText: "Suppressor" })
      .getByRole("link", { name: "Suppressor" })
      .click();
    await page
      .getByRole("heading", { level: 1, name: "SureFire SOCOM556-RC2" })
      .waitFor();
    await captureThemed(page, "dark", "accessory-detail.png", {
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});
