// Ports the standalone scrape-class.mjs (Node + cheerio) scraper to run
// entirely inside Foundry's browser client, using the native DOMParser
// instead of cheerio. Logic is a 1:1 port — see scrape-class.mjs for the
// original commentary on wiki page structure and Foundry schema shapes.

// Defined here (rather than importer.mjs) so this module and effects-builder.mjs
// can both reference it without an import cycle through importer.mjs.
export const MODULE_ID = "dnd-brewporter";

const ABILITY_CODES = {
  strength: "str", dexterity: "dex", constitution: "con",
  intelligence: "int", wisdom: "wis", charisma: "cha",
};

const SKILL_CODES = {
  acrobatics: "acr", "animal handling": "ani", arcana: "arc", athletics: "ath",
  deception: "dec", history: "his", insight: "ins", intimidation: "itm",
  investigation: "inv", medicine: "med", nature: "nat", perception: "prc",
  performance: "prf", persuasion: "per", religion: "rel",
  "sleight of hand": "slt", stealth: "ste", survival: "sur",
};

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// Matches dnd5e's own CONFIG.DND5E.damageTypes keys — kept as a small local
// list here rather than reading CONFIG.DND5E so this stays a pure function
// callable outside a running Foundry client (jsdom tests, etc.).
const DAMAGE_TYPE_WORDS = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

// Matches dnd5e's own CONFIG.DND5E.conditionTypes keys (same rationale as
// DAMAGE_TYPE_WORDS above — a small local list so this stays callable
// outside a running Foundry client). None of these overlap with a damage
// type word (compare "poisoned" here vs. "poison" above), so the condition-
// immunity detector below can't double-fire on a damage-immunity phrase.
export const CONDITION_WORDS = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
  "incapacitated", "invisible", "paralyzed", "petrified", "poisoned",
  "prone", "restrained", "stunned", "unconscious",
];

