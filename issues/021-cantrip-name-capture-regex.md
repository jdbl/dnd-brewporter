## What to build

`scanSegmentText`'s spell-name fallback regex (`scripts/scraper.mjs:422`,
`castRe`) already special-cases the word "spell" so a phrase like "cast the
Fireball spell" captures the clean candidate "Fireball" rather than
"Fireball spell" — the repeated-word group has a negative lookahead
excluding "spell" (`(?!spell\b)`), and a trailing `(?:spell)?` consumes it
separately. Nothing equivalent exists for "cantrip"/"cantrips", which is
just as common in real D&D Beyond racial-trait text ("you know the Minor
Illusion cantrip", "you know the Mending and Prestidigitation cantrips").
Confirmed live (species audits for Elf, Gnome, and Tiefling all hit this
independently): the candidate capture group swallows "cantrip" as if it were
part of the name (e.g. "Minor Illusion Cantrip"), which then fails the
`index.has(normalizeName(candidate))` compendium lookup gate and silently
drops the spell grant entirely — affects Elf's Elven Lineage cantrips,
Gnome's Gnomish Lineage cantrips, and Tiefling's Otherworldly Presence /
Infernal Legacy / Fiendish Legacy cantrips, at minimum.

Extend the existing "spell" handling to also cover "cantrip"/"cantrips" the
same way: exclude it from the repeated-word capture group's negative
lookahead, and consume it in the trailing optional suffix alongside "spell".

## Acceptance criteria

- [ ] "You know the Minor Illusion cantrip" (single cantrip, no "spell"
      wrapper) resolves the candidate to "Minor Illusion", not "Minor
      Illusion Cantrip" or similar.
- [ ] "You know the Mending and Prestidigitation cantrips" (plural, two
      names) resolves both candidates cleanly.
- [ ] Existing "spell"-suffixed phrasing ("cast the Fireball spell") is
      unaffected — no regression on the case this regex already handles.
- [ ] Phrasing with neither "spell" nor "cantrip" as a trailing word (e.g.
      "you always have the Misty Step spell prepared" — actually has
      "spell"; find/add a genuinely bare case if one exists in the
      audited species text) continues to work as today.
- [ ] `node --test test/` passes, including a new or extended test
      exercising the cantrip cases above against `scanSegmentText`'s
      `spellNames` output (a fake `index`/`Map` with the relevant spell
      names is fine, matching how other `scanSegmentText` tests already
      stub the compendium index).

## Blocked by

None — can start immediately. Independent of issues 020 and 022 (different
function, `castRe` in `scanSegmentText`, not touched by either).
