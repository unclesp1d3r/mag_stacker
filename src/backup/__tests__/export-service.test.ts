import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// `storage` is a lazily-constructed singleton shared across the whole test
// process (module state, not per-file): whichever test file's `storage`/
// `activeStorageRoot()` access happens first "wins" `UPLOAD_DIR` for every
// file in the run, so this only takes effect when this file is the first to
// touch storage (mirrors `src/domain/firearm-documents/__tests__/serving.test.ts`).
// Every test below therefore resolves the *actual* active root via
// `activeStorageRoot()` rather than trusting this constant, so the suite is
// correct regardless of file execution order.
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "export-service-uploads-"));

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { NotAuthorizedError } from "@/src/auth/errors";
import { activeStorageRoot } from "@/src/storage/index";
import { expectRejects } from "@/src/test-support/assertions";
import * as schema from "../../db/schema";
import { firearm, user } from "../../db/schema";
import type { BundleEvent } from "../bundle";
import { readBundle } from "../bundle";
import {
  createDecryptStream,
  deriveKey,
  HEADER_BYTE_LENGTH,
  readHeader,
} from "../crypto";
import { wipeDatabase } from "../db-import";
import { createBackup } from "../export-service";
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  latestMigrationTag,
} from "../manifest";

/**
 * Controls the mocked `isAdmin()` result for the "non-admin caller" test —
 * a mutable holder lets each test drive the outcome without re-registering
 * the module mock (mirrors `serving.test.ts`'s `currentUserId` pattern).
 */
let currentIsAdmin = true;
mock.module("@/src/auth/session", () => ({
  isAdmin: async () => currentIsAdmin,
}));

const PASSWORD = "correct horse battery staple";

// Same pinned image as `db-roundtrip.test.ts` / `e2e/start-test-server.ts`
// (AWS ECR Public mirror — avoids Docker Hub's unauthenticated per-IP pull
// limit on shared runners).
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

type Db = NodePgDatabase<typeof schema>;

/** Drains a Readable into one Buffer, tracking chunking behavior along the way (R13 evidence). */
async function collectWithStats(stream: Readable): Promise<{
  buffer: Buffer;
  maxChunkBytes: number;
  chunkCount: number;
}> {
  const chunks: Buffer[] = [];
  let maxChunkBytes = 0;
  let chunkCount = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    maxChunkBytes = Math.max(maxChunkBytes, buf.byteLength);
    chunkCount += 1;
  }
  return { buffer: Buffer.concat(chunks), maxChunkBytes, chunkCount };
}

/** Drains a Readable into one Buffer (no stats needed). */
async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(chunk as Buffer);
  }
  return Buffer.concat(parts);
}

interface CapturedEvents {
  manifest: BackupManifest | undefined;
  dbLines: string[];
  blobEvents: Array<{ storageKey: string; path: string; size: number }>;
}

/**
 * The real restore-side read path: extract the salt from the bundle's own
 * unencrypted header, derive the key from the operator's password, then
 * decrypt and un-tar (U1/U2's read path) — exactly as a real restore would,
 * since `createBackup` only takes a password, never handing the caller a
 * salt/key directly.
 */