// Verified against DND5E.tools in the dnd5e system's own module/config.mjs —
// the real trait-key scheme, not guessed.
const TOOL_CODES = {
  "alchemist's supplies": "alchemist", "bagpipes": "bagpipes", "brewer's supplies": "brewer",
  "calligrapher's supplies": "calligrapher", "playing card set": "card", "carpenter's tools": "carpenter",
  "cartographer's tools": "cartographer", "dragonchess set": "chess", "cobbler's tools": "cobbler",
  "cook's utensils": "cook", "dice set": "dice", "disguise kit": "disg", "drum": "drum",
  "dulcimer": "dulcimer", "flute": "flute", "forgery kit": "forg", "glassblower's tools": "glassblower",
  "herbalism kit": "herb", "horn": "horn", "jeweler's tools": "jeweler", "leatherworker's tools": "leatherworker",
  "lute": "lute", "lyre": "lyre", "mason's tools": "mason", "navigator's tools": "navg",
  "painter's supplies": "painter", "panflute": "panflute", "poisoner's kit": "pois",
  "potter's tools": "potter", "shawm": "shawm", "smith's tools": "smith", "thieves' tools": "thief",
  "tinker's tools": "tinker", "viol": "viol", "weaver's tools": "weaver", "woodcarver's tools": "woodcarver",
};
const TOOL_CATEGORY_WORDS = [
  [/artisan'?s? tools/i, "art"],
  [/gaming set/i, "game"],
  [/musical instrument/i, "music"],
  [/vehicles?/i, "vehicle"],
];

// Matches dnd5e's own CONFIG.DND5E.languages standard/exotic children keys
// (module/config.mjs) — same "small local list" rationale as DAMAGE_TYPE_WORDS
// above. Only covers the language names that actually show up in real
// "speak, read, and write X" grant text; not exhaustive of every exotic/
// primordial dialect since those never appear in that boilerplate.
const LANGUAGE_CODES = {
  common: "languages:standard:common", draconic: "languages:standard:draconic",
  dwarvish: "languages:standard:dwarvish", elvish: "languages:standard:elvish",
  giant: "languages:standard:giant", gnomish: "languages:standard:gnomish",
  goblin: "languages:standard:goblin", halfling: "languages:standard:halfling",
  orc: "languages:standard:orc", abyssal: "languages:exotic:abyssal",
  celestial: "languages:exotic:celestial", "deep speech": "languages:exotic:deep",
  druidic: "languages:exotic:druidic", infernal: "languages:exotic:infernal",
  primordial: "languages:exotic:primordial", sylvan: "languages:exotic:sylvan",
  undercommon: "languages:exotic:undercommon", "thieves' cant": "languages:exotic:cant",
};

// Classes where the generic full/half/third/pact heuristic can't tell the
// difference: 2024-rules Artificer reaches the same max spell level (5th)
// and starts at the same class level (1) as a true half-caster now that
// 2024 Paladin also starts at level 1 — verified against both tables
// directly. Foundry's dnd5e system still has a distinct "artificer"
// progression key (module/config.mjs), so this is a deliberate name-based
// exception, not a new generic rule.
const PROGRESSION_OVERRIDES = { artificer: "artificer" };

// Unlike scrapeClass's own progression heuristic (a class page always
// carries its own spell-slot table to read maxSpellSlotLevel/hasPactColumn
// off of), assembleSubclassItem has no equivalent table to parse — a
// wikidot subclass page's own spellcasting feature is prose ("you learn
// spells as shown in the Eldritch Knight Spellcasting table below"), not a
// structured table this scraper captures (parseSubclassContent only pulls
// out named *spell grants* and generic scale columns, not a slots-per-level
// table). Rather than build table-detection for a case this narrow, this
// hardcodes the only two subclasses in either ruleset that grant their own
// spellcasting independent of their (non-caster) base class — Eldritch
// Knight (Fighter) and Arcane Trickster (Rogue), both third-caster
// progression on Intelligence in both 2014 and 2024 rules. Keyed by
// deriveSubclassIdentifier's own output so it lines up with `identifier`
// below without a second name-matching scheme.
const SUBCLASS_SPELLCASTING_OVERRIDES = {
  "eldritch-knight": { progression: "third", ability: "int" },
  "arcane-trickster": { progression: "third", ability: "int" },
};

const SPELL_COL = /^(1st|2nd|3rd|4th|5th|6th|7th|8th|9th)$/i;
const PACT_SLOT_COL = /^(Spell Slots|Slot Level)$/i;
const LEVEL_HEADING = /^Level\s+(\d+):\s*(.+)$/i;
const SPELL_TABLE_HEADER = /Spells?$/i;

export function randomId(len = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Strips the "FIXME: " / "FIXME spell: " prefix a not-yet-resolved slot
// carries and any trailing parenthetical qualifier the wiki adds but the
// compendium name doesn't (e.g. "Indomitable (One Use)" -> "Indomitable").
// Shared by importer.mjs's name-lookup and effects-builder.mjs's "copy from
// compendium" search so both match compendium names the same way.
export function normalizeName(name) {
  return String(name)
    .replace(/^FIXME(\s+spell)?:\s*/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Every name-index entry (built by importer.mjs's buildNameIndex) carries a
// `tier` — 1 for a pack whose name ends in "24" (2024 ruleset), 2 for
// everything else (legacy/2014 SRD packs, or any third-party compendium).
// When a name exists under both tiers (the common "this spell got reprinted
// in 2024" case — Misty Step, Sleep, etc.), the user's "rulesetPreference"
// setting picks one automatically instead of prompting every time. Only
// collapses when the preferred tier actually has a candidate; otherwise
// falls back to whatever exists so an unrelated multi-match (e.g. two
// different homebrew packs with the same name) is untouched and still
// surfaces as a real ambiguous choice.
export function applyRulesetPreference(candidates, preference) {
  if (preference === "5e") {
    const legacy = candidates.filter((c) => c.tier !== 1);
    return legacy.length ? legacy : candidates;
  }
  if (preference === "ask") return candidates;
  // Default ("2024" or unrecognized): 2024-tier packs win when present —
  // matches this module's original (pre-setting) hardcoded behavior.
  const tier2024 = candidates.filter((c) => c.tier === 1);
  return tier2024.length ? tier2024 : candidates;
}

// Substring search over a name index (as built by importer.mjs's
// buildNameIndex) — used by the "no match found" rows in the problem-imports
// dialog and by effects-builder.mjs's "copy from compendium"/"cast a spell"
// pickers. `preference` (see applyRulesetPreference) collapses a name that
// exists in both the 2024 and legacy compendiums down to one result instead
// of listing both for the user to tell apart every single search.
export function searchIndex(index, rawQuery, limit = 15, preference = "2024") {
  const q = normalizeName(rawQuery);
  if (!q) return [];
  const results = [];
  for (const [key, candidates] of index.entries()) {
    if (key.includes(q)) results.push(...applyRulesetPreference(candidates, preference));
  }
  results.sort((a, b) => {
    const an = normalizeName(a.name), bn = normalizeName(b.name);
    const aPrefix = an.startsWith(q) ? 0 : 1;
    const bPrefix = bn.startsWith(q) ? 0 : 1;
    return aPrefix !== bPrefix ? aPrefix - bPrefix : an.localeCompare(bn);
  });
  return results.slice(0, limit);
}

// If a block-level element's very first meaningful content is a bold tag
// (wikidot's convention for a named sub-option inside one feature, e.g.
// "<strong>Refreshing Step.</strong> Immediately after you teleport...") this
// returns that label ("Refreshing Step") so guessFeatureMechanics() can keep
// it attached to whatever mechanics are found in that same block, rather than
// flattening every sub-option's text together and losing which name went
// with which effect. Returns null when the block doesn't open with a bold
// tag (real text comes first, or there's no bold tag at all).
function leadingBoldLabel(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { // Text node — ignore pure whitespace, bail on real text
      if (node.textContent.trim() === "") continue;
      return null;
    }
    if (node.nodeType === 1) { // Element node
      if (!/^(strong|b)$/i.test(node.tagName)) return null;
      const label = node.textContent.trim().replace(/\.\s*$/, "");
      return label || null;
    }
  }
  return null;
}

// Runs every keyword/regex detector against one block/segment's own text —
// shared by every segment in guessFeatureMechanics() below so a sub-option's
// mechanics (e.g. Refreshing Step's 1d10 Temp HP) are only ever attributed to
// that segment, not smeared across the whole feature's text.
function scanSegmentText(text, spellNames, index) {
  if (!spellNames.length && index) {
    const castRe = /\bcasts?(?:ing)?\s+(?:the\s+)?((?:[A-Z][a-zA-Z']*\s*){1,4})(?:spell)?/g;
    let cm;
    while ((cm = castRe.exec(text))) {
      const candidate = cm[1].trim();
      if (candidate && index.has(normalizeName(candidate)) && !spellNames.some((n) => normalizeName(n) === normalizeName(candidate))) {
        spellNames.push(candidate);
      }
    }
  }

  let usesFormula = null;
  const modMatch = text.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+modifier\b/i);
  if (modMatch) {
    usesFormula = `@abilities.${abilityCode(modMatch[1])}.mod`;
  } else {
    const numRe = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\s+times?\\b`, "i");
    const numMatch = text.match(numRe);
    if (numMatch) usesFormula = String(NUMBER_WORDS[numMatch[1].toLowerCase()]);
  }

  const srIdx = text.search(/\bshort rest\b/i);
  const lrIdx = text.search(/\blong rest\b/i);
  let recoveryPeriod = null;
  if (srIdx !== -1 && (lrIdx === -1 || srIdx < lrIdx)) recoveryPeriod = "sr";
  else if (lrIdx !== -1) recoveryPeriod = "lr";

  let savingThrow = null;
  const saveMatch = text.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw\b/i);
  if (saveMatch) {
    savingThrow = {
      ability: abilityCode(saveMatch[1]),
      dcSpellcasting: /spell save DC/i.test(text),
      onSaveHalf: /half\s*(?:as much|the)?\s*damage/i.test(text),
    };
  }

  const diceHints = [];
  const diceRe = /(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([A-Za-z][A-Za-z ]{0,25}?)(?=[.,;]|\s+(?:and|or)\b|$)/gi;
  let dm;
  while ((dm = diceRe.exec(text))) {
    const formula = dm[1].replace(/\s+/g, "");
    const context = dm[2].trim().toLowerCase();
    if (/temporary hit points|temp hp/.test(context)) diceHints.push({ formula, kind: "heal", type: "temphp" });
    else if (/\bhit points\b|healing/.test(context)) diceHints.push({ formula, kind: "heal", type: "healing" });
    else diceHints.push({ formula, kind: "damage", type: DAMAGE_TYPE_WORDS.find((t) => context.includes(t)) ?? "" });
  }

  // Flat "(twice/half) your proficiency bonus" language — the same
  // heal/damage/temp-hp classification as the dice-based hints above, but
  // for a feature whose healing/damage scales with proficiency bonus alone
  // (no dice notation anywhere in the clause), e.g. the 2024 Chef feat's
  // "regain hit points equal to twice your proficiency bonus", which the
  // dice-only diceRe above can't see at all. Unlike the dice case (where
  // the unit word follows the number), the classifying word here normally
  // comes BEFORE "proficiency bonus" ("regain hit points equal to...",
  // "extra damage equals..."), so the context window looks backward.
  const profRe = /\b(twice|double|half|three times|triple)?\s*(?:your\s+)?proficiency bonus\b/gi;
  let pm;
  while ((pm = profRe.exec(text))) {
    const context = text.slice(Math.max(0, pm.index - 60), pm.index).toLowerCase();
    const multiplier = { twice: " * 2", double: " * 2", half: " / 2", "three times": " * 3", triple: " * 3" }[pm[1]?.toLowerCase()] ?? "";
    const formula = `@prof${multiplier}`;
    if (/temporary hit points|temp hp/.test(context)) diceHints.push({ formula, kind: "heal", type: "temphp" });
    else if (/\bhit points\b|healing\b/.test(context)) diceHints.push({ formula, kind: "heal", type: "healing" });
    else if (/\bdamage\b/.test(context)) diceHints.push({ formula, kind: "damage", type: DAMAGE_TYPE_WORDS.find((t) => context.includes(t)) ?? "" });
  }

  // ActiveEffect-shaped language — each hint is already a plain {key, mode,
  // value} triple in Foundry's own AE change shape (same as what the manual
  // Effect editor builds), so effects-builder.mjs can feed these straight
  // into buildActiveEffectData() with no translation step. Deliberately
  // narrow/conservative patterns (a handful of the most common D&D feature
  // shapes), same philosophy as diceHints/savingThrow above — a starting
  // point for review, not a final answer.
  const effectHints = [];

  const acMatch = text.match(/\+(\d+)(?:\s+bonus)?\s+to\s+(?:your\s+)?(?:armor class|AC)\b/i)
    ?? text.match(/(?:armor class|AC)\s+increases?\s+by\s+(\d+)/i);
  if (acMatch) effectHints.push({ key: "system.attributes.ac.bonus", mode: 2, value: acMatch[1] });

  // Captures a whole run of comma/"and"-joined words between "to" and
  // "damage" (e.g. "Bludgeoning, Piercing, and Slashing damage"), not just a
  // single type — connector words like "and" fall out naturally since
  // they're not in DAMAGE_TYPE_WORDS.
  const traitRe = /\b(resistance|resistant|immunity|immune|vulnerability|vulnerable)\s+to\s+((?:(?!damage\b)[a-z]+[,\s]+)*(?!damage\b)[a-z]+)\s+damage\b/gi;
  let trm;
  while ((trm = traitRe.exec(text))) {
    const kind = trm[1].toLowerCase();
    const key = /^resist/.test(kind) ? "system.traits.dr.value" : /^immun/.test(kind) ? "system.traits.di.value" : "system.traits.dv.value";
    for (const dtype of trm[2].toLowerCase().split(/[,\s]+/).filter(Boolean)) {
      if (DAMAGE_TYPE_WORDS.includes(dtype)) effectHints.push({ key, mode: 2, value: dtype });
    }
  }

  // Condition immunity — two independent patterns rather than one combined
  // regex, since a single "immune"/"immunity" often covers a list shared
  // with an unrelated damage-immunity clause (e.g. dnd5e's own canonical
  // "immune to poison damage and the Poisoned condition" phrasing — one
  // "immune", two different targets). Requiring adjacency to "immune" would
  // only ever catch the first item in a list like that.
  //
  // 2024 phrasing ("the <Condition> condition"): scanned whenever the
  // segment mentions immune/immunity anywhere, not just directly before —
  // trades a little precision (a "<condition> condition" mention far from
  // any immunity language in the same segment would also match) for
  // correctly handling shared-immune lists, consistent with this scanner's
  // "starting point for review" philosophy elsewhere.
  if (/\bimmun(?:e|ity)\b/i.test(text)) {
    const conditionSuffixRe = /\b([a-z]+)\s+condition\b/gi;
    let csm;
    while ((csm = conditionSuffixRe.exec(text))) {
      const condition = csm[1].toLowerCase();
      if (CONDITION_WORDS.includes(condition)) effectHints.push({ key: "system.traits.ci.value", mode: 2, value: condition });
    }
  }

  // 2014 phrasing ("immune to being Charmed") has no "condition" keyword to
  // anchor on, so this one does require direct adjacency to "immune".
  const immuneBeingRe = /\bimmune\s+to\s+being\s+([a-z]+)\b/gi;
  let ibm;
  while ((ibm = immuneBeingRe.exec(text))) {
    const condition = ibm[1].toLowerCase();
    if (CONDITION_WORDS.includes(condition)) effectHints.push({ key: "system.traits.ci.value", mode: 2, value: condition });
  }

  // Self-granted condition ("You have the Invisible condition until...",
  // e.g. Archfey Patron's Disappearing Step) — distinct from the immunity
  // phrasing above (that's a defensive trait; this is the feature actively
  // applying a status to its own user) and represented completely
  // differently in Foundry: a status slug on the ActiveEffect's own
  // `statuses` array, not a `system.traits.*` change, so it's collected
  // separately from effectHints/changes and doesn't need the immune guard.
  // Skipped when the segment already reads as immunity language so a single
  // "the Invisible condition" mention isn't double-counted as both.
  //
  // Scanned sentence-by-sentence (rather than over the whole segment) so
  // the two guards below only ever look at the clause BEFORE one candidate
  // match, not anything later in the same sentence — confirmed necessary
  // against real D&D Beyond race trait text: Draconic Flight's own wings
  // last "...until you retract the wings...or have the Incapacitated
  // condition" (a duration-list terminator for an unrelated Fly Speed
  // grant, not a status this trait gives its own possessor) and Celestial
  // Revelation's Necrotic Shroud option reads "...must succeed on
  // a...saving throw...or have the Frightened condition" (a save-or-suffer
  // clause aimed at *other* creatures, not the trait holder) — both would
  // otherwise have built a `transfer: true` effect that permanently slaps
  // that status on whoever holds the trait. Checking only the text BEFORE
  // the match (not the whole sentence) matters: Disappearing Step's own
  // legitimate self-grant — "You have the Invisible condition until the
  // start of your next turn or until you attack...or force a creature to
  // make a saving throw" — mentions "saving throw" too, just later, after
  // ending an unrelated clause about when the invisibility itself ends.
  const statusHints = [];
  if (!/\bimmun(?:e|ity)\b/i.test(text)) {
    const sentences = text.match(/[^.]+\.?/g) ?? [text];
    const grantRe = /\b(?:have|has|gain|gains|gaining|are|become|becomes)\s+(?:the\s+)?([a-z]+)\s+condition\b/gi;
    for (const sentence of sentences) {
      grantRe.lastIndex = 0;
      let gsm;
      while ((gsm = grantRe.exec(sentence))) {
        const before = sentence.slice(0, gsm.index).replace(/\([^)]*\)/g, "");
        // A save-or-suffer clause immediately before this mention almost
        // always targets someone else the feature affects, not its own
        // possessor.
        if (/\bsaving throw\b|\bspell save DC\b/i.test(before)) continue;
        // An earlier "until" feeding into this same "or" reads as one more
        // entry in a list of ways an unrelated effect ENDS ("lasts...until
        // X...or have the Y condition"), not a status being granted.
        if (/\buntil\b/i.test(before) && /\bor\s*$/i.test(before)) continue;
        const condition = gsm[1].toLowerCase();
        if (CONDITION_WORDS.includes(condition) && !statusHints.includes(condition)) statusHints.push(condition);
      }
    }
  }

  const speedMatch = text.match(/\b(walking|climbing|swimming|flying|burrowing)?\s*speed\s+increases?\s+by\s+(\d+)\s*feet/i);
  if (speedMatch) {
    const movementKey = { walking: "walk", climbing: "climb", swimming: "swim", flying: "fly", burrowing: "burrow" }[(speedMatch[1] ?? "walking").toLowerCase()] ?? "walk";
    effectHints.push({ key: `system.attributes.movement.${movementKey}`, mode: 2, value: speedMatch[2] });
  }

  // Two independent phrasings both grant darkvision in real D&D Beyond
  // text: the short form ("You have Darkvision with a range of 60 feet.")
  // and the 2024 PHB's own standardized boilerplate ("You can see in dim
  // light within 60 feet of you as if it were bright light, and in
  // darkness as if it were dim light...", verified identical word-for-word
  // across multiple real species traits) — the latter never mentions the
  // word "darkvision" anywhere near the actual number, so the short-form
  // regex alone can't catch it; trusted the same way the 2024 Ability
  // Score Increase boilerplate already is (see guessAbilityScoreImprovement)
  // since it's fixed, real official wording, not a loose guess.
  const darkvisionMatch = text.match(/darkvision(?:\s+(?:out to|with|to|of)\s+(?:a range of\s+)?)?\s*(\d+)\s*feet/i)
    ?? text.match(/\bsee in dim light within\s+(\d+)\s*feet\s+of you as if it were bright light/i);
  if (darkvisionMatch) effectHints.push({ key: "system.attributes.senses.darkvision", mode: 4, value: darkvisionMatch[1] });

  // Blindsight/Truesight — same verified-safe "system.attributes.senses.*"
  // shape as darkvision above (confirmed against real dnd5e-shipped items:
  // Devil's Sight/Witch Sight/Boon of Truesight all upgrade darkvision or
  // truesight; Feral Senses adds blindsight — matched here by using "add"
  // for blindsight and "upgrade" for truesight, same split). Only for a
  // permanent, passive grant, though: a sense granted "as a Bonus Action"
  // for a fixed duration (Stonecunning's own Tremorsense — confirmed
  // transfer:false with a real 10-minute duration on the real shipped
  // item, nothing like a permanent trait) is a completely different shape
  // this scanner can't safely build — a blanket permanent effect here
  // would repeat Draconic Flight's mistake, so nearby activation/duration
  // language suppresses the match instead of guessing wrong.
  for (const [sense, mode] of [["blindsight", 2], ["truesight", 4]]) {
    const senseMatch = text.match(new RegExp(`\\b${sense}(?:\\s+(?:out to|with|to|of)\\s+(?:a range of\\s+)?)?\\s*(\\d+)\\s*feet`, "i"));
    if (!senseMatch) continue;
    const window = 80;
    const around = text.slice(Math.max(0, senseMatch.index - window), senseMatch.index + senseMatch[0].length + window);
    if (/\bbonus action\b|\bas an action\b|\bfor\s+\d+\s*(?:minutes?|hours?|rounds?)\b/i.test(around)) continue;
    effectHints.push({ key: `system.attributes.senses.${sense}`, mode, value: senseMatch[1] });
  }

  // Multiple detectors above can independently land on the same
  // key+value (e.g. both condition-immunity patterns matching the same
  // condition once each) — dedupe so the guessed effect doesn't carry a
  // redundant duplicate change.
  const seenHints = new Set();
  const dedupedEffectHints = effectHints.filter((h) => {
    const dedupeKey = `${h.key} ${h.value}`;
    if (seenHints.has(dedupeKey)) return false;
    seenHints.add(dedupeKey);
    return true;
  });

  return { usesFormula, recoveryPeriod, savingThrow, diceHints, effectHints: dedupedEffectHints, statusHints };
}

// Best-guess mechanics scanner for a scraped feature's prose (used by the
// "Create new Feature item" flow's Build Feature dialog to pre-seed the
// effects/activities queue instead of starting from a blank slate). Nothing
// here is trusted blindly — every guess becomes a normal, fully-editable
// queue row the user can tweak or delete before the item is created.
//
// The prose is split into segments at each block-level element (<p>, ...):
// a block that opens with a bold label (wikidot's own convention for a named
// sub-option, e.g. "Refreshing Step"/"Taunting Step" under Steps of the Fey)
// starts a new segment carrying that label; anything else is appended to the
// current (possibly unlabeled) segment. Each segment is scanned independently
// so a sub-option's own mechanics stay attached to its own name instead of
// all bleeding together into one flattened, unattributed blob.
//
// Two spell-name signal sources per segment, in priority order:
//  1. Structural: a wikidot spell reference is a real <a href="/spell:...">
//     link in the scraped descriptionHtml (parseSubclassContent keeps each
//     feature's block outerHTML, links included) — an unambiguous, high-
//     confidence signal, unlike keyword-guessing prose.
//  2. Textual fallback (mainly for freeform/Google-Docs sources, which have
//     no such links): a light "cast [the] <Name> [spell]" pattern checked
//     against the actual compendium index, so it only fires on names that
//     really exist rather than any Title Case phrase.
// Everything else (ability-modifier uses formula, rest-recovery period,
// saving-throw ability + spell-DC, damage/healing dice, ActiveEffect-shaped
// language — AC bonuses, damage resistance/immunity/vulnerability, condition
// immunity, self-granted conditions e.g. "You have the Invisible condition",
// speed increases, darkvision) is plain keyword/regex scanning —
// deliberately simple and conservative (e.g. only classifies a damage type
// when a known damage-type word appears right next to the dice) since these
// are meant as a starting point for review, not a final answer.
export function guessFeatureMechanics(descriptionHtml, index = null) {
  const doc = new DOMParser().parseFromString(descriptionHtml || "", "text/html");
  const blocks = Array.from(doc.body?.children ?? []);

  const rawSegments = []; // [{ label, els: [...] }]
  let current = { label: null, els: [] };
  for (const el of blocks) {
    const label = leadingBoldLabel(el);
    if (label) {
      if (current.els.length) rawSegments.push(current);
      current = { label, els: [el] };
    } else {
      current.els.push(el);
    }
  }
  if (current.els.length) rawSegments.push(current);
  if (!rawSegments.length) rawSegments.push({ label: null, els: [] });

  const segments = rawSegments.map(({ label, els }) => {
    const spellNames = [];
    const addSpellName = (name) => {
      const trimmed = name?.trim();
      if (trimmed && !spellNames.some((n) => normalizeName(n) === normalizeName(trimmed))) spellNames.push(trimmed);
    };
    for (const el of els) el.querySelectorAll("a[href*='spell:'], a[href*='/spell/']").forEach((a) => addSpellName(a.textContent));

    const text = els.map((el) => el.textContent).join(" ").replace(/\s+/g, " ").trim();
    const scanned = scanSegmentText(text, spellNames, index);
    return { label, spellNames, ...scanned };
  });

  return { segments };
}

// 2024 rules standardized "Ability Score Increase" onto three fixed
// boilerplate phrasings across every half-feat, the flat "Ability Score
// Improvement" feat, and every Epic Boon — verified against dnd5e's own
// shipped feats24 pack (e.g. Grappler: "Increase your Strength or Dexterity
// score by 1, to a maximum of 20."; the ASI feat itself: "Increase one
// ability score of your choice by 2, or increase two ability scores of your
// choice by 1."; Boon of Combat Prowess: "Increase one ability score of
// your choice by 1, to a maximum of 30."). Real official text, not scraped
// prose guesswork, so unlike guessFeatureMechanics' effect/activity
// detectors this is trusted enough to build an advancement entry directly
// rather than just a review hint. Returns null when the description
// doesn't contain this exact family of phrasing — never a guessed partial
// match — since a wrong ASI advancement (wrong abilities locked, wrong
// point cap) is worse than a feat that simply has none built yet.
function guessAbilityScoreImprovement(descriptionHtml) {
  if (!descriptionHtml) return null;
  const text = descriptionHtml.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ");
  const sentence = text.match(/Increase\s+(?:your|one ability score of your choice|two ability scores of your choice)[^.]*\./i)?.[0];
  if (!sentence) return null;

  const maxMatch = sentence.match(/maximum of (\d+)/i);
  const max = maxMatch ? Number(maxMatch[1]) : null;
  const asiConfig = (points, cap, locked) => ({
    cap, points, locked, max,
    fixed: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  });

  // "Increase one ability score of your choice by 2, or increase two
  // ability scores of your choice by 1." — dnd5e's own AbilityScoreImprovement
  // advancement already represents "one by 2, or two by 1" as a single
  // 2-point pool capped at 2 per ability, so this maps directly with
  // nothing locked out.
  if (/two ability scores of your choice by 1\b/i.test(sentence)) return asiConfig(2, 2, []);

  const namedAbilities = [...new Set([...sentence.matchAll(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/gi)].map((m) => abilityCode(m[1])))];
  const amount = Number(sentence.match(/\bby\s+(\d+)\b/i)?.[1] ?? 1);

  if (namedAbilities.length) {
    const locked = Object.values(ABILITY_CODES).filter((c) => !namedAbilities.includes(c));
    return asiConfig(amount, amount, locked);
  }
  if (/one ability score of your choice/i.test(sentence)) return asiConfig(amount, amount, []);
  return null;
}

// Wraps guessAbilityScoreImprovement's raw configuration in the same
// {_id, type, configuration, value, level, title, hint} advancement-entry
// shape used everywhere else in this module (see buildAdvancement,
// ddb-scraper.mjs's buildRaceAdvancement) — level 0 since a feat's own ASI
// applies the moment it's taken, matching dnd5e's own shipped feats24 items.
export function guessAbilityScoreAdvancement(descriptionHtml) {
  const configuration = guessAbilityScoreImprovement(descriptionHtml);
  if (!configuration) return null;
  const id = randomId();
  return { [id]: { _id: id, type: "AbilityScoreImprovement", configuration, value: {}, level: 0, title: "", hint: "" } };
}

// "You gain proficiency with cook's utensils" (the 2024 Chef feat, among
// many others) is common enough boilerplate to reuse the exact same
// tool-name/category parsing a class's own "Tool Proficiencies" table row
// already goes through (parseProficiencyClause/parseToolProficiencies),
// plus weapon/armor/skill/language vocabulary for the many other shapes a
// feat/trait/species uses instead of a table. Unlike guessFeatureMechanics'
// effect/activity detectors (queued for review — a wrong Effect could
// misinform play), a Trait advancement is purely additive: the worst case
// is nothing gets detected, never a wrong grant silently applied, so this
// is trusted at the same level guessAbilityScoreAdvancement already is —
// built directly from real feat/trait text, not queued. Kept independent
// of guessFeatureMechanics' segment-based scan (used by the interactive
// Build Feature dialog too) so a feat/trait imported straight from D&D
// Beyond gets this without entangling it in that dialog's own
// effect/activity queue UI.
//
// This function only finds proficiency/training/language-grant *clauses* in
// the prose; parseProficiencyClause (below) owns interpreting what's inside
// one already-isolated clause.
export function guessProficiencyAdvancement(descriptionHtml) {
  if (!descriptionHtml) return {};
  const text = descriptionHtml.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ");

  const grants = [];
  const choices = [];
  // Stops at a trailing conditional clause, not just sentence end — real
  // D&D Beyond text (e.g. Chef's own "proficiency with cook's utensils IF
  // YOU DON'T ALREADY HAVE IT") tacks one on often enough that capturing
  // straight to the period would feed parseProficiencyClause a string that
  // never exact-matches any known tool/skill name. Also triggers on "gain
  // training with X" — the real 2024 phrasing armor grants (Heavily
  // Armored, Moderately Armored, etc.) use instead of the word
  // "proficiency".
  const clauseRe = /\b(?:proficiency\s+(?:with|in)|gains?\s+training\s+with)\s+([^.;]+?)(?=[.;]|\s+if\b|\s+when\b|\s+unless\b|\s+provided\b|$)/gi;
  let cm;
  while ((cm = clauseRe.exec(text))) {
    const { grants: clauseGrants, choices: clauseChoices } = parseProficiencyClause(cm[1]);
    grants.push(...clauseGrants);
    choices.push(...clauseChoices);
  }

  // The 2024 PHB's "you learn to speak, read, and write X" language-grant
  // boilerplate (e.g. Rune Knight's Bonus Proficiencies) never contains the
  // word "proficiency" or "training" above, so it's structurally invisible
  // to clauseRe — it needs its own independent clause-finder feeding into
  // the same grants list.
  const languageRe = /\bspeak,?\s*read,?\s*(?:and|&)\s*write\s+([^.;]+?)(?=[.;]|\s+if\b|\s+when\b|\s+unless\b|\s+provided\b|$)/gi;
  let lm;
  while ((lm = languageRe.exec(text))) grants.push(...parseLanguageGrants(lm[1]));

  const uniqueGrants = [...new Set(grants)];
  if (!uniqueGrants.length && !choices.length) return {};

  const id = randomId();
  return {
    [id]: {
      _id: id, type: "Trait",
      configuration: { mode: "default", allowReplacements: false, grants: uniqueGrants, choices },
      value: { chosen: [] }, level: 0, title: "", hint: "", flags: {},
    },
  };
}

function abilityCode(name) {
  return ABILITY_CODES[name.trim().toLowerCase()] ?? null;
}

// Strips a leading "the" and a trailing "skill(s)" before the exact-match
// lookup — real D&D Beyond phrasing like "proficiency in the Deception
// skill" would otherwise never match SKILL_CODES' bare "deception" key.
function skillCode(name) {
  const cleaned = name.trim().replace(/^the\s+/i, "").replace(/\s+skills?$/i, "").replace(/\.$/, "").toLowerCase();
  return SKILL_CODES[cleaned] ?? null;
}

function normalizeApostrophes(s) {
  return s.replace(/[‘’]/g, "'");
}

// Strips a leading "the" before the exact-match lookup — real D&D Beyond
// phrasing like "proficiency with the Poisoner's Kit" would otherwise never
// match TOOL_CODES' bare "poisoner's kit" key.
function toolCode(name) {
  const key = normalizeApostrophes(name.trim()).replace(/^the\s+/i, "").replace(/\.$/, "").toLowerCase();
  return TOOL_CODES[key] ?? null;
}

function languageCode(name) {
  const key = normalizeApostrophes(name.trim()).replace(/^the\s+/i, "").replace(/\.$/, "").toLowerCase();
  return LANGUAGE_CODES[key] ?? null;
}

// Reads a leading number word ("three") or digit ("3") off the front of a
// string, e.g. for "three different Artisan's Tools of your choice" or
// "2 skills of your choice" — returns null (not 1) when nothing numeric
// leads the string, so callers can tell "no stated count" apart from an
// explicit "one"/"1" and choose their own default.
function parseCountWord(token) {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return NUMBER_WORDS[t] ?? null;
}

// e.g. "Giant" or "Giant and Draconic" -> ["languages:standard:giant", ...]
function parseLanguageGrants(namesText) {
  const grants = [];
  if (!namesText) return grants;
  const pieces = normalizeApostrophes(namesText)
    .split(/,\s*|\s+and\s+|\s+or\s+/i)
    .map((s) => s.replace(/^(?:and|or)\s+/i, "").trim())
    .filter(Boolean);
  for (const piece of pieces) {
    const code = languageCode(piece);
    if (code) grants.push(code);
  }
  return grants;
}

// e.g. "Thieves' Tools, Tinker's Tools, and one type of Artisan's Tools of
// your choice" -> grants: ["tool:thief","tool:tinker"], choices: [{count:1,pool:["tool:art"]}]
// A leading number word/digit on a tool-category segment ("three different
// Artisan's Tools of your choice") sets that choice's count instead of the
// count always defaulting to 1 (Crafter, Musician).
//
// Kept as its own function (rather than folded entirely into
// parseProficiencyClause) since buildAdvancement's "Tool Proficiencies"
// class-table row also calls this directly with a plain tool list and no
// skill/weapon/armor/language vocabulary to consider.
export function parseToolProficiencies(toolsText) {
  const grants = [];
  const choices = [];
  if (!toolsText) return { grants, choices };

  const segments = normalizeApostrophes(toolsText)
    .split(/,\s*|\s+and\s+/i)
    .map((s) => s.replace(/^and\s+/i, "").trim())
    .filter(Boolean);

  for (const seg of segments) {
    const category = TOOL_CATEGORY_WORDS.find(([re]) => re.test(seg));
    if (category) {
      const leadWord = seg.match(/^(\d+|[a-z]+)\b/i);
      const count = leadWord ? parseCountWord(leadWord[1]) : null;
      choices.push({ count: count ?? 1, pool: [`tool:${category[1]}`] });
      continue;
    }
    const code = toolCode(seg);
    if (code) grants.push(`tool:${code}`);
  }

  return { grants, choices };
}

// Interprets one already-isolated proficiency/training clause (the text
// after "proficiency with/in" or "gain training with", with no surrounding
// sentence) and returns the Trait advancement grants/choices it describes.
// Covers, in order:
//   1. Weapon categories (weapon:sim/mar) and armor categories
//      (armor:lgt/med/hvy/shl) — ported from buildAdvancement's own
//      Weapon Proficiencies/Armor Training table-row logic so the
//      prose-based detector uses the exact same vocabulary.
//   2. Open/unnamed "N skill(s) of your choice" and "any combination of N
//      skills or tools of your choice" — wildcard pools (skills:*, tool:*),
//      matching the real shape dnd5e's own Human "Skillful" trait uses.
//   3. Tool names/categories (delegated to parseToolProficiencies).
//   4. Skill names, with "X or Y" producing a choose-N choice (default
//      count 1, or the clause's stated count e.g. "two of the following")
//      and "X and Y" producing unconditional grants — plus the same
//      leading-"the"/trailing-"skill(s)" wrapper stripping as skillCode.
export function parseProficiencyClause(clauseRaw) {
  const grants = [];
  const choices = [];
  if (!clauseRaw) return { grants, choices };
  const clause = normalizeApostrophes(clauseRaw).trim();

  // --- Weapon / armor category vocabulary (ported from buildAdvancement) --
  if (/\bweapons?\b/i.test(clause) && (/\bsimple\b/i.test(clause) || /\bmartial\b/i.test(clause))) {
    const weaponGrants = [];
    if (/\bsimple\b/i.test(clause)) weaponGrants.push("weapon:sim");
    if (/\bmartial\b/i.test(clause)) weaponGrants.push("weapon:mar");
    return { grants: weaponGrants, choices: [] };
  }
  if (/\barmor\b/i.test(clause) || /\bshields?\b/i.test(clause)) {
    const armorGrants = [];
    if (/\blight\b/i.test(clause)) armorGrants.push("armor:lgt");
    if (/\bmedium\b/i.test(clause)) armorGrants.push("armor:med");
    if (/\bheavy\b/i.test(clause)) armorGrants.push("armor:hvy");
    if (/\bshields?\b/i.test(clause)) armorGrants.push("armor:shl");
    if (armorGrants.length) return { grants: armorGrants, choices: [] };
  }

  // --- Open/unnamed "of your choice" wildcard grants -----------------------
  const comboMatch = clause.match(/\bany combination of\s+(\w+)\s+skills?\s+or\s+tools?\b/i);
  if (comboMatch) {
    return { grants: [], choices: [{ count: parseCountWord(comboMatch[1]) ?? 1, pool: ["skills:*", "tool:*"] }] };
  }
  const skillWildcardMatch = clause.match(/^(\w+)\s+skills?\s+of your choice\b/i);
  if (skillWildcardMatch) {
    return { grants: [], choices: [{ count: parseCountWord(skillWildcardMatch[1]) ?? 1, pool: ["skills:*"] }] };
  }

  // --- Tool names / categories ---------------------------------------------
  const { grants: toolGrants, choices: toolChoices } = parseToolProficiencies(clause);
  grants.push(...toolGrants);
  choices.push(...toolChoices);

  // --- Skill names: "or" -> choice, "and"/plain -> grants -------------------
  let skillSection = clause;
  let explicitCount = null;
  const followingMatch = skillSection.match(/\b(\w+)\s+of the following(?:\s+skills?)?(?:\s+of your choice)?:?\s*/i);
  if (followingMatch) {
    explicitCount = parseCountWord(followingMatch[1]);
    skillSection = skillSection.slice(followingMatch.index + followingMatch[0].length);
  }
  skillSection = skillSection.replace(/\(your choice\)/gi, "").replace(/\bof your choice\b/gi, "");

  const hasOr = /\bor\b/i.test(skillSection);
  const hasAnd = /\band\b/i.test(skillSection);
  const isChoiceList = hasOr && !hasAnd;
  const pieces = skillSection
    .split(isChoiceList ? /,\s*|\s+or\s+/i : /,\s*|\s+and\s+/i)
    .map((s) => s.replace(/^(?:and|or)\s+/i, "").trim())
    .filter(Boolean);

  const skillCodes = [];
  for (const piece of pieces) {
    const code = skillCode(piece);
    if (code) skillCodes.push(`skills:${code}`);
  }

  if (skillCodes.length) {
    if (isChoiceList) choices.push({ count: explicitCount ?? 1, pool: [...new Set(skillCodes)] });
    else grants.push(...skillCodes);
  }

  return { grants: [...new Set(grants)], choices };
}

function text(el) {
  return (el?.textContent ?? "").trim();
}

export function resolveWikidotUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  const slug = input.includes(":") ? input : `${input}:main`;
  return `http://dnd2024.wikidot.com/${slug}`;
}

// Handles all things a user might paste: a bare wikidot slug, a full
// wikidot URL, a normal Google Docs link (any tab/view — /edit, /view,
// ...), or a "Publish to web" Google Docs link. The last two look similar
// but use different, incompatible ID schemes:
//   normal:    docs.google.com/document/d/<ID>/edit          -> needs /export?format=html
//   published: docs.google.com/document/d/e/<opaque-ID>/pub  -> already IS the fetchable HTML page
// The "d/e/" case has to be checked first — its "e" segment would otherwise
// get misread as if it were a normal doc's <ID>, producing a broken
// /document/d/e/export?format=html URL that 404s.
export function resolveSourceUrl(input) {
  const publishedMatch = input.match(/docs\.google\.com\/document\/d\/e\/([a-zA-Z0-9_-]+)/);
  if (publishedMatch) return `https://docs.google.com/document/d/e/${publishedMatch[1]}/pub`;

  const gdocsMatch = input.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (gdocsMatch) return `https://docs.google.com/document/d/${gdocsMatch[1]}/export?format=html`;

  return resolveWikidotUrl(input);
}

function detectPageType(doc) {
  const tags = Array.from(doc.querySelectorAll(".page-tags a")).map((el) => text(el).toLowerCase());
  if (tags.includes("subclass")) return "subclass";
  if (tags.includes("class")) return "class";
  return null;
}

// ---- Core Traits table ----------------------------------------------------

function parseCoreTraits(content, className) {
  const table = Array.from(content.querySelectorAll("table.wiki-content-table")).find((el) =>
    /Core .* Traits/i.test(text(el.querySelector("tr")))
  );
  if (!table) throw new Error("Could not find the Core Traits table on the page.");

  const traits = {};
  Array.from(table.querySelectorAll("tr")).slice(1).forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) return;
    traits[text(cells[0])] = text(cells[1]);
  });

  return { traits, tableHtml: buildCoreTraitsHtml(table, className) };
}

function buildCoreTraitsHtml(table, className) {
  const rows = [];
  Array.from(table.querySelectorAll("tr")).slice(1).forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) return;
    rows.push(`<tr><th scope="row"><p>${text(cells[0])}</p></th><td><p>${cells[1].innerHTML.trim()}</p></td></tr>`);
  });
  return `<h3>Core ${className} Traits</h3><table class="core-class-traits"><tbody>${rows.join("")}</tbody></table>`;
}

// ---- "Becoming a X" section ------------------------------------------------

function buildBecomingHtml(content, className) {
  const h1 = Array.from(content.querySelectorAll("h1")).find((el) => /^Becoming a /i.test(text(el)));
  if (!h1) return "";

  let html = `<h2>${text(h1).replace(/\s+/g, " ")}</h2>`;
  let node = h1.nextElementSibling;
  while (node && node.tagName !== "H1") {
    html += node.tagName === "H2" ? `<h3>${text(node).replace(/\s+/g, " ")}</h3>` : node.outerHTML;
    node = node.nextElementSibling;
  }
  return html;
}

// ---- Features tables --------------------------------------------------

function parseFeatureTables(content) {
  const tables = Array.from(content.querySelectorAll("table.wiki-content-table")).filter((el) =>
    /^Level$/i.test(text(el.querySelector("tr th")))
  );
  if (!tables.length) throw new Error("Could not find a class Features table.");

  const featuresByLevel = {};
  const scaleColumns = {};
  let maxSpellSlotLevel = 0;
  let hasPactColumn = false;

  for (const table of tables) {
    const headers = Array.from(table.querySelector("tr").querySelectorAll("th")).map((th) => text(th));
    const featuresIdx = headers.findIndex((h) => /Features/i.test(h));
    const skipIdx = new Set([0, featuresIdx].filter((i) => i >= 0));
    headers.forEach((h, i) => {
      if (i === 0 || i === featuresIdx) return;
      if (/Proficiency Bonus/i.test(h)) { skipIdx.add(i); return; }
      if (/Slot Level/i.test(h)) hasPactColumn = true;
    });

    const otherCols = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => !skipIdx.has(i) && h);
    for (const { h } of otherCols) if (!SPELL_COL.test(h) && !PACT_SLOT_COL.test(h)) scaleColumns[h] ??= {};

    Array.from(table.querySelectorAll("tr")).slice(1).forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (!cells.length) return;
      const level = parseInt(text(cells[0]), 10);
      if (Number.isNaN(level)) return;

      if (featuresIdx >= 0) {
        const featuresCell = cells[featuresIdx];
        const names = Array.from(featuresCell.querySelectorAll("a")).map((a) => text(a));
        if (names.length === 0) {
          const t = text(featuresCell);
          if (t && t !== "-") names.push(t);
        }
        featuresByLevel[level] = names;
      }

      for (const { h, i } of otherCols) {
        const raw = text(cells[i]);
        if (!raw || raw === "-") continue;
        if (SPELL_COL.test(h)) {
          const slotLevel = parseInt(h, 10);
          if (slotLevel > maxSpellSlotLevel) maxSpellSlotLevel = slotLevel;
        } else if (!PACT_SLOT_COL.test(h)) {
          scaleColumns[h][level] = raw;
        }
      }
    });
  }

  const hasSpellSlots = maxSpellSlotLevel > 0 || hasPactColumn;
  return { featuresByLevel, scaleColumns, maxSpellSlotLevel, hasPactColumn, hasSpellSlots };
}

