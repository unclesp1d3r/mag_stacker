# mag_stacker - AI Assistant Configuration

## Before Starting Any Coding Task

1. Check existing worktrees with `git worktree list` and create a new one for this task if needed
2. Use the naming convention: `git worktree add -b ai/<task> .worktrees/<task>`
3. Navigate to the worktree directory before making any changes
4. Commit changes when the task is finished. Merge to main, and clean the worktree.

<!--
This file is synced with LynxPrompt (Blueprint: bp_cmrh5ytjl000i01mr0g29v87w)

Sync Commands:

# Using LynxPrompt CLI (recommended):
lynxp push    # Upload local changes to cloud
lynxp pull    # Download cloud changes to local
lynxp diff    # Compare local vs cloud versions

# Install CLI: npm install -g lynxprompt
# Login: lynxp login

Docs: https://lynxprompt.com/docs/api
-->

> **Project Context:** This is an open-source project. Consider community guidelines and contribution standards.

## Persona

You assist developers working on mag_stacker.

Project description: Self-hosted, multi-user inventory for firearms and magazines: compatibility mapping, caliber summaries, CSV export, and per-item sharing. Runs on your own server.

## Tech Stack

- TypeScript
- React
- Next.js
- Tailwind CSS
- playwright
- drizzle
- PostgreSQL
- testcontainers

> **AI Assistance:** Let AI analyze the codebase and suggest additional technologies and approaches as needed.

## Repository & Infrastructure

