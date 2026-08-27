## What to build

`importDdbFeat` already has a trusted pattern for this exact problem
(`copyOfficialFeatMechanics`, `scripts/importer.mjs:866-885`): before falling
back to prose-guessing (`buildAutoMechanics`), look up a name match in the
installed compendium index and copy that official item's real
`effects`/`system.activities`/`system.advancement` wholesale. `importDdbRace`
(`scripts/importer.mjs:929-963`) never got the same treatment — every race
trait goes straight to `buildAutoMechanics`, even for the 9 core PHB 2024
species where dnd5e's own free `dnd5e.origins24` compendium ships the exact
same traits, by name, already correctly authored (verified directly against
that pack: Fey Ancestry, Keen Senses, Trance, Dwarven Resilience, Dwarven
Toughness, Stonecunning, Breath Weapon, Draconic Flight, Giant Ancestry,
Otherworldly Presence, Gnomish Cunning, Halfling Nimbleness, Luck, and Brave
all exist there today with real effects/activities — e.g. Gnomish Cunning's
official effect uses `system.abilities.int/wis/cha.save.roll.mode = 1`, and
Breath Weapon already has 2 fully-built activities with correct DC formula,
dice, and uses/recovery). Wiring this in fixes the large majority of gaps
found in `audits/species-*.md` in one low-risk change, without touching any
prose-parsing regex at all.

**1. Extend `buildNameIndex()`** (`scripts/importer.mjs:84-115`) to also
index each entry's `system.requirements` and `system.type.value` — add both
to the `fields` array passed to `pack.getIndex(...)` (currently
`["folder", "system.type.subtype"]`), and store them on each pushed index
entry (e.g. `raceRequirement: entry.system?.requirements`,
`raceCategory: entry.system?.type?.value`).

**2. Add `copyOfficialRaceTraitMechanics(item, raceDef, index, report)`**,
mirroring `copyOfficialFeatMechanics`'s body almost exactly (same
effects/activities/advancement copy — reuse that logic rather than
duplicating it if it can be factored out cleanly), but with a stricter match
than a feat's plain name lookup: only accept a candidate whose indexed
`raceCategory === "race"` (this is `system.type.value`, matching a race
trait's own shape — see `buildRaceTraitItemData`'s `type: { value: "race",
subtype: "" }` in `ddb-scraper.mjs:192`) **and** whose `raceRequirement`
normalizes to the same species as `raceDef.fullName` (reuse
`normalizeName`). This second check is required — race trait names collide
constantly across species (multiple species each have their own "Speed",
"Size", "Darkvision", "Ability Score Increase(s)", "Creature Type"), so a
bare name-only match (safe for feats, which are overwhelmingly
globally-unique) would silently copy the wrong species' data here. No match,
or more than one candidate surviving both filters, falls through to the
existing `buildAutoMechanics` prose-scan unchanged — same "copied ??
fall back" shape `importDdbFeat` already uses.

**3. Wire it into `importDdbRace`'s trait loop** (`scripts/importer.mjs`,
around line 943): try `copyOfficialRaceTraitMechanics` first; only call
`buildAutoMechanics` on the trait's own description text when that returns
false. Leave everything else in `importDdbRace` (the `traitsByLevel`
bookkeeping, `Item.create`, `report.created.push`, `mergeTraitDerivedMovement`
using `traitDescriptions`) untouched — copying mechanics doesn't change what
the trait item's own name/description/folder/level are.

**4. Do not touch `assembleRaceItem`/the race item itself** in this ticket —
scope this to trait items only. (The race item's own movement/size come from
`raceDef`'s own DDB data plus `buildSizeAdvancement`/`mergeTraitDerivedMovement`
already; extending copy-from-official to the race item's `ItemGrant`/`Trait`/
`ItemChoice` advancement entries, as seen on the official Human race item, is
a reasonable follow-up but is a separate, larger change — leave it for a
later ticket.)

Species with no official-content match at all (Genasi variants, Warforged,
Changeling, Aasimar, and any other homebrew/expanded species) are
unaffected — every one of their traits will simply miss both filters and
fall through to the existing `buildAutoMechanics` path exactly as today.

## Acceptance criteria

- [ ] `buildNameIndex()`'s index entries carry `raceRequirement` and
      `raceCategory` alongside the existing `classHint`/`subtype` fields.
- [ ] `copyOfficialRaceTraitMechanics` only ever copies from a candidate
      that is both `raceCategory === "race"` and requirement-matched to the
      trait's own species — verified with a test asserting it does NOT
      cross-match e.g. Dwarf's "Speed" onto a same-named "Speed" trait from
      a different species/pack.
- [ ] A trait whose name+species matches exactly one official item (e.g.
      Dragonborn's "Breath Weapon", Gnome's "Gnomish Cunning") gets that
      official item's real `effects`/`activities`/`advancement` copied
      verbatim (fresh `_id`s per the existing copy pattern), not a
      prose-guessed approximation.
- [ ] A trait with no official match (any non-core/homebrew species trait,
      or a core-species trait dnd5e's free compendium doesn't ship) still
      falls back to `buildAutoMechanics` exactly as before — no behavior
      change for those cases.
- [ ] Existing feat import (`importDdbFeat`/`copyOfficialFeatMechanics`) is
      completely unaffected — this is a new, separate function, not a
      modification of the feat path.
- [ ] `node --test test/` passes, including a new test file covering the
      match/no-match/wrong-species-collision cases above (mock `index`/
      `fromUuid` the same way existing importer tests do, if a pattern for
      that already exists in `test/`; otherwise unit-test the pure matching
      logic directly).

## Blocked by

None — can start immediately. Independent of issues 021 and 022 (different
functions/files; both are prose-parsing fallback improvements this ticket's
copy-first behavior doesn't depend on).
