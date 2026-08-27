## What to build

`scanSegmentText`'s spell-name detector (the textual fallback used when a
segment has no structural `<a href="/spell:...">` link) only recognized a
spell name immediately preceded by "cast"/"casts"/"casting". Real 2024
feat prose overwhelmingly uses a different verb for a *granted, always-
prepared* spell: "you always have the Misty Step spell prepared" (Fey
Touched), "you always have the Entangle spell prepared" (Fey Sentinel),
"you always have the Armor of Agathys spell prepared" (Infernal Bulwark),
"you always have the Magic Weapon spell prepared" (Infernal Dragoon),
"you always have the Invisibility spell prepared" (Shadow Touched) — none
of these say "cast" anywhere near the spell's own name, so the detector
missed every one of them, even though the spell name is stated explicitly
(not a "choose from a list" case).

This also affects feats that are official 2024 PHB content but aren't
present in this world's `dnd5e.feats24` compendium (a "Free Rules" subset,
not the full PHB — confirmed by checking directly: "Fey Touched" isn't in
it, while "Grappler"/"Skilled"/"Magic Initiate" are) — for those,
`copyOfficialFeatMechanics` never fires (no official item to copy from),
so they fall into the exact same prose-scanning path as genuine homebrew.

Widened `scanSegmentText`'s spell-name regex's leading-verb alternation
from `casts?(?:ing)?` to also match `have`/`has`/`know`/`knows`/`learn`/
`learns`. This is broader as a *trigger*, but the existing hard gate --
a candidate must be an exact match against the real compendium spell
index, not just "looks like a name" -- is what actually prevents false
positives, exactly as it always has for "cast": an unrelated "have the
Invisible condition"-shaped sentence produces a candidate that simply
isn't in the spell index and gets silently dropped, same as today.

Once a spell name is found this way, it flows through the SAME already-
built, already-tested `cast`-type Activity pipeline `guessQueueEntries`
already has (no new mechanism) -- and the "always have X prepared, free
cast once per long rest" uses/recovery half of this is *already* covered
by issue 016's bare "once"/"twice" detection, so this fix only needed to
close the spell-name-detection gap, not build anything new downstream.

## Acceptance criteria

- [ ] "you always have the Misty Step spell prepared" (and the have/has/
      know/knows/learn/learns variants) is recognized as a spell-name hit
      when the name is a real compendium spell.
- [ ] An unrelated "have the X condition"/"have advantage on Y" sentence
      does not produce a spurious spell-name hit (the candidate isn't in
      the spell index, so it's dropped, same safety net as "cast").
- [ ] The existing "cast/casting the X spell" detection is unaffected.
- [ ] A spell name found this way, combined with "once...long rest"
      phrasing elsewhere in the same segment, produces a `cast` Activity
      with `uses.max`/`recovery` populated (confirms this composes with
      issue 016's uses/recovery wiring with no extra code).

## Blocked by

None - can start immediately (builds on 016's uses/recovery wiring, but
needs no changes to it)
