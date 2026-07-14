import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import * as tar from "tar-stream";
import { PathTraversalError } from "@/src/storage/local-fs-adapter";
import { expectRejects } from "@/src/test-support/assertions";
import {
  type BundleBlobEntry,
  type BundleEvent,
  BundleFormatError,
  BundleIntegrityError,
  readBundle,
  UnsafeBundleEntryError,
  type WriteBundleInput,
  writeBundle,
} from "../bundle";
import {
  createDecryptStream,
  createEncryptStream,
  deriveKey,
  generateSalt,
} from "../crypto";
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  buildManifest,
  currentAppVersion,
  latestMigrationTag,
} from "../manifest";

const PASSWORD = "correct horse battery staple";

/** Drains a Readable into one Buffer. */
async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

/** Encrypts a raw plaintext buffer, returning both the ciphertext and the key needed to decrypt it. Used to craft raw/malicious bundles directly (bypassing `writeBundle`). */
async function encryptWithKey(
  plaintext: Buffer,
): Promise<{ encrypted: Buffer; key: Buffer }> {
  const salt = generateSalt();
  const key = deriveKey(PASSWORD, salt);
  const source = Readable.from([plaintext]);
  const encrypted = await collect(source.pipe(createEncryptStream(key, salt)));
  return { encrypted, key };
}

/** Runs `writeBundle` end to end and returns the encrypted output plus the key needed to decrypt it. */
async function writeBundleEncrypted(
  input: WriteBundleInput,
): Promise<{ encrypted: Buffer; key: Buffer }> {
  const salt = generateSalt();
  const key = deriveKey(PASSWORD, salt);
  const encrypted = await collect(
    writeBundle(input, createEncryptStream(key, salt)),
  );
  return { encrypted, key };
}

/** Builds a decrypt stream fed from `encrypted`, ready to hand to `readBundle`. */
function decryptStreamFor(encrypted: Buffer, key: Buffer) {
  const decryptStream = createDecryptStream(key);
  Readable.from([encrypted]).pipe(decryptStream);
  return decryptStream;
}

function makeStagingDir(): string {
  return mkdtempSync(join(tmpdir(), "magstacker-bundle-"));
}

function ndjsonStream(rows: readonly string[]): Readable {
  return Readable.from(rows.map((row) => `${row}\n`));
}

function blobEntry(storageKey: string, content: Buffer): BundleBlobEntry {
  return {
    storageKey,
    size: content.byteLength,
    stream: Readable.from([content]),
  };
}

/** Builds a raw tar buffer directly (bypassing writeBundle), so tests can inject malformed/malicious entries. */
function buildRawTar(
  entries: ReadonlyArray<{
    name: string;
    type?: "file" | "symlink" | "directory";
    data?: Buffer;
    size?: number;
    linkname?: string;
  }>,
): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk: Buffer) => chunks.push(chunk));

  return new Promise((resolvePromise, rejectPromise) => {
    pack.on("end", () => resolvePromise(Buffer.concat(chunks)));
    pack.on("error", rejectPromise);

    (async () => {
      for (const e of entries) {
        await new Promise<void>((res, rej) => {
          if (e.type === "symlink") {
            pack.entry(
              {
                name: e.name,
                type: "symlink",
                linkname: e.linkname ?? "elsewhere",
              },
              (err) => (err ? rej(err) : res()),
            );
          } else {
            pack.entry(
              {
                name: e.name,
                size: e.data ? e.data.byteLength : (e.size ?? 0),
                type: e.type ?? "file",
              },
              e.data,
              (err) => (err ? rej(err) : res()),
            );
          }
        });
      }
      pack.finalize();
    })().catch(rejectPromise);
  });
}

function testManifest(counts: BackupManifest["counts"]): BackupManifest {
  return buildManifest({
    counts,
    createdAt: new Date("2026-07-12T00:00:00.000Z"),
  });
}

interface CapturedEvents {
  manifest: BackupManifest | undefined;
  dbLines: string[];
  blobEvents: Array<{ storageKey: string; path: string; size: number }>;
}

/** Fully drains a `readBundle` async generator (including the "db" stream event, which the reader is required to consume before advancing — see readBundle's doc comment) and captures everything for assertions. */
async function collectEvents(
  generator: AsyncGenerator<BundleEvent, void, void>,
): Promise<CapturedEvents> {
  const result: CapturedEvents = {
    manifest: undefined,
    dbLines: [],
    blobEvents: [],
  };
  for await (const event of generator) {
    if (event.kind === "manifest") {
      result.manifest = event.manifest;
    } else if (event.kind === "db") {
      const buf = await collect(event.stream);
      result.dbLines = buf
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== "");
    } else {
      result.blobEvents.push({
        storageKey: event.storageKey,
        path: event.path,
        size: event.size,
      });
    }
  }
  return result;
}

describe("manifest fields (R4)", () => {
  test("buildManifest stamps backupFormatVersion, appVersion, and migrationTag", () => {
    const manifest = testManifest({ rows: 3, blobs: 0, totalBlobBytes: 0 });

    expect(manifest.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.appVersion).toBe(currentAppVersion());
    expect(manifest.migrationTag).toBe(latestMigrationTag());
    expect(manifest.createdAt).toBe("2026-07-12T00:00:00.000Z");
  });
});

