---
name: skill-library
description: Project-scoped ECC surface map for mag_stacker. Use to decide which ECC skills/agents load by default (DAILY) versus stay searchable on demand (LIBRARY). Consult when picking a skill/agent for a task or when an off-stack capability is needed.
---

# mag_stacker — ECC Skill Library Router

This repo runs a **trimmed ECC surface** instead of the full bundle. Sorted by evidence
from the codebase (see `/ecc:agent-sort` output that produced this).

- **DAILY** = on-stack, load by default for this project.
- **LIBRARY** = kept reachable via search; do **not** load by default. LIBRARY ≠ deleted —
  invoke it explicitly when a task genuinely needs it.

## Stack (source of truth)

TypeScript 5 · Next.js 16 (App Router, React Compiler) · React 19 · **Bun** · **Biome** (not
ESLint/Prettier) · Tailwind v4. Planned: Postgres + Drizzle + Docker + Shadcn; multi-user
auth + owner-scoping + per-item sharing.

> The 33 `.cs` references were a vendored .NET snapshot and have been removed.
> **C#/.NET tooling is LIBRARY, never DAILY.**

## DAILY — load by default

| Area | Skills / agents | Why |
| --- | --- | --- |
| Next/React | `ecc:frontend-patterns`, `ecc:react-patterns`, `ecc:react-performance`, `ecc:nextjs-turbopack`, `frontend-design` | `next.config.ts`, React 19, app router |
| Docs lookup | `ecc:docs-lookup` / `documentation-lookup` (Context7) | Next 16 / Tailwind 4 / Drizzle are post-cutoff; AGENTS.md says read the docs |
| Runtime | `ecc:bun-runtime` | `bun.lock` |
| Backend / DB | `ecc:backend-patterns`, `ecc:postgres-patterns`, `ecc:database-migrations` | API routes + chosen Postgres/Drizzle, versioned migrations (R1/R2/R5) |
| Security | `security-review`, `ecc:security-reviewer` | auth, ownership, per-item sharing, sensitive serial (R6–R17, R65–R67) |
| Testing | `tdd-workflow` / `ecc:tdd-guide`, `e2e-testing` / `ecc:e2e-runner` | global TDD + 80% rule; Playwright installed |
| Review | `code-review` / `ecc:code-review`, agents: `ecc:react-reviewer`, `ecc:typescript-reviewer`, `ecc:database-reviewer`, `ecc:security-reviewer`, `ecc:react-build-resolver`, `ecc:build-error-resolver` | review-after-writing rule; on-stack reviewers |
| Workflow | `ecc:coding-standards`, `ecc:git-workflow`, `frontend-a11y` / `ecc:accessibility` | global coding-style, signed-commit workflow, a11y rule |
| Deploy | `ecc:docker-patterns` | Docker-stack homelab target (R1) |

## LIBRARY — searchable, not loaded (trigger keywords)

- **Other languages** → go, rust, python, java, kotlin, swift, php, cpp, **csharp/dotnet**, dart/flutter, fsharp, perl, vue, angular (reviewers, patterns, build-resolvers, testing)
- **Other web frameworks** → django, fastapi, laravel, springboot, quarkus, nestjs, nuxt
- **Domain verticals** → healthcare, finance/billing, logistics, crypto/defi/trading, scientific-*, energy, customs/trade
- **Homelab *network*** → vlan, pihole-dns, wireguard, network-readiness (host provisioning, not app dev)
- **Content / marketing / writing** → article-writing, brand-voice, content-engine, crosspost, ghost-*, investor-*, marketing, seo
- **Research** → deep-research, exa-search, firecrawl-*, active-research
- **Heavy orchestration** → gan-*, orch-*, multi-*, council, team-*

## Hook caveat

Do **not** wire ESLint/Prettier/pnpm hooks — this repo is Biome + Bun. Any format/lint/type
hooks must target `bun biome check`, `bun biome format`, `bun tsc --noEmit`.
