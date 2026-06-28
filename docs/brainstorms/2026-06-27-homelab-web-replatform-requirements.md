---
date: 2026-06-27
topic: homelab-web-replatform
---

# MagStacker Web — Self-Hosted Re-platform Requirements

## Summary

Rebuild MagStacker as a self-hosted web application on Next.js / React / Drizzle / Postgres / Tailwind 4 / Shadcn, deployed as a Docker stack in a homelab. It preserves the existing firearm/magazine/compatibility behavior of the desktop app, adds per-user accounts with owner-scoped data and per-item view+edit sharing between users, and is built on a data model deliberately shaped to grow toward round-count logs, maintenance records, ammunition, and accessories.

This document is descriptive: it states what the system must do and the shape it must have, not how to implement it. The named stack is the established context, not a prescription of code.

## Problem Frame

MagStacker shipped as a desktop app — first Go + Wails, then Avalonia/.NET. The desktop form solved distribution: a thing you hand to other people. But the actual need is the tool itself, run continuously and reached from any device on a home network, not a binary to distribute. A desktop client also can't serve the multi-user and sharing behavior described below.

The homelab is the deployment target: a long-running service the owner controls, behind their own network, backed up on their own terms. That reframes three things the desktop app never had to handle — concurrent users, authentication, and data ownership between people — while the core inventory behavior the desktop app already proved correct stays intact.

The existing behavioral contract is captured in `docs/reference/go-parity-spec.md` and realized in the Avalonia/.NET codebase. That contract is the behavioral floor for this rebuild; the new work is the web platform, accounts, ownership, and sharing layered around it.

## Key Decisions

- **The stack is given, Postgres is chosen.** Next.js/React for the app, Drizzle for data access, Tailwind 4 + Shadcn for UI, all in a Docker stack. The database is Postgres rather than the desktop app's single-file SQLite: concurrent logins, per-item sharing, and a growing schema make the desktop single-writer model the wrong fit, and Postgres is Drizzle's strongest dialect. One additional container is acceptable for a homelab.

- **Authentication is required; the deployment is single-instance, not multi-tenant.** Every user has an account and must authenticate. There is no organization/tenant hierarchy, no tenant routing, no billing — one instance, several people. Functionally this is row-level ownership without SaaS ceremony.

- **Data is owner-scoped by default.** Every owned record carries an owner. A user sees their own inventory; they do not see other users' inventory unless it has been shared with them. This applies to firearms, magazines, and every future owned entity.

- **Sharing is per-item, view + edit.** An owner can grant another user access to a specific item, with a read-only or read-write permission. This is the most capable (and heaviest) sharing model; it was chosen deliberately over whole-inventory or view-only sharing because the audience includes collaborators (household, club, range staff) who need real granularity.

- **Grants live on top-level entities and cascade to children.** A grant attaches to a grantable parent (a firearm, a magazine, and future families like an ammo lot). The parent's attached child records — round-count logs, maintenance entries, accessories, builds — inherit that grant. There is no grant row per child record.

- **The data model is built for expansion.** The schema is shaped around a small set of owned, grantable parent entities plus an extensible pattern for attached child records and new entity families. Future tracking domains (usage/round-count, maintenance/cleaning, ammo/components, accessories/builds) must drop in without reworking ownership, sharing, or the core entities.

- **Behavioral parity is the floor.** All existing inventory behavior — entities, validation semantics, summary, CSV export, search/filter, bulk add, label generation — carries forward unchanged except where the move from a single-user desktop app to a multi-user web app requires it (visibility scoping, web file download instead of a native save dialog, server-enforced validation at the API boundary).

## Actors

- A1. **Enthusiast** — a casual owner cataloguing a personal collection of firearms and magazines. Small inventory, infrequent edits, values simplicity.
- A2. **Competitive shooter** — a power user with many magazines, active labeling, frequent bulk additions, and a real need for the summary and export views. The heaviest single-user.
- A3. **Range fleet operator** — tracks a range's set of rental hardware as an inventory fleet. High volume, multiple staff who need shared edit access to the same fleet, and strong future interest in maintenance and round-count tracking. The customer-facing rental side (checkouts, returns, customer records, billing) is explicitly not this actor's concern here.
- A4. **The system** — authenticates users, enforces ownership and sharing on every read and write, and serves the inventory behavior.

