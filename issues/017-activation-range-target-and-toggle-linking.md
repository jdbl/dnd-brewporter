## What to build

Follow-up to issue 016 — four more generic parser upgrades to the same
`scanSegmentText`/`guessQueueEntries`/`buildActivityData` pipeline, again
targeting root causes repeated across many feats in `FEAT_AUDIT_REPORT.md`
rather than per-feat rules.

**1. Activation type + trigger condition.** Every guessed activity
previously defaulted to a plain `"action"` with an empty `activation.condition`
regardless of what the prose said. Add `parseActivation(text)`: detects
explicit "as a Reaction"/"using your Reaction"/"take a Reaction" phrasing
(→ `"reaction"`), the equivalent Bonus Action phrasing (→ `"bonus"`), "as an
action" (→ `"action"`), and a leading `"When X, ..."` / `"Immediately after
X, ..."` trigger clause (→ `activation.condition`, and → `"special"` when no
explicit action-economy word is present, matching dnd5e's own "Special"
category for a triggered-but-off-the-normal-economy ability). Wired into
every activity type built by `guessQueueEntries`, including `cast` (which
previously hard-coded `"action"` even for something like War Caster's
Reactive Spell).

**2. Dice + text-modifier merging.** The dice-hint regex only accepted a
literal numeric modifier right after a dice term (`1d8+2`); a text modifier
("1d10 + your Proficiency Bonus") made it fail to match *at all*, silently
dropping the die and leaving only a disconnected flat `@prof` hint from the
separate proficiency-bonus scanner (confirmed real misfire: Interception).
Extended the dice regex to optionally chain one or more `+ <term>` clauses
(a number, an ability-modifier phrase, or a proficiency-bonus phrase with
multiplier) directly onto the dice term, normalized into one combined
roll-data formula. The standalone proficiency-bonus scanner now skips any
match already folded into a merged formula so the same mention isn't
double-counted as a second, redundant hint.

**3. Range and target parsing.** `range`/`target` stayed at the default
empty shape for every guessed activity. Added `parseRangeAndTarget(text)`:
`"within N feet"` → `range.value`/`units`; `"N-foot
emanation/sphere/cone/cube/line/cylinder/square/wall"` → `target.template`;
`"up to N creatures"` / `"N creatures of your choice"` → `target.affects`.
Field names and the `"emanation"` → `type: "radius"` mapping were confirmed
against real dnd5e-shipped data before writing this (Fireball for
range+sphere template, Bless for `affects.count`/`type`, Aura of Protection
for the Emanation→radius mapping), not guessed blind — this data ships
straight onto imported World Items with no human review step, so an
incorrect schema field name here would be worse than not building it at
all.

**4. Link a toggle effect to a real Activity.** A Reaction/Bonus-Action-gated
self-grant (`toggleStatusHints`, e.g. Fey Sentinel's "you can take a
Reaction to gain the Invisible condition") was already built as a
`transfer:false` effect, but no Activity ever referenced it when that was
the segment's *only* mechanic — the effect existed but nothing could ever
apply it (confirmed real bug: Fey Sentinel). When a segment's only guessed
mechanic is one or more toggle effects, `guessQueueEntries` now also builds
a `utility` Activity carrying the segment's own detected activation
type/condition (from fix 1, using the very same trigger phrasing the toggle
detector matched on) with every toggle effect from that segment linked
onto it via `effects: [{_id}]`.

## Acceptance criteria

- [ ] `parseActivation` correctly identifies Reaction/Bonus Action/Action
      phrasing across the alternations listed above, and captures a
      leading `"When"`/`"Whenever"`/`"If"`/`"Immediately after"` clause as
      `condition`, falling back to `"special"` when a trigger is found with
      no explicit action-economy word.
- [ ] Every activity type built by `guessQueueEntries` (`save`, `damage`,
      `heal`, `cast`, `utility`) receives the segment's detected
      `activationType`/`activationCondition` instead of the old hard-coded
      default.
- [ ] `"1d10 + your Proficiency Bonus"` (and multi-term chains like
      `"2d6 + your Charisma modifier + your Proficiency Bonus"`) merge into
      one correct combined formula; the standalone proficiency-bonus
      scanner does not also produce a redundant second hint for the same
      mention.
- [ ] `"within N feet"`, area-template phrasings, and multi-creature-target
      phrasings populate `range`/`target` with the schema-confirmed field
      names; absent when no such phrasing is present.
- [ ] A segment whose only guessed mechanic is a toggle effect gets a
      linked `utility` Activity; a segment where a toggle effect coexists
      with an already-built save/damage/heal/cast activity is left as
      before (not double-built).
- [ ] Regression: existing dice-only formulas (no modifier suffix),
      existing standalone proficiency-bonus hints unrelated to a dice term,
      and existing toggle-effect generation are unaffected.

## Blocked by

016-dc-formula-and-uses-recovery-wiring (shares `scanSegmentText`'s
`savingThrow`/uses plumbing this builds on top of)
