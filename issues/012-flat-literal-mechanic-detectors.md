## What to build

Add two narrow, literal-phrase detectors to `scanSegmentText`
(`scripts/scraper.mjs`), each targeting a flat, dice-free mechanic with a
confirmed real dnd5e Active Effect key:

- "Hit Point maximum increases by N... again whenever you gain a level" →
  `system.attributes.hp.bonuses.level` (confirmed via the real shipped
  Dwarven Toughness item).
- "count as one size larger... for carrying capacity" → the dedicated
  boolean flag `flags.dnd5e.powerfulBuild` (confirmed via the real shipped
  Powerful Build item) — no number to parse, just a literal phrase match.

## Acceptance criteria

- [ ] Detects the HP-per-level phrasing and produces the correct
      `system.attributes.hp.bonuses.level` change with the right value.
- [ ] Detects the "count as one size larger for carrying capacity" phrasing
      and produces the `flags.dnd5e.powerfulBuild` boolean flag.
- [ ] Verified against the real confirmed text for Dwarven Toughness and
      Powerful Build.
- [ ] Both detectors are narrow literal-phrase matches, not general numeric
      parsing — confirmed they don't misfire on unrelated HP/size language
      elsewhere in the existing test fixtures.

## Blocked by

None - can start immediately