function columnToScale(rawByLevel) {
  const scale = {};
  let prev;
  const levels = Object.keys(rawByLevel).map(Number).sort((a, b) => a - b);
  for (const level of levels) {
    const raw = rawByLevel[level];
    if (raw === prev) continue;
    prev = raw;
    const diceMatch = raw.match(/^(\d+)d(\d+)$/i);
    if (diceMatch) {
      scale[level] = { number: parseInt(diceMatch[1], 10), faces: parseInt(diceMatch[2], 10), modifiers: [] };
    } else if (/^\d+$/.test(raw)) {
      scale[level] = { value: parseInt(raw, 10) };
    }
  }
  return scale;
}

function findSpellcastingAbility(content) {
  const h3 = Array.from(content.querySelectorAll("h3")).find((el) => /Spellcasting|Pact Magic/i.test(text(el)));
  if (!h3) return null;
  let node = h3.nextElementSibling;
  while (node && node.tagName !== "H3") {
    const m = text(node).match(/(\w+) is (?:your|the) spellcasting ability/i);
    if (m) {
      const code = abilityCode(m[1]);
      if (code) return code;
    }
    node = node.nextElementSibling;
  }
  return null;
}

// ---- Starting equipment -----------------------------------------------

function parseStartingEquipment(rawText) {
  const result = { items: [], gp: null, wealthB: null, raw: rawText };
  const markers = [...rawText.matchAll(/\(([A-Z])\)/g)];
  if (!markers.length) return result;

  const options = markers.map((m, idx) => {
    const start = m.index + m[0].length;
    const end = idx + 1 < markers.length ? markers[idx + 1].index : rawText.length;
    return { letter: m[1], text: rawText.slice(start, end).trim() };
  });

  const stripConnectives = (s) =>
    s.replace(/^[;.]?\s*(or\s+)?/i, "").replace(/\s*(?:;|\.|,)?\s*(?:or|and)?\s*$/i, "").trim();

  let firstItemSet = null;
  for (const opt of options) {
    const cleaned = stripConnectives(opt.text);
    const flatGp = cleaned.match(/^([\d,]+)\s*GP$/i);
    if (flatGp) {
      result.wealthB = flatGp[1].replace(/,/g, "");
    } else if (!firstItemSet) {
      firstItemSet = cleaned;
    }
  }
  if (!firstItemSet) return result;

  let optionA = stripConnectives(firstItemSet);
  const gpMatch = optionA.match(/,?\s*and\s+([\d,]+)\s*GP\s*$/i);
  if (gpMatch) {
    result.gp = gpMatch[1].replace(/,/g, "");
    optionA = optionA.slice(0, gpMatch.index).trim();
  }

  optionA = optionA.replace(/,\s*and\s+/i, ", ").replace(/\s+and\s+/i, ", ");
  result.items = optionA.split(",").map((s) => s.trim()).filter(Boolean);
  return result;
}

