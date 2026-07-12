import { describe, expect, test } from "bun:test";
import { toFirearmDocumentRow } from "../row";
import type { FirearmDocument } from "../service";

/**
 * `toFirearmDocumentRow` serialization (U7). No DB/storage needed — a pure
 * narrowing function — so this is a plain unit test, not `live`-gated.
 */
describe("toFirearmDocumentRow (U7)", () => {
  test("narrows away storageKey and carries id/filename/mimeType/docType/notes", () => {
    const doc: FirearmDocument = {
      id: "11111111-1111-1111-1111-111111111111",
      firearmId: "22222222-2222-2222-2222-222222222222",
      storageKey: "abc123.pdf",
      filename: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      docType: "receipt",
      notes: "purchase proof",
      uploadedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const result = toFirearmDocumentRow(doc);

    expect(Object.keys(result)).not.toContain("storageKey");
    expect(result).toEqual({
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      docType: doc.docType,
      notes: doc.notes,
    });
  });
});
