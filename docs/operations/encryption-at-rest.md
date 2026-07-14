# Encryption at rest

MagStacker holds sensitive inventory — serial numbers, and (with document
attachments) receipts, warranties, and ATF forms. This page covers the two
layers MagStacker uses to keep that data safe when it's not sitting in a live,
authenticated session, and draws a clear line around what each layer does and
doesn't defend against.

The two layers:

- **Encrypted backups** — an admin-run, password-encrypted export of the whole
  instance (database + document blobs), made from the **Admin → Backup**
  screen. This is application-level: MagStacker does the encrypting.
- **Encrypted host volumes** — the disk(s) holding Postgres's data and the
  document upload directory (`UPLOAD_DIR`) are encrypted at the storage layer.
  This is **host-level, and it is your responsibility, not the app's.**
  MagStacker cannot encrypt the disk it's running on; nothing in the app can
  reach below the filesystem it's handed.

Both matter, and they cover different threats — see the [threat-coverage
matrix](#threat-coverage-matrix) below.

## Threat-coverage matrix

| Threat | Scenario | Covered by | Not covered by |
| --- | --- | --- | --- |
| **Seized or stolen disk** | A drive is taken from a powered-off or decommissioned box — theft, hardware disposal, or state seizure. | Encrypted host volume (LUKS or an encrypted cloud volume) | Encrypted backups don't help here — they protect a bundle in transit or at rest *off*-box, not the live disk itself. |
| **Leaked or exfiltrated backup bundle** | A downloaded backup file ends up somewhere it shouldn't — emailed, left on a laptop, uploaded to the wrong place. | Encrypted backup (password-derived key, authenticated encryption; see the no-recovery caveat below) | An encrypted host volume doesn't help here — once the bundle leaves the box, disk encryption is irrelevant to it. |
| **Compromised running host** | An attacker gets code execution or root on the live, running server while it's up and the disk is unlocked. | **Neither layer.** Explicitly out of scope. | Both an unlocked encrypted volume and a decrypted-in-memory backup password are available to a live attacker with host access; disk encryption and backup encryption both assume an *offline* or *exfiltrated* artifact, not a compromised live process. |

If you need to defend against a compromised running host specifically, that's
a different problem — hardening the host OS, minimizing attack surface,
network segmentation, and so on — and it's out of scope for this page. (For
what it's worth: this is also why MagStacker doesn't encrypt individual
database columns. An app-held key on a compromised host wouldn't meaningfully
help this threat, and it would break the server-side querying — serial-number
lookup and dedup — the product depends on.)

## Host responsibility: encrypting the volumes

This is a **host-level task you own** — MagStacker ships a deploy posture
that makes it a low-friction path, but it does not and cannot perform the
encryption itself. There are two volumes to place on encrypted storage, both
defined in `docker-compose.yml`:

- `magstacker-pgdata` — the Postgres data directory (all inventory, users,
  grants, and firearm records).
- `magstacker-uploads` — the `UPLOAD_DIR` mount (every document blob:
  receipts, warranties, ATF forms).

Docker's default `local` volume driver stores named volumes under
`/var/lib/docker/volumes/` on the host. That means the simplest way to
encrypt both at once is to encrypt the storage backing Docker's data root.
If you want to encrypt only these two volumes (leaving the rest of
`/var/lib/docker` alone), point them at a dedicated encrypted mount instead.
Both approaches are below.

