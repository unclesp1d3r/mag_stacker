import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NotAuthorizedError, NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/domain/errors";
import type {
  CreateDocumentInput,
  CreateDocumentResult,
} from "@/src/domain/firearm-documents/service";

/**
 * Server-action unit tests for `documents-actions.ts` (U7). Mocks the session
 * and the domain service (`mock.module`, mirroring
 * `src/domain/firearm-documents/__tests__/serving.test.ts`'s session mock)
 * rather than hitting the DB, so these run without `DATABASE_URL`. UI
 * behavior (view/download/delete affordances, the modal, accessible names) is
 * covered by a separate e2e spec (U8), not here — this only exercises the
 * `"use server"` action boundary: auth gating, request shaping, and
 * `ActionResult` mapping.
 */

let currentUserId: string | null = null;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => (currentUserId ? { id: currentUserId } : null),
}));

interface CreateDocumentsCall {
  actorId: string;
  firearmId: string;
  inputs: CreateDocumentInput[];
}
let createDocumentsCalls: CreateDocumentsCall[] = [];
let createDocumentsResult: CreateDocumentResult[] = [];
let createDocumentsThrows: unknown = null;

interface DeleteDocumentCall {
  actorId: string;
  documentId: string;
}
let deleteDocumentCalls: DeleteDocumentCall[] = [];
let deleteDocumentThrows: unknown = null;

mock.module("@/src/domain/firearm-documents/service", () => ({
  createDocuments: async (
    actorId: string,
    firearmId: string,
    inputs: CreateDocumentInput[],
  ) => {
    createDocumentsCalls.push({ actorId, firearmId, inputs });
    if (createDocumentsThrows) throw createDocumentsThrows;
    return createDocumentsResult;
  },
  deleteDocument: async (actorId: string, documentId: string) => {
    deleteDocumentCalls.push({ actorId, documentId });
    if (deleteDocumentThrows) throw deleteDocumentThrows;
  },
}));

// Server actions revalidate on every mutation; a bare bun test has no Next.js
// request/render context for this to hook into, so it's mocked to a no-op —
// the actions under test don't assert on cache invalidation.
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const { deleteDocumentAction, uploadDocumentsAction } = await import(
  "../documents-actions"
);

function makeFile(name: string, content: string, type: string): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  currentUserId = null;
  createDocumentsCalls = [];
  createDocumentsResult = [];
  createDocumentsThrows = null;
  deleteDocumentCalls = [];
  deleteDocumentThrows = null;
});

describe("uploadDocumentsAction", () => {
  test("rejects an unauthenticated caller without touching the service", async () => {
    currentUserId = null;
    const formData = new FormData();
    formData.append("files", makeFile("a.pdf", "%PDF", "application/pdf"));

    const result = await uploadDocumentsAction("firearm-1", formData);

    expect(result.ok).toBe(false);
    expect(createDocumentsCalls).toHaveLength(0);
  });

  test("forwards each file's bytes/mimeType/filename plus docType and notes to the service", async () => {
    currentUserId = "user-1";
    createDocumentsResult = [{ ok: true, document: { id: "doc-1" } as never }];
    const formData = new FormData();
    formData.append(
      "files",
      makeFile("receipt.pdf", "%PDF-1.4", "application/pdf"),
    );
    formData.set("docType", "receipt");
    formData.set("notes", "purchased 2024");

    const result = await uploadDocumentsAction("firearm-1", formData);

    expect(result.ok).toBe(true);
    expect(createDocumentsCalls).toHaveLength(1);
    const call = createDocumentsCalls[0];
    expect(call?.actorId).toBe("user-1");
    expect(call?.firearmId).toBe("firearm-1");
    expect(call?.inputs).toHaveLength(1);
    const input = call?.inputs[0];
    expect(input?.filename).toBe("receipt.pdf");
    expect(input?.mimeType).toBe("application/pdf");
    expect(input?.docType).toBe("receipt");
    expect(input?.notes).toBe("purchased 2024");
    expect(input?.bytes).toBeInstanceOf(Uint8Array);
  });

  test("surfaces a per-file validation failure as a partial result, not a thrown error", async () => {
    currentUserId = "user-1";
    createDocumentsResult = [{ ok: false, codes: ["disallowedMimeType"] }];
    const formData = new FormData();
    formData.append("files", makeFile("bad.txt", "not allowed", "text/plain"));

    const result = await uploadDocumentsAction("firearm-1", formData);

    if (!result.ok) throw new Error("expected an ok ActionResult");
    expect(result.data?.results).toEqual([
      { ok: false, codes: ["disallowedMimeType"] },
    ]);
  });

  test("maps a whole-batch ValidationError (e.g. quota exceeded) to a failed ActionResult with codes", async () => {
    currentUserId = "user-1";
    createDocumentsThrows = new ValidationError(["documentQuotaExceeded"]);
    const formData = new FormData();
    formData.append("files", makeFile("a.pdf", "%PDF", "application/pdf"));

    const result = await uploadDocumentsAction("firearm-1", formData);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.codes).toEqual([
      "documentQuotaExceeded",
    ]);
  });

  test("maps a NotAuthorizedError (non-owner) to a non-leaking failed ActionResult", async () => {
    currentUserId = "user-1";
    createDocumentsThrows = new NotAuthorizedError();
    const formData = new FormData();
    formData.append("files", makeFile("a.pdf", "%PDF", "application/pdf"));

    const result = await uploadDocumentsAction("firearm-1", formData);

    expect(result.ok).toBe(false);
  });
});

describe("deleteDocumentAction", () => {
  test("rejects an unauthenticated caller without touching the service", async () => {
    currentUserId = null;

    const result = await deleteDocumentAction("doc-1");

    expect(result.ok).toBe(false);
    expect(deleteDocumentCalls).toHaveLength(0);
  });

  test("calls deleteDocument with the resolved actor and given document id", async () => {
    currentUserId = "user-1";

    const result = await deleteDocumentAction("doc-1");

    expect(result.ok).toBe(true);
    expect(deleteDocumentCalls).toEqual([
      { actorId: "user-1", documentId: "doc-1" },
    ]);
  });

  test("maps a NotFoundError to a failed ActionResult", async () => {
    currentUserId = "user-1";
    deleteDocumentThrows = new NotFoundError();

    const result = await deleteDocumentAction("doc-1");

    expect(result.ok).toBe(false);
  });
});
