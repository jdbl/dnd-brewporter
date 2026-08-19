# D&D Brewporter

Scrapes class/subclass pages from dnd2024.wikidot.com — and homebrew
subclasses from Google Docs or similar free-form pages — resolves
compendium UUIDs by name against every installed Item compendium, and
creates the result as a world Item, entirely from inside Foundry.

## Installation

In Foundry's **Add-on Modules** tab, click **Install Module**, and paste this
manifest URL:

```
https://github.com/jdbl/dnd-brewporter/releases/latest/download/module.json
```

(Or download the latest release's `module.zip` from the
[releases page](https://github.com/jdbl/dnd-brewporter/releases) and extract
it into your `Data/modules/` folder by hand.)

## One-time setup: the local proxy (recommended)

Neither dnd2024.wikidot.com nor Google Docs send CORS headers, so a browser
(including Foundry's own client) can't read a direct cross-site fetch — a
restriction the sites impose, not something the module can talk its way
around. The fix: a tiny zero-dependency local proxy that fetches pages
server-side (where CORS doesn't apply) and hands them back with a
permissive header attached.

```bash
node proxy/wikidot-proxy.mjs
```

Leave it running while you use Foundry. With it running, pasting a URL and
clicking Run Import is genuinely one-click for any supported source. Without
it, the same URLs still work, just with an extra manual step (see below).
It only listens on `127.0.0.1` — not reachable from your network, only this
machine. *(Running Foundry on a different machine than your browser — e.g. a
Raspberry Pi — isn't supported by this proxy yet; it needs to run wherever
the browser making the import request is.)*

## Usage

1. Enable this module for the world (Setup → Manage Modules).
2. Run the **"Import Wikidot Items"** macro (auto-created in the Macros tab
   the first time this module loads — drag it to your hotbar for one-click
   reuse), or click **Import Wikidot Items** in the Items sidebar header if
   it appears there.
3. The dialog shows whether the local proxy is running, then:
   - **URLs/slugs box**: paste page slugs or URLs, one per line — wikidot
     (`cleric`, `cleric:life-domain`, `http://dnd2024.wikidot.com/fighter:main`)
     or a Google Docs link. Both a normal doc link (any tab, `/edit`
     included — rewritten to the plain-HTML export) and a "Publish to web"
     link (`.../document/d/e/.../pub`, from Google Docs' File → Share →
     Publish to web) work — they use different, incompatible ID schemes
     under the hood, but both are detected and fetched correctly.
   - **Import folder**: browse to a folder (default `Data/homebrew-import/`,
     already seeded with a Cleric class + Life Domain subclass example) that
     can hold `.html` pages you've saved yourself, or `.json` files already
     produced by the standalone `scrape-class.mjs` script.
4. You'll see a confirmation listing everything found before anything is
   created, followed by a report of what was created (and which of direct
   fetch / the local proxy / the folder actually supplied each one), what
   UUIDs were resolved, and what still needs a manual fix on the item sheet.

## If a URL can't be fetched at all

This only happens when the local proxy isn't running. The report lists the
URL: open it in a normal browser tab, save it (Ctrl+S → "Webpage, HTML
only") into your import folder, and re-run — the module reads local `.html`
files the same way it reads `.json`.

## Free-form (non-wikidot) pages

wikidot pages have real structured HTML the module can parse exactly.
Homebrew docs (Google Docs and similar) don't — instead the module looks
for the same convention official books use: a line reading e.g.
`"3rd Level: Aura of Love"` marking each feature, and a `Level | Spell`
table for "always prepared" spells. This only covers **subclasses** for now
— class pages need a Core Traits equivalent (primary ability, hit die,
proficiencies) that free-form prose has no reliable convention for.

Because this is pattern-matching prose rather than parsing real markup,
it's inherently less certain than the wikidot path:
- If it finds **2 or more** "Nth Level:" headings, it imports straight
  through, same one-click feel as wikidot.
- If it finds **0 or 1**, that's a strong sign the doc doesn't follow the
  convention — a review dialog opens first, showing the detected subclass
  name, class identifier, and level→feature breakdown as editable fields
  (with add/remove rows) so you can fix it before anything is created.

### Homebrew features are generated, not looked up

A wikidot-derived feature ("Divine Order", "Channel Divinity", ...) already
exists somewhere in the official compendium — resolving it is a name
lookup. A freeform-derived one usually doesn't exist anywhere: it's
original to the doc (e.g. a custom Channel Divinity option like "Loving
Embrace"). For those, the importer creates a real Item using the prose that
follows that feature's heading in the source doc as its description, and
points the subclass's grant at that new item directly — no FIXME, nothing
to look up. Only content the parser couldn't capture prose for (e.g. a row
you renamed during low-confidence review) falls back to the normal
lookup/FIXME path. Spells referenced in an "Oath/Domain/Circle Spells"
table are unaffected by any of this — those are real existing spells and
still go through the normal compendium lookup.

### Ambiguous matches can be fixed from the report, not just the item sheet

When a name matches more than one compendium item (rare, but happens — e.g.
identically-named items across packs), the report lists it under
"Unresolved" with a **Choose…** button instead of just leaving you to hunt
it down on the item sheet. Clicking it shows the specific candidates (name +
pack) to pick from; picking one writes that UUID straight into the created
item. A name with **no** match at all still has nothing to pick from, so it
stays a plain "needs a manual fix" line as before.

## Matching rules

- Names are matched case-insensitively; a trailing parenthetical like
  `"Indomitable (One Use)"` is stripped to `"Indomitable"` before matching,
  since the compendium entry usually doesn't carry the qualifier.
- When a name exists in both a 2024-ruleset pack (`spells24`, `equipment24`,
  `classes24`, ...) and an older pack of the same name, the 2024 pack wins.
- Anything still ambiguous (multiple distinct matches) or unmatched is left
  blank and listed in the report — nothing blocks the rest of the import.

## Known special cases

- **Artificer** isn't part of the 2024 PHB, so there's no `artificer`-specific
  2024 compendium pack — expect more "Unresolved" entries in the report than
  for the core 12 classes (spells still resolve well; class features may not).
  Its spellcasting progression is correctly set to Foundry's dedicated
  `"artificer"` type (not "half"), even though the wikidot table alone can't
  tell the two apart anymore.
