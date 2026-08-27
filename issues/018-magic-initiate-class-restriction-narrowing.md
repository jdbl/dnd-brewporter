## What to build

Fix the confirmed Magic Initiate class-restriction bug from
`FEAT_AUDIT_REPORT.md`: all three D&D Beyond variants ("Magic Initiate
(Cleric)", "(Druid)", "(Wizard)") get an identical `ItemChoice`
`restriction.list: ["class:cleric","class:druid","class:wizard"]` on both
their cantrip and 1st-level-spell advancement entries, instead of each
being scoped to just its own class.

Root cause, found by tracing `copyOfficialFeatMechanics` in
`scripts/importer.mjs`: 2024's Magic Initiate is a single official feat
with an in-fiction class choice (pick any one of Cleric/Druid/Wizard's list
at selection), so dnd5e's own SRD compendium ships exactly one "Magic
Initiate" item covering all three — correctly, that's how the real rules
work. D&D Beyond instead splits it into three separately-purchasable named
variants. `normalizeName` strips the trailing `"(Cleric)"`-style
parenthetical before the name-index lookup runs, so all three DDB variants
resolve to that same single official item and its advancement gets copied
onto each of them verbatim, restriction list and all. This isn't a
prose-scanning bug — no amount of extending `scanSegmentText` would touch
it, since this whole path never runs the prose scanner at all when an
official-item match exists.

Added `narrowSpellRestrictionToVariantClass(advancement, ddbName)`: reads
the same trailing parenthetical the lookup already discarded, and — only
when that class is already present in a copied `ItemChoice`/`ItemGrant`
entry's `configuration.restriction.list` — narrows the list down to just
that one class. Never adds a class the source item didn't already offer,
so it's a no-op (safe to call unconditionally) for any feat with no
parenthetical, or one whose parenthetical doesn't match an already-present
class code. Generic across any future D&D Beyond feat that follows the
same "Name (Class)" splitting convention against a single shared official
item — not specific to Magic Initiate.

## Acceptance criteria

- [ ] `narrowSpellRestrictionToVariantClass` narrows a copied
      `["class:cleric","class:druid","class:wizard"]` list down to
      `["class:cleric"]` when the DDB name ends in `"(Cleric)"`, and
      likewise for Druid/Wizard.
- [ ] A `restriction.list` that does NOT already include the parenthetical
      class is left untouched (never adds a class the source didn't
      already offer).
- [ ] A feat name with no trailing parenthetical is a no-op.
- [ ] An advancement entry with no `configuration.restriction.list` at all
      (or a single-entry list) is left untouched.
- [ ] `copyOfficialFeatMechanics` calls this on every copied advancement
      object, not just Magic Initiate specifically.

## Blocked by

None - can start immediately
