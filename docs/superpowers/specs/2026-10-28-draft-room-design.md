# Draft room redesign

**Goal:** give the Front Office's draft tab the look of the Home page and make draft day easy to read: who is up,
your next pick, your staff's best fits, how risky each prospect is, where your staff disagrees with the league, and
how your past picks turned out. NFL war room, not a spreadsheet.

**Decided with the owner (2026-10-28):** war-room hero on top (A); past picks judged provisional from year one,
faded, then locked after year three (C, then lock A); a floor-to-ceiling risk bar per row (A); staff vs consensus as
a pill on every row (A, always a pill); the tab moves to its own screen file with an engine helper (approach 1).

## What doesn't change

AI drafting, `boardOf`, the consensus, pick order and every sim number. This is a screen plus pure reads, one stored
field (the locked verdict) and its migration. MVP item 9 is already Done, so this is a PATCH bump (0.2.10 → 0.2.11)
with a changelog entry.

## Files

- `src/ui/screens/Draft.tsx` (new): the draft tab, moved out of `FrontOffice.tsx` with `DraftHistory`, `YourPicks`
  and the board cells (`BoardDrillCell`, `BoardMakeup`, `BoardHabits`). Split into `DraftClock`, `StaffTop5`,
  `BigBoard`, `DraftHistory`, `YourPicks`. `FrontOffice.tsx` imports `Draft`.
- `src/engine/draftGrade.ts` (new): pick verdicts, the lock, risk and staff-gap reads. Pure; tests in
  `src/engine/draftGrade.test.ts`.
- `src/engine/scouting.ts`: export `tierOf` and the tier count (no behaviour change).
- `src/engine/types.ts`: `draft.verdict?: PickVerdict`.
- `src/engine/offseason/index.ts`: call `lockVerdicts` in `beginOffseason`.
- `src/engine/generate.ts` / `migrate.ts`: `SAVE_VERSION` 58 → 59; the upgrade locks every pick already past year
  three from today's read.
- `src/styles.css`: hero, top-5 cards, risk bar, verdict pills (Home's tokens: `home-grid`, `home-cell`, `facts`,
  `eyebrow`).
- `package.json`, `src/ui/changelog.ts`: 0.2.11.

## Layout

One `home-grid`, top to bottom.

1. **Clock hero** (`span-12`).
   - Draft phase, a pick on the clock: a large `TeamChip`, "Round 2 · Pick 41", the headline "You're on the clock"
     (gold accent border) or "<Team> on the clock". The last three picks as a ticker (team chip, position,
     `PlayerLink`, the reach/steal pill). A `facts` row: *Your next pick* (No. 57, 16 away, or "None left"),
     *Your picks left*, *Scouting visits left*. Actions on the right, as today: Next pick, Sim to my pick (when not
     up), Auto-pick for me (when up), Sim the rest.
   - Draft complete: "The draft is complete" with a facts row of your picks made.
   - Outside the draft phase, with a class generated: "<season> draft class" with *Prospects*, *Your first pick*
     (round and number when set), *Scouting visits left*. No ticker, no actions.
2. **Staff's top 5 available** (`span-12`, only while prospects are available): your board's five best
   (`myBoardValue`, as today), as compact cards in a row (wrapping on a phone): `PlayerLink` with avatar, position,
   your grade (`Ovr`), the risk bar, the staff-gap pill, and a Draft button when you are up.
3. **Big board** (`span-12`): still a `SortTh` table with the Consensus / Your board seg, drill select and position
   filter. Columns: rank + Player (sticky), Pos, School (`OriginTag`), Drill, Your grade, **Risk** (replaces
   Ceiling; sorts by the ceiling's best guess), **Consensus** (the gap pill; sorts by the gap), Known, **Notes**
   (makeup and habits in one cell, one pill each at most), actions (sticky). Dropped: Age (nearly all 21–22) and
   Stars (they repeat the grade). Paging as today. "How to read the board" rewritten for the new columns.
4. **Your picks** (`span-4`) beside **Draft history** (`span-8`); each takes the full row on a phone.

## Pick verdicts (`draftGrade.ts`)

```ts
export type PickVerdict = 'steal' | 'hit' | 'miss';
export interface PickMark { verdict: PickVerdict | null; locked: boolean } // null = too early
```

- **The bar by round** (tier index, 0 = elite … 6 = camp body, from `tierOf`): R1 → 1 (high-end starter),
  R2 → 2 (solid starter), R3 → 3 (fringe starter), R4–7 → 4 (quality backup).
- **What is judged:** the tier of `perceive(league, userTeamId, p).potMid` at his position: where your scouts think
  he tops out (it is his current level once he is done growing).
- **Verdict:** tier ≤ bar − 2 → steal; tier ≤ bar → hit; else miss. A first-rounder is a hit or a miss.
- **`pickMark(league, p)`:** `draft.verdict` when stored (locked). Otherwise, before his first snap
  (`experience === 0` and no `ceilingShifts`) → too early; else the live verdict, not locked.
- **`lockVerdicts(league)`:** at the start of each league year, every player from a draft this league held
  (`p.draft && p.scouting`) whose draft season is three or more league years back and who has no verdict gets one,
  from the user's club's read at that moment. Retired players included. Written once, never changed.
- **Migration (v59):** runs `lockVerdicts` once on load.

## Risk (`riskOf(view)`)

- **Bar:** from the grade now (`view.ovr`) to the top of the ceiling range (`view.potHi`), drawn on the 1–20 scale;
  the solid part runs to `potMid`, the faded part from `potMid` to `potHi`.
- **Word:** **Safe** when upside is small and the read is tight (`potMid − ovr` and `potSd` both low);
  **Boom-or-bust** when most of his value is upside or the read is loose (`potMid − ovr` large or `potSd` high).
  Otherwise no word. Thresholds are set so roughly the top and bottom fifth of a class get a word; they live as
  named constants with a test on a generated class.

## Staff vs consensus (`staffGap`)

- Consensus rank minus your board rank (`myBoardValue` order over the available class). Positive = your staff likes
  him more.
- **Always a pill:** grey "▲3" / "▼5" / "=" under 12 spots; green "Sleeper ▲14" at 12 or more; amber "Fade ▼13" at
  −12 or less (the same 12-pick line as `reachOrSteal`).

## Draft history and your picks

- **Verdict column** in Draft history, sortable (steal, hit, miss, too early). Locked: a solid pill (green Steal,
  plain Hit, red Miss). Provisional: the same pill, faded and dashed, titled "Early read: locks after his third
  season". Too early: a grey pill. The reach/steal pill stays: draft position against the consensus, a different
  question from how he turned out.
- **Your picks** adds one line per past draft year with locked marks: "2027: 1 steal, 2 hits, 3 misses".

## Fog of war

Everything reads the user's club's view (`perceive`/`viewOf`, `Ovr`). No `player.ratings`, `playerOvr`,
`player.potential` or `player.ceilingShifts` in the screen (`pickMark` reads `ceilingShifts` only to know whether he
has played, inside the engine). The new screen file falls under the screen-contract tests in `ui/ui.test.ts`.

## Testing

- `draftGrade.test.ts`: the bar per round; steal / hit / miss edges; too early before the first snap; the lock fires
  once at year three and never rewrites; the migration locks old picks; risk words hit roughly a fifth each end of a
  generated class; gap pills at ±12.
- Locally: `npm run typecheck` and the touched tests. CI runs the rest.
- Screenshots of the tab (before the draft, on the clock, history with marks) sent to the owner before the PR.
