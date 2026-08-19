import { MODULE_ID, runImport, importFromFolder } from "./importer.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "importFolder", {
    name: "Wikidot Import Folder",
    hint: "Folder (relative to your Foundry Data directory) to browse for scraped item JSON files. Default matches the folder this module creates on first load.",
    scope: "world",
    config: true,
    type: String,
    default: "homebrew-import",
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
      name: "Import Wikidot Items",
      type: "script",
      img: "icons/svg/upload.svg",
      command: `game.modules.get("${MODULE_ID}").api.runImport();`,
      flags: { [MODULE_ID]: { importMacro: true } },
    });
    ui.notifications.info(`Wikidot Importer | Created the "${macro.name}" macro — open the Macros tab (or drag it to your hotbar) to run an import.`);
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
    button.innerHTML = `<i class="fa-solid fa-file-import"></i> Import Wikidot Items`;
    button.addEventListener("click", () => runImport());
    container.appendChild(button);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not add the Items sidebar button — use the "Import Wikidot Items" macro instead.`, err);
  }
});
