# Player size, phase 4: screens and AI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** You see what a build means, in words, and front offices differ in how much they care.

**Architecture:** `scouting.ts` `buildNote` (one sentence in the scout report's notes, outliers only, the gem as a
read), `roster.ts` `spotNotes` (the head coach on a hand-sorted chart), `inbox.ts` `heightMismatch` (the opposition
report), `gmTraits.ts` `sizeBias` (derived from the GM's id), applied in `offseason/draft.ts` `boardScore`. Screens:
`SizeTag` on the player card and the combine panel, `SpotNotes` on the depth chart.

**Spec:** `docs/superpowers/specs/2026-10-27-player-size-design.md` (Phase 4).

## Global Constraints

- Words, never a percentile or a trait value; names through `PlayerLink`.
- The gem shows only as a read: our own players exactly; another club's when its knowledge is at least 0.6 (seen in
  proportion to it), with a seeded false read on an outlier now and then (8% × the doubt).
- `sizeBias` is a pure function of the GM's id (its own seeded stream): it follows the person, needs no save
  change and draws nothing from the league's stream.
- Branch `claude/vibrant-pascal-ntlfhz-4` from phase 3; PR base is phase 3's branch.

## Rulings

- The spec stored `GmTraits.sizeBias` with a save upgrade; it is derived instead (same behaviour, no migration).
- The bias applies on the draft board only. Free agency prices through the market and trades through `judge`; this
  evening's work showed the retained-salary market moves on small valuation changes, so they are left alone.
- The opposition report's height line is its own paragraph, as the coaching note is: the report's opening stays two
  or three sentences.

## Review fixes

- The coach's notes run the same auto-sort on the same available starters and speak only where it would move a player
  for his build (an elite small corner it keeps outside draws nothing); the nose note is gone with the nose reorder.
- The opposition line reads available players and only the receiver spots the opponent lines up (no slot in 12).
- `sizeBias` is seeded by the league too, so a franchise's GM differs from world to world; your own auto-pick carries
  no bias.
- The gem is a small or light player's story: never said of a big build. The build sentence comes last in the notes,
  after any habit. The tag's direction is in its text for screen readers, with the right article.

## Review Focus

1. Another club's player: the gem read must never be the truth by default (seeded on knowledge).
2. A user team with auto-sort on: no spot notes.
3. A missing starter (fewer than three corners or receivers): no mismatch line, no throw.

---

- [x] Tests (`size.test.ts`): no words for a median build and no digits in the words; our own gem told and untold;
      spot notes for a small corner outside, none with auto-sort; the measurables GM marks an undersized prospect
      down and a tape GM doesn't, nothing for a median build; the mismatch line names the inches only past 1.5 points.
- [x] Engine and screens as above; `inbox.test.ts`, `src/ui`, scouting, draft tests green.
- [ ] Docs, 0.2.5, PR.
