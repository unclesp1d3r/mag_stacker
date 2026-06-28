> **Vendored snapshot — not this project's source.** Read-only copy from the Avalonia/.NET MagStacker project, kept here so the web re-platform requirements stay self-contained. Any relative links below (e.g. `docs/plans/…`, `docs/ergonomics-verdict.md`, `../MagStacker`) refer to that original project and are **not** part of this repository.



# ADR-0005: Per-platform best-effort owner-only permissions for the exported CSV

**Date**: 2026-06-20
**Status**: accepted
**Deciders**: UncleSp1d3r (owner)

## Context

CSV export is the app's first file I/O. The Go original writes the export with mode `0600`
(owner-read-write only) to keep inventory data — including free-text notes — off other users on a
shared machine. .NET's permission APIs differ by platform: Unix has a file mode; Windows has ACLs. They
also differ in atomicity (whether the restriction is applied at file-creation time or after) and in
availability (some throw `PlatformNotSupportedException` off their platform, some need a separate NuGet
package). The requirements review flagged "restrictive ACL where practical" as having no defined
fallback and no verifiable bar.

## Decision

Restrict the exported file to the current user **best-effort per platform**, and **never fail the
export because a restriction could not be applied**:

- **Unix** (`OperatingSystem.IsLinux() || IsMacOS()`): write through `FileStreamOptions` with
  `UnixCreateMode = UserRead | UserWrite`, so `0600` is applied atomically at `open(2)` — no window
  where the file is world-readable.
- **Windows** (`OperatingSystem.IsWindows()`): attempt a restrictive owner-only DACL via
  `FileSystemAclExtensions` (`System.IO.FileSystem.AccessControl`); on any failure, swallow the error
  and fall back to the inherited user-profile ACL.

**Verifiable acceptance bar:** on Unix the written file's mode is exactly `0600` (assertable via
`File.GetUnixFileMode`). Windows ACL restriction is best-effort and not asserted at the bit level.

## Alternatives Considered

### Alternative 1: `File.SetUnixFileMode(path, mode)` after writing (Unix)
- **Pros**: simpler call site; same end mode.
- **Cons**: non-atomic — the file exists at the umask default before the chmod, a brief world-readable
  window.
- **Why not**: `FileStreamOptions.UnixCreateMode` closes the window for free by setting the mode in the
  creating syscall.

### Alternative 2: Require a successful Windows ACL (fail the export otherwise)
- **Pros**: a strict guarantee on Windows too.
- **Cons**: ACL operations can fail on some filesystems (FAT32, network shares) or need elevation;
  failing the export there is hostile for a local single-user app and gives no graceful path.
- **Why not**: a usable best-effort beats a brittle guarantee for this threat model (local desktop).

### Alternative 3: Warn-and-confirm when the restriction cannot be applied
- **Pros**: surfaces the weaker-permission case to the user.
- **Cons**: adds a modal interruption to a common action for a local single-user app; little practical
  value when the file lands in the user's own profile.
- **Why not**: disproportionate friction; the silent best-effort plus the Unix bar is sufficient.

## Consequences

### Positive
- Unix exports are owner-only with no race window and a directly testable bar.
- Export never fails on a permissions edge case; the file is always written where the user chose.
- Platform-specific code is guarded and isolated in a small file-writer helper.

### Negative
- Windows restriction is best-effort and untested at the ACL-bit level (tracked as deferred follow-up).
- Adds a `System.IO.FileSystem.AccessControl` package reference for the Windows path.

### Risks
- A Windows user on a shared machine could get a less-restricted file than intended. *Mitigation*: the
  file defaults into the user profile (inherited restrictive ACL); the gap is documented, not hidden.

## Related

- Plan: `docs/plans/2026-06-20-002-feat-remaining-port-features-plan.md` (KTD5, unit U8)
- Origin: `docs/brainstorms/2026-06-20-remaining-features-requirements.md` (R5, Open Questions — Windows ACL)
- Behavioral contract: `docs/reference/go-parity-spec.md` §9.5
