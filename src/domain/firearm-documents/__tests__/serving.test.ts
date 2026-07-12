import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `storage` is a lazily-constructed singleton; `UPLOAD_DIR` must be set before
// any test body first touches it.
const uploadDir = mkdtempSync(join(tmpdir(), "documents-serving-"));
process.env.UPLOAD_DIR = uploadDir;

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import sharp from "sharp";
import { createGrant } from "@/src/auth/grants";
import { db } from "@/src/db/client";
import {
  createUser,
  deleteUsers,
  makeFirearm,
} from "@/src/test-support/factories";
import { createDocuments } from "../service";

// The serving route re-resolves the session in-handler. Mock it so we can drive
// owner / non-owner / unauthenticated cases; a mutable holder lets each test set
// the current user before invoking the route.
let currentUserId: string | null = null;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => (currentUserId ? { id: currentUserId } : null),
}));

const live = process.env.DATABASE_URL ? describe : describe.skip;

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  })
    .png()
    .toBuffer();
}

async function callRoute(id: string, disposition?: string): Promise<Response> {
  const { GET } = await import("@/app/api/documents/[id]/route");
  const query = disposition ? `?disposition=${disposition}` : "";
  const request = new Request(`http://localhost/api/documents/${id}${query}`);
  return GET(request, { params: Promise.resolve({ id }) });
}

live("document serving route (U6)", () => {
  let owner = "";
  let grantee = "";
  let firearmId = "";
  let pdfDocId = "";
  let imageDocId = "";

  beforeAll(async () => {
    owner = await createUser("serve-owner");
    grantee = await createUser("serve-grantee");
    const fa = await makeFirearm(owner);
    firearmId = fa.id;
    const [pdf, image] = await createDocuments(owner, firearmId, [
      { bytes: PDF_BYTES, mimeType: "application/pdf", filename: "récu.pdf" },
      {
        bytes: await pngBytes(),
        mimeType: "image/png",
        filename: "warranty.png",
      },
    ]);
    if (!pdf.ok || !image.ok) throw new Error("fixture upload failed");
    pdfDocId = pdf.document.id;
    imageDocId = image.document.id;
    await createGrant(db, {
      actorId: owner,
      granteeId: grantee,
      parentType: "firearm",
      parentId: firearmId,
      permission: "edit",
    });
  });

  afterAll(async () => {
    await deleteUsers(owner, grantee);
    rmSync(uploadDir, { recursive: true, force: true });
  });

  test("owner download → 200, attachment with RFC 6266 filename and no-store", async () => {
    currentUserId = owner;
    const res = await callRoute(pdfDocId, "attachment");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd.startsWith("attachment")).toBe(true);
    expect(cd).toContain("filename*=UTF-8''"); // non-ASCII name survives
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
  });

  test("download is the default disposition when none is given", async () => {
    currentUserId = owner;
    const res = await callRoute(pdfDocId);
    expect(res.status).toBe(200);
    expect(
      res.headers.get("Content-Disposition")?.startsWith("attachment"),
    ).toBe(true);
  });

  test("owner inline image → 200, inline + nosniff + CSP (AE1)", async () => {
    currentUserId = owner;
    const res = await callRoute(imageDocId, "inline");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")?.startsWith("inline")).toBe(
      true,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
  });

  test("owner inline PDF → 200, inline + CSP", async () => {
    currentUserId = owner;
    const res = await callRoute(pdfDocId, "inline");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")?.startsWith("inline")).toBe(
      true,
    );
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
  });

  test("a non-owner gets 404 (KTD2 collapse), never 403", async () => {
    currentUserId = grantee;
    const res = await callRoute(pdfDocId, "inline");
    expect(res.status).toBe(404);
  });

  test("a complete stranger with no grant at all also gets 404, not 401/403 (KTD2 collapse)", async () => {
    const stranger = await createUser("serve-stranger");
    currentUserId = stranger;
    const res = await callRoute(pdfDocId, "inline");
    expect(res.status).toBe(404);
    await deleteUsers(stranger);
  });

  test("an unauthenticated request → 401", async () => {
    currentUserId = null;
    const res = await callRoute(pdfDocId);
    expect(res.status).toBe(401);
  });

  test("a malformed id → 404", async () => {
    currentUserId = owner;
    const res = await callRoute("not-a-uuid");
    expect(res.status).toBe(404);
  });

  test("an unknown (well-formed) id → 404", async () => {
    currentUserId = owner;
    const res = await callRoute("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});
