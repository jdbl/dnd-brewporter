import { scrapeWikidotHtml, resolveSourceUrl, isWikidotPage, assembleSubclassItem, slugify, normalizeName, searchIndex, MODULE_ID, applyRulesetPreference, randomId } from "./scraper.mjs";
import { scrapeFreeformSubclass } from "./freeform-scraper.mjs";
import { showBuildFeatureDialog, buildAutoMechanics } from "./effects-builder.mjs";
import { sendDdbAuth, fetchDdbGameData, assembleFeatItem, usableRacialTraits, findDuplicateTraitNameWarnings, assembleRaceTraitItem, assembleRaceItem, buildSizeAdvancement, mergeTraitDerivedMovement, featFolderSegments, raceTraitFolderSegments, raceFolderSegments, assembleClassItem, classFolderSegments, assembleSubclassItem as assembleDdbSubclassItem, subclassFolderSegments, buildDdbClassFeatureItemData, assembleBackgroundItem, assembleBackgroundFeatureItem, backgroundFolderSegments, backgroundFeatureFolderSegments } from "./ddb-scraper.mjs";

// Below this many detected "Nth Level:" headings, a freeform parse is
// shown for review before creating anything — a strong sign the doc
// doesn't follow the convention and needs a human to look. At or above it,
// freeform imports go straight through like wikidot ones do.
const FREEFORM_CONFIDENCE_THRESHOLD = 2;

export { MODULE_ID };
// Local CORS-bypass proxy (see proxy/wikidot-proxy.mjs) — optional, started
// by the user once per session. Bound to localhost only; not configurable
// yet (single-machine setups only — see the module's plan doc for the
// remote/shared-Foundry follow-up).
const PROXY_URL = "http://localhost:8091";

function packUuid(pack, id) {
  return `Compendium.${pack.metadata.packageName}.${pack.metadata.name}.${pack.documentName}.${id}`;
}

// Finds-or-creates a nested Item folder path (e.g. ["Warlock", "Subclass
// Features"]) so imported items land where the world's other class/subclass
// compendiums already keep them, instead of loose at the top of the Items
// directory. Matches by name+parent in game.folders before creating
// anything, so it's idempotent across repeated imports and across sessions
// — re-importing another Warlock subclass later reuses the same "Warlock"
// folder rather than making a second one. Returns null (root) for an empty
// path, e.g. when the caller has no known class name to file under.
// A Folder's own `.folder` (its parent) resolves to the actual parent
// Folder document on a real Foundry client, not the raw id string Folder.create()
// was given — comparing it directly against a plain id (as this originally
// did) never matches, so every call created a brand new folder instead of
// reusing the existing one. Normalize both shapes down to a plain id/null
// before comparing.
function folderParentId(folder) {
  return folder.folder?.id ?? folder.folder ?? null;
}

async function resolveFolderPath(segments) {
  let parentId = null;
  for (const name of segments.filter(Boolean)) {
    let folder = game.folders.find((f) => f.type === "Item" && f.name === name && folderParentId(f) === parentId);
    if (!folder) folder = await Folder.create({ name, type: "Item", folder: parentId, sorting: "a" });
    parentId = folder.id;
  }
  return parentId;
}

// "monsterfeatures"/"monsterfeatures24" (and any third-party pack following
// the same naming convention) hold monster/NPC-only content; everything else
// indexable as an Item pack (spells, classfeatures, equipment, ...) is
// player-facing. Used to hard-filter which packs get indexed at all per the
// "contentType" setting, so the excluded kind can never be offered as a
// match, search result, or ambiguous candidate — not just deprioritized.
export function packContentKind(pack) {
  return /monster/i.test(pack.metadata.name) ? "monster" : "player";
}

// Class/subclass feature compendiums file their contents into per-class
// folders (subclass features nested a level deeper under their base class,
// e.g. "Fighter" > "Subclass Features" > "Champion"), so walking up to the
// topmost ancestor recovers the owning class's name — confirmed against the
// dnd5e system's own "classfeatures"/"classes24" packs, where e.g. every
// class's own "Extra Attack" sits in its own class-named folder. Returns
// null for an unfiled entry or on a Foundry build without compendium
// folders, so callers fall back to the old unfiltered behavior rather than
// erroring. Uses the same folderParentId-style defensive unwrap as world
// folders above, in case a pack's folder entries are ever resolved
// Documents rather than plain data.
function topFolderName(pack, folderId) {
  let currentId = folderId ?? null;
  let name = null;
  while (currentId) {
    const folder = pack.folders?.get(currentId);
    if (!folder) break;
    name = folder.name;
    currentId = folderParentId(folder);
  }
  return name;
}

