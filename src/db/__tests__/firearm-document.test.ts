import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expectRejects } from "@/src/test-support/assertions";
import { db } from "../client";
import { firearm, firearmDocument, user } from "../schema";

const live = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * firearm_document schema (U1) — the child-record table, check constraints, and
 * FK cascade. Domain-level behavior (auth, validation, blob cleanup) lives in
 * the U3/U5 service tests; this covers the DB backstops only.
 */
live("firearm_document schema (U1)", () => {
  const ownerId = `test-user-${randomUUID()}`;
  let firearmId: string;

  const validRow = () => ({
    firearmId,
    storageKey: `docs/${randomUUID()}.pdf`,
    filename: "receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    docType: "receipt",
    notes: "purchase proof",
  });

  beforeAll(async () => {
    await db.insert(user).values({
      id: ownerId,
      name: "Doc Schema Test",
      email: `${ownerId}@example.test`,
    });
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Doc FA", caliber: "9mm" })
      .returning();
    firearmId = f.id;
  });

  afterAll(async () => {
    // Cascade removes the firearm and its firearm_document rows.
    await db.delete(user).where(eq(user.id, ownerId));
  });

  test("a row with valid values inserts and defaults are applied", async () => {
    const [row] = await db
      .insert(firearmDocument)
      .values(validRow())
      .returning();
    expect(row.id).toBeDefined();
    expect(row.docType).toBe("receipt");
    expect(row.uploadedAt).toBeInstanceOf(Date);
  });

  test("docType and notes defaults apply when omitted", async () => {
    const { docType: _d, notes: _n, ...rest } = validRow();
    const [row] = await db.insert(firearmDocument).values(rest).returning();
    expect(row.docType).toBe("other");
    expect(row.notes).toBe("");
  });

  test("a docType outside the controlled set is rejected (R2)", async () => {
    await expectRejects(() =>
      db.insert(firearmDocument).values({ ...validRow(), docType: "contract" }),
    );
  });

  test("a mimeType outside the allow-list is rejected (R5)", async () => {
    await expectRejects(() =>
      db.insert(firearmDocument).values({
        ...validRow(),
        mimeType: "application/zip",
      }),
    );
  });

  test("sizeBytes <= 0 is rejected", async () => {
    await expectRejects(() =>
      db.insert(firearmDocument).values({ ...validRow(), sizeBytes: 0 }),
    );
  });

  test("deleting the parent firearm removes its firearm_document rows (FK cascade)", async () => {
    const [f] = await db
      .insert(firearm)
      .values({ ownerId, name: "Cascade Doc FA", caliber: "9mm" })
      .returning();
    await db.insert(firearmDocument).values({ ...validRow(), firearmId: f.id });

    await db.delete(firearm).where(eq(firearm.id, f.id));

    const rows = await db
      .select()
      .from(firearmDocument)
      .where(eq(firearmDocument.firearmId, f.id));
    expect(rows).toHaveLength(0);
  });
});
