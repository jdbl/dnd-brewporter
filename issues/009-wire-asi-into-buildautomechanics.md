## What to build

Wire the already-correct `guessAbilityScoreAdvancement` detector into
`buildAutoMechanics` (`scripts/effects-builder.mjs`), which currently returns
proficiency-grant advancement but never merges in the ASI result. Nearly
every feat/trait/feature routed through the scan-fallback import path
contains the standard 2024 "increase your X score by 1, to a maximum of 20"
boilerplate, which the detector already parses correctly in isolation — it
just never reaches the built item today.

```
advancement: { ...(guessAbilityScoreAdvancement(html) ?? {}), ...guessProficiencyAdvancement(html) }
```

## Acceptance criteria

- [ ] `buildAutoMechanics`'s returned `advancement` includes a correct
      `AbilityScoreImprovement` entry whenever the description contains the
      standard boilerplate, alongside any proficiency-grant advancement.
- [ ] Verified against real confirmed text (e.g. Chef's "Increase your
      Constitution or Wisdom score by 1, to a maximum of 20") — the built
      feat now carries both the ASI and its proficiency grant together.
- [ ] Feats that already copy their full mechanics from an official
      compendium match (`copyOfficialFeatMechanics`) are unaffected — this
      only changes the scan-fallback path.
- [ ] A feature with no ASI boilerplate at all is unaffected (still returns
      just the proficiency-grant advancement, no empty/malformed ASI entry).

## Blocked by

None - can start immediately