export async function buildNameIndex() {
  const contentType = game.settings.get(MODULE_ID, "contentType") || "player";
  const index = new Map(); // normalized name -> [{ uuid, name, pack, tier, classHint, subtype }]
  const itemPacks = game.packs.filter((p) => p.documentName === "Item" && packContentKind(p) === contentType);
  for (const pack of itemPacks) {
    let idx;
    try {
      // "system.type.subtype" is what tells a Fighting Style Feat apart
      // from every other kind of feat (general/origin/epicBoon/...) — see
      // resolvePoolRestriction, which needs it to resolve an ItemChoice
      // pool placeholder without a name to look up at all. "system.requirements"
      // and "system.type.value" are the race-trait equivalent — see
      // copyOfficialRaceTraitMechanics/findRaceTraitMatch, which need them to
      // scope a race trait name match down to its own species (a race trait's
      // system.type.value is "race", and system.requirements holds the owning
      // species name — see buildRaceTraitItemData in ddb-scraper.mjs).
      idx = await pack.getIndex({ fields: ["folder", "system.type.subtype", "system.requirements", "system.type.value"] });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index pack ${pack.collection}`, err);
      continue;
    }
    // 2024-ruleset packs ("spells24", "equipment24", "classes24", ...) win
    // ties over legacy/2014 packs of the same name.
    const tier = /24$/.test(pack.metadata.name) ? 1 : 2;
    for (const entry of idx) {
      const key = normalizeName(entry.name);
      const uuid = entry.uuid ?? packUuid(pack, entry._id);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({
        uuid, name: entry.name, pack: pack.collection, tier, img: entry.img, type: entry.type,
        classHint: topFolderName(pack, entry.folder),
        subtype: entry.system?.type?.subtype,
        raceRequirement: entry.system?.requirements,
        raceCategory: entry.system?.type?.value,
      });
    }
  }
  return index;
}

// `expectedClass`, when given, is the class this feature is being imported
// for (a base class name in both the class and subclass case — a subclass
// feature is filed under its parent class's own folder). A plain name match
// alone can't tell apart e.g. five classes' own "Extra Attack" — each is a
// distinct compendium entry with the same name — but the compendium's own
// folder-per-class filing can, so this is what turns most of the "N
// matches" corrections a full class/subclass import used to generate into
// silent auto-resolutions. Only narrows when a class-filed candidate
// actually exists; anything unfiled or third-party falls through to the
// original tier-only behavior untouched.
function lookup(index, rawName, expectedClass) {
  const candidates = index.get(normalizeName(rawName));
  if (!candidates?.length) return { status: "none" };

  const preference = game.settings.get(MODULE_ID, "rulesetPreference");
  const pool = applyRulesetPreference(candidates, preference);

  if (expectedClass) {
    const classKey = normalizeName(expectedClass);
    const classPool = pool.filter((c) => c.classHint && normalizeName(c.classHint) === classKey);
    if (classPool.length) {
      const uniqueClassUuids = new Set(classPool.map((c) => c.uuid));
      if (uniqueClassUuids.size === 1) return { status: "resolved", match: classPool[0], classMatched: true };
      return { status: "ambiguous", candidates: classPool, classMatched: true };
    }
  }

  // No candidate is actually filed under the class this feature belongs
  // to — e.g. Artificer's own "Spellcasting" against a free-SRD compendium
  // that only ships Wizard/Cleric/etc.'s same-named feature. Those aren't
  // interchangeable (each class's Spellcasting text/mechanics differ), so
  // `classMatched: false` tells resolveSlot not to trust this name-only
  // hit when it has real class-specific text to build from instead.
  const uniqueUuids = new Set(pool.map((c) => c.uuid));
  if (uniqueUuids.size === 1) return { status: "resolved", match: pool[0], classMatched: false };
  return { status: "ambiguous", candidates: pool, classMatched: false };
}

// A race trait's name alone is a much weaker signal than a feat's — feat
// names are overwhelmingly globally unique, but trait names collide
// constantly across species (multiple species each have their own "Speed",
// "Size", "Darkvision", "Ability Score Increase(s)", "Creature Type"). So
// unlike `lookup` (which trusts a unique name-only match), this only ever
// returns a single candidate that is BOTH indexed as an actual race trait
// (`raceCategory === "race"`, i.e. the pack entry's own `system.type.value`
// — see buildRaceTraitItemData in ddb-scraper.mjs) AND whose
// `raceRequirement` (that entry's `system.requirements`) normalizes to the
// same species as `raceDef.fullName`. Zero or more-than-one survivor is
// treated the same as "no match" — deliberately conservative, since a wrong
// guess here means silently copying another species' mechanics. Kept as a
// pure function (no Foundry global reads) so the matching logic itself is
// directly unit-testable without mocking `game`/`fromUuid` — see
// copyOfficialRaceTraitMechanics for the Foundry-API-calling wrapper around
// this.
export function findRaceTraitMatch(candidates, raceDef, preference) {
  if (!candidates?.length) return null;
  const speciesKey = normalizeName(raceDef?.fullName ?? "");
  const pool = applyRulesetPreference(candidates, preference);
  const matches = pool.filter(
    (c) => c.raceCategory === "race" && c.raceRequirement && normalizeName(c.raceRequirement) === speciesKey
  );
  const uniqueUuids = new Set(matches.map((c) => c.uuid));
  return uniqueUuids.size === 1 ? matches[0] : null;
}

// Neither an ambiguous match (multiple compendium items share a name) nor
// a total miss (no name in the index at all) can be fixed until the parent
// item exists, so both get queued into `pending` — the caller attaches the
// created item's UUID once it exists, so the review dialog can write a pick
// straight back into that field instead of sending the user to the item
// sheet by hand. Total misses still get `candidates: []`; the review UI
// covers them with a live compendium search instead of a fixed list.
//
// `autoCreate`, when given, is only ever passed for D&D Beyond class/
// subclass features (see resolveItemUuids/createItemFromData) — real
// structured description HTML straight from the definition, not scraped or
// OCR'd prose, so a true miss (nothing in any compendium at all — the
// overwhelmingly common case for a sourcebook subclass dnd5e's free SRD
// packs don't ship) is built immediately instead of queued for manual
// review. See the `classMatched === false` branch below for the other case
// this same real-text-beats-a-namesake logic covers.
async function resolveSlot(entry, hintKey, index, report, context, path, pending, descByName, expectedClass, autoCreate) {
  if (!entry || typeof entry !== "object" || !(hintKey in entry)) return;
  const targetKey = "uuid" in entry ? "uuid" : typeof entry.key === "string" ? "key" : null;
  if (!targetKey || entry[targetKey] !== "") return;

  const rawName = String(entry[hintKey]).replace(/^FIXME(\s+spell)?:\s*/i, "").trim();
  const result = lookup(index, rawName, expectedClass);
  // Only populated for wikidot subclass features (see parseSubclassContent
  // in scraper.mjs) and DDB class/subclass features (see resolveItemUuids)
  // — lets the review dialog (or, for DDB, this function directly) offer a
  // real feature built from the source's own text instead of starting from
  // a blank item, or (below) instead of a cross-class name-only "match".
  const descriptionHtml = descByName?.get(rawName) ?? null;

  // `result.classMatched === false` (only ever set when status is
  // "resolved" or "ambiguous" — see lookup) means every candidate found is
  // filed under some *other* class/subclass than the one this feature
  // belongs to — e.g. Artificer or Eldritch Knight's own "Spellcasting"
  // only ever turning up Wizard/Cleric/etc.'s same-named but mechanically
  // different feature, since dnd5e's free SRD packs don't ship Artificer
  // or subclass-granted spellcasting at all. That's true whether there's
  // one such candidate (an otherwise-unique name that would silently
  // "resolve" with zero review) or several (an "ambiguous" pick list of
  // equally wrong options) — neither is trustworthy enough to apply
  // without a real check, so both funnel through the same fallback: real
  // class-specific text (DDB's own description, or wikidot's own scraped
  // prose) beats an unverified cross-class namesake. DDB can autoCreate
  // that immediately; wikidot has no such silent-build path (a human
  // always reviews a wikidot import, by design) so it queues for manual
  // review instead, with the mismatched candidates *and* the real text
  // both offered — never just the former, which is what let Eldritch
  // Knight's "Spellcasting" silently point at Wizard's version before this
  // fix. A class-matched ambiguity (several packs really do carry this
  // class's own version, e.g. a 2014 and a 2024 copy) is unaffected —
  // picking between multiple *real* candidates for this exact class is a
  // judgment call a human, not this module, should make either way.
  if (result.status !== "none" && result.classMatched === false) {
    if (autoCreate && descriptionHtml) {
      try {
        const featureData = buildDdbClassFeatureItemData(
          { name: rawName, level: autoCreate.level, descriptionHtml },
          { isLegacy: autoCreate.isLegacy, requirements: autoCreate.requirements },
        );
        featureData.folder = autoCreate.folderId;
        // Same real-DDB-text trust level as importDdbFeat's own fallback
        // (see buildAutoMechanics) — an auto-built class/subclass feature
        // deserves the same AC/resistance/darkvision/speed/save scan a
        // feat already gets, not a permanently blank effects/activities set.
        const { effects, activities, advancement } = buildAutoMechanics(descriptionHtml, index, rawName);
        featureData.effects = effects;
        featureData.system.activities = activities;
        featureData.system.advancement = { ...(featureData.system.advancement ?? {}), ...advancement };
        const created = await Item.create(featureData);
        if (!created) throw new Error("Foundry rejected the auto-built feature's data (check the browser console for a DataModelValidationError).");
        entry[targetKey] = created.uuid;
        report.created.push({ name: created.name, uuid: created.uuid, file: context, via: "ddb-auto" });
        delete entry[hintKey];
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not auto-create feature "${rawName}" — falling back to manual review`, err);
      }
    }
    const candidates = result.status === "ambiguous" ? result.candidates : [result.match];
    const packs = [...new Set(candidates.map((c) => c.pack))].join(", ");
    pending.push({
      context, name: rawName,
      reason: `${candidates.length} match${candidates.length === 1 ? "" : "es"} (${packs}) — none filed under this class, may be a different class's version`,
      path: `${path}.${targetKey}`,
      candidates: candidates.map((c) => ({ uuid: c.uuid, name: c.name, pack: c.pack, img: c.img, type: c.type })),
      descriptionHtml,
    });
    delete entry[hintKey];
    return;
  }

  if (result.status === "resolved") {
    entry[targetKey] = result.match.uuid;
    report.resolved.push({ context, name: rawName, pack: result.match.pack });
  } else if (result.status === "ambiguous") {
    const packs = [...new Set(result.candidates.map((c) => c.pack))].join(", ");
    pending.push({
      context, name: rawName, reason: `${result.candidates.length} matches (${packs})`,
      path: `${path}.${targetKey}`,
      candidates: result.candidates.map((c) => ({ uuid: c.uuid, name: c.name, pack: c.pack, img: c.img, type: c.type })),
    });
  } else {
    if (autoCreate && descriptionHtml) {
      try {
        const featureData = buildDdbClassFeatureItemData(
          { name: rawName, level: autoCreate.level, descriptionHtml },
          { isLegacy: autoCreate.isLegacy, requirements: autoCreate.requirements },
        );
        featureData.folder = autoCreate.folderId;
        // Same real-DDB-text trust level as importDdbFeat's own fallback
        // (see buildAutoMechanics) — an auto-built class/subclass feature
        // deserves the same AC/resistance/darkvision/speed/save scan a
        // feat already gets, not a permanently blank effects/activities set.
        const { effects, activities, advancement } = buildAutoMechanics(descriptionHtml, index, rawName);
        featureData.effects = effects;
        featureData.system.activities = activities;
        featureData.system.advancement = { ...(featureData.system.advancement ?? {}), ...advancement };
        const created = await Item.create(featureData);
        if (!created) throw new Error("Foundry rejected the auto-built feature's data (check the browser console for a DataModelValidationError).");
        entry[targetKey] = created.uuid;
        report.created.push({ name: created.name, uuid: created.uuid, file: context, via: "ddb-auto" });
        delete entry[hintKey];
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not auto-create feature "${rawName}" — falling back to manual review`, err);
      }
    }
    pending.push({
      context, name: rawName, reason: "no match found",
      path: `${path}.${targetKey}`,
      candidates: [],
      descriptionHtml,
    });
  }
  delete entry[hintKey];
}

// A `{ uuid: "", _poolRestriction: { type, subtype } }` placeholder (see
// ddb-scraper.mjs's CHOICE_FEATURE_POOL_RESTRICTION) means "every
// compendium Feat matching this type+subtype" — an ItemChoice's whole pool
// at once, not a single named lookup, so it can't go through resolveSlot's
// one-field-in, one-uuid-out flow. `applyRulesetPreference` still applies
// per name-group first, so a 2014/2024 same-name duplicate only
// contributes its preferred version to the pool, same as a normal lookup.
function resolvePoolRestriction(index, restriction) {
  const preference = game.settings.get(MODULE_ID, "rulesetPreference");
  const seen = new Set();
  const matches = [];
  for (const candidates of index.values()) {
    for (const c of applyRulesetPreference(candidates, preference)) {
      if (c.type === restriction.type && c.subtype === restriction.subtype && !seen.has(c.uuid)) {
        seen.add(c.uuid);
        matches.push(c);
      }
    }
  }
  return matches;
}

// Walks exactly the two shapes the scraper produces — it does not blindly
// recurse the whole document, so it can't accidentally touch unrelated
// fields. `featuresFolderSegments`, when given (DDB class/subclass imports
// only — see createItemFromData), both enables auto-creation of true misses
// and says where the built items should be filed.
async function resolveItemUuids(data, index, report, pending, featureDetails = [], expectedClass, featuresFolderSegments) {
  const contextBase = data.name ?? "(unnamed item)";

  for (const [i, entry] of (data.system?.startingEquipment ?? []).entries()) {
    await resolveSlot(entry, "_item", index, report, `${contextBase} — starting equipment`, `system.startingEquipment.${i}`, pending, undefined, expectedClass);
  }

  // Read off the parent item's own source rather than threaded as a
  // separate parameter — assembleClassItem/assembleSubclassItem already
  // set this correctly (sourceField(isLegacyClass(...))), and an
  // auto-built feature should always match whatever ruleset its own
  // class/subclass item is.
  const isLegacy = data.system?.source?.rules === "2014";
  const featuresFolderId = featuresFolderSegments ? await resolveFolderPath(featuresFolderSegments) : null;

  for (const [advKey, adv] of Object.entries(data.system?.advancement ?? {})) {
    const label = `${contextBase} — level ${adv.level ?? "?"} (${adv.title || adv.type})`;

    if (adv.type === "ItemChoice") {
      const pool = adv.configuration?.pool;
      const restriction = pool?.length === 1 ? pool[0]._poolRestriction : null;
      if (restriction) {
        const matches = resolvePoolRestriction(index, restriction);
        if (matches.length) {
          adv.configuration.pool = matches.map((m) => ({ uuid: m.uuid }));
          report.resolved.push({ context: label, name: `${adv.title} options`, pack: `${matches.length} feat(s) found` });
        } else {
          adv.configuration.pool = [];
          report.warnings.push({
            context: label,
            reason: `No "${restriction.subtype}" feats found in any compendium — this choice has nothing to pick from yet. Import Feats first, or fill in this advancement's pool by hand on the item sheet.`,
          });
        }
      }
      continue;
    }

    const items = adv.configuration?.items;
    if (!Array.isArray(items)) continue;
    const descByName = new Map(featureDetails.filter((f) => f.level === adv.level).map((f) => [f.name, f.descriptionHtml]));
    const autoCreate = featuresFolderSegments ? {
      folderId: featuresFolderId,
      isLegacy,
      level: adv.level,
      requirements: `${expectedClass ?? contextBase}${adv.level ? ` ${adv.level}` : ""}`,
    } : undefined;
    for (const [i, entry] of items.entries()) {
      await resolveSlot(entry, "_name", index, report, label, `system.advancement.${advKey}.configuration.items.${i}`, pending, descByName, expectedClass, autoCreate);
    }
  }
}