## Requirements

### Platform and deployment

- R1. The application runs as a Docker stack suitable for homelab self-hosting: at minimum the Next.js app and a Postgres database, composable with a single orchestration file.
- R2. Persistent data lives in Postgres; the deployment supports straightforward backup and restore of that data by the operator.
- R3. The application is reachable over the home network from any modern browser; there is no desktop client and no native mobile app.
- R4. No data access leaves the instance. There is no cloud dependency, no external data service, and no telemetry that transmits inventory off the host.
- R5. Database schema changes are applied through a repeatable, versioned migration process so the operator can upgrade the running instance without manual SQL.

### Authentication and ownership

- R6. Every user authenticates before reaching any inventory. Unauthenticated requests reach no owned data.
- R7. Each user has a distinct account. Account provisioning suits a single-instance homelab (operator-managed or self-registration gated by the operator) rather than open public signup.
- R7a. The authentication surface applies abuse protection appropriate to a self-hosted instance: rate limiting / throttling on login and any account-provisioning endpoints to blunt credential-stuffing and brute-force attempts. The mechanism is a planning choice (see OQ5); the requirement is that these endpoints are not left unthrottled.
- R8. Every owned record has exactly one owner. Ownership is set at creation and is the default basis for visibility.
- R9. A user's default view of any inventory list, summary, search, or export is scoped to records they own plus records shared to them. Records owned by others and not shared are never returned.
- R10. There is no organization, tenant, or group hierarchy. Access is the union of a user's own records and their individual grants — nothing else.

### Sharing and visibility

- R11. An owner can grant another user access to a specific grantable item, choosing a permission level of view (read-only) or edit (read-write).
- R12. A grant is per-item, not per-inventory. Granting one firearm does not expose any other record the owner holds.
- R13. A grant on a parent entity cascades to that entity's attached child records. Sharing a firearm shares its (future) round-count logs, maintenance entries, accessories, and builds at the same permission level. Cascade follows only true parent→child attachment (R62); it never follows the magazine↔firearm compatibility relationship, which is a peer many-to-many link rather than a child attachment (see R37a).
- R14. A grantee with view permission can read a shared item and its children but cannot modify them. A grantee with edit permission can read and modify them.
- R15. The owner can revoke a grant at any time; revocation immediately removes the grantee's access to that item and its children.
- R16. Ownership does not transfer through sharing. A grantee, even with edit permission, does not become the owner: the item's stored owner is unchanged, and ownership-only views ("records I own") never list a shared item as theirs. Aggregate views (summary, CSV) are a separate concern and are computed over the viewer's *visible* inventory — owned + shared — per R41 and the viewer-relative rule (R17a); a shared item therefore contributes to a grantee's aggregates without being owned by them. This resolves the former R16↔R41 inconsistency (see Resolved OQ1).
- R17. Deleting a shared item follows the same visibility rules as any other write: who may delete a shared item (owner only, or any edit-grantee) is a defined behavior — see Outstanding Questions.
- R17a. **Viewer-relative resolution.** Every cross-entity computation — compatibility-name resolution, per-firearm magazine counts, per-caliber rollups, CSV columns — is evaluated against the *requesting user's visible set* (owned + shared), never the whole instance. A reference (e.g., a compatibility link) that points at a record outside the viewer's visible set is treated as absent, exactly as the orphaned-link rule (R40). The same underlying data therefore yields different counts and CSV output for different viewers; this is by design, not an inconsistency. This single rule governs three surfaces that the desktop app never had to reconcile: CSV "Compatible Firearms" (R44), the summary per-caliber and per-firearm rollups (R38–R41), and the firearm "# magazines" count (which becomes viewer-dependent when a firearm is shared but the magazines referencing it are not).
- R17b. Deleting an item removes every grant attached to it as part of the same operation; a grant never outlives the item it references, and a revoked or orphaned grant is never left dangling. (Who is permitted to perform that delete remains an Outstanding Question, OQ2.)

### Core inventory: firearms

