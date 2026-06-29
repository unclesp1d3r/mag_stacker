# MagStacker

Keep track of your firearms and magazines — what you own, what fits what, and
how much you've got. MagStacker is a self-hosted web app for **shooting ranges,
clubs, and individual owners** who want a simple, private inventory they
control, reachable from any device on their network.

You run it on your own server, behind your own login. Your data stays yours.

## Who it's for

- **Individuals** — catalogue your collection, label your magazines, see at a
  glance how many mags you have per caliber and per firearm, and export a copy
  for your records or insurance.
- **Clubs** — share specific club-owned firearms and magazines with members at
  *view* or *edit*, without handing over the whole inventory.
- **Ranges** — let staff manage range hardware: share fleet items at *edit*, and
  flip on *"allow adding records owned by me"* so an employee can add new range
  assets to the range's inventory — while a view-only volunteer can look but not
  touch.

Everyone sees only what they own or what's been shared with them, and only the
owner of an item can delete it. Take back access any time — revoking a share is
instant.

## What you can do

- **Track firearms and magazines** — name, manufacturer, caliber, serial,
  capacity (base + extension), labels, acquired date, and notes.
- **Map compatibility** — link each magazine to the firearms it fits; the order
  you choose is the order it shows everywhere.
- **Bulk-add labeled batches** — add up to 1000 magazines at once with an
  auto-numbered label sequence (e.g. `AR-01`, `AR-02`, …) that keeps counting up
  on your next batch.
- **Search & filter** — find magazines by brand/model, exact caliber, or which
  firearm they fit.
- **See your numbers** — a summary view with totals and breakdowns per caliber
  and per firearm, computed over everything visible to you.
- **Export to CSV** — open it in any spreadsheet. (Serial numbers are
  deliberately left out of exports, and the file is hardened against spreadsheet
  formula tricks.)
- **Share, your way** — grant another account view or edit access to a single
  item, optionally letting them add records on your behalf, and revoke whenever.

Accounts are created by an operator (the person who runs the server) — there's no
public sign-up, and serial numbers are treated as sensitive throughout.

## Get it running

You'll need a machine with [Docker](https://www.docker.com/) — a home server, a
small always-on box, a club's back-office PC, whatever you control.

```bash
cp .env.example .env
# Fill in .env: a database password, a long random BETTER_AUTH_SECRET
# (e.g. `openssl rand -base64 32`), your first admin email/password, and
# BETTER_AUTH_URL set to the address you'll open it at.

docker compose up --build -d                  # starts the database + app
docker compose exec app bun run seed:admin    # creates your first admin account
```

Then open MagStacker at `http://<your-server>:3000/login` and sign in. Add more
accounts (for staff, members, family) from the **Accounts** screen.

> **Put it behind HTTPS.** Logins use cookies, so run MagStacker behind a
> reverse proxy that terminates TLS (Caddy, nginx, Traefik) and point
> `BETTER_AUTH_URL` at the `https://` address. Full notes:
> [`docs/deployment.md`](docs/deployment.md).

### Backups

Your inventory lives in Postgres. Back it up with the standard tooling — a
`pg_dump` / restore round-trip reproduces every firearm, magazine, link, and
share exactly:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > magstacker.dump
```

---

## For developers

MagStacker is a re-platform of the original Go/Wails → Avalonia desktop app into
a multi-user web application; the desktop app's proven inventory behavior is the
behavioral floor.

**Stack:** Next.js 16 (App Router) · React 19 · Bun · Drizzle ORM · Postgres ·
Better Auth · Tailwind v4 · Biome. Use **Bun** and **Biome** — never
ESLint/Prettier/pnpm (see `AGENTS.md`).

```bash
docker compose up -d db        # local Postgres (host port 5544)
export DATABASE_URL=postgres://magstacker:<password>@localhost:5544/magstacker
bun install
bun run db:migrate
bun run dev                    # http://localhost:3000

bun run lint                   # biome check
bun run format                 # biome format --write
bun run typecheck              # tsc --noEmit
bun test                       # unit + integration
```

> `mise` (`mise.toml`) pins the toolchain and caches `.env` into the shell —
> after editing `.env`, run `mise cache clear` or stale values can shadow your
> tooling and `docker compose`.

**Layout:**

```text
app/                 # Next.js routes — login, gated inventory, admin, auth + export APIs
proxy.ts · auth.ts   # auth gate + Better Auth config
components/ui/        # design-system primitives
src/
  db/                # Drizzle schema, client, migrations, idempotency, health
  auth/              # the single server-side scoping/authorization layer
  domain/            # framework-agnostic: firearms, magazines, summary, csv,
                     #   bulkadd, reference, validation  (no Next.js imports)
  data/              # curated caliber/manufacturer lists
docs/                # plan, parity reference specs, deployment guide
```

All authorization is enforced server-side through `src/auth`; reads are
viewer-relative (items you can't see vanish from lists, summary, and exports).
Parity behaviors are pinned to exact values in `docs/reference/` and proven by
the test suite, including two-user adversarial sharing tests.

## License

See repository.
