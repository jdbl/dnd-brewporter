// Field-aware editors for attaching ActiveEffects and dnd5e Activities to a
// feature created on the fly from the "Create new Feature item" action in
// the Problem Imports review dialog (see importer.mjs). Two ways in: build
// one from scratch, or copy an existing effect/activity off any compendium
// item (found via the same name-search index the review dialog already
// uses) and tweak it before it's attached.
//
// ActiveEffect data matches Foundry's own core schema — well-established,
// unlikely to drift between versions. dnd5e Activities are read from
// CONFIG.DND5E where possible purely to build dropdown option lists (ability/
// damage/healing types, activation types) so they track whatever system
// version is actually installed; the *shapes* built here (save/damage/heal/
// utility) are plain objects matching the dnd5e system's documented Activity
// schema. Activities aren't real embedded Documents (just a validated
// plain-object map on system.activities), so a well-formed plain object is
// enough — and everything built here stays fully editable afterward on the
// item's own sheet, which is the authoritative place to fine-tune anything
// this editor doesn't cover.

import { randomId, searchIndex } from "./scraper.mjs";

function dnd5eConfig() {
  return (typeof CONFIG !== "undefined" && CONFIG.DND5E) || null;
}

function abilityOptions() {
  const abilities = dnd5eConfig()?.abilities ?? {
    str: { label: "Strength" }, dex: { label: "Dexterity" }, con: { label: "Constitution" },
    int: { label: "Intelligence" }, wis: { label: "Wisdom" }, cha: { label: "Charisma" },
  };
  return Object.entries(abilities).map(([value, a]) => ({ value, label: a.label ?? a.name ?? value }));
}

function damageTypeOptions() {
  const types = dnd5eConfig()?.damageTypes ?? {
    acid: { label: "Acid" }, bludgeoning: { label: "Bludgeoning" }, cold: { label: "Cold" }, fire: { label: "Fire" },
    force: { label: "Force" }, lightning: { label: "Lightning" }, necrotic: { label: "Necrotic" }, piercing: { label: "Piercing" },
    poison: { label: "Poison" }, psychic: { label: "Psychic" }, radiant: { label: "Radiant" }, slashing: { label: "Slashing" }, thunder: { label: "Thunder" },
  };
  return Object.entries(types).map(([value, t]) => ({ value, label: t.label ?? t.name ?? value }));
}

function healingTypeOptions() {
  const types = dnd5eConfig()?.healingTypes ?? { healing: { label: "Healing" }, temphp: { label: "Temporary Hit Points" } };
  return Object.entries(types).map(([value, t]) => ({ value, label: t.label ?? t.name ?? value }));
}

function activationTypeOptions() {
  const types = dnd5eConfig()?.abilityActivationTypes ?? { action: "Action", bonus: "Bonus Action", reaction: "Reaction", special: "Special", none: "None" };
  return Object.entries(types).map(([value, label]) => ({ value, label: typeof label === "string" ? label : (label.label ?? value) }));
}

const ACTIVITY_TYPE_LABELS = { save: "Save", damage: "Damage", heal: "Heal", utility: "Utility", cast: "Cast" };

function insertAtCursor(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + text.length;
}

const DIALOG_STYLES = `
  <style>
    .wikidot-eb-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
    .wikidot-eb-queue-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border: 1px solid var(--color-border-light-tertiary, #999); border-radius: 3px; margin-bottom: 4px; }
    .wikidot-eb-empty { color: var(--color-text-dark-secondary, #666); }
    .wikidot-ae-form .form-group, .wikidot-act-form .form-group { margin-bottom: 8px; }
    .wikidot-ae-change-row, .wikidot-act-damage-row { display: flex; gap: 4px; margin-bottom: 4px; align-items: center; }
    .wikidot-ae-change-row input, .wikidot-act-damage-row input { flex: 1; }
    .wikidot-formula-tokens { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--color-border-light-tertiary, #999); font-size: 0.85em; }
    .wikidot-eb-copy-item, .wikidot-eb-copy-pick { padding: 3px 4px; border-radius: 3px; cursor: pointer; }
    .wikidot-eb-copy-item:hover, .wikidot-eb-copy-pick:hover { background: rgba(127,127,127,0.15); }
  </style>
`;

function changeKeySuggestionsHtml() {
  const abilityKeys = Object.keys(dnd5eConfig()?.abilities ?? { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 });
  const suggestions = [
    "system.attributes.ac.bonus", "system.attributes.hp.bonus", "system.attributes.hp.max",
    "system.attributes.movement.walk", "system.attributes.movement.fly", "system.attributes.movement.swim",
    "system.attributes.init.bonus",
    ...abilityKeys.map((k) => `system.abilities.${k}.bonuses.check`),
    ...abilityKeys.map((k) => `system.abilities.${k}.bonuses.save`),
    "system.bonuses.mwak.damage", "system.bonuses.rwak.damage", "system.bonuses.msak.damage", "system.bonuses.rsak.damage",
    "system.traits.dr.value", "system.traits.di.value", "system.traits.dv.value",
  ];
  return `<datalist id="wikidot-change-key-suggestions">${suggestions.map((s) => `<option value="${s}">`).join("")}</datalist>`;
}

