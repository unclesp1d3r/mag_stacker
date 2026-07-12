/**
 * Backup bundle manifest (plan Unit U2, R2/R4).
 *
 * The manifest is the bundle's first tar entry (`manifest.json`) — it stamps
 * the bundle with the compatibility key restore checks before touching any
 * data (R8, KTD4), plus informational version/timestamp fields and the
 * row/blob counts `bundle.ts` uses to bound untrusted bundle contents during
 * restore (KTD11).
 */

import packageJson from "../../package.json";
import migrationsJournal from "../db/migrations/meta/_journal.json";

/**
 * Compatibility key restore checks against the running instance's own
 * `BACKUP_FORMAT_VERSION` (R8, KTD4). Bump this **by hand**, and only when a
 * schema change would make an older bundle's NDJSON import fail or silently
 * drop data against the new schema (a dropped/renamed column, a new
 * NOT-NULL column without a default, a type change). Routine additive
 * migrations do NOT bump this — the migration tag advances on nearly every
 * feature PR, so gating on it directly would refuse an operator restoring
 * their own backup onto the same instance after an ordinary release. Owned
 * here (U2) since U3 (db export/import) and U5 (restore service) both
 * consume it — import from here rather than redefining it.
 */
export const BACKUP_FORMAT_VERSION = 1;

interface MigrationJournalEntry {
  readonly tag: string;
}

interface MigrationJournal {
  readonly entries: readonly MigrationJournalEntry[];
}

const journal = migrationsJournal as MigrationJournal;

/** Row/blob counts a bundle declares, used by `bundle.ts` to bound untrusted contents during restore (KTD11). */
export interface BackupManifestCounts {
  /** Total database rows across every exported table. */
  readonly rows: number;
  /** Total document blob entries. */
  readonly blobs: number;
  /** Sum of every blob's byte size. */
  readonly totalBlobBytes: number;
}

/** The bundle manifest — always the first entry in the tar (`manifest.json`). */
export interface BackupManifest {
  readonly backupFormatVersion: number;
  readonly appVersion: string;
  readonly migrationTag: string;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
  readonly counts: BackupManifestCounts;
}

/** Thrown when a manifest buffer/string is not well-formed JSON or fails shape validation. Manifests are untrusted input on restore (KTD11). */
export class InvalidManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidManifestError";
  }
}

/** The running instance's app version, read from `package.json` (R4). */
export function currentAppVersion(): string {
  return packageJson.version;
}

/** The latest applied migration tag, read from the Drizzle migration journal (R4, informational — not the compatibility key, see {@link BACKUP_FORMAT_VERSION}). */
export function latestMigrationTag(): string {
  const entries = journal.entries;
  if (entries.length === 0) {
    throw new Error(
      "migration journal has no entries: cannot determine the latest migration tag",
    );
  }
  const last = entries[entries.length - 1];
  if (!last) {
    throw new Error("migration journal entry is unexpectedly undefined");
  }
  return last.tag;
}

export interface BuildManifestInput {
  readonly counts: BackupManifestCounts;
  /** Defaults to now; override in tests for deterministic timestamps. */
  readonly createdAt?: Date;
}

/** Builds a manifest stamped with the running instance's versions (R4). */
export function buildManifest(input: BuildManifestInput): BackupManifest {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    appVersion: currentAppVersion(),
    migrationTag: latestMigrationTag(),
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    counts: input.counts,
  };
}

/** Serializes a manifest to its `manifest.json` tar-entry bytes. */
export function serializeManifest(manifest: BackupManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), "utf8");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parses and validates a manifest from raw `manifest.json` bytes. The
 * manifest is untrusted input on restore (KTD11: "a bundle is
 * attacker-influenceable") — every field is checked before being trusted by
 * the rest of the restore pipeline.
 */
export function parseManifest(raw: Buffer | string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch (err) {
    throw new InvalidManifestError(
      `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidManifestError("manifest.json must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (!isNonNegativeInteger(obj.backupFormatVersion)) {
    throw new InvalidManifestError(
      "manifest.backupFormatVersion must be a non-negative integer",
    );
  }
  if (!isNonEmptyString(obj.appVersion)) {
    throw new InvalidManifestError(
      "manifest.appVersion must be a non-empty string",
    );
  }
  if (!isNonEmptyString(obj.migrationTag)) {
    throw new InvalidManifestError(
      "manifest.migrationTag must be a non-empty string",
    );
  }
  if (
    !isNonEmptyString(obj.createdAt) ||
    Number.isNaN(Date.parse(obj.createdAt))
  ) {
    throw new InvalidManifestError(
      "manifest.createdAt must be a valid ISO 8601 timestamp string",
    );
  }

  const counts = obj.counts;
  if (typeof counts !== "object" || counts === null) {
    throw new InvalidManifestError("manifest.counts must be an object");
  }
  const countsObj = counts as Record<string, unknown>;
  if (!isNonNegativeInteger(countsObj.rows)) {
    throw new InvalidManifestError(
      "manifest.counts.rows must be a non-negative integer",
    );
  }
  if (!isNonNegativeInteger(countsObj.blobs)) {
    throw new InvalidManifestError(
      "manifest.counts.blobs must be a non-negative integer",
    );
  }
  if (!isNonNegativeInteger(countsObj.totalBlobBytes)) {
    throw new InvalidManifestError(
      "manifest.counts.totalBlobBytes must be a non-negative integer",
    );
  }

  return {
    backupFormatVersion: obj.backupFormatVersion,
    appVersion: obj.appVersion,
    migrationTag: obj.migrationTag,
    createdAt: obj.createdAt,
    counts: {
      rows: countsObj.rows,
      blobs: countsObj.blobs,
      totalBlobBytes: countsObj.totalBlobBytes,
    },
  };
}
