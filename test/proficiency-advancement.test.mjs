// Table-driven tests for the proficiency-clause parser (PRD-effects-gaps.md,
// issues 001-006). Covers both the public entry point
// (guessProficiencyAdvancement, given realistic HTML-ish description text)
// and the pure clause interpreter (parseProficiencyClause, given an
// already-isolated clause) — whichever gives clearer, more direct coverage
// per case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guessProficiencyAdvancement, parseProficiencyClause, parseToolProficiencies } from "../scripts/scraper.mjs";

// Pulls the single Trait advancement's configuration out of
// guessProficiencyAdvancement's { [id]: {...} } return shape, or null when
// nothing was detected.
function traitConfig(descriptionHtml) {
  const result = guessProficiencyAdvancement(descriptionHtml);
  const entries = Object.values(result);
  if (!entries.length) return null;
  assert.equal(entries.length, 1, "expected exactly one Trait advancement");
  assert.equal(entries[0].type, "Trait");
  return entries[0].configuration;
}

function sortPool(choices) {
  return choices.map((c) => ({ count: c.count, pool: [...c.pool].sort() }));
}

// ---- guessProficiencyAdvancement (full description text) -----------------

test("guessProficiencyAdvancement: table-driven cases", async (t) => {
  const cases = [
    // --- Issue 001: skill "or" choice bug -----------------------------
    {
      name: "Order Domain: 'Intimidation or Persuasion' -> choice, not two grants",
      html: "<p>You gain proficiency in Intimidation or Persuasion (your choice).</p>",
      expect: { grants: [], choices: [{ count: 1, pool: ["skills:itm", "skills:per"] }] },
    },
    {
      name: "Changeling Instincts: five-option 'two of the following' -> choice count 2",
      html:
        "<p>You gain proficiency in two of the following skills of your choice: Deception, Insight, Intimidation, Performance, or Persuasion.</p>",
      expect: {
        grants: [],
        choices: [{ count: 2, pool: ["skills:dec", "skills:ins", "skills:itm", "skills:per", "skills:prf"].sort() }],
      },
    },
    {
      name: "regression: 'and'-joined skill list still grants unconditionally",
      html: "<p>You gain proficiency in Survival and Perception.</p>",
      expect: { grants: ["skills:sur", "skills:prc"], choices: [] },
    },

    // --- Issue 002: tool choice count hardcoded -----------------------
    {
      name: "Crafter: 'three different Artisan's Tools of your choice' -> count 3",
      html: "<p>You gain proficiency with three different Artisan's Tools of your choice.</p>",
      expect: { grants: [], choices: [{ count: 3, pool: ["tool:art"] }] },
    },
    {
      name: "Musician: 'three Musical Instruments of your choice' -> count 3",
      html: "<p>You gain proficiency with three Musical Instruments of your choice.</p>",
      expect: { grants: [], choices: [{ count: 3, pool: ["tool:music"] }] },
    },
    {
      name: "regression: no stated number on a tool category still defaults to count 1",
      html: "<p>You gain proficiency with one type of Artisan's Tools of your choice.</p>",
      expect: { grants: [], choices: [{ count: 1, pool: ["tool:art"] }] },
    },

    // --- Issue 003: proficiency wrapper words -------------------------
    {
      name: "Infernal Pact: 'proficiency in the Deception skill'",
      html: "<p>You gain proficiency in the Deception skill.</p>",
      expect: { grants: ["skills:dec"], choices: [] },
    },
    {
      name: "Fey Pact: 'Proficiency in the Nature skill'",
      html: "<p>Proficiency in the Nature skill.</p>",
      expect: { grants: ["skills:nat"], choices: [] },
    },
    {
      name: "Poisoner: 'proficiency with the Poisoner's Kit'",
      html: "<p>You gain proficiency with the Poisoner's Kit.</p>",
      expect: { grants: ["tool:pois"], choices: [] },
    },
    {
      name: "Keen Senses: 'proficiency in the Perception skill'",
      html: "<p>You gain proficiency in the Perception skill.</p>",
      expect: { grants: ["skills:prc"], choices: [] },
    },
    {
      name: "Menacing (synthetic, same confirmed pattern): 'proficiency in the Intimidation skill'",
      html: "<p>You gain proficiency in the Intimidation skill.</p>",
      expect: { grants: ["skills:itm"], choices: [] },
    },
    {
      name: "Natural Athlete (synthetic, same confirmed pattern): 'proficiency in the Athletics skill'",
      html: "<p>You gain proficiency in the Athletics skill.</p>",
      expect: { grants: ["skills:ath"], choices: [] },
    },
    {
      name: "regression: plain grant with no wrapper words still works",
      html: "<p>You gain proficiency in Perception.</p>",
      expect: { grants: ["skills:prc"], choices: [] },
    },

    // --- Issue 004: weapon/armor proficiency vocabulary ---------------
    {
      name: "Martial Weapon Training: 'proficiency with Martial Weapons'",
      html: "<p>You gain proficiency with Martial Weapons.</p>",
      expect: { grants: ["weapon:mar"], choices: [] },
    },
    {
      name: "Heavily Armored: 'gain training with Heavy armor'",
      html: "<p>You gain training with Heavy armor.</p>",
      expect: { grants: ["armor:hvy"], choices: [] },
    },
    {
      name: "Lightly Armored: 'gain training with Light armor and Shields'",
      html: "<p>You gain training with Light armor and Shields.</p>",
      expect: { grants: ["armor:lgt", "armor:shl"], choices: [] },
    },
    {
      name: "Moderately Armored: 'gain training with Medium armor'",
      html: "<p>You gain training with Medium armor.</p>",
      expect: { grants: ["armor:med"], choices: [] },
    },
    {
      name: "Dwarven Armor Training: 'training with light and medium armor'",
      html: "<p>You gain training with light and medium armor.</p>",
      expect: { grants: ["armor:lgt", "armor:med"], choices: [] },
    },
    {
      name: "Rune Knight / Order Domain / Twilight Domain style: 'proficiency with Heavy Armor'",
      html: "<p>Bonus Proficiencies: You gain proficiency with Heavy Armor.</p>",
      expect: { grants: ["armor:hvy"], choices: [] },
    },

    // --- Issue 005: language grant detection --------------------------
    {
      name: "Rune Knight: tool grant AND Giant language grant both present",
      html: "<p>Bonus Proficiencies: You gain proficiency with smith's tools, and you learn to speak, read, and write Giant.</p>",
      expect: { grants: ["tool:smith", "languages:standard:giant"], choices: [] },
    },

    // --- Issue 006: choice-based skill/tool grants (wildcard pools) ---
    {
      name: "Skillful: 'one skill of your choice' -> skills:* wildcard",
      html: "<p>You gain proficiency in one skill of your choice.</p>",
      expect: { grants: [], choices: [{ count: 1, pool: ["skills:*"] }] },
    },
    {
      name: "Skill Versatility: 'two skills of your choice' -> skills:* wildcard, count 2",
      html: "<p>You gain proficiency in two skills of your choice.</p>",
      expect: { grants: [], choices: [{ count: 2, pool: ["skills:*"] }] },
    },
    {
      name: "Skilled: 'any combination of three skills or tools of your choice' -> combined wildcard",
      html: "<p>You gain proficiency in any combination of three skills or tools of your choice.</p>",
      expect: { grants: [], choices: [{ count: 3, pool: ["skills:*", "tool:*"].sort() }] },
    },
    {
      name: "regression: a named-list choice is not wildcarded (doesn't regress issue 001)",
      html: "<p>You gain proficiency in Deception or Insight.</p>",
      expect: { grants: [], choices: [{ count: 1, pool: ["skills:dec", "skills:ins"] }] },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      const config = traitConfig(c.html);
      if (!c.expect.grants.length && !c.expect.choices.length) {
        assert.equal(config, null);
        return;
      }
      assert.ok(config, "expected a Trait advancement to be built");
      assert.deepEqual([...config.grants].sort(), [...c.expect.grants].sort());
      assert.deepEqual(sortPool(config.choices), sortPool(c.expect.choices));
    });
  }
});

