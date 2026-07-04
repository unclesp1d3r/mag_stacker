import { authTest, expect } from "./fixtures/auth";

/**
 * Single-add label-prefix auto-numbering (#22). Drives the magazine form:
 * selecting a prefix prefills the editable `label` with `prefix + next number`,
 * numbering continues across creates, the used prefix is remembered as a
 * datalist option, and the prefilled label stays overridable. The "label-prefix"
 * user starts with empty inventory (cold start). ARIA / accessible names / text
 * only — no data-testid.
 */
const test = authTest("label-prefix");

// Serial UI state across steps; no isolation between retries.
test.describe.configure({ retries: 0 });

test("prefix prefills the label, numbers continue, and the list grows (#22)", async ({
  page,
}) => {
  const form = page.locator("form");
  const label = form.getByLabel("Label", { exact: true });

  await test.step("open the add form from cold start", async () => {
    await page.goto("/magazines");
    await page.getByRole("button", { name: "Start with a magazine" }).click();
  });

  await test.step("selecting prefix US prefills US01 (AE1)", async () => {
    await form.getByLabel("Brand / model").fill("PMAG");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Label prefix").fill("US");
    await expect(label).toHaveValue("US01");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByRole("cell", { name: "US01" })).toBeVisible();
  });

  await test.step("second US magazine prefills US02; US is a remembered option (AE1, R1)", async () => {
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(
      page.locator('datalist#magazine-prefixes option[value="US"]'),
    ).toHaveCount(1);
    await form.getByLabel("Brand / model").fill("PMAG");
    await form.getByLabel("Caliber").fill("9mm");
    await form.getByLabel("Label prefix").fill("US");
    await expect(label).toHaveValue("US02");
  });

  await test.step("the prefilled label is overridable (R6)", async () => {
    await label.fill("SPARE");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.getByRole("cell", { name: "SPARE" })).toBeVisible();
  });

  await test.step("no prefix selected leaves the label blank (AE4)", async () => {
    await page.getByRole("button", { name: "Add magazine" }).click();
    // A fresh single-add form: no prefix chosen, so nothing is auto-numbered.
    await expect(form.getByLabel("Label prefix")).toHaveValue("");
    await expect(label).toHaveValue("");
    await form.getByLabel("Brand / model").fill("PMAG");
    await form.getByLabel("Caliber").fill("9mm");
    await page.getByRole("button", { name: "Add magazine" }).click();
    await expect(page.locator("form")).not.toBeVisible();
  });
});
