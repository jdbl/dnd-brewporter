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
2. Run the **"Import Brewporter Items"** macro (auto-created in the Macros
   tab the first time this module loads — drag it to your hotbar for
   one-click reuse), or click **Import Brewporter Items** in the Items
   sidebar header if it appears there.
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

## Created items are filed into folders, not dropped loose

Not to be confused with the "Import folder" above (a folder on disk this
module reads saved pages *from*) — this is about where created items land
*in the Items sidebar*, matching the layout of the official class/subclass
compendiums instead of piling everything at the top level:

- A subclass's own item (e.g. "Archfey Patron") goes straight into a
  top-level folder named after its class (e.g. **Warlock**), read off the
  class name the source page itself states (a wikidot subclass page's
  breadcrumb link, or a freeform doc's "A &lt;Class&gt; Subclass" tagline)
  — never guessed from a URL slug.
- Any feature item generated for it (via "+ Create new Feature item", or a
  freeform doc's auto-generated features) goes into a **Subclass Features**
  folder nested under that same class folder — e.g. "Warlock/Subclass
  Features".
- Folders are found-or-created by name, so importing a second Warlock
  subclass later reuses the same "Warlock" folder rather than making a
  duplicate.
- A plain class-page import (e.g. importing "Warlock" itself, not one of
  its subclasses) isn't filed into a folder — there's no equivalent
  "everything else" bucket for it the way there is for a subclass's
  generated features.

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

### Problem imports can be fixed from the report, not just the item sheet

Anything the importer couldn't resolve by name shows up in the report under
"Problem Imports", with a **Review & Fix…** button that opens a dialog
instead of leaving you to hunt it down on the item sheet:

- **Ambiguous** (a name matches more than one compendium item — rare, but
  happens with identically-named items across packs): pick from the specific
  candidates shown (icon, name, pack, type); picking one writes that UUID
  straight into the created item.
- **No match at all**: a live search box lets you hunt through every indexed
  compendium item by name and attach one the same way. If nothing in your
  compendiums is the right thing — common for 2024 PHB subclass features
  that aren't SRD content, so they simply aren't in a free install's
  compendium — a **+ Create new Feature item** button builds a real Feature
  item instead, using the actual prose scraped from the source page as its
  description (wikidot pages only; the row says whether page text was
  found), and attaches that new item's UUID the same way a compendium match
  would be.

Either way the row updates in place to show what it was resolved to.

### Attaching effects and activities to a created feature

Clicking **+ Create new Feature item** opens a "Build Feature" step before
the item is actually created, so you can give it mechanical teeth instead of
just a name and description. If the source page had prose for this feature,
the queue below doesn't start empty — it's pre-seeded with best-guess
activities scanned out of that text, each clearly marked "(auto-guess —
review before creating)" and fully editable/removable like anything else in
the queue:

- A spell reference (a real `<a href="/spell:...">` link on wikidot pages —
  freeform sources fall back to matching "cast [the] &lt;Name&gt; [spell]"
  phrasing against the actual compendium index) becomes a **Cast** activity,
  with its uses formula guessed from an "your &lt;Ability&gt; modifier"
  phrase (e.g. `@abilities.cha.mod`) and its recovery period guessed from
  whichever of "Short Rest"/"Long Rest" appears first in the text.
- An "&lt;Ability&gt; saving throw" phrase becomes a **Save** activity, with
  the DC set to "spellcasting ability" if "spell save DC" appears nearby, and
  "half damage on a success" detected from the word "half".
- Dice next to a recognizable word (a damage type, or "Temporary Hit
  Points"/"hit points") become a **Damage** or **Heal** activity's formula —
  attached to the guessed Save activity's damage-on-fail if one was found,
  otherwise added as its own standalone activity.
- If the [DAE module](https://foundryvtt.com/packages/dae) ("Dynamic Effects
  using Active Effects") is active in your world, effect-shaped language is
  also scanned and pre-seeded as an **Effect**: "+X bonus to your AC",
  "resistance/immunity/vulnerability to &lt;type&gt; damage", "immune to the
  &lt;Condition&gt; condition" / "immune to being &lt;Condition&gt;" (e.g.
  the Archfey Patron's own "Beguiling Defenses" — "You are immune to the
  Charmed condition." — becomes a condition-immunity change, and the same
  pattern applies to any other condition: frightened, poisoned, stunned,
  ...), "&lt;walking/climbing/swimming/flying/burrowing&gt; speed increases
  by X feet", and "darkvision ... X feet". DAE isn't required to use
  effects at all — you can always build one by hand with **+ New Effect** —
  but auto-guessing effects specifically is gated on it being active, since
  that's what makes an attached effect reliably work end-to-end. If DAE
  isn't active and effect-shaped language is still detected, the dialog
  says how many were skipped and why instead of silently dropping them.
  (These patterns are deliberately narrow — a feature phrasing resistance
  as a comma-separated list, e.g. "resistance to bludgeoning, piercing, and
  slashing damage", won't be picked up; add it by hand in that case.)
- Separately from the DAE-gated changes above, a feature that grants a
  status to whoever has it — "You have the &lt;Condition&gt; condition
  until..." (e.g. the Archfey Patron's own "Disappearing Step" — "You have
  the Invisible condition until the start of your next turn...") — is
  scanned and pre-seeded as an **Effect** with that condition checked under
  "Conditions to apply". This one always runs, DAE or not: it sets the
  effect's own `statuses` field, a core Foundry mechanism unrelated to the
  DAE-dependent `changes` list above.

For example, importing Steps of the Fey (Archfey Patron, Level 3 — "cast
Misty Step a number of times equal to your Charisma modifier... regain uses
on a Long Rest... **Refreshing Step.** ...gains 1d10 Temporary Hit Points...
**Taunting Step.** ...Wisdom saving throw against your spell save DC...")
pre-seeds a Cast activity for Misty Step (`@abilities.cha.mod`, recovers on a
Long Rest), a Heal activity named **Refreshing Step** (`1d10`, Temporary Hit
Points), and a Save activity named **Taunting Step** (Wisdom, spellcasting
DC) — nothing left to build from scratch, just review and adjust. A bolded
lead-in like "**Refreshing Step.**" at the start of a paragraph (the wikidot
convention for a named sub-option inside one feature) keeps that name
attached to whatever mechanics are found in that paragraph specifically,
rather than losing it in one flattened blob of text.

Beyond the auto-seeded guesses, the same dialog also supports building
things by hand:

- **+ New Effect** — a standard Foundry ActiveEffect: name, whether it
  applies automatically or the player toggles it on, duration, a repeatable
  list of changes (key + mode + value/formula), and a checklist of
  conditions to apply (Invisible, Prone, ...) — separate from the changes
  list, since a status is its own field on the effect, not a `system.*`
  change.
- **+ New Activity** — pick a type (Save, Damage, Heal, Utility, or Cast) and
  fill in a form built for that type specifically: saving-throw ability and
  DC (spellcasting ability, a custom formula, or a fixed number),
  damage/healing parts with a formula + damage type each, and so on. Cast
  grants casting an existing spell without a slot — search for the spell the
  same way you'd search for a compendium match elsewhere in this dialog, and
  set a limited-uses formula (e.g. `@abilities.cha.mod`) with a recovery
  period if it isn't unlimited. Any activity can also be linked to one or
  more of the effects already queued below (e.g. a Save that applies an
  effect on a failed save) via a checklist in its form — only effects
  already in the queue can be linked, so add the effect first.
- **+ Copy from Compendium…** — search any indexed compendium item by name
  (same search used for "no match" rows), see its existing effects and
  activities, and pick one to copy as a starting point — it opens pre-filled
  in the same editor above so you can tweak it before adding it.

Every formula field has an "Insert:" row of buttons/dropdown for common
roll-data references (an ability modifier, proficiency bonus, character
level, feature level) so you don't have to remember the exact syntax.
Everything queued shows up in a running list with a Remove button; clicking
**Create Feature** builds the item with all of it attached, and it's all
still fully editable afterward on the item's own sheet — nothing here is a
one-way trip. **Cancel** on this step cancels creating the feature entirely.

## Matching rules

- Names are matched case-insensitively; a trailing parenthetical like
  `"Indomitable (One Use)"` is stripped to `"Indomitable"` before matching,
  since the compendium entry usually doesn't carry the qualifier.
- When a name exists in both a 2024-ruleset pack (`spells24`, `equipment24`,
  `classes24`, ...) and an older 2014/5e pack of the same name (a reprinted
  spell like Misty Step or Sleep is the common case), the module setting
  **"Preferred ruleset (2024 vs. 5e/2014)"** decides automatically instead of
  asking every time it comes up — defaults to "Always use 2024", but can be
  switched to "Always use 2014/5e (legacy)" or back to "Ask me each time" (the
  old behavior: every duplicate name shows both options to pick from,
  whether that's an ambiguous-match row in the report or a spell search in
  the Build Feature dialog's Cast activity / Copy from Compendium). This only
  ever collapses that specific 2024-vs-legacy duplicate — a genuinely
  ambiguous match between two unrelated packs (e.g. two different homebrew
  items sharing a name) always still prompts, regardless of this setting.
- Anything still ambiguous (multiple distinct matches) or unmatched is left
  blank and listed in the report — nothing blocks the rest of the import.
- The module setting **"Content to match against (player vs. monster)"**
  decides whether name lookups only consider player-facing compendiums
  (`classfeatures`, `spells`, `equipment24`, ...) or only monster/NPC ones
  (`monsterfeatures`, `monsterfeatures24`) — defaults to "Player content
  only". The excluded kind is never even indexed, so an incidental name
  collision with the other kind (e.g. a monster feature that happens to
  share a name with a player class feature) can never be offered as a
  match, a search result, or an ambiguous candidate.

## Known special cases

- **Artificer** isn't part of the 2024 PHB, so there's no `artificer`-specific
  2024 compendium pack — expect more "Unresolved" entries in the report than
  for the core 12 classes (spells still resolve well; class features may not).
  Its spellcasting progression is correctly set to Foundry's dedicated
  `"artificer"` type (not "half"), even though the wikidot table alone can't
  tell the two apart anymore.
