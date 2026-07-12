import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { getTableName } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as tar from "tar-stream";
import { NotAuthorizedError } from "../../auth/errors";
import * as schema from "../../db/schema";
import { firearm, firearmDocument, user } from "../../db/schema";
import { type BundleBlobEntry, writeBundle } from "../bundle";
import { createEncryptStream, deriveKey, generateSalt } from "../crypto";
import { exportDatabase } from "../db-export";
import { importDatabase, wipeDatabase } from "../db-import";
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  buildManifest,
} from "../manifest";
import { restore } from "../restore-service";
import { EXPORT_TABLE_ORDER } from "../table-order";

/**
 * Integration tests for the restore service (U5) — the most safety-critical
 * unit in the backup feature. Every test runs against an ephemeral
 * Testcontainers Postgres (never the ambient dev DB) plus a per-test
 * temporary "UPLOAD_DIR" on the real filesystem, since `restore()` performs
 * real directory renames as part of its stage-then-promote sequence.
 *
 * Same pinned image as `db-roundtrip.test.ts` / `e2e/start-test-server.ts`.
 */
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

const PASSWORD = "correct horse battery staple";

type Db = NodePgDatabase<typeof schema>;

async function selectAll(
  db: Db,
  table: (typeof EXPORT_TABLE_ORDER)[number],
): Promise<Record<string, unknown>[]> {
  // biome-ignore lint/suspicious/noExplicitAny: EXPORT_TABLE_ORDER is deliberately heterogeneous.
  const rows = await db.select().from(table as any);
  return rows as Record<string, unknown>[];
}

async function snapshotTables(
  db: Db,
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORT_TABLE_ORDER) {
    const rows = await selectAll(db, table);
    snapshot[getTableName(table)] = rows.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return snapshot;
}

interface SeededInventory {
  ownerId: string;
  firearmId: string;
  documentStorageKey: string;
}