- R18. A firearm has the fields: `Name` (required), `Manufacturer` (optional), `Caliber` (required), `SerialNumber` (optional), `Notes` (optional). Optional text fields store as empty, not null-ambiguous, and round-trip an explicit cleared value. Text is stored as entered (not trimmed on save); leading/trailing whitespace is collapsed to "empty" only for the purpose of required-field validation (R19), never silently rewritten into the stored value. (This matches the parity validator, which trims for the empty-check but persists the raw value.)
- R19. `Name` and `Caliber` are required; whitespace-only is treated as empty. There is no uniqueness constraint on `Name` — two firearms may share a name and are distinguished by identity.
- R20. Firearm validation returns every failure at once, never first-only. An empty name and an empty caliber both surface in a single validation result.
- R21. Invalid input never reaches the database; validation runs at the service/API boundary before any write.
- R22. The firearms list is ordered by name ascending and is scoped to the requesting user's visibility (R9).
- R23. Deleting a firearm is never blocked by existing magazine links. Its compatibility links are removed; linked magazines survive with that firearm removed from their compatibility set.

### Core inventory: magazines

- R24. A magazine has the fields: `BrandModel` (required), `Caliber` (required), `BaseCapacity` (required, ≥ 1), `ExtensionRounds` (optional, ≥ 0, default 0), `Label` (optional), `AcquiredDate` (optional date), `Notes` (optional), and a set of compatible firearm references (optional).
- R25. `EffectiveCapacity` is derived as `BaseCapacity + ExtensionRounds` and is never stored; it is computed wherever it is shown or exported.
- R26. Magazine validation returns every failure at once and enforces: non-empty `BrandModel`, non-empty `Caliber`, `BaseCapacity ≥ 1`, `ExtensionRounds ≥ 0`. The database also enforces the capacity bounds as a backstop, but domain validation is the primary surface.
- R27. The magazines list is ordered by brand/model ascending and is scoped to the requesting user's visibility (R9).
- R28. `AcquiredDate` is editable in the web UI. (The desktop app persisted and round-tripped this field but never built its editor; the web rebuild closes that gap.) Where the parity implementation stored a full timestamp and formatted it date-only, the web rebuild deliberately narrows the stored type to a calendar date with no time component; it is shown and exported date-only (`YYYY-MM-DD`). This narrowing is an intentional deviation from parity, acceptable because an acquisition date carries no time-of-day semantics.
- R29. There is no uniqueness constraint on `BrandModel` or `Label`; two magazines may share either.

### Magazine ↔ firearm compatibility

- R30. A magazine carries zero or more compatible-firearm references forming a many-to-many relationship between magazines and firearms.
- R31. Creating or updating a magazine replaces its entire compatibility set atomically. Updating to an empty set removes all links.
- R32. A compatibility link must reference an existing firearm; a link to a nonexistent firearm fails and the whole write (including scalar field changes) rolls back. No blank firearm is auto-created to satisfy a link.
- R33. The compatibility set preserves the user-supplied order. That order is stable across reads and drives the order firearms appear in the CSV "Compatible Firearms" column.
- R34. A firearm appears at most once in a magazine's compatibility set; duplicate references are collapsed.
- R35. Deleting either side removes the join rows for that relationship and leaves the other side intact (R23 for firearms; the symmetric rule for magazines).
- R36. There is no caliber-matching constraint between a magazine and its linked firearms; compatibility is a user-asserted convention, not an enforced rule.
- R37. Compatibility links only span records the acting user can see. A user cannot link to a firearm that is neither theirs nor shared to them — see Outstanding Questions for cross-owner linking semantics.
- R37a. The magazine↔firearm compatibility relationship is a peer many-to-many link, not a parent→child attachment, and is therefore **not** a grant-cascade edge: sharing a magazine does not share its compatible firearms, and sharing a firearm does not share the magazines that list it. Only true attached child records (R62) inherit a parent's grant (R13). A direct consequence is that a grantee may hold a shared magazine while some or all of its linked firearms remain invisible to them; those unresolved links are handled by the viewer-relative rule (R17a, R40, R44).

### Inventory insight: summary

