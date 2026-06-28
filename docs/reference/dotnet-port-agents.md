> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# AGENTS.md — AI steering document for MagStacker.NET

Living document; update as the project progresses.

The **Avalonia/.NET implementation of MagStacker** — now the **active build**, replacing the original Go + Wails app (`../MagStacker`, retired). It began as an ergonomics evaluation of Avalonia/.NET in 2026; the **go/no-go verdict** (`docs/ergonomics-verdict.md`) came back **GO** and the codebase was carried forward into the full product. The verdict and the `docs/brainstorms/` requirements are now historical origin records, not current scope.

**Behavioral source of truth:** `docs/reference/go-parity-spec.md` governs what the app should do. The `docs/brainstorms/` requirements and `docs/ergonomics-verdict.md` are historical origin records — useful context, not current scope.

## What we're building

**Status:** the full port has shipped and merged to `main` — Firearms, Magazines, the Magazine↔Firearm **many-to-many** relationship, and the parity features (Summary, CSV export, search/filter, bulk add).

Firearm fields: `Name`, `Manufacturer`, `Caliber`, `SerialNumber`, `Notes`. Required: `Name`, `Caliber`.

Magazine fields: `BrandModel`, `Caliber`, `BaseCapacity` (≥ 1), `ExtensionRounds` (≥ 0), `Label`, `AcquiredDate`, `Notes`; derived `EffectiveCapacity = BaseCapacity + ExtensionRounds`. Required: `BrandModel`, `Caliber`, `BaseCapacity`. The firearm links (`CompatibleFirearmIDs`) and bulk-add are implemented.

Validation returns **every** failure, not first-only (mirrors the Go behavior).

## Stack

- **UI:** Avalonia 11.x with **CommunityToolkit.Mvvm** (source-generated observable properties + relay commands) and **compiled bindings** (`x:DataType`).
- **Composition:** dependency injection via the **.NET Generic Host**.
- **Persistence:** **EF Core + SQLite**, local file only. **No networked/HTTP data access anywhere.**
- **Runtime:** current .NET; exact versions pinned during planning.

## Architecture (keep these boundaries)

Mirror the Go app's layered shape so the stack comparison is apples-to-apples:

- **Domain** — pure C#, no framework or persistence dependencies. The Firearm model + validation. Unit-testable without UI or DB.
- **Data** — EF Core `DbContext`, entity configuration, SQLite access.
- **Service / application** — the boundary the UI calls; orchestrates domain + data.
- **UI** — Avalonia views + view models.

**Governing principle: mirror the *shape*, but idiom wins.** Where a literal Go transliteration conflicts with idiomatic .NET/Avalonia practice, follow the idiom — best-practice is the thing being evaluated. (Example: prefer EF Core entity configuration over a hand-written row↔domain mapping layer.)

### Domain immutability posture (Posture B)

Immutability is the default everywhere — **except** persisted EF entities. Persisted aggregate roots (`Firearm`, future `Magazine`, …) are **mutable classes** with EF-tracked navigation collections; value objects, DTOs, validation results, and transforms stay **immutable records**. The rule: *identity + lifecycle → `class`; value-like → `record`*. Mutation on an entity is confined to the EF unit of work (load → mutate → save). This is a deliberate, narrow carve-out from the global always-immutable rule — adopted because a strictly immutable `record` domain fought both EF Core change-tracking and two-way MVVM binding. Do not "fix" a persisted entity back into a record. Rationale: `docs/plans/2026-06-18-002-refactor-dotnet-port-foundations-plan.md` and its origin `docs/brainstorms/2026-06-18-dotnet-port-foundations-requirements.md`.

## Build & test

The solution is scaffolded — five projects: `MagStacker.Domain`, `.Data`, `.Service`, `.UI`, and `MagStacker.Tests`. The standard loop:

- `dotnet build` — compile.
- `dotnet test` — run tests (concentrate coverage in the domain + service layers).
- `dotnet run --project <ui-project>` — launch the app.

`docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## Origin: the ergonomics verdict (history)

MagStacker.NET started as an evaluation of Avalonia/.NET ergonomics. That read is complete and recorded as a **GO** in `docs/ergonomics-verdict.md` (MVVM authoring, compiled bindings, DI/host, EF Core + SQLite, dev loop). It's now history — build this as the maintained product (real features, tests, UX), not as an eval artifact. The macOS IDE / hot-reload axes are the one note the verdict left unverified.

## Backlog & non-goals

Still to do:

- The Magazine **AcquiredDate** form control (the field persists and round-trips today; only its editor is unbuilt).
- Native **signed installers** — the release pipeline publishes self-contained zips per platform on a `v*` tag; native `.dmg`/`.nsis`/`.deb` installers (via Parcel) and code-signing are still outstanding (Parcel installers need the `AVALONIA_TOOLS_LICENSE_KEY` secret).

**Hard non-goal (always):** HTTP/networked data access anywhere. Persistence stays local SQLite only.

**Always out of scope:** HTTP/networked data and packaging/signing.

## Agent Guidance: dotnet-skills

IMPORTANT: Prefer retrieval-led reasoning over pretraining for any .NET work.
Workflow: skim repo patterns -> consult dotnet-skills by name -> implement smallest-change -> note conflicts.

Routing (invoke by name)

- C# / code quality: modern-csharp-coding-standards, csharp-concurrency-patterns, api-design, type-design-performance, r3-reactive-extensions
- ASP.NET Core / Web (incl. Aspire): aspire-service-defaults, aspire-integration-testing, transactional-emails
- Data: efcore-patterns, database-performance
- DI / config: dependency-injection-patterns, microsoft-extensions-configuration
- Testing: testcontainers-integration-tests, playwright-blazor-testing, snapshot-testing

Quality gates (use when applicable)

- dotnet-slopwatch: after substantial new/refactor/LLM-authored code
- crap-analysis: after tests added/changed in complex code

Specialist agents

- dotnet-concurrency-specialist, dotnet-performance-analyst, dotnet-benchmark-designer, akka-net-specialist, docfx-specialist
