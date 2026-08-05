# Active ECC surface (trimmed)

This repo runs a **trimmed ECC surface**, not the full bundle. Full map + rationale:
`.claude/skills/skill-library/SKILL.md` (the `skill-library` router).

> **This file is mirrored to Dosu** (page `6e69465b-8afd-4278-92cf-5aa2d416b6e2`, deployment "Mag Stacker MCP Server") so it's queryable via `dosu ask` / the Dosu MCP. The page is a static snapshot — after editing this file, refresh it: `dosu docs update 6e69465b-8afd-4278-92cf-5aa2d416b6e2 --body-file ./AGENTS.md`.

- **Stack:** TypeScript · Next.js 16 (App Router) · React 19 · **Bun** · **Biome** (not ESLint/Prettier) · Tailwind v4 · Postgres + Drizzle (pg Pool) · Better Auth · Docker · multi-user owner-scoped inventory + grant-based sharing (all shipped). Planned: Shadcn.
- **DAILY (load by default):** frontend/react/next patterns, `docs-lookup`, `bun-runtime`, backend/postgres/migrations, `security-review`, TDD + e2e, code-review + on-stack reviewers (react/typescript/database/security), coding-standards, git-workflow, a11y, docker-patterns.
- **LIBRARY (search on demand, never auto-load):** all other languages (incl. **C#/.NET** — the former `.cs` snapshot is gone), other web frameworks, domain verticals, network/homelab, content/marketing, research, heavy orchestration.
- **Hooks:** never wire ESLint/Prettier/pnpm hooks here — use `bun biome check`, `bun biome format`, `bun tsc --noEmit`.
- **Documented solutions:** `docs/solutions/` — solutions to past problems (bugs + knowledge), organized by category with YAML frontmatter such as `title`, `category`, `module`, `problem_type`, `component`, `severity`, and `tags` (illustrative, not exhaustive); relevant when implementing or debugging in a documented area.
- **Shared vocabulary:** `CONCEPTS.md` (repo root) — domain glossary (entities, sharing/visibility model, classification & labeling, derived values, design identity); the canonical names for domain concepts, relevant when orienting to the codebase or discussing the domain.

## Backend, auth & testing (shipped)

- **Auth:** Better Auth, email+password, DB-backed sessions. `disableSignUp: true` — accounts via server-side `auth.api.createUser` (see `scripts/seed-admin.ts`); admin plugin; DB-stored rate limit (`/sign-in/email` = 5/60s). Session cookie: `better-auth.session_token`.
- **`BETTER_AUTH_URL` must equal the request origin** or Better Auth returns 403 "Invalid origin". `mise.toml` (`env_cache=true`, `_.file=['.env','.env.local']`) injects env vars stickily (default `:3000`, full_setup used `:3100`) — override explicitly when serving on another port.
- **DB:** Postgres + Drizzle over a lazy `pg` Pool (`src/db/client.ts`). `requireDatabaseUrl()` reads `DATABASE_URL` (not in `.env.example` — supply it). Inventory is `owner_id`-scoped; user delete CASCADEs children.
- **Commands:** `bun run db:migrate` · `bun run seed:admin` (needs `ADMIN_EMAIL`/`ADMIN_PASSWORD`) · `bun run lint` (biome) · `bun run typecheck` · `bun test`.
- **MUST-PASS PRE-COMMIT GATE:** You **MUST** run `just ci-check` and ensure it passes **before every commit**. Do not commit — for any reason — while `just ci-check` is failing. No `--no-verify`, no skipping, no "I'll fix it in a follow-up." A red `just ci-check` blocks the commit.
- **Tests:** **Integration & E2E use Testcontainers** (idiomatic module + Ryuk cleanup) — Docker is required to run the suite, and nothing reads an ambient dev database. `bunfig.toml` preloads `src/test-support/preload.ts`, which starts a migrated ephemeral Postgres and exports `DATABASE_URL` before any test module loads; the pinned image lives in `src/test-support/postgres-image.ts` (single source, also read by CI). Never reintroduce a `process.env.DATABASE_URL ? describe : describe.skip` gate — that idiom silently skipped the whole integration suite whenever the variable was unset, which is how it always ran in CI. Reuse `src/test-support/factories.ts`, and give a test its own owner rather than asserting over rows earlier tests left behind. **No `data-testid` in the app** — target UI via ARIA roles / accessible names / visible text. The Playwright suite lives in `e2e/` (`bun run test:e2e`, Docker required); see `e2e/README.md` for the harness.

## Workflow & boundaries

- **Git workflow:** feature branches + PRs only — never commit directly to `main`. Conventional Commits, semver. For agent tasks, prefer an isolated worktree: `git worktree add -b ai/<task> .worktrees/<task>` (check `git worktree list` first; merge and clean up when done).
- **PRs squash-merge, so the PR title and body ARE the commit message.** This repo merges with `squash_title: PR_TITLE` and `squash_msg: PR_BODY`; every branch commit message is discarded at merge. Therefore:
  - The **PR title MUST be a valid Conventional Commit subject** — `<type>(<scope>): <description>`, since it becomes the subject line on `main` verbatim.
  - A breaking change **MUST be marked on the PR itself**: a `!` before the colon in the PR title (`feat(scope)!: …`) **and** a `BREAKING CHANGE: <what breaks>` footer in the PR body. Marking it only on a branch commit does not work — the marker is destroyed by the squash. A prose "Breaking change" heading in the body is not the footer and does not count.
  - Releases are cut by pushing a `v*.*.*` tag by hand; nothing parses commits to compute the bump, so these markers are the only record of what the next version should be. A merged PR carrying a breaking change means the next tag is a **major**.
- **Releases/deploy:** container image `ghcr.io/unclesp1d3r/mag_stacker` via GitHub Actions; project docs at <https://unclesp1d3r.github.io/mag_stacker/>. Style/structure reference repo: <https://github.com/EvilBit-Labs/hash_hive>.
- **Do without asking:** create/delete/rename files, rewrite sections, change dependencies, modify DB schema or Docker config, update docs.
- **Ask first:** anything touching secrets/credentials, auth logic changes, deleting failing tests.
- **Never:** skip or disable tests "temporarily".
- **Testing preference:** favor E2E and integration tests over mocks when possible.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
