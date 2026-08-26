// Tests for issue 017: activation-type/trigger detection, dice+modifier
// merging, range/target parsing, and linking a toggle effect to a real
// Activity. All of parseActivation, parseRangeAndTarget, scanSegmentText,
// buildActiveEffectData, and buildActivityData are pure string/object-in,
// data-out functions with no Foundry/DOM dependency, so they run under
// plain `node --test`, same as issues 007/008/016.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseActivation, parseRangeAndTarget, scanSegmentText } from "../scripts/scraper.mjs";
import { buildActiveEffectData, buildActivityData } from "../scripts/effects-builder.mjs";

// ---------------------------------------------------------------------
// parseActivation -- Reaction/Bonus Action/Action phrasing, real shapes
// confirmed in FEAT_AUDIT_REPORT.md's "wrong activation type" findings.
// ---------------------------------------------------------------------

test("parseActivation detects Reaction phrasing (Interception shape)", () => {
  const text = "When a creature you can see damages a creature within 5 feet of you with an attack, you can use your Reaction to reduce the damage the target takes by 1d10 + your Proficiency Bonus.";
  const { type, condition } = parseActivation(text);
  assert.equal(type, "reaction");
  assert.equal(condition, "When a creature you can see damages a creature within 5 feet of you with an attack");
});

test("parseActivation detects Bonus Action phrasing (Telekinetic shape)", () => {
  const { type } = parseActivation("You can use a Bonus Action to try to telekinetically shove one creature within 30 feet of you.");
  assert.equal(type, "bonus");
});

test("parseActivation detects 'take your Reaction' (War Caster shape)", () => {
  const { type } = parseActivation("When a creature provokes an opportunity attack from you, you can take your Reaction to cast a spell at the creature instead.");
  assert.equal(type, "reaction");
});

test("parseActivation falls back to 'special' for a trigger clause with no action-economy word (Boon of Dimensional Travel shape)", () => {
  const { type, condition } = parseActivation("Immediately after you take the Attack action, you can teleport up to 30 feet to an unoccupied space you can see.");
  assert.equal(type, "special");
  assert.equal(condition, "Immediately after you take the Attack action");
});

test("parseActivation returns null type and empty condition when neither is present (regression)", () => {
  const { type, condition } = parseActivation("You gain a +2 bonus to damage rolls.");
  assert.equal(type, null);
  assert.equal(condition, "");
});

test("parseActivation prioritizes Reaction over an incidental 'action' mention", () => {
  const { type } = parseActivation("As a Reaction, you can use your action's remaining movement to disengage.");
  assert.equal(type, "reaction");
});

// ---------------------------------------------------------------------
// scanSegmentText -- dice+modifier merging (Interception's dropped-die
// bug) and no double-counting against the standalone proficiency-bonus
// scanner.
// ---------------------------------------------------------------------

test("scanSegmentText merges a dice term with a following proficiency-bonus modifier into one formula", () => {
  const text = "you can use your Reaction to reduce the damage the target takes by 1d10 + your Proficiency Bonus.";
  const { diceHints } = scanSegmentText(text, [], null);
  assert.equal(diceHints.length, 1);
  assert.equal(diceHints[0].formula, "1d10+@prof");
  assert.equal(diceHints[0].kind, "damage");
});

test("scanSegmentText merges a dice term with an ability-modifier AND a proficiency-bonus chain", () => {
  const { diceHints } = scanSegmentText("the target takes 2d6 + your Charisma modifier + your Proficiency Bonus fire damage.", [], null);
  assert.equal(diceHints.length, 1);
  assert.equal(diceHints[0].formula, "2d6+@abilities.cha.mod+@prof");
  assert.equal(diceHints[0].type, "fire");
});

test("scanSegmentText's plain dice-only formula (no modifier suffix) is unaffected (regression)", () => {
  const { diceHints } = scanSegmentText("you take 2d12 fire damage.", [], null);
  assert.equal(diceHints.length, 1);
  assert.equal(diceHints[0].formula, "2d12");
});

test("scanSegmentText's existing literal-number dice modifier is unaffected (regression)", () => {
  const { diceHints } = scanSegmentText("you deal 1d8 + 2 slashing damage.", [], null);
  assert.equal(diceHints.length, 1);
  assert.equal(diceHints[0].formula, "1d8+2");
});

test("scanSegmentText's standalone proficiency-bonus scanner still fires when there's no dice term nearby (regression)", () => {
  const { diceHints } = scanSegmentText("you regain hit points equal to twice your proficiency bonus.", [], null);
  assert.equal(diceHints.length, 1);
  assert.equal(diceHints[0].formula, "@prof * 2");
  assert.equal(diceHints[0].kind, "heal");
});

test("scanSegmentText doesn't double-count a proficiency-bonus mention already folded into a merged dice formula", () => {
  const { diceHints } = scanSegmentText("you can use your Reaction to reduce the damage the target takes by 1d10 + your Proficiency Bonus.", [], null);
  // Exactly one hint (the merged "1d10+@prof") -- not a second, redundant
  // "@prof"-only hint from the standalone proficiency-bonus scanner.
  assert.equal(diceHints.length, 1);
});

