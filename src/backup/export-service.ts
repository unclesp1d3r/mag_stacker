/**
 * Backup export service (plan Unit U4, R1/R2/R3/R4/R11/R13).
 *
 * Orchestrates a full instance export: an admin-authorized caller supplies a
 * password, and this module streams the entire database (U3's NDJSON export)
 * plus every document blob under `UPLOAD_DIR` into one authenticated,
 * password-encrypted, version-stamped bundle (U2's tar format, piped through
 * U1's crypto stream). The route that eventually serves this pipes the
 * returned stream straight to the operator's browser download — no bundle is
 * ever written to disk here (KTD8): `createBackup` only builds and returns a
 * `Readable`.
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NotAuthorizedError } from "@/src/auth/errors";
import { isAdmin } from "@/src/auth/session";
import type { DbOrTx } from "@/src/db/client";
import { activeStorageRoot } from "@/src/storage/index";
import { type BundleBlobEntry, writeBundle } from "./bundle";
import { createEncryptStream, deriveKey, generateSalt } from "./crypto";
import { exportDatabase } from "./db-export";
import { buildManifest } from "./manifest";

/**
 * Re-asserts the admin role inside the service itself — the future admin
 * route (U6) also gates, but a backup export's blast radius (the whole
 * instance, in the clear once decrypted) warrants defense-in-depth here too.
 * Delegates to `isAdmin()` (`src/auth/session.ts`) rather than duplicating
 * the role check.
 */
async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    throw new NotAuthorizedError("Only admins can export a backup");
  }
}

/** One blob file discovered under `UPLOAD_DIR`, before it is streamed. */
interface BlobFileInfo {
  readonly storageKey: string;
  readonly size: number;
}

/**
 * Lists every blob file directly under the upload root, mirroring the
 * non-recursive, `node:fs`-direct scan `orphanSweep` uses
 * (`src/storage/orphan-sweep.ts`) rather than going through the
 * `StorageService` interface, which intentionally has no `list()` method
 * (YAGNI — see that module's doc comment). A missing `UPLOAD_DIR` (fresh
 * install, nothing uploaded yet) is not an error: there is simply nothing to
 * bundle.
 */
async function listUploadBlobs(): Promise<BlobFileInfo[]> {
  const uploadDir = activeStorageRoot();
  const entries = await readdir(uploadDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const fileNames = entries.filter((entry) => entry.isFile());

  const infos: BlobFileInfo[] = [];
  for (const entry of fileNames) {
    const info = await stat(join(uploadDir, entry.name));
    infos.push({ storageKey: entry.name, size: info.size });
  }
  return infos;
}

/**
 * Lazily streams each listed blob's content from disk as the bundle writer
 * consumes it — one file open/read at a time, never all of them buffered
 * together (R13, KTD3). Sizes are the `stat` results already gathered by
 * `listUploadBlobs`, matching what `writeBundle` requires up front per tar
 * entry.
 */
async function* blobEntriesFor(
  infos: readonly BlobFileInfo[],
): AsyncGenerator<BundleBlobEntry> {
  const uploadDir = activeStorageRoot();
  for (const info of infos) {
    yield {
      storageKey: info.storageKey,
      size: info.size,
      stream: createReadStream(join(uploadDir, info.storageKey)),
    };
  }
}

/**
 * Buffers `exportDatabase`'s NDJSON output once so the row count is known
 * before the manifest is built (the manifest must exist before `writeBundle`
 * starts streaming — it is the bundle's first tar entry). This mirrors
 * `bundle.ts`'s own documented exception: `db.ndjson` is JSON-per-row text,
 * not the binary attachments R13/KTD3 are actually concerned with, and
 * `writeBundle` buffers it internally regardless (it needs an exact byte
 * length up front for the tar header). Buffering it once here — instead of
 * once here and again inside `writeBundle` — would require re-plumbing
 * `writeBundle`'s API, which U4 does not own; the double-buffer cost is a
 * small NDJSON payload, not the large blob set R13 is about.
 */
async function bufferDbExport(
  db: DbOrTx,
): Promise<{ text: string; rowCount: number }> {
  const chunks: Buffer[] = [];
  for await (const chunk of exportDatabase(db)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const rowCount = text.split("\n").filter((line) => line.trim() !== "").length;
  return { text, rowCount };
}

export interface CreateBackupOptions {
  /** Drizzle handle to export from. Production callers pass the shared `db`
   * from `@/src/db/client`; tests pass a handle bound to their own instance
   * (e.g. a Testcontainers Postgres). */
  readonly db: DbOrTx;
}

/**
 * Exports the full instance as one password-encrypted backup stream (F1).
 *
 * 1. Re-asserts the caller is an admin (defense-in-depth, R14).
 * 2. Builds the manifest — row/blob counts, `BACKUP_FORMAT_VERSION`, app
 *    version, and the latest migration tag (R4).
 * 3. Derives a fresh-salt key from `password` (R3, R11).
 * 4. Composes U3's NDJSON export and a lazy blob stream over `UPLOAD_DIR`
 *    into U2's tar bundle writer, piped through U1's encrypt stream.
 *
 * Returns the encrypted bundle stream; the caller (an admin route, U6) pipes
 * it straight to the operator's download. Nothing is written server-side —
 * no bundle file, no plaintext (KTD8, R13).
 */
export async function createBackup(
  password: string,
  options: CreateBackupOptions,
): Promise<Readable> {
  await requireAdmin();

  const [{ text: dbText, rowCount }, blobInfos] = await Promise.all([
    bufferDbExport(options.db),
    listUploadBlobs(),
  ]);
  const totalBlobBytes = blobInfos.reduce((sum, blob) => sum + blob.size, 0);

  const manifest = buildManifest({
    counts: {
      rows: rowCount,
      blobs: blobInfos.length,
      totalBlobBytes,
    },
  });

  const salt = generateSalt();
  const key = deriveKey(password, salt);

  return writeBundle(
    {
      manifest,
      dbStream: Readable.from([dbText]),
      blobEntries: blobEntriesFor(blobInfos),
    },
    createEncryptStream(key, salt),
  );
}
