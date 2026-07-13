/**
 * Backup bundle tar format — writer and reader (plan Unit U2, R2/R13).
 *
 * A bundle is a tar stream (`manifest.json` first, then `db.ndjson`, then
 * every `blobs/<storageKey>`) piped through U1's crypto streams
 * (`createEncryptStream`/`createDecryptStream` in `./crypto`). This module
 * never buffers a blob's content beyond stream backpressure — a large
 * document blob store (R13, KTD3) is streamed straight from source to the
 * encrypted output.
 *
 * `db.ndjson` is the one deliberate exception: the tar format requires an
 * exact byte length in an entry's header *before* any of its content is
 * written, so a truly unbounded-size streaming write isn't possible without
 * either buffering the content or a two-pass write-to-temp-file dance. Given
 * the DB export is JSON-per-row text (not the binary attachments R13/KTD3 are
 * actually worried about), `writeBundle` buffers `dbStream` in memory to
 * learn its length, then writes it as one tar entry. On read, `db.ndjson` is
 * handed back to the caller as a live, unbuffered stream — so importing a
 * very large export still never requires the whole NDJSON payload in memory.
 *
 * **KTD11 choke point:** `readBundle` is the single place that turns
 * untrusted `blobs/<storageKey>` tar entries into filesystem writes. A bundle
 * is attacker-influenceable (anyone can craft one under a password of their
 * choosing), so authenticated decryption only proves the bytes weren't
 * tampered with after creation — never that the bundle's *contents* are
 * safe. Every blob entry's key is path-validated the same way
 * `LocalFilesystemAdapter` validates storage keys (see
 * `src/storage/local-fs-adapter.ts`), non-regular-file/symlink entries are
 * refused outright, and per-entry/total size and entry-count are bounded
 * against the manifest's declared counts.
 */

import { constants as fsConstants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Readable, Transform } from "node:stream";
import * as tar from "tar-stream";
import { PathTraversalError } from "@/src/storage/local-fs-adapter";
import {
  type BackupManifest,
  parseManifest,
  serializeManifest,
} from "./manifest";

const MANIFEST_ENTRY_NAME = "manifest.json";
const DB_ENTRY_NAME = "db.ndjson";
const BLOB_ENTRY_PREFIX = "blobs/";

/** Safety cap on the manifest entry itself — it should always be tiny. */
const MAX_MANIFEST_BYTES = 1 * 1024 * 1024; // 1 MiB

/** Thrown when a bundle's tar structure doesn't match the expected shape (entry order/names). */
export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleFormatError";
  }
}

/** Thrown when a bundle's actual contents violate its own manifest-declared counts/bounds (KTD11). */
export class BundleIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleIntegrityError";
  }
}

/** Thrown when a blob entry is refused for safety reasons other than path traversal — a symlink or non-regular-file entry (KTD11). */
export class UnsafeBundleEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeBundleEntryError";
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** One blob to write into the bundle. `size` must be the exact byte length of `stream`'s content (tar requires it upfront). */
export interface BundleBlobEntry {
  readonly storageKey: string;
  readonly size: number;
  readonly stream: Readable;
}

export interface WriteBundleInput {
  readonly manifest: BackupManifest;
  /** NDJSON database export (see `./db-export.ts`). Buffered once to learn its length — see the module doc comment. */
  readonly dbStream: Readable;
  readonly blobEntries:
    | AsyncIterable<BundleBlobEntry>
    | Iterable<BundleBlobEntry>;
}

/** Reads a Readable fully into one Buffer. Used only for the manifest and `db.ndjson` — see the module doc comment for why those two are the deliberate exceptions to "never buffer a whole stream". */
async function bufferStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Writes one whole-buffer tar entry and resolves once it's flushed. */
function packBufferEntry(
  pack: tar.Pack,
  name: string,
  data: Buffer,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    pack.entry({ name, size: data.byteLength, type: "file" }, data, (err) => {
      if (err) rejectPromise(err);
      else resolvePromise();
    });
  });
}

/** Streams `source` into one tar entry of declared `size` without buffering its content. */
function packStreamEntry(
  pack: tar.Pack,
  name: string,
  size: number,
  source: Readable,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const sink = pack.entry({ name, size, type: "file" }, (err) => {
      if (err) rejectPromise(err);
      else resolvePromise();
    });
    source.on("error", (err) => sink.destroy(err));
    source.pipe(sink);
  });
}

