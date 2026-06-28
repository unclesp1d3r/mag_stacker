---
topic: dotnet-extensions
note: Distilled from the Avalonia/.NET MagStacker implementation. Captures only the behaviors that extend the Go parity spec; everything else lives in go-parity-spec.md.
---

# .NET Port — Beyond-Parity Behaviors

The Go behavioral contract is `go-parity-spec.md`. The Avalonia/.NET port realized that
contract and added three behaviors **not present in the Go spec**. They were distilled here
so the requirements stay self-contained after the reference source snapshot was removed; the
.NET implementation was authoritative for these three behaviors.

Everything else the port does — entity fields, all-failures-at-once validation, the bulk-add
label algorithm, the summary computation, RFC-4180 column order and escaping — is already
specified in `go-parity-spec.md` and is not repeated here.

## 1. CSV formula-injection guard (R46)

An intentional safety addition over Go. When serializing a cell, before RFC-4180 quoting:

- If the cell's **first character** is one of `=`, `+`, `-`, `@`, tab (`\t`), or carriage
  return (`\r`), a single literal apostrophe (`'`) is prepended so spreadsheet apps treat the
  cell as text rather than evaluating it as a formula.
- RFC-4180 quoting is then applied to the (possibly guarded) value: a field containing a
  comma, double-quote, CR, or LF is wrapped in double-quotes with internal quotes doubled.
  Note the apostrophe is added first, so a guarded value that also contains a comma/quote is
  still quoted correctly.

Applies to every cell, including `Notes`, `Brand/Model`, and `Compatible Firearms`. Serial
number is still never exported (parity §9.2).

## 2. Compatibility order via a join ordinal (R33)

The Go join table relied on insertion order, which SQL does not guarantee across reads. The
.NET port added an explicit `Ordinal` column to the `magazine_firearm` join row:

- On write, link rows are inserted with `Ordinal = 0, 1, 2, …` in the caller-supplied order.
- On read, each magazine's `CompatibleFirearmIds` is rebuilt by ordering join rows on
  `Ordinal` ascending — so compatibility order is stable across reads and drives the order
  firearm names appear in the CSV `Compatible Firearms` column.

Rationale and trade-offs: ADR `0004-join-ordinal-for-deterministic-csv-order.md`.

## 3. Duplicate compatibility references collapsed (R34)

Before ordinal assignment, the incoming firearm-id list is de-duplicated preserving
**first-occurrence order** (`.Distinct()`):

- A firearm appears at most once in a magazine's compatibility set.
- Collapsing duplicates before assigning ordinals prevents a primary-key conflict on the join
  table and keeps ordinals matching the caller-supplied sequence.

## Carried forward unchanged for the web rebuild

- Replacing a magazine's compatibility set is atomic; updating to an empty set removes all
  links (parity §3.2).
- Deleting a magazine cascades its join rows and leaves firearms untouched; deleting a firearm
  cascades its join rows and leaves magazines untouched (parity §3.3).
- A link to a nonexistent firearm fails the whole write (parity §3.4); in the web rebuild this
  is additionally scoped to the acting user's visible firearms (requirements R37/R37a).
