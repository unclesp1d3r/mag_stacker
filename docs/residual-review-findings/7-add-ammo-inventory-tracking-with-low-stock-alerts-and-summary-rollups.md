# Residual Review Findings

Source: `ce-code-review` run `20260706-233438-bc8dfa9f` (mode:agent, full roster + cross-model
adversarial via Codex) on branch `7-add-ammo-inventory-tracking-with-low-stock-alerts-and-summary-rollups`,
reviewing the ammo-inventory feature (issue #7, plan `docs/plans/2026-07-06-002-feat-ammo-inventory-plan.md`).
Verdict: **Ready with fixes**. Finding #4 (schema-level CHECK/trigger tests) was applied on-branch
as `fix(review): schema-level tests for ammo CHECKs and grants-cleanup trigger`.

## Filed to tracker

- **P2** `src/domain/summary/summary.ts:173` — Summary caliber coverage joins firearm/ammo free
  text by exact equality → [#52](https://github.com/unclesp1d3r/mag_stacker/issues/52)
- **P2** `src/domain/ammo/validate.ts:27` — Numeric inventory fields lack int4 upper-bound
  validation → [#53](https://github.com/unclesp1d3r/mag_stacker/issues/53)

## Human decision gate (not tracker-filed — needs owner confirmation, not code)

- **P1** `src/domain/ammo/service.ts:68` — **Existing create-on-behalf grants gain ammo-creation
  authority (plan AS4/KTD7).** `resolveCreateOwner` has no `parentType` predicate, so shipping ammo
  as a third owned parent silently widens every existing firearm/magazine create-on-behalf grant to
  also authorize creating ammo lots for that owner. The plan documents this as intentional
  whole-owner trust but explicitly requires confirmation before shipping. **Resolve before merge:**
  either confirm whole-owner trust is intended (close AS4), or scope `resolveCreateOwner`'s grant
  query by parent type. Flagged independently by the cross-model (Codex) adversarial pass and three
  in-process reviewers.
