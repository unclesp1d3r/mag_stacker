---
date: 2026-06-18
topic: go-parity-spec
source_repo: ../MagStacker
note: Captured from live Go source. The Go app remains canonical when reachable. Update this document when behavior changes upstream.
---

# MagStacker Go Parity Spec

This document is the behavioral contract for the .NET port. It answers "what must the .NET implementation do?" without prescribing Go idioms. Cite notation `internal/path.go:line` is repo-relative to `../MagStacker`.

---

## 1. Source Map

| File                                     | Role                                              |
| ---------------------------------------- | ------------------------------------------------- |
| `internal/domain/models.go`              | Domain entity definitions                         |
| `internal/domain/validation.go`          | Validation rules and error codes                  |
| `internal/domain/validation_test.go`     | Acceptance examples for validation                |
| `internal/domain/summary.go`             | Summary aggregation logic                         |
| `internal/domain/summary_test.go`        | Acceptance examples for Summary                   |
| `internal/domain/bulkadd.go`             | Label generation for bulk add                     |
| `internal/domain/bulkadd_test.go`        | Acceptance examples for label generation          |
| `internal/domain/csvexport.go`           | CSV serialization                                 |
| `internal/domain/csvexport_test.go`      | Acceptance examples for CSV output                |
| `internal/db/models.go`                  | Persistence model definitions + join table        |
| `internal/db/store.go`                   | Database open/close, schema migration             |
| `internal/db/firearms.go`                | Firearm CRUD store operations                     |
| `internal/db/magazines.go`               | Magazine CRUD + bulk-create store operations      |
| `internal/db/queries.go`                 | Filtered list, distinct calibers, inventory load  |
| `internal/db/mapping.go`                 | Domain ↔ persistence model mapping                |
| `internal/db/firearms_test.go`           | Firearm store acceptance examples                 |
| `internal/db/magazines_test.go`          | Magazine store acceptance examples                |
| `internal/db/queries_test.go`            | Filter and query acceptance examples              |
| `internal/db/store_test.go`              | Schema, cascade, FK acceptance examples           |
| `internal/db/mapping_test.go`            | Round-trip mapping acceptance examples            |
| `internal/app/service.go`                | Application service (UI-facing boundary)          |
| `internal/app/service_test.go`           | Service-layer acceptance examples                 |
| `internal/refdata/refdata.go`            | Curated reference data (calibers, manufacturers)  |
| `internal/refdata/refdata_test.go`       | Reference data acceptance examples                |
| `app.go`                                 | Wails shim + CSV export dialog                    |
| `app_test.go`                            | File-write acceptance examples                    |
| `frontend/src/views/SummaryView.tsx`     | Summary UI rendering (caliber rows, firearm rows) |
| `frontend/src/views/MagazinesView.tsx`   | Magazine list, filter, bulk add UX                |
| `frontend/src/views/MagazineFilters.tsx` | Filter controls semantics                         |
| `frontend/src/views/FirearmsView.tsx`    | Firearm list columns, serial visibility           |
| `frontend/src/views/MagazineForm.tsx`    | Magazine form + bulk toggle UX                    |
| `frontend/src/api/validationMessages.ts` | User-facing validation error text                 |

---

## 2. Domain Entities

### 2.1 Firearm

**Already mirrored in the .NET slice.**

| Field          | Type            | Required           | Notes                                                 |
| -------------- | --------------- | ------------------ | ----------------------------------------------------- |
| `ID`           | `string` (UUID) | Assigned on create | Empty string on create input triggers UUID assignment |
| `Name`         | `string`        | Yes                | Whitespace-only treated as empty                      |
| `Manufacturer` | `string`        | No                 | May be empty                                          |
| `Caliber`      | `string`        | Yes                | Whitespace-only treated as empty                      |
| `SerialNumber` | `string`        | No                 | Never exported to CSV (sensitive)                     |
| `Notes`        | `string`        | No                 | May be empty                                          |

Sources: `internal/domain/models.go:9-16`, `internal/db/models.go:7-14`

**Validation — already mirrored:**

| Condition                             | Error code     |
| ------------------------------------- | -------------- |
| `Name` is empty or whitespace-only    | `emptyName`    |
| `Caliber` is empty or whitespace-only | `emptyCaliber` |

- Returns **all** failures, not first-only. (`internal/domain/validation.go:59-68`)
- Validation is triggered at the application boundary before any store write. An invalid input must never touch the database. (`internal/app/service.go:54-56`)
- Trimming is applied inside the validator (not stored trimmed — the validator checks `strings.TrimSpace`). (`internal/domain/validation.go:61-67`)

### 2.2 Magazine