async function createItemFromData(data, label, index, report, via, featureDetails, className, featuresFolderSegments) {
  const pending = [];
  // className doubles as the folder-placement path (e.g. ["Warlock",
  // "Subclass Features"]) and, via its first segment, the base class name
  // to scope ambiguous feature-name lookups against (see lookup's
  // expectedClass) — both a class and a subclass file under their base
  // class's own name. Not a class name for feat/species imports, but a
  // hint that never matches any class folder is simply never used.
  const expectedClass = Array.isArray(className) ? className[0] : className;
  await resolveItemUuids(data, index, report, pending, featureDetails, expectedClass, featuresFolderSegments);
  delete data._id;
  // A subclass's own item goes straight into its class's folder (e.g.
  // "Warlock") — matching the layout of the official class/subclass
  // compendiums — when the source page told us the class name; anything
  // else (a bare class import, or a className-less source) is left
  // unfiled, same as before folders existed here. Accepts either a single
  // folder name or a full segment path (["Feats", "General Feats"]) for
  // callers that need deeper nesting.
  if (className) {
    data.folder = await resolveFolderPath(Array.isArray(className) ? className : [className]);
  } else {
    data.folder = null;
  }
  try {
    const created = await Item.create(data);
    report.created.push({ name: created.name, uuid: created.uuid, file: label, via });
    // Now that the item exists, each pending ambiguous field can be fixed
    // in place by UUID + path — surfaced as a "Choose…" picker in the report.
    for (const p of pending) report.unresolved.push({ ...p, itemUuid: created.uuid });
  } catch (err) {
    report.failed.push({ file: label, reason: err.message ?? String(err) });
  }
}