function buildStartingEquipment(parsed) {
  const groupId = randomId();
  const entries = [{ type: "AND", requiresProficiency: false, _id: groupId, group: "", sort: 100000 }];
  let sort = 200000;

  const FOCUS_MAP = [
    [/holy symbol/i, "holy"],
    [/arcane focus/i, "arcane"],
    [/druidic focus/i, "druidic"],
  ];

  for (const itemName of parsed.items) {
    const focus = FOCUS_MAP.find(([re]) => re.test(itemName));
    if (focus) {
      entries.push({ type: "focus", count: null, key: focus[1], requiresProficiency: false, _id: randomId(), group: groupId, sort });
    } else {
      entries.push({ type: "linked", count: null, key: "", _item: itemName, requiresProficiency: false, _id: randomId(), group: groupId, sort });
    }
    sort += 100000;
  }

  if (parsed.gp) {
    entries.push({ type: "currency", count: parseInt(parsed.gp, 10), key: "gp", requiresProficiency: false, _id: randomId(), group: groupId, sort });
  }

  return entries;
}

// ---- Class advancement ---------------------------------------------------

function buildAdvancement({ traits, featuresByLevel, scaleColumns }) {
  const advancement = {};
  const add = (entry) => { advancement[entry._id] = entry; };

  add({ _id: randomId(), type: "HitPoints", configuration: {}, value: {}, flags: {}, hint: "" });

  const savesText = traits["Saving Throw Proficiencies"];
  if (savesText) {
    const grants = savesText.split(/\s+and\s+|,\s*/i).map((s) => abilityCode(s)).filter(Boolean).map((c) => `saves:${c}`);
    if (grants.length) {
      add({
        _id: randomId(), type: "Trait",
        configuration: { mode: "default", allowReplacements: false, grants, choices: [] },
        value: { chosen: [] }, level: 1, title: "Saving Throw Proficiencies", hint: "",
        classRestriction: "primary", flags: {},
      });
    }
  }

  const skillsText = traits["Skill Proficiencies"];
  if (skillsText) {
    const countMatch = skillsText.match(/Choose\s+(?:any\s+)?(\d+|one|two|three|four|five|six)/i);
    const count = countMatch ? (NUMBER_WORDS[countMatch[1].toLowerCase()] ?? parseInt(countMatch[1], 10)) : null;
    const isAnySkill = /Choose\s+any\s+\d+\s+skills?/i.test(skillsText);
    const afterColon = skillsText.includes(":") ? skillsText.replace(/^.*?:\s*/, "") : "";
    const pool = isAnySkill
      ? Object.values(SKILL_CODES)
      : afterColon.split(/,\s*|\s+or\s+|\s+and\s+/i).map((s) => s.replace(/^(or|and)\s+/i, "").trim()).map(skillCode).filter(Boolean);
    if (count && pool.length) {
      add({
        _id: randomId(), type: "Trait",
        configuration: { mode: "default", allowReplacements: false, grants: [], choices: [{ count, pool }] },
        value: { chosen: [] }, level: 1, title: "Skill Proficiencies", hint: "",
        classRestriction: "primary", flags: {},
      });
    } else {
      add({
        _id: randomId(), type: "Trait",
        configuration: { mode: "default", allowReplacements: false, grants: [], choices: [] },
        value: { chosen: [] }, level: 1, title: "Skill Proficiencies",
        hint: `FIXME: could not parse skill list from "${skillsText}"`,
        classRestriction: "primary", flags: {},
      });
    }
  }

  const weaponsText = traits["Weapon Proficiencies"];
  if (weaponsText) {
    const grants = [];
    if (/\bsimple\b/i.test(weaponsText)) grants.push("weapon:sim");
    if (/\bmartial\b/i.test(weaponsText)) grants.push("weapon:mar");
    add({
      _id: randomId(), type: "Trait",
      configuration: { mode: "default", allowReplacements: false, grants, choices: [] },
      value: { chosen: [] }, level: 1, title: "Weapon Proficiencies",
      hint: grants.length < 1 ? `FIXME: verify against "${weaponsText}"` : "",
      classRestriction: "primary", flags: {},
    });
  }

  const armorText = traits["Armor Training"];
  if (armorText && !/^none$/i.test(armorText.trim())) {
    const grants = [];
    if (/\blight\b/i.test(armorText)) grants.push("armor:lgt");
    if (/\bmedium\b/i.test(armorText)) grants.push("armor:med");
    if (/\bheavy\b/i.test(armorText)) grants.push("armor:hvy");
    if (/\bshields?\b/i.test(armorText)) grants.push("armor:shl");
    add({
      _id: randomId(), type: "Trait",
      configuration: { mode: "default", allowReplacements: false, grants, choices: [] },
      value: { chosen: [] }, level: 1, title: "Armor Training", hint: "", flags: {},
    });
  }

  const toolsText = traits["Tool Proficiencies"];
  if (toolsText) {
    const { grants: toolGrants, choices: toolChoices } = parseToolProficiencies(toolsText);
    add({
      _id: randomId(), type: "Trait",
      configuration: { mode: "default", allowReplacements: false, grants: toolGrants, choices: toolChoices },
      value: { chosen: [] }, level: 1, title: "Tool Proficiencies",
      hint: !toolGrants.length && !toolChoices.length ? `FIXME: could not parse tool list from "${toolsText}"` : "",
      classRestriction: "primary", flags: {},
    });
  }

  for (const [levelStr, features] of Object.entries(featuresByLevel)) {
    const level = parseInt(levelStr, 10);
    const named = features.filter((f) => !/^Ability Score Improvement$/i.test(f) && !/Subclass$/i.test(f) && !/^Subclass Feature$/i.test(f));
    const isSubclassLevel = features.some((f) => /Subclass$/i.test(f) && !/^Subclass Feature$/i.test(f));
    const isASI = features.some((f) => /^Ability Score Improvement$/i.test(f));

    if (isSubclassLevel) {
      add({ _id: randomId(), type: "Subclass", configuration: {}, value: { document: null, uuid: null }, level, title: "", hint: "", flags: {} });
    }
    if (isASI) {
      add({
        _id: randomId(), type: "AbilityScoreImprovement",
        configuration: { points: 2, fixed: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, cap: 2, locked: [], recommendation: null },
        value: {}, level, title: "", hint: "", flags: {},
      });
    }
    if (named.length) {
      add({
        _id: randomId(), type: "ItemGrant",
        configuration: { items: named.map((name) => ({ uuid: "", _name: `FIXME: ${name}`, optional: false })), optional: false, spell: null },
        value: {}, level, title: "Class Features", hint: "", flags: {},
      });
    }
  }

  for (const [header, rawByLevel] of Object.entries(scaleColumns)) {
    const scale = columnToScale(rawByLevel);
    if (!Object.keys(scale).length) continue;
    const isDice = Object.values(scale).some((v) => "faces" in v);
    add({
      _id: randomId(), type: "ScaleValue",
      configuration: { identifier: slugify(header), type: isDice ? "dice" : "number", distance: { units: "" }, scale },
      value: {}, title: header, hint: "", flags: {},
    });
  }

  return advancement;
}

