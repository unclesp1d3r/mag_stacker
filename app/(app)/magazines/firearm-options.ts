import type { FirearmOption } from "@/components/inventory/compatible-firearms-field";

interface OptionSource {
  id: string;
  name: string;
  isMagazineFed: boolean;
}

/**
 * The firearms a magazine may be declared compatible with (#37 R5).
 *
 * Non-magazine-fed firearms are dropped: offering a revolver as a magazine's
 * compatible host invites a nonsensical association.
 *
 * This filter is presentation only — it shapes what the picker OFFERS, not what
 * the server accepts. The write is refused independently by
 * `assertAllMagazineFed` in `src/domain/magazines/compatibility.ts`; do not
 * treat this function as the enforcement point.
 *
 * The same-name disambiguation `hint` is computed over the FILTERED list on
 * purpose — the fragment exists to tell two *selectable* firearms apart, so a
 * collision with a firearm nobody can pick is not a collision (R52).
 *
 * Note the deliberate asymmetry with the caller's `nameById` map, which stays
 * built from the UNFILTERED list: an already-stored compatibility link must
 * still render its firearm's name even if that firearm later became
 * non-magazine-fed through a restored backup or a direct DB write. Filtering
 * both would blank an existing badge instead of showing the inconsistency.
 */
export function magazineFedOptions(
  firearms: readonly OptionSource[],
): FirearmOption[] {
  const selectable = firearms.filter((f) => f.isMagazineFed);
  const nameCounts = new Map<string, number>();
  for (const f of selectable) {
    nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);
  }
  return selectable.map((f) => ({
    id: f.id,
    name: f.name,
    // Disambiguate same-named firearms with a non-sensitive id fragment (R52).
    hint: (nameCounts.get(f.name) ?? 0) > 1 ? f.id.slice(0, 6) : undefined,
  }));
}
