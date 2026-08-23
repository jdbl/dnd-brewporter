// Pulls Species (race) and Feat data from D&D Beyond's character-builder
// API via the local proxy (see proxy/wikidot-proxy.mjs) and maps it into
// the same plain Foundry item-data shape scraper.mjs produces for wikidot
// content — so importer.mjs's existing create/folder/report machinery
// works unchanged regardless of source.
//
// Unlike the wikidot path, DDB gives us real structured JSON, not prose —
// there's nothing to pattern-match. This is closer in spirit to the
// freeform-scraper.mjs path: build real Feature items directly from the
// definition's own description HTML, no name-lookup/FIXME placeholders
// needed for the traits themselves.
//
// Field shapes below (source, type, prerequisites, requirements,
// movement, advancement level conventions, and the Species/Traits/<Race>
// and Feats/<Category> folder layout) are verified against dnd5e's own
// shipped 2024 content (packs/_source/origins24 and packs/_source/feats24
// in foundryvtt/dnd5e) rather than guessed — Actor Studio reads a race's
// traits straight off its own system.advancement (same as core dnd5e),
// so matching the official shape is what makes both work.

import { randomId, slugify } from "./scraper.mjs";

const PROXY_URL = "http://localhost:8091";

function baseStats() {
  return {
    duplicateSource: null, coreVersion: null, systemId: "dnd5e", systemVersion: null,
    createdTime: null, modifiedTime: null, lastModifiedBy: null, compendiumSource: null,
  };
}

function sourceField(isLegacy) {
  return { custom: "D&D Beyond", rules: isLegacy ? "2014" : "2024", revision: 1, license: "", book: "" };
}