// Shown only for low-confidence freeform parses. Resolves to the
// user-corrected {name, classIdentifier, featuresByLevel}, or null if they
// chose to skip this one.
function reviewFreeformDialog(result, label) {
  return new Promise((resolve) => {
    const rows = [];
    for (const [level, names] of Object.entries(result.featuresByLevel)) {
      for (const featureName of names) rows.push({ level, featureName });
    }
    if (!rows.length) rows.push({ level: "", featureName: "" });

    const rowHtml = ({ level, featureName }) => `
      <div class="wikidot-ff-row" style="display:flex; gap:4px; margin-bottom:4px;">
        <input type="number" class="ff-level" value="${level}" style="width:60px;" placeholder="Lvl">
        <input type="text" class="ff-name" value="${featureName}" style="flex:1;" placeholder="Feature name">
        <button type="button" class="ff-remove-row">✕</button>
      </div>`;

    const content = `
      <p>Only ${result.confidence} "Nth Level:" heading(s) found in <strong>${label}</strong> — low confidence
      this parsed correctly. Review and fix before importing.</p>
      <form>
        <div class="form-group">
          <label>Subclass name</label>
          <input type="text" name="name" value="${result.name ?? ""}" style="width:100%;">
        </div>
        <div class="form-group">
          <label>Class identifier (e.g. "paladin")</label>
          <input type="text" name="classIdentifier" value="${result.classIdentifier ?? ""}" style="width:100%;">
        </div>
        <div class="form-group">
          <label>Level → Feature</label>
          <div class="wikidot-ff-rows">${rows.map(rowHtml).join("")}</div>
          <button type="button" class="ff-add-row">+ Add row</button>
        </div>
      </form>
    `;

    new Dialog({
      title: "Review low-confidence import",
      content,
      render: (html) => {
        html.find(".ff-add-row").on("click", () => html.find(".wikidot-ff-rows").append(rowHtml({ level: "", featureName: "" })));
        html.on("click", ".ff-remove-row", (ev) => $(ev.currentTarget).closest(".wikidot-ff-row").remove());
      },
      buttons: {
        ok: {
          label: "Import",
          callback: (html) => {
            const name = html.find("[name=name]").val().trim();
            const classIdentifier = html.find("[name=classIdentifier]").val().trim() || null;
            const featuresByLevel = {};
            html.find(".wikidot-ff-row").each((_, rowEl) => {
              const $row = $(rowEl);
              const level = parseInt($row.find(".ff-level").val(), 10);
              const featureName = $row.find(".ff-name").val().trim();
              if (!Number.isNaN(level) && featureName) (featuresByLevel[level] ??= []).push(featureName);
            });
            resolve({ name, classIdentifier, featuresByLevel });
          },
        },
        cancel: { label: "Skip this one", callback: () => resolve(null) },
      },
      default: "ok",
    }).render(true);
  });
}

// Unlike a wikidot-derived feature (which already exists somewhere in the
// official compendium and just needs its UUID looked up by name), a
// freeform-derived one is original to the source doc — there's nothing to
// look up. So instead of a FIXME placeholder, build a real Feature item
// from the prose the parser captured. Shape verified against a real
// shipped subclass feature (dnd5e's own Disciple of Life source file):
// type "feat" with system.type.value "class" is what both class *and*
// subclass features use, there's no separate subclass subtype.
function buildFeatureItemData({ name, level, descriptionHtml }, subclassName) {
  return {
    name,
    type: "feat",
    folder: null,
    img: "icons/svg/book.svg",
    system: {
      description: { value: descriptionHtml, chat: "" },
      source: { custom: "Homebrew", rules: "", revision: 1, license: "", book: "" },
      type: { value: "class", subtype: "" },
      identifier: slugify(name),
      requirements: subclassName,
      prerequisites: { level, repeatable: false },
      properties: [],
      uses: { max: "", spent: 0, recovery: [] },
      activities: {},
      enchant: {},
    },
    effects: [],
    flags: {},
    _stats: {
      duplicateSource: null, coreVersion: null, systemId: "dnd5e", systemVersion: null,
      createdTime: null, modifiedTime: null, lastModifiedBy: null, compendiumSource: null,
    },
    ownership: { default: 0 },
  };
}

async function handleFreeformResult(result, label, index, report, via) {
  let { name, classIdentifier, featuresByLevel } = result;
  let usedVia = via;

  if (result.confidence < FREEFORM_CONFIDENCE_THRESHOLD) {
    const edited = await reviewFreeformDialog(result, label);
    if (!edited) {
      report.failed.push({ file: label, reason: "Skipped during low-confidence review." });
      return;
    }
    ({ name, classIdentifier, featuresByLevel } = edited);
    usedVia = `${via}+reviewed`;
  }

  // Same class/subclass-features folder layout as the wikidot path — filed
  // under the class name the parser found in the doc's own tagline (e.g.
  // "A Warlock Subclass"), not the review dialog's edited fields (those
  // only cover name/classIdentifier/featuresByLevel, not this).
  const featuresFolder = result.className ? await resolveFolderPath([result.className, "Subclass Features"]) : null;

  // Only features that survived into the final level→feature list (i.e.
  // weren't renamed/added during review) and that the parser actually
  // captured prose for get a real generated Item; anything else falls back
  // to the normal name-lookup/FIXME path, same as a wikidot-derived one.
  const descByKey = new Map(result.featureDetails.map((f) => [`${f.level}|${f.name}`, f.descriptionHtml]));
  const featuresByLevelResolved = {};
  for (const [level, names] of Object.entries(featuresByLevel)) {
    featuresByLevelResolved[level] = [];
    for (const featureName of names) {
      const descriptionHtml = descByKey.get(`${level}|${featureName}`);
      if (descriptionHtml) {
        try {
          const featureData = buildFeatureItemData({ name: featureName, level: parseInt(level, 10), descriptionHtml }, name);
          featureData.folder = featuresFolder;
          const created = await Item.create(featureData);
          report.created.push({ name: created.name, uuid: created.uuid, file: `${label} (generated feature)`, via: "freeform-generated" });
          featuresByLevelResolved[level].push({ name: featureName, uuid: created.uuid });
          continue;
        } catch (err) {
          report.failed.push({ file: `${label} — ${featureName}`, reason: err.message ?? String(err) });
        }
      }
      featuresByLevelResolved[level].push(featureName);
    }
  }

  const { item } = assembleSubclassItem({
    name, classIdentifier, featuresByLevel: featuresByLevelResolved,
    spellGrants: result.spellGrants, scaleColumns: result.scaleColumns, descriptionHtml: result.descriptionHtml,
  });
  await createItemFromData(item, label, index, report, usedVia, undefined, result.className);
}

async function importFile(file, index, report) {
  const isHtml = /\.html?$/i.test(file);
  const label = file.split("/").pop();
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!isHtml) return await createItemFromData(await res.json(), label, index, report, "folder");

    const raw = await res.text();
    if (isWikidotPage(raw)) {
      const scraped = scrapeWikidotHtml(raw);
      await createItemFromData(scraped.item, label, index, report, "folder", scraped.featureDetails, scraped.className);
    } else {
      await handleFreeformResult(scrapeFreeformSubclass(raw, label), label, index, report, "folder");
    }
  } catch (err) {
    report.failed.push({ file, reason: err.message ?? String(err) });
  }
}

async function importFetchedPage(html, url, index, report, via) {
  try {
    if (isWikidotPage(html)) {
      const scraped = scrapeWikidotHtml(html);
      await createItemFromData(scraped.item, url, index, report, via, scraped.featureDetails, scraped.className);
    } else {
      await handleFreeformResult(scrapeFreeformSubclass(html, url), url, index, report, via);
    }
  } catch (err) {
    report.failed.push({ file: url, reason: err.message ?? String(err) });
  }
}

const PROBLEM_DIALOG_STYLES = `
  <style>
    .wikidot-problem-row { border-bottom: 1px solid var(--color-border-light-tertiary, #999); padding: 8px 0; }
    .wikidot-problem-row.wikidot-problem-resolved { opacity: 0.6; }
    .wikidot-problem-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .wikidot-problem-header em { color: var(--color-text-dark-secondary, #666); font-size: 0.9em; }
    .wikidot-badge { font-size: 0.75em; padding: 1px 6px; border-radius: 3px; color: #fff; white-space: nowrap; }
    .wikidot-badge-ambiguous { background: #b5762a; }
    .wikidot-badge-none { background: #a33; }
    .wikidot-badge-resolved { background: #2a7d3f; padding: 2px 8px; }
    .wikidot-candidate { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 3px; }
    .wikidot-candidate:hover { background: rgba(127,127,127,0.15); }
    .wikidot-candidate img { border: none; flex: 0 0 auto; }
    .wikidot-candidate-info { flex: 1; min-width: 0; }
    .wikidot-candidate-name { font-weight: bold; }
    .wikidot-candidate-meta { font-size: 0.85em; color: var(--color-text-dark-secondary, #666); }
    .wikidot-candidate-detail-panel { margin: 2px 0 6px 42px; padding: 4px 8px; border-left: 2px solid #999; font-size: 0.9em; max-height: 200px; overflow-y: auto; }
    .wikidot-search-input { width: 100%; margin-bottom: 4px; }
    .wikidot-create-feature-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--color-border-light-tertiary, #999); }
    .wikidot-create-feature-row em { font-size: 0.85em; color: var(--color-text-dark-secondary, #666); }
  </style>
`;

