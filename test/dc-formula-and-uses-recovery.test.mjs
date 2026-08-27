// Tests for issue 016: DC formula parsing and uses/recovery wiring for
// every Activity type (not just "cast"). parseDcFormula and scanSegmentText
// are pure string-in/data-out functions with no Foundry/DOM dependency, so
// they run under plain `node --test`, same as the issue 007/008 suite.
// buildActivityData is likewise a plain-object builder with no DOM
// dependency, so the effects-builder.mjs half of the fix (generic uses
// wiring across save/damage/heal/cast) is exercised directly against it
// rather than through guessQueueEntries (private, and only reachable via
// buildAutoMechanics's DOMParser-based HTML wrapper, which can't run
// outside a browser).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDcFormula, scanSegmentText } from "../scripts/scraper.mjs";
import { buildActivityData } from "../scripts/effects-builder.mjs";

// ---------------------------------------------------------------------
// parseDcFormula -- literally-named ability + proficiency bonus, real
// phrasing shapes confirmed in FEAT_AUDIT_REPORT.md's stub findings.
// ---------------------------------------------------------------------

test("parseDcFormula resolves a literally-named-ability DC clause", async (t) => {
  const cases = [
    ["ability then proficiency (Boon of Energy Resistance shape)", "DC 8 + your Constitution modifier + your Proficiency Bonus", "8 + @abilities.con.mod + @prof"],
    ["proficiency then ability, reversed order", "DC equal to 8 + your Proficiency Bonus + your Wisdom modifier", "8 + @prof + @abilities.wis.mod"],
    ["'DC of' phrasing", "the target must succeed on a Strength saving throw against a DC of 8 + your Strength modifier + your Proficiency Bonus or be pushed", "8 + @abilities.str.mod + @prof"],
    ["bare number, no 'of'/'equal to'", "DC 15 + your Charisma modifier", "15 + @abilities.cha.mod"],
  ];
  for (const [label, text, expected] of cases) {
    await t.test(label, () => assert.equal(parseDcFormula(text), expected));
  }
});

test("parseDcFormula returns a partial formula when only proficiency bonus is resolvable", () => {
  // "the ability you increased with this feat" (Telekinetic-style self
  // reference) is deliberately NOT resolved -- no stable per-item roll-data
  // key for a player-chosen ability -- but the proficiency term still is.
  const text = "DC 8 + your Proficiency Bonus + the modifier of the ability you increased with this feat";
  assert.equal(parseDcFormula(text), "8 + @prof");
});

test("parseDcFormula returns null when there's no DC anchor at all", () => {
  assert.equal(parseDcFormula("you gain a +2 bonus to damage rolls"), null);
});

test("parseDcFormula dedupes a term mentioned twice", () => {
  assert.equal(parseDcFormula("DC 8 + your Wisdom modifier + your Proficiency Bonus (Wisdom modifier already includes proficiency)"), "8 + @abilities.wis.mod + @prof");
});

// ---------------------------------------------------------------------
// scanSegmentText -- savingThrow.dcFormula wiring, and dcSpellcasting
// continuing to take priority over a literal DC clause when both are
// present in the same segment.
// ---------------------------------------------------------------------

test("scanSegmentText populates savingThrow.dcFormula for a non-spellcasting DC clause", () => {
  const text = "The target must make a Dexterity saving throw against a DC of 8 + your Constitution modifier + your Proficiency Bonus or take 2d12 fire damage.";
  const { savingThrow } = scanSegmentText(text, [], null);
  assert.ok(savingThrow);
  assert.equal(savingThrow.ability, "dex");
  assert.equal(savingThrow.dcSpellcasting, false);
  assert.equal(savingThrow.dcFormula, "8 + @abilities.con.mod + @prof");
});

test("scanSegmentText leaves dcFormula null and dcSpellcasting true for 'spell save DC' phrasing", () => {
  const text = "The target must succeed on a Wisdom saving throw against your spell save DC or be frightened.";
  const { savingThrow } = scanSegmentText(text, [], null);
  assert.ok(savingThrow);
  assert.equal(savingThrow.dcSpellcasting, true);
  assert.equal(savingThrow.dcFormula, null);
});

test("scanSegmentText's dcFormula is null when no DC clause is present at all (regression)", () => {
  const text = "The target must succeed on a Strength saving throw or be knocked prone.";
  const { savingThrow } = scanSegmentText(text, [], null);
  assert.ok(savingThrow);
  assert.equal(savingThrow.dcFormula, null);
});

// ---------------------------------------------------------------------
// scanSegmentText -- bare "once"/"twice" uses-count detection, gated on an
// actual short/long-rest mention (Boon of Fate / Firearm Specialist shape).
// ---------------------------------------------------------------------