export async function sendDdbAuth(cobalt) {
  let res;
  try {
    res = await fetch(`${PROXY_URL}/ddb/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cobalt }),
    });
  } catch (err) {
    throw new Error(`Could not reach the local proxy at ${PROXY_URL} (start it with "node proxy/wikidot-proxy.mjs"): ${err.message}`);
  }
  return res.json(); // { success, message? }
}

// Throws with a message suitable for direct display — callers don't need
// to know the difference between "proxy unreachable", "not authed yet",
// and "DDB rejected the request".
export async function fetchDdbGameData(type, params = {}) {
  const qs = new URLSearchParams(params).toString();
  let res;
  try {
    res = await fetch(`${PROXY_URL}/ddb/game-data/${type}${qs ? `?${qs}` : ""}`, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error(`Could not reach the local proxy at ${PROXY_URL} (start it with "node proxy/wikidot-proxy.mjs"): ${err.message}`);
  }
  const body = await res.json();
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `HTTP ${res.status} fetching ${type} from D&D Beyond`);
  }
  return body.data;
}

// ---- Feats -----------------------------------------------------------

// DDB's feat "categories" tagName maps to dnd5e 2024's feat subtypes where
// recognized; unrecognized/absent categories (older feats predate this
// tagging) fall back to no subtype rather than a guessed wrong one.
const FEAT_SUBTYPE_BY_TAG = {
  general: "general",
  origin: "origin",
  "fighting style": "fightingStyle",
  "epic boon": "epicBoon",
};

// Matches dnd5e's own shipped feats24 pack folder names exactly (verified
// against packs/_source/feats24/*/_folder.yml) — a GM browsing the created
// compendium/folder sees the same layout as the official one.
const FEAT_CATEGORY_FOLDER = {
  general: "General Feats",
  origin: "Origin Feats",
  fightingStyle: "Fighting Style Feats",
  epicBoon: "Epic Boon Feats",
};

// 2024 rules gate General feats behind the level-4 ASI opportunity and Epic
// Boons behind level 19 as a blanket rule — official content (e.g. Grappler,
// which has no explicit level prerequisite of its own) still encodes that
// structural minimum. Origin/Fighting Style feats have no such universal
// floor, so they fall back to 0 (no gate) rather than a guessed wrong one.
const FEAT_SUBTYPE_LEVEL_FLOOR = { general: 4, epicBoon: 19 };

function featSubtype(featDef) {
  for (const cat of featDef.categories ?? []) {
    const key = FEAT_SUBTYPE_BY_TAG[(cat.tagName ?? "").toLowerCase()];
    if (key) return key;
  }
  return "";
}

// Prefers DDB's own structured level prerequisite (prerequisiteMappings
// type "level") when a feat has one explicitly (e.g. Boon of Combat
// Prowess -> 19); falls back to the subtype's structural floor.
function featPrerequisiteLevel(featDef, subtype) {
  for (const p of featDef.prerequisites ?? []) {
    for (const m of p.prerequisiteMappings ?? []) {
      if (m.type === "level" && typeof m.value === "number") return m.value;
    }
  }
  return FEAT_SUBTYPE_LEVEL_FLOOR[subtype] ?? 0;
}

export function featFolderSegments(featDef) {
  const subtype = featSubtype(featDef);
  return FEAT_CATEGORY_FOLDER[subtype] ? ["Feats", FEAT_CATEGORY_FOLDER[subtype]] : ["Feats"];
}

export function assembleFeatItem(featDef) {
  const subtype = featSubtype(featDef);
  const requirements = (featDef.prerequisites ?? []).map((p) => p.description).filter(Boolean).join("; ");

  return {
    _id: randomId(),
    name: featDef.name,
    type: "feat",
    folder: null,
    img: "icons/svg/upgrade.svg",
    system: {
      description: { value: featDef.description ?? "", chat: "" },
      source: sourceField(false),
      type: { value: "feat", subtype },
      identifier: slugify(featDef.name),
      requirements,
      prerequisites: { level: featPrerequisiteLevel(featDef, subtype), repeatable: !!featDef.isRepeatable },
      properties: [],
      uses: { max: "", spent: 0, recovery: [] },
      activities: {},
      enchant: {},
    },
    effects: [],
    flags: { "dnd-brewporter": { ddbId: featDef.id, ddbSlug: featDef.slug } },
    _stats: baseStats(),
    ownership: { default: 0 },
  };
}

// ---- Species / racial traits ------------------------------------------

// DDB includes builder-only bookkeeping traits (Languages, Ability Score
// Increases, ...) alongside real flavor/mechanical traits, marked
// hideInSheet — same filter ddb-importer itself applies before generating
// character features, so we skip the same set here.
export function usableRacialTraits(raceDef) {
  return (raceDef.racialTraits ?? [])
    .map((t) => t.definition)
    .filter((d) => d && !d.hideInSheet);
}

// Folder layout matches dnd5e's own origins24 pack exactly: species sit at
// the pack root, their traits nest under Traits/<Race Name> rather than
// directly under the race — verified against packs/_source/origins24.
export function raceTraitFolderSegments(raceDef) {
  return ["Species", "Traits", raceDef.fullName];
}

export function raceFolderSegments() {
  return ["Species"];
}

function buildRaceTraitItemData({ name, description }, isLegacy, raceName) {
  return {
    _id: randomId(),
    name,
    type: "feat",
    folder: null,
    img: "icons/svg/upgrade.svg",
    system: {
      description: { value: description ?? "", chat: "" },
      source: sourceField(isLegacy),
      type: { value: "race", subtype: "" },
      identifier: slugify(name),
      requirements: raceName,
      // dnd5e's own race traits leave prerequisites.level unset (null) —
      // unlike a standalone feat, a racial trait is never level-gated on
      // its own item, so there's no numeric floor to encode here.
      prerequisites: { level: null, repeatable: false },
      properties: [],
      uses: { max: "", spent: 0, recovery: [] },
      activities: {},
      enchant: {},
    },
    effects: [],
    flags: {},
    _stats: baseStats(),
    ownership: { default: 0 },
  };
}

// Caller creates each trait's Feature item first (getting real UUIDs),
// then passes { level: [{name, uuid}] } buckets in here — same two-step
// flow importer.mjs already uses for freeform-generated subclass features.
// DDB traits mostly have no requiredLevel (granted at character creation);
// null buckets to level 0, matching dnd5e's own race items (verified
// against origins24/species/human.yml, whose ItemGrant/Size/Trait
// advancement entries all use level: 0).
export function buildRaceAdvancement(traitsByLevel) {
  const advancement = {};
  for (const [levelStr, entries] of Object.entries(traitsByLevel)) {
    const id = randomId();
    advancement[id] = {
      _id: id, type: "ItemGrant",
      configuration: {
        items: entries.map((e) => ({ uuid: e.uuid, optional: false })),
        optional: false, spell: null,
      },
      value: {}, level: parseInt(levelStr, 10), title: "Racial Traits", hint: "", flags: {},
    };
  }
  return advancement;
}

export function assembleRaceItem(raceDef, traitsByLevel) {
  const identifier = slugify(raceDef.fullName);
  const speed = raceDef.weightSpeeds?.normal;

  return {
    _id: randomId(),
    name: raceDef.fullName,
    type: "race",
    folder: null,
    img: raceDef.avatarUrl || "icons/svg/mystery-man.svg",
    system: {
      description: { value: raceDef.description ?? raceDef.longDescription ?? "", chat: "" },
      source: sourceField(raceDef.isLegacy),
      identifier,
      advancement: buildRaceAdvancement(traitsByLevel),
      // 5e rule (both 2014 and 2024): playable species are Humanoid unless
      // stated otherwise — DDB's creatureTypeId isn't a documented/stable
      // enum we can map confidently, so this is a deliberate, verified-safe
      // default rather than a guess dressed up as data.
      type: { value: "humanoid", custom: "", subtype: raceDef.fullName },
      // Matches origins24/species/human.yml exactly: unset directions are
      // null (not 0) and units is null (defers to the system default) —
      // a real 0 here would render as an explicit zero speed, not "unset".
      ...(speed ? {
        movement: {
          walk: speed.walk || null, fly: speed.fly || null, swim: speed.swim || null,
          climb: speed.climb || null, burrow: speed.burrow || null, hover: false, units: null,
        },
      } : {}),
    },
    effects: [],
    flags: { "dnd-brewporter": { ddbEntityRaceId: raceDef.entityRaceId, ddbSlug: raceDef.slug } },
    _stats: baseStats(),
    ownership: { default: 0 },
  };
}

// Exported for buildRaceTraitItemData's raceName/isLegacy args without
// exposing the whole function shape to importer.mjs.
export function assembleRaceTraitItem(traitDef, raceDef) {
  return buildRaceTraitItemData(
    { name: traitDef.name, description: traitDef.description },
    raceDef.isLegacy,
    raceDef.fullName,
  );
}

// ---- Classes / class features ------------------------------------------
//
// Unlike species traits, class features for the 12 core classes are
// overwhelmingly likely to already exist by name in the user's installed
// dnd5e compendiums (the system bundles the 2024 free-rules content) —
// so this reuses importer.mjs's existing name-lookup/FIXME machinery
// (the same one the wikidot class-import path already relies on) instead
// of generating duplicate Feature items the way race traits do. A miss
// still isn't a dead end: featureDetails carries DDB's own description
// text into the "no match found" review row, so "+ Create new Feature
// item" has real prose to start from — the wikidot class path doesn't
// even offer that today, only its subclass path does.

// DDB's ability ids are a fixed, stable enumeration used across their
// whole API (str/dex/con/int/wis/cha = 1-6) — confirmed against this
// account's own data (Wizard primaryAbilities/spellCastingAbilityId both
// resolve to 4 = int).
const ABILITY_CODE_BY_ID = { 1: "str", 2: "dex", 3: "con", 4: "int", 5: "wis", 6: "cha" };

// D&D Beyond's 2014-ruleset base classes keep their original small fixed
// ids (Bard=1 ... Rogue=12, verified against ddb-proxy's own hardcoded
// CLASS_MAP); every 2024 version (and homebrew like Blood Hunter) uses a
// large generated id. There's no separate isLegacy flag on a class
// definition the way there is on races/feats, so this is the reliable
// substitute rather than a guess.
function isLegacyClass(classDef) {
  return classDef.id < 1000;
}

// Warlock's multiClassSpellSlotDivisor reads 1 (same as a full caster) in
// practice, since Pact Magic doesn't participate in normal multiclass
// slot pooling — divisor alone can't tell them apart, so it needs the
// same kind of name-based exception scraper.mjs already carries for
// Artificer (PROGRESSION_OVERRIDES).
const SPELLCASTING_NAME_OVERRIDE = { warlock: "pact", artificer: "artificer" };
// Verified against this account's own data: Wizard/Sorcerer/Bard/Cleric/
// Druid (full casters) all report divisor 1; Paladin/Ranger (half
// casters) report 2. No core base class is a third-caster to verify a 3
// against, but it follows the same documented multiclassing rule (a
// third caster contributes a third of a caster level) so the mapping is
// extended on that basis, not invented.
const DIVISOR_TO_PROGRESSION = { 1: "full", 2: "half", 3: "third" };

function inferSpellcastingProgression(classDef) {
  if (!classDef.canCastSpells) return "none";
  const override = SPELLCASTING_NAME_OVERRIDE[slugify(classDef.name)];
  if (override) return override;
  return DIVISOR_TO_PROGRESSION[classDef.spellRules?.multiClassSpellSlotDivisor] ?? "none";
}

export function classFolderSegments(classDef) {
  return [classDef.name];
}

// Same per-level bucketing + name-pattern detection (Ability Score
// Improvement, "... Subclass") that scraper.mjs's buildAdvancement uses
// for the wikidot path, just sourced from DDB's clean classFeatures list
// instead of a parsed prose table — so a Barbarian import produces the
// same advancement shape whether it came from wikidot or D&D Beyond.
// DDB repeats a feature at each level it re-triggers (a weapon mastery
// re-pick, a later ASI) by prefixing the *name itself* with the level
// ("8: Ability Score Improvement", "4: Weapon Mastery") rather than just
// relying on requiredLevel — ddb-importer's own parser strips this same
// prefix for the same reason. Left in place, it breaks both the ASI/
// Subclass name-pattern checks below (no longer an exact match) and the
// FIXME name-lookup (no compendium item is literally named "8: Ability
// Score Improvement").
const LEVEL_PREFIXED_NAME = /^\d+:\s*/;
function cleanFeatureName(name) {
  return name.replace(LEVEL_PREFIXED_NAME, "");
}

// A level-1 "Core <Class> Traits" entry is DDB's own summary table (primary
// ability, hit die, saves, ...) — already captured wholesale in the class
// item's own description, not a real granted feature.
const CORE_TRAITS_HEADER = /^Core .+ Traits$/i;

// Shared by both classes (which also get a HitPoints entry) and subclasses
// (which don't — HitPoints/hit dice belong to the base class only) so a
// Barbarian and a Path of the Berserker build their per-level ItemGrant/
// ASI/Subclass-placeholder advancement the exact same way.
function buildFeatureAdvancement(features, { includeHitPoints }) {
  const advancement = {};
  const add = (entry) => {
    const id = randomId();
    advancement[id] = { _id: id, value: {}, title: "", hint: "", flags: {}, ...entry };
  };
  if (includeHitPoints) add({ type: "HitPoints", configuration: {} });

  const byLevel = {};
  for (const f of features) {
    if (CORE_TRAITS_HEADER.test(f.name)) continue;
    (byLevel[f.requiredLevel ?? 1] ??= []).push({ ...f, name: cleanFeatureName(f.name) });
  }

  const featureDetails = [];
  for (const [levelStr, levelFeatures] of Object.entries(byLevel)) {
    const level = parseInt(levelStr, 10);
    const isASI = levelFeatures.some((f) => /^Ability Score Improvement$/i.test(f.name));
    const isSubclassLevel = levelFeatures.some((f) => /Subclass$/i.test(f.name) && !/^Subclass Feature$/i.test(f.name));
    const named = levelFeatures.filter((f) =>
      !/^Ability Score Improvement$/i.test(f.name) && !/Subclass$/i.test(f.name) && !/^Subclass Feature$/i.test(f.name));

    if (isSubclassLevel) add({ type: "Subclass", configuration: {}, value: { document: null, uuid: null }, level });
    if (isASI) {
      add({
        type: "AbilityScoreImprovement",
        configuration: { points: 2, fixed: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, cap: 2, locked: [], recommendation: null },
        level,
      });
    }
    if (named.length) {
      add({
        type: "ItemGrant",
        configuration: { items: named.map((f) => ({ uuid: "", _name: `FIXME: ${f.name}`, optional: false })), optional: false, spell: null },
        level, title: "Class Features",
      });
      for (const f of named) featureDetails.push({ level, name: f.name, descriptionHtml: f.description ?? "" });
    }
  }

  return { advancement, featureDetails };
}

function buildClassAdvancement(classDef) {
  return buildFeatureAdvancement(classDef.classFeatures ?? [], { includeHitPoints: true });
}

// Returns { item, featureDetails } — featureDetails is passed straight
// through to importer.mjs's createItemFromData the same way a scraped
// subclass's feature prose already is.
export function assembleClassItem(classDef) {
  const identifier = slugify(classDef.name);
  const primaryAbility = ABILITY_CODE_BY_ID[classDef.primaryAbilities?.[0]];
  const spellAbility = ABILITY_CODE_BY_ID[classDef.spellCastingAbilityId];
  const progression = inferSpellcastingProgression(classDef);
  const { advancement, featureDetails } = buildClassAdvancement(classDef);

  return {
    featureDetails,
    item: {
      _id: randomId(),
      name: classDef.name,
      type: "class",
      folder: null,
      img: `systems/dnd5e/icons/classes/${identifier}.webp`,
      system: {
        description: { value: classDef.description ?? "", chat: "" },
        source: sourceField(isLegacyClass(classDef)),
        identifier,
        levels: 1,
        advancement,
        spellcasting: { progression, ability: progression !== "none" ? (spellAbility ?? "") : "", preparation: { formula: "" } },
        primaryAbility: { value: primaryAbility ? [primaryAbility] : [], all: (classDef.primaryAbilities?.length ?? 0) <= 1 },
        hd: { denomination: classDef.hitDice ? `d${classDef.hitDice}` : "", spent: 0, additional: "" },
        wealth: classDef.wealthDice ?? "",
        startingEquipment: [],
        properties: [],
      },
      effects: [],
      flags: { "dnd-brewporter": { ddbId: classDef.id, ddbSlug: classDef.slug } },
      _stats: baseStats(),
      ownership: { default: 0 },
    },
  };
}

// ---- Subclasses ----------------------------------------------------------
//
// There's no bulk "all subclasses" catalog — D&D Beyond only returns them
// scoped to one base class at a time (confirmed live: GET .../game-data/
// subclasses?sharingSetting=2&baseClassId=<id>). Callers need to fetch
// game-data/classes first and pass each class's id in.
//
// A subclass definition's own classFeatures list isn't subclass-only —
// it's the *combined* class+subclass feature list (confirmed against a
// real Wizard/Evoker pair: Evoker's classFeatures includes Wizard's own
// Spellcasting, Ability Score Improvement, etc. verbatim). Diffing by
// feature id against the parent class's own classFeatures is what
// isolates the 5 real Evoker-only features from the 14 inherited ones —
// name-matching wouldn't be reliable (some inherited entries share exact
// names with genuinely distinct subclass features elsewhere).
export function classFeatureIds(classDef) {
  return new Set((classDef.classFeatures ?? []).map((f) => f.id));
}

function subclassOnlyFeatures(subclassDef, parentClassDef) {
  const parentIds = classFeatureIds(parentClassDef);
  return (subclassDef.classFeatures ?? []).filter((f) => !parentIds.has(f.id));
}

// dnd5e's own subclasses pack ships flat (no per-class folders at all) —
// there's no official convention to match here, so this follows the
// module's own established one instead: a subclass's own item sits
// straight in its class's folder (classFolderSegments), same as the
// wikidot subclass path; its features get a sibling subfolder.
export function subclassFolderSegments(parentClassDef) {
  return [...classFolderSegments(parentClassDef), "Subclass Features"];
}

// Returns { item, featureDetails } as assembleClassItem does. Subclass
// features reuse the same name-lookup/FIXME mechanism as class features
// (see assembleClassItem's own comment) for the same reason: some will
// already be in the user's installed compendiums, some (splatbook-
// specific subclasses) won't be, and either way D&D Beyond's own
// description text is available to seed "+ Create new Feature item" on a
// miss.
export function assembleSubclassItem(subclassDef, parentClassDef) {
  const parentIdentifier = slugify(parentClassDef.name);
  const { advancement, featureDetails } = buildFeatureAdvancement(
    subclassOnlyFeatures(subclassDef, parentClassDef),
    { includeHitPoints: false },
  );

  return {
    featureDetails,
    item: {
      _id: randomId(),
      name: subclassDef.name,
      type: "subclass",
      folder: null,
      img: subclassDef.avatarUrl || `systems/dnd5e/icons/classes/${parentIdentifier}.webp`,
      system: {
        description: { value: subclassDef.description ?? "", chat: "" },
        // A subclass follows its parent class's ruleset, not any id range
        // of its own — subclassDef.id doesn't fall in the same
        // legacy-vs-2024 numeric split classes do.
        source: sourceField(isLegacyClass(parentClassDef)),
        identifier: slugify(subclassDef.name),
        classIdentifier: parentIdentifier,
        advancement,
        spellcasting: { progression: "none", ability: "", preparation: { formula: "" } },
      },
      effects: [],
      flags: { "dnd-brewporter": { ddbId: subclassDef.id, ddbSlug: subclassDef.slug, ddbParentClassId: subclassDef.parentClassId } },
      _stats: baseStats(),
      ownership: { default: 0 },
    },
  };
}
