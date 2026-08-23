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
  const res = await fetch(`${PROXY_URL}/ddb/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cobalt }),
  });
  return res.json(); // { success, message? }
}

// Throws with a message suitable for direct display — callers don't need
// to know the difference between "proxy unreachable", "not authed yet",
// and "DDB rejected the request".
export async function fetchDdbGameData(type) {
  let res;
  try {
    res = await fetch(`${PROXY_URL}/ddb/game-data/${type}`, { signal: AbortSignal.timeout(15000) });
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
