---
name: MagStacker
description: The Machined Console — a two-mode instrument for firearm & magazine inventory.
# shadcn-canonical semantic token names (dark "Field Console" values shown),
# plus directly-defined extensions the shadcn default set has no analog for:
# ink-soft (middle of the ink ramp), steel (info), danger-soft (destructive
# tint), ok (success). Light "Machined Instrument" values live in app/globals.css.
colors:
  primary: "#ffb240"
  primary-foreground: "#1a1205"
  accent: "#2a2415"
  background: "#15181c"
  card: "#1a1e24"
  muted: "#11151a"
  foreground: "#e9edf1"
  ink-soft: "#c5ccd4"
  muted-foreground: "#8a929c"
  border: "#2a3037"
  input: "#39414a"
  steel: "#8fb4e8"
  destructive: "#ff6b5e"
  danger-soft: "#2c1816"
  ok: "#57d98a"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.65rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
    fontFeature: "tnum"
rounded:
  sm: "0.375rem"
  lg: "0.625rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "40px"
  badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "999px"
    padding: "4px 8px"
  table-header:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
---

# Design System: The Machined Console

## 1. Overview

**Creative North Star: "The Machined Console"**

MagStacker is one instrument with two faces. In the dark — the default, and what
a dark-OS user sees automatically — it is the **Field Console**: a graphite
equipment readout, high-contrast, the anodized-orange accent running bright and
lighting up the active row the way a gauge lights when it's armed. In the light
it is the **Machined Instrument**: a matte near-white tool surface, the accent a
deeper burnt-orange, primary controls carrying a machined inset instead of a
glow. Same instrument, day and night; only the surfaces and ink flip.

The feel is precision gear you trust — a torque wrench, a quality optic, anodized
hardware with tight tolerances. It rejects the two failure modes equally: it is
**not** a generic SaaS dashboard (no gradient cards, no hero-metric template, no
identical icon-card grids) and **not** a sterile corporate tool with no point of
view. It is also not cute — no pastels, mascots, or bounce. Delight is earned
through craft: tabular figures that line up to the digit, hairline borders that
hold their edge, a tick-mark stamped on a stat, an accent that lights up only
where it means something. Personality with a straight face.

**Key Characteristics:**
- Two modes, one identity: dark Field Console (default) / light Machined Instrument.
- Anodized-orange accent reserved for primary action, current selection, and lit/active state — never decoration.
- Tabular monospace for every number, label, and serial; precision is legible.
- Hairline borders and tonal layering carry structure; shadow is incidental.
- Dense, scannable tables over airy marketing space.

## 2. Colors

A restrained semantic palette: tinted graphite (or matte paper) neutrals plus a
single anodized accent. Color is never the sole carrier of meaning — every status
also carries a text label.

### Primary
- **Anodized Orange** (dark `#ffb240` / light `#bd4620`): The one accent. Primary buttons, the active nav item, the current/lit row and stat, focus rings. In dark it runs bright/amber and is allowed to *glow* on the primary control (literal "armed" state); in light it deepens to burnt-orange and reads as a machined inset. Same hue family, theme-appropriate shade.

### Neutral
- **Console Graphite** (dark `#15181c`): The body surface in dark. Light mode swaps to **Matte Paper** (`#f3f2ee`), a true low-warmth near-white, not a cream.
- **Raised Panel** (dark `#1a1e24` / light `#ffffff`): Cards, tables, inputs — one step toward the viewer from the body.
- **Sunken Rail** (dark `#11151a` / light `#eceae4`): Table headers, toolbars, segmented-control troughs — one step back.
- **Ink** (dark `#e9edf1` / light `#1e1c19`): Primary text. **Ink Soft** (`#c5ccd4` / `#6a665e`) for secondary; **Ink Faint** (`#8a929c` / `#918c82`) for mono labels and meta.
- **Hairline** (dark `#2a3037` / light `#dcdad3`) and **Hairline Strong** (`#39414a` / `#cbc8bf`): borders and dividers, always 1px.

### Tertiary
- **Steel** (`#8fb4e8` / `#3a6ea5`): reserved structural/secondary signal; sparing.
- **Danger** (`#ff6b5e` / `#b23224`) and **OK** (`#57d98a` / `#2f8f57`): destructive actions, validation errors, active/disabled status badges.

### Named Rules
**The One Accent Rule.** Anodized orange is the only chromatic color in routine
use, and it appears on roughly ≤10% of any screen — the live control, the current
selection, the lit row. Its rarity is what makes "lit" read as a signal. Never
use it to decorate a heading, a border stripe, or a background panel.

**The No-Cream Rule.** The light surface is matte paper at near-zero warmth, not a
beige/cream/sand. Warmth lives in the accent, never in the body background.

## 3. Typography

**Sans Font:** Geist (with system-ui, sans-serif)
**Mono Font:** Geist Mono (with ui-monospace, monospace)

**Character:** One sans carries headings, labels, buttons, and body; one mono
carries every number, label kicker, code-like value, and serial. The sans/mono
split *is* the type system — no display pairing, no second sans. Mono with
tabular figures is the instrument's voice: data that lines up to the digit.