// ---------------------------------------------------------------------
// parseRangeAndTarget -- field names/values confirmed against real
// dnd5e-shipped data (Fireball, Bless, Aura of Protection).
// ---------------------------------------------------------------------

test("parseRangeAndTarget extracts a plain 'within N feet' range", () => {
  const { range, target } = parseRangeAndTarget("you can redirect the damage at another creature within 60 feet of you.");
  assert.deepEqual(range, { value: 60, units: "ft" });
  assert.equal(target, null);
});

test("parseRangeAndTarget maps '30-foot Emanation' to template.type 'radius' (Aura of Protection shape)", () => {
  const { target } = parseRangeAndTarget("targets make a Charisma saving throw in a 30-foot emanation that originates from you.");
  assert.deepEqual(target, { template: { type: "radius", size: "30", units: "ft" } });
});

test("parseRangeAndTarget recognizes a 20-foot sphere (Fireball shape)", () => {
  const { target } = parseRangeAndTarget("each creature in a 20-foot sphere centered on that point must make a Dexterity saving throw.");
  assert.deepEqual(target, { template: { type: "sphere", size: "20", units: "ft" } });
});

test("parseRangeAndTarget extracts 'up to N creatures' as target.affects (Bless/Fey Tormentor shape)", () => {
  const { target } = parseRangeAndTarget("up to three creatures within 60 feet of you must make a Wisdom saving throw.");
  assert.deepEqual(target, { affects: { type: "creature", count: "3" } });
});

test("parseRangeAndTarget recognizes a digit-form creature count", () => {
  const { target } = parseRangeAndTarget("choose up to 6 creatures of your choice that you can see.");
  assert.deepEqual(target, { affects: { type: "creature", count: "6" } });
});

test("parseRangeAndTarget returns nulls when neither pattern is present (regression)", () => {
  const { range, target } = parseRangeAndTarget("you gain a +1 bonus to Armor Class.");
  assert.equal(range, null);
  assert.equal(target, null);
});

// ---------------------------------------------------------------------
// buildActivityData -- activation.condition/range/target wiring.
// ---------------------------------------------------------------------

test("buildActivityData wires activation.condition, range, and target.affects", () => {
  const act = buildActivityData("save", {
    name: "Energy Redirection",
    saveAbility: ["dex"],
    dcMode: "formula", dcValue: "8 + @prof",
    onSave: "none", damageParts: [],
    activationType: "reaction",
    activationCondition: "When you take damage of a type you have resistance to",
    range: { value: 60, units: "ft" },
  });
  assert.equal(act.activation.type, "reaction");
  assert.equal(act.activation.condition, "When you take damage of a type you have resistance to");
  assert.deepEqual(act.range, { value: 60, units: "ft", special: "", override: false });
});

test("buildActivityData wires target.template for an area effect", () => {
  const act = buildActivityData("save", {
    name: "Devilish Aura", saveAbility: ["cha"], dcMode: "flat", dcValue: "", onSave: "none", damageParts: [],
    target: { template: { type: "radius", size: "30", units: "ft" } },
  });
  assert.deepEqual(act.target.template, { type: "radius", size: "30", units: "ft" });
});

test("buildActivityData leaves activation.condition/range/target at defaults when not given (regression, manual-editor path)", () => {
  const act = buildActivityData("damage", { name: "Charge Damage", damageParts: [{ formula: "1d8", type: "bludgeoning" }] });
  assert.equal(act.activation.condition, "");
  assert.deepEqual(act.range, { value: null, units: "", special: "", override: false });
  assert.deepEqual(act.target, { affects: {}, template: {}, prompt: true, override: false });
});

// ---------------------------------------------------------------------
// Toggle effect -> linked Utility activity (Fey Sentinel's orphaned-effect
// bug). buildActiveEffectData/buildActivityData exercised directly since
// guessQueueEntries (the code that wires the two together) is private and
// only reachable via buildAutoMechanics's DOMParser-based HTML wrapper,
// which can't run outside a browser -- same limitation the issue 007/008
// suite already documents.
// ---------------------------------------------------------------------

test("a toggle effect's _id is a valid target for an Activity's linkedEffectIds (the shape guessQueueEntries wires together)", () => {
  const toggleEffect = buildActiveEffectData({
    name: "Fey Sentinel", transfer: false, durationType: "rounds", durationValue: 1, changes: [], statuses: ["invisible"],
  });
  assert.equal(toggleEffect.transfer, false);
  assert.deepEqual(toggleEffect.statuses, ["invisible"]);

  const { type, condition } = parseActivation("You can take a Reaction to gain the Invisible condition until the start of your next turn.");
  const activity = buildActivityData("utility", {
    name: "Fey Sentinel", activationType: type, activationCondition: condition, linkedEffectIds: [toggleEffect._id],
  });
  assert.equal(activity.type, "utility");
  assert.equal(activity.activation.type, "reaction");
  assert.deepEqual(activity.effects, [{ _id: toggleEffect._id }]);
});