function formulaTokenButtonsHtml() {
  return `
    <div class="wikidot-formula-tokens">
      <span>Insert:</span>
      <select class="wikidot-token-ability-select">
        <option value="">Ability mod…</option>
        ${abilityOptions().map((a) => `<option value="${a.value}">${a.label}</option>`).join("")}
      </select>
      <button type="button" class="wikidot-token-btn" data-token="@prof">Prof. bonus</button>
      <button type="button" class="wikidot-token-btn" data-token="@details.level">Char. level</button>
      <button type="button" class="wikidot-token-btn" data-token="@item.level">Feature level</button>
    </div>
  `;
}

// ---- Active Effect editor -------------------------------------------------

function changeRowHtml(c = { key: "", mode: 2, value: "" }) {
  return `
    <div class="wikidot-ae-change-row">
      <input type="text" class="wikidot-ae-change-key wikidot-formula-input" list="wikidot-change-key-suggestions" value="${c.key ?? ""}" placeholder="e.g. system.attributes.ac.bonus">
      <select class="wikidot-ae-change-mode">
        <option value="2" ${c.mode === 2 ? "selected" : ""}>Add</option>
        <option value="1" ${c.mode === 1 ? "selected" : ""}>Multiply</option>
        <option value="5" ${c.mode === 5 ? "selected" : ""}>Override</option>
        <option value="4" ${c.mode === 4 ? "selected" : ""}>Upgrade</option>
        <option value="3" ${c.mode === 3 ? "selected" : ""}>Downgrade</option>
        <option value="0" ${c.mode === 0 ? "selected" : ""}>Custom</option>
      </select>
      <input type="text" class="wikidot-ae-change-value wikidot-formula-input" value="${c.value ?? ""}" placeholder="value or formula">
      <button type="button" class="wikidot-ae-remove-change">✕</button>
    </div>
  `;
}

function activeEffectFormHtml(prefill = {}) {
  const changes = prefill.changes?.length ? prefill.changes : [{ key: "", mode: 2, value: "" }];
  return `
    <form class="wikidot-ae-form">
      <div class="form-group">
        <label>Effect name</label>
        <input type="text" class="wikidot-ae-name" style="width:100%;" value="${prefill.name ?? ""}">
      </div>
      <div class="form-group">
        <label><input type="checkbox" class="wikidot-ae-transfer" ${prefill.transfer !== false ? "checked" : ""}>
          Apply automatically while this feature is possessed (uncheck for an effect the player toggles on manually)</label>
      </div>
      <div class="form-group">
        <label>Duration</label>
        <select class="wikidot-ae-duration-type">
          <option value="permanent" ${!prefill.durationType || prefill.durationType === "permanent" ? "selected" : ""}>Permanent</option>
          <option value="rounds" ${prefill.durationType === "rounds" ? "selected" : ""}>Rounds</option>
          <option value="turns" ${prefill.durationType === "turns" ? "selected" : ""}>Turns</option>
          <option value="seconds" ${prefill.durationType === "seconds" ? "selected" : ""}>Seconds</option>
        </select>
        <input type="number" class="wikidot-ae-duration-value" min="1" value="${prefill.durationValue ?? ""}" placeholder="#" style="width:70px;">
      </div>
      <div class="form-group">
        <label>Changes</label>
        <div class="wikidot-ae-changes">${changes.map(changeRowHtml).join("")}</div>
        <button type="button" class="wikidot-ae-add-change">+ Add change</button>
      </div>
    </form>
  `;
}

function parseActiveEffectForm(formEl) {
  const changes = Array.from(formEl.querySelectorAll(".wikidot-ae-change-row"))
    .map((row) => ({
      key: row.querySelector(".wikidot-ae-change-key").value.trim(),
      mode: parseInt(row.querySelector(".wikidot-ae-change-mode").value, 10),
      value: row.querySelector(".wikidot-ae-change-value").value.trim(),
    }))
    .filter((c) => c.key);

  const durationType = formEl.querySelector(".wikidot-ae-duration-type").value;
  const durationValue = parseInt(formEl.querySelector(".wikidot-ae-duration-value").value, 10) || null;

  return {
    name: formEl.querySelector(".wikidot-ae-name").value.trim(),
    transfer: formEl.querySelector(".wikidot-ae-transfer").checked,
    durationType, durationValue,
    changes,
  };
}

