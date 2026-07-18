# Getting Started for Clubs and Ranges

This guide walks through deploying and configuring MagStacker to manage club or range-owned firearms and magazines across multiple users — staff, members, and volunteers.

## Overview

MagStacker is a self-hosted, multi-user web application for firearm and magazine inventory — built specifically for operators who need to manage hardware that's shared, borrowed, or maintained by multiple people. Clubs and ranges are a primary use case [[1]](https://app.dosu.dev/documents/f35b79b9-79c9-423b-8217-1012b20e4639).

Rather than a spreadsheet or a SaaS tool on someone else's infrastructure, MagStacker runs on your own server and keeps all inventory data in your own database [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

**What this means for clubs and ranges:**

- **Multi-user inventory:** Every account on the system sees only what they own or what's been shared with them. The club's account holds the canonical records; staff and members see whatever slice you choose to expose [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).
- **Granular sharing:** Share individual firearms and magazines at `view` or `edit` permission. View-only users can read but not modify. Edit users can update records. Only the item owner can delete [[3]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L17).
- **Staff acting on the club's behalf:** When you share an item at edit permission, you can also enable "allow adding records owned by me." This lets a staff member create new magazines that belong to the club's account — the range expands its own inventory through its employees, without giving them full account access [[4]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L11-L14).
- **Read-only volunteers:** Grant view permission to members or volunteers so they can check what's available without changing anything [[1]](https://app.dosu.dev/documents/f35b79b9-79c9-423b-8217-1012b20e4639).
- **Instant revocation:** Revoke a share and access is gone on the user's next request. No cleanup required [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

This model maps naturally to a club or range structure: one account owns the fleet, staff get operational access to specific items, and members get the read-only picture.

***

## Prerequisites

Before deploying MagStacker, make sure you have:

- **Docker and Docker Compose** installed on a machine you control — a homelab server, a NAS, a small VPS, or the club's back-office PC [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5). The stack runs as three containers: Postgres, a one-shot migrate/seed service, and the Next.js app.

