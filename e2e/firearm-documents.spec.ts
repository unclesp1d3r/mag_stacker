import path from "node:path";
import {
  authTest,
  expect,
  readArtifact,
  storageStateFor,
} from "./fixtures/auth";

/**
 * Firearm document management e2e coverage (#12 U8 — R20, R24, F1, F2, F4, F5,
 * F6, AE1, AE2). One sequential test on a fresh "firearm-documents" user: each
 * step builds on the last (mirrors firearm-photos.spec.ts). A second seeded
 * user ("firearm-documents-viewer") carries the grantee session for the
 * owner-only lockout step, mirroring detail-view-sharing.spec.ts /
 * inventory-log-sharing.spec.ts's two-browser-context pattern.
 * ARIA roles / accessible names / visible text only — no `data-testid`.
 */
const test = authTest("firearm-documents");

// Stateful, no per-step cleanup — a retry would start from a dirty account.
test.describe.configure({ retries: 0 });

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const SAMPLE_PDF = path.join(FIXTURES_DIR, "sample-document.pdf");
const SAMPLE_IMAGE = path.join(FIXTURES_DIR, "sample-photo-1.jpg");
const INVALID_FILE = path.join(FIXTURES_DIR, "not-an-image.txt");

test("empty state, upload, view, download, delete, and grantee lockout", async ({
  page,
  browser,
}) => {
  const grantee = readArtifact().users.find(
    (u) => u.key === "firearm-documents-viewer",
  );
  if (!grantee) throw new Error("firearm-documents-viewer not seeded");

  await test.step("create a firearm with no documents → distinct empty state alongside the upload affordance (R24)", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add your first firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Document Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").first()).toBeVisible();

    await page.getByRole("link", { name: "Document Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Document Rifle" }),
    ).toBeVisible();

    await expect(page.getByText("No documents yet")).toBeVisible();
    await expect(page.getByText("0 documents")).toBeVisible();
    // The upload control still renders alongside the empty-state placeholder.
    await expect(page.getByLabel("Upload documents")).toBeVisible();
    await expect(page.getByRole("list", { name: "Document list" })).toHaveCount(
      0,
    );
  });

  await test.step("upload a PDF with a chosen docType → appears in the list with filename and docType (F1)", async () => {
    await page.getByLabel("Document type").selectOption("receipt");
    await page.getByLabel("Upload documents").setInputFiles(SAMPLE_PDF);
    await expect(page.getByText("1 document uploaded")).toBeVisible();

    const list = page.getByRole("list", { name: "Document list" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("1 document", { exact: true })).toBeVisible();
    const row = list.getByRole("listitem").filter({
      hasText: "sample-document.pdf",
    });
    await expect(row).toBeVisible();
    await expect(row.getByText("Receipt", { exact: true })).toBeVisible();
  });

  await test.step("upload an image document, then view it in the modal (F2, AE1)", async () => {
    await page.getByLabel("Document type").selectOption("manual");
    await page.getByLabel("Upload documents").setInputFiles(SAMPLE_IMAGE);
    await expect(page.getByText("1 document uploaded")).toBeVisible();

    const list = page.getByRole("list", { name: "Document list" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("2 documents")).toBeVisible();
    const imageRow = list.getByRole("listitem").filter({
      hasText: "sample-photo-1.jpg",
    });
    await expect(imageRow).toBeVisible();
    await expect(imageRow.getByText("Manual", { exact: true })).toBeVisible();

    await imageRow
      .getByRole("button", { name: "View Manual — sample-photo-1.jpg" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manual — sample-photo-1.jpg",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).toBeVisible();

    await dialog.getByRole("button", { name: "Close document view" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("view the PDF in the modal → renders the sandboxed inline iframe, not an img (AE1)", async () => {
    const list = page.getByRole("list", { name: "Document list" });
    const pdfRow = list.getByRole("listitem").filter({
      hasText: "sample-document.pdf",
    });
    await pdfRow
      .getByRole("button", { name: "View Receipt — sample-document.pdf" })
      .click();

    const dialog = page.getByRole("dialog", {
      name: "Receipt — sample-document.pdf",
    });
    await expect(dialog).toBeVisible();

    // The modal fetches the document before rendering (loading → ready), so
    // wait for the iframe itself rather than asserting immediately.
    const iframe = dialog.locator("iframe");
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");

    await dialog.getByRole("button", { name: "Close document view" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("download the PDF via its Download control (F4)", async () => {
    const list = page.getByRole("list", { name: "Document list" });
    const pdfRow = list.getByRole("listitem").filter({
      hasText: "sample-document.pdf",
    });
    const downloadLink = pdfRow.getByRole("link", {
      name: "Download Receipt — sample-document.pdf",
    });
    await expect(downloadLink).toHaveAttribute(
      "href",
      /\/api\/documents\/[^/]+\?disposition=attachment/,
    );
    await expect(downloadLink).toHaveAttribute(
      "download",
      "sample-document.pdf",
    );

    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sample-document.pdf");
  });

  await test.step("delete the image document via a confirmation dialog that names it (F5, R20)", async () => {
    const list = page.getByRole("list", { name: "Document list" });
    const imageRow = list.getByRole("listitem").filter({
      hasText: "sample-photo-1.jpg",
    });
    await imageRow
      .getByRole("button", { name: "Delete Manual — sample-photo-1.jpg" })
      .click();

    const dialog = page.getByRole("alertdialog", {
      name: "Manual — sample-photo-1.jpg",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Document deleted")).toBeVisible();

    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(
      list.getByRole("listitem").filter({ hasText: "sample-photo-1.jpg" }),
    ).toHaveCount(0);
    await expect(page.getByText("1 document", { exact: true })).toBeVisible();
  });

  await test.step("share the firearm with a second user; the grantee sees the locked panel and none of the document contents (F6, AE2)", async () => {
    await page.goto("/firearms");
    await page
      .getByRole("row")
      .filter({ hasText: "Document Rifle" })
      .getByRole("button", { name: "Share" })
      .click();
    const shareDialog = page.getByRole("dialog");
    await shareDialog.getByLabel("User").selectOption({ label: grantee.email });
    await shareDialog.getByRole("button", { name: "Share" }).click();
    await expect(
      shareDialog.getByRole("listitem").filter({ hasText: grantee.email }),
    ).toBeVisible();
    await shareDialog.getByRole("button", { name: "Done" }).click();

    const granteeContext = await browser.newContext({
      storageState: storageStateFor("firearm-documents-viewer"),
    });
    try {
      const gp = await granteeContext.newPage();
      await gp.goto("/firearms");
      await gp.getByRole("link", { name: "Document Rifle" }).click();
      await expect(
        gp.getByRole("heading", { level: 1, name: "Document Rifle" }),
      ).toBeVisible();

      await expect(
        gp.getByText("Documents are private to the owner."),
      ).toBeVisible();
      // None of the owner's document contents leak to the grantee.
      await expect(gp.getByText("sample-document.pdf")).toHaveCount(0);
      await expect(gp.getByText("1 document", { exact: true })).toHaveCount(0);
      await expect(gp.getByRole("list", { name: "Document list" })).toHaveCount(
        0,
      );
      await expect(gp.getByLabel("Upload documents")).toHaveCount(0);
    } finally {
      await granteeContext.close();
    }
  });
});

// A separate, documentless firearm keeps these two upload-batch cases free of
// the filename collisions the sequential test above would create (it already
// uploads SAMPLE_PDF and SAMPLE_IMAGE once each) and lets each assertion
// target a clean, known document count.
test("invalid-type upload feedback and multi-file batch upload", async ({
  page,
}) => {
  await test.step("create a documentless firearm for isolated upload-batch coverage", async () => {
    await page.goto("/firearms");
    await page.getByRole("button", { name: "Add firearm" }).click();
    const form = page.locator("form");
    await form.getByLabel(/^Name/).fill("Batch Rifle");
    await form.getByLabel("Caliber").fill("5.56");
    await form.getByLabel(/^Type/).selectOption("rifle");
    await form.getByLabel("Action").selectOption("semi-auto");
    await page.getByRole("button", { name: "Add firearm" }).click();
    await expect(page.getByText("Firearm logged").last()).toBeVisible();

    await page.getByRole("link", { name: "Batch Rifle" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Batch Rifle" }),
    ).toBeVisible();
    await expect(page.getByText("No documents yet")).toBeVisible();
    await expect(page.getByText("0 documents")).toBeVisible();
  });

  await test.step("uploading a disallowed file type surfaces a per-file failure reason and adds nothing to the list", async () => {
    await page.getByLabel("Upload documents").setInputFiles(INVALID_FILE);

    await expect(page.getByText("1 file could not be uploaded")).toBeVisible();
    await expect(page.getByText("1 file not uploaded:")).toBeVisible();
    await expect(
      page.getByText(
        "not-an-image.txt: unsupported file type (PDF, JPEG, PNG, WEBP, or AVIF only)",
      ),
    ).toBeVisible();

    // The rejected file never becomes a document.
    await expect(page.getByText("No documents yet")).toBeVisible();
    await expect(page.getByText("0 documents")).toBeVisible();
    await expect(page.getByRole("list", { name: "Document list" })).toHaveCount(
      0,
    );
  });

  await test.step("uploading two valid files in one batch adds both to the list", async () => {
    await page
      .getByLabel("Upload documents")
      .setInputFiles([SAMPLE_PDF, SAMPLE_IMAGE]);
    await expect(page.getByText("2 documents uploaded")).toBeVisible();

    const list = page.getByRole("list", { name: "Document list" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("2 documents", { exact: true })).toBeVisible();
    await expect(
      list.getByRole("listitem").filter({ hasText: "sample-document.pdf" }),
    ).toBeVisible();
    await expect(
      list.getByRole("listitem").filter({ hasText: "sample-photo-1.jpg" }),
    ).toBeVisible();
  });
});
