## What to build

Multiple species audits (Orc, Dragonborn, Goliath, Tiefling, Human)
independently found the same pattern: a single species' `racialTraits` array
sometimes contains **both** a legacy/2014-ruleset version and a current
2024-PHB version of conceptually the same trait, both surviving
`usableRacialTraits`'s only filter (`hideInSheet`, `scripts/ddb-scraper.mjs:165-169`)
and both getting imported as separate Feature items — e.g. Orc's "Adrenaline
Rush" (2024) alongside "Relentless Endurance" (2014, the trait it replaced),
Dragonborn's and Goliath's duplicated Ability-Score-Increase/Powerful-Build/
Breath-Weapon/Draconic-Ancestry pairs with genuinely different mechanical
text per copy (confirmed by direct comparison of `descriptionHtml` between
copies — these are not identical re-run duplicates). Nothing in the current
pipeline detects or flags this; it's currently silent.

The actual DDB API shape that causes this (whether it's a per-trait
rules-version field this pipeline could filter on, or something upstream of
`raceDef.racialTraits` entirely) can't be confirmed from the static
description-text data available to this codebase's tests — do not guess at
an automatic pick-the-right-one heuristic. Confirmed instead, empirically,
against the actual `dnd5e.origins24` compendium: `system.identifier` on a
race trait is derived from `slugify(name)`
(`scripts/ddb-scraper.mjs:193`), so two same-concept traits with slightly
different names (e.g. "Ability Score Increase" vs "Ability Score Increases",
or two traits literally both named "Powerful Build") either produce
different identifiers that look like unrelated traits, or — worse, per the
Goliath audit — collide on the exact same identifier despite being
mechanically different traits. Either way, a human reviewing the import
report is better positioned to catch this than a silent guess.

**Build a duplicate-name detector, not a dedup/drop heuristic.** In
`usableRacialTraits` (or its caller, `importDdbRace`,
`scripts/importer.mjs:929-963`), after filtering, check for traits sharing
the same `slugify(name)` or a near-identical name (e.g. exact match after
stripping a trailing "s" — "Ability Score Increase" vs "Ability Score
Increases", or an exact duplicate name like "Powerful Build" appearing
twice) within one species' trait list. When found, push a
`report.warnings` entry (matching the existing shape `buildSizeAdvancement`'s
caller already uses, `{ context: raceDef.fullName, reason: "..." }") naming
both trait items so a human notices and can manually remove/merge the
wrong one — do not skip creating either item; both still import exactly as
today, this only adds visibility.

## Acceptance criteria

- [ ] A species whose `racialTraits` contains two traits with the same
      `slugify`d identifier, or two traits whose names are identical except
      for a trailing plural "s" (case-insensitive), produces one
      `report.warnings` entry per colliding pair naming both trait names.
- [ ] A species with no such collisions produces no new warnings and is
      otherwise completely unaffected — both trait items still get created
      exactly as before in every case (this ticket only adds a warning, it
      never drops or merges a trait).
- [ ] The warning text is specific enough to act on (species name, both
      colliding trait names) — not a generic "duplicate detected" message.
- [ ] `node --test test/` passes, including a new test constructing a
      `raceDef` with a deliberately duplicated trait pair and asserting the
      resulting `report.warnings` contains the expected entry.

## Blocked by

None — can start immediately. Independent of issues 020 and 021 (different
function — `usableRacialTraits`/`importDdbRace`'s warning collection, not
the mechanics-building or spell-name-capture code either of those touch).