test("scanSegmentText recognizes 'once per long rest' as usesFormula '1'", () => {
  const { usesFormula, recoveryPeriod } = scanSegmentText("You can use this feature once, and you regain the use when you finish a long rest.", [], null);
  assert.equal(usesFormula, "1");
  assert.equal(recoveryPeriod, "lr");
});

test("scanSegmentText recognizes 'twice per short rest or long rest' as usesFormula '2' and prefers the short-rest period", () => {
  // Note: "short or long rest" (no repeated "rest") doesn't contain the
  // literal "short rest" bigram the existing srIdx/lrIdx detector matches
  // on -- that's a pre-existing scanner quirk, unrelated to this fix, so
  // this case spells out both rest words fully to exercise the intended
  // short-rest-priority behavior.
  const { usesFormula, recoveryPeriod } = scanSegmentText("You can do this twice, and you regain any expended uses when you finish a short rest or a long rest.", [], null);
  assert.equal(usesFormula, "2");
  assert.equal(recoveryPeriod, "sr");
});

test("scanSegmentText does NOT treat an unrelated 'once' as a uses count (regression, no rest mention)", () => {
  const { usesFormula, recoveryPeriod } = scanSegmentText("Once you reach 5th level, this bonus increases to +2.", [], null);
  assert.equal(usesFormula, null);
  assert.equal(recoveryPeriod, null);
});

test("scanSegmentText's existing 'N times'/ability-modifier uses detection is unaffected (regression)", () => {
  const timesCase = scanSegmentText("You can use this three times, regaining all uses when you finish a long rest.", [], null);
  assert.equal(timesCase.usesFormula, "3");

  const modCase = scanSegmentText("You can use this a number of times equal to your Wisdom modifier, regaining all uses when you finish a long rest.", [], null);
  assert.equal(modCase.usesFormula, "@abilities.wis.mod");
});

// ---------------------------------------------------------------------
// buildActivityData -- generic uses/recovery wiring across every type, not
// just "cast" (the effects-builder.mjs half of issue 016).
// ---------------------------------------------------------------------

test("buildActivityData wires usesMax/recoveryPeriod into a save activity", () => {
  const act = buildActivityData("save", {
    name: "Energy Redirection",
    saveAbility: ["dex"],
    dcMode: "formula",
    dcValue: "8 + @abilities.con.mod + @prof",
    onSave: "none",
    damageParts: [{ formula: "2d12", type: "fire" }],
    usesMax: "1",
    recoveryPeriod: "lr",
  });
  assert.equal(act.save.dc.calculation, "formula");
  assert.equal(act.save.dc.formula, "8 + @abilities.con.mod + @prof");
  assert.equal(act.uses.max, "1");
  assert.deepEqual(act.uses.recovery, [{ period: "lr", type: "recoverAll", formula: "" }]);
});

test("buildActivityData wires usesMax/recoveryPeriod into damage and heal activities", () => {
  const damageAct = buildActivityData("damage", { name: "Charge Damage", damageParts: [{ formula: "1d8", type: "bludgeoning" }], usesMax: "2", recoveryPeriod: "sr" });
  assert.equal(damageAct.uses.max, "2");
  assert.deepEqual(damageAct.uses.recovery, [{ period: "sr", type: "recoverAll", formula: "" }]);

  const healAct = buildActivityData("heal", { name: "Battle Medic", healFormula: "1d8", healType: "healing", usesMax: "", recoveryPeriod: "lr" });
  assert.equal(healAct.uses.max, "");
  assert.deepEqual(healAct.uses.recovery, []);
});

test("buildActivityData leaves uses at the empty default when usesMax isn't given (regression, manual-editor path)", () => {
  const act = buildActivityData("save", { name: "Guarded Mind", saveAbility: ["cha"], dcMode: "flat", dcValue: "", onSave: "none", damageParts: [] });
  assert.equal(act.uses.max, "");
  assert.deepEqual(act.uses.recovery, []);
});

test("buildActivityData's cast branch still wires uses/recovery correctly after the base generalization (regression)", () => {
  const act = buildActivityData("cast", { name: "Detect Thoughts", spellUuid: "Compendium.dnd5e.spells24.Item.abc123", spellName: "Detect Thoughts", usesMax: "1", recoveryPeriod: "lr" });
  assert.equal(act.uses.max, "1");
  assert.deepEqual(act.uses.recovery, [{ period: "lr", type: "recoverAll", formula: "" }]);
  assert.equal(act.spell.uuid, "Compendium.dnd5e.spells24.Item.abc123");
});
