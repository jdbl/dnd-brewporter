import { scrapeWikidotHtml, resolveSourceUrl, isWikidotPage, assembleSubclassItem, slugify, normalizeName, searchIndex, MODULE_ID, applyRulesetPreference } from "./scraper.mjs";
import { scrapeFreeformSubclass } from "./freeform-scraper.mjs";
import { showBuildFeatureDialog } from "./effects-builder.mjs";

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

export async function buildNameIndex() {
  const contentType = game.settings.get(MODULE_ID, "contentType") || "player";
  const index = new Map(); // normalized name -> [{ uuid, name, pack, tier }]
  const itemPacks = game.packs.filter((p) => p.documentName === "Item" && packContentKind(p) === contentType);
  for (const pack of itemPacks) {
    let idx;
    try {
      idx = await pack.getIndex();
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
      index.get(key).push({ uuid, name: entry.name, pack: pack.collection, tier, img: entry.img, type: entry.type });
    }
  }
  return index;
}

function lookup(index, rawName) {
  const candidates = index.get(normalizeName(rawName));
  if (!candidates?.length) return { status: "none" };

  const preference = game.settings.get(MODULE_ID, "rulesetPreference");
  const pool = applyRulesetPreference(candidates, preference);

  const uniqueUuids = new Set(pool.map((c) => c.uuid));
  if (uniqueUuids.size === 1) return { status: "resolved", match: pool[0] };
  return { status: "ambiguous", candidates: pool };
}

// Neither an ambiguous match (multiple compendium items share a name) nor
// a total miss (no name in the index at all) can be fixed until the parent
// item exists, so both get queued into `pending` — the caller attaches the
// created item's UUID once it exists, so the review dialog can write a pick
// straight back into that field instead of sending the user to the item
// sheet by hand. Total misses still get `candidates: []`; the review UI
// covers them with a live compendium search instead of a fixed list.
function resolveSlot(entry, hintKey, index, report, context, path, pending, descByName) {
  if (!entry || typeof entry !== "object" || !(hintKey in entry)) return;
  const targetKey = "uuid" in entry ? "uuid" : typeof entry.key === "string" ? "key" : null;
  if (!targetKey || entry[targetKey] !== "") return;

  const rawName = String(entry[hintKey]).replace(/^FIXME(\s+spell)?:\s*/i, "").trim();
  const result = lookup(index, rawName);
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
    pending.push({
      context, name: rawName, reason: "no match found",
      path: `${path}.${targetKey}`,
      candidates: [],
      // Only populated for wikidot subclass features (see parseSubclassContent
      // in scraper.mjs) — lets the review dialog offer "create a new feature"
      // with the real scraped text instead of starting from a blank item.
      descriptionHtml: descByName?.get(rawName) ?? null,
    });
  }
  delete entry[hintKey];
}

// Walks exactly the two shapes the scraper produces — it does not blindly
// recurse the whole document, so it can't accidentally touch unrelated
// fields.
function resolveItemUuids(data, index, report, pending, featureDetails = []) {
  const contextBase = data.name ?? "(unnamed item)";

  (data.system?.startingEquipment ?? []).forEach((entry, i) => {
    resolveSlot(entry, "_item", index, report, `${contextBase} — starting equipment`, `system.startingEquipment.${i}`, pending);
  });

  for (const [advKey, adv] of Object.entries(data.system?.advancement ?? {})) {
    const items = adv.configuration?.items;
    if (!Array.isArray(items)) continue;
    const label = `${contextBase} — level ${adv.level ?? "?"} (${adv.title || adv.type})`;
    const descByName = new Map(featureDetails.filter((f) => f.level === adv.level).map((f) => [f.name, f.descriptionHtml]));
    items.forEach((entry, i) => {
      resolveSlot(entry, "_name", index, report, label, `system.advancement.${advKey}.configuration.items.${i}`, pending, descByName);
    });
  }
}

async function createItemFromData(data, label, index, report, via, featureDetails, className) {
  const pending = [];
  resolveItemUuids(data, index, report, pending, featureDetails);
  delete data._id;
  // A subclass's own item goes straight into its class's folder (e.g.
  // "Warlock") — matching the layout of the official class/subclass
  // compendiums — when the source page told us the class name; anything
  // else (a bare class import, or a className-less source) is left
  // unfiled, same as before folders existed here.
  data.folder = className ? await resolveFolderPath([className]) : null;
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
          ? `<span class="wikidot-badge wikidot-badge-ambiguous">${entry.candidates.length} matches</span>`
          : `<span class="wikidot-badge wikidot-badge-none">No match</span>`}
        <strong>${entry.name}</strong>
        <em>${entry.context}</em>
      </div>
      <div class="wikidot-problem-candidates">
        ${entry.candidates.length
          ? entry.candidates.map(candidateCardHtml).join("")
          : `<input type="text" class="wikidot-search-input" value="${entry.name}" placeholder="Search compendiums for a match…">
             <div class="wikidot-search-results"></div>
             <div class="wikidot-create-feature-row">
               <button type="button" class="wikidot-create-feature">+ Create new Feature item</button>
               <em>${entry.descriptionHtml
                 ? "uses the description text scraped from the source page"
                 : "no description text was found on the page — edit it after creating"}</em>
             </div>`}
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

  const report = { created: [], failed: [], resolved: [], unresolved: [], manualSaveNeeded: fetchFailed.map((r) => r.url) };
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
