import { MODULE_ID, runImport, importFromFolder } from "./importer.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "importFolder", {
    name: "Brewporter Import Folder",
    hint: "Folder (relative to your Foundry Data directory) to browse for scraped item JSON files. Default matches the folder this module creates on first load.",
    scope: "world",
    config: true,
    type: String,
    default: "homebrew-import",
  });

  game.settings.register(MODULE_ID, "rulesetPreference", {
    name: "Preferred ruleset (2024 vs. 5e/2014)",
    hint: 'When a name (e.g. a reprinted spell like "Misty Step" or "Sleep") exists in both a 2024-ruleset compendium pack and a legacy 2014 one, use this choice automatically instead of asking every time. "Ask me each time" restores the old behavior of listing/prompting for both. This only kicks in for that specific 2024-vs-legacy duplicate — a genuinely ambiguous match between two unrelated packs (e.g. two different homebrew items sharing a name) always still prompts.',
    scope: "world",
    config: true,
    type: String,
    choices: { "2024": "Always use 2024", "5e": "Always use 2014/5e (legacy)", ask: "Ask me each time" },
    default: "2024",
  });

  game.settings.register(MODULE_ID, "contentType", {
    name: "Content to match against (player vs. monster)",
    hint: "Whether name lookups (spells, features, equipment, ...) should only consider player-facing compendiums or only monster/NPC ones. Prevents an incidental name collision with the other kind (e.g. a monster feature sharing a name with a player class feature) from ever being offered or auto-resolved — the excluded kind is never even indexed, so it can't show up as a match, a search result, or an ambiguous candidate.",
    scope: "world",
    config: true,
    type: String,
    choices: { player: "Player content only", monster: "Monster content only" },
    default: "player",
  });
});

Hooks.once("ready", async () => {
  game.modules.get(MODULE_ID).api = { runImport, importFromFolder };

  if (!game.user.isGM) return;

  // Guaranteed-to-work entry point: a world macro. (Sidebar button below is
  // a nice-to-have that degrades gracefully if Foundry's directory markup
  // ever changes.)
  const alreadyExists = game.macros.some((m) => m.getFlag(MODULE_ID, "importMacro"));
  if (!alreadyExists) {
    const macro = await Macro.create({
      name: "Import Brewporter Items",
      type: "script",
      img: "icons/svg/upload.svg",
      command: `game.modules.get("${MODULE_ID}").api.runImport();`,
      flags: { [MODULE_ID]: { importMacro: true } },
    });
    ui.notifications.info(`Brewporter | Created the "${macro.name}" macro — open the Macros tab (or drag it to your hotbar) to run an import.`);
  }
});

Hooks.on("renderItemDirectory", (app, html) => {
  try {
    const root = html instanceof HTMLElement ? html : html[0];
    if (!root || !game.user.isGM) return;
    if (root.querySelector(".wikidot-import-button")) return; // already added

    const container = root.querySelector(".directory-header .action-buttons") ?? root.querySelector(".directory-header");
    if (!container) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "wikidot-import-button";
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> Import Brewporter Items`;
    button.addEventListener("click", () => runImport());
    container.appendChild(button);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not add the Items sidebar button — use the "Import Brewporter Items" macro instead.`, err);
  }
});
