## What to build

Fix `parseToolProficiencies`'s tool-category branch (`scripts/scraper.mjs`),
which currently always builds `choices.push({ count: 1, pool: [...] })`
regardless of how many the source text actually allows. Confirmed live bug:
Crafter's "three different Artisan's Tools of your choice" and Musician's
"three Musical Instruments of your choice" both currently restrict the
player to picking only 1 instead of 3.

Check for a leading number word or digit in the same clause (the module
already has a `NUMBER_WORDS` table for this elsewhere) before defaulting
`count` to 1.

## Acceptance criteria

- [ ] `parseToolProficiencies` reads a stated quantity ("three", "3", etc.)
      from the clause and uses it as the choice's `count`.
- [ ] Verified against the real confirmed text: Crafter produces
      `choices: [{count:3, pool:["tool:art"]}]`, not `count:1`.
- [ ] Verified against Musician's real text the same way (`count:3` for
      musical instruments).
- [ ] A clause with no stated number (e.g. a plain "one type of Artisan's
      Tools of your choice") still defaults to `count:1` — confirmed via a
      regression case so the fix only changes behavior when a real quantity
      is present.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet) covering both cases above.

## Blocked by

None - can start immediately
