// Tests for the duplicate/legacy racial trait name collision detector
// (issue 022). Multiple species audits (Orc, Dragonborn, Goliath, Tiefling,
// Human) found a species' racialTraits array can silently contain both a
// legacy/2014 and a current 2024 version of the same conceptual trait, both
// surviving usableRacialTraits' hideInSheet filter and both getting
// imported as separate Feature items with no signal to a human reviewer.
// findDuplicateTraitNameWarnings is a pure string-in/data-out function (no
// Foundry globals), so it runs under plain `node --test` like the other
// scraper/ddb-scraper unit suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { usableRacialTraits, findDuplicateTraitNameWarnings } from "../scripts/ddb-scraper.mjs";

// Builds a minimal raceDef shaped like the real DDB API: racialTraits is an
// array of { definition } wrappers, matching what usableRacialTraits reads.
function raceDef(fullName, traitDefs) {
  return {
    fullName,
    racialTraits: traitDefs.map((definition) => ({ definition })),
  };
}

// ---------------------------------------------------------------------
// findDuplicateTraitNameWarnings -- pure detector, called directly with an
// already-filtered trait list (matching how importDdbRace calls it).
// ---------------------------------------------------------------------

test("findDuplicateTraitNameWarnings flags an exact-name collision (e.g. 'Powerful Build' appearing twice)", () => {
  const traits = [
    { name: "Powerful Build", description: "2014 text." },
    { name: "Powerful Build", description: "2024 text, mechanically different." },
    { name: "Darkvision", description: "You have Darkvision." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Goliath");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].context, "Goliath");
  assert.match(warnings[0].reason, /Powerful Build/);
});

test("findDuplicateTraitNameWarnings flags a same-slugify collision with different casing/punctuation", () => {
  const traits = [
    { name: "Draconic Ancestry", description: "..." },
    { name: "draconic  ancestry!", description: "..." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Dragonborn");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].reason, /Draconic Ancestry/);
  assert.match(warnings[0].reason, /draconic  ancestry!/);
});

test("findDuplicateTraitNameWarnings flags a trailing-plural-s near-identical name collision", () => {
  const traits = [
    { name: "Ability Score Increase", description: "2014 flat +2/+1." },
    { name: "Ability Score Increases", description: "2024 flexible +2/+1 or +1/+1/+1." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Human");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].context, "Human");
  assert.match(warnings[0].reason, /Ability Score Increase/);
  assert.match(warnings[0].reason, /Ability Score Increases/);
});

test("findDuplicateTraitNameWarnings is case-insensitive for the trailing-s check", () => {
  const traits = [
    { name: "breath weapon", description: "..." },
    { name: "Breath Weapons", description: "..." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Dragonborn");
  assert.equal(warnings.length, 1);
});

test("findDuplicateTraitNameWarnings produces one warning per colliding pair and ignores unrelated traits", () => {
  const traits = [
    { name: "Adrenaline Rush", description: "2024 text." },
    { name: "Relentless Endurance", description: "2014 text." }, // different name/slug, not flagged
    { name: "Darkvision", description: "..." },
    { name: "Menacing", description: "..." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Orc");
  assert.deepEqual(warnings, []);
});

test("findDuplicateTraitNameWarnings produces no warnings for a species with no collisions", () => {
  const traits = [
    { name: "Darkvision", description: "..." },
    { name: "Fey Ancestry", description: "..." },
    { name: "Trance", description: "..." },
  ];
  const warnings = findDuplicateTraitNameWarnings(traits, "Elf");
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------
// Integration-shaped: usableRacialTraits' filtered output fed straight into
// findDuplicateTraitNameWarnings, matching importDdbRace's actual call
// sequence (scripts/importer.mjs's importDdbRace). Confirms the detector
// only ever adds a warning -- it never drops, merges, or reorders which
// traits usableRacialTraits hands back for item creation.
// ---------------------------------------------------------------------

test("a species with a colliding pair: both traits still come out of usableRacialTraits, and one warning is produced", () => {
  const def = raceDef("Goliath", [
    { name: "Powerful Build", hideInSheet: false, description: "2014 text." },
    { name: "Powerful Build", hideInSheet: false, description: "2024 text, mechanically different." },
    { name: "Stone's Endurance", hideInSheet: false, description: "..." },
    { name: "Languages", hideInSheet: true, description: "bookkeeping, filtered as before" },
  ]);

  const traits = usableRacialTraits(def);
  // hideInSheet trait still filtered out exactly as before; both duplicate
  // trait items are NOT dropped.
  assert.equal(traits.length, 3);
  assert.deepEqual(traits.map((t) => t.name), ["Powerful Build", "Powerful Build", "Stone's Endurance"]);

  const warnings = findDuplicateTraitNameWarnings(traits, def.fullName);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].context, "Goliath");
  assert.match(warnings[0].reason, /"Powerful Build".*"Powerful Build"/s, "reason should name both colliding traits");
});

test("a species with no collisions: no new warnings, and the filtered trait list is unaffected", () => {
  const def = raceDef("Elf", [
    { name: "Darkvision", hideInSheet: false, description: "..." },
    { name: "Fey Ancestry", hideInSheet: false, description: "..." },
    { name: "Trance", hideInSheet: false, description: "..." },
    { name: "Ability Score Increases", hideInSheet: true, description: "bookkeeping, filtered as before" },
  ]);

  const traits = usableRacialTraits(def);
  assert.equal(traits.length, 3);
  assert.deepEqual(traits.map((t) => t.name), ["Darkvision", "Fey Ancestry", "Trance"]);

  const warnings = findDuplicateTraitNameWarnings(traits, def.fullName);
  assert.deepEqual(warnings, []);
});
