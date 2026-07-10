import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { generateKey } from "./keys";
import type { StorageKey, StorageService } from "./service";

/** Thrown when a storage key resolves outside the configured upload root. */
export class PathTraversalError extends Error {
  constructor(key: string) {
    super(`storage key resolves outside the upload root: ${key}`);
    this.name = "PathTraversalError";
  }
}

/**
 * `StorageService` backed by the local filesystem, rooted at `uploadDir`
 * (KTD1, KTD7). Every key is resolved under the root; a key that would
 * resolve outside it (a path-traversal attempt) is rejected rather than
 * silently clamped, so a bug upstream fails loudly instead of writing
 * somewhere unexpected.
 */
export class LocalFilesystemAdapter implements StorageService {
  private readonly root: string;

  constructor(uploadDir: string) {
    this.root = resolve(uploadDir);
  }

  /** Resolves `key` under the root, rejecting any path that escapes it. */
  private resolvePath(key: StorageKey): string {
    const resolved = resolve(this.root, key);
    const rootPrefix = this.root.endsWith(sep)
      ? this.root
      : `${this.root}${sep}`;
    const isRootItself = resolved === this.root;
    const isInsideRoot = resolved.startsWith(rootPrefix);
    if (!isRootItself && !isInsideRoot) {
      throw new PathTraversalError(key);
    }
    return resolved;
  }

  async save(key: StorageKey, bytes: Uint8Array): Promise<void> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async read(key: StorageKey): Promise<Buffer> {
    const path = this.resolvePath(key);
    return readFile(path);
  }

  /** Idempotent: deleting a key that does not exist is a no-op, not an error. */
  async delete(key: StorageKey): Promise<void> {
    const path = this.resolvePath(key);
    await rm(path, { force: true });
  }

  generateKey(ext: string): StorageKey {
    return generateKey(ext);
  }
}
