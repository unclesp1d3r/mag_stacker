# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Relationships

- A **User** owns **Firearms**, **Magazines**, **Ammo**, and **Accessories** — these are the four owned **parents**. Everything a user can see is either owned by them or shared to them through a **Grant**.
- A **Firearm** owns its **child records**; a **Range Session** is the first child family. An **Accessory** owns its **Attachments**. Children inherit their parent's owner and grants — they are never shared or owned independently.
- A **Magazine** and a **Firearm** relate many-to-many through **Compatibility** (which magazines fit which firearms); an **Accessory** and a **Firearm** relate the same way through **Accessory Compatibility**.
- A **Grant** connects an **Owner** to a **Grantee** for exactly one item, carrying a **Permission**.

## Inventory entities

### Firearm

An owned firearm in a user's inventory. One of the four owned parents. Carries a canonical product name plus an optional owner **Nickname**, manufacturer, caliber, and a controlled **Firearm Type** / **Firearm Action** classification. A Firearm is the root of the **child record** seam — its history and derived totals come from its children (currently **Range Sessions**).

### Magazine

An owned magazine in a user's inventory. Another owned parent. Carries brand/model, caliber, a **Total Capacity** (base capacity plus any extension), an optional **Label**, and an optional acquired date. A Magazine declares **Compatibility** with the firearms it fits.

### Ammo

An owned ammunition lot in a user's inventory. The third owned parent, shared through the same **Grant** model as Firearms (edit grants included). A lot carries an optional brand, a caliber, an optional load type (free text with suggestions — FMJ, JHP, Match, and so on), a grain weight, a quantity in rounds, a **Low Stock** threshold, and an optional acquired date and notes. Lots with identical brand/caliber/type/grain stay separate — never merged; per-caliber views aggregate across them instead. Ammo has no **child record** families yet and does not participate in the **Inventory Log**.

### Accessory

An owned item that attaches to a firearm — a suppressor, optic, light, laser, muzzle device, or anything else the owner tracks separately from the gun. An owned parent in its own right: it carries its own serial number, cost, acquired date, NFA flag, and an **Accessory Type**. An Accessory records two independent facts about firearms: which one it is *mounted on right now* (at most one, and it may be none), and which ones it *fits* (**Accessory Compatibility**, many). It has its own **Attachment** child records, and since #23 it is independently shareable through a **Grant**.

### Attachment

A child record of an **Accessory** describing one piece of mounting hardware — a mount, piston, end cap, or muzzle device — with an optional spec (thread pitch or bore), serial, and notes. An Attachment is what physically makes an accessory fit a given host, but recording one does *not* declare **Accessory Compatibility**; that remains an explicit statement by the owner.

### Range Session

A single logged range trip for one Firearm — the date and the rounds fired that day. The first **child record** family. A Firearm's **Lifetime Total** is derived by summing its Range Sessions; there is no stored counter. A Range Session inherits its owner and grants from its parent Firearm and cannot be shared or owned on its own.

### Inventory Log

An append-only history of physical-handling events on a single Firearm or Magazine — each **Log Entry** records an **Event Type**, the acting user, when it happened, and optional notes. A **child record** family: entries inherit their parent's owner and grants, cannot be shared on their own, and are removed with the parent. Entries are created and listed but not edited or deleted. `cleaned` and `lubed` were retired as Firearm Event Types once **Service Event** shipped (service-intervals plan, U5) — logging service against a **Service Rule** is now the single way to record either act; every prior `cleaned`/`lubed` entry converted to a Service Event and the Inventory Log now carries only `inventoried` for both parent families.

### Event Type

The controlled kind of a **Log Entry** — currently *inventoried*, the only member for either parent family — drawn from a fixed value set whose valid members depend on the parent family. Deliberately not called an "action" — that name already means a Firearm's operating mechanism (see **Firearm Action**).

### Child record

A record that hangs off an owned parent (currently a Firearm or an Accessory; Magazine and Ammo have no child families yet) and inherits that parent's owner and grants rather than carrying its own. Child records are never shared independently and are removed with their parent. **Range Session** and **Inventory Log** are the first child families; **Attachment** is the accessory's. The pattern is the seam future child families follow.

### Compatibility

The many-to-many relationship recording which Firearms a given Magazine fits. Removing either side removes the pairing. Viewer-relative in both directions, on the same terms as **Accessory Compatibility** — the two share one rule, so they cannot drift apart. Only a **Magazine-fed** Firearm may take part: a Firearm that feeds no detachable magazine can neither be linked nor be marked non-magazine-fed while a link survives.

### Magazine-fed

Whether a Firearm accepts detachable magazines — recorded on the Firearm itself, never inferred from its **Firearm Type** or **Firearm Action**, so it stays authoritative when a taxonomy value is imprecise or an unusual configuration defies its category. Revolvers, break-actions, tube-fed lever guns, and muzzleloaders are common examples of firearms that are not; magazine-fed is the default.

It is a claim about the gun, not about a shortage: a non-magazine-fed Firearm renders an em dash in place of its magazine count, while a magazine-fed one with none yet legitimately shows `0`. The two read very differently to an owner, which is the whole reason the flag exists. **Accessory Compatibility** is unaffected — optics and lights mount to any Firearm regardless.

### Accessory Compatibility

The same relationship for an **Accessory**: which Firearms it fits. Deliberately distinct from the accessory's *current mount* — compatibility is a capability claim ("this suppressor fits these five hosts"), true whether or not the accessory is attached to any of them today, while the mount is present physical state and is at most one firearm. Declaring compatibility never changes the mount, and mounting never changes compatibility.

