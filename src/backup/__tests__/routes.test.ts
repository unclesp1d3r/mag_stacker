import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

// `storage` (src/storage/index.ts) is a lazily-constructed singleton, so
// `UPLOAD_DIR` must be set before ANY test body first touches it — set it
// here, ahead of the rest of this file's imports being evaluated (mirrors
// `export-service.test.ts` / `restore-service.test.ts`).
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "backup-routes-uploads-"));

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
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { wipeDatabase } from "@/src/backup/db-import";
import { createBackup } from "@/src/backup/export-service";
import { closePool, db } from "@/src/db/client";
import { operatorAudit } from "@/src/db/operator-audit-schema";

/**
 * Uses the REAL `@/src/db/client` singleton (`db`/`closePool`) rather than
 * mocking it. `mock.module()` overrides are process-global, and — unlike
 * `mock()`/`spyOn()` fn-mocks — a later `mock.module()` "restore" call does
 * NOT retroactively fix an already-linked static `import { db } from
 * "@/src/db/client"` in some OTHER test file: verified empirically (a
 * minimal 2-file repro) that once another file's static import has resolved
 * against this file's mock, re-registering the real module in `afterAll`
 * does not unstick it, so running the full `bun test src` suite left every
 * other file importing the real singleton pointed at this file's
 * already-torn-down pool ("Cannot use a pool after calling end on the
 * pool").
 *
 * Instead this leans on `client.ts`'s OWN test seam: `db`/`pool` are lazy —
 * nothing connects until first property access — and `closePool()` resets
 * that cached connection. `beforeAll` points `DATABASE_URL` at this file's
 * own ephemeral Testcontainers Postgres (so first access connects there);
 * `afterAll` closes that pool and restores `DATABASE_URL`, so whichever file
 * runs next reconnects (lazily, on ITS first access) to the original target.
 * `db`'s two consumers here are always the SAME shared object identity every
 * other file also imports, so there is nothing to "leak" once restored.
 */
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

interface MockUser {
  readonly id: string;
  readonly email: string;
  readonly role: string | null;
}
let currentUser: MockUser | null = null;
mock.module("@/src/auth/session", () => ({
  getCurrentUser: async () => currentUser,
  isAdmin: async () => currentUser?.role === "admin",
}));

// Same pinned image as the rest of the backup suite (AWS ECR Public mirror —
// avoids Docker Hub's unauthenticated per-IP pull limit on shared runners).
const POSTGRES_IMAGE =
  "public.ecr.aws/docker/library/postgres:17@sha256:5c855ad7b85e68e48a62f34662853f38b57c1c1d80f3a927ab58034fd6d31c5e";

const PASSWORD = "correct horse battery staple";
const ADMIN: MockUser = {
  id: "admin-1",
  email: "admin@example.test",
  role: "admin",
};
const NON_ADMIN: MockUser = {
  id: "user-1",
  email: "user@example.test",
  role: "user",
};

