## What to build

Add support for open/unnamed choice grants ("N skill(s) of your choice", "any
combination of N skills or tools of your choice") to
`guessProficiencyAdvancement` (`scripts/scraper.mjs`). Currently only a
named-tool-category choice ("one type of Artisan's Tools of your choice")
builds a `choices` entry — a fully open choice with no named pool at all
returns nothing. Real dnd5e precedent (the official Human "Skillful" trait)
uses a wildcard pool (`skills:*`) for exactly this shape.

Confirmed missing: Skillful/Skills ("one skill of your choice"), Skill
Versatility ("two skills of your choice"), Skilled/Boon of Skill ("any
combination of three skills or tools of your choice" / "proficiency in all
skills").

## Acceptance criteria

- [ ] `guessProficiencyAdvancement` recognizes "N skill(s) of your choice"
      (with no named skill list) and produces
      `choices: [{count:N, pool:["skills:*"]}]`.
- [ ] Recognizes the "any combination of N skills or tools" phrasing and
      produces a combined `["skills:*","tool:*"]` pool.
- [ ] Verified against the real confirmed text for Skillful, Skill
      Versatility, and Skilled (cross-checked against the real official
      Skilled item's own shipped `choices` shape on GitHub).
- [ ] A named-list choice (e.g. "choose 2 of the following: Deception,
      Insight") still resolves to the specific named pool, not a wildcard —
      confirmed this doesn't regress the fix from issue #001.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet).

## Blocked by

None - can start immediately