/**
 * Builds the bundle: `manifest.json`, then `db.ndjson`, then every
 * `blobs/<storageKey>`, tarred and piped through `encryptStream` (R2, R13).
 * Returns the encrypted output stream — nothing is written server-side
 * (KTD8 is the caller's concern; this function only produces the stream).
 */
export function writeBundle(
  input: WriteBundleInput,
  encryptStream: Transform,
): Readable {
  const pack = tar.pack();

  // Errors on the tar-pack side don't automatically propagate through
  // `.pipe()` to the encrypt stream (a well-known Node stream gotcha) —
  // forward them explicitly so a write-side failure surfaces to whoever is
  // consuming the encrypted output rather than hanging.
  pack.on("error", (err) => encryptStream.destroy(toError(err)));

  (async () => {
    try {
      const manifestBytes = serializeManifest(input.manifest);
      await packBufferEntry(pack, MANIFEST_ENTRY_NAME, manifestBytes);

      const dbBytes = await bufferStream(input.dbStream);
      await packBufferEntry(pack, DB_ENTRY_NAME, dbBytes);

      for await (const blob of input.blobEntries) {
        await packStreamEntry(
          pack,
          `${BLOB_ENTRY_PREFIX}${blob.storageKey}`,
          blob.size,
          blob.stream,
        );
      }

      pack.finalize();
    } catch (err) {
      pack.destroy(toError(err));
    }
  })();

  return pack.pipe(encryptStream);
}

export interface ReadBundleOptions {
  /** Directory blob entries are written under — a sibling staging directory, never the live upload store (KTD10). */
  readonly stagingDir: string;
}

export type BundleEvent =
  | { readonly kind: "manifest"; readonly manifest: BackupManifest }
  | { readonly kind: "db"; readonly stream: Readable }
  | {
      readonly kind: "blob";
      readonly storageKey: string;
      readonly path: string;
      readonly size: number;
    };

/** Resolves `storageKey` under `stagingRoot`, rejecting any path that would escape it — the same pattern `LocalFilesystemAdapter.resolvePath` uses (KTD11). */
function resolveStagingBlobPath(
  stagingRoot: string,
  storageKey: string,
): string {
  const resolved = resolve(stagingRoot, storageKey);
  const rootPrefix = stagingRoot.endsWith(sep)
    ? stagingRoot
    : `${stagingRoot}${sep}`;
  const isRootItself = resolved === stagingRoot;
  const isInsideRoot = resolved.startsWith(rootPrefix);
  if (!isRootItself && !isInsideRoot) {
    throw new PathTraversalError(storageKey);
  }
  return resolved;
}

/**
 * Streams a tar entry's content to `destPath`, refusing to follow a symlink
 * at the destination (`O_NOFOLLOW`, when the platform supports it) and
 * aborting the write the moment more than `maxBytes` has been streamed —
 * independent of whatever size the entry's tar header claims, since that
 * header is attacker-controlled (KTD11).
 */
async function writeEntryToFile(
  entry: Readable,
  destPath: string,
  maxBytes: number,
): Promise<number> {
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_TRUNC |
    (fsConstants.O_NOFOLLOW ?? 0);
  // `O_NOFOLLOW` makes `open` itself throw (ELOOP) if `destPath` is a
  // symlink, so a prior malicious entry can't have this write silently
  // follow it elsewhere (KTD11 defense-in-depth beyond the entry-type check
  // above).
  const handle = await open(destPath, flags, 0o600);
  const dest = handle.createWriteStream();

  return new Promise((resolvePromise, rejectPromise) => {
    let written = 0;
    let settled = false;

    function fail(err: unknown): void {
      if (settled) return;
      settled = true;
      entry.destroy();
      dest.destroy();
      rejectPromise(toError(err));
    }

    entry.on("data", (chunk: Buffer) => {
      written += chunk.byteLength;
      if (written > maxBytes) {
        fail(
          new BundleIntegrityError(
            `blob entry streamed more than its ${maxBytes}-byte bound: "${destPath}"`,
          ),
        );
      }
    });
    entry.on("error", fail);
    dest.on("error", fail);
    dest.on("finish", () => {
      if (settled) return;
      settled = true;
      resolvePromise(written);
    });

    entry.pipe(dest);
  });
}

/**
 * Reads a bundle: decrypts `decryptStream` via U1's authenticated
 * decryption, un-tars it, and yields the manifest, then the db NDJSON
 * stream, then each blob entry in order.
 *
 * Blob content is written under `stagingDir` as it streams — never the live
 * upload store (KTD10) — with every entry validated per the module doc
 * comment's KTD11 choke point.
 *
 * The caller MUST fully drain the `"db"` event's stream before requesting
 * the next event: tar's sequential framing means the reader can't advance to
 * the next entry until the current one has been read to completion.
 */
