// Tests for the spellLevelGates fix: a racial trait's own text sometimes
// bundles two spell/cantrip grants of different power into one trait -- an
// immediate cantrip plus a leveled spell that only becomes usable later
// ("You know the Produce Flame cantrip... Once you reach 3rd level, you can
// cast the Burning Hands spell..."). Confirmed real bug: Fire Genasi's Reach
// to the Blaze imported with no mechanical restriction at all on Burning
// Hands, since a "cast" Activity has no level-prerequisite field of its own
// and nothing extracted the "3rd level" the text already named. scanSegmentText
// is a pure string-in/data-out function (no Foundry/DOM dependency), so it
// runs under plain `node --test`, same as the issue 007/008/016/017/019/021
// suites.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, scanSegmentText } from "../scripts/scraper.mjs";

function fakeIndex(names) {
  const index = new Map();
  for (const name of names) index.set(normalizeName(name), [{ name }]);
  return index;
}

test("Fire Genasi's Reach to the Blaze shape: cantrip ungated, leveled spell gated at 3", () => {
  const index = fakeIndex(["Produce Flame", "Burning Hands"]);
  const text = "You know the Produce Flame cantrip. Once you reach 3rd level, you can cast the Burning Hands spell with this trait, and you regain the ability to do so when you finish a long rest.";
  const spellNames = [];
  const result = scanSegmentText(text, spellNames, index);
  assert.deepEqual(spellNames, ["Produce Flame", "Burning Hands"]);
  assert.deepEqual(result.spellLevelGates, { "Burning Hands": 3 });
});

test("recognizes 'when you reach Nth level' phrasing", () => {
  const index = fakeIndex(["Faerie Fire"]);
  const spellNames = [];
  const result = scanSegmentText("When you reach 3rd level, you can cast the Faerie Fire spell once per long rest.", spellNames, index);
  assert.deepEqual(result.spellLevelGates, { "Faerie Fire": 3 });
});

test("recognizes 'starting at Nth level' and 'beginning at Nth level' phrasing", () => {
  const index = fakeIndex(["Darkness", "Levitate"]);
  const startingResult = scanSegmentText("Starting at 5th level, you can cast the Darkness spell once with this trait.", [], index);
  assert.deepEqual(startingResult.spellLevelGates, { Darkness: 5 });

  const beginningResult = scanSegmentText("Beginning at 5th level, you can cast the Levitate spell once with this trait.", [], index);
  assert.deepEqual(beginningResult.spellLevelGates, { Levitate: 5 });
});

test("recognizes the 'character level N' digit form", () => {
  const index = fakeIndex(["Misty Step"]);
  const result = scanSegmentText("Once you reach character level 3, you can cast the Misty Step spell once with this trait.", [], index);
  assert.deepEqual(result.spellLevelGates, { "Misty Step": 3 });
});

test("a spell mentioned before any gate phrase stays ungated", () => {
  const index = fakeIndex(["Produce Flame"]);
  const result = scanSegmentText("You know the Produce Flame cantrip and can cast it at will.", [], index);
  assert.deepEqual(result.spellLevelGates, {});
});

test("regression: a trait with no level-gate language at all produces no gates", () => {
  const index = fakeIndex(["Minor Illusion"]);
  const result = scanSegmentText("You know the Minor Illusion cantrip.", [], index);
  assert.deepEqual(result.spellLevelGates, {});
});

test("a bare 'once you reach 5th level' with no adjacent spell doesn't misfire on unrelated grants (issue 016's own false-positive guard stays intact)", () => {
  const index = fakeIndex(["Produce Flame"]);
  const spellNames = [];
  const result = scanSegmentText("You know the Produce Flame cantrip, usable once per long rest, and something else happens once you reach 5th level unrelated to spellcasting.", spellNames, index);
  // Produce Flame is mentioned BEFORE the level-5 gate phrase, so it stays
  // ungated -- same nearest-preceding-gate rule as the main case above.
  assert.deepEqual(result.spellLevelGates, {});
  // The pre-existing once/twice uses-count detection (issue 016) must stay
  // unaffected by this addition -- "once per long rest" still resolves to a
  // single-use, long-rest-recovered resource exactly as before.
  assert.equal(result.usesFormula, "1");
  assert.equal(result.recoveryPeriod, "lr");
});