### Hierarchy
- **Display** (600, 1.5rem / `text-2xl`, line-height 1.1, -0.01em): page titles only (`PageHeader`). Fixed rem, never fluid — a heading in a panel shouldn't shrink.
- **Title** (600, 0.875rem): card/section headings, form group headings.
- **Body** (400, 0.875rem, line-height 1.5): default copy and table cells. Prose capped at ~65–75ch; dense tables may run wider.
- **Label** (600, 0.65rem, letter-spacing 0.14em, UPPERCASE, **mono**): the stamped kicker on stats, table column headers, status badges.
- **Data** (400, 0.875rem, **mono**, `tnum`): capacities, counts, labels, calibers, dates, serials.

### Named Rules
**The Tabular Rule.** Every number — capacity, count, ordinal, date — is mono with
tabular figures. Numbers that don't line up vertically are a defect, not a style
choice.

**The Mono-Label Rule.** Small uppercase kickers and column headers are mono, not
tracked sans. The monospace tick is the "machined" tell.

## 4. Elevation

Largely flat. Depth is built from **tonal layering** (sunken rail → body → raised
panel) plus 1px hairlines, not from drop shadows. Shadows exist but are
incidental: subtle in light, nearly invisible on the dark graphite where the
tonal steps do the work. The one piece of real "elevation" is the accent **glow**
in dark mode — and it is a *state* signal (the primary/lit control is energized),
not ambient decoration.

### Shadow Vocabulary
- **Raised** (`--shadow-raised`): a whisper under cards/tables. Light: `0 1px 2px / 0 2px 8px` warm-black at 5–6%. Dark: barely-there black; the hairline + tonal step carry it.
- **Pop** (`--shadow-pop`): dialogs only.
- **Glow / Inset** (`--glow-blaze`): dark = `0 0 16px` anodized at 30% (the lit control); light = a `0 1px 0` machined inset edge. Same token, opposite material.

### Named Rules
**The Flat-Until-Lit Rule.** Surfaces are flat at rest, separated by tone and
hairline. The only thing that visibly *energizes* is the accent, and only when it
marks live state.

## 5. Components

### Buttons
- **Shape:** 6px radius (`--radius`), sized in fixed heights (md 40px, sm 32px).
- **Primary:** anodized fill, dark ink, the `--glow-blaze` treatment (glow in dark, inset in light). Hover lifts brightness ~5%; active settles it.
- **Secondary:** raised-panel fill, strong hairline border, ink text; hover → sunken.
- **Ghost:** transparent, soft ink; hover fills sunken and firms the ink. Used for Edit/Share/Sign-out.
- **Danger:** transparent with a danger-tinted border; hover fills danger-soft. Delete only.

### Inputs / Fields
- **Style:** raised-panel fill, 1px strong hairline, 6px radius, mono+tabular value text.
- **Focus:** border shifts to anodized; the 2px anodized focus ring is the global affordance.
- **Error:** `aria-invalid` flips the border to danger and tints the fill danger-soft; the field's error text is mono-small danger.
- **Select:** same shell with a custom chevron; native `<select>` for reliability.

### Tables (signature surface)
- Raised-panel body in a `--radius-lg` (10px) frame with a hairline.
- **Header:** sunken rail, mono uppercase label text.
- **Rows:** 1px hairline dividers; hover tints the row with anodized-soft. The current/active row is "lit" (brighter fill + a small filled accent dot), never a left border-stripe.
- Numbers right-aligned and tabular.

### Badges
- Pill, anodized-soft fill, anodized text, hairline border — the compatible-firearm and permission chips. `ok`/`danger` tones for status.

### Stat (machined detail)
- Raised panel with a short **anodized tick-mark stamped at the top edge**, a mono uppercase label, and a large tabular value. The tick is the signature "made by an instrument" mark.

### Navigation
- Top bar over a translucent body with a hairline underline. Items are soft-ink; the active item is "lit" (anodized-soft fill + anodized text). Account, theme toggle, and sign-out sit in the right chrome.
- **Theme toggle:** cycles Light → Dark → System; the icon swaps with a Motion rotate+crossfade (≤200ms, ease-out, reduced-motion safe).

## 6. Do's and Don'ts

### Do:
- **Do** keep anodized orange to ≤10% of a screen — primary action, current selection, lit/active state, focus.
- **Do** set every number, label kicker, and serial in Geist Mono with tabular figures.
- **Do** build depth from tonal layers (sunken → body → raised) + 1px hairlines first; reach for shadow last.
- **Do** let the accent *glow* in dark only as a state signal (the lit control/row), and degrade it to a machined inset in light.
- **Do** test heading copy at every breakpoint; fixed rem type, no fluid clamp in app UI.
- **Do** give every interactive component default/hover/focus/active/disabled, and ship empty states that teach (the "add your first…" CTAs).

### Don't:
- **Don't** build a generic SaaS dashboard: no gradient cards, no big hero-metric template, no identical icon+heading card grids.
- **Don't** ship a sterile, point-of-view-free corporate panel. Restraint is not the same as boring; the tick-marks, the lit state, and the mono voice are the personality.
- **Don't** go cute: no pastels, mascots, emoji, bounce, or elastic motion. Motion is exponential ease-out, in service of state.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe on rows, cards, or callouts. Mark active state with a lit fill + accent dot instead.
- **Don't** use gradient text, decorative glassmorphism, or the accent as a background fill.
- **Don't** put the light body on a cream/sand/beige. Matte paper at near-zero warmth only.