export async function* readBundle(
  decryptStream: Transform,
  options: ReadBundleOptions,
): AsyncGenerator<BundleEvent, void, void> {
  const extract = tar.extract();
  decryptStream.pipe(extract);
  decryptStream.on("error", (err) => extract.destroy(toError(err)));

  const stagingRoot = resolve(options.stagingDir);

  let manifest: BackupManifest | undefined;
  let entryCount = 0;
  let blobsSeen = 0;
  let blobBytesSeen = 0;
  const ensuredDirs = new Set<string>();

  for await (const entry of extract) {
    entryCount++;
    const name = entry.header.name;

    if (entryCount === 1) {
      if (name !== MANIFEST_ENTRY_NAME) {
        entry.resume();
        throw new BundleFormatError(
          `expected first bundle entry "${MANIFEST_ENTRY_NAME}", got "${name}"`,
        );
      }
      const raw = await bufferBoundedEntry(
        entry,
        MAX_MANIFEST_BYTES,
        MANIFEST_ENTRY_NAME,
      );
      manifest = parseManifest(raw);
      yield { kind: "manifest", manifest };
      continue;
    }

    if (entryCount === 2) {
      if (name !== DB_ENTRY_NAME) {
        entry.resume();
        throw new BundleFormatError(
          `expected second bundle entry "${DB_ENTRY_NAME}", got "${name}"`,
        );
      }
      yield { kind: "db", stream: entry };
      continue;
    }

    // Every entry from here on must be a validated blob (KTD11).
    if (!manifest) {
      entry.resume();
      throw new BundleFormatError(
        "internal: manifest missing before blob entries",
      );
    }
    if (!name.startsWith(BLOB_ENTRY_PREFIX)) {
      entry.resume();
      throw new BundleFormatError(
        `unexpected bundle entry outside "${BLOB_ENTRY_PREFIX}": "${name}"`,
      );
    }

    const storageKey = name.slice(BLOB_ENTRY_PREFIX.length);

    blobsSeen++;
    if (blobsSeen > manifest.counts.blobs) {
      entry.resume();
      throw new BundleIntegrityError(
        `bundle manifest declares ${manifest.counts.blobs} blob(s) but the bundle contains more`,
      );
    }

    if (entry.header.type !== "file") {
      entry.resume();
      throw new UnsafeBundleEntryError(
        `refusing non-regular-file bundle entry (type "${entry.header.type}"): "${storageKey}"`,
      );
    }

    const destPath = resolveStagingBlobPath(stagingRoot, storageKey);

    const declaredSize = entry.header.size ?? 0;
    if (declaredSize > manifest.counts.totalBlobBytes) {
      entry.resume();
      throw new BundleIntegrityError(
        `blob entry "${storageKey}" declares ${declaredSize} bytes, exceeding the manifest's total blob-bytes bound (${manifest.counts.totalBlobBytes})`,
      );
    }

    const destDir = dirname(destPath);
    if (!ensuredDirs.has(destDir)) {
      await mkdir(destDir, { recursive: true, mode: 0o700 });
      ensuredDirs.add(destDir);
    }
    const remainingBudget = manifest.counts.totalBlobBytes - blobBytesSeen;
    const writtenSize = await writeEntryToFile(
      entry,
      destPath,
      remainingBudget,
    );
    blobBytesSeen += writtenSize;

    yield { kind: "blob", storageKey, path: destPath, size: writtenSize };
  }

  if (entryCount === 0) {
    throw new BundleFormatError("bundle is empty: no entries found");
  }
  if (entryCount === 1) {
    throw new BundleFormatError(
      `bundle ended after "${MANIFEST_ENTRY_NAME}": missing "${DB_ENTRY_NAME}"`,
    );
  }
  if (manifest && blobsSeen !== manifest.counts.blobs) {
    throw new BundleIntegrityError(
      `bundle manifest declares ${manifest.counts.blobs} blob(s) but the bundle contained ${blobsSeen}`,
    );
  }
}

/** Buffers a small, bounded entry (the manifest) — refuses to buffer past `maxBytes`. */
async function bufferBoundedEntry(
  stream: Readable,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      stream.destroy();
      throw new BundleIntegrityError(
        `${label} exceeds the ${maxBytes}-byte safety cap`,
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
