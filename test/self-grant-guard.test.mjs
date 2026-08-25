// Tests for the self-grant guard (issue 007) and the reaction-gated toggle
// grant (issue 008) inside scripts/scraper.mjs. Both isGenuineSelfGrant and
// scanSegmentText are pure string-in/data-out functions with no dependency
// on Foundry globals or DOMParser, so they run under plain `node --test`
// with zero new dependencies (see PRD-effects-gaps.md's Testing Decisions).
//
// buildActiveEffectData (effects-builder.mjs) is also exercised directly to
// confirm the toggle-hint shape actually builds a transfer:false effect
// with a real duration -- it doesn't touch the DOM either, only
// guessFeatureMechanics' HTML-parsing wrapper around scanSegmentText does,
// which is why this suite calls scanSegmentText directly instead of going
// through the full guessQueueEntries/buildAutoMechanics pipeline.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isGenuineSelfGrant, scanSegmentText } from "../scripts/scraper.mjs";
import { buildActiveEffectData } from "../scripts/effects-builder.mjs";

// ---------------------------------------------------------------------
// isGenuineSelfGrant -- issue 007's six confirmed misfires, tested
// directly against the "before" text extracted from each real sentence.
// ---------------------------------------------------------------------

test("isGenuineSelfGrant rejects confirmed misfires (issue 007)", async (t) => {
  const rejectedCases = [
    ["Athlete: guard clause ('When you have...')", "When you "],
    ["Mounted Combatant: 'neither of you can have'", "Additionally, neither of you can "],
    ["Mounted Combatant: 'if you don't have'", "You can dismount as a Reaction if you don't "],
    ["Pack Fighting: third party + negation ('the ally doesn't have')", "at least one of your allies is within 5 feet of the creature and the ally doesn't "],
    ["Shield Master: third-party subject ('cause it to have')", "If the target is Large or smaller and the attack hits, you can cause it to "],
    ["Prone Fighting: guard clause ('While you have...')", "While you "],
    ["Infernal Dragoon: self-referential 'immune to this ability's'", "Once a creature is affected, it is immune to this ability's "],
  ];

  for (const [label, before] of rejectedCases) {
    await t.test(label, () => {
      assert.equal(isGenuineSelfGrant(before), false, `expected rejection for before="${before}"`);
    });
  }
});

test("isGenuineSelfGrant accepts genuine self-grants (regression, both directions)", async (t) => {
  const acceptedCases = [
    ["Disappearing Step's own legitimate self-grant", "You "],
    ["a plain unconditional self-grant with no guard/subject language", "During your turn, you "],
  ];
  for (const [label, before] of acceptedCases) {
    await t.test(label, () => {
      assert.equal(isGenuineSelfGrant(before), true, `expected acceptance for before="${before}"`);
    });
  }
});

test("isGenuineSelfGrant preserves the pre-existing saving-throw and until-or guards", () => {
  // Celestial Revelation-shape: a save-or-suffer clause aimed at another
  // creature, not the trait's own holder.
  assert.equal(
    isGenuineSelfGrant("A creature within 10 feet of you must succeed on a Wisdom saving throw or "),
    false
  );
  // Draconic Flight-shape: an earlier "until X or" duration-list
  // terminator for an unrelated grant, not a status being granted.
  assert.equal(
    isGenuineSelfGrant("Your wings last until you retract the wings as a Bonus Action or "),
    false
  );
});

// ---------------------------------------------------------------------
// scanSegmentText -- full-pipeline coverage for the same misfires (issue
// 007), the reaction-gated toggle grant (issue 008), and regression cases
// in both directions.
// ---------------------------------------------------------------------

test("scanSegmentText produces no self-granted-condition effect for confirmed misfires (issue 007)", async (t) => {
  const cases = {
    "Athlete": "When you have the Prone condition, standing up uses only 5 feet of movement regardless of your speed.",
    "Mounted Combatant (neither)": "Additionally, neither of you can have the Incapacitated condition while mounted.",
    "Mounted Combatant (don't)": "You can dismount as a Reaction if you don't have the Incapacitated condition.",
    "Pack Fighting": "You have advantage on an attack roll against a creature if at least one of your allies is within 5 feet of the creature and the ally doesn't have the Incapacitated condition.",
    "Shield Master": "If the target is Large or smaller and the attack hits, you can cause it to have the Prone condition.",
    "Prone Fighting": "While you have the Prone condition, you can make opportunity attacks against creatures within 5 feet of you as though you were not Prone.",
  };

  for (const [label, text] of Object.entries(cases)) {
    await t.test(label, () => {
      const seg = scanSegmentText(text, [], null);
      assert.deepEqual(seg.statusHints, [], `expected no statusHints for "${label}"`);
      assert.deepEqual(seg.effectHints, [], `expected no effectHints for "${label}"`);
    });
  }
});

