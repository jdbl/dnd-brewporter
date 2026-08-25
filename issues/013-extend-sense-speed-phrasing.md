## What to build

Extend the existing darkvision/blindsight/truesight/speed regexes in
`scanSegmentText` (`scripts/scraper.mjs`) to cover confirmed real phrasings
they currently miss:

- Widen the darkvision/blindsight/truesight connector alternation to
  recognize "radius of" (currently only "out to|with|to|of") — confirmed
  missing on Superior Darkvision's "has a radius of 120 feet."
- Add an absolute-grant form ("you have a flying/swimming/climbing/burrowing
  speed of N feet") alongside the existing delta-only "increases by N feet"
  form — confirmed missing on Flight and Swim traits.
- Add "increases **to** N feet" as a second delta form (a target value, not
  an added amount) alongside the existing "increases **by** N feet" —
  confirmed missing on Fleet of Foot.

## Acceptance criteria

- [ ] The darkvision/blindsight/truesight connector alternation recognizes
      "radius of."
- [ ] A new absolute speed-grant pattern is recognized and produces the
      correct `system.attributes.movement.<key>` change.
- [ ] "Increases to N feet" is recognized as a delta form using the target
      value.
- [ ] Verified against the real confirmed text for Superior Darkvision,
      Flight, Swim, and Fleet of Foot.
- [ ] Existing "increases by N feet" and short-form darkvision/blindsight/
      truesight matches are unaffected — confirmed via regression cases.

## Blocked by

None - can start immediately
