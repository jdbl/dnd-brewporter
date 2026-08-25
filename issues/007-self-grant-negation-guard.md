## What to build

Fix the self-granted-condition and condition-immunity detectors in
`scanSegmentText` (`scripts/scraper.mjs`), which currently have no way to
tell a guard/negated clause or a third-party subject from a genuine
self-grant. This is a **live, currently-wrong effect** on already-imported
content, not just a missing detection: importing Shield Master right now
makes its own wielder permanently Prone.

Confirmed live misfires:
- Athlete — "When you **have** the Prone condition..." (a guard, not a grant)
- Mounted Combatant — "...neither of you **can have** the Incapacitated
  condition" / "...if you don't have the Incapacitated condition" (negated)
- Pack Fighting — "...the ally **doesn't have** the Incapacitated condition"
  (negated, and about an ally, not the feat's owner)
- Shield Master — "...cause **it** to have the Prone condition" (the attack's
  target, not the wielder)
- Prone Fighting — "**While you have** the Prone condition..."
- Infernal Dragoon — "it is immune to **this ability** for 24 hours" (a
  different kind of immunity than a condition-immunity grant)

Add a guard check that rejects a match when the text immediately before it
contains a negation/modal (`when|while|if you (already )?have`, `doesn't/
don't/can't have`, `neither`) or a third-party subject (`it`, `the target`,
`that creature`, `the ally`, `your mount`, etc.). Preserve the existing
"saving throw" and "until...or" guards already in place — this adds to them,
it doesn't replace them.

## Acceptance criteria

- [ ] The self-granted-condition detector no longer misfires on any of the
      six confirmed examples above (Athlete, Mounted Combatant, Pack
      Fighting, Shield Master, Prone Fighting, Infernal Dragoon) — each now
      produces no self-granted-condition effect.
- [ ] The condition-immunity detector has an equivalent guard for "immune to
      **this** [ability]" vs. "immune to **the [condition]** condition"
      (the Infernal Dragoon case specifically).
- [ ] The already-fixed genuine self-grants (Draconic Flight/Celestial
      Revelation false positives, fixed earlier; Disappearing Step's real
      "you have the Invisible condition until..." grant) still behave
      correctly — confirmed via regression cases in both directions.
- [ ] Test coverage added to `test/self-grant-guard.test.mjs` (create the
      file if it doesn't exist yet) covering all confirmed misfires plus the
      regression cases, using `node:test`.
- [ ] Does not touch `copyOfficialFeatMechanics` or any other higher-trust
      code path.

## Blocked by

None - can start immediately
