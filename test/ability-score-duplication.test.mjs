// Regression test for the duplicate-AbilityScoreImprovement bug found by
// the feat-mechanics audit (2026-08-26): importDdbFeat (importer.mjs)
// merges assembleFeatItem's pre-seeded system.advancement with
// buildAutoMechanics' own returned advancement. Both independently called
// guessAbilityScoreAdvancement() over the same description text, and since
// each call mints a fresh random _id, a naive spread-merge kept both
// entries instead of one -- silently doubling every half-feat's ASI grant
// (confirmed on Actor, Chef, Crusher, Sentinel, and dozens more).
//
// buildAutoMechanics itself can't run under plain `node --test` (it goes
// through guessQueueEntries -> rulesetPreference -> game.settings, a
// Foundry global -- see self-grant-guard.test.mjs's own note on this), so
// this test exercises the same pure pieces buildAutoMechanics is built
// from (guessAbilityScoreAdvancement, guessProficiencyAdvancement) and
// assembleFeatItem, replicating importDdbFeat's exact merge expression
// both with and without the new skipAbilityScoreAdvancement fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { guessAbilityScoreAdvancement, guessProficiencyAdvancement } from "../scripts/scraper.mjs";
import { assembleFeatItem } from "../scripts/ddb-scraper.mjs";

function countByType(advancement, type) {
  return Object.values(advancement).filter((a) => a.type === type).length;
}

const actorLikeFeatDef = {
  id: 1, slug: "actor-like", name: "Actor-Like Test Feat",
  description: "<p>Increase your Charisma score by 1, to a maximum of 20.</p><p>You have played so many roles...</p>",
  prerequisites: [], isRepeatable: false,
};

const chefLikeFeatDef = {
  id: 2, slug: "chef-like", name: "Chef-Like Test Feat",
  description: "<p>Increase your Constitution or Wisdom score by 1, to a maximum of 20.</p>" +
    "<p>Using tools such as cook's utensils, you can whip up basic food. If you don't already have this proficiency, you gain proficiency with cook's utensils.</p>",
  prerequisites: [], isRepeatable: false,
};

test("assembleFeatItem seeds exactly one AbilityScoreImprovement entry on its own", () => {
  const item = assembleFeatItem(actorLikeFeatDef);
  assert.equal(countByType(item.system.advancement, "AbilityScoreImprovement"), 1);
});

test("pre-fix merge shape doubled the ASI grant (documents the bug)", () => {
  const item = assembleFeatItem(actorLikeFeatDef);
  const text = item.system.description.value;
  // This is exactly importDdbFeat's old merge: buildAutoMechanics's
  // advancement (unconditionally re-deriving the ASI guess) spread on top
  // of the already-seeded item.system.advancement.
  const preFixAutoMechanicsAdvancement = { ...(guessAbilityScoreAdvancement(text) ?? {}), ...guessProficiencyAdvancement(text) };
  const merged = { ...item.system.advancement, ...preFixAutoMechanicsAdvancement };
  assert.equal(countByType(merged, "AbilityScoreImprovement"), 2, "two independently-generated ids for the same guess both survived the spread");
});

test("post-fix merge (skipAbilityScoreAdvancement) keeps exactly one ASI entry", () => {
  const item = assembleFeatItem(actorLikeFeatDef);
  const text = item.system.description.value;
  // Mirrors buildAutoMechanics(text, ..., { skipAbilityScoreAdvancement: true }).
  const postFixAutoMechanicsAdvancement = { ...guessProficiencyAdvancement(text) };
  const merged = { ...item.system.advancement, ...postFixAutoMechanicsAdvancement };
  assert.equal(countByType(merged, "AbilityScoreImprovement"), 1);
});

test("post-fix merge still carries a proficiency grant found alongside the ASI clause (Chef-shape)", () => {
  const item = assembleFeatItem(chefLikeFeatDef);
  const text = item.system.description.value;
  const postFixAutoMechanicsAdvancement = { ...guessProficiencyAdvancement(text) };
  const merged = { ...item.system.advancement, ...postFixAutoMechanicsAdvancement };
  assert.equal(countByType(merged, "AbilityScoreImprovement"), 1, "still exactly one ASI entry, not zero or two");
  assert.equal(countByType(merged, "Trait"), 1, "the cook's-utensils proficiency grant is untouched by the ASI fix");
});

test("skipping ability-score advancement never drops it when the caller genuinely needs it (class feature / race trait shape)", () => {
  // Class features and race traits don't call assembleFeatItem at all, so
  // they never pre-seed an ASI guess -- they rely on buildAutoMechanics'
  // default (skip=false) to still produce one. This documents that the new
  // parameter defaults to preserving the old (correct, non-duplicating)
  // behavior for those callers.
  const text = "<p>Increase your Strength score by 1, to a maximum of 20.</p>";
  const defaultBehaviorAdvancement = { ...(guessAbilityScoreAdvancement(text) ?? {}), ...guessProficiencyAdvancement(text) };
  assert.equal(countByType(defaultBehaviorAdvancement, "AbilityScoreImprovement"), 1);
});