// ---- parseProficiencyClause (pre-isolated clause strings) -----------------

test("parseProficiencyClause: direct clause cases", async (t) => {
  const cases = [
    {
      name: "plain tool grant",
      clause: "cook's utensils",
      expect: { grants: ["tool:cook"], choices: [] },
    },
    {
      name: "plain skill grant",
      clause: "Arcana",
      expect: { grants: ["skills:arc"], choices: [] },
    },
    {
      name: "'and'-joined tool list (unaffected by choice logic)",
      clause: "Thieves' Tools, Tinker's Tools, and one type of Artisan's Tools of your choice",
      expect: { grants: ["tool:thief", "tool:tinker"], choices: [{ count: 1, pool: ["tool:art"] }] },
    },
    {
      name: "digit-form count on a tool category ('3' instead of 'three')",
      clause: "3 Musical Instruments of your choice",
      expect: { grants: [], choices: [{ count: 3, pool: ["tool:music"] }] },
    },
    {
      name: "weapon category: Simple and Martial Weapons",
      clause: "Simple and Martial Weapons",
      expect: { grants: ["weapon:sim", "weapon:mar"], choices: [] },
    },
    {
      name: "armor category: Heavy armor and Shields",
      clause: "Heavy armor and Shields",
      expect: { grants: ["armor:hvy", "armor:shl"], choices: [] },
    },
    {
      name: "empty/undefined clause returns empty shape",
      clause: "",
      expect: { grants: [], choices: [] },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      const { grants, choices } = parseProficiencyClause(c.clause);
      assert.deepEqual([...grants].sort(), [...c.expect.grants].sort());
      assert.deepEqual(sortPool(choices), sortPool(c.expect.choices));
    });
  }
});

// ---- parseToolProficiencies: existing buildAdvancement call site --------

test("parseToolProficiencies: buildAdvancement's 'Tool Proficiencies' call site keeps working", () => {
  const { grants, choices } = parseToolProficiencies(
    "Thieves' Tools, Tinker's Tools, and one type of Artisan's Tools of your choice"
  );
  assert.deepEqual([...grants].sort(), ["tool:thief", "tool:tinker"]);
  assert.deepEqual(choices, [{ count: 1, pool: ["tool:art"] }]);
});

test("parseToolProficiencies: quantity fix applies at this call site too (issue 002)", () => {
  const { grants, choices } = parseToolProficiencies("three different Artisan's Tools of your choice");
  assert.deepEqual(grants, []);
  assert.deepEqual(choices, [{ count: 3, pool: ["tool:art"] }]);
});
