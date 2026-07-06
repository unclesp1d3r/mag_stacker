---
name: MagStacker
last_updated: 2026-07-06
---

# MagStacker Strategy

## Target problem

A firearm owner's knowledge of what they own is inherently relational — a magazine fits several firearms, maintenance and training currency hang off specific items, and it all shifts as things move in and out. Memory and spreadsheets can't keep those cross-connections true, so the ledger silently drifts out of sync with reality.

## Our approach

Model the collection as a true relational domain — compatibility, maintenance, and currency as first-class, enforced connections — in a tool the owner hosts and controls themselves. The relational model is what a spreadsheet structurally can't do; owning and running it yourself is what makes a sensitive inventory safe to keep at all.

## Who it's for

**Primary:** Individual firearm owners whose collection outgrew memory — hiring MagStacker to keep an accurate, private record of what they own, what fits what, and how much it holds, and to share precise slices of it with the right people, reversibly.

**Secondary:** Clubs (expose specific club-owned items to members without revealing the whole inventory) and ranges (staff manage fleet hardware, volunteers stay read-only) — served by the same owner-scoped sharing, but the individual owner drives product decisions.

## Key metrics

- **Coverage** — the owner's full collection lives in MagStacker with no parallel spreadsheet on the side. Regresses when new items stop getting entered. Measured: the maintainer's own use.
- **Reliance** — it's the thing reached for at the range or gun store, and its answer is trusted without double-checking against memory. Regresses the moment it's wrong, slow, or annoying enough to route around. Measured: the maintainer's own use.
- **Self-host adoption** — other people pull the Docker image and run their own instance; GitHub stars/forks/issues and container pulls as the visible proxy. Measured: GitHub.

_Intentionally lean: a self-hosted, privacy-first tool has no in-app telemetry by design. Revisit if a community forms._

## Tracks

### Relational domain depth

Compatibility, maintenance, and the planned training/currency tracking as first-class, enforced relationships — the connective tissue of the collection.

_Why it serves the approach:_ this is the substance of the bet — precisely what a flat spreadsheet can't hold.

### Owner-controlled multi-user

Owner-scoped data with reversible, per-item grant sharing, plus the self-host/deploy story that lets individuals → clubs → ranges adopt it without giving up control.

_Why it serves the approach:_ "you own and run it yourself" is what earns trust with an audience that won't put this data in someone else's cloud.

### Trustworthy instrument

The precise, rugged, dependable UX: accuracy, always-reachable on any device, dense-but-legible tables, WCAG 2.2 AA.

_Why it serves the approach:_ the record is only a source of truth if the owner trusts it and reaches for it; craft is what makes them rely on it.

### Insight & self-development reporting

Meaningful reports built on the tracked data — per-caliber/per-firearm rollups, round counts, training currency — that turn the ledger into insight for the owner's own development.

_Why it serves the approach:_ the relational model isn't just a record; owned data becomes owned insight, which gives the owner a reason to keep it accurate.

## Not working on

- A hosted SaaS where we run MagStacker and hold users' inventory. Multi-user — even multi-tenant — on an instance the operator controls is core (clubs and ranges depend on it); the line we don't cross is *someone else hosting your data*.

## Marketing

**One-liner:** A self-hosted, relational inventory for firearms and magazines — an accurate record of what you own and what fits what, that stays entirely yours.

**Key message:** Precise, rugged, trustworthy. Serious equipment, not a toy — your collection modeled as real relationships, on infrastructure you control.
