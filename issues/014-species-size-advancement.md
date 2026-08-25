## What to build

Build a `Size` advancement entry for every imported species
(`scripts/ddb-scraper.mjs`), which currently gets none at all — every
imported species defaults to dnd5e's built-in Medium size regardless of its
real size. Confirmed via live world inspection: Halfling and Aarakocra both
have no `Size` advancement anywhere, only the existing `ItemGrant` of their
racial traits. Real dnd5e-shipped species (Human, Hill Dwarf) always carry a
`Size` entry.

Map `raceDef.sizeId` to dnd5e size codes via the confirmed live enum:
`3` → `["sm"]`, `4` → `["med"]`, `10` → `["sm","med"]` (a Small-or-Medium
choice, matching the real `configuration:{sizes:["sm","med"]}` shape used by
official 2024 Human). Any unrecognized `sizeId` should produce a warning in
the import report rather than a guessed value. Wire the new advancement into
`assembleRaceItem` alongside its existing `ItemGrant`.

## Acceptance criteria

- [ ] A new function builds a `Size`-type advancement entry in the same
      shape the module's other advancement builders use, from
      `raceDef.sizeId`.
- [ ] `assembleRaceItem` includes this entry in the race item's advancement.
- [ ] Verified live: Halfling, Lightfoot Halfling, Stout Halfling, Gnome,
      Rock Gnome, and Deep Gnome all import with a Small `Size` advancement
      (`sizeId: 3`); Human and other Medium species get Medium or the
      Small-or-Medium choice as appropriate (`sizeId: 4` or `10`).
- [ ] An unrecognized `sizeId` produces a warning in the import report
      rather than a silently-guessed size.

## Blocked by

None - can start immediately
