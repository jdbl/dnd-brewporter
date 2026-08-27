## What to build

Fix `buildBackgroundAdvancement` (`scripts/ddb-scraper.mjs`), which currently
gates the "Choose Languages" `Trait` advancement entry behind
`backgroundDef.featureIsFeat` (a ruleset flag) instead of behind whether the
language data actually exists. Confirmed: a 2014-ruleset background (Acolyte,
Noble, Sage, Haunted One, etc.) carries the exact same
`languagesDescription` prose data as its 2024 counterpart, but currently gets
no "Choose Languages" advancement step at all, purely because of the
ruleset flag.

Change the gate from `backgroundDef.featureIsFeat` to a truthy check on
`backgroundDef.languagesDescription`.

## Acceptance criteria

- [ ] The "Choose Languages" advancement entry is built whenever
      `languagesDescription` is present, regardless of `featureIsFeat`.
- [ ] Verified against the real confirmed 2014-ruleset text for Acolyte,
      Noble, Sage, and Haunted One — each now gets the same blank,
      pre-hinted "Choose Languages" scaffold their 2024 counterparts already
      get.
- [ ] A background with no language data at all still gets no such entry
      (confirmed via a regression case) — this isn't a blanket "always add
      it," only a data-presence check.

## Blocked by

None - can start immediately