async function decryptAndCollect(
  encrypted: Buffer,
  password: string,
  stagingDir: string,
): Promise<CapturedEvents> {
  const header = readHeader(encrypted.subarray(0, HEADER_BYTE_LENGTH));
  const key = deriveKey(password, header.salt);
  const decryptStream = createDecryptStream(key);
  Readable.from([encrypted]).pipe(decryptStream);

  const result: CapturedEvents = {
    manifest: undefined,
    dbLines: [],
    blobEvents: [],
  };
  const generator = readBundle(decryptStream, { stagingDir });
  for await (const event of generator as AsyncGenerator<
    BundleEvent,
    void,
    void
  >) {
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

/**
 * Always resolves the singleton's *actual* root — see the top-of-file note on
 * why this must not be assumed to equal the constant this file set
 * `UPLOAD_DIR` to. Recreated on demand: whichever test file's directory won
 * the singleton race may have already been torn down by that file's own
 * `afterAll` by the time this file's tests run, so every access here is
 * defensive about the directory having gone missing (mirrors
 * `listUploadBlobs`'s own ENOENT tolerance in `export-service.ts`).
 */
function resolvedUploadDir(): string {
  const dir = activeStorageRoot();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeUploadBlob(name: string, content: Buffer): void {
  writeFileSync(join(resolvedUploadDir(), name), content);
}

function listUploadFiles(): string[] {
  return readdirSync(resolvedUploadDir());
}

function clearUploadDir(): void {
  const dir = resolvedUploadDir();
  for (const name of readdirSync(dir)) {
    rmSync(join(dir, name), { force: true });
  }
}

function makeStagingDir(): string {
  return mkdtempSync(join(tmpdir(), "export-service-staging-"));
}

describe("backup export service (U4)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_export_service_test")
      .start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await wipeDatabase(db);
    clearUploadDir();
  });

  afterEach(() => {
    currentIsAdmin = true;
  });

  test("exports a bundle that decrypts to the manifest, all rows, and all blobs (AE5 round trip)", async () => {
    const ownerId = `owner-${randomUUID()}`;
    await db
      .insert(user)
      .values({ id: ownerId, name: "Owner", email: `${ownerId}@example.test` });
    const [firearmRow] = await db
      .insert(firearm)
      .values({ ownerId, name: "Export Test FA", caliber: "9mm" })
      .returning();

    const blobs = [
      { key: `${randomUUID()}.bin`, content: randomBytes(1024) },
      { key: `${randomUUID()}.bin`, content: randomBytes(2048) },
      { key: `${randomUUID()}.bin`, content: Buffer.alloc(0) },
    ];
    for (const blob of blobs) {
      writeUploadBlob(blob.key, blob.content);
    }

    const stream = await createBackup(PASSWORD, { db });
    const { buffer } = await collectWithStats(stream);

    const stagingDir = makeStagingDir();
    try {
      const events = await decryptAndCollect(buffer, PASSWORD, stagingDir);

      expect(events.manifest).toBeDefined();
      expect(events.manifest?.backupFormatVersion).toBe(BACKUP_FORMAT_VERSION);
      expect(events.manifest?.migrationTag).toBe(latestMigrationTag());
      expect(events.manifest?.counts.rows).toBe(events.dbLines.length);
      expect(events.manifest?.counts.blobs).toBe(blobs.length);

      const parsedRows = events.dbLines.map((line) => JSON.parse(line));
      const exportedFirearmRow = parsedRows.find(
        (row) => row.table === "firearm" && row.row.id === firearmRow.id,
      );
      expect(exportedFirearmRow).toBeDefined();

      expect(events.blobEvents).toHaveLength(blobs.length);
      const blobsByKey = new Map(blobs.map((b) => [b.key, b.content]));
      for (const blobEvent of events.blobEvents) {
        const expectedContent = blobsByKey.get(blobEvent.storageKey);
        expect(expectedContent).toBeDefined();
        if (!expectedContent) continue;
        expect(blobEvent.size).toBe(expectedContent.byteLength);
        const written = await Bun.file(blobEvent.path).arrayBuffer();
        expect(Buffer.from(written).equals(expectedContent)).toBe(true);
      }
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  });

  test("a large blob set streams without buffering the whole bundle in memory (R13)", async () => {
    const blobCount = 4;
    const blobSize = 1_500_000; // 1.5 MiB each, ~6 MiB total
    for (let i = 0; i < blobCount; i++) {
      writeUploadBlob(`${randomUUID()}.bin`, randomBytes(blobSize));
    }
    const totalPlaintextBytes = blobCount * blobSize;

    const stream = await createBackup(PASSWORD, { db });
    const { buffer, maxChunkBytes, chunkCount } =
      await collectWithStats(stream);

    // The encrypted output is at least as large as the plaintext blobs (plus
    // headers/tar framing/auth tags) — sanity check we actually captured the
    // whole bundle before asserting on how it arrived.
    expect(buffer.byteLength).toBeGreaterThan(totalPlaintextBytes);

    // Chunked delivery, not one whole-bundle buffer: many chunks arrived, and
    // no single chunk carried anywhere near the full blob set (which a
    // whole-buffer implementation would produce as one multi-megabyte chunk).
    expect(chunkCount).toBeGreaterThan(20);
    expect(maxChunkBytes).toBeLessThan(totalPlaintextBytes / 4);
  });

  test("the returned stream is consumable once and no bundle file remains on disk afterward", async () => {
    writeUploadBlob(`${randomUUID()}.bin`, randomBytes(512));
    const beforeFiles = new Set(listUploadFiles());

    const stream = await createBackup(PASSWORD, { db });
    await collectWithStats(stream);

    expect(stream.readableEnded).toBe(true);

    // Re-draining an already-ended Readable yields nothing further — proves
    // the stream isn't secretly re-derivable/replayable.
    let extraChunks = 0;
    for await (const _chunk of stream) {
      extraChunks += 1;
    }
    expect(extraChunks).toBe(0);

    // No bundle (or any other) file was left behind under UPLOAD_DIR — the
    // only files there are the ones the test itself wrote (KTD8: nothing is
    // retained server-side).
    const afterFiles = new Set(listUploadFiles());
    expect(afterFiles).toEqual(beforeFiles);
  });

  test("a non-admin caller is rejected", async () => {
    currentIsAdmin = false;

    await expectRejects(() => createBackup(PASSWORD, { db }));

    try {
      await createBackup(PASSWORD, { db });
      throw new Error("expected createBackup to reject for a non-admin caller");
    } catch (error) {
      expect(error).toBeInstanceOf(NotAuthorizedError);
    }
  });
});