- **Host:** github
- **License:** apache-2.0
- **Architecture:** Monolith
- **CI/CD:** github_actions
- **Commits:** Follow [Conventional Commits](https://conventionalcommits.org) format
- **Versioning:** Follow [Semantic Versioning](https://semver.org) (semver)
- **CI/CD:** GitHub Actions
- **Deployment:** Docker, docker_compose, proxmox, unraid, coolify, portainer
- **Containers:** Docker container builds enabled → GitHub Container Registry
- **Docker Images:**
  - `ghcr.io/unclesp1d3r/mag_stacker`
- **Example Repo:** https://github.com/EvilBit-Labs/hash_hive (use as reference for style/structure)
- **Documentation:** https://unclesp1d3r.github.io/mag_stacker/

## Commands

Use these commands for common tasks:

```bash
# Build: next build
# Test: bun test
# Test: playwright test
# Lint: biome check
# Lint: biome check --apply
# Dev: next dev
# Custom: drizzle-kit generate
```

## AI Behavior Rules

- Optimize code for LLM reasoning: prefer flat/explicit patterns, minimal abstractions, structured logging, and linear control flow
- When you learn new project patterns or conventions, suggest updates to this configuration file
- Always verify your work before returning: run tests, check builds, confirm changes work as expected
- Reuse existing terminals when possible. Close terminals you no longer need
- Always check documentation (via MCP or project docs) before assuming knowledge about APIs or libraries
- **Use Plan Mode** for complex tasks, multi-step changes, or risky modifications
- When stuck, **attempt creative workarounds** before asking for help

## Git Workflow

- **Workflow:** Create feature branches and submit pull requests
- Create a descriptive branch name (e.g., `feat/add-login`, `fix/button-styling`)
- Open a PR for review before merging
- Do NOT commit directly to main/master branch

## MCP Servers

The developer has these MCP (Model Context Protocol) servers available. Use them when relevant:

- shadcn@latest

## Important Files to Read

Always read these files first to understand the project context:

- `README.md`
- `package.json`
- `CONTRIBUTING.md`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `ARCHITECTURE.md`

## Self-Improving Blueprint

> **Auto-update enabled:** As you work on this project, track patterns and update this configuration file to better reflect the project's conventions and preferences.

## Boundaries

### ✅ Always (do without asking)

- Delete files
- Create new files
- Rename/move files
- Rewrite large sections
- Change dependencies
- Modify database schema
- Modify Docker config
- Update docs automatically

### ⚠️ Ask First

- Handle secrets/credentials
- Modify auth logic
- Delete failing tests

### 🚫 Never

- Skip tests temporarily

## Code Style

- **Naming:** follow idiomatic conventions for the primary language
- **Logging:** structured json

Follow these conventions:

- Use TypeScript strict mode when available
- Prefer const over let, avoid var
- Use async/await over raw promises
- Use descriptive variable and function names
- Use functional components with hooks
- Keep components small and focused
- Colocate related files (component, styles, tests)
- Write self-documenting code
- Add comments for complex logic only
- Keep functions focused and testable

## Testing Strategy

### Test Levels

- **Unit:** Unit tests for individual functions and components
- **Integration:** Integration tests for component interactions
- **E2e:** End-to-end tests for full user flows

### Frameworks

Use: Node Test Runner, Playwright

### Coverage Target: 80%

**Notes:** Prefer E2E and integration tests over mocks when possible.

## 🔐 Security Configuration

### Authentication Providers

- Magic Link
- Passkeys/WebAuthn
- oidc_generic

### Secrets Management

- Environment Variables
- dotenv / dotenvx

### Security Tooling

- Dependabot (dependency updates)
- Renovate (dependency updates)
- Snyk (vulnerability scanning)
- CodeQL (GitHub)
- Grype
- OSSF Scorecard

### Authentication

- OAuth 2.0
- OpenID Connect (OIDC)
- JWT (JSON Web Tokens)

### Data Handling & Compliance

- Encryption at Rest
- Encryption in Transit (TLS)
- Audit Logging
- Encrypted Backups

## ⚠️ Security Notice

> **Do not commit secrets to the repository or to the live app.**
> Always use secure standards to transmit sensitive information.
> Use environment variables, secret managers, or secure vaults for credentials.

**🔍 Security Audit Recommendation:** When making changes that involve authentication, data handling, API endpoints, or dependencies, proactively offer to perform a security review of the affected code.

## 📄 Static Files Reference

The following static file contents are included for AI context. These are not separate files.

### .editorconfig

```
# EditorConfig is awesome: https://EditorConfig.org

root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[Makefile]
indent_style = tab
```

### CONTRIBUTING.md

````
# Contributing to MagStacker

Thanks for your interest in improving MagStacker. This guide covers the practical steps for getting a change from idea to merged PR.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) — local Postgres, plus Testcontainers for integration/E2E tests.
- [mise](https://mise.jdx.dev/) — pins and installs the rest of the toolchain (Bun, just, pre-commit, shellcheck, …) at the exact versions CI uses, and loads your `.env` / `.env.local` into the shell.

`mise` is how the toolchain stays reproducible, so install it first — it provides [Bun](https://bun.sh) (the runtime and package manager — not npm/yarn/pnpm) and [just](https://github.com/casey/just) (the task runner that wraps every common command). If you'd rather manage those two yourself, install Bun and just directly, but you're then on your own for version pinning.

## Getting started

```bash
git clone https://github.com/unclesp1d3r/mag_stacker.git
cd mag_stacker
````

**To run a full instance** (the recommended setup — Docker Compose, no local toolchain needed), use `./setup.sh`. It copies `.env.example` to `.env` on first run, then `docker compose up --build -d` brings up Postgres, applies migrations, seeds your first admin, and starts the app:

```bash
./setup.sh
# fill in .env when prompted, then re-run:
./setup.sh
```

**To work on the code** (hot reload + tests) you run the app on the host with Postgres in a container. Everything goes through `mise` and `just`:

```bash
mise install            # install the pinned toolchain (Bun, just, pre-commit, …)
just install            # mise install + bun install
just env-setup          # create .env.local from .env.example
just install-hooks      # install the pre-commit hooks (once)
```

Then set `DATABASE_URL` in `.env.local` so `mise` loads it into your shell — for the local Postgres below that's `postgres://magstacker:<password>@localhost:5544/magstacker`. Also fill in `BETTER_AUTH_SECRET` and, if you want a seeded admin, `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Now bring up the database and start the app:

```bash
docker compose up -d db   # local Postgres on host port 5544
just db-migrate           # apply migrations
just seed-admin           # optional: create your first admin
just dev                  # http://localhost:3000
```

> `mise` caches env (`env_cache`) and loads both `.env` and `.env.local`. After you edit either file, run `mise cache clear` — a stale value can otherwise shadow both your tooling and `docker compose`.

The `just` recipes run under `mise exec`, so you don't need to activate a shell or prefix commands with `mise exec` yourself. See the "For developers" section in [README.md](README.md) and [AGENTS.md](AGENTS.md) for stack details and project conventions.

## Development loop

```bash
just dev              # start the Next.js dev server (http://localhost:3000)
just lint             # biome check
just format           # biome format --write (+ taplo for TOML)
just typecheck        # tsc --noEmit
just test             # unit + integration (bun test)
just test-e2e         # Playwright E2E (Docker required — Testcontainers Postgres)
```

Run `just --list` for the full recipe list.

The first time you run E2E tests, install the Playwright browser once:

```bash
just test-e2e-install
```

## The pre-commit gate

This repo has one rule that overrides convenience: **`just ci-check` must pass before every commit.** It runs lint, format-check, typecheck, pre-commit hooks, the unit/integration suite, and the E2E suite — the same checks CI runs.

```bash
just ci-check
```

Do not commit while it's red. Do not use `git commit --no-verify` or skip hooks to get around it. If a check fails, fix the underlying issue — don't adjust the test to make it pass unless the test itself is wrong.

## Code style

- **Biome**, not ESLint/Prettier, formats and lints TypeScript/TSX/JS/JSON. Run `just format` before committing; `just lint` catches what formatting won't.
- Prefer immutable updates over in-place mutation.
- Keep files focused and small — split large modules rather than growing one file indefinitely.
- Validate all external/user input at system boundaries; fail fast with clear errors.
- Follow the conventions in [AGENTS.md](AGENTS.md) — it documents the active stack, auth model, and DB access patterns in more detail than this file does.

## Testing expectations

- Unit tests run under `bun test` (`src/`).
- Integration and E2E tests **must** use [Testcontainers](https://testcontainers.com/) for backing services (Postgres) — no shared/dev database in tests, and no hand-rolled container management. Docker must be running.
- Target UI elements via ARIA roles, accessible names, or visible text. **Do not add `data-testid` attributes** — see `e2e/README.md` for the established pattern.
- New behavior needs test coverage; bug fixes should include a regression test where practical.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/) style messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, etc.

- Sign off every commit for DCO compliance:

  ```bash
  git commit -s
  ```

- Commits must be GPG-signed. Do not use `--no-gpg-sign`.

## Opening a pull request

1. Fork the repo and create a feature branch off `main`.
2. Make your change, keeping it focused and reasonably small.
3. Run `just ci-check` locally and make sure it's green.
4. Open a PR against `main` describing what changed and why. Link any related issue.
5. Respond to review feedback — CI must be green before merge.

## Releases

Maintainers cut releases by pushing a semver `vX.Y.Z` tag, which builds and publishes the container image to GHCR. The full process — versioning, tagging, what gets published, verification, and rollback — is in [RELEASE.md](RELEASE.md).

## Reporting issues

Use the GitHub issue templates (bug report or feature request) so we get the context we need up front — especially your deployment method (Docker image tag vs. build-from-source), Docker version, and browser, for bug reports.

## Security issues

Please do not open a public issue for a security vulnerability. Use [GitHub Security Advisories](https://github.com/unclesp1d3r/mag_stacker/security/advisories/new) for the repo instead.

## Using Claude Code

This repo is set up to work well with [Claude Code](https://claude.com/claude-code):

```bash
claude    # reads CLAUDE.md (which includes AGENTS.md) automatically
```

`AGENTS.md` documents the active stack, backend/auth/testing conventions, and the mandatory `just ci-check` gate — read it before making non-trivial changes. If you're using AI assistance of any kind, also see [AI_POLICY.md](AI_POLICY.md).

```

### CODE_OF_CONDUCT.md

```

# Code of Conduct

## Our Pledge

We pledge to make participation in the mag_stacker project a harassment-free experience for everyone.

## Our Standards

Examples of behavior that contributes to a positive environment:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the project team.

## Attribution

This Code of Conduct is adapted from the Contributor Covenant, version 2.1.

```

### SECURITY.md

```

# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in mag_stacker, please report it by emailing the maintainers.

**Please do not open a public issue for security vulnerabilities.**

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

```

### .gitignore

```

# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies

/node_modules
/.pnp
.pnp._
.yarn/_
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing

/coverage

# playwright / e2e

/test-results/
/playwright-report/
/playwright/.cache/

# resolved run env (generated secrets + session tokens — never commit)

e2e/.artifacts/

# next.js

/.next/
/out/

# production

/build

# misc

.DS_Store
\*.pem

# debug

npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (can opt-in for committing if needed)

.env\*
!.env.example

# vercel

.vercel

# typescript

\*.tsbuildinfo
next-env.d.ts

# generated SBOM (`just sbom`)

/sbom.cdx.json

# local env files

\*_/_.local.\*

# AI assistant

.agents/skills
.claude/skills/\*
!.claude/skills/skill-library
.impeccable/

```

### .github/FUNDING.yml

```

# These are supported funding model platforms

github: [UncleSp1d3r]

```

### LICENSE

```

Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction,
    and distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by
    the copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all
    other entities that control, are controlled by, or are under common
    control with that entity. For the purposes of this definition,
    "control" means (i) the power, direct or indirect, to cause the
    direction or management of such entity, whether by contract or
    otherwise, or (ii) ownership of fifty percent (50%) or more of the
    outstanding shares, or (iii) beneficial ownership of such entity.

    "You" (or "Your") shall mean an individual or Legal Entity
    exercising permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation
    source, and configuration files.

    "Object" form shall mean any form resulting from mechanical
    transformation or translation of a Source form, including but
    not limited to compiled object code, generated documentation,
    and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or
    Object form, made available under the License, as indicated by a
    copyright notice that is included in or attached to the work
    (an example is provided in the Appendix below).

    "Derivative Works" shall mean any work, whether in Source or Object
    form, that is based on (or derived from) the Work and for which the
    editorial revisions, annotations, elaborations, or other modifications
    represent, as a whole, an original work of authorship. For the purposes
    of this License, Derivative Works shall not include works that remain
    separable from, or merely link (or bind by name) to the interfaces of,
    the Work and Derivative Works thereof.

    "Contribution" shall mean any work of authorship, including
    the original version of the Work and any modifications or additions
    to that Work or Derivative Works thereof, that is intentionally
    submitted to Licensor for inclusion in the Work by the copyright owner
    or by an individual or Legal Entity authorized to submit on behalf of
    the copyright owner. For the purposes of this definition, "submitted"
    means any form of electronic, verbal, or written communication sent
    to the Licensor or its representatives, including but not limited to
    communication on electronic mailing lists, source code control systems,
    and issue tracking systems that are managed by, or on behalf of, the
    Licensor for the purpose of discussing and improving the Work, but
    excluding communication that is conspicuously marked or otherwise
    designated in writing by the copyright owner as "Not a Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity
    on behalf of whom a Contribution has been received by Licensor and
    subsequently incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    copyright license to reproduce, prepare Derivative Works of,
    publicly display, publicly perform, sublicense, and distribute the
    Work and such Derivative Works in Source or Object form.

3.  Grant of Patent License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    (except as stated in this section) patent license to make, have made,
    use, offer to sell, sell, import, and otherwise transfer the Work,
    where such license applies only to those patent claims licensable
    by such Contributor that are necessarily infringed by their
    Contribution(s) alone or by combination of their Contribution(s)
    with the Work to which such Contribution(s) was submitted. If You
    institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work
    or a Contribution incorporated within the Work constitutes direct
    or contributory patent infringement, then any patent licenses
    granted to You under this License for that Work shall terminate
    as of the date such litigation is filed.

4.  Redistribution. You may reproduce and distribute copies of the
    Work or Derivative Works thereof in any medium, with or without
    modifications, and in Source or Object form, provided that You
    meet the following conditions:

    (a) You must give any other recipients of the Work or
    Derivative Works a copy of this License; and

    (b) You must cause any modified files to carry prominent notices
    stating that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works
    that You distribute, all copyright, patent, trademark, and
    attribution notices from the Source form of the Work,
    excluding those notices that do not pertain to any part of
    the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its
    distribution, then any Derivative Works that You distribute must
    include a readable copy of the attribution notices contained
    within such NOTICE file, excluding those notices that do not
    pertain to any part of the Derivative Works, in at least one
    of the following places: within a NOTICE text file distributed
    as part of the Derivative Works; within the Source form or
    documentation, if provided along with the Derivative Works; or,
    within a display generated by the Derivative Works, if and
    wherever such third-party notices normally appear. The contents
    of the NOTICE file are for informational purposes only and
    do not modify the License. You may add Your own attribution
    notices within Derivative Works that You distribute, alongside
    or as an addendum to the NOTICE text from the Work, provided
    that such additional attribution notices cannot be construed
    as modifying the License.

    You may add Your own copyright statement to Your modifications and
    may provide additional or different license terms and conditions
    for use, reproduction, or distribution of Your modifications, or
    for any such Derivative Works as a whole, provided Your use,
    reproduction, and distribution of the Work otherwise complies with
    the conditions stated in this License.

5.  Submission of Contributions. Unless You explicitly state otherwise,
    any Contribution intentionally submitted for inclusion in the Work
    by You to the Licensor shall be under the terms and conditions of
    this License, without any additional terms or conditions.
    Notwithstanding the above, nothing herein shall supersede or modify
    the terms of any separate license agreement you may have executed
    with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade
    names, trademarks, service marks, or product names of the Licensor,
    except as required for reasonable and customary use in describing the
    origin of the Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or
    agreed to in writing, Licensor provides the Work (and each
    Contributor provides its Contributions) on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
    implied, including, without limitation, any warranties or conditions
    of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
    PARTICULAR PURPOSE. You are solely responsible for determining the
    appropriateness of using or redistributing the Work and assume any
    risks associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory,
    whether in tort (including negligence), contract, or otherwise,
    unless required by applicable law (such as deliberate and grossly
    negligent acts) or agreed to in writing, shall any Contributor be
    liable to You for damages, including any direct, indirect, special,
    incidental, or consequential damages of any character arising as a
    result of this License or out of the use or inability to use the
    Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all
    other commercial damages or losses), even if such Contributor
    has been advised of the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing
    the Work or Derivative Works thereof, You may choose to offer,
    and charge a fee for, acceptance of support, warranty, indemnity,
    or other liability obligations and/or rights consistent with this
    License. However, in accepting such obligations, You may act only
    on Your own behalf and on Your sole responsibility, not on behalf
    of any other Contributor, and only if You agree to indemnify,
    defend, and hold each Contributor harmless for any liability
    incurred by, or claims asserted against, such Contributor by reason
    of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2026 UncleSp1d3r

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

```

### README.md

```

# MagStacker

MagStacker is a self-hosted web app for keeping track of firearms, magazines, ammo, and aftermarket accessories: what you own, which mags fit which guns, and what it's all worth. It's built for individual owners, clubs, and ranges that don't want their inventory living in a spreadsheet or somebody else's cloud.

You run it on your own server, behind your own login, and the data stays with you.

![MagStacker walkthrough: the magazine list, a firearm and its mounted accessories, the accessories tracker, the caliber summary, and switching themes](docs/images/demo.gif)

There are two themes, a dark "Field Console" and a light "Machined Instrument", and the app follows your system setting by default:

|                             Dark                              |                              Light                              |
| :-----------------------------------------------------------: | :-------------------------------------------------------------: |
| ![Magazines list, dark theme](docs/images/magazines-dark.png) | ![Magazines list, light theme](docs/images/magazines-light.png) |

Aftermarket parts (optics, suppressors, triggers, lights) get tracked per firearm with cost, serial, and NFA status, and each firearm's page shows the total value mounted on it:

|                      Accessories                      |                                      On a firearm                                       |
| :---------------------------------------------------: | :-------------------------------------------------------------------------------------: |
| ![Accessories list](docs/images/accessories-dark.png) | ![A firearm's mounted accessories and value total](docs/images/firearm-accessories.png) |

## Who it's for

- **Individuals** keeping a personal collection straight. Label your mags, see how many you've got per caliber and per firearm, and pull a copy for insurance or your own records.
- **Clubs** that want to share certain club-owned items with members, read-only or editable, without opening up the whole inventory.
- **Ranges** handing fleet hardware to staff. Share an item at edit and switch on "allow adding records owned by me", and an employee can add new range assets to the range's books. A view-only volunteer can look but not touch.

Everyone sees only what they own or what's been shared with them, and only an item's owner can delete it. Revoke a share and it's gone on the other person's next request.

## What you can do

- Add firearms and magazines with caliber, capacity (base plus any extension), labels, acquired date, serial, and notes.
- Link each magazine to the firearms it fits. The order you set is the order it shows up in everywhere else.
- Bulk-add a labeled batch in one go (say, 60 mags numbered `AR-01` through `AR-60`), and the count picks up where it left off the next time you add.
- Filter magazines by brand or model, exact caliber, or which firearm they fit.
- Track ammo lots by caliber, load, and grain, with a low-stock threshold that flags when you're running short.
- Track the accessories on each firearm (optics, suppressors, triggers, grips) with cost, serial, installed date, and NFA status. Move a part between guns and it keeps its identity, and a firearm's page rolls up the total value mounted on it. Suppressors and other NFA items are flagged, and their serials stay sensitive.
- Check a summary: a running total, plus counts per caliber and per firearm, over everything you can see.
- Export to CSV for a spreadsheet. Serial numbers stay out of the export, and a cell that starts with `=` won't turn into a live formula when someone opens the file.
- Share one item with another account at view or edit, optionally let them add records on your behalf, and take the access back whenever you want.

There's no public sign-up. Accounts are created by whoever runs the server, and serial numbers are treated as sensitive everywhere they show up.

## Quick start

You don't need to clone the repo for this. Grab the two files the stack needs and start it with the published image, on any machine with [Docker](https://www.docker.com/):

```bash
# 1. Grab the compose file and an env template (no checkout required)
curl -O https://raw.githubusercontent.com/unclesp1d3r/mag_stacker/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/unclesp1d3r/mag_stacker/main/.env.example

# 2. Fill in .env: a database password, a long random BETTER_AUTH_SECRET
#    (try `openssl rand -base64 32`), your first admin email and password, and
#    BETTER_AUTH_URL set to the address you'll actually open it at.

# 3. Pull the published image and start the stack
docker compose pull
docker compose up -d          # migrates, seeds your first admin, starts the app
```

Once the stack is up, open `http://<your-server>:3000/login` and sign in as the admin you set in `.env`. Compose defaults to the `latest` released image; pin a specific version by setting `MAGSTACKER_VERSION` in `.env` (or use `edge` to track main). When you pin an older version, fetch `docker-compose.yml` and `.env.example` from that release tag too (swap `main` for the tag in the URLs above), since the compose file and env template evolve alongside the image and can drift apart from a pinned release.

On anything other than localhost, run it behind a TLS-terminating reverse proxy and set `BETTER_AUTH_URL` to the `https://` address; see [`docs/deployment.md`](docs/deployment.md).

## Running from a checkout

To build the image yourself instead of pulling the published one, clone the repo on a machine with [Docker](https://www.docker.com/). A home server or the club's back-office PC is plenty.

```bash
cp .env.example .env
# Fill in .env: a database password, a long random BETTER_AUTH_SECRET
# (try `openssl rand -base64 32`), your first admin email and password, and
# BETTER_AUTH_URL set to the address you'll actually open it at.

docker compose up --build -d                  # migrates, seeds your first admin, starts the app
```

The bootstrap runs migrations and creates your first admin account (from the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`) before the app starts; `docker compose logs migrate` shows `Created admin account for <email>.` It's idempotent, so re-running `up` never duplicates the admin.

Open `http://<your-server>:3000/login`, sign in, and add the rest of the accounts (staff, members, family) from the **Accounts** screen.

> Run it behind HTTPS. Logins depend on cookies, so put MagStacker behind a reverse proxy that handles TLS (Caddy, nginx, Traefik) and set `BETTER_AUTH_URL` to the `https://` address. There's more in [`docs/deployment.md`](docs/deployment.md).

### Backups

Everything lives in Postgres, so a normal `pg_dump` is your backup. Restoring it brings back every firearm, magazine, compatibility link, and share exactly as they were:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > magstacker.dump
```

## Behind a reverse proxy

Sign-in rides on cookies, so on any real network you run MagStacker behind a reverse proxy that terminates TLS rather than exposing port 3000 directly. Point the proxy at the app's published port and set `BETTER_AUTH_URL` in `.env` to the public `https://` address. It **must** match the origin you actually open, or Better Auth rejects the request.

The smallest example is [Caddy](https://caddyserver.com/), which gets you an automatic Let's Encrypt certificate. A whole `Caddyfile` can be two lines:

```caddyfile
magstacker.example.com {
    reverse_proxy localhost:3000
}
```

Then set `BETTER_AUTH_URL=https://magstacker.example.com` in `.env` and restart the stack. nginx and Traefik work the same way: terminate TLS, proxy to the app port, and forward a single trusted client-IP header (e.g. `X-Real-IP`) so the auth rate limiting keys on the real client. Full details, including the header and port notes, are in [`docs/deployment.md`](docs/deployment.md).

## For developers

MagStacker is the original Go/Wails (later Avalonia) desktop app rebuilt as a multi-user web app. It has to match what the desktop version already did, so the inventory rules are pinned to a parity spec and tested against it.

Stack: Next.js 16 (App Router), React 19, Bun, Drizzle ORM, Postgres, Better Auth, Tailwind v4, Biome. Use Bun and Biome, not ESLint/Prettier/pnpm (see `AGENTS.md`).

```bash
docker compose up -d db        # local Postgres on host port 5544
export DATABASE_URL=postgres://magstacker:<password>@localhost:5544/magstacker
bun install
bun run db:migrate
bun run dev                    # http://localhost:3000

bun run lint                   # biome check
bun run format                 # biome format --write
bun run typecheck              # tsc --noEmit
bun test                       # unit + integration
```

> `mise` (`mise.toml`) pins the toolchain and loads `.env` into your shell, then caches it. After you edit `.env`, run `mise cache clear`, or a stale value can shadow both your tooling and `docker compose`.

The README's demo images and walkthrough gif are generated from the live UI. Regenerate them all before a release with `just demo-images` (needs Docker + ffmpeg). The generators are `e2e/demo-*.spec.ts`, gated behind `DEMO=1` so they stay out of the normal test run, and they share one sample dataset from `e2e/fixtures/demo-seed.ts`.

Layout:

```text
app/                 # Next.js routes: login, gated inventory, admin, auth + export APIs
proxy.ts · auth.ts   # auth gate and Better Auth config
components/ui/        # design-system primitives
src/
  db/                # Drizzle schema, client, migrations, idempotency, health
  auth/              # the one server-side scoping/authorization layer
  domain/            # firearms, magazines, summary, csv, bulkadd, reference,
                     #   validation - plain TypeScript, no Next.js imports
  data/              # curated caliber/manufacturer lists
docs/                # deployment guide, architecture decision records, images
```

Authorization is enforced server-side in `src/auth`, and reads are viewer-relative: anything you can't see drops out of lists, the summary, and exports before it reaches you. The parity behaviors are pinned to exact values in the test suite, including two-user tests that try to break the sharing rules.

## License

MagStacker is licensed under the [Apache License 2.0](LICENSE).

## Contributing

Bug reports, feature requests, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, the `just ci-check` gate, and PR guidelines.

```

### ARCHITECTURE.md

```

# Architecture

## mag_stacker Architecture Overview

### Pattern: monolith

### Directory Structure

```
mag_stacker/
├── src/           # Source code
├── tests/         # Test files
├── docs/          # Documentation
└── ...
```

### Key Components

1. **Component A** - Description
2. **Component B** - Description
3. **Component C** - Description

### Data Flow

Describe how data flows through the application.

---

_Generated by LynxPrompt_

```

### CHANGELOG.md

```

# Changelog

All notable changes to mag_stacker will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup

### Changed

### Deprecated

### Removed

### Fixed

### Security

```

---

*Generated by [LynxPrompt](https://lynxprompt.com) CLI*
```
