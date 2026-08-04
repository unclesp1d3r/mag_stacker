import { isoDateDaysAgo } from "@/src/demo/inventory";
import { authTest, expect } from "./fixtures/auth";

/**
 * The R16 bulk mark-serviced surface: "An owner can mark one or many items
 * serviced as of a date in a single action, so the day-one backlog clears
 * without visiting each item." Before this spec, `logServiceEventsBulk`
 * existed and was integration-tested but had NO app surface — this proves
 * the Done signal end to end: an owner with several due items marks them
 * all serviced in one action from `/summary`, and the roll-up and the list
 * markers both clear afterward.
 *
 * A dedicated user (`service-intervals-bulk`), distinct from
 * `service-intervals`/`service-intervals-share`/`service-intervals-viewer` —
 * those specs are already stateful and sequential; this one needs its own
 * clean backlog to select against.
 */
const test = authTest("service-intervals-bulk");

// Stateful, no cleanup: a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

test("an owner with several due items marks them all serviced in one action from /summary, clearing the roll-up and every list marker", async ({
  page,
}) => {
  await test.step("owner creates two rifles, both well past a week old", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    let form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Bulk Rifle One");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(30));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("button", { name: "Add firearm" }).click();
    form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Bulk Rifle Two");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await form.getByLabel("Acquired date").fill(isoDateDaysAgo(30));
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();
  });

  await test.step("owner arms the Rifle category with a 7-day Cleaning rule — both rifles become due", async () => {
    await page.goto("/settings/service");
    const rifleSection = page.getByRole("region", { name: "Rifle" });
    await rifleSection.getByRole("button", { name: "Add rule" }).click();
    const form = rifleSection.locator("form");
    await form.getByLabel("Rule name").fill("Cleaning");
    await form.getByLabel("Days").fill("7");
    await form.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByText("Rifle rule added")).toBeVisible();

    await page.goto("/firearms");
    await expect(page.getByText("Service due")).toHaveCount(2);
  });

  await test.step("the /summary roll-up counts both due items and offers the bulk mark-serviced control", async () => {
    await page.goto("/summary");
    await expect(
      page.getByText("2 items due for service across 2 rules"),
    ).toBeVisible();

    const control = page.getByRole("region", { name: "Mark service due" });
    await expect(
      control.getByRole("checkbox", {
        name: "Bulk Rifle One — Cleaning",
      }),
    ).toBeVisible();
    await expect(
      control.getByRole("checkbox", {
        name: "Bulk Rifle Two — Cleaning",
      }),
    ).toBeVisible();

    // R21/safe-default: nothing starts checked, and the submit control is
    // disabled until the owner opts in.
    await expect(
      control.getByRole("checkbox", { name: "Select all" }),
    ).not.toBeChecked();
    await expect(
      control.getByRole("button", { name: "Mark serviced" }),
    ).toBeDisabled();
  });

  await test.step("owner selects all, keeps today's date, and marks both serviced in one action (R16)", async () => {
    const control = page.getByRole("region", { name: "Mark service due" });
    await control.getByRole("checkbox", { name: "Select all" }).click();
    await expect(control.getByText("2 selected")).toBeVisible();
    await control.getByRole("button", { name: "Mark serviced" }).click();
    await expect(page.getByText("Marked 2 rules serviced")).toBeVisible();
  });

  await test.step("the roll-up and every list marker clear afterward (Done signal)", async () => {
    await expect(
      page.getByText("0 items due for service across 0 rules"),
    ).toBeVisible();

    await page.goto("/firearms");
    await expect(page.getByText("Service due")).toHaveCount(0);
  });

  await test.step("the service history on each rifle now names the bulk-logged event", async () => {
    await page.goto("/firearms");
    await page.getByRole("link", { name: "Bulk Rifle One" }).click();
    const history = page.getByRole("region", { name: "Service history" });
    await expect(history).toContainText("Cleaning");
  });
});