test("scanSegmentText's condition-immunity detector rejects the Infernal Dragoon case", () => {
  const text =
    "A creature affected by this breath must succeed on a Constitution saving throw or have the Frightened condition " +
    "until the end of its next turn. Once a creature is affected, it is immune to this ability's Frightened condition " +
    "for 24 hours.";
  const seg = scanSegmentText(text, [], null);
  assert.deepEqual(seg.effectHints, [], "the save-or-suffer mention and the self-referential 'this ability' mention should both be rejected");
});

test("scanSegmentText's condition-immunity detector still fires on a genuine shared-immune list (regression)", () => {
  // dnd5e's own canonical phrasing: one "immune" covering a damage type and
  // a condition together.
  const seg = scanSegmentText("You are immune to poison damage and the Poisoned condition.", [], null);
  assert.deepEqual(seg.effectHints, [
    { key: "system.traits.di.value", mode: 2, value: "poison" },
    { key: "system.traits.ci.value", mode: 2, value: "poisoned" },
  ]);
});

test("scanSegmentText's condition-immunity detector still fires on 2014 'immune to being X' phrasing (regression)", () => {
  const seg = scanSegmentText("You are immune to being Charmed while you remain in this form.", [], null);
  assert.deepEqual(seg.effectHints, [{ key: "system.traits.ci.value", mode: 2, value: "charmed" }]);
});

test("scanSegmentText detects a genuine Reaction-gated self-grant as a toggle hint, not a permanent one (issue 008, Fey Sentinel)", () => {
  const text =
    "When a creature you can see within 10 feet of you hits you with an attack, you can take a Reaction to gain " +
    "the Invisible condition until the start of your next turn.";
  const seg = scanSegmentText(text, [], null);

  // Not folded into the permanent statusHints array...
  assert.deepEqual(seg.statusHints, [], "the reaction-gated grant must not also appear as a permanent statusHint");
  // ...but captured as its own toggle-shaped hint with a real duration.
  assert.deepEqual(seg.toggleStatusHints, [{ condition: "invisible", durationType: "rounds", durationValue: 1 }]);

  // And it actually builds as a transfer:false effect with a real
  // duration, the same shape as the shipped Stonecunning item -- not
  // permanent, not nothing.
  const [toggle] = seg.toggleStatusHints;
  const ae = buildActiveEffectData({
    name: "Fey Sentinel",
    transfer: false,
    durationType: toggle.durationType,
    durationValue: toggle.durationValue,
    changes: [],
    statuses: [toggle.condition],
  });
  assert.equal(ae.transfer, false);
  assert.deepEqual(ae.duration, { value: 1, units: "rounds" });
  assert.deepEqual(ae.statuses, ["invisible"]);
});

test("scanSegmentText regression: already-fixed Draconic Flight and Celestial Revelation false positives stay fixed", () => {
  const draconicFlight = scanSegmentText(
    "Your wings last until you retract the wings as a Bonus Action or have the Incapacitated condition.",
    [], null
  );
  assert.deepEqual(draconicFlight.statusHints, []);

  const celestialRevelation = scanSegmentText(
    "A creature within 10 feet of you must succeed on a Wisdom saving throw or have the Frightened condition " +
      "until the end of its next turn.",
    [], null
  );
  assert.deepEqual(celestialRevelation.statusHints, []);
});

test("scanSegmentText regression: Disappearing Step's genuine self-grant still fires", () => {
  const text =
    "You have the Invisible condition until the start of your next turn or until you attack or force a creature " +
    "to make a saving throw.";
  const seg = scanSegmentText(text, [], null);
  assert.deepEqual(seg.statusHints, ["invisible"]);
  assert.deepEqual(seg.toggleStatusHints, []);
});
