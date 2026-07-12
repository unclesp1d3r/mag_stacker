---
title: Encryption at Rest and Encrypted Backups - Plan
type: feat
date: 2026-07-12
topic: encryption-at-rest-backups
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Encryption at Rest and Encrypted Backups - Plan

## Goal Capsule

- **Objective:** Give MagStacker a coherent data-at-rest story with two complementary layers — an admin-run, password-encrypted whole-instance backup (for the leaked-bundle threat), and an encrypted-host-volume deploy posture delivered through shipped compose config plus operator documentation (for the seized/stolen-disk threat). Keep the live database fully queryable throughout.
- **Product authority:** GitHub issue #67 (encryption-at-rest spike — this brainstorm resolves its direction); owner confirmed the decisions here. Relates to #12 (documents), whose blobs the backup bundles.
- **Open blockers:** None. Bundle format and version-compatibility policy are deferred to planning.

## Product Contract

### Summary

Add an admin-only, on-demand **encrypted backup**: the operator exports the entire instance (full database plus every document blob) as one password-encrypted file they download and keep off-box, and restores it onto a fresh or deliberately-wiped instance. Pair it with an **encrypted-volume deploy posture** — shipped Docker Compose config (secrets, hardening, encrypted-volume-ready mounts) plus operator documentation for running the data on an encrypted host disk. Live column encryption is deliberately excluded so the database stays queryable.

### Problem Frame

The data MagStacker holds is sensitive — owner-scoped inventory including serial numbers, and, with #12, attached receipts, warranties, and ATF forms. STRATEGY frames the product as privacy-first and self-hosted: "owning and running it yourself is what makes a sensitive inventory safe to keep at all." That promise breaks the moment data leaves the trusted box in the clear. Three at-rest threats are in scope, and they need different defenses:

- **A backup or database dump that leaves the running box** (emailed, left on a laptop, uploaded) — the common, high-value leak. Defended by the encrypted backup.
- **A seized or stolen disk** — a drive taken from a powered-off or decommissioned box, including state seizure. Not the owner's top personal worry, but a concrete **trust signal** for the audience. Defended by an encrypted host volume.
- **Another user on the instance** — already handled by owner-scoped authorization; encryption-at-rest does not change it, and it is named here only to rule it out.

The "compromised running host" threat is explicitly not prioritized, which is why live column/`pgcrypto` encryption is rejected: with an app-held key it barely helps that case, and it breaks the server-side querying (serial-number lookup and dedup) the product depends on. The encrypted backup also doubles as a self-host escape hatch — "take your data and leave" — which reinforces the privacy-first identity rather than just satisfying disaster recovery.

### Key Decisions

- **Threat-driven layering, not blanket encryption.** Two mechanisms for two threats: encrypted backups for leaked bundles, encrypted host volumes for seized disks. No single "encrypt everything" control.
- **Live column/`pgcrypto` encryption is rejected.** It breaks indexing/filtering on the fields that need to stay queryable and, with an app-held key, does not meaningfully defend the un-prioritized compromised-host threat.
- **Whole-instance operator DR, not per-user export.** One backup is the entire instance; per-user portability is out of scope.
- **On-demand download, no server-side backup storage.** The operator produces a bundle on demand and keeps it wherever they choose; the app never retains backups, so there is no backup store to secure or expire.
- **Restore is safe by default, destructive only on purpose.** Refuse-unless-empty is the default; a force-replace path exists behind a type-to-confirm guard.
- **No password recovery.** A lost backup password makes that backup unrecoverable, by design; the UI says so at export time.
- **Wrap vetted crypto, never hand-roll.** Encryption uses Argon2id (OWASP parameters) plus authenticated streaming encryption from a vetted library (libsodium `secretstream` / XChaCha20-Poly1305) — the exact pairing Home Assistant adopted and had independently audited by Trail of Bits. `openssl enc` and any custom cipher construction are out.
- **Native backup, but thin.** An in-app encrypted whole-instance backup is the minority pattern among self-hosted apps — most with a database plus a blob store (Immich, Paperless-ngx, Gitea) document external tooling instead. It is the right call for this product's "one password, one file, restorable by a non-expert" shape, but it must be a thin wrapper over vetted primitives that borrows proven safety patterns (snapshot-and-rollback on restore, version-gated bundles) rather than new cryptographic or backup engineering.
- **Disk encryption stays the operator's job.** The app ships compose config and documentation that make the encrypted-volume path turnkey, but it does not (and cannot) encrypt the host disk itself.

