// Tests for issue 018: narrowing a copied official feat's ItemChoice
// restriction.list to the one class a D&D Beyond variant name specifies
// (Magic Initiate (Cleric)/(Druid)/(Wizard) all get the SAME shared
// official "Magic Initiate" item copied onto them, restriction list and
// all -- confirmed real bug in FEAT_AUDIT_REPORT.md). Pure object-in,
// object-out, no Foundry dependency, so it runs under plain `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { narrowSpellRestrictionToVariantClass } from "../scripts/importer.mjs";

function magicInitiateAdvancement() {
  return {
    aaa111: {
      _id: "aaa111", type: "ItemChoice", configuration: {
        choices: [{ count: 2 }],
        restriction: { level: "0", list: ["class:cleric", "class:druid", "class:wizard"] },
        spell: { ability: ["int", "wis", "cha"] },
      },
    },
    bbb222: {
      _id: "bbb222", type: "ItemChoice", configuration: {
        choices: [{ count: 1 }],
        restriction: { level: "1", list: ["class:cleric", "class:druid", "class:wizard"] },
        spell: { ability: ["int", "wis", "cha"], uses: { max: "1", per: "lr", requireSlot: false } },
      },
    },
  };
}

test("narrows both entries' restriction.list to just the DDB variant's own class", () => {
  const narrowed = narrowSpellRestrictionToVariantClass(magicInitiateAdvancement(), "Magic Initiate (Cleric)");
  assert.deepEqual(narrowed.aaa111.configuration.restriction.list, ["class:cleric"]);
  assert.deepEqual(narrowed.bbb222.configuration.restriction.list, ["class:cleric"]);
});

test("narrows to Druid or Wizard for the other two variants", () => {
  assert.deepEqual(
    narrowSpellRestrictionToVariantClass(magicInitiateAdvancement(), "Magic Initiate (Druid)").aaa111.configuration.restriction.list,
    ["class:druid"]
  );
  assert.deepEqual(
    narrowSpellRestrictionToVariantClass(magicInitiateAdvancement(), "Magic Initiate (Wizard)").aaa111.configuration.restriction.list,
    ["class:wizard"]
  );
});

test("leaves other configuration fields (choices, spell.ability, spell.uses) untouched", () => {
  const narrowed = narrowSpellRestrictionToVariantClass(magicInitiateAdvancement(), "Magic Initiate (Cleric)");
  assert.deepEqual(narrowed.aaa111.configuration.choices, [{ count: 2 }]);
  assert.deepEqual(narrowed.bbb222.configuration.spell.uses, { max: "1", per: "lr", requireSlot: false });
  assert.equal(narrowed.aaa111.configuration.restriction.level, "0");
});

test("is a no-op when the name has no trailing parenthetical", () => {
  const input = magicInitiateAdvancement();
  const narrowed = narrowSpellRestrictionToVariantClass(input, "Magic Initiate");
  assert.deepEqual(narrowed, input);
});

test("is a no-op when the parenthetical class isn't already in the list (never adds a class the source didn't offer)", () => {
  const input = magicInitiateAdvancement();
  const narrowed = narrowSpellRestrictionToVariantClass(input, "Magic Initiate (Sorcerer)");
  assert.deepEqual(narrowed.aaa111.configuration.restriction.list, ["class:cleric", "class:druid", "class:wizard"]);
});

test("is a no-op on an advancement entry with no restriction.list at all", () => {
  const input = { ccc333: { _id: "ccc333", type: "AbilityScoreImprovement", configuration: { cap: 1, points: 1 } } };
  const narrowed = narrowSpellRestrictionToVariantClass(input, "Athlete (Something)");
  assert.deepEqual(narrowed, input);
});

test("is a no-op on a restriction.list that's already down to one class", () => {
  const input = { aaa111: { _id: "aaa111", type: "ItemChoice", configuration: { restriction: { list: ["class:druid"] } } } };
  const narrowed = narrowSpellRestrictionToVariantClass(input, "Magic Initiate (Druid)");
  assert.deepEqual(narrowed, input);
});

test("handles a multi-word class name in the parenthetical via slugify", () => {
  const input = { aaa111: { _id: "aaa111", type: "ItemChoice", configuration: { restriction: { list: ["class:eldritch-knight", "class:wizard"] } } } };
  const narrowed = narrowSpellRestrictionToVariantClass(input, "Some Feat (Eldritch Knight)");
  assert.deepEqual(narrowed.aaa111.configuration.restriction.list, ["class:eldritch-knight"]);
});