// ---- Subclass pages ---------------------------------------------------

// Reads the parent class's real identifier AND its clean display name (e.g.
// "warlock" / "Warlock") off the last breadcrumb link — the only place a
// wikidot subclass page states its class relationship. No URL-slug fallback:
// a wikidot URL's "class:subclass" path is the class's own routing slug, not
// necessarily its display name (and for a subclass page, the tail after the
// LAST colon is the subclass's own slug, not the class's, so guessing from
// it — the previous behavior here — could silently mislabel the class).
// Returns null if the breadcrumbs don't have the expected structure; callers
// are expected to fail loudly rather than build an item with a guessed
// identifier/folder.
function deriveClassFromBreadcrumb(doc) {
  const links = doc.querySelectorAll(".breadcrumbs a");
  if (!links.length) return null;
  const last = links[links.length - 1];
  const href = last.getAttribute("href") || "";
  const m = href.match(/^\/([a-z0-9-]+):/i);
  if (!m) return null;
  return { identifier: slugify(m[1]), name: text(last) || null };
}

function deriveSubclassIdentifier(name) {
  let s = name.trim();
  const leading = [
    /^Oath of the\s+/i, /^Oath of\s+/i,
    /^Circle of the\s+/i, /^Circle of\s+/i,
    /^Way of the\s+/i, /^Way of\s+/i,
    /^Path of the\s+/i, /^Path of\s+/i,
    /^College of\s+/i, /^School of\s+/i, /^Domain of\s+/i,
  ];
  for (const re of leading) {
    if (re.test(s)) { s = s.replace(re, ""); break; }
  }
  s = s.replace(/\s+(Domain|Sorcery|Patron|Origin)$/i, "");
  return slugify(s) || slugify(name);
}

