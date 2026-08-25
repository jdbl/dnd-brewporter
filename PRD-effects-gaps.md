# PRD: Fix Confirmed Auto-Mechanics Bugs and Close Verified Detection Gaps

## Problem Statement

When a GM imports D&D Beyond content through Brewporter, the importer tries to
auto-build each item's mechanical parts (Active Effects, dnd5e Activities, and
Advancement entries) straight from the real D&D Beyond description text, so
the GM doesn't have to hand-build every feat, racial trait, and feature from
scratch. A recent four-way audit of every already-imported feat, race trait,
subclass/class feature, and species/background item in a live world — each
finding verified against real dnd5e-shipped source rather than guessed — found
that this automation is currently:

- **Actively wrong** in a handful of concrete cases: importing **Shield
  Master** right now makes its own wielder permanently Prone instead of the
  target it knocks down, and choosing between two skill options (e.g. Order
  Domain's Intimidation-or-Persuasion) silently grants *both* instead of
  letting the player pick one.
- **Silently incomplete** in many more cases that share a small number of
  recurring, verifiable patterns: proficiency grants for weapons/armor/
  languages are never recognized at all; every species imports as Medium
  size, even the ones that are canonically Small (Halfling, Gnome); Ability
  Score Improvement is detected correctly but never actually reaches the
  built item; and several sense/speed/spell-grant phrasings that D&D Beyond
  actually uses aren't recognized by patterns that were written against
  slightly different wording.

The result is that a GM importing content today can't fully trust the
automation — they have to manually inspect and hand-fix a meaningful fraction
of what gets created, and in a few cases the automation actively hands them
something wrong rather than merely incomplete.

## Solution

Fix the three confirmed live bugs, and extend the auto-detection scanner with
the eleven additional gaps that were independently verified — against
official dnd5e-shipped content, not assumption — as safe to generalize.
Preserve the project's existing trust boundary throughout: only ever build a
mechanic that's been confirmed representable in dnd5e's real data model; when
a pattern *can't* be safely generalized (already re-confirmed this audit for
advantage/disadvantage grants and Expertise, both of which official content
itself leaves undetected), leave it alone rather than inventing something the
system can't actually enforce.

Along the way, extract the two highest-risk, highest-complexity pieces of
detection logic — proficiency-clause parsing and self-grant attribution —
into small, pure, Foundry-independent functions, and give them the project's
first real unit tests.

## User Stories

1. As a GM importing **Shield Master**, I want it to not permanently apply
   Prone to its own wielder, so that an imported feat can't corrupt a
   character's status.
2. As a GM importing **Athlete**, **Mounted Combatant**, **Pack Fighting**,
   **Prone Fighting**, **Fey Sentinel**, or **Infernal Dragoon**, I want the
   importer to not misattribute a status condition to the wrong subject
   (the wielder instead of a target, or a guard clause instead of a real
   grant), so that these feats are safe to import without manual review.
3. As a GM importing **Order Domain**'s Bonus Proficiencies or a race trait
   like **Changeling Instincts**, I want an "X or Y" skill choice to actually
   be offered as a choice, so that players pick their own proficiency
   instead of both/all being silently auto-granted.
4. As a GM importing **Crafter** or **Musician**, I want the tool-proficiency
   choice count to match the feat's real text (three tools, not one), so
   players aren't restricted below what the feat actually allows.
5. As a GM importing any feat, race trait, or feature carrying the standard
   2024 "increase your ability score by 1" boilerplate, I want that Ability
   Score Improvement to actually land on the item's advancement, so I don't
   have to add it by hand every single time.
6. As a GM importing **Infernal Pact**, **Fey Pact**, **Poisoner**, **Keen
   Senses**, **Menacing**, or **Natural Athlete**, I want "proficiency in/
   with the X skill/tool" phrasing to be recognized despite the wrapper
   words, so that straightforward grants aren't silently dropped.
7. As a GM importing **Heavily/Lightly/Moderately Armored**, **Martial
   Weapon Training**, **Elf Weapon Training**, **Dwarven Armor/Combat
   Training**, **Rune Knight**, **Order Domain**, or **Twilight Domain**, I
   want weapon and armor proficiency grants to be recognized, so these
   common 2024 patterns aren't invisible to the importer.
8. As a GM importing **Rune Knight**'s Bonus Proficiencies, I want the
   language grant ("learn to speak, read, and write Giant") to be
   recognized, so the character's known languages are set up automatically.