function candidateCardHtml(c) {
  return `
    <div class="wikidot-candidate">
      <img src="${c.img || "icons/svg/mystery-man.svg"}" width="28" height="28">
      <div class="wikidot-candidate-info">
        <div class="wikidot-candidate-name">${c.name}</div>
        <div class="wikidot-candidate-meta">${c.pack}${c.type ? ` · ${c.type}` : ""}</div>
      </div>
      <button type="button" class="wikidot-candidate-details" data-uuid="${c.uuid}">Details</button>
      <button type="button" class="wikidot-candidate-use" data-uuid="${c.uuid}">Use this</button>
    </div>
    <div class="wikidot-candidate-detail-panel" data-uuid="${c.uuid}" style="display:none;"></div>
  `;
}

async function applyResolution(entry, uuid, chosenName, rowEl) {
  try {
    const doc = await fromUuid(entry.itemUuid);
    if (!doc) throw new Error("Created item no longer exists");
    await doc.update({ [entry.path]: uuid });
    rowEl.addClass("wikidot-problem-resolved");
    rowEl.find(".wikidot-problem-candidates").html(
      `<span class="wikidot-badge wikidot-badge-resolved">✓ Resolved to ${chosenName ?? uuid}</span>`
    );
  } catch (err) {
    ui.notifications.error(`Could not apply choice for "${entry.name}": ${err.message ?? err}`);
  }
}