function buildSubclassDescription(content) {
  const paraEls = [];
  for (const el of Array.from(content.children)) {
    if (el.tagName === "H1" || el.tagName === "H2" || el.tagName === "H3") break;
    if (el.tagName === "P") paraEls.push(el);
  }

  const parts = [];
  let taglineDone = false;
  for (const el of paraEls) {
    const t = text(el);
    if (!t || /^Source:/i.test(t)) continue;
    if (!taglineDone) {
      taglineDone = true;
      const inner = el.innerHTML.trim();
      const emMatch = inner.match(/^<em>(.*)<\/em>$/i);
      if (emMatch) {
        parts.push(`<blockquote><p>${emMatch[1]}</p></blockquote>`);
        continue;
      }
    }
    parts.push(`<p>${el.innerHTML.trim()}</p>`);
  }
  return parts.join("");
}

function parseSubclassContent(content) {
  const featuresByLevel = {};
  // Prose captured between one feature's own "Level N: Name" heading and the
  // next (or end of section) — a wikidot feature is normally assumed to
  // already exist as a real compendium item and only needs its UUID looked
  // up by name (see resolveSlot() in importer.mjs), but when that lookup
  // comes up empty this is what lets the review dialog offer "create a new
  // feature" with the real page text instead of leaving a nameless blank.
  const featureDetails = [];
  const spellGrants = [];
  const scaleColumns = {};
  let lastNonLevelHeading = null;
  let activeFeature = null; // { level, name, blocks: [] }

  const finalizeActiveFeature = () => {
    if (activeFeature) {
      featureDetails.push({
        level: activeFeature.level,
        name: activeFeature.name,
        descriptionHtml: activeFeature.blocks.map((el) => el.outerHTML).join(""),
      });
    }
  };

  for (const el of Array.from(content.children)) {
    const tag = el.tagName;

    if (tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6") {
      const t = text(el).replace(/\s+/g, " ");
      const m = tag === "H3" ? t.match(LEVEL_HEADING) : null;
      if (m) {
        finalizeActiveFeature();
        const level = parseInt(m[1], 10);
        const name = m[2].trim();
        (featuresByLevel[level] ??= []).push(name);
        activeFeature = { level, name, blocks: [] };
      } else {
        lastNonLevelHeading = t;
        activeFeature?.blocks.push(el);
      }
      continue;
    }

    if (tag === "TABLE" && el.classList.contains("wiki-content-table")) {
      const headers = Array.from(el.querySelector("tr")?.querySelectorAll("th") ?? []).map((th) => text(th));
      if (!headers.length || !/Level$/i.test(headers[0])) { activeFeature?.blocks.push(el); continue; }

      // Spell grants and scale columns are captured into their own structured
      // fields below, so (unlike an ordinary paragraph) the table itself
      // isn't also appended to the feature's prose — it'd just be the same
      // data twice.
      if (headers.length >= 2 && SPELL_TABLE_HEADER.test(headers[1])) {
        Array.from(el.querySelectorAll("tr")).slice(1).forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) return;
          const level = parseInt(text(cells[0]), 10);
          if (Number.isNaN(level)) return;
          const spellNames = Array.from(cells[1].querySelectorAll("a")).map((a) => text(a));
          if (spellNames.length) spellGrants.push({ level, title: lastNonLevelHeading ?? headers[1], spellNames });
        });
      } else {
        const otherCols = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => i > 0 && h && !SPELL_COL.test(h) && !PACT_SLOT_COL.test(h));
        for (const { h } of otherCols) scaleColumns[h] ??= {};
        Array.from(el.querySelectorAll("tr")).slice(1).forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (!cells.length) return;
          const level = parseInt(text(cells[0]), 10);
          if (Number.isNaN(level)) return;
          for (const { h, i } of otherCols) {
            const raw = text(cells[i]);
            if (raw && raw !== "-") scaleColumns[h][level] = raw;
          }
        });
      }
      continue;
    }

    activeFeature?.blocks.push(el);
  }
  finalizeActiveFeature();

  return { featuresByLevel, featureDetails, spellGrants, scaleColumns };
}

