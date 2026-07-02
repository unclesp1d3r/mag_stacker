# ADR-0009: Better Auth organization plugin for onboarding/branding; hybrid sharing over per-item grants

**Date**: 2026-07-01
**Status**: accepted
**Deciders**: unclesp1d3r (with Claude Code)

## Context

The app has shipped owner-scoped inventory with a fine-grained **per-item grant** sharing model (`src/auth/grants.ts` — owner → grantee, view/edit, per item). Onboarding is operator-only (`disableSignUp: true`; admin `auth.api.createUser`), and there is **no email infrastructure**. We evaluated whether Better Auth's first-party `organization` plugin should add user invitations, provide interface branding, and/or *replace* the grant sharing model. Tracked in issues #27 (invites), #28 (branding), #29 (hybrid shared collections).

## Decision

Adopt the `organization` plugin for two adjacent needs only — **optional email invitations** and **interface branding** — via a **single default organization** with org management hidden from the UX. **Keep per-item grants unchanged**, and add optional **team-backed "shared collections"** for group-style sharing. Email sends via **Nodemailer/SMTP**. `disableSignUp` stays on; invite-driven account creation is **gated on a valid pending invitation**, never open sign-up.

## Alternatives Considered

### Alternative 1: `better-invite` community plugin
- **Pros**: purpose-built invite flow, exact fit, MIT.
- **Cons**: pre-1.0, single maintainer, not officially affiliated with Better Auth.
- **Why not**: supply-chain/maintenance risk vs. the first-party `organization` plugin, which covers the same need.

### Alternative 2: Replace per-item grants with organization/team membership
- **Pros**: simpler mental model; group access "for free"; reuses membership machinery.
- **Cons**: coarse (group-level) — cannot express "share this one magazine at view"; requires re-scoping inventory from `owner_id` to org and discarding a shipped, tested model.
- **Why not**: wrong granularity; per-item ACLs would have to be re-added on top anyway.

### Alternative 3: Provider SDK for email (Resend / SES / SendGrid)
- **Pros**: managed deliverability, richer APIs.
- **Cons**: per-provider SDK lock-in; some tiers commercial; heavier for an operator-run app.
- **Why not**: Nodemailer over SMTP is MIT, battle-tested, and provider-agnostic (self-hosted MTA, SES-SMTP, etc.).

### Alternative 4: Hand-rolled invitation system
- **Pros**: full control, no new dependency.
- **Cons**: reimplements token / accept / expiry machinery the plugin already provides.
- **Why not**: prefer the maintained first-party plugin over hand-rolling.

## Consequences

### Positive
- New people can be onboarded specifically to share with, without abandoning fine-grained per-item sharing.
- The single default org yields branding (name / logo / metadata) and a clean, incremental path to real multi-org later — promote a shared collection to its own org, no rewrite.
- First-party, maintained plugin; MIT/SMTP email with no vendor lock-in.

### Negative
- Two sharing axes (per-item grants + collection membership) must be unioned at authorization time — added complexity in `src/auth/authorize.ts` / `src/auth/visibility.ts`.
- "Single default org as plumbing" is mild conceptual overhead until/unless multi-org is adopted.
- Introduces email infrastructure and SMTP configuration the app did not previously need.

### Risks
- Org invitations do **not** create accounts or bypass `disableSignUp` — the invitee must be logged in with a matching email to `acceptInvitation`. Mitigation: gated, invitation-scoped account provisioning (DB hook or `auth.api.createUser`); admin-created accounts remain the primary path.
- Union authorization could leak access if it fails open. Mitigation: fail-closed design plus explicit negative tests for the owner / grant-only / collection-only / neither combinations.
