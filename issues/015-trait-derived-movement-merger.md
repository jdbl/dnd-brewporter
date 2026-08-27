## What to build

Merge speed data stated only in a granted child trait's own description into
the parent species item's own `movement` data (`scripts/ddb-scraper.mjs`).
Currently `assembleRaceItem` builds `system.movement` solely from
`raceDef.weightSpeeds?.normal`, but some species instead encode a non-default
speed as prose on a separately-granted trait, which never reaches the race
item's own movement data at all. Confirmed live:

- Water Genasi's race item has `movement: {walk:"30"}` only (no swim), yet
  grants a "Swim" trait whose entire description is "You have a swimming
  speed of 30 feet."
- Wood Elf's race item has `movement.walk:"30"` (the base), but grants a
  "Fleet of Foot" trait reading "Your base walking speed increases to 35
  feet."

After a species' racial trait items are built (their description text is
already in hand at that point, before the race item itself is assembled),
scan each trait's description for the two confirmed real phrasings (the same
absolute-grant and "increases to" patterns from issue #013) and merge any
hits into the race item's own `movement` object — only filling a direction
`weightSpeeds` didn't already set, or taking the higher value specifically
for walking speed.

## Acceptance criteria

- [ ] A new function scans a species' built trait descriptions for speed
      language and returns a merged movement object.
- [ ] Wired into `assembleRaceItem`/`importDdbRace`, running after traits are
      built but before the race item is assembled.
- [ ] Verified live: Water Genasi's race item now has `movement.swim: "30"`.
- [ ] Verified live: Wood Elf's race item now has `movement.walk: "35"`
      (the higher, trait-derived value, not the base 30).
- [ ] A species with no such trait (e.g. Air Genasi) is unaffected — still
      shows plain `weightSpeeds`-derived movement, confirmed via a
      regression check.

## Blocked by

None - can start immediately