| Field                  | Type                               | Required           | Notes                                                      |
| ---------------------- | ---------------------------------- | ------------------ | ---------------------------------------------------------- |
| `ID`                   | `string` (UUID)                    | Assigned on create | Empty string on create input triggers UUID assignment      |
| `BrandModel`           | `string`                           | Yes                | Whitespace-only treated as empty                           |
| `Caliber`              | `string`                           | Yes                | Whitespace-only treated as empty                           |
| `BaseCapacity`         | `int`                              | Yes                | Must be ≥ 1                                                |
| `ExtensionRounds`      | `int`                              | No                 | Must be ≥ 0 (default 0)                                    |
| `Label`                | `string`                           | No                 | Used for physical labeling; auto-generated on bulk add     |
| `AcquiredDate`         | `*time.Time` / nullable `DateTime` | No                 | Stored as full timestamp, formatted as `YYYY-MM-DD` in CSV |
| `Notes`                | `string`                           | No                 | May be empty                                               |
| `CompatibleFirearmIDs` | `[]string`                         | No                 | IDs of linked firearms (many-to-many); empty list is valid |

Sources: `internal/domain/models.go:19-42`

**Derived field (not stored):**

- `EffectiveCapacity = BaseCapacity + ExtensionRounds` (`internal/domain/models.go:34-36`)

**Validation rules:**

| Condition                                | Error code                |
| ---------------------------------------- | ------------------------- |
| `BrandModel` is empty or whitespace-only | `emptyBrandModel`         |
| `Caliber` is empty or whitespace-only    | `emptyCaliber`            |
| `BaseCapacity < 1`                       | `baseCapacityTooLow`      |
| `ExtensionRounds < 0`                    | `negativeExtensionRounds` |
| `addCount < 1`                           | `addCountTooLow`          |
| `addCount > 1000`                        | `addCountTooHigh`         |

Sources: `internal/domain/validation.go:27-48`

- Returns **all** failures, not first-only. (`internal/domain/validation.go:26`)
- `addCount` is a context parameter: pass `1` for single add/edit, pass the requested count for bulk add. (`internal/domain/validation.go:26`)
- `MaxBulkAddCount = 1000`. (`internal/domain/validation.go:23`)
- The database also enforces `base_capacity >= 1` and `extension_rounds >= 0` as CHECK constraints — these are a last-resort backstop, not the primary validation surface. (`internal/db/models.go:32-33`)

### 2.3 Inventory (snapshot type)

A snapshot pairing `[]Firearm` and `[]Magazine`, used only for in-memory computations (Summary, CSV export). Never persisted directly. (`internal/domain/models.go:38-43`)

### 2.4 Summary (derived, not stored)

Computed from an Inventory snapshot. See section 7.

### 2.5 FirearmCount (derived, not stored)

| Field   | Type     | Notes                               |
| ------- | -------- | ----------------------------------- |
| `ID`    | `string` | Firearm ID — identity key, not name |
| `Name`  | `string` | Firearm name for display            |
| `Count` | `int`    | Number of compatible magazines      |

Source: `internal/domain/summary.go:5-9`

---

## 3. Magazine↔Firearm Many-to-Many Relationship

### 3.1 Data model

- Join table: `magazine_firearm`
- Columns: `magazine_id` (FK → `magazine.id`), `firearm_id` (FK → `firearm.id`)
- Both FKs enforce `ON DELETE CASCADE`.

Source: `internal/db/models.go:36`

### 3.2 Linking behavior

- A magazine carries zero or more `CompatibleFirearmIDs` (a list of firearm IDs).
- Creating or updating a magazine replaces the entire link set atomically.
- Updating to an empty `CompatibleFirearmIDs` removes all links.

Sources: `internal/db/magazines.go:96-121`, `internal/db/magazines_test.go:391-416`

### 3.3 Delete cascade semantics (critical)

| Operation             | Effect on the other entity      | Effect on join rows                                     |
| --------------------- | ------------------------------- | ------------------------------------------------------- |
| Delete a **firearm**  | Magazine rows are **untouched** | Join rows referencing the deleted firearm cascade away  |
| Delete a **magazine** | Firearm rows are **untouched**  | Join rows referencing the deleted magazine cascade away |

Sources: `internal/db/firearms.go:64-66`, `internal/db/magazines.go:123-125`, `internal/db/store_test.go:104-153`

No deletion is blocked because the other side exists. A firearm with linked magazines may be freely deleted; its magazines survive with empty `CompatibleFirearmIDs`.

### 3.4 Link-write integrity rules

- Linking a magazine to a nonexistent firearm ID **must fail** with a foreign-key constraint error.
- The link write must use PK-only stubs so it never blanks or upserts existing firearm columns.
- On update, if the scalar column write succeeds but the link replacement fails, the entire update must roll back (transaction atomicity).

Sources: `internal/db/magazines.go:29`, `internal/db/magazines_test.go:85-101`, `internal/db/magazines_test.go:257-283`

### 3.5 Bulk-create atomicity

- `CreateMagazines` (bulk add) runs all inserts inside a single transaction.
- If any row fails (e.g., duplicate PK or FK violation), the entire transaction rolls back — zero rows committed.