/** Seeds one user + one firearm + one document (with a real blob file under `uploadDir`). */
async function seedInventory(
  db: Db,
  uploadDir: string,
): Promise<SeededInventory> {
  const ownerId = `owner-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: ownerId, name: "Owner", email: `${ownerId}@example.test` });

  const [firearmRow] = await db
    .insert(firearm)
    .values({ ownerId, name: "Pre-existing FA", caliber: "9mm" })
    .returning();
  if (!firearmRow) throw new Error("seed: firearm insert returned no row");

  const documentStorageKey = `${randomUUID()}.pdf`;
  await db.insert(firearmDocument).values({
    firearmId: firearmRow.id,
    storageKey: documentStorageKey,
    filename: "receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 11,
    docType: "receipt",
  });
  await writeFile(join(uploadDir, documentStorageKey), "pre-existing");

  return { ownerId, firearmId: firearmRow.id, documentStorageKey };
}

async function countAllRows(db: Db): Promise<number> {
  let total = 0;
  for (const table of EXPORT_TABLE_ORDER) {
    total += (await selectAll(db, table)).length;
  }
  return total;
}

interface FakeBlob {
  readonly key: string;
  readonly content: Buffer;
}

/** Builds a real encrypted+authenticated bundle from `db`'s current state plus `blobs`. */
async function buildEncryptedBundle(
  db: Db,
  options: {
    password?: string;
    blobs?: readonly FakeBlob[];
    backupFormatVersion?: number;
  } = {},
): Promise<Buffer> {
  const blobs = options.blobs ?? [];
  const totalBlobBytes = blobs.reduce(
    (sum, b) => sum + b.content.byteLength,
    0,
  );
  const baseManifest = buildManifest({
    counts: {
      rows: await countAllRows(db),
      blobs: blobs.length,
      totalBlobBytes,
    },
  });
  const manifest: BackupManifest =
    options.backupFormatVersion === undefined
      ? baseManifest
      : { ...baseManifest, backupFormatVersion: options.backupFormatVersion };

  const salt = generateSalt();
  const key = deriveKey(options.password ?? PASSWORD, salt);
  const blobEntries: BundleBlobEntry[] = blobs.map((b) => ({
    storageKey: b.key,
    size: b.content.byteLength,
    stream: Readable.from([b.content]),
  }));

  const encrypted = writeBundle(
    { manifest, dbStream: exportDatabase(db), blobEntries },
    createEncryptStream(key, salt),
  );
  return collect(encrypted);
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

/**
 * Builds an incoming bundle from data that's genuinely DIFFERENT from `db`'s
 * current live rows, then restores `db` back to its original live state (an
 * exact NDJSON export/import round-trip). Without this, a fault-injection
 * test that builds its bundle from `db`'s own unchanged state can't tell "the
 * promote was rolled back" apart from "the promote succeeded, but happened to
 * write back the same rows it started with" — the bundle must actually carry
 * different data for a rollback assertion to mean anything.
 */
async function buildDistinctIncomingBundle(
  db: Db,
  blobKey: string,
  blobContent: Buffer,
): Promise<Buffer> {
  const originalNdjson = (await collect(exportDatabase(db))).toString("utf8");

  await wipeDatabase(db);
  const distinctOwner = `owner-${randomUUID()}`;
  await db.insert(user).values({
    id: distinctOwner,
    name: "Distinct Incoming Owner",
    email: `${distinctOwner}@example.test`,
  });
  const [distinctFirearm] = await db
    .insert(firearm)
    .values({
      ownerId: distinctOwner,
      name: "Distinct Incoming FA",
      caliber: "7.62",
    })
    .returning();
  if (!distinctFirearm) throw new Error("seed failed");
  await db.insert(firearmDocument).values({
    firearmId: distinctFirearm.id,
    storageKey: blobKey,
    filename: "incoming.pdf",
    mimeType: "application/pdf",
    sizeBytes: blobContent.byteLength,
    docType: "receipt",
  });

  const bundle = await buildEncryptedBundle(db, {
    blobs: [{ key: blobKey, content: blobContent }],
  });

  await wipeDatabase(db);
  await importDatabase(db, Readable.from([originalNdjson]));

  return bundle;
}

/** Builds a raw (unencrypted) tar buffer directly, bypassing writeBundle, so a test can inject a malicious entry — then encrypts it under a real key so it authenticates. */
async function buildRawTarThenEncrypt(
  entries: ReadonlyArray<{
    name: string;
    type?: "file" | "symlink";
    data?: Buffer;
    linkname?: string;
  }>,
  password: string,
): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on("data", (chunk: Buffer) => chunks.push(chunk));
  const raw = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
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
                size: e.data ? e.data.byteLength : 0,
                type: "file",
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

  const salt = generateSalt();
  const key = deriveKey(password, salt);
  const encrypted = collect(
    Readable.from([raw]).pipe(createEncryptStream(key, salt)),
  );
  return encrypted;
}

/** Flips the last byte of `buf` — used to tamper the final secretstream chunk. */
function tamperLastByte(buf: Buffer): Buffer {
  const tampered = Buffer.from(buf);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
  return tampered;
}

async function readUploadDirKeys(uploadDir: string): Promise<string[]> {
  try {
    return (await readdir(uploadDir)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

describe("restore service (U5)", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let db: Db;
  let uploadDir: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_restore_test")
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
    uploadDir = await mkdtemp(join(tmpdir(), "magstacker-restore-upload-"));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
  });

  function restoreOptions(extra: Parameters<typeof restore>[2] = {}) {
    return {
      db,
      pool,
      uploadDir,
      checkIsAdmin: async () => true,
      ...extra,
    };
  }

  test("empty instance + valid bundle + matching version promotes; the instance ends up equal to the source (AE5/R10)", async () => {
    const sourceOwner = `owner-${randomUUID()}`;
    await db.insert(user).values({
      id: sourceOwner,
      name: "Source",
      email: `${sourceOwner}@example.test`,
    });
    const [sourceFirearm] = await db
      .insert(firearm)
      .values({ ownerId: sourceOwner, name: "Source FA", caliber: ".223" })
      .returning();
    if (!sourceFirearm) throw new Error("seed failed");
    const docKey = `${randomUUID()}.pdf`;
    await db.insert(firearmDocument).values({
      firearmId: sourceFirearm.id,
      storageKey: docKey,
      filename: "warranty.pdf",
      mimeType: "application/pdf",
      sizeBytes: 5,
      docType: "warranty",
    });

    const blobContent = Buffer.from("hello");
    const bundle = await buildEncryptedBundle(db, {
      blobs: [{ key: docKey, content: blobContent }],
    });
    const beforeSnapshot = await snapshotTables(db);

    // Wipe live data — restore is expected to reproduce it exactly (F2 into
    // an empty instance), not merely leave it unchanged.
    await wipeDatabase(db);

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions(),
    );

    expect(outcome.kind).toBe("ok");
    const afterSnapshot = await snapshotTables(db);
    expect(afterSnapshot).toEqual(beforeSnapshot);

    const files = await readUploadDirKeys(uploadDir);
    expect(files).toEqual([docKey]);
    const restoredBlob = await readFile(join(uploadDir, docKey));
    expect(restoredBlob.equals(blobContent)).toBe(true);
  });

  test("non-empty instance + plain restore is refused; nothing changes (AE1/R6)", async () => {
    const seeded = await seedInventory(db, uploadDir);
    const beforeSnapshot = await snapshotTables(db);
    const beforeFiles = await readUploadDirKeys(uploadDir);

    const bundle = await buildEncryptedBundle(db, {
      blobs: [{ key: "unrelated.bin", content: Buffer.from("x") }],
    });

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions(),
    );

    expect(outcome.kind).toBe("refused_not_empty");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual(beforeFiles);
    void seeded;
  });

  test("non-empty instance + force restore wipes then promotes (AE2/R7)", async () => {
    await seedInventory(db, uploadDir);

    const newOwner = `owner-${randomUUID()}`;
    const sourceDb = db; // build the incoming bundle from a distinct dataset
    await wipeDatabase(sourceDb);
    await sourceDb.insert(user).values({
      id: newOwner,
      name: "New Owner",
      email: `${newOwner}@example.test`,
    });
    const [newFirearm] = await sourceDb
      .insert(firearm)
      .values({ ownerId: newOwner, name: "New FA", caliber: "5.56" })
      .returning();
    if (!newFirearm) throw new Error("seed failed");
    const newDocKey = `${randomUUID()}.pdf`;
    await sourceDb.insert(firearmDocument).values({
      firearmId: newFirearm.id,
      storageKey: newDocKey,
      filename: "new-doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      docType: "receipt",
    });
    const newBlobContent = Buffer.from("new");
    const bundle = await buildEncryptedBundle(sourceDb, {
      blobs: [{ key: newDocKey, content: newBlobContent }],
    });
    const expectedSnapshot = await snapshotTables(sourceDb);

    // Re-seed the "current" (about-to-be-overwritten) live instance and its
    // upload dir with DIFFERENT data than the bundle carries.
    await wipeDatabase(db);
    await rm(uploadDir, { recursive: true, force: true });
    await mkdir(uploadDir, { recursive: true });
    const preExisting = await seedInventory(db, uploadDir);

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions({ force: true }),
    );

    expect(outcome.kind).toBe("ok");
    expect(await snapshotTables(db)).toEqual(expectedSnapshot);
    const files = await readUploadDirKeys(uploadDir);
    expect(files).toEqual([newDocKey]);
    expect(files).not.toContain(preExisting.documentStorageKey);
  });

  test("wrong password is refused; live data untouched (AE3/R9)", async () => {
    await seedInventory(db, uploadDir);
    const beforeSnapshot = await snapshotTables(db);
    const beforeFiles = await readUploadDirKeys(uploadDir);

    const bundle = await buildEncryptedBundle(db, {
      password: "the-real-password",
    });

    const outcome = await restore(
      Readable.from([bundle]),
      "definitely-wrong-password",
      restoreOptions(),
    );

    expect(outcome.kind).toBe("wrong_password_or_tampered");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual(beforeFiles);
  });

  test("a tampered byte in the LAST chunk is refused before promote — proves stage-then-promote (KTD10)", async () => {
    const beforeSnapshot = await snapshotTables(db); // empty instance
    // A blob large enough to force multiple secretstream chunks, so the
    // "last chunk" is meaningfully distinct from the header/first chunk.
    const bigBlob = Buffer.alloc(150_000, 0xab);
    const bundle = await buildEncryptedBundle(db, {
      blobs: [{ key: "big.bin", content: bigBlob }],
    });
    const tampered = tamperLastByte(bundle);

    const outcome = await restore(
      Readable.from([tampered]),
      PASSWORD,
      restoreOptions(),
    );

    expect(outcome.kind).toBe("wrong_password_or_tampered");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual([]);
  });

  test("version mismatch is refused before staging (AE4/R8)", async () => {
    await seedInventory(db, uploadDir);
    const beforeSnapshot = await snapshotTables(db);
    const beforeFiles = await readUploadDirKeys(uploadDir);

    const bundle = await buildEncryptedBundle(db, {
      backupFormatVersion: BACKUP_FORMAT_VERSION + 1,
    });

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions(),
    );

    expect(outcome.kind).toBe("version_mismatch");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual(beforeFiles);
  });

  test("fault injected inside the wipe+promote transaction rolls back both DB and blobs (critical path, pre-commit)", async () => {
    const preExisting = await seedInventory(db, uploadDir);
    const beforeSnapshot = await snapshotTables(db);
    const beforeFiles = await readUploadDirKeys(uploadDir);
    const beforeBlobContent = await readFile(
      join(uploadDir, preExisting.documentStorageKey),
    );

    const bundle = await buildDistinctIncomingBundle(
      db,
      "incoming.bin",
      Buffer.from("incoming"),
    );

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions({
        force: true,
        _testFaultInjection: (point) => {
          if (point === "pre-commit") {
            throw new Error("injected fault: pre-commit");
          }
        },
      }),
    );

    expect(outcome.kind).toBe("rolled_back");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual(beforeFiles);
    expect(
      (await readFile(join(uploadDir, preExisting.documentStorageKey))).equals(
        beforeBlobContent,
      ),
    ).toBe(true);
  });

  test("fault injected after the DB commits but before the blob swap rolls back both stores via the snapshot schema (critical path, post-commit)", async () => {
    const preExisting = await seedInventory(db, uploadDir);
    const beforeSnapshot = await snapshotTables(db);
    const beforeFiles = await readUploadDirKeys(uploadDir);
    const beforeBlobContent = await readFile(
      join(uploadDir, preExisting.documentStorageKey),
    );

    const bundle = await buildDistinctIncomingBundle(
      db,
      "incoming.bin",
      Buffer.from("incoming"),
    );

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions({
        force: true,
        _testFaultInjection: (point) => {
          if (point === "post-commit-pre-blob-swap") {
            throw new Error("injected fault: post-commit-pre-blob-swap");
          }
        },
      }),
    );

    expect(outcome.kind).toBe("rolled_back");
    // The DB side had already committed the new data when the fault hit —
    // proving this assertion requires the snapshot-schema restore path, not
    // just Postgres's own transaction rollback.
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual(beforeFiles);
    expect(
      (await readFile(join(uploadDir, preExisting.documentStorageKey))).equals(
        beforeBlobContent,
      ),
    ).toBe(true);
  });

  test("a path-traversal blob entry is refused; nothing is written outside staging (KTD11)", async () => {
    const beforeSnapshot = await snapshotTables(db);
    const manifest = buildManifest({
      counts: { rows: 0, blobs: 1, totalBlobBytes: 10 },
    });
    const bundle = await buildRawTarThenEncrypt(
      [
        { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
        { name: "db.ndjson", data: Buffer.alloc(0) },
        { name: "blobs/../../etc/pwned", data: Buffer.from("pwned") },
      ],
      PASSWORD,
    );

    const outcome = await restore(
      Readable.from([bundle]),
      PASSWORD,
      restoreOptions(),
    );

    expect(outcome.kind).toBe("wrong_password_or_tampered");
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
    expect(await readUploadDirKeys(uploadDir)).toEqual([]);
  });

  test("a non-admin caller is refused inside the service, independent of any route gate (R14)", async () => {
    const beforeSnapshot = await snapshotTables(db);
    const bundle = await buildEncryptedBundle(db, {});

    let thrown: unknown;
    try {
      await restore(
        Readable.from([bundle]),
        PASSWORD,
        restoreOptions({ checkIsAdmin: async () => false }),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(NotAuthorizedError);
    expect(await snapshotTables(db)).toEqual(beforeSnapshot);
  });
});
