<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Active ECC surface (trimmed)

This repo runs a **trimmed ECC surface**, not the full bundle. Full map + rationale:
`.claude/skills/skill-library/SKILL.md` (the `skill-library` router).

- **Stack:** TypeScript · Next.js 16 (App Router) · React 19 · **Bun** · **Biome** (not ESLint/Prettier) · Tailwind v4. Planned: Postgres + Drizzle + Docker + Shadcn; multi-user auth + per-item sharing.
- **DAILY (load by default):** frontend/react/next patterns, `docs-lookup`, `bun-runtime`, backend/postgres/migrations, `security-review`, TDD + e2e, code-review + on-stack reviewers (react/typescript/database/security), coding-standards, git-workflow, a11y, docker-patterns.
- **LIBRARY (search on demand, never auto-load):** all other languages (incl. **C#/.NET** — the former `.cs` snapshot is gone; behaviors distilled to `docs/reference/dotnet-extensions.md`), other web frameworks, domain verticals, network/homelab, content/marketing, research, heavy orchestration.
- **Hooks:** never wire ESLint/Prettier/pnpm hooks here — use `bun biome check`, `bun biome format`, `bun tsc --noEmit`.
