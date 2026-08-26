// Tests for issue 021: scanSegmentText's spell-name fallback regex
// (`castRe`) already special-cases the word "spell" so a phrase like "cast
// the Fireball spell" captures the clean candidate "Fireball" rather than
// "Fireball spell" -- but nothing equivalent existed for "cantrip"/
// "cantrips", which is just as common in real D&D Beyond racial-trait text
// ("you know the Minor Illusion cantrip", "you know the Mending and
// Prestidigitation cantrips"). Without its own exclusion, the candidate
// capture group swallowed "cantrip" as if it were part of the name (e.g.
// "Minor Illusion Cantrip"), which then failed the compendium lookup gate
// and silently dropped the spell grant entirely -- confirmed live on Elf's
// Elven Lineage, Gnome's Gnomish Lineage, and Tiefling's Otherworldly
// Presence/Infernal Legacy/Fiendish Legacy cantrips.
//
// scanSegmentText is a pure string-in/data-out function (no Foundry/DOM
// dependency), so it runs under plain `node --test`, same as issues
// 007/008/016/017/019. A plain Map stands in for the real compendium name
// index -- scanSegmentText only ever calls index.has(normalizeName(...)),
// the same shape buildNameIndex's real Map uses in production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, scanSegmentText } from "../scripts/scraper.mjs";

function fakeIndex(names) {
  const index = new Map();
  for (const name of names) index.set(normalizeName(name), [{ name }]);
  return index;
}

test("recognizes a single 'know the X cantrip' grant (Elven Lineage shape)", () => {
  const index = fakeIndex(["Minor Illusion"]);
  const spellNames = [];
  scanSegmentText("You know the Minor Illusion cantrip.", spellNames, index);
  assert.deepEqual(spellNames, ["Minor Illusion"]);
});

test("recognizes a plural 'know the X and Y cantrips' grant naming two cantrips (Gnomish Lineage shape)", () => {
  const index = fakeIndex(["Mending", "Prestidigitation"]);
  const spellNames = [];
  scanSegmentText("You know the Mending and Prestidigitation cantrips.", spellNames, index);
  assert.deepEqual(spellNames, ["Mending", "Prestidigitation"]);
});

test("existing 'cast/casting the X spell' detection is unaffected (regression)", () => {
  const index = fakeIndex(["Fireball"]);
  const spellNames = [];
  scanSegmentText("you can cast the fireball spell once per long rest.", spellNames, index);
  assert.deepEqual(spellNames, ["fireball"]);
});

test("existing 'always have the X spell prepared' detection is unaffected (regression)", () => {
  const index = fakeIndex(["Misty Step"]);
  const spellNames = [];
  scanSegmentText("You always have the Misty Step spell prepared.", spellNames, index);
  assert.deepEqual(spellNames, ["Misty Step"]);
});

test("a bare cantrip name with no trailing 'cantrip(s)' word still resolves via the plain candidate lookup", () => {
  const index = fakeIndex(["Thaumaturgy"]);
  const spellNames = [];
  scanSegmentText("You always know the Thaumaturgy cantrip, and it doesn't count against the number of cantrips you know.", spellNames, index);
  assert.deepEqual(spellNames, ["Thaumaturgy"]);
});

test("an unrelated 'have the X condition' sentence produces no spurious cantrip hit (regression, false-positive guard)", () => {
  const index = fakeIndex(["Minor Illusion"]); // a real cantrip exists in the index, but isn't mentioned here
  const spellNames = [];
  scanSegmentText("You have the Invisible condition until the start of your next turn.", spellNames, index);
  assert.deepEqual(spellNames, []);
});
