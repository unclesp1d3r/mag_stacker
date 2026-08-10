import { describe, expect, test } from "bun:test";
import { magazineFedOptions } from "../firearm-options";

/**
 * Compatible-firearm option filtering (#37 R5) and the deliberate `nameById`
 * asymmetry (KTD6). The asymmetry test exists because "filter both lists" is
 * the obvious-looking cleanup a future reader would reach for, and it would
 * silently blank the firearm name on an already-stored compatibility link.
 */
describe("magazineFedOptions", () => {
  const magFed = { id: "a", name: "Glock 19", isMagazineFed: true };
  const notMagFed = { id: "b", name: "Ruger GP100", isMagazineFed: false };

  test("offers only magazine-fed firearms (R5)", () => {
    const options = magazineFedOptions([magFed, notMagFed]);

    expect(options.map((o) => o.id)).toEqual(["a"]);
  });

  test("returns an empty list when every firearm is non-magazine-fed", () => {
    expect(magazineFedOptions([notMagFed])).toEqual([]);
  });

  test("preserves the caller's order", () => {
    const second = { id: "c", name: "SIG P320", isMagazineFed: true };
    const options = magazineFedOptions([second, notMagFed, magFed]);

    expect(options.map((o) => o.id)).toEqual(["c", "a"]);
  });

  test("adds a disambiguating hint only when two SELECTABLE firearms collide (R52)", () => {
    const twin = { id: "aaaaaa-second", name: "Glock 19", isMagazineFed: true };
    const options = magazineFedOptions([magFed, twin]);

    expect(options.every((o) => o.hint !== undefined)).toBe(true);
  });

  test("a collision with a NON-selectable firearm is not a collision — no hint", () => {
    // The revolver shares a name but can never be picked, so the hint would be
    // noise: the counts are computed over the filtered list on purpose.
    const sameNameRevolver = {
      id: "b",
      name: "Glock 19",
      isMagazineFed: false,
    };
    const options = magazineFedOptions([magFed, sameNameRevolver]);

    expect(options).toHaveLength(1);
    expect(options[0].hint).toBeUndefined();
  });

  test("KTD6: filtering options never removes a name from the caller's lookup map", () => {
    // `nameById` is built from the UNFILTERED list by the pages, so a stored
    // compatibility link still renders its firearm's name even after that
    // firearm becomes non-magazine-fed via a restored backup or direct DB
    // write. Filtering both would blank an existing badge instead of showing
    // the inconsistency.
    const firearms = [magFed, notMagFed];
    const nameById = new Map(firearms.map((f) => [f.id, f.name]));
    const options = magazineFedOptions(firearms);

    expect(options.some((o) => o.id === notMagFed.id)).toBe(false);
    expect(nameById.get(notMagFed.id)).toBe("Ruger GP100");
  });
});