// The dedicated review screen for report.unresolved — every row is either
// "ambiguous" (multiple same-named compendium items to pick between, shown
// with icon/type so near-duplicates across packs are easy to tell apart) or
// "no match found" (nothing indexed under that name, so a live search box
// over the same compendium index stands in for a fixed candidate list).
function showProblemImportsDialog(report, index) {
  const rowHtml = (entry, i) => `
    <div class="wikidot-problem-row" data-problem-index="${i}">
      <div class="wikidot-problem-header">
        ${entry.candidates.length
          ? `<span class="wikidot-badge wikidot-badge-ambiguous">${entry.candidates.length} match${entry.candidates.length === 1 ? "" : "es"}</span>`
          : `<span class="wikidot-badge wikidot-badge-none">No match</span>`}
        <strong>${entry.name}</strong>
        <em>${entry.context}</em>
      </div>
      <div class="wikidot-problem-candidates">
        ${entry.candidates.length ? entry.candidates.map(candidateCardHtml).join("") : ""}
        ${entry.candidates.length && entry.descriptionHtml
          ? `<p><em>None of these are confirmed to belong to this class/subclass — they just share the name. Consider creating a new item from the source's own text below instead.</em></p>`
          : ""}
        ${entry.candidates.length ? "" : `
             <input type="text" class="wikidot-search-input" value="${entry.name}" placeholder="Search compendiums for a match…">
             <div class="wikidot-search-results"></div>`}
        ${!entry.candidates.length || entry.descriptionHtml
          ? `<div class="wikidot-create-feature-row">
               <button type="button" class="wikidot-create-feature">+ Create new Feature item</button>
               <em>${entry.descriptionHtml
                 ? "uses the description text scraped from the source page"
                 : "no description text was found on the page — edit it after creating"}</em>
             </div>`
          : ""}
      </div>
    </div>
  `;

  const content = `
    ${PROBLEM_DIALOG_STYLES}
    <div class="wikidot-problem-list" style="max-height:65vh; overflow-y:auto;">
      ${report.unresolved.length ? report.unresolved.map(rowHtml).join("") : "<p>Nothing left to fix.</p>"}
    </div>
  `;

  new Dialog(
    {
      title: `Fix Problem Imports (${report.unresolved.length})`,
      content,
      buttons: { close: { label: "Close" } },
      render: (html) => {
        html.on("click", ".wikidot-candidate-details", async (ev) => {
          const uuid = $(ev.currentTarget).data("uuid");
          const panel = $(ev.currentTarget).closest(".wikidot-candidate").next(".wikidot-candidate-detail-panel");
          if (panel.is(":visible")) return panel.slideUp(100);
          if (!panel.data("loaded")) {
            panel.show().html("Loading…");
            const doc = await fromUuid(uuid);
            const desc = doc?.system?.description?.value || "<em>No description available.</em>";
            panel.data("loaded", true).html(desc);
          } else {
            panel.slideDown(100);
          }
        });

        html.on("click", ".wikidot-candidate-use", async (ev) => {
          const rowEl = $(ev.currentTarget).closest(".wikidot-problem-row");
          const idx = Number(rowEl.data("problem-index"));
          const uuid = $(ev.currentTarget).data("uuid");
          const chosenName = $(ev.currentTarget).closest(".wikidot-candidate").find(".wikidot-candidate-name").text();
          await applyResolution(report.unresolved[idx], uuid, chosenName, rowEl);
        });

        html.on("click", ".wikidot-create-feature", async (ev) => {
          const rowEl = $(ev.currentTarget).closest(".wikidot-problem-row");
          const idx = Number(rowEl.data("problem-index"));
          const entry = report.unresolved[idx];
          const chosenName = (rowEl.find(".wikidot-search-input").val() || entry.name || "").trim();
          if (!chosenName) return ui.notifications.warn("Enter a name for the new feature first.");
          try {
            const parentDoc = await fromUuid(entry.itemUuid);
            if (!parentDoc) throw new Error("Created item no longer exists");
            const advId = entry.path.match(/^system\.advancement\.([^.]+)\./)?.[1];
            const level = advId ? (parentDoc.system.advancement[advId]?.level ?? 0) : 0;

            const built = await showBuildFeatureDialog({ name: chosenName, index, descriptionHtml: entry.descriptionHtml || "" });
            if (built === null) return; // cancelled from the effects/activities step

            const data = buildFeatureItemData({ name: chosenName, level, descriptionHtml: entry.descriptionHtml || "" }, parentDoc.name);
            if (built.effects.length) data.effects = built.effects;
            if (Object.keys(built.activities).length) data.system.activities = built.activities;
            // File alongside the parent subclass (already placed in its
            // class's folder when it was created) rather than re-deriving
            // the class name here — a "Subclass Features" sibling folder
            // next to wherever the subclass itself actually landed.
            data.folder = parentDoc.folder ? await resolveFolderPath([parentDoc.folder.name, "Subclass Features"]) : null;

            const created = await Item.create(data);
            // Foundry can reject a document's data (e.g. a malformed
            // attached Activity) without the create() promise itself
            // rejecting — it logs a DataModelValidationError via its own
            // error hook and resolves with nothing instead. Surface that
            // clearly rather than crashing on created.name below.
            if (!created) throw new Error("Foundry rejected the item's data (check the browser console for a DataModelValidationError — likely from an attached effect or activity).");
            report.created.push({ name: created.name, uuid: created.uuid, file: entry.context, via: "created-on-review" });
            await applyResolution(entry, created.uuid, created.name, rowEl);
          } catch (err) {
            ui.notifications.error(`Could not create feature "${entry.name}": ${err.message ?? err}`);
          }
        });

        html.on("input", ".wikidot-search-input", (ev) => {
          const input = $(ev.currentTarget);
          const resultsEl = input.siblings(".wikidot-search-results");
          const preference = game.settings.get(MODULE_ID, "rulesetPreference");
          const matches = searchIndex(index, input.val(), 15, preference);
          resultsEl.html(matches.length ? matches.map(candidateCardHtml).join("") : "<p><em>No matches.</em></p>");
        });
        html.find(".wikidot-search-input").trigger("input");
      },
    },
    { width: 640, resizable: true }
  ).render(true);
}

function showReport(report, index) {
  const section = (title, rows) =>
    rows.length ? `<h3>${title} (${rows.length})</h3><ul>${rows.map((r) => `<li>${r}</li>`).join("")}</ul>` : "";

  const content = `
    <div style="max-height:60vh; overflow-y:auto;">
      ${section("Created", report.created.map((c) => `<strong>${c.name}</strong> — <code>${c.uuid}</code> (${c.file}${c.via ? `, via ${c.via}` : ""})`))}
      ${section("Resolved UUIDs", report.resolved.map((r) => `${r.name} → ${r.pack}`))}
      ${report.unresolved.length
        ? `<h3>Problem Imports (${report.unresolved.length})</h3>
           <p>${report.unresolved.length} field(s) need a manual match — ambiguous names or no compendium match found.</p>
           <button type="button" class="wikidot-review-problems">Review &amp; Fix…</button>`
        : ""}
      ${section(
        "Couldn't fetch at all (CORS blocked it, and the local proxy wasn't reachable) — save these pages locally and re-run",
        report.manualSaveNeeded.map((u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      )}
      ${section("Needs attention", (report.warnings ?? []).map((w) => `<em>${w.context}</em> — ${w.reason}`))}
      ${section("Failed to import", report.failed.map((f) => `${f.file} — ${f.reason}`))}
    </div>
  `;

  new Dialog({
    title: "Brewporter Import Report",
    content,
    buttons: { ok: { label: "Close" } },
    render: (html) => {
      html.on("click", ".wikidot-review-problems", () => showProblemImportsDialog(report, index));
    },
  }, { width: 520, resizable: true }).render(true);

  console.log(`${MODULE_ID} | Import report`, report);
}

// ---- D&D Beyond import -------------------------------------------------
//
// Unlike the wikidot/freeform paths, DDB gives us structured JSON directly
// — no name-lookup FIXME placeholders needed for a species' own traits,
// since createItemFromData's resolveItemUuids only acts on entries with an
// unresolved _name/_item hint, which these never have. Race traits are
// still created feature-by-feature first (mirroring handleFreeformResult's
// generated-feature loop) so their real UUIDs exist before the race item's
// ItemGrant advancement is assembled.

async function ensureDdbAuth() {
  const cobalt = game.settings.get(MODULE_ID, "ddbCobaltSession");
  if (!cobalt) {
    throw new Error('No CobaltSession configured — set "D&D Beyond CobaltSession token" in this module\'s settings first.');
  }
  const result = await sendDdbAuth(cobalt);
  if (!result.success) throw new Error(`D&D Beyond auth failed: ${result.message ?? "unknown error"}`);
}

// Overwrites `item`'s effects/system.activities/system.advancement in place
// with fresh copies (new `_id`s per entry, so cloning the same source twice
// never collides) of a real compendium item's own data, plus its img unless
// that's still the generic placeholder. Shared by copyOfficialFeatMechanics
// and copyOfficialRaceTraitMechanics below — both trust an official dnd5e
// compendium item's real, hand-authored mechanics over a prose-guessed
// approximation once a name (and, for a race trait, species) match is found.
function copyMechanicsFrom(item, source) {
  item.effects = (source.effects ?? []).map((e) => ({ ...e, _id: randomId() }));
  item.system.activities = Object.fromEntries(
    Object.values(source.system?.activities ?? {}).map((a) => { const id = randomId(); return [id, { ...a, _id: id }]; })
  );
  item.system.advancement = Object.fromEntries(
    Object.values(source.system?.advancement ?? {}).map((a) => { const id = randomId(); return [id, { ...a, _id: id }]; })
  );
  if (source.img && source.img !== "icons/svg/upgrade.svg") item.img = source.img;
}

// D&D Beyond's own feat text is real, but the *mechanics* behind it are
// frequently things no amount of prose-scanning recovers correctly — Alert's
// initiative bonus is a bespoke `flags.dnd5e.initiativeAlert` change with no
// wording in the feat text to hang a detector off of, Skilled's "any
// combination of three skills or tools" needs a Trait advancement (not a
// guessed activity), Magic Initiate's two-tier spell choice needs two
// correctly-configured ItemChoice entries. dnd5e's own shipped feats24 pack
// (the "D&D Modern Content" compendium folder) already has every core-book
// 2024 feat built exactly right by hand — reusing that beats re-deriving it
// from scratch whenever the name matches unambiguously. Returns true (and
// overwrites `item`'s effects/activities/advancement in place) when a match
// was copied; false when there's nothing to copy from, so the caller knows
// to fall back to the prose-based guess.
async function copyOfficialFeatMechanics(item, index, report) {
  const match = lookup(index, item.name);
  if (match.status !== "resolved" || match.match.type !== "feat") return false;

  const source = (await fromUuid(match.match.uuid))?.toObject();
  if (!source) return false;

  copyMechanicsFrom(item, source);
  report.resolved.push({ context: item.name, name: "activities/effects/advancement", pack: `copied from ${match.match.pack}` });
  return true;
}

// The race-trait equivalent of copyOfficialFeatMechanics, guarded by the
// stricter species-scoped match findRaceTraitMatch implements (a plain
// name-only lookup, safe for feats, would silently copy the wrong species'
// data here — see findRaceTraitMatch's own comment). `item` is the trait's
// own about-to-be-created Feature data (assembleRaceTraitItem's output);
// `raceDef` is the DDB species definition it belongs to, used only for its
// `fullName`. Returns true (and overwrites item's mechanics in place) when a
// same-species official trait was found and copied; false when there's
// nothing to copy from, so the caller falls back to the prose-based guess —
// same "copied ?? fall back" shape importDdbFeat already uses.
async function copyOfficialRaceTraitMechanics(item, raceDef, index, report) {
  const candidates = index.get(normalizeName(item.name));
  const preference = game.settings.get(MODULE_ID, "rulesetPreference");
  const match = findRaceTraitMatch(candidates, raceDef, preference);
  if (!match) return false;

  const source = (await fromUuid(match.uuid))?.toObject();
  if (!source) return false;

  copyMechanicsFrom(item, source);
  report.resolved.push({ context: item.name, name: "activities/effects/advancement", pack: `copied from ${match.pack}` });
  return true;
}

async function importDdbFeat(featDef, index, report) {
  try {
    const item = assembleFeatItem(featDef);
    const copied = await copyOfficialFeatMechanics(item, index, report);
    if (!copied) {
      // No official item to copy from (homebrew, or a sourcebook feat
      // Foundry's free SRD packs don't ship) — fall back to scanning D&D
      // Beyond's own description text. See buildAutoMechanics for why this
      // is safe to apply without a review step (real DDB text, same trust
      // level as an auto-built class feature), and why unmatched named
      // sub-options are dropped rather than kept as blank stubs here.
      const { effects, activities, advancement } = buildAutoMechanics(item.system.description.value, index, item.name);
      item.effects = effects;
      item.system.activities = activities;
      item.system.advancement = { ...item.system.advancement, ...advancement };
    }
    await createItemFromData(item, featDef.name, index, report, "ddb", undefined, featFolderSegments(featDef));
  } catch (err) {
    report.failed.push({ file: featDef.name, reason: err.message ?? String(err) });
  }
}

async function importDdbClass(classDef, index, report) {
  try {
    const { item, featureDetails } = assembleClassItem(classDef);
    // A sibling "Class Features" folder for anything auto-built from a
    // true miss (see resolveItemUuids) — parallel to subclasses' own
    // "Subclass Features" convention below, not the class item's own
    // folder (classFolderSegments), so built features don't clutter the
    // top level next to the class item itself.
    const featuresFolder = [...classFolderSegments(classDef), "Class Features"];
    await createItemFromData(item, classDef.name, index, report, "ddb", featureDetails, classFolderSegments(classDef), featuresFolder);
  } catch (err) {
    report.failed.push({ file: classDef.name, reason: err.message ?? String(err) });
  }
}

async function importDdbRace(raceDef, index, report) {
  try {
    const traits = usableRacialTraits(raceDef);
    // Issue 022: flag same-identifier/near-identical-name trait collisions
    // (legacy-vs-current duplicates DDB sometimes ships in one species'
    // racialTraits) for human review — this never drops or merges a trait,
    // both items below still get created exactly as before.
    for (const warning of findDuplicateTraitNameWarnings(traits, raceDef.fullName)) {
      report.warnings.push(warning);
    }
    const traitsFolder = await resolveFolderPath(raceTraitFolderSegments(raceDef));
    const traitsByLevel = {};
    const traitDescriptions = [];
    for (const trait of traits) {
      const data = assembleRaceTraitItem(trait, raceDef);
      data.folder = traitsFolder;
      traitDescriptions.push(trait.description);
      // Prefer copying a same-species official trait's real, hand-authored
      // mechanics (dnd5e's free origins24 pack ships every core PHB 2024
      // species' traits already correctly built — see
      // copyOfficialRaceTraitMechanics) over guessing from prose. Only when
      // there's nothing to copy from (homebrew/expanded species, or a
      // core-species trait the free pack doesn't ship) does this fall back
      // to the same real-D&D-Beyond-text scan a feat's description already
      // gets — same trust level, same "copied ?? fall back" shape
      // importDdbFeat uses.
      const copied = await copyOfficialRaceTraitMechanics(data, raceDef, index, report);
      if (!copied) {
        const { effects, activities, advancement } = buildAutoMechanics(data.system.description.value, index, data.name);
        data.effects = effects;
        data.system.activities = activities;
        data.system.advancement = { ...(data.system.advancement ?? {}), ...advancement };
      }
      const created = await Item.create(data);
      if (!created) throw new Error(`Foundry rejected trait "${trait.name}"'s data (check the browser console for a DataModelValidationError).`);
      report.created.push({ name: created.name, uuid: created.uuid, file: `${raceDef.fullName} (trait)`, via: "ddb" });
      const level = trait.requiredLevel ?? 0;
      (traitsByLevel[level] ??= []).push({ name: created.name, uuid: created.uuid });
    }
    const sizeResult = buildSizeAdvancement(raceDef);
    if (sizeResult.warning) report.warnings.push({ context: raceDef.fullName, reason: sizeResult.warning });
    const movement = mergeTraitDerivedMovement(raceDef.weightSpeeds?.normal, traitDescriptions);
    await createItemFromData(
      assembleRaceItem(raceDef, traitsByLevel, { sizeAdvancement: sizeResult.advancement, movement }),
      raceDef.fullName, index, report, "ddb", undefined, raceFolderSegments(),
    );
  } catch (err) {
    report.failed.push({ file: raceDef.fullName, reason: err.message ?? String(err) });
  }
}