function exportRequest(password: unknown): Request {
  return new Request("http://localhost/api/admin/backup/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

/** Mirrors U7's real `<form method="POST">` export submit — form-encoded,
 * not JSON (R13: a navigation-triggered download, not client `fetch()`+blob). */
function exportFormRequest(password: string): Request {
  const body = new URLSearchParams({ password });
  return new Request("http://localhost/api/admin/backup/export", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function restoreRequest(options: {
  password?: string;
  force?: boolean;
  body?: Readable | null;
}): Request {
  const headers: Record<string, string> = {};
  if (options.password !== undefined)
    headers["x-backup-password"] = options.password;
  if (options.force) headers["x-backup-force"] = "true";

  const init: RequestInit & { duplex?: "half" } = {
    method: "POST",
    headers,
  };
  if (options.body !== undefined && options.body !== null) {
    init.body = Readable.toWeb(options.body) as unknown as ReadableStream;
    init.duplex = "half";
  }
  return new Request("http://localhost/api/admin/backup/restore", init);
}

/** Drains a Readable into one Buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Builds a real encrypted bundle (via U4's `createBackup`) as one Buffer,
 * so restore tests exercise the actual wire format rather than a fixture. */
async function buildValidBundle(): Promise<Buffer> {
  currentUser = ADMIN;
  try {
    const stream = await createBackup(PASSWORD, { db });
    return await collect(stream);
  } finally {
    currentUser = null;
  }
}

async function auditRowsFor(action: "export" | "restore") {
  return db
    .select()
    .from(operatorAudit)
    .where(eq(operatorAudit.action, action));
}

describe("admin backup API routes (U6)", () => {
  let container: StartedPostgreSqlContainer;
  let exportPost: (request: Request) => Promise<Response>;
  let restorePost: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase("magstacker_backup_routes_test")
      .start();
    process.env.DATABASE_URL = container.getConnectionUri();
    // First real access to the shared `db`/`pool` singleton — `connect()`
    // (src/db/client.ts) lazily binds it to `DATABASE_URL` right here.
    await migrate(db, { migrationsFolder: "./src/db/migrations" });

    ({ POST: exportPost } = await import(
      "@/app/api/admin/backup/export/route"
    ));
    ({ POST: restorePost } = await import(
      "@/app/api/admin/backup/restore/route"
    ));
  }, 120_000);

  afterAll(async () => {
    await closePool();
    await container?.stop();
    // Restore `DATABASE_URL` so whichever file runs next reconnects (lazily,
    // on its own first access) to the original target instead of this file's
    // now-stopped container.
    if (ORIGINAL_DATABASE_URL === undefined) {
      process.env.DATABASE_URL = undefined;
    } else {
      process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    }
  });

  beforeEach(async () => {
    await wipeDatabase(db);
  });

  afterEach(() => {
    currentUser = null;
  });

  test("non-admin caller is refused on both export and restore (R14)", async () => {
    currentUser = NON_ADMIN;
    const exportRes = await exportPost(exportRequest(PASSWORD));
    expect(exportRes.status).toBe(403);

    const restoreRes = await restorePost(
      restoreRequest({
        password: PASSWORD,
        body: Readable.from([Buffer.alloc(0)]),
      }),
    );
    expect(restoreRes.status).toBe(403);

    // Unauthenticated (no session at all) is refused too, distinctly (401).
    currentUser = null;
    const unauthRes = await exportPost(exportRequest(PASSWORD));
    expect(unauthRes.status).toBe(401);

    expect(await auditRowsFor("export")).toHaveLength(0);
    expect(await auditRowsFor("restore")).toHaveLength(0);
  });

  test("admin export returns a 200 streamed attachment with the expected headers", async () => {
    currentUser = ADMIN;
    const res = await exportPost(exportRequest(PASSWORD));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".magstacker-backup");
    expect(res.body).not.toBeNull();

    // The bundle itself must be non-empty (proves the response body is the
    // real encrypted stream, not a stub).
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const rows = await auditRowsFor("export");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(ADMIN.email);
    expect(rows[0]?.outcome).toBe("success");
  });

  test("admin restore of a valid bundle succeeds and records an operator_audit row (R15)", async () => {
    const bundle = await buildValidBundle();

    currentUser = ADMIN;
    const res = await restorePost(
      restoreRequest({ password: PASSWORD, body: Readable.from([bundle]) }),
    );
    const json = (await res.json()) as { outcome: string; message: string };

    expect(res.status).toBe(200);
    expect(json.outcome).toBe("ok");

    const rows = await auditRowsFor("restore");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(ADMIN.email);
    expect(rows[0]?.outcome).toBe("ok");
  });

  test("a wrong-password restore returns the discriminated failure outcome and records a failure event", async () => {
    const bundle = await buildValidBundle();

    currentUser = ADMIN;
    const res = await restorePost(
      restoreRequest({
        password: "not the password",
        body: Readable.from([bundle]),
      }),
    );
    const json = (await res.json()) as { outcome: string; message: string };

    expect(res.status).toBe(400);
    expect(json.outcome).toBe("wrong_password_or_tampered");

    const rows = await auditRowsFor("restore");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(ADMIN.email);
    expect(rows[0]?.outcome).toBe("wrong_password_or_tampered");
  });

  test("the restore route accepts a multi-megabyte upload stream — no Server-Action-style body cap applies", async () => {
    // A single ~3MB blob comfortably exceeds Next.js's default Server Action
    // body-size limit (1MB) — if this route were, or went through, a
    // buffered Server Action, this would be rejected before ever reaching
    // `restore()`. It succeeding proves the route reads `request.body` as a
    // genuine stream straight into U5's `restore()`.
    currentUser = ADMIN;
    const { writeFileSync } = await import("node:fs");
    const { randomBytes, randomUUID } = await import("node:crypto");
    const { activeStorageRoot } = await import("@/src/storage");
    const largeBlob = randomBytes(3 * 1024 * 1024);
    writeFileSync(join(activeStorageRoot(), `${randomUUID()}.bin`), largeBlob);

    const bundle = await buildValidBundle();
    expect(bundle.byteLength).toBeGreaterThan(3 * 1024 * 1024);

    currentUser = ADMIN;
    const res = await restorePost(
      restoreRequest({ password: PASSWORD, body: Readable.from([bundle]) }),
    );
    const json = (await res.json()) as { outcome: string; message: string };

    expect(res.status).toBe(200);
    expect(json.outcome).toBe("ok");
  });

  test("admin export accepts a form-encoded password (U7's real <form> submit)", async () => {
    currentUser = ADMIN;
    const res = await exportPost(exportFormRequest(PASSWORD));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const rows = await auditRowsFor("export");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("success");
  });

  test("restore refuses with 400 when no password header is supplied", async () => {
    currentUser = ADMIN;
    const res = await restorePost(
      restoreRequest({ body: Readable.from([Buffer.alloc(0)]) }),
    );
    expect(res.status).toBe(400);
  });
});