Compatibility is *viewer-relative in both directions*. A firearm the reader cannot see is omitted from a read rather than disclosed; and because the list an editor submits was therefore built from a filtered view, a write replaces only the pairings within that editor's visible set and leaves the rest untouched. Saving a shorter list clears what the editor was shown and omitted — never the pairings they were never told about.

## Sharing and visibility

### Owner-scoping

The core visibility rule: every owned item belongs to exactly one owner, and a user sees only their own items plus items explicitly shared to them through a **Grant**. All inventory reads and writes are scoped by this rule.

### Grant

A share of one item (a Firearm, Magazine, Ammo lot, or Accessory) from its **Owner** to a **Grantee**, carrying a **Permission** and an opt-in that lets the grantee create records on the owner's behalf. A grant targets a single item; there is one grant per grantee per item, and re-granting updates the existing one. Removing the item removes its grants.

### Owner

The user who owns an item and can grant others access to it. Distinct from a **Grantee**, who only has the access an Owner has given them.

### Grantee

A user who has been given access to another user's item through a **Grant**. A grantee's access is bounded by the grant's **Permission**.

### Permission

The access level a **Grant** confers: *view* (read-only) or *edit*. Determines whether a grantee sees an item or can also change it.

## Classification and labeling

### Firearm Type

The controlled classification of a Firearm's kind (pistol, rifle, and so on), drawn from a fixed value set. See **Unspecified value**.

### Firearm Action

The controlled classification of a Firearm's operating mechanism, drawn from a fixed value set. See **Unspecified value**.

### Accessory Type

The controlled classification of an **Accessory** — suppressor, optic, light, laser, muzzle device, or other. Required, and the structural discriminator: it decides which subtype's rules apply and is what any future per-type detail table keys off. It coexists with a separate free-text *category*, which is optional and records what the owner calls the thing ("red dot mount", "bipod") — values the controlled set deliberately does not enumerate. Type answers *which kind of item is this*; category answers *what do you call it*.

### Unspecified value

The placeholder classification a Firearm carries before it has been classified. It exists so classification can be backfilled onto existing records, but domain validation rejects it on write — a real Type and Action are required when saving.

### Nickname

An optional owner-chosen display name for a Firearm, distinct from its canonical product name. When present, the Nickname is shown as the primary identifier, with the product name as the fallback.

### Label

An optional owner marking on a Magazine used to identify it physically. May be constrained by **Magpul mode**, and may begin with a **Label Prefix** that drives grouping and numbering.

### Label Prefix

A short string an owner has used to start Magazine labels. Recorded per owner and reused: it groups magazines by the longest recorded prefix a label starts with (labels matching no recorded prefix fall into an "Unprefixed" group) and drives auto-numbering when creating the next magazine in a series.

### Magpul mode

An owner setting that, when on, constrains Magazine labels to what can physically be written in the dot cells of a Magpul magazine floorplate — a limited character set and length. When off, labels are free text.

## Service intervals

### Service Rule

A named maintenance concern tracked against a Firearm or Accessory — Cleaning, Barrel, Recoil spring, and so on — that sets at least one of three thresholds: elapsed days, range sessions, or rounds fired. An item's Service Rules come from its owner's category defaults, live: each is *inherited*, *overridden* with the item's own thresholds, or *suppressed* (removed from the item entirely); an item may also carry *item-only* rules no default defines. A Service Rule belongs to its item's Owner, so a shared item's rules come from the owner's defaults, never the viewer's.

### Service Event

A single logged act of service against one Service Rule — the date it happened, the acting user, and optional notes. Logging a Service Event sets that rule's measurement point: elapsed days, sessions, and rounds all start counting fresh from it. A Firearm or Accessory's service history is every Service Event against it, newest first.

## Derived values

### Total Capacity

A Magazine's full round capacity: its base capacity plus any extension. Derived, not stored separately.

### Lifetime Total

A Firearm's cumulative rounds fired, derived by summing the rounds across all of its **Range Sessions**. Adding or removing a Range Session changes the total; there is no independent counter.

### Low Stock

The derived state of an **Ammo** lot whose quantity in rounds is at or under its own threshold. Never stored — computed from the lot's quantity and threshold wherever it is shown (list badge, summary roll-ups, CSV export). The summary counts it two ways: lots low (every low lot) and calibers low (distinct calibers with at least one low lot), and separately flags calibers the owner has firearms in but no lots — or only low lots — for (caliber coverage).

### Last Inventoried

A Magazine's most recent physical-count date: the `occurredAt` of the latest **Inventory Log** entry with **Event Type** `inventoried`. Derived, not stored — and blank (a first-class state) when the Magazine has never been inventoried. Respects owner-scoping: derived only from entries visible through the parent Magazine.

### Due

The derived state of a **Service Rule** whose elapsed days, sessions, or rounds fired — measured since its last **Service Event**, or the item's origin date when none exists — meets or exceeds any threshold it sets. Binary, never a severity tier: distance past a threshold is shown as the raw counts, not a "due soon" gradation. Never stored — computed from the resolved rule and its elapsed counts wherever it is shown (item detail panel, `/summary` roll-up, list indicators).

## Design identity

### Machined Console

The product's design north star: a single instrument presented in two modes that share one identity — precision-tool styling with tabular figures, hairline borders, and one anodized-orange accent where "active" reads as "lit / marked." The two modes are the **Field Console** and the **Machined Instrument**.

### Field Console

The dark mode of the **Machined Console** and the default — a graphite, high-contrast readout where the accent runs bright/amber and lights up active state.

### Machined Instrument

The light mode of the **Machined Console** — a matte near-white tool surface with a deep burnt-orange accent and a machined inset on primary controls.