export function buildActiveEffectData(form) {
  const duration = { startTime: null, seconds: null, combat: null, rounds: null, turns: null, startRound: null, startTurn: null };
  if (form.durationType === "seconds") duration.seconds = form.durationValue;
  if (form.durationType === "rounds") duration.rounds = form.durationValue;
  if (form.durationType === "turns") duration.turns = form.durationValue;

  return {
    _id: randomId(),
    name: form.name || "Effect",
    img: "icons/svg/aura.svg",
    changes: form.changes.map((c) => ({ key: c.key, mode: c.mode, value: c.value, priority: null })),
    disabled: false,
    duration,
    description: "",
    origin: null,
    tint: "#ffffff",
    transfer: !!form.transfer,
    statuses: [],
    flags: {},
  };
}

function activeEffectDataToPrefill(ae) {
  const duration = ae.duration ?? {};
  let durationType = "permanent", durationValue = "";
  if (duration.rounds) { durationType = "rounds"; durationValue = duration.rounds; }
  else if (duration.turns) { durationType = "turns"; durationValue = duration.turns; }
  else if (duration.seconds) { durationType = "seconds"; durationValue = duration.seconds; }
  return {
    name: ae.name ?? ae.label ?? "",
    transfer: ae.transfer !== false,
    durationType, durationValue,
    changes: (ae.changes ?? []).map((c) => ({ key: c.key, mode: c.mode, value: c.value })),
  };
}