- R38. A summary aggregates the user's visible inventory into: total magazine count; magazine count per caliber; summed effective capacity per caliber; and a per-firearm count of how many magazines list that firearm as compatible.
- R39. Per-firearm counts are keyed by firearm identity, not name. Two firearms with the same name produce two distinct entries. A firearm with zero compatible magazines still appears, with count 0.
- R40. A magazine that references a firearm not present in the visible snapshot still contributes to totals and per-caliber counts but creates no phantom per-firearm entry. Under multi-user sharing this is not a rare data-integrity edge case but an expected, routine condition (a grantee may see a shared magazine whose linked firearm was not shared to them); it is the same phenomenon described by the viewer-relative rule (R17a).
- R41. The summary is computed over the requesting user's visible inventory (owned + shared), never the whole instance.
- R42. The summary view presents the total as a headline, a per-caliber breakdown (caliber, magazine count, effective rounds) sorted alphabetically by caliber, and a per-firearm breakdown (name, magazine count) sorted alphabetically by name.

### Inventory insight: CSV export

- R43. Export produces RFC-4180 CSV of the user's visible magazines (magazines only — no firearm rows), with exactly these columns in this order: `Brand/Model`, `Caliber`, `Base Capacity`, `Extension Rounds`, `Effective Capacity`, `Label`, `Acquired Date`, `Notes`, `Compatible Firearms`.
- R44. `Effective Capacity` is the computed sum. `Acquired Date` is formatted date-only (`YYYY-MM-DD`) or empty when unset. `Compatible Firearms` is the linked firearm names joined by `"; "` in the stored order. A reference that does not resolve to a firearm in the *viewer's* visible set is deliberately omitted from the column — consistent with R40 and the viewer-relative rule (R17a) — rather than erroring or leaking the existence of an unshared firearm. This silent omission is an accepted, intentional behavior, not an accident inherited from the desktop app; whether an unresolved link should instead render a non-identifying placeholder is captured in OQ3.
- R45. Serial number is never exported.
- R46. Export carries a formula-injection guard: any cell whose first character could trigger spreadsheet formula evaluation is neutralized before quoting. Standard RFC-4180 escaping applies to values containing commas, quotes, or newlines.
- R47. An empty (or empty-after-scoping) inventory exports a header row with no data rows.
- R48. Export is delivered as a browser file download (the web equivalent of the desktop native save dialog); the service produces the CSV string and the client triggers the download. A default filename is offered.

### Inventory insight: search and filter

- R49. The magazine list supports three optional, AND-combined filters: brand/model (case-insensitive substring), caliber (exact match), and compatible-firearm (magazines linked to a chosen firearm). A request with no filters returns the full visible list.
- R50. Substring matching treats user input literally; pattern metacharacters in the query are escaped so they match as ordinary characters.
- R51. There is no search or filter on the firearms list; it is always the full visible set ordered by name.
- R52. When a firearm-filter control must distinguish two same-named firearms, it uses a stable non-sensitive disambiguator (e.g., a short identity fragment), never the serial number. (This corrects a privacy leak noted in the parity spec.)

### Inventory insight: bulk add

- R53. Bulk add creates N magazines from one template, where N is validated to the range 1–1000. Validation of the template runs with the requested count and rejects counts below 1 or above 1000, alongside the normal magazine field validation, before any write.
- R54. With a non-empty label prefix, generated labels are `<prefix><N>` with zero-padded sequence numbers; pad width is at least 2 and widens to fit the largest number emitted. With an empty/whitespace prefix, generated labels are empty (no numbering).
- R55. Repeat bulk adds with the same prefix continue the sequence past the highest existing numbered label with that prefix, rather than restarting. Labels that are the bare prefix, carry a non-numeric suffix, or carry a zero/negative number are ignored when finding the next start.
- R56. Each generated magazine is an independent copy of the template — its own identity and label, and a deep copy of the compatibility set (no shared references between generated rows).
- R57. Bulk add is atomic: either all N magazines commit or none do.
- R58. Newly created magazines are owned by the acting user. Bulk add over a shared inventory follows the same ownership rule — see Outstanding Questions for whether an edit-grantee's bulk add is owned by them or the parent owner.

### Reference data

- R59. The app provides curated reference lists for caliber suggestions and manufacturer suggestions, available to all users and independent of any user's inventory. Reference data is not owned, not shared, and never user-writable through these lists. The curated lists carry the parity contents (≈107 standard calibers, ≈188 manufacturers), are de-duplicated case-sensitively and sorted ascending, and exclude blank lines and section headers. They are exposed as fresh, immutable copies so no caller can mutate the shared source (consistent with the project's immutability posture).
- R60. The caliber input suggestions show the union of the curated calibers and the calibers already present in the user's visible inventory, de-duplicated and sorted. The manufacturer input shows the curated manufacturers. The caliber filter control shows only calibers present in the user's visible inventory.

