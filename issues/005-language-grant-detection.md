## What to build

Add language-grant detection to `guessProficiencyAdvancement`
(`scripts/scraper.mjs`). The real 2024 PHB boilerplate "you learn to speak,
read, and write X" never contains the word "proficiency," so it's currently
structurally invisible to the detector regardless of any other fix.
Confirmed missing: Rune Knight's Bonus Proficiencies ("proficiency with
smith's tools, and you learn to speak, read, and write Giant" — the tool
grant already works after issue #004/existing logic, the Giant language
grant vanishes with no trace).

Add a small language name→key map (matching dnd5e's own `languages:standard:x`
scheme, already used elsewhere in this codebase — see `ddb-scraper.mjs`) and
a dedicated regex for "speak, read, and write X," independent of the word
"proficiency" appearing anywhere in the sentence.

## Acceptance criteria

- [ ] `guessProficiencyAdvancement` recognizes "learn to speak, read, and
      write X" and produces a `languages:standard:x` grant.
- [ ] Verified against the real confirmed Rune Knight text — both the tool
      grant AND the Giant language grant are present in the result.
- [ ] Confirmed the language key used (e.g. `giant`) matches a real entry in
      dnd5e's `CONFIG.DND5E.languages`.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet).

## Blocked by

None - can start immediately
