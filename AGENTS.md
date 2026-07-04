# Active ECC surface (trimmed)

This repo runs a **trimmed ECC surface**, not the full bundle. Full map + rationale:
`.claude/skills/skill-library/SKILL.md` (the `skill-library` router).

- **Stack:** TypeScript · Next.js 16 (App Router) · React 19 · **Bun** · **Biome** (not ESLint/Prettier) · Tailwind v4 · Postgres + Drizzle (pg Pool) · Better Auth · Docker · multi-user owner-scoped inventory + grant-based sharing (all shipped). Planned: Shadcn.
- **DAILY (load by default):** frontend/react/next patterns, `docs-lookup`, `bun-runtime`, backend/postgres/migrations, `security-review`, TDD + e2e, code-review + on-stack reviewers (react/typescript/database/security), coding-standards, git-workflow, a11y, docker-patterns.
- **LIBRARY (search on demand, never auto-load):** all other languages (incl. **C#/.NET** — the former `.cs` snapshot is gone), other web frameworks, domain verticals, network/homelab, content/marketing, research, heavy orchestration.
- **Hooks:** never wire ESLint/Prettier/pnpm hooks here — use `bun biome check`, `bun biome format`, `bun tsc --noEmit`.

## Backend, auth & testing (shipped)

- **Auth:** Better Auth, email+password, DB-backed sessions. `disableSignUp: true` — accounts via server-side `auth.api.createUser` (see `scripts/seed-admin.ts`); admin plugin; DB-stored rate limit (`/sign-in/email` = 5/60s). Session cookie: `better-auth.session_token`.
- **`BETTER_AUTH_URL` must equal the request origin** or Better Auth returns 403 "Invalid origin". `mise.toml` (`env_cache=true`, `_.file=['.env','.env.local']`) injects env vars stickily (default `:3000`, full_setup used `:3100`) — override explicitly when serving on another port.
- **DB:** Postgres + Drizzle over a lazy `pg` Pool (`src/db/client.ts`). `requireDatabaseUrl()` reads `DATABASE_URL` (not in `.env.example` — supply it). Inventory is `owner_id`-scoped; user delete CASCADEs children.
- **Commands:** `bun run db:migrate` · `bun run seed:admin` (needs `ADMIN_EMAIL`/`ADMIN_PASSWORD`) · `bun run lint` (biome) · `bun run typecheck` · `bun test`.
- **MUST-PASS PRE-COMMIT GATE:** You **MUST** run `just ci-check` and ensure it passes **before every commit**. Do not commit — for any reason — while `just ci-check` is failing. No `--no-verify`, no skipping, no "I'll fix it in a follow-up." A red `just ci-check` blocks the commit.
- **Tests:** integration tests gate on `DATABASE_URL` (`const live = process.env.DATABASE_URL ? describe : describe.skip`); reuse `src/test-support/factories.ts`. **Integration & E2E must use Testcontainers** (idiomatic module + Ryuk cleanup). **No `data-testid` in the app** — target UI via ARIA roles / accessible names / visible text. The Playwright suite lives in `e2e/` (`bun run test:e2e`, Docker required); see `e2e/README.md` for the harness.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