9. As a GM importing **Skillful**, **Skills**, **Skill Versatility**,
   **Skilled**, or **Boon of Skill**, I want "N skills of your choice" to
   build a real choice-based proficiency grant, so players get to pick
   their own skills at character creation instead of getting nothing.
10. As a GM importing a race trait or feat that references casting a spell
    in real D&D Beyond's lowercase prose style (e.g. Fey Step's "cast the
    misty step spell"), I want the spell reference to be recognized and
    linked, so the granted spell shows up correctly without manual linking.
11. As a GM importing **Dwarven Toughness**, I want the "+1 max HP per
    level" mechanic to apply automatically, so HP scaling doesn't require
    manual tracking every level-up.
12. As a GM importing **Powerful Build**, I want the "count as one size
    larger for carrying capacity" flag to be set automatically, so
    encumbrance calculations are correct without manual flag-setting.
13. As a GM importing **Superior Darkvision**, **Flight**, **Swim**, or
    **Fleet of Foot**, I want these sense/speed grants — in whichever of
    their real phrasings D&D Beyond actually uses — to be recognized, so
    movement and vision are set up correctly regardless of exact wording.
14. As a GM importing a species like **Water Genasi** or **Wood Elf**, I
    want the species' own movement speed to reflect a speed value D&D
    Beyond only states on a separately-granted trait's description, so the
    character sheet shows the correct swim/walk speed without me
    cross-referencing trait text by hand.
15. As a GM importing any species, I want it to get the correct Size
    advancement (Small, Medium, or a Small-or-Medium choice) based on D&D
    Beyond's own size data, so Halflings, Gnomes, and similar species don't
    default to the wrong creature size.
16. As a GM importing a 2014-ruleset background (**Acolyte**, **Noble**,
    **Sage**, **Haunted One**, etc.), I want a "Choose Languages"
    advancement step to appear just like it does for the 2024 version of
    the same background, so background-granted languages aren't silently
    dropped based on ruleset alone.
17. As a module maintainer, I want the tool/skill/weapon/armor/language
    proficiency-parsing logic consolidated into one well-defined, pure
    function, so future gaps in this area are easy to find, fix, and test
    in one place instead of scattered across several detectors.
18. As a module maintainer, I want the self-grant attribution logic
    (negation/subject/reaction guards) extracted into one shared, tested
    function, so both the status-condition and immunity detectors benefit
    from the same fix and don't drift out of sync with each other later.
19. As a module maintainer, I want unit tests for the proficiency clause
    parser and the self-grant guard, so future changes to these
    high-risk detectors can be verified without running inside Foundry or
    re-importing content by hand every time.
20. As a module maintainer, I want a lightweight, dependency-free test
    runner wired up for these pure functions, so testing doesn't require
    adding new npm dependencies to a project that currently has none.
21. As a GM, I want all of these fixes to preserve the project's existing
    safety principle — only auto-build a mechanic that's been verified
    against real dnd5e content, never guess — so the importer's output
    stays trustworthy and these fixes don't introduce new false positives
    while removing old ones.
22. As a GM, I want feats whose mechanics are already copied wholesale from
    a matching official compendium item (the existing higher-trust
    `copyOfficialFeatMechanics` path) to keep working exactly as they do
    today, so this work only changes the scan-fallback path, not the path
    that already works by copying real official data.

## Implementation Decisions

**Proficiency clause parser** (new pure function, replacing/absorbing the
current `parseToolProficiencies` plus the ad hoc skill-matching logic inside
`guessProficiencyAdvancement`). Given one already-isolated proficiency clause
of text, returns `{ grants: string[], choices: {count, pool}[] }`, covering:
- Tool names and tool categories (existing `TOOL_CODES` / `TOOL_CATEGORY_WORDS`
  vocabulary, reused as-is).
- Skill names (existing `SKILL_CODES`), with a leading "the" and a trailing
  "skill(s)" stripped before the exact-match lookup, and "X or Y" phrasing
  producing a `{count:1, pool:[...]}` choice instead of two unconditional
  grants (the confirmed skill-choice bug).
- Weapon categories (new vocabulary, ported from the existing class-table
  handling in `buildAdvancement`) — `weapon:sim` / `weapon:mar`.
- Armor categories (same source, ported the same way) — `armor:lgt/med/hvy/shl`.
- Languages (new name→key map, matching dnd5e's own `languages:standard:x`
  scheme already used elsewhere in this codebase) plus a dedicated match for
  the "speak, read, and write X" 2024 boilerplate, independent of the word
  "proficiency" appearing anywhere.