describe("writeBundle / readBundle round-trip", () => {
  let stagingDir: string;

  beforeEach(() => {
    stagingDir = makeStagingDir();
  });

  afterEach(() => {
    rmSync(stagingDir, { recursive: true, force: true });
  });

  test("round-trips manifest + multi-row db stream + several blobs of varying sizes, in order", async () => {
    const rows = [
      JSON.stringify({ table: "firearm", row: { id: 1 } }),
      JSON.stringify({ table: "firearm", row: { id: 2 } }),
      JSON.stringify({ table: "magazine", row: { id: 1 } }),
    ];
    const blobs = [
      { key: "empty.bin", content: Buffer.alloc(0) },
      { key: "small.bin", content: Buffer.from("hello world") },
      { key: "large.bin", content: Buffer.alloc(200_000, 0xab) },
    ];
    const totalBlobBytes = blobs.reduce(
      (sum, b) => sum + b.content.byteLength,
      0,
    );
    const manifest = testManifest({
      rows: rows.length,
      blobs: blobs.length,
      totalBlobBytes,
    });

    const { encrypted, key } = await writeBundleEncrypted({
      manifest,
      dbStream: ndjsonStream(rows),
      blobEntries: blobs.map((b) => blobEntry(b.key, b.content)),
    });

    const events = await collectEvents(
      readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
    );

    expect(events.manifest).toEqual(manifest);
    expect(events.dbLines).toEqual(rows);
    expect(events.blobEvents.map((e) => e.storageKey)).toEqual(
      blobs.map((b) => b.key),
    );
    for (const [index, blobEvent] of events.blobEvents.entries()) {
      const expected = blobs[index];
      expect(expected).toBeDefined();
      if (!expected) continue;
      expect(blobEvent.size).toBe(expected.content.byteLength);
      const written = readFileSync(blobEvent.path);
      expect(written.equals(expected.content)).toBe(true);
    }
  });

  test("an empty blob set round-trips", async () => {
    const rows = [JSON.stringify({ table: "firearm", row: { id: 1 } })];
    const manifest = testManifest({
      rows: rows.length,
      blobs: 0,
      totalBlobBytes: 0,
    });

    const { encrypted, key } = await writeBundleEncrypted({
      manifest,
      dbStream: ndjsonStream(rows),
      blobEntries: [],
    });

    const events = await collectEvents(
      readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
    );

    expect(events.manifest).toEqual(manifest);
    expect(events.dbLines).toEqual(rows);
    expect(events.blobEvents).toEqual([]);
  });

  test("a truncated/corrupt bundle surfaces an error, not partial data", async () => {
    const rows = [JSON.stringify({ table: "firearm", row: { id: 1 } })];
    const content = Buffer.alloc(5_000, 0x11);
    const manifest = testManifest({
      rows: rows.length,
      blobs: 1,
      totalBlobBytes: content.byteLength,
    });

    const { encrypted, key } = await writeBundleEncrypted({
      manifest,
      dbStream: ndjsonStream(rows),
      blobEntries: [blobEntry("a.bin", content)],
    });
    const truncated = encrypted.subarray(0, encrypted.length - 20);

    await expectRejects(() =>
      collectEvents(
        readBundle(decryptStreamFor(truncated, key), { stagingDir }),
      ),
    );
  });
});

describe("KTD11 — untrusted blob-entry validation", () => {
  let stagingDir: string;

  beforeEach(() => {
    stagingDir = makeStagingDir();
  });

  afterEach(() => {
    rmSync(stagingDir, { recursive: true, force: true });
  });

  test("a path-traversal blob entry (blobs/../../etc/x) is refused, nothing written outside stagingDir", async () => {
    const manifest = testManifest({ rows: 0, blobs: 1, totalBlobBytes: 10 });
    const raw = await buildRawTar([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.ndjson", data: Buffer.alloc(0) },
      { name: "blobs/../../etc/x", data: Buffer.from("pwned") },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PathTraversalError);
    expect(readdirSync(stagingDir)).toEqual([]);
    const escapeTarget = resolve(stagingDir, "../../etc/x");
    expect(() => readFileSync(escapeTarget)).toThrow();
  });

  test("a symlink blob entry is refused", async () => {
    const manifest = testManifest({ rows: 0, blobs: 1, totalBlobBytes: 10 });
    const raw = await buildRawTar([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.ndjson", data: Buffer.alloc(0) },
      { name: "blobs/evil-link", type: "symlink", linkname: "/etc/passwd" },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(UnsafeBundleEntryError);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  test("a bundle whose blob count exceeds its manifest-declared count is refused before extraction", async () => {
    const manifest = testManifest({ rows: 0, blobs: 1, totalBlobBytes: 20 });
    const raw = await buildRawTar([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.ndjson", data: Buffer.alloc(0) },
      { name: "blobs/a.bin", data: Buffer.from("aaaaa") },
      { name: "blobs/b.bin", data: Buffer.from("bbbbb") },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BundleIntegrityError);
  });

  test("a blob entry whose declared size exceeds the manifest's total-bytes bound is refused before extraction", async () => {
    const manifest = testManifest({ rows: 0, blobs: 1, totalBlobBytes: 10 });
    const oversized = Buffer.alloc(1_000, 0x42);
    const raw = await buildRawTar([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.ndjson", data: Buffer.alloc(0) },
      { name: "blobs/big.bin", data: oversized },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BundleIntegrityError);
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  test("refuses a bundle whose first entry isn't manifest.json", async () => {
    const raw = await buildRawTar([
      { name: "db.ndjson", data: Buffer.alloc(0) },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BundleFormatError);
  });

  test("refuses a non-regular, non-symlink entry (directory type)", async () => {
    const manifest = testManifest({ rows: 0, blobs: 1, totalBlobBytes: 10 });
    const raw = await buildRawTar([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.ndjson", data: Buffer.alloc(0) },
      { name: "blobs/a-directory", type: "directory" },
    ]);
    const { encrypted, key } = await encryptWithKey(raw);

    let thrown: unknown;
    try {
      await collectEvents(
        readBundle(decryptStreamFor(encrypted, key), { stagingDir }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnsafeBundleEntryError);
  });
});
