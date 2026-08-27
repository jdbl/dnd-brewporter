// Tests for the race-trait "copy official mechanics by name" match (issue
// 020) inside scripts/importer.mjs. copyOfficialRaceTraitMechanics itself
// calls the live Foundry game/fromUuid APIs (see importDdbFeat's own
// copyOfficialFeatMechanics for the established pattern), which no test in
// this repo mocks yet — so, per the issue's own guidance, the actual
// match/no-match/wrong-species-collision decision is factored out into
// findRaceTraitMatch, a pure function over plain index-entry objects with no
// Foundry global reads at all. That's what's exercised directly here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findRaceTraitMatch } from "../scripts/importer.mjs";

// Shape mirrors what buildNameIndex now pushes per pack entry (see
// scripts/importer.mjs's buildNameIndex): uuid/name/pack/tier plus the
// race-specific raceCategory (system.type.value) and raceRequirement
// (system.requirements) fields this ticket adds.
function candidate(overrides) {
  return {
    uuid: "Compendium.dnd5e.origins24.Item.xxxx",
    name: "Trait",
    pack: "dnd5e.origins24",
    tier: 1,
    img: "icons/svg/upgrade.svg",
    type: "feat",
    classHint: null,
    subtype: "",
    raceCategory: "race",
    raceRequirement: "Dragonborn",
    ...overrides,
  };
}

test("findRaceTraitMatch: exact species+category match resolves (Dragonborn's Breath Weapon)", () => {
  const candidates = [
    candidate({ uuid: "uuid-breath-weapon", name: "Breath Weapon", raceRequirement: "Dragonborn" }),
  ];
  const match = findRaceTraitMatch(candidates, { fullName: "Dragonborn" }, "2024");
  assert.ok(match, "expected a match");
  assert.equal(match.uuid, "uuid-breath-weapon");
});

test("findRaceTraitMatch: does NOT cross-match a same-named trait from a different species (Dwarf's Speed vs. another species' Speed)", () => {
  // Two packs each ship their own "Speed" trait, filed under different
  // species — a bare name-only lookup (safe for feats) would be ambiguous
  // at best, or silently wrong if only one happened to survive tier
  // preference. The species-scoped filter must reject both, not guess.
  const candidates = [
    candidate({ uuid: "uuid-dwarf-speed", name: "Speed", raceRequirement: "Dwarf" }),
    candidate({ uuid: "uuid-elf-speed", name: "Speed", raceRequirement: "Elf" }),
  ];
  const match = findRaceTraitMatch(candidates, { fullName: "Dwarf" }, "2024");
  assert.ok(match, "expected the Dwarf-filed candidate to match");
  assert.equal(match.uuid, "uuid-dwarf-speed");

  // And importing a *third*, unrelated species' same-named trait must not
  // pick either of the above.
  const noMatch = findRaceTraitMatch(candidates, { fullName: "Halfling" }, "2024");
  assert.equal(noMatch, null, "a species with no candidate at all must not fall back to any Speed trait");
});

test("findRaceTraitMatch: rejects a name+species match whose raceCategory isn't 'race' (e.g. a same-named Feat)", () => {
  // A feat could coincidentally share a race trait's name (e.g. some
  // homebrew "Keen Senses" feat) and even coincidentally carry a
  // requirements string that happens to normalize the same way — the
  // raceCategory check is what keeps that from being treated as a trait.
  const candidates = [
    candidate({ uuid: "uuid-not-a-trait", name: "Keen Senses", raceCategory: "class", raceRequirement: "Elf" }),
  ];
  const match = findRaceTraitMatch(candidates, { fullName: "Elf" }, "2024");
  assert.equal(match, null);
});

test("findRaceTraitMatch: no candidates at all returns null (homebrew/unmatched species)", () => {
  assert.equal(findRaceTraitMatch(undefined, { fullName: "Warforged" }, "2024"), null);
  assert.equal(findRaceTraitMatch([], { fullName: "Warforged" }, "2024"), null);
});

test("findRaceTraitMatch: a candidate with no raceRequirement at all is never treated as a match", () => {
  const candidates = [candidate({ uuid: "uuid-unfiled", raceRequirement: undefined })];
  const match = findRaceTraitMatch(candidates, { fullName: "Dragonborn" }, "2024");
  assert.equal(match, null);
});

test("findRaceTraitMatch: species comparison is name-normalized (case/whitespace insensitive, matching normalizeName)", () => {
  const candidates = [candidate({ uuid: "uuid-gnomish-cunning", name: "Gnomish Cunning", raceRequirement: "  GNOME  " })];
  const match = findRaceTraitMatch(candidates, { fullName: "gnome" }, "2024");
  assert.ok(match);
  assert.equal(match.uuid, "uuid-gnomish-cunning");
});

test("findRaceTraitMatch: more than one same-species race-category survivor is treated as unresolved, not guessed", () => {
  // Two distinct compendium entries (e.g. a 2014 and a 2024 copy that
  // ruleset-preference didn't collapse, or two third-party packs) both
  // legitimately filed under the same species with the same trait name —
  // conservative behavior is to not pick one arbitrarily.
  const candidates = [
    candidate({ uuid: "uuid-a", raceRequirement: "Gnome" }),
    candidate({ uuid: "uuid-b", raceRequirement: "Gnome" }),
  ];
  const match = findRaceTraitMatch(candidates, { fullName: "Gnome" }, "ask");
  assert.equal(match, null);
});

test("findRaceTraitMatch: applies ruleset preference before filtering, same as a normal lookup", () => {
  // A 2014 (tier 2) and 2024 (tier 1) copy of the same trait, both
  // correctly filed under the species — default preference ("2024") should
  // collapse to the 2024-tier one, leaving exactly one survivor.
  const candidates = [
    candidate({ uuid: "uuid-legacy", tier: 2, raceRequirement: "Dwarf" }),
    candidate({ uuid: "uuid-2024", tier: 1, raceRequirement: "Dwarf" }),
  ];
  const match = findRaceTraitMatch(candidates, { fullName: "Dwarf" }, "2024");
  assert.ok(match);
  assert.equal(match.uuid, "uuid-2024");
});

test("findRaceTraitMatch: a missing/empty raceDef.fullName never matches (defensive, no crash)", () => {
  const candidates = [candidate({ raceRequirement: "" })];
  assert.equal(findRaceTraitMatch(candidates, {}, "2024"), null);
  assert.equal(findRaceTraitMatch(candidates, undefined, "2024"), null);
});
