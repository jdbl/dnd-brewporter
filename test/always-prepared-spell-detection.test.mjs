// Tests for issue 019: recognizing an "always have the X spell prepared"
// spell grant, not just "cast/casting X" -- scanSegmentText's textual
// spell-name fallback is a pure string-in/data-out function (no Foundry/
// DOM dependency), so it runs under plain `node --test`, same as issues
// 007/008/016/017. A plain Map stands in for the real compendium name
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

test("recognizes 'you always have the X spell prepared' (Fey Touched shape)", () => {
  const index = fakeIndex(["Misty Step"]);
  const text = "You always have the Misty Step spell prepared. You can cast it using a spell slot, or without expending a slot once, and you regain the ability to cast it this way when you finish a long rest.";
  const spellNames = [];
  scanSegmentText(text, spellNames, index);
  assert.deepEqual(spellNames, ["Misty Step"]);
});

test("recognizes 'has'/'know'/'knows'/'learn'/'learns' variants", () => {
  const cases = [
    ["has the X spell", "The creature has the Entangle spell prepared."],
    ["know the X spell", "You know the Detect Thoughts spell."],
    ["knows the X spell", "Each cultist knows the Bane spell."],
    ["learn the X spell", "You learn the Armor of Agathys spell."],
    ["learns the X spell", "The warlock learns the Magic Weapon spell at 3rd level."],
  ];
  for (const [label, text] of cases) {
    const index = fakeIndex(["Entangle", "Detect Thoughts", "Bane", "Armor of Agathys", "Magic Weapon"]);
    const spellNames = [];
    scanSegmentText(text, spellNames, index);
    assert.ok(spellNames.length === 1, `${label}: expected one spell name, got ${JSON.stringify(spellNames)}`);
  }
});

test("existing 'cast/casting the X spell' detection is unaffected (regression)", () => {
  const index = fakeIndex(["Fireball"]);
  const spellNames = [];
  scanSegmentText("you can cast the fireball spell once per long rest.", spellNames, index);
  assert.deepEqual(spellNames, ["fireball"]);
});

test("an unrelated 'have the X condition' sentence produces no spurious spell hit (regression, false-positive guard)", () => {
  const index = fakeIndex(["Misty Step"]); // a real spell exists in the index, but isn't mentioned here
  const spellNames = [];
  scanSegmentText("You have the Invisible condition until the start of your next turn.", spellNames, index);
  assert.deepEqual(spellNames, []);
});

test("an unrelated 'have advantage on...' sentence produces no spurious spell hit (regression, false-positive guard)", () => {
  const index = fakeIndex(["Misty Step"]);
  const spellNames = [];
  scanSegmentText("You have advantage on Charisma (Deception) checks while disguised.", spellNames, index);
  assert.deepEqual(spellNames, []);
});

test("a spell name found via 'always have...prepared' composes with issue 016's uses/recovery detection with no extra wiring", () => {
  const index = fakeIndex(["Misty Step"]);
  const text = "You always have the Misty Step spell prepared, and you can cast it once without a spell slot, regaining the ability to do so when you finish a long rest.";
  const { usesFormula, recoveryPeriod } = scanSegmentText(text, [], index);
  assert.equal(usesFormula, "1");
  assert.equal(recoveryPeriod, "lr");
});