function buildSubclassAdvancement({ featuresByLevel, spellGrants, scaleColumns }) {
  const advancement = {};
  const add = (entry) => { advancement[entry._id] = entry; };

  for (const [levelStr, names] of Object.entries(featuresByLevel)) {
    const level = parseInt(levelStr, 10);
    add({
      _id: randomId(), type: "ItemGrant",
      configuration: {
        // Entries are either a bare name (wikidot path — the real item
        // already exists somewhere, needs a name lookup, so gets a FIXME
        // placeholder) or a {name, uuid} pair (freeform path — the item was
        // just created from the doc's own prose, uuid is already real).
        items: names.map((entry) =>
          typeof entry === "string"
            ? { uuid: "", _name: `FIXME: ${entry}`, optional: false }
            : { uuid: entry.uuid, optional: false }
        ),
        optional: false, spell: null,
      },
      value: {}, level, title: "Subclass Features", hint: "", flags: {},
    });
  }

  for (const grant of spellGrants) {
    add({
      _id: randomId(), type: "ItemGrant",
      configuration: {
        items: grant.spellNames.map((name) => ({ uuid: "", _name: `FIXME spell: ${name}`, optional: false })),
        optional: false,
        spell: { ability: [], preparation: "always", uses: { max: "", per: "", requireSlot: false } },
      },
      value: {}, level: grant.level, title: grant.title, hint: "", flags: {},
    });
  }

  for (const [header, rawByLevel] of Object.entries(scaleColumns)) {
    const scale = columnToScale(rawByLevel);
    if (!Object.keys(scale).length) continue;
    const isDice = Object.values(scale).some((v) => "faces" in v);
    add({
      _id: randomId(), type: "ScaleValue",
      configuration: { identifier: slugify(header), type: isDice ? "dice" : "number", distance: { units: "" }, scale },
      value: {}, title: header, hint: "", flags: {},
    });
  }

  return advancement;
}