- **Basic networking knowledge** to put the app behind a TLS-terminating reverse proxy. MagStacker uses session cookies for authentication — you must not expose it over plain HTTP in production [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

- **`openssl`** (or an equivalent) to generate a strong random secret for `BETTER_AUTH_SECRET`:

  ```bash
  openssl rand -base64 32
  ```

- Access to edit a `.env` file before first launch. No secrets are baked into the image; everything is supplied at runtime [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

There is **no public sign-up**. All accounts are created by the operator from within the application [[6]](https://app.dosu.dev/documents/ed6267e3-2c79-4bc4-85d2-2a4246a40c88). You control exactly who has access.

***

## Installation & First Run

### 1. Configure your environment

Copy the example env file and fill in real values:

```bash
cp .env.example .env
```

The `.env.example` ships with these variables [[7]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/.env.example):

```dotenv
# Database
POSTGRES_USER=magstacker
POSTGRES_PASSWORD=change-me-in-production   # set a strong password
POSTGRES_DB=magstacker
POSTGRES_HOST_PORT=5544                      # host port for local tooling access

# Authentication
BETTER_AUTH_SECRET=change-me-generate-a-strong-random-secret
BETTER_AUTH_URL=http://localhost:3000        # update to https:// in production

# First operator account (bootstrapped on first run)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-strong-admin-password

# Application
APP_HOST_PORT=3000
MAGSTACKER_VERSION=latest
```

**Fill in every value before starting the stack.** Key notes [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3):

| Variable | What to set |
|---|---|
| `POSTGRES_PASSWORD` | Any strong password — used internally between containers |
| `BETTER_AUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `ADMIN_EMAIL` | Email address for your initial operator account |
| `ADMIN_PASSWORD` | A strong password for that account |
| `BETTER_AUTH_URL` | `http://localhost:3000` for local testing; must be your `https://` URL in production |

### 2. Start the stack

```bash
docker compose up --build -d
```

This runs in order [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3):

1. Starts the Postgres database.
2. Runs the `migrate` service — applies all database migrations, then seeds your first operator account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Seeding is idempotent: it only creates the account on an empty database and no-ops on subsequent runs.
3. Starts the app once migrations complete successfully.

### 3. Verify the migration ran

```bash
docker compose logs migrate
```

A successful run prints:

```
Created admin account for admin@example.com.
```

If `ADMIN_EMAIL` / `ADMIN_PASSWORD` were not set when the stack first came up, the seed is skipped. Set them in `.env` and re-run `docker compose up -d` to seed [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

### 4. Open the app

Navigate to `http://<your-server>:3000/login` and sign in with the credentials you set in `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

***

## Setting Up Your Operator Account

The operator account is the account you use to administer the system. It is bootstrapped automatically from the `ADMIN_EMAIL` and `ADMIN_PASSWORD` values in your `.env` before the app starts for the first time [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

Sign in at your configured URL using those credentials. This account carries the `admin` role, which gives it:

- Full access to the **Accounts** screen to create, view, and manage all user accounts [[8]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/session.ts).
- The ability to create accounts for staff and members (the only way to get accounts on the system, since public sign-up is disabled) [[6]](https://app.dosu.dev/documents/ed6267e3-2c79-4bc4-85d2-2a4246a40c88).

> **This is also the account that owns the club's inventory.** Firearms and magazines you add under this account belong to it. When you share items with staff or members, you are sharing from this account's inventory.

Keep the operator credentials secure. `BETTER_AUTH_SECRET` signs all session tokens; if you ever rotate it, all active sessions are invalidated and everyone must sign in again [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

***

## Creating Accounts for Staff and Members

MagStacker has no public sign-up. Every account is created by an operator from the **Accounts** screen [[6]](https://app.dosu.dev/documents/ed6267e3-2c79-4bc4-85d2-2a4246a40c88). Sign in as the operator, navigate to **Accounts**, and create each user with their email address and an initial password.

### Role model

MagStacker uses two account-level roles combined with per-item grants to cover the club/range structure [[9]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/auth.ts) [[10]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts):

| Role | What they can do |
|---|---|
| **Operator** (admin role) | Create and manage all accounts. Full system access. Owns the club's inventory. |
| **Staff / active members** (user role + edit grant) | Can view and edit items shared with them. If `allowCreateOnBehalf` is enabled on their grant, they can also add new records that belong to the club's account. |
| **Volunteers / read-only members** (user role + view grant) | Can view items shared with them. Cannot modify or delete anything. |

The `admin` vs `user` role distinction controls account management access. Inventory access is controlled entirely by per-item grants — explained in the next section.

### Creating an account

From the **Accounts** screen:

1. Enter the user's email address and set an initial password.
2. Assign the appropriate role:
   - **admin** — for other operators who also need to manage the system.
   - **user** (the default) — for staff, volunteers, and members.
3. Share the credentials with the user so they can sign in and change their password.

After creating the account, proceed to share the relevant inventory items with that user at the appropriate permission level.

***

## Adding Your Inventory

Once your operator account is set up, start populating the fleet. All items you add here are owned by the operator account and can later be shared with staff and members.

### Firearms

Navigate to the **Firearms** section and add each firearm with:

- **Manufacturer and model** — the make and name of the firearm.
- **Caliber** — used to match compatible magazines and drive caliber summaries.
- **Serial number** (optional) — treated as sensitive data throughout the application; never included in CSV exports [[11]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L1-L4).
- **Nickname / notes** (optional) — useful for distinguishing individual units (e.g., "Range Rifle #3").

### Magazines

Navigate to the **Magazines** section and add magazines with:

- **Brand and model.**
- **Caliber.**
- **Base capacity** and any **extension rounds** — the app tracks both and computes effective capacity [[12]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L22-L33).
- **Label** (optional) — a short identifier like `AR-01`. Labels appear throughout the UI and in CSV exports.
- **Acquired date and notes** (optional).

### Linking magazines to firearms

After adding both, link each magazine to the firearm(s) it fits using the compatibility mapping. The order you set is the order it appears throughout the application — in lists, in the summary, and in exports [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

### Bulk-adding a labeled batch

For large fleets, use the **bulk-add** feature to create many magazines at once. Provide a shared template (brand, model, caliber, capacity) and a label prefix, then specify how many to create [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

Example: prefix `AR-`, quantity `60` → creates magazines labeled `AR-01` through `AR-60`.

Details of how it works [[13]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/bulkadd/labels.ts#L7-L16) [[14]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/bulkadd/service.ts#L25-L29):

- Labels are zero-padded: `AR-01`, `AR-02`, ..., `AR-09`, `AR-10`. The padding width grows automatically when the sequence crosses 99 → 100.
- The counter picks up where it left off. If `AR-01` through `AR-30` already exist and you add 10 more with the same prefix, they start at `AR-31` — no manual tracking required [[15]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/bulkadd/labels.ts#L34-L39).
- All magazines in a batch are created in a single transaction, so a partial failure leaves no orphaned records [[14]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/bulkadd/service.ts#L25-L29).
- If you leave the prefix blank, no labels are applied to the batch.

***

## Sharing Items with Staff and Members

With your inventory populated, share individual items with the accounts you've created. Sharing is per-item and granular: you choose exactly what each user can see or do.

### Permission levels

There are two grant types [[3]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L17):

| Permission | What the grantee can do |
|---|---|
| **view** | Read the item. See it in their magazine/firearm list, summary, and CSV exports. Cannot modify or delete. |
| **edit** | Read and modify the item. Cannot delete it and cannot re-share it with others. |

### Allowing staff to add records on the club's behalf

On an **edit** grant, you can additionally enable **"allow adding records owned by me"** (`allowCreateOnBehalf`). When this is on, the staff member can create new magazines that are owned by your account — not theirs [[4]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L11-L14).

This is the range/club workflow: the operator's account stays the owner of all fleet inventory. Staff add assets on the range's books. Volunteers see those assets without touching them.

> `allowCreateOnBehalf` is only meaningful on edit grants. It has no effect and is forced to `false` on view grants [[4]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L11-L14).

### Revoking access

Revoke a share at any time from the item's share settings. Access is removed on the user's next request — there's no delay [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5). The item disappears from their lists, summary, and any future exports.

### Ownership rules

- Only the item's owner (the club/range account) can **delete** a firearm or magazine [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).
- Edit-grantees cannot re-share items they've been granted access to [[4]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/auth/grants.ts#L11-L14).
- Reads across the system are viewer-relative: anything a user can't see is filtered out of their lists, summary, and CSV exports before it reaches them [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

***

## Day-to-Day Use

Once inventory is populated and shares are configured, day-to-day operation is straightforward.

### Filtering magazines

Use the filter controls to narrow the magazine list by [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5):

- **Brand or model** — find all magazines from a specific manufacturer.
- **Caliber** — exact caliber match.
- **Linked firearm** — show only magazines compatible with a specific firearm.

Filters work across everything the signed-in user can see — including items shared with them.

### Summary view

The **Summary** screen shows [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5):

- A **running total** of all visible magazines.
- **Per-caliber counts** — how many magazines you have in each caliber across the entire fleet.
- **Per-firearm counts** — how many magazines are linked to each firearm.

The summary is viewer-relative: staff and members see counts only over items they have access to.

### Exporting to CSV

Use the **Export** function to download inventory as a CSV file. The export includes [[16]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L10-L20):

| Column | Notes |
|---|---|
| Brand/Model | |
| Caliber | |
| Base Capacity | |
| Extension Rounds | |
| Effective Capacity | Computed from base + extension |
| Label | |
| Acquired Date | `YYYY-MM-DD` format |
| Notes | |
| Compatible Firearms | Visible-resolved firearm names in ordinal order |

**Serial numbers are never included in CSV exports** [[11]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L1-L4). This is intentional — serial numbers are sensitive data and are excluded from all export paths.

**Formula injection protection** is applied to every cell before it's written. A cell that starts with `=`, `+`, `-`, or `@` is prefixed with an apostrophe so it doesn't execute as a formula when someone opens the file in a spreadsheet application [[17]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L5-L7).

Like all reads, exports are viewer-relative: a staff member's export includes only their visible items [[2]](https://app.dosu.dev/documents/ed18151b-de7d-4a7d-9be4-8026d2749ca5).

***

## Security & Backups

### Put MagStacker behind HTTPS

MagStacker uses session cookies for authentication. You **must not** expose the app's HTTP port directly to your network — sign-in sends credentials over the connection, and cookies are transmitted with every request [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

Put MagStacker behind a TLS-terminating reverse proxy. Common options:

- **Caddy** — automatic HTTPS with Let's Encrypt, minimal config.
- **nginx** — widely deployed, flexible.
- **Traefik** — integrates directly with Docker.

Once your proxy is configured, update `BETTER_AUTH_URL` in `.env` to your `https://` address and restart the stack:

```bash
# In .env
BETTER_AUTH_URL=https://magstacker.yourclub.example

# Then restart
docker compose up -d
```

> `BETTER_AUTH_URL` must exactly match the origin the proxy serves. A mismatch causes Better Auth to reject requests with a 403 [[6]](https://app.dosu.dev/documents/ed6267e3-2c79-4bc4-85d2-2a4246a40c88).

Also configure your proxy to forward the real client IP (e.g. via `X-Real-IP`) so the sign-in rate limiter keys on the actual client address rather than the proxy [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).

### Back up your database

Everything — every firearm, magazine, compatibility link, share grant, and user account — lives in Postgres. A standard `pg_dump` is all you need [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3):

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" -Fc -d "$POSTGRES_DB" > magstacker.dump
```

Restoring the dump brings back inventory, ownership, and grant state exactly as it was:

```bash
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" < magstacker.dump
```

Schedule backups with cron or your preferred scheduler. Store backups off the host machine.

### Sensitive data handling

- **Serial numbers** are treated as sensitive data throughout the application and are excluded from all CSV exports [[11]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/src/domain/csv/serialize.ts#L1-L4).
- **`BETTER_AUTH_SECRET`** signs all session tokens. Keep it out of version control and rotate it if you believe it's been exposed. Rotating it invalidates all active sessions [[5]](https://app.dosu.dev/documents/b19d06e9-0886-4a9b-9e94-fccd47bb01a3).
- **`.env`** is excluded from the Docker build context via `.dockerignore`. Never commit it to source control.

### Ports

By default [[7]](https://github.com/unclesp1d3r/mag_stacker/blob/1553a986b122fc5eb77babb713d414da23ed94df/.env.example):

- `APP_HOST_PORT=3000` — the app is published on port 3000 of the host.
- `POSTGRES_HOST_PORT=5544` — Postgres is published for local tooling access.

Your reverse proxy should forward to `APP_HOST_PORT`. You can change either port if there's a conflict with another service. See [`docs/deployment.md`](docs/deployment.md) for more detail on production networking.