### Data model extensibility

- R61. The data model is organized around a small set of owned, grantable parent entities. Firearms and magazines are the first two; the model must admit new parent families (e.g., ammunition/components, accessories) without changing how ownership or sharing work.
- R62. The model supports attached child records that hang off a parent entity, inherit the parent's owner, and inherit the parent's grants (R13). Future round-count/usage logs and maintenance/cleaning logs are this shape — dated event records attached to a firearm.
- R63. Adding a future tracking domain must not require reworking authentication, ownership, sharing, or the existing core entities. The seams for these domains exist in the model's shape even though the domains themselves are out of scope for this document (see Scope Boundaries).
- R64. Identifiers are application-meaningful and stable across the lifetime of a record so that references (compatibility links, grants, future attachments) remain valid.

### Security and privacy posture

- R65. Serial number is treated as sensitive: excluded from CSV export (R45) and never used as a UI disambiguator (R52). In a shared context, a grantee who can see a firearm can see its serial; serial visibility is not separately gated by default — see Outstanding Questions.
- R66. All ownership and sharing checks are enforced server-side on every read and write. Client-side scoping is a convenience, never the enforcement boundary.
- R67. Validation is enforced server-side at the API boundary regardless of any client-side validation mirrored for live feedback.
- R68. Every list-returning operation returns an explicit empty collection, never a null/absent value, so the API surface is uniform.

### Write semantics and reliability

- R69. Create and bulk-create operations are safe against duplicate submission. Because a web client submits over the network — with latency, retries, and double-clicks, where the desktop app relied on a synchronous in-process guard — the server must prevent a single user action from committing twice, via an idempotency key, a short server-side dedup window, or equivalent. This is distinct from atomicity (R57): an atomic bulk add that runs twice still wrongly creates 2N records.
- R70. Updating or deleting a record that does not exist, or that is outside the requester's visible set, fails cleanly and never creates a row; there is no implicit upsert. A write targeting a record the requester cannot see is indistinguishable from not-found and never reveals the record's existence.

### Carried-forward UX behaviors

- R71. The following parity UX behaviors carry forward as product intent and are detailed during planning, not dropped: the brand/model search input is debounced before querying (parity used 250 ms); a keyboard accelerator focuses the search box when no input is focused (parity used `/`); the firearms list shows the serial column only when at least one visible firearm has a non-blank serial; magazine-form defaults (parity: base capacity 10, extension 0, count 2, empty prefix) and the single/bulk toggle with label preview; and forms run client-side validation mirroring the server for live feedback (R67). Exact values and interactions are a planning concern; their omission from the requirement bodies above is not a decision to drop them.

### Non-functional expectations

- R72. The deployment targets a small, trusted user base (household, club, or single range — see Assumptions) but must remain responsive at realistic single-instance scale: low tens of accounts, and thousands of magazines and firearms per owner for the fleet-operator actor (A3). List, summary, search, and export operations must stay interactive at that volume, which implies indexed visibility/ownership lookups rather than per-request full-instance scans.
- R73. Backup and restore (R2) have a stated operator expectation: the entire inventory, ownership, and grant state is recoverable from a standard Postgres backup with no application-specific export step, and a restore reproduces visibility and sharing exactly. No specific RPO/RTO is mandated for a homelab, but a restore is all-or-nothing and internally consistent.
- R74. When the database is unreachable, store-backed operations fail with a clear, non-leaking error and the application surfaces an unavailable state rather than partial or fabricated data. Purely computational endpoints that need no database (e.g., reference-data lists, stateless validation) remain available, mirroring the parity implementation's pure-method guarantee.

## Key Flows

- F1. Sign in and land on inventory
  - **Trigger:** A user opens the app.
  - **Actors:** A1/A2/A3, A4
  - **Steps:** The system requires authentication; on success it shows the user's visible inventory (owned + shared), scoped per R9.
  - **Covered by:** R6, R7, R9

- F2. Add a firearm
  - **Trigger:** A user submits the firearm form.
  - **Actors:** A1/A2/A3, A4
  - **Steps:** The client mirrors validation for live feedback; the server validates (returning all failures), assigns ownership to the acting user, and persists. Invalid input is rejected before any write.
  - **Covered by:** R18, R20, R21, R8

