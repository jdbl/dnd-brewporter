## What to build

Drop the Title-Case requirement from the textual spell-cast fallback detector
(`castRe` in `scanSegmentText`, `scripts/scraper.mjs`). Real D&D Beyond prose
almost always writes spell names lowercase ("cast the misty step spell"),
unlike wikidot's Title-Case class-feature text this detector was originally
written against — confirmed the current regex produces zero matches against
real DDB race-trait/feat text (Fey Step, Merge with Stone, Mingle with the
Wind, Fey Touched, Shadow Touched, Telepathic, Magic Initiate, and more all
currently miss entirely).

Remove the `[A-Z]` requirement on the captured name. The detector's existing
safety net — the candidate name must exact-match a real compendium spell via
`index.has(normalizeName(candidate))` — already prevents this relaxation from
producing false positives on arbitrary lowercase phrases.

## Acceptance criteria

- [ ] The spell-cast fallback detector matches lowercase spell names
      ("cast the misty step spell") in addition to Title Case.
- [ ] Verified against the real confirmed text for Fey Step, Merge with
      Stone, and Mingle with the Wind — each now correctly links its granted
      spell.
- [ ] A candidate name that does NOT exist in the compendium index still
      produces no match (confirmed via a regression case) — the existing
      safety net is unaffected by this change.
- [ ] Existing wikidot Title-Case matches (e.g. structural `<a href="/spell:...">`
      links, and any existing Title-Case textual matches) are unaffected.

## Blocked by

None - can start immediately
