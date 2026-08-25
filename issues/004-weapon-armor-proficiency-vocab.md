## What to build

Add weapon and armor proficiency recognition to `guessProficiencyAdvancement`
(`scripts/scraper.mjs`), which currently only knows tool and skill
vocabulary. The correct `weapon:sim`/`weapon:mar` and `armor:lgt/med/hvy/shl`
category mapping already exists in this same file, inside `buildAdvancement`'s
class-table handling — port it into the prose-based proficiency detector
rather than re-deriving it. Also recognize "gain **training** with X," not
just "proficiency," since that's the real 2024 phrasing for armor grants.

Confirmed missing: Heavily/Lightly/Moderately Armored ("training with Heavy/
Light/Medium armor" [+ Shields for Lightly Armored]), Martial Weapon Training
("proficiency with Martial Weapons"), Elf Weapon Training ("longsword,
shortsword, shortbow, and longbow"), Dwarven Armor Training ("light and
medium armor"), Dwarven Combat Training ("battleaxe, handaxe, light hammer,
and warhammer"), Rune Knight/Order Domain/Twilight Domain's armor grants.

## Acceptance criteria

- [ ] `guessProficiencyAdvancement` recognizes weapon-category phrasing
      (simple/martial) and armor-category phrasing (light/medium/heavy/
      shields), producing the correct `weapon:*`/`armor:*` grant keys.
- [ ] Recognizes "gain training with X" as an additional trigger phrase
      alongside the existing "proficiency with/in X."
- [ ] Verified against the real confirmed text for Heavily Armored, Lightly
      Armored, Moderately Armored, Martial Weapon Training, Elf Weapon
      Training, Dwarven Armor Training, Dwarven Combat Training, and Rune
      Knight/Order Domain/Twilight Domain's Bonus Proficiencies.
- [ ] Existing tool/skill grant behavior is unaffected — confirmed via
      regression cases.
- [ ] Test coverage added to `test/proficiency-advancement.test.mjs` (create
      the file if it doesn't exist yet) covering the confirmed examples
      above.

## Blocked by

None - can start immediately