- F3. Bulk add magazines
  - **Trigger:** A power user (often A2/A3) requests N magazines from a template with an optional label prefix.
  - **Actors:** A2/A3, A4
  - **Steps:** The server validates the template with count N (1–1000), computes the next label sequence start for the prefix, generates N independent magazines with cascade-safe copies, and commits them atomically as the user's records.
  - **Covered by:** R53, R54, R55, R56, R57, R58

- F4. Share an item with edit access
  - **Trigger:** An owner grants another user access to a specific firearm or magazine.
  - **Actors:** owner (A1/A2/A3), grantee, A4
  - **Steps:** The owner selects the item, the grantee, and a permission (view or edit). The grant is recorded on the parent and applies to its children. The grantee now sees the item in their visible inventory at the granted permission.
  - **Covered by:** R11, R12, R13, R14

- F5. Range staff collaborate on a fleet
  - **Trigger:** A range operator shares fleet items with staff at edit permission.
  - **Actors:** A3 (operator + staff), A4
  - **Steps:** Staff with edit grants read and modify the shared fleet records; revocation immediately removes access. The customer-facing rental lifecycle is not part of this flow.
  - **Covered by:** R11, R13, R14, R15

- F6. Export visible inventory to CSV
  - **Trigger:** A user requests an export.
  - **Actors:** A1/A2/A3, A4
  - **Steps:** The server serializes the user's visible magazines into RFC-4180 CSV with the fixed columns, applies the injection guard, and the client downloads the file. Serial number is absent.
  - **Covered by:** R43, R44, R45, R46, R48

## Acceptance Examples

- AE1. **Covers R20, R26.** Submitting a firearm with empty name and empty caliber returns both failures together, not just the first. Submitting a magazine with blank brand/model, blank caliber, base capacity 0, and extension rounds -1 returns all four failures.
- AE2. **Covers R25, R44.** A magazine with base capacity 15 and extension rounds 2 reports effective capacity 17 in both the summary and the CSV; the value is never stored.
- AE3. **Covers R9, R41.** User B's summary and lists reflect only B's owned records plus records shared to B; records A owns and has not shared to B do not appear in any of B's totals, lists, search results, or export.
- AE4. **Covers R13, R14.** When A shares a firearm to B with edit permission, B can edit that firearm and (once they exist) its attached maintenance/round-count records. With view permission, B can read but not modify them.
- AE5. **Covers R15.** After A revokes B's grant on an item, B's next request no longer returns that item or its children.
- AE6. **Covers R32.** Updating a magazine with a compatibility link to a nonexistent firearm fails the whole update; the magazine's other field changes do not persist.
- AE7. **Covers R39, R40.** Two firearms named identically but with distinct identities produce two separate per-firearm summary entries. A magazine referencing a firearm absent from the visible snapshot still counts toward totals but adds no per-firearm entry.
- AE8. **Covers R54, R55.** First bulk add of 3 with prefix `AR-` yields `AR-01, AR-02, AR-03`; a later bulk add of 2 with the same prefix yields `AR-04, AR-05`. A bulk add reaching number 100 widens the pad to `AR-001 … AR-100`. An empty prefix yields empty labels.
- AE9. **Covers R45, R46.** A magazine whose notes begin with `=` are neutralized so a spreadsheet does not evaluate them; the firearm serial number never appears in any export column.
- AE10. **Covers R47.** A user with no visible magazines exports a single header row and no data rows.

## Scope Boundaries

### Deferred for later

- The future tracking domains themselves — usage/round-count logs, maintenance/cleaning logs, ammunition/components, accessories/builds. This document specifies the data-model *seams* that must accommodate them (R61–R63), not the domains' fields, flows, or UI.
- Per-child independent grants (rejected in favor of parent-cascade for now; reconsider only if a concrete need appears).
- Ownership transfer between users (sharing is the only cross-user mechanism here).

### Outside this product's identity

- Cloud/SaaS hosting, commercialization, and billing. This is a self-hosted homelab tool.
- Multi-tenant organization/tenant hierarchy. Access is owner records plus individual grants — nothing organizational.
- A desktop client or native mobile app. The web app is the only client.
- Customer-facing range operations — rental checkout/return, customer records, reservations, point-of-sale. A range operator tracks its *fleet* here; it does not run its rental counter here.