export function showActiveEffectEditorDialog(prefill = {}) {
  return new Promise((resolve) => {
    const content = `${DIALOG_STYLES}${changeKeySuggestionsHtml()}${activeEffectFormHtml(prefill)}`;
    new Dialog(
      {
        title: "New Effect",
        content,
        render: (html) => wireSharedFormControls(html),
        buttons: {
          add: {
            label: "Add",
            callback: (html) => resolve({ kind: "effect", data: buildActiveEffectData(parseActiveEffectForm(html[0].querySelector(".wikidot-ae-form"))) }),
          },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        default: "add",
      },
      { width: 480, resizable: true }
    ).render(true);
  });
}

// ---- Activity editor --------------------------------------------------

// Effects already queued in the Build Feature dialog can be linked to this
// activity (dnd5e's own `effects: [{_id}]` field on an activity — e.g. so a
// failed save actually applies a "Disadvantage on attacks" effect instead of
// just rolling a save with no consequence). Only effects already in the
// queue can be offered — an activity can't reference something that doesn't
// exist yet.
function linkedEffectsHtml(availableEffects = [], prefill = {}) {
  if (!availableEffects.length) {
    return `<div class="form-group"><label>Linked effects</label><p><em>No effects queued yet — add one first (+ New Effect or + Copy from Compendium) if you want this activity to apply it automatically.</em></p></div>`;
  }
  return `
    <div class="form-group">
      <label>Linked effects (applied automatically, e.g. on a failed save)</label>
      ${availableEffects.map((e) => `
        <label style="display:block;">
          <input type="checkbox" class="wikidot-act-linked-effect" value="${e._id}" ${prefill.linkedEffectIds?.includes(e._id) ? "checked" : ""}>
          ${e.name}
        </label>
      `).join("")}
    </div>
  `;
}

function commonActivityFieldsHtml(prefill = {}, availableEffects = []) {
  return `
    <div class="form-group">
      <label>Activity name (optional)</label>
      <input type="text" class="wikidot-act-name" style="width:100%;" value="${prefill.name ?? ""}">
    </div>
    <div class="form-group">
      <label>Activation</label>
      <select class="wikidot-act-activation-type">
        ${activationTypeOptions().map((t) => `<option value="${t.value}" ${(prefill.activationType ?? "action") === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
      </select>
      <input type="number" class="wikidot-act-activation-value" min="1" value="${prefill.activationValue ?? ""}" placeholder="#" style="width:60px;">
    </div>
    ${linkedEffectsHtml(availableEffects, prefill)}
  `;
}

function damagePartRowHtml(p = { formula: "", type: "" }) {
  return `
    <div class="wikidot-act-damage-row">
      <input type="text" class="wikidot-act-damage-formula wikidot-formula-input" value="${p.formula ?? ""}" placeholder="e.g. 2d6 + @abilities.cha.mod">
      <select class="wikidot-act-damage-type">
        <option value="">(none)</option>
        ${damageTypeOptions().map((t) => `<option value="${t.value}" ${p.type === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
      </select>
      <button type="button" class="wikidot-act-remove-damage">✕</button>
    </div>
  `;
}

function damagePartsListHtml(parts) {
  const rows = parts?.length ? parts : [{ formula: "", type: "" }];
  return `<div class="wikidot-act-damage-parts">${rows.map(damagePartRowHtml).join("")}</div>
          <button type="button" class="wikidot-act-add-damage">+ Add damage part</button>`;
}

function saveActivityFormHtml(prefill = {}, availableEffects = []) {
  return `
    <form class="wikidot-act-form" data-activity-type="save">
      ${commonActivityFieldsHtml(prefill, availableEffects)}
      <div class="form-group">
        <label>Saving throw ability</label><br>
        <select class="wikidot-act-save-ability" multiple size="6">
          ${abilityOptions().map((a) => `<option value="${a.value}" ${prefill.saveAbility?.includes(a.value) ? "selected" : ""}>${a.label}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label>DC</label>
        <select class="wikidot-act-dc-mode">
          <option value="spellcasting" ${!prefill.dcMode || prefill.dcMode === "spellcasting" ? "selected" : ""}>Spellcasting ability</option>
          <option value="formula" ${prefill.dcMode === "formula" ? "selected" : ""}>Custom formula</option>
          <option value="flat" ${prefill.dcMode === "flat" ? "selected" : ""}>Fixed value</option>
        </select>
        <input type="text" class="wikidot-act-dc-value wikidot-formula-input" value="${prefill.dcValue ?? ""}" placeholder="formula or number">
      </div>
      <div class="form-group">
        <label>On a successful save</label>
        <select class="wikidot-act-onsave">
          <option value="none" ${!prefill.onSave || prefill.onSave === "none" ? "selected" : ""}>No effect</option>
          <option value="half" ${prefill.onSave === "half" ? "selected" : ""}>Half damage</option>
        </select>
      </div>
      <div class="form-group">
        <label>Damage on a failed save (optional)</label>
        ${damagePartsListHtml(prefill.damageParts)}
      </div>
      ${formulaTokenButtonsHtml()}
    </form>
  `;
}

function damageActivityFormHtml(prefill = {}, availableEffects = []) {
  return `
    <form class="wikidot-act-form" data-activity-type="damage">
      ${commonActivityFieldsHtml(prefill, availableEffects)}
      <div class="form-group">
        <label>Damage</label>
        ${damagePartsListHtml(prefill.damageParts)}
      </div>
      <div class="form-group">
        <label>Critical hit bonus (optional)</label>
        <input type="text" class="wikidot-act-critical-bonus wikidot-formula-input" style="width:100%;" value="${prefill.criticalBonus ?? ""}">
      </div>
      ${formulaTokenButtonsHtml()}
    </form>
  `;
}

function healActivityFormHtml(prefill = {}, availableEffects = []) {
  return `
    <form class="wikidot-act-form" data-activity-type="heal">
      ${commonActivityFieldsHtml(prefill, availableEffects)}
      <div class="form-group">
        <label>Healing formula</label>
        <input type="text" class="wikidot-act-heal-formula wikidot-formula-input" style="width:100%;" value="${prefill.healFormula ?? ""}" placeholder="e.g. 2d8 + @abilities.wis.mod">
      </div>
      <div class="form-group">
        <label>Type</label>
        <select class="wikidot-act-heal-type">
          ${healingTypeOptions().map((t) => `<option value="${t.value}" ${(prefill.healType ?? "healing") === t.value ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
      </div>
      ${formulaTokenButtonsHtml()}
    </form>
  `;
}

function utilityActivityFormHtml(prefill = {}, availableEffects = []) {
  return `
    <form class="wikidot-act-form" data-activity-type="utility">
      ${commonActivityFieldsHtml(prefill, availableEffects)}
      <div class="form-group">
        <label>Roll formula (optional)</label>
        <input type="text" class="wikidot-act-utility-formula wikidot-formula-input" style="width:100%;" value="${prefill.rollFormula ?? ""}" placeholder="leave blank if this activity doesn't roll anything">
      </div>
      <div class="form-group">
        <label>Roll button label (optional)</label>
        <input type="text" class="wikidot-act-utility-label" style="width:100%;" value="${prefill.rollLabel ?? ""}">
      </div>
      ${formulaTokenButtonsHtml()}
    </form>
  `;
}

// Grants casting an existing spell (picked from the same compendium search
// used everywhere else in this dialog) without expending a slot — the
// "cast this spell X/day" shape most at-will/limited racial & subclass
// features actually need. Limited uses live on the activity's own base
// `uses` field (see buildActivityData) rather than anything cast-specific.
function castActivityFormHtml(prefill = {}, availableEffects = []) {
  return `
    <form class="wikidot-act-form" data-activity-type="cast">
      ${commonActivityFieldsHtml(prefill, availableEffects)}
      <div class="form-group">
        <label>Spell to cast</label>
        <input type="text" class="wikidot-act-cast-search" style="width:100%;" placeholder="Search compendiums for a spell…">
        <div class="wikidot-act-cast-results"></div>
        <input type="hidden" class="wikidot-act-cast-uuid" value="${prefill.spellUuid ?? ""}">
        <input type="hidden" class="wikidot-act-cast-name" value="${prefill.spellName ?? ""}">
        <p class="wikidot-act-cast-selected">${prefill.spellName ? `Selected: <strong>${prefill.spellName}</strong>` : "<em>No spell selected yet.</em>"}</p>
      </div>
      <div class="form-group">
        <label>Uses</label>
        <input type="text" class="wikidot-act-cast-uses-max wikidot-formula-input" value="${prefill.usesMax ?? ""}" placeholder="e.g. @abilities.cha.mod (blank = unlimited)" style="width:60%;">
        <select class="wikidot-act-cast-recovery">
          <option value="lr" ${(prefill.recoveryPeriod ?? "lr") === "lr" ? "selected" : ""}>per Long Rest</option>
          <option value="sr" ${prefill.recoveryPeriod === "sr" ? "selected" : ""}>per Short Rest</option>
          <option value="day" ${prefill.recoveryPeriod === "day" ? "selected" : ""}>per Day</option>
        </select>
      </div>
      ${formulaTokenButtonsHtml()}
    </form>
  `;
}

const ACTIVITY_FORM_BUILDERS = { save: saveActivityFormHtml, damage: damageActivityFormHtml, heal: healActivityFormHtml, utility: utilityActivityFormHtml, cast: castActivityFormHtml };

function parseCommonActivity(formEl) {
  return {
    name: formEl.querySelector(".wikidot-act-name")?.value.trim() || "",
    activationType: formEl.querySelector(".wikidot-act-activation-type")?.value || "action",
    activationValue: parseInt(formEl.querySelector(".wikidot-act-activation-value")?.value, 10) || null,
    linkedEffectIds: Array.from(formEl.querySelectorAll(".wikidot-act-linked-effect:checked")).map((cb) => cb.value),
  };
}

function parseDamageParts(formEl) {
  return Array.from(formEl.querySelectorAll(".wikidot-act-damage-row"))
    .map((row) => ({ formula: row.querySelector(".wikidot-act-damage-formula").value.trim(), type: row.querySelector(".wikidot-act-damage-type").value }))
    .filter((p) => p.formula);
}

function parseActivityForm(type, formEl) {
  const common = parseCommonActivity(formEl);
  if (type === "save") {
    return {
      ...common,
      saveAbility: Array.from(formEl.querySelector(".wikidot-act-save-ability").selectedOptions).map((o) => o.value),
      dcMode: formEl.querySelector(".wikidot-act-dc-mode").value,
      dcValue: formEl.querySelector(".wikidot-act-dc-value").value.trim(),
      onSave: formEl.querySelector(".wikidot-act-onsave").value,
      damageParts: parseDamageParts(formEl),
    };
  }
  if (type === "damage") {
    return { ...common, damageParts: parseDamageParts(formEl), criticalBonus: formEl.querySelector(".wikidot-act-critical-bonus").value.trim() };
  }
  if (type === "heal") {
    return { ...common, healFormula: formEl.querySelector(".wikidot-act-heal-formula").value.trim(), healType: formEl.querySelector(".wikidot-act-heal-type").value };
  }
  if (type === "utility") {
    return { ...common, rollFormula: formEl.querySelector(".wikidot-act-utility-formula").value.trim(), rollLabel: formEl.querySelector(".wikidot-act-utility-label").value.trim() };
  }
  if (type === "cast") {
    return {
      ...common,
      spellUuid: formEl.querySelector(".wikidot-act-cast-uuid").value.trim(),
      spellName: formEl.querySelector(".wikidot-act-cast-name").value.trim(),
      usesMax: formEl.querySelector(".wikidot-act-cast-uses-max").value.trim(),
      recoveryPeriod: formEl.querySelector(".wikidot-act-cast-recovery").value,
    };
  }
  return common;
}

function buildDc(form) {
  if (form.dcMode === "flat") return { calculation: "", formula: "", value: parseInt(form.dcValue, 10) || null };
  if (form.dcMode === "formula") return { calculation: "formula", formula: form.dcValue || "", value: null };
  return { calculation: "spellcasting", formula: "", value: null };
}

function damagePartData(p) {
  return {
    number: null, denomination: null, bonus: "",
    types: p.type ? [p.type] : [],
    custom: { enabled: true, formula: p.formula },
    scaling: { mode: "", number: null },
  };
}

export function buildActivityData(type, form) {
  const base = {
    _id: randomId(),
    type,
    name: form.name || "",
    img: "",
    sort: 0,
    activation: { type: form.activationType || "action", value: form.activationValue ?? null, condition: "", override: false },
    consumption: { targets: [], scaling: { allowed: false, max: "" } },
    description: { chat: "", value: "" },
    duration: { value: "", units: "inst", concentration: false, override: false },
    effects: (form.linkedEffectIds ?? []).map((id) => ({ _id: id })),
    range: { value: null, units: "", special: "", override: false },
    target: { affects: {}, template: {}, prompt: true, override: false },
    uses: { spent: 0, max: "", recovery: [] },
  };

  if (type === "save") {
    return {
      ...base,
      save: { ability: form.saveAbility ?? [], dc: buildDc(form) },
      damage: { onSave: form.onSave || "none", parts: (form.damageParts ?? []).map(damagePartData) },
    };
  }
  if (type === "damage") {
    return { ...base, damage: { critical: { bonus: form.criticalBonus || "" }, includeBase: false, parts: (form.damageParts ?? []).map(damagePartData) } };
  }
  if (type === "heal") {
    return {
      ...base,
      healing: { number: null, denomination: null, bonus: "", types: form.healType ? [form.healType] : ["healing"], custom: { enabled: true, formula: form.healFormula || "" }, scaling: { mode: "", number: null } },
    };
  }
  if (type === "utility") {
    return { ...base, roll: { formula: form.rollFormula || "", name: form.rollLabel || "", visible: false } };
  }
  if (type === "cast") {
    return {
      ...base,
      uses: { spent: 0, max: form.usesMax || "", recovery: form.usesMax ? [{ period: form.recoveryPeriod || "lr", type: "recoverAll", formula: "" }] : [] },
      // challenge.{attack,save} are flat number overrides (validated as
      // NumberField by the dnd5e system — confirmed live: an object here
      // throws "must be a number"), not a full ability/DC config. null
      // leaves the spell's own attack/DC in effect, which is what "cast
      // this existing spell" should do by default.
      spell: { ability: "", challenge: { attack: null, save: null }, level: null, properties: [], uuid: form.spellUuid || "" },
    };
  }
  return base;
}

function partDataToForm(p) {
  return { formula: p.custom?.formula || (p.denomination ? `${p.number ?? 1}d${p.denomination}${p.bonus ? ` + ${p.bonus}` : ""}` : ""), type: p.types?.[0] ?? "" };
}

// Async because the "cast" case needs to look up the copied spell's name by
// UUID (fromUuid) — the source item's own effect links (act.effects) are
// deliberately NOT carried over here: those _ids point at the SOURCE item's
// effects, which don't exist on the new feature being built, so linking
// would just dangle. The user re-links to whatever's in the current queue
// instead, via the checklist commonActivityFieldsHtml renders.
async function activityDataToPrefill(type, act) {
  const common = { name: act.name ?? "", activationType: act.activation?.type ?? "action", activationValue: act.activation?.value ?? "" };
  if (type === "save") {
    return {
      ...common,
      saveAbility: act.save?.ability ?? [],
      dcMode: act.save?.dc?.calculation === "formula" ? "formula" : act.save?.dc?.value != null ? "flat" : "spellcasting",
      dcValue: act.save?.dc?.formula || act.save?.dc?.value || "",
      onSave: act.damage?.onSave ?? "none",
      damageParts: (act.damage?.parts ?? []).map(partDataToForm),
    };
  }
  if (type === "damage") return { ...common, damageParts: (act.damage?.parts ?? []).map(partDataToForm), criticalBonus: act.damage?.critical?.bonus ?? "" };
  if (type === "heal") return { ...common, healFormula: act.healing?.custom?.formula ?? "", healType: act.healing?.types?.[0] ?? "healing" };
  if (type === "utility") return { ...common, rollFormula: act.roll?.formula ?? "", rollLabel: act.roll?.name ?? "" };
  if (type === "cast") {
    const spellUuid = act.spell?.uuid ?? "";
    let spellName = "";
    if (spellUuid) {
      try { spellName = (await fromUuid(spellUuid))?.name ?? ""; } catch { /* stale/missing uuid — leave blank, still editable */ }
    }
    return { ...common, spellUuid, spellName, usesMax: act.uses?.max ?? "", recoveryPeriod: act.uses?.recovery?.[0]?.period ?? "lr" };
  }
  return common;
}

export function showActivityEditorDialog(type, prefill = {}, index, availableEffects = []) {
  return new Promise((resolve) => {
    const builder = ACTIVITY_FORM_BUILDERS[type] ?? utilityActivityFormHtml;
    const content = `${DIALOG_STYLES}${builder(prefill, availableEffects)}`;
    new Dialog(
      {
        title: `New Activity — ${ACTIVITY_TYPE_LABELS[type] ?? type}`,
        content,
        render: (html) => {
          wireSharedFormControls(html);
          if (type === "cast" && index) wireCastSpellSearch(html, index);
        },
        buttons: {
          add: {
            label: "Add",
            callback: (html) => resolve({ kind: "activity", data: buildActivityData(type, parseActivityForm(type, html[0].querySelector(".wikidot-act-form"))) }),
          },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        default: "add",
      },
      { width: 480, resizable: true }
    ).render(true);
  });
}

// Shared by both editor dialogs: repeatable-row add/remove for changes and
// damage parts, plus the roll-data token inserter (tracks whichever
// .wikidot-formula-input last had focus so a token button knows where to
// insert).
function wireSharedFormControls(html) {
  html.on("click", ".wikidot-ae-add-change", (ev) => {
    $(ev.currentTarget).closest("form").find(".wikidot-ae-changes").append(changeRowHtml());
  });
  html.on("click", ".wikidot-ae-remove-change", (ev) => {
    $(ev.currentTarget).closest(".wikidot-ae-change-row").remove();
  });
  html.on("click", ".wikidot-act-add-damage", (ev) => {
    $(ev.currentTarget).closest("form").find(".wikidot-act-damage-parts").append(damagePartRowHtml());
  });
  html.on("click", ".wikidot-act-remove-damage", (ev) => {
    $(ev.currentTarget).closest(".wikidot-act-damage-row").remove();
  });

  let lastFormulaInput = null;
  html.on("focus", ".wikidot-formula-input", (ev) => { lastFormulaInput = ev.currentTarget; });
  html.on("click", ".wikidot-token-btn", (ev) => {
    if (lastFormulaInput) insertAtCursor(lastFormulaInput, $(ev.currentTarget).data("token"));
  });
  html.on("change", ".wikidot-token-ability-select", (ev) => {
    const val = ev.currentTarget.value;
    if (val && lastFormulaInput) insertAtCursor(lastFormulaInput, `@abilities.${val}.mod`);
    ev.currentTarget.value = "";
  });
}

// Only wired for the "cast" activity type — the same search-index pattern
// used everywhere else (no-match rows, copy-from-compendium), here picking
// the spell this activity casts rather than an effect/activity to copy.
function wireCastSpellSearch(html, index) {
  html.on("input", ".wikidot-act-cast-search", (ev) => {
    const matches = searchIndex(index, ev.currentTarget.value);
    html.find(".wikidot-act-cast-results").html(
      matches.length
        ? matches.map((m) => `<div class="wikidot-eb-copy-item wikidot-act-cast-pick" data-uuid="${m.uuid}" data-name="${m.name}">${m.name} <em>(${m.pack})</em></div>`).join("")
        : "<p><em>No matches.</em></p>"
    );
  });
  html.on("click", ".wikidot-act-cast-pick", (ev) => {
    const uuid = $(ev.currentTarget).data("uuid");
    const name = $(ev.currentTarget).data("name");
    html.find(".wikidot-act-cast-uuid").val(uuid);
    html.find(".wikidot-act-cast-name").val(name);
    html.find(".wikidot-act-cast-selected").html(`Selected: <strong>${name}</strong>`);
    html.find(".wikidot-act-cast-results").html("");
  });
}

// ---- Copy from compendium ----------------------------------------------

export function showCopyFromCompendiumDialog(index) {
  return new Promise((resolve) => {
    const content = `
      ${DIALOG_STYLES}
      <input type="text" class="wikidot-eb-copy-search" style="width:100%;" placeholder="Search compendium items by name…">
      <div class="wikidot-eb-copy-results"></div>
      <div class="wikidot-eb-copy-detail"></div>
    `;
    let sourceDoc = null;
    new Dialog(
      {
        title: "Copy Effect/Activity from Compendium Item",
        content,
        buttons: { cancel: { label: "Cancel", callback: () => resolve(null) } },
        render: (html) => {
          html.on("input", ".wikidot-eb-copy-search", (ev) => {
            const matches = searchIndex(index, ev.currentTarget.value);
            html.find(".wikidot-eb-copy-results").html(
              matches.length
                ? matches.map((m) => `<div class="wikidot-eb-copy-item" data-uuid="${m.uuid}">${m.name} <em>(${m.pack})</em></div>`).join("")
                : "<p><em>No matches.</em></p>"
            );
          });
          html.on("click", ".wikidot-eb-copy-item", async (ev) => {
            const uuid = $(ev.currentTarget).data("uuid");
            sourceDoc = await fromUuid(uuid);
            const effects = Array.from(sourceDoc?.effects ?? []);
            const activities = Object.values(sourceDoc?.system?.activities ?? {});
            html.find(".wikidot-eb-copy-detail").html(`
              <p><strong>${sourceDoc?.name ?? uuid}</strong> — pick one to copy:</p>
              ${effects.map((e, i) => `<div class="wikidot-eb-copy-pick" data-kind="effect" data-i="${i}">Effect: ${e.name ?? e.label ?? "(unnamed)"}</div>`).join("")}
              ${activities.map((a, i) => `<div class="wikidot-eb-copy-pick" data-kind="activity" data-i="${i}">Activity (${ACTIVITY_TYPE_LABELS[a.type] ?? a.type}): ${a.name || a.type}</div>`).join("")}
              ${!effects.length && !activities.length ? "<p><em>This item has no effects or activities.</em></p>" : ""}
            `);
          });
          html.on("click", ".wikidot-eb-copy-pick", (ev) => {
            const kind = $(ev.currentTarget).data("kind");
            const i = Number($(ev.currentTarget).data("i"));
            const effects = Array.from(sourceDoc?.effects ?? []);
            const activities = Object.values(sourceDoc?.system?.activities ?? {});
            const raw = kind === "effect" ? effects[i] : activities[i];
            const plain = raw?.toObject ? raw.toObject() : raw;
            const cloned = JSON.parse(JSON.stringify(plain));
            cloned._id = randomId();
            resolve({ kind, data: cloned });
          });
        },
      },
      { width: 480, resizable: true }
    ).render(true);
  });
}

// ---- Top-level "Build Feature" dialog ----------------------------------

// Entry point used by importer.mjs's "+ Create new Feature item" action.
// Resolves { effects: [...], activities: {id: data} } on "Create Feature"
// (possibly both empty if nothing was attached), or null if the whole
// creation was cancelled from here.
export function showBuildFeatureDialog({ name, index }) {
  return new Promise((resolve) => {
    const queue = []; // [{kind: "effect"|"activity", data}]

    const queueRowHtml = (item, i) => `
      <div class="wikidot-eb-queue-row" data-idx="${i}">
        <span>${item.kind === "effect" ? "Effect" : `Activity (${ACTIVITY_TYPE_LABELS[item.data.type] ?? item.data.type})`}: <strong>${item.data.name || "(unnamed)"}</strong></span>
        <button type="button" class="wikidot-eb-remove-queued" data-idx="${i}">Remove</button>
      </div>
    `;

    const content = `
      ${DIALOG_STYLES}
      <p>Optionally attach effects or activities to <strong>${name}</strong> before it's created. Everything stays fully editable afterward on the item sheet.</p>
      <div class="wikidot-eb-actions">
        <button type="button" class="wikidot-eb-add-effect">+ New Effect</button>
        <select class="wikidot-eb-activity-type">
          ${Object.entries(ACTIVITY_TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
        <button type="button" class="wikidot-eb-add-activity">+ New Activity</button>
        <button type="button" class="wikidot-eb-copy">+ Copy from Compendium…</button>
      </div>
      <div class="wikidot-eb-queue"><p class="wikidot-eb-empty"><em>Nothing attached yet.</em></p></div>
    `;

    const renderQueue = (html) => {
      html.find(".wikidot-eb-queue").html(
        queue.length ? queue.map(queueRowHtml).join("") : `<p class="wikidot-eb-empty"><em>Nothing attached yet.</em></p>`
      );
    };

    new Dialog(
      {
        title: "Build Feature",
        content,
        buttons: {
          create: {
            label: "Create Feature",
            callback: () => resolve({
              effects: queue.filter((q) => q.kind === "effect").map((q) => q.data),
              activities: Object.fromEntries(queue.filter((q) => q.kind === "activity").map((q) => [q.data._id, q.data])),
            }),
          },
          cancel: { label: "Cancel", callback: () => resolve(null) },
        },
        render: (html) => {
          html.on("click", ".wikidot-eb-add-effect", async () => {
            const result = await showActiveEffectEditorDialog();
            if (result) { queue.push(result); renderQueue(html); }
          });
          html.on("click", ".wikidot-eb-add-activity", async () => {
            const type = html.find(".wikidot-eb-activity-type").val();
            const availableEffects = queue.filter((q) => q.kind === "effect").map((q) => q.data);
            const result = await showActivityEditorDialog(type, {}, index, availableEffects);
            if (result) { queue.push(result); renderQueue(html); }
          });
          html.on("click", ".wikidot-eb-copy", async () => {
            const picked = await showCopyFromCompendiumDialog(index);
            if (!picked) return;
            const availableEffects = queue.filter((q) => q.kind === "effect").map((q) => q.data);
            const result = picked.kind === "effect"
              ? await showActiveEffectEditorDialog(activeEffectDataToPrefill(picked.data))
              : await showActivityEditorDialog(picked.data.type, await activityDataToPrefill(picked.data.type, picked.data), index, availableEffects);
            if (result) { queue.push(result); renderQueue(html); }
          });
          html.on("click", ".wikidot-eb-remove-queued", (ev) => {
            const i = Number($(ev.currentTarget).data("idx"));
            queue.splice(i, 1);
            renderQueue(html);
          });
        },
      },
      { width: 560, resizable: true }
    ).render(true);
  });
}