async function importDdbBackground(backgroundDef, index, report) {
  try {
    // Only a 2014-ruleset background (featureIsFeat: false) has a bespoke
    // feature to build — a 2024 background's origin feat is real catalog
    // content instead, resolved by FIXME name-lookup inside
    // assembleBackgroundItem/createItemFromData like any other DDB feature
    // reference (see ddb-scraper.mjs's buildBackgroundAdvancement).
    let featureUuid;
    if (!backgroundDef.featureIsFeat && backgroundDef.featureName) {
      const data = assembleBackgroundFeatureItem(backgroundDef);
      data.folder = await resolveFolderPath(backgroundFeatureFolderSegments());
      // Same real-DDB-text trust level as a feat/race trait — see
      // buildAutoMechanics.
      const { effects, activities, advancement } = buildAutoMechanics(data.system.description.value, index, data.name);
      data.effects = effects;
      data.system.activities = activities;
      data.system.advancement = { ...(data.system.advancement ?? {}), ...advancement };
      const created = await Item.create(data);
      if (!created) throw new Error(`Foundry rejected the background feature "${backgroundDef.featureName}"'s data (check the browser console for a DataModelValidationError).`);
      report.created.push({ name: created.name, uuid: created.uuid, file: `${backgroundDef.name} (feature)`, via: "ddb" });
      featureUuid = created.uuid;
    }
    const item = assembleBackgroundItem(backgroundDef, featureUuid);
    await createItemFromData(item, backgroundDef.name, index, report, "ddb", undefined, backgroundFolderSegments());
  } catch (err) {
    report.failed.push({ file: backgroundDef.name, reason: err.message ?? String(err) });
  }
}

async function importDdbSubclass({ subclassDef, parentClassDef }, index, report) {
  try {
    const { item, featureDetails } = assembleDdbSubclassItem(subclassDef, parentClassDef);
    // subclassFolderSegments already ends in "Subclass Features" (matching
    // the manual review dialog's own convention for a created-on-review
    // subclass feature) — reused as-is rather than nesting another
    // subfolder under it.
    const featuresFolder = subclassFolderSegments(parentClassDef);
    await createItemFromData(item, subclassDef.name, index, report, "ddb", featureDetails, featuresFolder, featuresFolder);
  } catch (err) {
    report.failed.push({ file: subclassDef.name, reason: err.message ?? String(err) });
  }
}

// No bulk "all subclasses" endpoint exists (see ddb-scraper.mjs) — this
// fetches every base class first, then makes one subclasses call per
// class id, pairing each result with the parent class assembleSubclassItem
// needs to diff out inherited features. N+1 calls, but classes/subclasses
// only needs to run occasionally, not per-character.
async function fetchAllDdbSubclassPairs() {
  const classes = await fetchDdbGameData("classes");
  const pairs = [];
  for (const parentClassDef of classes) {
    const subclasses = await fetchDdbGameData("subclasses", { baseClassId: parentClassDef.id });
    for (const subclassDef of subclasses) pairs.push({ subclassDef, parentClassDef });
  }
  return pairs;
}

async function startDdbImport(kind) {
  if (!game.user.isGM) {
    ui.notifications.error("Only a GM can import items.");
    return;
  }

  const infoDialog = (content) => new Dialog({ title: "Brewporter Import", content, buttons: { ok: { label: "Close" } } }).render(true);

  try {
    await ensureDdbAuth();
  } catch (err) {
    infoDialog(`<p>${err.message}</p>`);
    return;
  }

  const DDB_KIND_CONFIG = {
    feats: { type: "feats", label: "feat" },
    species: { type: "races", label: "species" },
    classes: { type: "classes", label: "class" },
    subclasses: { label: "subclass" }, // fetched separately below — no single game-data type
    backgrounds: { type: "backgrounds", label: "background" },
  };
  const { label } = DDB_KIND_CONFIG[kind];

  let items;
  try {
    if (kind === "subclasses") {
      // One request per base class (no bulk endpoint exists) — noticeably
      // slower than the other imports, so say so up front rather than
      // leaving the dialog looking stuck.
      ui.notifications.info("Brewporter | Fetching subclasses (one request per class — this takes longer than the other imports)...");
      items = await fetchAllDdbSubclassPairs();
    } else {
      items = await fetchDdbGameData(DDB_KIND_CONFIG[kind].type);
    }
  } catch (err) {
    infoDialog(`<p>${err.message}</p>`);
    return;
  }

  const proceed = await Dialog.confirm({
    title: "Brewporter Import",
    content: `<p>Ready to import ${items.length} ${label}${items.length === 1 ? "" : "s"} available on your D&D Beyond account.</p>`,
  });
  if (!proceed) return;

  ui.notifications.info("Brewporter | Indexing compendiums...");
  const index = await buildNameIndex();
  const report = { created: [], failed: [], resolved: [], unresolved: [], warnings: [], manualSaveNeeded: [] };

  for (const item of items) {
    if (kind === "feats") await importDdbFeat(item, index, report);
    else if (kind === "classes") await importDdbClass(item, index, report);
    else if (kind === "subclasses") await importDdbSubclass(item, index, report);
    else if (kind === "backgrounds") await importDdbBackground(item, index, report);
    else await importDdbRace(item, index, report);
  }

  showReport(report, index);
}

