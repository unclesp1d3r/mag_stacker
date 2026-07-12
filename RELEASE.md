# Releasing MagStacker

Releases are cut by pushing a semver **git tag** (`vX.Y.Z`). That's the only trigger you need: the [`Docker Release`](.github/workflows/docker-release.yml) workflow builds the production image from the `Dockerfile` and publishes it to the GitHub Container Registry (GHCR). No extra secrets — it authenticates with the built-in `GITHUB_TOKEN`.

- **Image:** `ghcr.io/unclesp1d3r/mag_stacker`
- **The git tag drives the published image version** — the workflow reads the tag, not `package.json`. Even so, bump `package.json`'s `version` to match the release as part of cutting it (see [Before you tag](#before-you-tag)) so the repo metadata and the released tag never drift apart.

## Versioning

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes, no behavior change for users.
- **MINOR** — new, backward-compatible functionality.
- **MAJOR** — breaking changes (schema/migration, config, or API changes that need operator action).

Because MagStacker is self-hosted and ships database migrations, call out any migration or required `.env` change prominently in the release notes so deployers know what running `docker compose pull && up -d` will do.

## Before you tag

1. Be on `main`, up to date, with a clean working tree.

2. The changes you're releasing are already merged to `main` — the workflow builds from the tagged commit, so tag a commit that's on `main`.

3. Bump the version in `package.json` to the release version and commit it to `main` first, so the tag lands on the commit that already carries the new version:

   ```bash
   # set "version": "X.Y.Z" in package.json, then:
   git commit -s -am "chore: release vX.Y.Z"
   git push origin main
   ```

4. `just ci-check` is green on that commit (lint, format, typecheck, pre-commit, unit + integration tests, and Playwright E2E).

Optional but recommended for supply-chain records: generate an SBOM for the tree you're about to ship (the release image also gets an SBOM attestation automatically, see below):

```bash
just sbom          # writes sbom.cdx.json (CycloneDX) via syft
```

## Cut the release

Pick one of the two flows. Both create the `vX.Y.Z` tag that triggers the build.

### Option A — GitHub Release (recommended)

Creating a GitHub Release creates the tag and gives you published, editable release notes in one step:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

Review the auto-generated notes, add the migration/breaking-change callouts, and publish. `--generate-notes` drafts from merged PRs; edit before publishing.

### Option B — Signed git tag

If you'd rather tag from the CLI (GPG-signed, matching the repo's commit-signing policy):

```bash
git tag -s vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

Once the image publishes, the workflow's `github-release` job creates the GitHub Release for the tag automatically (with `--generate-notes`), so both options end with a published Release. It only fills the gap — if a Release for the tag already exists (Option A), it does nothing. Review the auto-generated notes afterward and add the migration/breaking-change callouts.

## What the workflow publishes

On a `vX.Y.Z` tag the build pushes, for both `linux/amd64` and `linux/arm64`:

| Tag pushed | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `X.Y.Z`    | the exact release                                                     |
| `X.Y`      | latest patch in that minor line                                       |
| `X`        | latest minor/patch in that major line                                 |
| `latest`   | the newest semver release (only ever moved by a tag, never by `main`) |

Each image also gets a **SLSA build-provenance** attestation and an **SBOM** attestation. Pushes to `main` publish a rolling **`edge`** image instead (no `latest`); `edge` tracks the tip of `main` for testing, not for stable deploys.

## Verify

1. Watch the run: **Actions → Docker Release** (or `gh run watch`). It should finish green and show the pushed tags.

2. Confirm the tags landed on GHCR and pull the new release:

   ```bash
   docker pull ghcr.io/unclesp1d3r/mag_stacker:X.Y.Z
   ```

3. In a throwaway directory, run the deployer [Quick start](README.md#quick-start) with `MAGSTACKER_VERSION=X.Y.Z` in `.env` and confirm the stack comes up and migrations apply cleanly.

## After the release

Deployers upgrade by pinning the new version and pulling:

```bash
# in their .env
MAGSTACKER_VERSION=X.Y.Z

docker compose pull
docker compose up -d          # the migrate service applies new migrations first
```

Leaving `MAGSTACKER_VERSION` unset tracks `latest`, so operators who follow `latest` pick the release up on their next `pull`.

## Rolling back

Images are immutable per version, so rolling back is pinning the previous tag:

```bash
# in their .env
MAGSTACKER_VERSION=<previous-version>

docker compose pull
docker compose up -d
```

Note the caveat that applies to any app with migrations: a rollback restores the **app**, but forward migrations are not automatically reversed. If a release included a destructive migration, restore the database from a backup (see [Backups](README.md#backups)) rather than only downgrading the image.