> **Transient restore data lives here too.** A force-replace restore (see
> [Backups and the no-recovery caveat](#backups-and-the-no-recovery-caveat))
> briefly writes a plaintext snapshot of the outgoing database into a temp
> schema inside Postgres's data directory, and moves the outgoing
> `UPLOAD_DIR` contents aside on the same upload volume, before wiping and
> re-applying. Both live on the volumes covered by the guidance below, so
> encrypting `magstacker-pgdata` and `magstacker-uploads` also covers that
> transient window — there's nothing extra to configure for it.

### Option A — encrypt the whole Docker data root (simplest)

Do this at OS-install time, or by relocating Docker's data root onto an
already-encrypted disk. Because every named volume lives under
`/var/lib/docker/volumes/`, this transparently covers `magstacker-pgdata` and
`magstacker-uploads` (and any future volumes) with no compose changes.

**Self-hosted, with LUKS (Linux):**

1. Identify the disk or partition you'll dedicate to Docker (e.g. `/dev/sdb1`)
   and encrypt it:

   ```bash
   sudo cryptsetup luksFormat /dev/sdb1
   sudo cryptsetup open /dev/sdb1 docker_data
   sudo mkfs.ext4 /dev/mapper/docker_data
   ```

2. Mount it where Docker expects its data root:

   ```bash
   sudo mkdir -p /var/lib/docker
   sudo mount /dev/mapper/docker_data /var/lib/docker
   ```

   (If Docker was already initialized on this host, stop it first, move the
   existing `/var/lib/docker` contents onto the new encrypted filesystem,
   then remount.)

3. Add the mapping to `/etc/crypttab` so the volume can be unlocked on boot,
   and the mount to `/etc/fstab`. LUKS needs a passphrase or keyfile supplied
   at unlock time — decide up front whether that's a manual passphrase entry
   at boot (safest, but means the box doesn't come back up unattended after
   a power cycle) or a keyfile (more automated, but the keyfile itself must
   not live unencrypted next to the volume it unlocks — keep it on separate
   protected storage, e.g. a TPM-backed unlock or a secrets manager your boot
   process can reach).
4. `docker compose up -d` as normal — Docker now writes `magstacker-pgdata`
   and `magstacker-uploads` onto the encrypted filesystem without any compose
   changes.

**Cloud, with an encrypted volume:**

The exact steps vary by provider, but the shape is the same everywhere:

1. Create (or attach) a block volume with encryption enabled at creation —
   e.g. AWS EBS `--encrypted` (or turn on the account-level "always encrypt
   new EBS volumes" default), a GCP persistent disk (encrypted by default, or
   with a customer-managed key for stricter control), an Azure managed disk
   (server-side encryption is on by default; add a customer-managed key if
   you need to hold your own key), or your provider's equivalent.
2. Attach it to the instance and mount it at the path that will back Docker's
   data root (or relocate Docker's `data-root` to it via
   `/etc/docker/daemon.json`: `{ "data-root": "/mnt/encrypted-docker" }`,
   then restart the Docker daemon).
3. `docker compose up -d` as normal.

### Option B — encrypt just the MagStacker volumes (targeted)

If you'd rather not touch Docker's whole data root, mount an encrypted
filesystem at a dedicated path and repoint only `magstacker-pgdata` and
`magstacker-uploads` at it using compose's bind-style `driver_opts`. Set up
the encrypted mount the same way as Option A (LUKS steps 1–3, or an attached
encrypted cloud volume), mounted at, say, `/mnt/magstacker-encrypted`, then
override the two volumes:

```yaml
# docker-compose.override.yml
volumes:
  magstacker-pgdata:
    driver_opts:
      type: none
      o: bind
      device: /mnt/magstacker-encrypted/pgdata
  magstacker-uploads:
    driver_opts:
      type: none
      o: bind
      device: /mnt/magstacker-encrypted/uploads
```

Create the two subdirectories (`pgdata`, `uploads`) on the encrypted mount
before first `up` so Docker has somewhere to bind to. `docker compose up -d`
then reads the override automatically alongside `docker-compose.yml`.

## Backups and the no-recovery caveat

The other layer — encrypted backups — is covered from the **Admin → Backup**
screen in the app: an admin sets a password, and MagStacker exports the
entire instance (database plus every document blob) as a single
authenticated-encrypted file, downloaded on demand. Restoring reverses that:
upload the bundle, enter the password, and (on an empty instance) it applies
cleanly, or (on a non-empty instance) a guarded force-replace path snapshots,
wipes, and re-applies with automatic rollback on failure.

**There is no password recovery.** The backup password derives the
encryption key directly — MagStacker never stores it, and there is no
"forgot password" path for a backup file. If you lose the password to a
backup, that backup is permanently unreadable; the export screen warns you
of this before you commit. Keep the password somewhere durable (a password
manager, not a sticky note on the server) and separate from the bundle
itself — storing them together defeats the point of encrypting the bundle.

## See also

- [`docs/deployment.md`](../deployment.md) — first-run setup, secrets,
  TLS/reverse-proxy configuration, and the volumes defined in
  `docker-compose.yml`.
- [`README.md`](../../README.md) — quick-start and the plain `pg_dump`
  backup command for local tooling.
