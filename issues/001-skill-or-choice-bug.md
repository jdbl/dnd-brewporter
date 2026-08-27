## What to build

Fix `guessProficiencyAdvancement` (`scripts/scraper.mjs`) so that "proficiency
in X or Y"-style skill phrasing builds a real choose-1 `Trait` advancement
choice instead of unconditionally granting every option. Confirmed live bug:
Order Domain's "Intimidation or Persuasion (your choice)" and Changeling
Instincts' "two of the following...: Deception, Insight, Intimidation,
Performance, or Persuasion" both currently grant *all* listed skills instead
of offering a pick.

Detect "or"-joined skill lists within a proficiency clause and emit
`choices: [{count, pool}]` for that group instead of pushing each skill name
to `grants`. "And"-joined lists are unaffected (still unconditional grants).
When the clause states an explicit count ("two of the following..."), use it;
default to 1 when the list is a simple "X or Y" with no stated count.

## Acceptance criteria

- [ ] `guessProficiencyAdvancement` no longer returns unconditional grants for
      an "or"-joined skill list; it returns a `choices` entry instead.
- [ ] Verified against the real confirmed text: Order Domain ("Intimidation
      or Persuasion") produces `choices: [{count:1, pool:["skills:itm","skills:per"]}]`,
      not `grants: ["skills:itm","skills:per"]`.
- [ ] Verified against Changeling Instincts' real text (five-option "two of
      the following" list) — produces `choices: [{count:2, pool:[...all five...]}]`,
      not five unconditional grants.
- [ ] "And"-joined skill lists (e.g. a feat granting two skills unconditionally)
      are unaffected — still produce `grants`, confirmed via a regression case.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet) covering both cases above using
      `node:test`.
- [ ] Does not touch `copyOfficialFeatMechanics` or any other higher-trust
      code path — this fix is scoped to the scan-fallback proficiency
      detector only.

## Blocked by

None - can start immediately
