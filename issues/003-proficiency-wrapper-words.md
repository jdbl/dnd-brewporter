## What to build

Fix the exact-name lookup in `guessProficiencyAdvancement`/`toolCode`/
`skillCode` (`scripts/scraper.mjs`) so that real D&D Beyond wrapper phrasing
— a leading "the" and, for skills, a trailing "skill(s)" — doesn't defeat an
otherwise-unambiguous grant. Confirmed: Infernal Pact ("proficiency in the
Deception skill"), Fey Pact ("Proficiency in the Nature skill"), Poisoner
("proficiency with the Poisoner's Kit"), Keen Senses ("proficiency in the
Perception skill"), Menacing, and Natural Athlete all currently return
nothing at all because of these wrapper words alone.

Strip a leading `the\s+` and a trailing `\s+skills?` from each proficiency
piece before the `TOOL_CODES`/`SKILL_CODES` lookup.

## Acceptance criteria

- [ ] `guessProficiencyAdvancement` recognizes "proficiency in/with the X
      skill/tool" phrasing.
- [ ] Verified against the real confirmed text for Infernal Pact, Fey Pact,
      Poisoner, Keen Senses, Menacing, and Natural Athlete — each now
      produces the correct single grant instead of `{}`.
- [ ] A plain grant with no wrapper words (e.g. "proficiency in Perception")
      still works identically — confirmed via a regression case.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet) covering all six confirmed examples.

## Blocked by

None - can start immediately
