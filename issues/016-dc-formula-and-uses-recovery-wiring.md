## What to build

Two generic parser upgrades to the reaction-gated/limited-use Activity
pipeline (`scanSegmentText` in `scripts/scraper.mjs`, consumed by
`guessQueueEntries`/`buildActivityData` in `scripts/effects-builder.mjs`).
Both are root causes repeated across a large fraction of the feats audited
in `FEAT_AUDIT_REPORT.md` as "Activity generated but non-functional stub" or
"Activity missing entirely" — fixing them here is expected to improve many
feats with zero feat-specific code, since the target schema
(`buildActivityData`'s `save.dc`/`uses`) is already fully generic and simply
isn't being populated.

**1. DC formula parsing.** `scanSegmentText`'s `savingThrow` detector
currently only records `dcSpellcasting` (a boolean for "spell save DC"
phrasing) — any non-spellcasting DC clause ("DC 8 + your Constitution
modifier + your Proficiency Bonus") is discarded entirely, and
`guessQueueEntries` hard-sets `dcValue: ""` whenever `dcSpellcasting` is
false. Add a `parseDcFormula(text)` helper that finds a `DC <N>` anchor and
collects any literally-named ability-modifier and/or proficiency-bonus
terms within a short window after it (any order, `+`/"plus" as connectors),
producing a formula string like `"8 + @abilities.con.mod + @prof"`. Wire
this into `savingThrow.dcFormula`, and have `guessQueueEntries` use
`dcMode: "formula"` with that value whenever it's non-null (falling back to
the existing `spellcasting`/`flat` behavior otherwise).

Deliberately out of scope: "the ability you increased with this feat" /
"your spellcasting ability modifier" self-referential DC terms (Telekinetic,
War Caster-style feats) are a player choice with no stable per-item
roll-data key dnd5e exposes for "whichever ability this specific feat's ASI
granted" — resolving that would need cross-referencing the item's own ASI
advancement at roll time, which the Activity DC formula field can't do.
Leave those terms out of the formula (still emit whatever IS resolvable,
e.g. `"8 + @prof"`) rather than guessing wrong.

**2. Uses/recovery wiring for every activity type, not just `cast`.**
`scanSegmentText` already computes `usesFormula`/`recoveryPeriod` per
segment, but `guessQueueEntries` only ever threads them into `cast`-type
activities — `save`/`damage`/`heal` activities always get `buildActivityData`'s
hard-coded `uses: { max: "", recovery: [] }`, even when the same segment's
`usesFormula`/`recoveryPeriod` were already detected. Generalize
`buildActivityData`'s base `uses` field to read `form.usesMax`/
`form.recoveryPeriod` for every type (removing the now-redundant duplicate
`uses` override in the `cast` branch), and have `guessQueueEntries` pass
`usesMax: seg.usesFormula ?? ""`, `recoveryPeriod: seg.recoveryPeriod ?? "lr"`
on the `save`/`damage`/`heal` branches the same way `cast` already does.

Also extend the existing "N times" uses-count detector: the far more common
D&D Beyond phrasing "usable **once** per long rest" / "**once** per short or
long rest" has no "times" suffix and isn't currently recognized at all (nor
is "twice"). Add a bare `once`/`twice` match, gated on an actual short/long
rest mention already being present in the same segment (so an unrelated
temporal "once" — "once you reach 5th level" — doesn't misfire into a
spurious limited-use resource).

## Acceptance criteria

- [ ] `parseDcFormula` extracts a correct formula for a literally-named
      single-ability DC clause ("DC 8 + your Constitution modifier + your
      Proficiency Bonus" → `"8 + @abilities.con.mod + @prof"`), in either
      term order, and returns `null` when no `DC <N>` anchor is present.
- [ ] `scanSegmentText`'s `savingThrow.dcFormula` is populated whenever a
      non-spellcasting DC clause is present; `dcSpellcasting` continues to
      take priority when "spell save DC" phrasing is present.
- [ ] `guessQueueEntries` builds `save` activities with `dcMode: "formula"`
      and the parsed value instead of an always-empty flat DC.
- [ ] `save`/`damage`/`heal` activities built from a segment that also
      carries a detected `usesFormula`/`recoveryPeriod` get a populated
      `uses.max`/`uses.recovery`, not the empty default.
- [ ] Bare "once"/"twice" (no "times" suffix) is recognized as a 1/2 use
      count when a short/long rest mention is present in the same segment;
      unrelated "once" usage elsewhere does not produce a spurious uses cap.
- [ ] Regression: existing "N times" and "<Ability> modifier" uses-count
      detection, and existing `dcSpellcasting`/flat-DC behavior where no DC
      clause is present, are unaffected.
- [ ] Manual "Build Feature" dialog activities (built from user-filled form
      fields, not auto-guessed) are unaffected — `usesMax`/`recoveryPeriod`
      simply aren't set on those form objects, same as before.

## Blocked by

None - can start immediately