### Requirements

**Encrypted backup — export**

- R1. An admin can export the entire instance as a single encrypted backup file, downloaded on demand.
- R2. The export bundles the full database (all users, grants, and inventory including firearm documents) and every document blob from the upload store; ephemeral state such as sessions and rate-limit counters is excluded so a restore is clean.
- R3. The operator supplies a password at export time; the bundle is encrypted with a key derived from that password.
- R4. The bundle records the app/schema version it was produced from.

**Encrypted backup — restore**

- R5. An admin can restore an instance from a backup file by uploading it and entering its password.
- R6. Restore defaults to refuse-unless-empty: when the instance already holds inventory data, a plain restore is refused with a clear message.
- R7. Restore offers an explicit force-replace path, behind a type-to-confirm guard, that snapshots the existing data, wipes it, applies the bundle, and automatically rolls back to the snapshot if the restore fails (Immich's safety pattern).
- R8. Restore refuses a bundle whose recorded version is incompatible with the running instance.
- R9. Restore verifies the bundle's integrity by authenticated decryption and refuses a wrong password or a tampered/corrupt bundle before changing any data.
- R10. A successful restore yields a functionally identical instance — users, grants, inventory, and documents intact.

**Cryptography and data handling**

- R11. Encryption uses a strong password-based KDF and authenticated, tamper-evident encryption from a vetted library; plaintext exists only inside the running app.
- R12. There is no password recovery — a lost password makes the backup unrecoverable — and the export UI states this before the operator commits.
- R13. Export and restore stream the bundle so that a large document blob store does not exhaust memory.

**Access and auditing**

- R14. Only admins can export or restore; non-admin users cannot reach either action.
- R15. Export and restore are recorded as operator events (actor, timestamp, outcome), given how significant a force-replace restore is.

**Deploy hardening — shipped config**

- R16. The shipped Docker Compose supplies the database password (and any key material) through Docker secrets rather than environment variables.
- R17. The compose structures the Postgres data volume and the document upload volume so that placing them on an encrypted host disk is the documented, low-friction path.
- R18. The compose applies baseline container hardening (read-only root filesystem with explicit writable volumes, dropped capabilities, no-new-privileges) where compatible.

**Deploy hardening — operator documentation**

- R19. Operator documentation explains how to run the data and upload volumes on an encrypted host volume (LUKS or an encrypted cloud volume), stated plainly as a host responsibility the app cannot perform.
- R20. The documentation states which threat each layer covers — encrypted volume for a seized/stolen disk, encrypted backup for a leaked bundle — and which it does not (a compromised running host).

### Key Flows

- F1. Export a backup
  - **Trigger:** An admin opens the backup screen and chooses Export.
  - **Steps:** Set and confirm a password (with the no-recovery warning); the app streams the full database plus all document blobs into one authenticated-encrypted bundle stamped with the app version; the browser downloads the file.
  - **Covered by:** R1, R2, R3, R4, R11, R12, R13, R14, R15.
- F2. Restore into a fresh instance
  - **Trigger:** An admin on an empty instance uploads a bundle and enters its password.
  - **Steps:** Authenticated-decrypt and integrity-check the bundle; verify version compatibility; confirm the instance is empty; apply the database rows and write the blobs; report success.
  - **Covered by:** R5, R6, R8, R9, R10, R11, R13, R14, R15.
- F3. Restore into a non-empty instance
  - **Trigger:** An admin uploads a bundle on an instance that already holds data.
  - **Steps:** The default restore is refused; the operator may take the force-replace path, pass the type-to-confirm guard, and the app wipes existing data and applies the bundle.
  - **Covered by:** R6, R7, R9, R14, R15.

### Acceptance Examples

- AE1. Refuse-unless-empty. **Covers R6.** Given an instance with inventory data, when an admin runs a plain restore, it is refused with a message that the instance is not empty and no data changes.
- AE2. Force replace. **Covers R7.** Given the same non-empty instance, when the admin takes the force-replace path and types the confirmation phrase, existing data is wiped and the bundle is applied.
- AE3. Wrong password or tampered bundle. **Covers R9.** Given a bundle with a wrong password or altered bytes, restore fails integrity verification and changes no data.
- AE4. Version mismatch. **Covers R8.** Given a bundle stamped with an incompatible version, restore refuses before applying anything.
- AE5. Round-trip fidelity. **Covers R10.** Given a bundle exported from instance A, when it is restored onto a fresh instance B, B holds the same users, grants, inventory, and documents as A.

### Scope Boundaries

- No live column or `pgcrypto` encryption — the live database stays fully queryable.
- No per-user data export; whole-instance operator DR only.
- No scheduled or automated backups, and no server-side backup storage or retention — export is on-demand download only.
- No migrate-on-restore across incompatible versions beyond the compatibility guard (restore refuses rather than transforming).
- The app does not encrypt the host disk; that stays an operator responsibility guided by documentation.
- No key escrow or password recovery.
- The #12 documents feature is unchanged — its blobs are simply included in the bundle.

### Dependencies / Assumptions

- Gated by the existing Better Auth admin role.
- Depends on the document blob store (`UPLOAD_DIR`, from #12) existing so blobs can be bundled.
- Assumption — crypto primitives: Argon2id KDF (OWASP-recommended parameters) plus libsodium `secretstream` (XChaCha20-Poly1305) for the authenticated, streamed archive — the Home Assistant / OWASP best-practice pairing — with exact parameters and the library binding finalized in planning. The Product Contract fixes the properties (password-based, authenticated, streaming, vetted-library), and planning may substitute an equivalent vetted format (e.g., an `age` binding) if it fits the stack more cleanly.
- Assumption — the bundle is a single self-contained file the operator stores off-box; its safety at rest comes from its own encryption, independent of where it lands.
- Resolves the direction for #67; volume encryption is delivered as compose config plus docs, not app code.

### Outstanding Questions

Deferred to planning:

- Exact bundle format — database dump versus row-level export, archive shape, and how blobs are packed alongside the rows.
- Version-compatibility policy — strict-equal versus a compatible range, and whether forward-migration on restore is ever allowed.
- Whether restore runs fully in-app or leans on a CLI/entrypoint assist for very large instances where an in-app request would be impractical.

### Sources / Research

- Issue #67 — the encryption-at-rest spike whose direction this brainstorm resolves.
- Issue #12 — firearm documents; its ATF/PII blobs are the data that raised the stakes and are bundled by the backup.
- `STRATEGY.md` — the self-hosted, privacy-first identity; the backup doubles as a "take your data and leave" escape hatch.
- Repo state (verified): Postgres + Drizzle, local-volume blob storage under `UPLOAD_DIR`, Better Auth admin plugin, `docker-compose.yml` + `Dockerfile`; no existing backup, export, or encryption code.
- Prior-art scan (web, 2026): native encrypted whole-instance backup is the minority pattern among self-hosted apps (Home Assistant, Standard Notes); DB+blob apps (Immich, Paperless-ngx, Gitea, PhotoPrism, Firefly III) mostly document external tooling (`pg_dump`, `restic`, filesystem copy). Best-practice crypto is Argon2id + libsodium `secretstream` (Home Assistant's Trail-of-Bits-audited SecureTar v3). Restore-safety patterns worth copying: snapshot-before-restore + auto-rollback (Immich) and version-gated bundles that refuse cross-version restore (Paperless-ngx). References: OWASP Password Storage Cheat Sheet; libsodium `secretstream` docs; `age` (C2SP) spec; Home Assistant backup-encryption blog (2026); Immich and Paperless-ngx backup/restore docs; Docker secrets guidance and CIS container-hardening benchmark.