## Dependencies / Assumptions

- The behavioral contract has two layers, both vendored into this repo so nothing points outside it. `docs/reference/go-parity-spec.md` captures the original Go behavior; the Avalonia/.NET implementation realized that contract and extended it. Its beyond-parity behaviors are distilled in `docs/reference/dotnet-extensions.md`, its steering doc is at `docs/reference/dotnet-port-agents.md`, and its decision records are at `docs/adr/`. Where the Go and .NET layers agree, the parity spec's detail (exact validation codes, CSV escaping, label algorithm) stands. Where the .NET implementation deliberately goes beyond the Go spec — the CSV formula-injection guard (R46), the join ordinal that makes compatibility order deterministic (R33), and the collapsing of duplicate compatibility references (R34) — the .NET implementation is authoritative; these three behaviors are documented in `docs/reference/dotnet-extensions.md` and are not present in the Go parity spec.
- The operator runs and maintains the Docker stack on their own network, including Postgres backups and upgrades.
- The user base is small (household, club, or single range), which is why owner records + individual grants is sufficient and no organizational tier is needed.
- Account provisioning is operator-controlled; this is not an open public-signup product.

## Outstanding Questions

### Resolved during requirements review

- OQ1 (resolved). **Shared items in ownership aggregates.** Decided: aggregate views (summary, CSV) are computed over the viewer's *visible* inventory — owned + shared — per R41 and R17a, while ownership-only views ("records I own") exclude shared items per R16. CSV export (R44) follows the same owned+shared visibility. This removes the former R16↔R41 contradiction; the requirement bodies above now state this single answer.

### Resolve before planning

- OQ2. **Delete authority on shared items (R17).** Can an edit-grantee delete a shared item (and cascade its children), or is delete owner-only while edit-grantees may only modify? This affects how destructive an edit grant is.
- OQ3. **Cross-owner compatibility links and shared-magazine visibility (R37, R37a).** Two linked sub-questions: (a) *Link lifecycle* — when A links their magazine to a firearm shared to them by B, what happens if B later revokes the grant or deletes the firearm? Define whether such links are allowed at all, and the cleanup behavior when the referenced firearm leaves A's visibility. (b) *Grantee's view* — when A shares a magazine to B whose compatibility set points at firearms A has not shared, those linked firearm names are invisible to B and are omitted from B's views (R17a, R44); confirm that omission is acceptable, or decide whether a non-identifying placeholder should appear instead. Note R37a already settles that grants never cascade across compatibility links; this OQ is only about link lifecycle and how the grantee sees unresolved links.
- OQ4. **Ownership of records created by an edit-grantee (R58).** If B (edit grant on A's inventory context) creates or bulk-adds magazines, are those owned by B or by A? This determines whose visibility and summaries the new records land in.

### Deferred to planning

- OQ5. Authentication mechanism specifics (sessions vs tokens, password vs external identity) — a planning/implementation choice, constrained only by R6/R7/R66.
- OQ6. Account provisioning UX (operator invites, gated self-registration) — shape during planning within the operator-controlled assumption.
- OQ7. Whether serial visibility warrants a separate gate even among grantees (R65) — defaulted to "no separate gate"; revisit if a concrete privacy need surfaces.

## Sources / Research

- `docs/reference/go-parity-spec.md` — the behavioral contract this rebuild inherits (entities, validation semantics, summary, CSV, search/filter, bulk add, label generation, cross-cutting invariants).
- `docs/reference/dotnet-port-agents.md` — the .NET port's steering doc: project framing, domain field summary, and the immutability/persistence posture of the existing port. (This is a copy of the .NET project's `AGENTS.md`; this repo's own `AGENTS.md` is the Next.js scaffold note and is a different document.)
- `docs/reference/dotnet-extensions.md` — the three behaviors the Avalonia/.NET port added beyond the Go parity spec: the CSV formula-injection guard (R46), compatibility order via a join ordinal (R33), and duplicate-reference collapse (R34). (Distilled from the .NET source, which is no longer vendored here.)
- `docs/adr/` — cross-entity decisions (inventory service for cross-entity reads; join ordinal for deterministic CSV order; service-returns-string/UI-writes-file export split) that inform the web service boundary.