- Quantity parsing: a leading number word or digit in the clause (e.g. "three
  different Artisan's Tools") sets the built choice's `count`, replacing the
  currently-hardcoded `count: 1`.
- "N of your choice" with no named pool at all → a wildcard pool (`skills:*`
  / `tool:*`), matching the real shape used by the official Human "Skillful"
  trait.
- The existing `guessProficiencyAdvancement` becomes a thin wrapper: it still
  owns finding proficiency-shaped clauses in a feature's text and wrapping the
  merged result in the `Trait` advancement entry shape; the new function owns
  everything about interpreting one clause's content.

**Self-grant guard** (new pure function, shared by both the self-granted-
status detector and the condition-immunity detector inside `scanSegmentText`).
Given a sentence and the position of a matched "condition" mention, returns
whether it's a genuine self-grant. Rejects:
- A preceding negation or modal guard (`when/while/if you (already) have`,
  `doesn't/don't/can't have`, `neither`).
- A preceding third-party subject immediately before the match (`it`, `the
  target`, `that creature`, `the ally`, `your mount`, etc.).
Recognizes, as a distinct case, a genuine Reaction/Bonus-Action-gated
self-grant ("you can take a Reaction to gain the Invisible condition
until...") — this should still build an effect, but as `transfer:false` with
a real duration, the same shape already used for the previously-fixed
Stonecunning case, not as a permanent always-on effect. The existing
"saving throw" and "until...or" guards already in place are preserved, folded
into this shared function rather than removed.

**Size advancement builder** (new, in `ddb-scraper.mjs`). Maps a race
definition's `sizeId` field to dnd5e size codes via a confirmed live mapping
(`3` → `["sm"]`, `4` → `["med"]`, `10` → `["sm","med"]`; any unrecognized id
produces a warning in the import report rather than a guessed value) and
returns a `Size`-type advancement entry in the same shape the module's other
advancement builders already use. Wired into the race item's assembly
alongside its existing `ItemGrant` advancement of racial traits.

**Trait-derived movement merger** (new, in `ddb-scraper.mjs`). After a
species' racial trait items are built (their description text is already in
hand at that point), scans each trait's description for the two confirmed
real phrasings — "you have a walking/swimming/flying/climbing/burrowing
speed of N feet" and "your base walking speed increases to N feet" — and
merges any hits into the race item's own movement data (only filling a
direction the base speed data didn't already set, or taking the higher value
specifically for walking speed). Runs before the race item itself is
assembled.

**Sense/speed detector extension** (modification to the existing pattern set
inside `scanSegmentText`, not a new module): widen the darkvision connector
alternation to also recognize "radius of"; add the absolute-grant phrasing
("you have a flying/swimming/climbing/burrowing speed of N feet") alongside
the existing delta-only "increases by N feet" form; add "increases to N
feet" as a second delta form (a target value, not an added amount).

**Ability Score Improvement wiring fix** (small modification): the shared
`buildAutoMechanics` function — used by every scan-fallback import path
(feats, racial traits, background features, auto-created class/subclass
features) — currently returns proficiency-grant advancement but never merges
in the result of the already-correct ASI detector. Fix merges both into the
same returned advancement object.

**Background language-advancement gate fix** (small modification): the
background advancement builder currently gates its "Choose Languages" entry
on a ruleset flag (`featureIsFeat`) rather than on whether the underlying
language data actually exists. Fix changes the gate to a truthy check on the
language description field itself, independent of ruleset — so a 2014-style
background gets the same "Choose Languages" step a 2024-style one already
does.

**Spell-cast detector relaxation** (small modification): the textual
spell-reference fallback currently requires Title Case in the captured name,
which real D&D Beyond prose almost never uses. Drop that requirement; rely
on the detector's existing safety net (the candidate name must exact-match a
real compendium spell) to prevent false positives, unchanged from today.

**Two literal flat-mechanic detectors** (small additions, no new
infrastructure): "Hit Point maximum increases by N... whenever you gain a
level" → a hit-point-bonus-per-level change; "count as one size larger...
for carrying capacity" → the dedicated boolean flag dnd5e's own shipped
Powerful Build item uses (no number to parse).

## Testing Decisions

A good test here exercises external behavior — given this real input text,
does the function produce the right output data shape and values — not
internal details like which specific regex matched or in what order clauses
were visited.