Source: `internal/db/magazines.go:37-56`, `internal/db/magazines_test.go:162-174`

---

## 4. Reference Data

Two curated, embedded lists are provided by `internal/refdata`:

| List              | Count       | Purpose                                     |
| ----------------- | ----------- | ------------------------------------------- |
| Standard calibers | 107 entries | Dropdown / autocomplete suggestion in forms |
| Manufacturers     | 188 entries | Dropdown suggestion in firearm form         |

Sources: `internal/refdata/refdata_test.go:9-16`, `internal/refdata/refdata_test.go:33-38`

**Parsing rules (both lists):**

1. Split on newlines.
2. Trim each line.
3. Drop blank lines.
4. Drop section headers (calibers.txt has headers: `"Cartridge"`, `"Common Rifle Caliber Name"`, `"Handgun Cartridge"`; manufacturers.txt has none).
5. De-duplicate case-sensitively.
6. Sort ascending.
7. Return a fresh copy on every call (callers cannot mutate the cached slice).

Source: `internal/refdata/refdata.go:47-71`

**How reference data is consumed by the UI:**

- The caliber dropdown in both forms shows the **union** of `StandardCalibers()` and `DistinctCalibers()` (calibers already in the user's database), de-duplicated and sorted. (`frontend/src/api/refdata.ts`, `frontend/src/views/MagazinesView.tsx:152`)
- The manufacturer dropdown in the firearm form shows `Manufacturers()` only. (`frontend/src/views/FirearmsView.tsx:26`)
- The caliber **filter** dropdown (magazine list) shows only `DistinctCalibers()` — existing data only. (`frontend/src/views/MagazinesView.tsx:151`)
- Reference data is pure (no store needed) and never fails. (`internal/app/service.go:191-198`)

---

## 5. Persistence / Store Contract

### 5.1 Database

- SQLite, single file at `<UserConfigDir>/MagStacker/magstacker.db` on first run.
- Directory created with mode `0700` on first run.
- Foreign keys enforced via `PRAGMA foreign_keys = 1` on every connection.
- `MaxOpenConns = 1` (single-writer constraint for SQLite desktop use).
- Schema auto-migrated on open: tables `firearm`, `magazine`, `magazine_firearm`.

Source: `internal/db/store.go:38-57`

### 5.2 ID generation

- UUIDs (v4) are assigned by the store layer if the incoming ID is empty.
- Callers may supply a non-empty ID; the store does not override it.

Sources: `internal/db/firearms.go:14-23`, `internal/db/magazines.go:24-33`

### 5.3 Not-found semantics

- A sentinel error `ErrNotFound` is returned (wrap-compatible) when Get, Update, or Delete targets a row that does not exist.
- Callers test with `errors.Is(err, db.ErrNotFound)`.
- Update of a nonexistent row must never insert (no upsert behavior at the store layer).

Source: `internal/db/store.go:26`

### 5.4 List ordering

| List                    | Order             |
| ----------------------- | ----------------- |
| `ListFirearms`          | `name ASC`        |
| `ListMagazines`         | `brand_model ASC` |
| `ListMagazinesFiltered` | `brand_model ASC` |

Sources: `internal/db/firearms.go:39-44`, `internal/db/magazines.go:82-89`, `internal/db/queries.go:37`

### 5.5 Empty-list semantics

- All list operations return a non-nil empty slice when no rows exist (marshals to `[]` not `null`).

Sources: `internal/db/firearms_test.go:54-77`, `internal/db/magazines_test.go:360-389`

### 5.6 Zero-value field preservation on update

- Update operations must persist zero-value optional fields. If a user clears `Manufacturer`, `Notes`, or `ExtensionRounds` to empty/zero, the cleared value must be written (not silently skipped by an ORM's dirty-field check).

Source: `internal/db/firearms_test.go:87-109`, `internal/db/magazines_test.go:103-131`

### 5.7 Distinct calibers

- `DistinctCalibers()` returns the sorted, de-duplicated union of non-empty calibers from both the `firearm` and `magazine` tables.
- Blank calibers are excluded from the result.

Sources: `internal/db/queries.go:64-93`, `internal/db/queries_test.go:176-205`

---

## 6. Application / Service Surface

All methods below live on `app.Service` (`internal/app/service.go`) and constitute the boundary the UI calls.

| Method             | Signature                                                              | Description                                                                                         |
| ------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `FirearmsList`     | `() → ([]Firearm, error)`                                              | Returns all firearms (ordered by name).                                                             |
| `FirearmUpsert`    | `(Firearm) → (Firearm, error)`                                         | Validates, then creates (empty ID) or updates. Returns validation error if invalid; does not write. |
| `FirearmDelete`    | `(id string) → error`                                                  | Deletes firearm; returns `ErrNotFound` if absent.                                                   |
| `ValidateFirearm`  | `(Firearm) → []string`                                                 | Returns validation codes without writing. Pure; works with no open store.                           |
| `MagazinesList`    | `(MagazineFilter) → ([]Magazine, error)`                               | Returns magazines matching filter; zero filter = all.                                               |
| `MagazineUpsert`   | `(Magazine) → (Magazine, error)`                                       | Validates with addCount=1, then creates or updates.                                                 |
| `MagazinesBulkAdd` | `(tmpl Magazine, count int, labelPrefix string) → ([]Magazine, error)` | Validates template with addCount=count, generates labels, inserts N magazines in one transaction.   |
| `MagazineDelete`   | `(id string) → error`                                                  | Deletes magazine; returns `ErrNotFound` if absent.                                                  |
| `ValidateMagazine` | `(Magazine, addCount int) → []string`                                  | Returns validation codes without writing. Pure; works with no open store.                           |
| `InventorySummary` | `() → (Summary, error)`                                                | Loads full inventory, computes Summary.                                                             |
| `ExportCSV`        | `() → (string, error)`                                                 | Loads full inventory, serializes to RFC-4180 CSV string.                                            |
| `DistinctCalibers` | `() → ([]string, error)`                                               | Returns sorted distinct calibers from both tables.                                                  |
| `StandardCalibers` | `() → []string`                                                        | Returns curated caliber list. Never fails.                                                          |
| `Manufacturers`    | `() → []string`                                                        | Returns curated manufacturer list. Never fails.                                                     |

Source: `internal/app/service.go`

**Validation orchestration:**

- Save methods run domain validation and join all failure codes into a single error (`"validation failed: code1, code2"`) before touching the store.
- The `Validate*` methods expose the same rules as raw string codes for live UI feedback.
- Both surfaces return the same domain logic; they are not independent implementations.

Source: `internal/app/service.go:231-247`

**Database-unavailable guard:**

- If the database failed to open at startup, every store-backed method returns `"database unavailable: <original error>"`.
- Pure methods (`ValidateFirearm`, `ValidateMagazine`, `StandardCalibers`, `Manufacturers`) work regardless of store state.

Source: `internal/app/service.go:209-219`

---

## 7. Summary View

The Summary is computed in memory from a full inventory snapshot. It is never persisted.

### 7.1 Summary fields

| Field                        | Type             | Description                                                                                   |
| ---------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `TotalMagazines`             | `int`            | Total count of all magazines.                                                                 |
| `CountByCaliber`             | `map[string]int` | Magazine count keyed by caliber string.                                                       |
| `FirearmCounts`              | `[]FirearmCount` | One entry per firearm (including those with zero magazines), in the snapshot's firearm order. |
| `EffectiveCapacityByCaliber` | `map[string]int` | Sum of `EffectiveCapacity` per caliber.                                                       |

Source: `internal/domain/summary.go:12-21`

### 7.2 Computation rules

- `TotalMagazines` = `len(magazines)`. (`internal/domain/summary.go:49`)
- `CountByCaliber[caliber]` = count of magazines whose `Caliber` == that caliber. (`internal/domain/summary.go:28`)
- `EffectiveCapacityByCaliber[caliber]` = sum of `(BaseCapacity + ExtensionRounds)` for all magazines of that caliber. (`internal/domain/summary.go:29`)
- `FirearmCounts` = one entry per firearm in the snapshot, keyed by ID (not name). Count = number of magazines that list the firearm's ID in `CompatibleFirearmIDs`. Firearms with zero matching magazines appear with count 0. (`internal/domain/summary.go:34-47`)
- Two firearms with the same name but different IDs produce two distinct entries. (`internal/domain/summary_test.go:63-77`)
- A magazine that references a firearm ID not present in the snapshot still contributes to `TotalMagazines` and `CountByCaliber` but does not create a phantom entry in `FirearmCounts`. (`internal/domain/summary_test.go:89-98`)

### 7.3 UI rendering (behavior, not layout)

- The UI displays `TotalMagazines` as a headline count.
- Caliber breakdown: one row per caliber with columns: caliber name, magazine count, effective rounds. Rows sorted alphabetically by caliber.
- Firearm breakdown: one row per firearm with columns: firearm name, magazine count. Rows sorted alphabetically by firearm name.
- The "Export CSV" button triggers the save dialog; user cancellation is a no-op (no error).

Source: `frontend/src/views/SummaryView.tsx:156-185`, `app.go:90-112`

---

## 8. Search / Filter

### 8.1 Magazine list filter

The `MagazineFilter` struct has three axes; all are optional and combine with AND. A zero-value filter returns all magazines.

| Axis               | Field        | Match semantics                                                                               |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------- |
| Brand/model search | `BrandModel` | Case-insensitive substring (SQLite `LIKE`, LIKE metacharacters `%` `_` `\` escaped literally) |
| Caliber            | `Caliber`    | Exact match (case-sensitive equality)                                                         |
| Firearm            | `FirearmID`  | Magazines linked to this firearm ID (join on `magazine_firearm`)                              |

Sources: `internal/db/queries.go:14-41`, `internal/db/queries_test.go`

**LIKE escaping:** `%` → `\%`, `_` → `\_`, `\` → `\\`; paired with `ESCAPE '\'`. (`internal/db/queries.go:45-48`)

**Brand/model filter debounce:** The UI debounces the search input by 250 ms before issuing the query. (`frontend/src/views/MagazinesView.tsx:20`)

**Keyboard accelerator:** Pressing `/` when no input is focused moves focus to the brand/model search box. (`frontend/src/views/MagazinesView.tsx:88-110`)

### 8.2 Firearm filter dropdown disambiguation

When two firearms share the same name, the dropdown appends a disambiguator: serial number if present, otherwise caliber.

Source: `frontend/src/views/MagazineFilters.tsx:80-95`

> **Privacy/uniqueness tradeoff (port note):** this Go behavior surfaces the serial number — treated as
> sensitive elsewhere (CSV export deliberately omits it, §9.2) — into the filter dropdown whenever names
> collide, and the caliber fallback is not guaranteed unique (two same-name, same-caliber firearms with
> blank serials stay ambiguous). The .NET firearm-filter slice (deferred) should prefer a stable
> non-sensitive disambiguator (e.g. a short ID fragment) rather than re-export the serial; documented
> here so the parity port does not silently inherit the leak.

### 8.3 No firearm search / filter

There is no search or filter on the firearms list. The list is always the full set ordered by name.

---

## 9. CSV Export

### 9.1 Format

- RFC-4180 CSV with LF line endings (Go `encoding/csv` default).
- Fields containing commas, double-quotes, or newlines are quoted and internal quotes doubled (`"Brand, ""Special"""`).
- One header row followed by one data row per magazine.
- The entity exported is **magazines only** (not firearms).

Source: `internal/domain/csvexport.go:22-64`

### 9.2 Column order (exact)

| Column index | Header                | Source                                                                 |
| ------------ | --------------------- | ---------------------------------------------------------------------- |
| 0            | `Brand/Model`         | `Magazine.BrandModel`                                                  |
| 1            | `Caliber`             | `Magazine.Caliber`                                                     |
| 2            | `Base Capacity`       | `Magazine.BaseCapacity` (integer string)                               |
| 3            | `Extension Rounds`    | `Magazine.ExtensionRounds` (integer string)                            |
| 4            | `Effective Capacity`  | `BaseCapacity + ExtensionRounds` (integer string)                      |
| 5            | `Label`               | `Magazine.Label`                                                       |
| 6            | `Acquired Date`       | `Magazine.AcquiredDate` formatted as `YYYY-MM-DD`; empty string if nil |
| 7            | `Notes`               | `Magazine.Notes`                                                       |
| 8            | `Compatible Firearms` | Firearm names joined with `"; "` (in stored ID order)                  |

Source: `internal/domain/csvexport.go:12-15`

**Serial number is deliberately excluded** (sensitive data). (`internal/domain/csvexport.go:11`)

### 9.3 Compatible Firearms column

- Firearm IDs are resolved to names via the inventory's `Firearms` slice.
- IDs with no matching firearm are silently omitted (not an error).
- Names are joined with `"; "` (semicolon-space) in the order the IDs appear in `CompatibleFirearmIDs`.

Source: `internal/domain/csvexport.go:33-39`

> **Lossiness tradeoff (port note):** because firearm names are not unique (§1 allows duplicates),
> resolving IDs to names-only means a CSV row cannot distinguish two same-named firearms, and silently
> dropping unresolved IDs hides a broken link at the export boundary. This is faithful to the current Go
> behavior. If the .NET export slice needs a lossless, round-trippable column it should carry a stable
> disambiguator alongside the name, or fail fast on an unresolved ID rather than omitting it; flagged
> here so the choice is deliberate rather than inherited.

### 9.4 Empty inventory

- An empty inventory produces a single header-only row. (`internal/domain/csvexport_test.go:27-35`)

### 9.5 Default filename (UX)

- The native save dialog defaults to `magstacker-inventory.csv`.
- User cancellation returns empty path with no error.
- The written file is created/chmod'd to mode `0600` (owner-read-write only).

Source: `app.go:95-112`, `app_test.go`

---

## 10. Bulk Add

### 10.1 Inputs

| Parameter     | Description                                                                     |
| ------------- | ------------------------------------------------------------------------------- |
| `tmpl`        | Magazine template — all scalar fields plus `CompatibleFirearmIDs`               |
| `count`       | Number of magazines to create (validated: 1–1000)                               |
| `labelPrefix` | String prepended to auto-generated sequence numbers; empty/blank = no numbering |

Source: `internal/app/service.go:106`

### 10.2 Validation

- The template is validated via `ValidateMagazine(tmpl, count)` — `addCount` is `count`, not 1.
- Validation failure returns an error and writes nothing.
- A count of 0 returns `addCountTooLow`; a count > 1000 returns `addCountTooHigh`.

Source: `internal/app/service.go:111-113`, `internal/app/service_test.go:245-267`

### 10.3 Label generation

- If `labelPrefix` is non-empty (after trim): labels are `<prefix><N>` where N is a zero-padded integer.
- Zero-pad width = max(2, number of digits in the largest N emitted). Width 2 for N ≤ 99; width 3 for N 100–999; width 4 for N 1000.
- The sequence starts at 1 for a first bulk add, and continues past the highest existing numbered label with the same prefix on repeat bulk adds (collision avoidance).
- If `labelPrefix` is empty or whitespace-only: all generated labels are empty strings (no numbering).

Sources: `internal/domain/bulkadd.go:24-50`, `internal/domain/bulkadd_test.go`

### 10.4 Collision avoidance (repeat bulk add)

Before generating labels, existing labels are loaded from the store. `NextLabelStart` scans for labels matching `<prefix><digits>` and returns `highest + 1`. Labels that equal the prefix exactly, carry a non-numeric suffix (e.g., `"AR-custom"`), or have a zero/negative numeric suffix are ignored.

Source: `internal/domain/bulkadd.go:58-77`, `internal/app/service.go:117-121`

### 10.5 Template propagation

- Each generated magazine is a copy of the template with a new empty ID (UUID assigned by the store) and its own label.
- `CompatibleFirearmIDs` from the template is deep-copied per magazine (no shared slice aliasing).
- Templates with no `CompatibleFirearmIDs` are valid; the created magazines have no links.

Source: `internal/app/service.go:125-131`, `internal/app/service_test.go:215-243`

### 10.6 Atomicity

- All N magazine inserts occur in a single database transaction: either all commit or none do.
- Partial success does not exist.

Source: `internal/db/magazines.go:37-56`

---

## 11. Cross-Cutting Business Rules / Invariants

### 11.1 No uniqueness constraints on names or labels

- No uniqueness constraint is enforced on `Firearm.Name`, `Magazine.BrandModel`, or `Magazine.Label`.
- Two firearms may share a name; Summary distinguishes them by ID.
- Two magazines may share a label (the collision-avoidance in bulk add is best-effort for auto-generated labels, not enforced at the DB level).

### 11.2 No deletion blocking

- Neither entity blocks deletion because the other references it.
- A firearm can be deleted even if magazines reference it; the links cascade away.
- A magazine can be deleted regardless of its links.

Source: `internal/db/store_test.go:104-153`

### 11.3 No caliber-matching constraint between magazine and firearm

- A magazine's caliber does not have to match any caliber of its linked firearms.
- This is purely a user-responsibility convention; no enforcement exists.

### 11.4 No capacity limits beyond `MaxBulkAddCount`

- No database-level upper bound exists on `BaseCapacity` or `ExtensionRounds` beyond the domain validator (`base >= 1`, `extension >= 0`).
- The schema CHECK constraints mirror domain validation as a backstop only.

### 11.5 FK constraint: link must reference an existing firearm

- The `magazine_firearm` join table has a real FK to `firearm.id`.
- Creating or updating a link to a nonexistent firearm ID fails at the DB layer.
- A blank firearm must never be auto-created to satisfy the link.

Source: `internal/db/magazines_test.go:85-101`, `internal/db/store_test.go:157-169`

### 11.6 Lists are always non-nil

- Every list operation returns a non-nil slice so the IPC boundary always serializes to `[]` not `null`.

Source: `internal/db/mapping.go:35-42`, `internal/db/mapping.go:86-93`

---

## 12. Acceptance Examples

### 12.1 Firearm validation

| Input (Name, Caliber) | Expected codes                  |
| --------------------- | ------------------------------- |
| `"Glock 19"`, `"9mm"` | `[]` (valid)                    |
| `""`, `"9mm"`         | `["emptyName"]`                 |
| `"AR-15"`, `"  "`     | `["emptyCaliber"]`              |
| `""`, `""`            | `["emptyName", "emptyCaliber"]` |

Source: `internal/domain/validation_test.go:59-72`

### 12.2 Magazine validation

| Input                                                                                            | Expected code(s)                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `BrandModel="Magpul GL9"`, `Caliber="9mm"`, `BaseCapacity=15`, `ExtensionRounds=0`, `addCount=1` | `[]` (valid)                                                                                         |
| `BrandModel="  "`, `Caliber="9mm"`, `BaseCapacity=15`, `ExtensionRounds=0`, `addCount=1`         | `["emptyBrandModel"]`                                                                                |
| `BrandModel="PMAG"`, `Caliber=""`, `BaseCapacity=30`, `addCount=1`                               | `["emptyCaliber"]`                                                                                   |
| `BrandModel="X"`, `Caliber="9mm"`, `BaseCapacity=0`, `addCount=1`                                | `["baseCapacityTooLow"]`                                                                             |
| `BrandModel="X"`, `Caliber="9mm"`, `BaseCapacity=15`, `ExtensionRounds=-1`, `addCount=1`         | `["negativeExtensionRounds"]`                                                                        |
| `BrandModel="X"`, `Caliber="9mm"`, `BaseCapacity=15`, `addCount=0`                               | `["addCountTooLow"]`                                                                                 |
| `BrandModel="X"`, `Caliber="9mm"`, `BaseCapacity=15`, `addCount=1001`                            | `["addCountTooHigh"]`                                                                                |
| `BrandModel="  "`, `Caliber=""`, `BaseCapacity=0`, `ExtensionRounds=-1`, `addCount=0`            | `["emptyBrandModel","emptyCaliber","baseCapacityTooLow","negativeExtensionRounds","addCountTooLow"]` |
| `addCount=1000` (at ceiling)                                                                     | `[]` (valid)                                                                                         |

Source: `internal/domain/validation_test.go:8-57`

### 12.3 Summary

Given: Glock 19 (ID="g"), AR-15 (ID="a"); magazines: GL9 9mm base=15 ext=2 linked=[g], OEM 9mm base=15 linked=[g], PMAG 5.56 base=30 linked=[a].

| Computed field                       | Expected value |
| ------------------------------------ | -------------- |
| `TotalMagazines`                     | `3`            |
| `CountByCaliber["9mm"]`              | `2`            |
| `CountByCaliber["5.56"]`             | `1`            |
| `EffectiveCapacityByCaliber["9mm"]`  | `32` (17 + 15) |
| `EffectiveCapacityByCaliber["5.56"]` | `30`           |
| `FirearmCounts[id="g"].Count`        | `2`            |
| `FirearmCounts[id="a"].Count`        | `1`            |

Source: `internal/domain/summary_test.go:44-61`

**Firearm with zero magazines still appears in FirearmCounts at count 0:** (`internal/domain/summary_test.go:79-87`)

**Orphaned magazine link (firearm ID not in snapshot) counts in totals but not in FirearmCounts:** (`internal/domain/summary_test.go:89-98`)

**Two firearms with the same name remain distinct (by ID):** (`internal/domain/summary_test.go:63-77`)

**Empty inventory produces all-zero/empty Summary:** (`internal/domain/summary_test.go:100-106`)

### 12.4 Bulk-add label generation

| Prefix  | Count | StartAt | Expected labels                                      |
| ------- | ----- | ------- | ---------------------------------------------------- |
| `"AR-"` | 2     | 1       | `["AR-01","AR-02"]`                                  |
| `"AR-"` | 1     | 1       | `["AR-01"]`                                          |
| `""`    | 4     | 1       | `["","","",""]`                                      |
| `"   "` | 3     | 1       | `["","",""]`                                         |
| `"AR-"` | 0     | 1       | `[]`                                                 |
| `"AR-"` | 2     | 3       | `["AR-03","AR-04"]`                                  |
| `"AR-"` | 2     | 99      | `["AR-099","AR-100"]` (width driven by highest=100)  |
| `"AR-"` | 99    | 1       | last=`"AR-99"` (stays width 2)                       |
| `"AR-"` | 100   | 1       | first=`"AR-001"`, last=`"AR-100"` (grows to width 3) |
| `"AR-"` | 150   | 1       | first=`"AR-001"`, last=`"AR-150"`                    |

Source: `internal/domain/bulkadd_test.go`

**NextLabelStart examples:**

| Existing labels                              | Prefix   | Expected start             |
| -------------------------------------------- | -------- | -------------------------- |
| `nil`                                        | `"AR-"`  | `1`                        |
| `["AR-01","AR-02","AR-03","","GL9-07"]`      | `"AR-"`  | `4`                        |
| `["AR-01","AR-02","AR-03","","GL9-07"]`      | `"GL9-"` | `8`                        |
| `["AR-","AR-custom","AR-1a","AR-0","AR-00"]` | `"AR-"`  | `1` (non-numbered ignored) |
| `["",""]`                                    | `""`     | `1`                        |

Source: `internal/domain/bulkadd_test.go:46-68`

**Repeat bulk add with same prefix does not collide:**

- First add: count=3, prefix="AR-" → labels AR-01, AR-02, AR-03.
- Second add: count=2, prefix="AR-" → labels AR-04, AR-05 (not AR-01, AR-02).

Source: `internal/app/service_test.go:191-213`

### 12.5 CSV export

**Header row:** `Brand/Model,Caliber,Base Capacity,Extension Rounds,Effective Capacity,Label,Acquired Date,Notes,Compatible Firearms`

**Effective capacity is computed, not stored:**

- `BaseCapacity=15`, `ExtensionRounds=2` → `Effective Capacity` column = `"17"`. (`internal/domain/csvexport_test.go:37-43`)

**Multiple compatible firearms:**

- Firearms resolved to names, joined with `"; "`.
- `CompatibleFirearmIDs=["g","h"]` where g=Glock 19, h=Glock 45 → `"Glock 19; Glock 45"`. (`internal/domain/csvexport_test.go:45-53`)

**RFC-4180 escaping:**

- `BrandModel='Brand, "Special"'` → cell is `"Brand, ""Special"""`. (`internal/domain/csvexport_test.go:55-64`)
- Embedded newline in Notes → field wrapped in quotes.

**Acquired date:**

- `AcquiredDate = 2026-06-14T09:30:00Z` → `"2026-06-14"` in column 6.
- `AcquiredDate = nil` → empty string in column 6. (`internal/domain/csvexport_test.go:66-81`)

**Empty inventory:** header row only, no data rows. (`internal/domain/csvexport_test.go:27-35`)

### 12.6 Store operations

**Firearm lifecycle:**

- Create → assigned UUID, Get returns identical value.
- Update Name → Get returns new Name.
- Delete → Get returns `ErrNotFound`.
- Delete nonexistent → `ErrNotFound`.
- Update nonexistent → `ErrNotFound`, no row inserted.

Source: `internal/db/firearms_test.go`

**Magazine cascade:**

- Create magazine linked to firearm A.
- Delete firearm A → magazine survives, `CompatibleFirearmIDs` empty.
- Delete magazine → firearm survives, join row gone.

Source: `internal/db/magazines_test.go:419-441`, `internal/db/store_test.go:104-153`

**Magazine update link replacement:**

- Magazine linked to [A, B]. Update to [B, C]. Get → links = [B, C]. A's join row gone.

Source: `internal/db/magazines_test.go:176-205`

**Magazine update transaction atomicity:**

- Update with bad link (nonexistent firearm): scalar change must roll back along with the failed link replace.

Source: `internal/db/magazines_test.go:257-283`

### 12.7 Reference data counts

| List                 | Expected count |
| -------------------- | -------------- |
| `StandardCalibers()` | 107            |
| `Manufacturers()`    | 188            |

Both are sorted, contain no blanks, and return fresh copies (mutation of returned slice must not corrupt cached data).

Source: `internal/refdata/refdata_test.go`

---

## 13. Firearm List View Columns

The firearms list displays:

| Column      | Always shown | Condition                                                  |
| ----------- | ------------ | ---------------------------------------------------------- |
| Name        | Yes          | —                                                          |
| Caliber     | Yes          | —                                                          |
| Serial      | No           | Only if at least one firearm has a non-blank serial number |
| # magazines | Yes          | Count from Summary by firearm ID                           |

Source: `frontend/src/views/FirearmsView.tsx:96-126`

The `# magazines` column is matched by firearm **ID**, not name, so two same-named firearms display independent counts.

---

## 14. Magazine List View Columns

| Column             | Notes                                      |
| ------------------ | ------------------------------------------ |
| Brand / model      | Sortable                                   |
| Caliber            | Sortable                                   |
| Effective capacity | `BaseCapacity + ExtensionRounds`, sortable |
| Label              | Sortable                                   |

Row click opens the edit form. Source: `frontend/src/views/MagazinesView.tsx:154-182`

---

## 15. Magazine Form UX (Behavioral Notes)

- Add mode shows a **Single / Bulk** toggle.
- Bulk mode shows Count (integer, 1–1000) and Label Prefix fields; Label Prefix is optional.
- Edit mode hides the toggle; only single-record editing is supported.
- In bulk mode, a label preview shows up to 6 auto-generated labels, with `"… (+N more)"` when there are more.
- If prefix is empty, preview shows: `"No label numbering (enter a prefix to auto-number)."`.
- The Go validator is called (`ValidateMagazine`) before any mutation IPC call; no mutation fires while validation codes are returned.
- Double-click protection: a synchronous `submittingRef` guard prevents a rapid double-click from submitting twice.
- Form default values: `BaseCapacity=10`, `ExtensionRounds=0`, `count=2`, `labelPrefix=""`.

Source: `frontend/src/views/MagazineForm.tsx`

---

## 16. User-Facing Validation Messages

| Code                      | Message                             |
| ------------------------- | ----------------------------------- |
| `emptyBrandModel`         | Brand/model is required             |
| `emptyCaliber`            | Caliber is required                 |
| `baseCapacityTooLow`      | Base capacity must be at least 1    |
| `negativeExtensionRounds` | Extension rounds cannot be negative |
| `addCountTooLow`          | Count must be at least 1            |
| `addCountTooHigh`         | Count is too large (max 1000)       |
| `emptyName`               | Name is required                    |
| (unknown code)            | Invalid value                       |

Source: `frontend/src/api/validationMessages.ts`
