---
name: skill-library
description: Project skill-surface map for mag_stacker (ECC + Better Auth skills). Advisory guide for which skills/agents to load by default (DAILY) versus reach for on demand (LIBRARY). Consult when picking a skill/agent for a task or when an off-stack capability is needed.
---

# mag_stacker — Project Skill Library Router

This repo runs a **trimmed surface** instead of the full ECC bundle. Sorted by evidence
from the codebase (see `/ecc:agent-sort`, which produced this).

- **DAILY** = on-stack, worth loading by default for this project.
- **LIBRARY** = kept reachable via search; reach for it explicitly when a task needs it.
  LIBRARY ≠ deleted, and this router is **advisory** — the only hard load-suppression is
  `skillOverrides` in `.claude/settings.local.json` (currently just `actionbook`/`aes-gcm` off).

## Stack (source of truth)

TypeScript 5 · Next.js 16 (App Router, React Compiler) · React 19 · **Bun** · **Biome** (not
ESLint/Prettier) · Tailwind v4 · **Motion** (design-system animation) · **Shadcn** (shipped —
`components.json` "new-york" + RSC, `components/ui/*` incl. button/input/select/dropdown-menu,
Radix + `class-variance-authority` + `lucide-react` + `tw-animate-css`; shadcn-first per the
`shadcn-first-kiss` memory). **Shipped backend:** Postgres + Drizzle (pg Pool), Docker, Better
Auth (email+password, owner-scoped inventory, per-item grant sharing), Testcontainers
integration/E2E. **Under evaluation (not shipped):** org-plugin sharing (see the
`sharing-architecture-org-plugin` memory).

> The former `.cs` .NET snapshot has been removed. **C#/.NET tooling is LIBRARY, never DAILY.**

## DAILY — load by default

| Area | Skills / agents | Why |
| --- | --- | --- |
| Next/React | `ecc:frontend-patterns`, `ecc:react-patterns`, `ecc:react-performance`, `ecc:nextjs-turbopack`, `frontend-design` | `next.config.ts`, React 19, app router |
| Shadcn UI | `frontend-design`, `shadcn` MCP (`mcp__shadcn__*`) | `components.json` + `components/ui/*` shipped; shadcn-first UI direction |
| Animation | `ecc:motion-foundations`, `ecc:motion-patterns`, `ecc:motion-ui` | `motion` dep wired into the design system (`globals.css`, `theme-provider`, `theme-toggle`, `toast`); memory prefers Motion |
| Docs lookup | `ecc:docs-lookup` / `documentation-lookup` (Context7) | Next 16 / Tailwind 4 / Drizzle are post-cutoff; AGENTS.md says read the docs |
| Runtime | `ecc:bun-runtime` | `bun.lock` |
| Backend / DB | `ecc:backend-patterns`, `ecc:postgres-patterns`, `ecc:database-migrations` | Drizzle + pg Pool live in `src/db` + `src/domain`; versioned migrations |
| Auth (non-ECC) | `better-auth-best-practices`, `better-auth-security-best-practices`, `email-and-password-best-practices` | Better Auth email+password is shipped auth; used across `auth.ts`, `proxy.ts`, `lib/auth-client.ts`, `src/db/schema.ts`, e2e fixtures |
| Security | `security-review`, `ecc:security-reviewer` | auth, ownership, per-item sharing, sensitive serials |
| Testing | `tdd-workflow` / `ecc:tdd-guide`, `e2e-testing` / `ecc:e2e-runner`, `testcontainers` (Testcontainers-based, per AGENTS.md) | global TDD + 80% rule; Playwright + Testcontainers installed |
| Review | `code-review` / `ecc:code-review`, agents: `ecc:react-reviewer`, `ecc:typescript-reviewer`, `ecc:database-reviewer`, `ecc:security-reviewer`, `ecc:react-build-resolver`, `ecc:build-error-resolver` | review-after-writing rule; on-stack reviewers |
| Workflow | `ecc:coding-standards`, `ecc:git-workflow`, `frontend-a11y` / `ecc:accessibility` | coding-style, signed-commit workflow, a11y rule (`next-themes` light/dark) |
| Deploy | `ecc:docker-patterns` | `Dockerfile` + `docker-compose.yml` shipped |

> **Non-ECC project skills:** the `better-auth-*` / `email-and-password-*` skills above (and
> the two auth extras below) come from `better-auth/skills` via `skills-lock.json`, not the ECC
> bundle. Everything else is ECC.

## LIBRARY — searchable, not loaded by default (trigger keywords)

- **Auth extras (Better Auth)** → `two-factor-authentication-best-practices` (2FA not wired in `auth.ts`), `organization-best-practices` (org plugin under evaluation, not shipped), `create-auth-skill` (meta: authoring new auth skills)
- **Other languages** → go, rust, python, java, kotlin, swift, php, cpp, **csharp/dotnet**, dart/flutter, fsharp, perl, vue, angular (reviewers, patterns, build-resolvers, testing)
- **Other web frameworks** → django, fastapi, laravel, springboot, quarkus, nestjs, nuxt
- **Domain verticals** → healthcare, finance/billing, logistics, crypto/defi/trading, scientific-*, energy, customs/trade
- **Homelab *network*** → vlan, pihole-dns, wireguard, network-readiness (host provisioning, not app dev)
- **Content / marketing / writing** → article-writing, brand-voice, content-engine, crosspost, ghost-*, investor-*, marketing, seo
- **Research** → deep-research, exa-search, firecrawl-*, active-research
- **Heavy orchestration** → gan-*, orch-*, multi-*, council, team-*

## Hook caveat

Do **not** wire ESLint/Prettier/pnpm hooks — this repo is Biome + Bun. Any format/lint/type
hooks must target `bun biome check`, `bun biome format`, `bun tsc --noEmit`. The pre-commit
gate is `just ci-check` (see AGENTS.md).
