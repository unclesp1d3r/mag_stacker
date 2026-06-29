# Product

## Register

product

## Users

Ranges, clubs, and individual firearm owners who want to manage what they own
on infrastructure they control.

- **Individuals** cataloguing a personal collection — small inventory, infrequent
  edits, value simplicity and privacy.
- **Clubs** sharing specific club-owned items with members at view or edit
  without exposing the whole inventory.
- **Ranges** letting staff manage fleet hardware, including adding new range
  assets on the range's behalf, while keeping volunteers read-only.

Context of use: at a back-office desktop or on a phone at the bench, on the
operator's own network. The job is keeping an accurate, private record of
firearms and magazines — what's owned, what fits what, how much it holds — and
sharing precise slices of it with the right people, reversibly.

## Product Purpose

A self-hosted, multi-user web app for firearm and magazine inventory:
compatibility mapping, per-caliber/per-firearm summaries, CSV export, and
per-item view/edit sharing with owner-scoped data. It replaces a single-user
desktop app so the tool can run continuously, be reached from any device, and
serve multiple accounts with real ownership and sharing.

Success: a range, club, or owner trusts MagStacker as the source of truth for
their hardware — accurate, always reachable, and theirs.

## Brand Personality

Tactical and rugged, but credible — equipment, not costume. The interface should
feel like a dependable tool someone reaches for when accuracy matters: direct,
confident, competent. Three words: **precise, rugged, trustworthy.**

This is **not** a boring corporate tool. It should have character and moments of
delight — but the delight is the satisfaction of a well-machined instrument or
quality gear: confident motion, tactile feedback, a considered detail that
rewards a second look. Think precision tools, mechanical watches, anodized
hardware, a good optic's reticle. Delight is earned through craft, never through
cuteness — no kawaii, no mascots, no bounce. Personality with a straight face.

## Anti-references

- **Generic SaaS dashboard** — gradient cards, the big hero-metric template,
  identical icon+heading card grids. MagStacker is a working inventory, not a
  pitch deck.
- **Dated enterprise admin** — cluttered gray forms, cramped controls, 2010-era
  panel density that's busy without being legible.
- **Sterile corporate tool** — lifeless, personality-free, the kind of app that's
  so afraid of a point of view it has none. Restraint is not the same as boring.
- **Kawaii / cute** — pastels, rounded mascots, bouncy playful motion, emoji.
  Undercuts the seriousness; wrong register entirely.
- It leans into the domain (high-contrast, bold, confident) but stops short of
  cartoon "tacticool": no camo, stencils, or operator cosplay that would alienate
  a club secretary or a casual owner.

## Design Principles

- **Serious equipment, not a toy.** People are accountable for what's in here;
  the UI should read as dependable and exact, the way good gear does.
- **The owner is in control.** Who can see, edit, or delete an item is always
  clear and always reversible. Sharing never surprises anyone.
- **Dense but legible.** Power users scan many rows; favor tabular precision and
  information density over airy marketing space — without trading away readability.
- **Restraint, not absence.** Correctness and clarity over decoration, and no
  hype or gradient flash — but restraint earns room for a few deliberate
  flourishes. A boring tool is a failure too.
- **Delight through craft.** Personality comes from precision, not cuteness:
  confident, purposeful motion; tactile, satisfying interactions; a well-machined
  detail that rewards attention. Every flourish should feel engineered, not cute.
- **Reachable and fast on any device.** Works on a phone at the range and a
  desktop in the back office, over the local network.

## Accessibility & Inclusion

WCAG 2.2 AA. Body text ≥ 4.5:1 contrast, large text ≥ 3:1; color is never the
sole carrier of meaning (status badges and permissions carry text labels). Full
keyboard operability with a visible, consistent focus ring; focus moves to the
first invalid field on validation failure. Honors `prefers-reduced-motion`
(motion degrades to instant/crossfade). Semantic HTML throughout
(`nav`/`main`/`section`/`form`, real table semantics, labelled controls).