async function checkProxyHealth() {
  try {
    const res = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Tiered: direct fetch first (works if a source ever adds permissive CORS),
// then the local proxy (bypasses CORS entirely via a server-side fetch —
// see proxy/wikidot-proxy.mjs), then give up. `via` records which path
// actually worked, surfaced in the report so it's clear whether the proxy
// is doing anything.
async function fetchWithFallback(line) {
  const url = resolveSourceUrl(line);

  try {
    const res = await fetch(url);
    if (res.ok) return { url, html: await res.text(), ok: true, via: "direct" };
  } catch { /* expected when CORS blocks it — fall through */ }

  try {
    const res = await fetch(`${PROXY_URL}/fetch?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return { url, html: await res.text(), ok: true, via: "proxy" };
  } catch { /* proxy not running/reachable — fall through */ }

  return {
    url, ok: false,
    reason: `Blocked by CORS, and the local proxy isn't running (start it with "node proxy/wikidot-proxy.mjs"). Until then, save the page yourself (Ctrl+S → "Webpage, HTML only") into your import folder.`,
  };
}

async function startImport(urlsText, folderPath) {
  if (!game.user.isGM) {
    ui.notifications.error("Only a GM can import items.");
    return;
  }

  const urlLines = urlsText.split("\n").map((s) => s.trim()).filter(Boolean);
  const fetchResults = await Promise.all(urlLines.map(fetchWithFallback));
  const fetchedOk = fetchResults.filter((r) => r.ok);
  const fetchFailed = fetchResults.filter((r) => !r.ok);

  let files = [];
  if (folderPath) {
    try {
      const listing = await FilePicker.browse("data", folderPath);
      files = listing.files.filter((f) => /\.(json|html?)$/i.test(f));
    } catch (err) {
      ui.notifications.warn(`Could not browse "${folderPath}": ${err.message ?? err}`);
    }
  }

  if (!fetchedOk.length && !files.length) {
    const onlyFailures = fetchFailed.length
      ? `<p>All ${fetchFailed.length} URL(s) failed to fetch directly (see below) and no files were found in the folder.</p>
         <ul>${fetchFailed.map((r) => `<li>${r.url} — ${r.reason}</li>`).join("")}</ul>
         <p>Save those pages locally (Ctrl+S → "Webpage, HTML only") into your import folder, then re-run.</p>`
      : "<p>Nothing to import — no URLs given and no .json/.html files found in the folder.</p>";
    new Dialog({ title: "Brewporter Import", content: onlyFailures, buttons: { ok: { label: "Close" } } }).render(true);
    return;
  }

  const readyRows = [
    ...fetchedOk.map((r) => `<li>${r.url} <em>(fetched via ${r.via})</em></li>`),
    ...files.map((f) => `<li>${f.split("/").pop()}</li>`),
  ];
  const failedRows = fetchFailed.map((r) => `<li>${r.url} — ${r.reason}</li>`);

  const proceed = await Dialog.confirm({
    title: "Brewporter Import",
    content: `
      <p>Ready to import ${readyRows.length} item(s):</p>
      <ul>${readyRows.join("")}</ul>
      ${failedRows.length ? `<p><strong>Could not fetch directly (will be listed in the report so you can save + retry):</strong></p><ul>${failedRows.join("")}</ul>` : ""}
      <p>Compendium UUIDs will be resolved by name before anything is created.</p>
    `,
  });
  if (!proceed) return;

  ui.notifications.info("Brewporter | Indexing compendiums...");
  const index = await buildNameIndex();

  const report = { created: [], failed: [], resolved: [], unresolved: [], warnings: [], manualSaveNeeded: fetchFailed.map((r) => r.url) };
  for (const r of fetchedOk) await importFetchedPage(r.html, r.url, index, report, r.via);
  for (const file of files) await importFile(file, index, report);

  showReport(report, index);
}

export async function runImport() {
  const defaultFolder = game.settings.get(MODULE_ID, "importFolder");

  const content = `
    <form>
      <p class="wikidot-proxy-status" style="margin:0 0 8px;">⏳ Checking local proxy… <a class="wikidot-proxy-recheck" style="display:none;">(recheck)</a></p>
      <div class="form-group">
        <label>URLs or slugs — wikidot, Google Docs, or other pages (one per line, optional)</label>
        <textarea name="urls" rows="4" style="width:100%;" placeholder="cleric&#10;cleric:life-domain&#10;http://dnd2024.wikidot.com/fighter:main&#10;https://docs.google.com/document/d/.../edit"></textarea>
        <p class="hint">Direct fetch is blocked by CORS on most sites — the local proxy (if running) routes around that automatically. Otherwise, the report will tell you which URLs to save locally.</p>
      </div>
      <div class="form-group">
        <label>Import folder (saved .html pages and/or pre-scraped .json)</label>
        <div style="display:flex; gap:4px;">
          <input type="text" name="folder" value="${defaultFolder}" style="flex:1;">
          <button type="button" class="wikidot-browse-folder">Browse</button>
        </div>
      </div>
      <div class="form-group">
        <label>D&amp;D Beyond (your account's content)</label>
        <p class="ddb-cobalt-status hint" style="margin:0 0 4px;"></p>
        <div style="display:flex; gap:4px;">
          <button type="button" class="ddb-import-species">Import All Species</button>
          <button type="button" class="ddb-import-feats">Import All Feats</button>
          <button type="button" class="ddb-import-classes">Import All Classes</button>
          <button type="button" class="ddb-import-subclasses">Import All Subclasses</button>
          <button type="button" class="ddb-import-backgrounds">Import All Backgrounds</button>
        </div>
      </div>
    </form>
  `;

  new Dialog({
    title: "D&D Brewporter Importer",
    content,
    render: (html) => {
      const refreshProxyStatus = () => {
        html.find(".wikidot-proxy-status").html(
          `⏳ Checking local proxy… <a class="wikidot-proxy-recheck" style="display:none;">(recheck)</a>`
        );
        checkProxyHealth().then((up) => {
          html.find(".wikidot-proxy-status").html(
            up
              ? `🟢 Local proxy running — direct-fetch-blocked pages will import automatically. <a class="wikidot-proxy-recheck">(recheck)</a>`
              : `⚪ Local proxy not detected at ${PROXY_URL} — pages CORS blocks will need manual save-and-browse instead. Start it with <code>node proxy/wikidot-proxy.mjs</code>, then <a class="wikidot-proxy-recheck">recheck</a>.`
          );
          html.find(".wikidot-proxy-recheck").on("click", refreshProxyStatus);
        });
      };
      refreshProxyStatus();
      html.find(".wikidot-browse-folder").on("click", () => {
        new FilePicker({
          type: "folder",
          current: html.find("[name=folder]").val(),
          callback: (path) => html.find("[name=folder]").val(path),
        }).render(true);
      });

      const cobaltConfigured = !!game.settings.get(MODULE_ID, "ddbCobaltSession");
      html.find(".ddb-cobalt-status").text(
        cobaltConfigured
          ? "CobaltSession token configured — uses the same local proxy above."
          : 'No CobaltSession token set — add one in this module\'s settings first ("D&D Beyond CobaltSession token").'
      );
      html.find(".ddb-import-species").on("click", () => startDdbImport("species"));
      html.find(".ddb-import-feats").on("click", () => startDdbImport("feats"));
      html.find(".ddb-import-classes").on("click", () => startDdbImport("classes"));
      html.find(".ddb-import-subclasses").on("click", () => startDdbImport("subclasses"));
      html.find(".ddb-import-backgrounds").on("click", () => startDdbImport("backgrounds"));
    },
    buttons: {
      run: {
        label: "Run Import",
        callback: (html) => startImport(html.find("[name=urls]").val(), html.find("[name=folder]").val()),
      },
      cancel: { label: "Cancel" },
    },
    default: "run",
  }, { width: 520, resizable: true }).render(true);
}

// Convenience for macros/console use that want to skip the dialog.
export async function importFromFolder(folderPath) {
  return startImport("", folderPath);
}
