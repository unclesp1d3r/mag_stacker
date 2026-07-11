import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectRejects } from "@/src/test-support/assertions";
import { requireUploadDir } from "../env";
import { deriveKey, generateKey } from "../keys";
import {
  LocalFilesystemAdapter,
  PathTraversalError,
} from "../local-fs-adapter";

describe("LocalFilesystemAdapter", () => {
  let scratchDir: string;
  let adapter: LocalFilesystemAdapter;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "magstacker-storage-"));
    adapter = new LocalFilesystemAdapter(scratchDir);
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  test("save then read round-trips bytes exactly", async () => {
    const key = "photos/example.jpg";
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 0]);

    await adapter.save(key, bytes);
    const readBack = await adapter.read(key);

    expect(new Uint8Array(readBack)).toEqual(bytes);
  });

  test("delete removes the file", async () => {
    const key = "to-delete.bin";
    await adapter.save(key, new Uint8Array([9, 9, 9]));

    await adapter.delete(key);

    await expectRejects(() => adapter.read(key));
  });

  test("delete is idempotent on a missing key", async () => {
    await expect(adapter.delete("never-existed.bin")).resolves.toBeUndefined();
    await expect(adapter.delete("never-existed.bin")).resolves.toBeUndefined();
  });

  test("generateKey produces unique, non-guessable keys", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateKey("jpg")));

    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
      );
    }
  });

  test("deriveKey yields deterministic thumb/preview keys from a base key", () => {
    const base = generateKey("jpg");

    expect(deriveKey(base, "thumb")).toBe(`${base}.thumb`);
    expect(deriveKey(base, "preview")).toBe(`${base}.preview`);
    // Deterministic: same base + variant always yields the same derivative key.
    expect(deriveKey(base, "thumb")).toBe(deriveKey(base, "thumb"));
  });

  test("a traversal-crafted key never escapes the upload root", async () => {
    const traversalKey = "../../../../etc/passwd";

    await expectRejects(() => adapter.save(traversalKey, new Uint8Array([1])));

    // The guard rejects rather than silently clamping; assert the rejected
    // save left nothing behind in the scratch root either. (Asserting
    // absence outside the root isn't portable — `..` resolution depends on
    // OS temp-dir depth — so `expectRejects` above carries the real proof.)
    expect(readdirSync(scratchDir)).toEqual([]);
  });

  test("a traversal-crafted key raises PathTraversalError", async () => {
    let caught: unknown;
    try {
      await adapter.read("../outside.txt");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PathTraversalError);
  });
});

describe("requireUploadDir", () => {
  const original = process.env.UPLOAD_DIR;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.UPLOAD_DIR;
    } else {
      process.env.UPLOAD_DIR = original;
    }
  });

  test("throws a clear error when UPLOAD_DIR is unset", () => {
    delete process.env.UPLOAD_DIR;
    expect(() => requireUploadDir()).toThrow(/UPLOAD_DIR is not set/);
  });

  test("throws when UPLOAD_DIR is set to an empty string", () => {
    process.env.UPLOAD_DIR = "   ";
    expect(() => requireUploadDir()).toThrow(/UPLOAD_DIR is not set/);
  });

  test("returns the value when set", () => {
    process.env.UPLOAD_DIR = "/data/uploads";
    expect(requireUploadDir()).toBe("/data/uploads");
  });
});
