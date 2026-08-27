## What to build

Recognize a Reaction/Bonus-Action-gated self-grant of a condition as a
genuine (if conditional) grant, and build it as a toggle-style effect
(`transfer:false` + a real duration) rather than either a permanent always-on
effect or nothing at all. Confirmed case: Fey Sentinel — "you can take a
Reaction to gain the Invisible condition until the start of your next
turn..." This is a genuine self-grant (unlike issue #007's false positives),
but building it as `transfer:true`/permanent would be wrong — it should only
apply when the player actually triggers it, the same shape already
established for the previously-fixed Stonecunning case (`transfer:false`
with a real duration on the shipped official item).

Detect the "you can take a Reaction/Bonus Action to gain/give yourself..."
phrasing pattern and route it to build a toggle-style ActiveEffect
(`transfer:false`, duration parsed from the "until..." clause when present)
instead of the permanent-effect shape the detector uses elsewhere.

## Acceptance criteria

- [ ] Detects "you can take a Reaction/Bonus Action to gain/give yourself
      the X condition" as a genuine self-grant, distinct from issue #007's
      rejected guard/negation cases.
- [ ] Builds the resulting effect as `transfer:false` with a duration parsed
      from the "until..." clause when one is present, matching the
      Stonecunning precedent.
- [ ] Verified against the real confirmed Fey Sentinel text — produces a
      working Invisible toggle effect, not a permanent one and not nothing.
- [ ] Test coverage added to `test/self-grant-guard.test.mjs` (create the
      file if it doesn't exist yet) covering the confirmed Fey Sentinel case.

## Blocked by

None - can start immediately