- **Modules getting real automated tests**: the proficiency clause parser and
  the self-grant guard. These are the two highest-complexity, highest-risk
  pieces of logic in this PRD (the proficiency parser already accounts for
  two of the three confirmed bugs; the self-grant guard directly targets the
  Shield-Master-class bugs), and both are pure string-in/data-out functions
  with no dependency on Foundry globals or DOMParser.
  - Proficiency clause parser: table-driven tests, one case per confirmed
    real-text example surfaced by the audit (Infernal Pact, Fey Pact,
    Poisoner, Keen Senses, Menacing, Natural Athlete, Order Domain's "or"
    case, Changeling Instincts, Crafter, Musician, Rune Knight's language
    grant, Heavily/Lightly/Moderately Armored, Martial Weapon Training, Elf
    Weapon Training, Dwarven Armor/Combat Training, Skillful/Skill
    Versatility/Skilled), plus a couple of already-working cases (a plain
    tool grant, a plain skill grant) as regression coverage so the
    refactor can't silently break what already works.
  - Self-grant guard: table-driven tests using the exact confirmed-misfiring
    sentences from the audit (Athlete, Mounted Combatant, Pack Fighting,
    Shield Master, Prone Fighting, Fey Sentinel, Infernal Dragoon), each
    asserting the guard correctly rejects them, plus the already-fixed
    Draconic Flight/Celestial Revelation cases and the genuine Disappearing
    Step self-grant as regression coverage in both directions.
- **Modules not getting dedicated automated tests for now**: the Size
  advancement builder (low complexity, a small lookup table) and the
  trait-derived movement merger (moderate complexity, but lower priority) —
  both verified instead via the same manual live-import spot-check method
  used throughout the audit that produced this PRD.
- **Test runner**: Node's built-in `node:test` — zero new dependencies,
  matching this project's current zero-npm-dependency footprint (its only
  other backend code, the wikidot proxy, is also plain Node with no
  `package.json`). Tests run via `node --test` against a new `test/`
  directory.
- **Prior art**: none in this codebase currently — this introduces the
  project's first automated tests. They're scoped deliberately to pure
  functions only, matching the module's own existing design intent (several
  of the detector functions this PRD touches already carry comments noting
  they're meant to stay callable outside a running Foundry client).

## Out of Scope

- The eight "needs manual/bespoke work" items identified in the audit
  (temporary/activated sense and speed grants, multi-branch lineage/legacy
  features, DC-formula extraction, bonus-action activation detection on save
  activities, forced-movement-on-save consequences, permanent-cantrip
  ItemGrant instead of a Cast activity, Expertise-on-a-miss ItemChoice,
  Tough's per-level HP bonus, Actor's Mimicry check) — each needs its own
  design decision and building block, not a shared pattern fix, and is
  deferred to future work.
- The "needs verification" finding from the audit (every sampled feat
  showing empty advancement/activities even for names that should copy
  wholesale from an official match) — needs a live console spot-check first
  to confirm whether it's a real code bug or an artifact of how the audit
  exported its data, before any fix is designed or scoped.
- Retroactive repair of already-imported world items. These fixes apply to
  future imports; no migration or backfill tooling for existing Foundry
  worlds is included. A GM who wants the fixes on already-imported content
  re-runs the import.
- Any changes to the interactive "Build Feature" review dialog used by the
  wikidot/homebrew manual-review path. All of this work is confined to the
  automatic, DDB-trusted-text detection path (`buildAutoMechanics` and its
  callers), not the manual review flow.
- Re-litigating advantage/disadvantage or Expertise auto-detection — both
  were explicitly re-confirmed this audit as not safely buildable in core
  dnd5e (verified against real official items, which leave them undetected
  too) and are not revisited here.

## Further Notes

- Two of the three confirmed bugs — the self-grant misattribution and the
  skill "or" grants-vs-choice bug — were each independently rediscovered by
  two separate audit passes working from different data slices without
  seeing each other's results, which is a stronger signal than either
  finding alone that they're real and worth fixing first.
- The `sizeId` enum (3 = Small, 4 = Medium, 10 = Small-or-Medium choice) was
  confirmed directly against live D&D Beyond API data while preparing this
  PRD, not inferred or guessed.
- Every safe-fix recommendation in this PRD was independently verified by
  the auditing work against real dnd5e-shipped content (via the
  `foundryvtt/dnd5e` GitHub repository) before being included here — none
  of the "safe to generalize" claims are speculative.
