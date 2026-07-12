import type { CreateDocumentFailureCode, FirearmDocument } from "./service";

/**
 * The client-facing shape of a document row (U7). Deliberately EXCLUDES
 * `storageKey` (the internal blob path, R10) and other server-only fields so
 * they never reach the RSC payload / client bundle.
 */
export interface FirearmDocumentRow {
  id: string;
  filename: string;
  mimeType: string;
  docType: string;
  notes: string;
}

/**
 * Narrow a full document row to the client-safe shape. This named constructor —
 * rather than an inline object literal at the page's fetch site — is the single
 * enforcement point that keeps `storageKey` off the client: TypeScript's
 * structural typing would otherwise let a full `FirearmDocument` (which carries
 * `storageKey`) satisfy a `FirearmDocumentRow` prop through a variable, silently
 * leaking it. Routing every row through this function makes the omission
 * explicit and greppable, and the serialization test locks it in.
 */
export function toFirearmDocumentRow(doc: FirearmDocument): FirearmDocumentRow {
  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    docType: doc.docType,
    notes: doc.notes,
  };
}

/**
 * The client-facing per-file upload result. Mirrors `CreateDocumentResult` but
 * carries the narrowed `FirearmDocumentRow` (no `storageKey`, R10) so the upload
 * Server Action's response never ships the internal blob path to the client —
 * the same narrowing the page applies to the initial load.
 */
export type CreateDocumentClientResult =
  | { ok: true; document: FirearmDocumentRow }
  | { ok: false; codes: CreateDocumentFailureCode[] };