function baseStats() {
  return {
    duplicateSource: null, coreVersion: null, systemId: "dnd5e", systemVersion: null,
    createdTime: null, modifiedTime: null, lastModifiedBy: null, compendiumSource: null,
  };
}

// Companion to parseSubclassContent's own feature-detail capture — a
// wikidot class page numbers its own class features with the identical
// "Level N: Name" H3 convention a subclass page's features do (confirmed
// against dnd2024.wikidot.com/artificer:main's own "Level 1: Spellcasting"
// heading), so a class feature's FIXME name-lookup can offer the same
// "create from the source's own text" fallback a subclass feature's
// already could — before this, scrapeClass built no featureDetails at
// all, so a class feature with no real compendium match under this class
// (Artificer's own "Spellcasting" chief among them — dnd5e's free SRD
// packs don't ship Artificer, so the lookup only ever turns up some other
// class's same-named-but-different feature) had no fallback and the
// review dialog could only offer that wrong cross-class candidate.
// parseFeatureTables already gives level->name and any scale columns off
// the page's own Features table, which sits entirely before the first
// "Level N:" heading — so unlike parseSubclassContent (which has to
// special-case its own embedded spell-grant tables mid-walk), this only
// needs each feature's own prose underneath its heading, with no table
// branching required.
function parseClassFeatureDetails(content) {
  const featureDetails = [];
  let activeFeature = null;

  const finalizeActiveFeature = () => {
    if (activeFeature) {
      featureDetails.push({
        level: activeFeature.level,
        name: activeFeature.name,
        descriptionHtml: activeFeature.blocks.map((el) => el.outerHTML).join(""),
      });
    }
  };

  for (const el of Array.from(content.children)) {
    const tag = el.tagName;
    // A new top-level section (e.g. a class page's own trailing notes past
    // its last numbered feature) ends the run of per-feature prose, same
    // as the "Becoming an X"/Core Traits content before the first "Level
    // N:" heading is already skipped (activeFeature stays null until then).
    if (tag === "H1" || tag === "H2") {
      finalizeActiveFeature();
      activeFeature = null;
      continue;
    }
    if (tag === "H3") {
      const m = text(el).replace(/\s+/g, " ").match(LEVEL_HEADING);
      if (m) {
        finalizeActiveFeature();
        activeFeature = { level: parseInt(m[1], 10), name: m[2].trim(), blocks: [] };
        continue;
      }
    }
    activeFeature?.blocks.push(el);
  }
  finalizeActiveFeature();

  return featureDetails;
}

function scrapeClass(doc, content) {
  const className = text(doc.querySelector(".breadcrumbs")).split("»").pop().trim()
    || text(doc.querySelector("title")).split(" - ")[0].trim();
  if (!className) throw new Error("Could not determine class name from the page.");

  const { traits, tableHtml } = parseCoreTraits(content, className);
  const becomingHtml = buildBecomingHtml(content, className);
  const { featuresByLevel, scaleColumns, maxSpellSlotLevel, hasPactColumn, hasSpellSlots } = parseFeatureTables(content);
  const featureDetails = parseClassFeatureDetails(content);
  const hasSpellcasting = hasSpellSlots;
  const spellAbility = hasSpellcasting ? findSpellcastingAbility(content) : null;
  const identifier = slugify(className);

  const primaryText = traits["Primary Ability"] ?? "";
  const primaryIsChoice = /\s+or\s+/i.test(primaryText);
  const primaryAbilities = primaryText.split(/\s+(?:or|and)\s+/i).map(abilityCode).filter(Boolean);

  const hdMatch = (traits["Hit Point Die"] ?? "").match(/d\s*(\d+)/i);
  const denomination = hdMatch ? `d${hdMatch[1]}` : "";

  const equipRaw = traits["Starting Equipment"] ?? "";
  const parsedEquip = parseStartingEquipment(equipRaw);
  const startingEquipment = parsedEquip.items.length ? buildStartingEquipment(parsedEquip) : [];

  let progression = "none";
  let preparationFormula = "";
  if (hasSpellcasting) {
    if (hasPactColumn) progression = "pact";
    else if (maxSpellSlotLevel >= 9) progression = "full";
    else if (maxSpellSlotLevel >= 5) progression = "half";
    else if (maxSpellSlotLevel > 0) progression = "third";
    progression = PROGRESSION_OVERRIDES[identifier] ?? progression;
    const preparedHeader = Object.keys(scaleColumns).find((h) => /prepared/i.test(h));
    if (preparedHeader) preparationFormula = `@scale.${identifier}.${slugify(preparedHeader)}`;
  }

  const advancement = buildAdvancement({ traits, featuresByLevel, scaleColumns });

  const item = {
    _id: randomId(),
    name: className,
    type: "class",
    folder: null,
    img: `systems/dnd5e/icons/classes/${identifier}.webp`,
    system: {
      description: { value: tableHtml + becomingHtml, chat: "" },
      source: { custom: "", rules: "2024", revision: 1, license: "CC-BY-4.0", book: "" },
      startingEquipment,
      identifier,
      levels: 1,
      advancement,
      ...(hasSpellcasting ? {
        spellcasting: { progression, ability: spellAbility ?? "", preparation: { formula: preparationFormula } },
      } : {}),
      wealth: parsedEquip.wealthB ?? "",
      primaryAbility: { value: primaryAbilities, all: !primaryIsChoice },
      hd: { denomination, spent: 0, additional: "" },
      properties: [],
    },
    effects: [],
    flags: {},
    _stats: baseStats(),
    ownership: { default: 0 },
  };

  // `className` wasn't returned before — importer.mjs's createItemFromData
  // uses it both to file the class into its own class-named folder (as the
  // DDB class-import path already does via classFolderSegments) and, via
  // resolveItemUuids's `expectedClass`, to scope this class's own named
  // features' FIXME lookups to compendium entries actually filed under
  // this class rather than any same-named feature from another one.
  return { type: "class", item, className, featureDetails };
}

// Shared by both the wikidot subclass path and the freeform-doc path (see
// freeform-scraper.mjs) — either one only needs to produce this intermediate
// shape, not duplicate item-assembly/advancement-building logic.
export function assembleSubclassItem({ name, classIdentifier, className, descriptionHtml, featuresByLevel, spellGrants, scaleColumns }) {
  const identifier = deriveSubclassIdentifier(name);
  const advancement = buildSubclassAdvancement({ featuresByLevel, spellGrants, scaleColumns });
  const spellcastingOverride = SUBCLASS_SPELLCASTING_OVERRIDES[identifier];

  const item = {
    _id: randomId(),
    name,
    type: "subclass",
    folder: null,
    img: `systems/dnd5e/icons/classes/${identifier}.webp`,
    system: {
      description: { value: descriptionHtml, chat: "" },
      source: { custom: "", rules: "2024", revision: 1, license: "CC-BY-4.0", book: "" },
      identifier,
      classIdentifier: classIdentifier ?? "",
      advancement,
      spellcasting: spellcastingOverride
        ? { progression: spellcastingOverride.progression, ability: spellcastingOverride.ability, preparation: { formula: "" } }
        : { progression: "none", ability: "", preparation: { formula: "" } },
    },
    effects: [],
    flags: {},
    _stats: baseStats(),
    ownership: { default: 0 },
  };

  return { type: "subclass", item, className: className ?? null };
}

function scrapeSubclass(doc, content) {
  const subclassName = text(doc.querySelector(".breadcrumbs")).split("»").pop().trim()
    || text(doc.querySelector("title")).split(" - ")[0].trim();
  if (!subclassName) throw new Error("Could not determine subclass name from the page.");

  const classInfo = deriveClassFromBreadcrumb(doc);
  if (!classInfo) throw new Error("Could not determine the parent class from the page's breadcrumbs.");
  const descriptionHtml = buildSubclassDescription(content);
  const { featuresByLevel, featureDetails, spellGrants, scaleColumns } = parseSubclassContent(content);
  const result = assembleSubclassItem({
    name: subclassName, classIdentifier: classInfo.identifier, className: classInfo.name,
    descriptionHtml, featuresByLevel, spellGrants, scaleColumns,
  });
  return { ...result, featureDetails };
}

// Cheap check used to route between this parser and the freeform one
// (freeform-scraper.mjs) — a real wikidot page always has this container.
export function isWikidotPage(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !!doc.querySelector("#page-content");
}

// Parses raw wiki page HTML (as fetched or as saved-to-disk by the user) into
// a Foundry item document. Throws if the page type can't be determined.
export function scrapeWikidotHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector("#page-content");
  if (!content) throw new Error("This doesn't look like a dnd2024.wikidot.com page (no #page-content found).");

  const pageType = detectPageType(doc);
  if (pageType === "class") return scrapeClass(doc, content);
  if (pageType === "subclass") return scrapeSubclass(doc, content);
  throw new Error("Could not tell whether this is a class or subclass page (no recognizable page-tags found).");
}
