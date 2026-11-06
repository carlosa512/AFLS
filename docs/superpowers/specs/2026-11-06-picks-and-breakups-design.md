# After the throw: who picks it off, who breaks it up, and the pick's return

**Status:** built (0.4.8). Follows 0.4.7 (#155, fumble recoveries). MVP follow-ups: "Medium-High: after
an interception (L3408–3415)" and the breakup half of "Low: pass breakups credited on a flat 30% of incompletions (L3428)".

## Why

The odds of a pick are rich (depth, the passer, the cover man's ball skills, separation, pressure, the coverage, habits,
the safety over the top), and the share of incompletions with a breakup credited already matches the NFL's (30%). What
comes after is flat:

- **Who intercepts it:** the cover man 65%, else a safety by ball skills; a linebacker never unless he's the cover man, a
  lineman never.
- **The return:** normal(9, 10) floored at 0, plus 6% an exponential(30), whoever has it and from wherever.
- **Who's credited with a breakup:** always the cover man, at a flat 30% whatever the throw.

The NFL is nothing like flat on any of these (§1). The owner's calls: a ball batted at the line is in (a lineman bats it
down or tips it for a pick, and the film shows it); ratings decide who within the situation (the cover man first, then a
group by depth, ball skills or coverage within it); a new module beside `looseBall.ts`, sharing the return math.

## 1. The NFL (nflverse 2021–25, regular seasons; `scripts/research-picks.py`)

Passes with air yards, no sacks, spikes or two-point tries; bands as the engine's (`depthBand`: behind is air < 0): 2,055 picks (2.28% of attempts), 29,563 incompletions.
Groups from the season roster's position and depth-chart spot (CB; S; LB; the line with an OLB on the edge).

**Who intercepts it, by the throw's depth:**

| Throw           | Picks | CB   | S    | LB   | D-line |
| --------------- | ----- | ---- | ---- | ---- | ------ |
| Behind the line | 124   | 0.12 | 0.08 | 0.38 | 0.42   |
| 0–9 yards       | 637   | 0.40 | 0.26 | 0.31 | 0.03   |
| 10–19           | 651   | 0.44 | 0.39 | 0.16 | 0.01   |
| 20+             | 643   | 0.43 | 0.54 | 0.03 | 0      |

All picks: CB 0.405, S 0.378, LB 0.182, D-line 0.036. 84% of picks also credit their catcher with a pass defensed.

**The return, by the throw's depth:**

| Throw           | Nothing | 1–9  | 10–19 | 20+  | Mean | Pick-six | Yards to his goal (median) |
| --------------- | ------- | ---- | ----- | ---- | ---- | -------- | -------------------------- |
| Behind the line | 0.22    | 0.40 | 0.13  | 0.25 | 12.8 | 0.266    | 42                         |
| 0–9             | 0.34    | 0.22 | 0.13  | 0.31 | 16.4 | 0.184    | 53                         |
| 10–19           | 0.34    | 0.24 | 0.16  | 0.26 | 11.7 | 0.043    | 60                         |
| 20+             | 0.52    | 0.13 | 0.14  | 0.20 | 9.1  | 0.005    | 74                         |

By the catcher's group the returns barely differ (means: CB 12.2, S 12.2, LB 13.5, D-line 10.9): depth drives them.

**Breakups:** 30.8% of incompletions credit one, but 12% of incompletions are throwaways, which never reach the
engine's incompletion branch (the passer's own choice, `pocketChoice.ts`). Throwaways left out (FTN charting 2022–25,
20,633 incompletions): 0.355; by depth 0.456 behind the line (n 2,149), 0.369 at 0–9 (8,410), 0.349 at 10–19 (5,505),
0.288 at 20+ (4,569). Who: CB 0.467, S 0.194, LB 0.193, the line 0.146 (batted at the line).

## 2. Who gets to the ball (`match/defendedPass.ts`)

A pure module, no draws, no league reads.

- **`depthBand(air: number): Band`** — `'behind' | 'short' | 'mid' | 'deep'` for air < 0, 0–9, 10–19, 20+.
- **`pickCatcher(band, coverMan, onField, u1, u2): Player`** — the cover man when `u1 < COVER_PICKS[band]` (fitted so the
  groups land on §1's split), else a group by `PICK_GROUPS[band]` over the groups with men on the field (the cover man
  out), then a man of it weighted by `skill(·, 'ballSkills')`. The line's share is a ball tipped at the line: a man of
  the front (`dt`, `edge`) weighted as a batter (below).
- **`breakupRate(band): number`** — §1's share by depth, throwaways left out (today a flat 0.30).
- **`breakupBy(band, coverMan, onField, batter, u1, u2): Player`** — the cover man when `u1 < COVER_BREAKS[band]` (fitted
  so the credits land on §1's split), else a group: the line's share (`BAT_SHARE`, 0.146 of all) goes to the batter,
  the rest by group weighted by `skill(·, 'coverage')`.
- **`batterWeights(front, pressureBy): number[]`** — a rusher's height (`sizeZ`, tall men bat it) and the man the dropback
  charged with the pressure counting double: he's the one in the throwing lane.

`onField` is the defense's lineup (`cb`, `s`, `lb`, `dt`, `edge`), the eleven on the field.

## 3. The pick's return

The yard-band return (`none`, `1–9`, `10–19`, `20+` with a breakaway share that goes the distance, capped at the goal)
moves from `looseBall.ts` into `match/returnBands.ts`, `bandReturn(table, toGoal, u)`; `looseBall.ts` keeps its group
table and calls it, fumbles' numbers unchanged.

- **`pickReturn(band, toGoal, u): number`** — §1's bands by depth, each band's breakaway share fitted so pick-sixes land
  on §1's (0.266, 0.184, 0.043, 0.005), with `toGoal` the defense's yards to the end zone from the spot.
- **A tipped pick at the line** changes hands at the line (spot = the line of scrimmage, not the target's depth).
- Unchanged: a pick in the end zone is a touchback; a return that scores ends 2–4 yards deep; the turnover's shape.

## 4. The engine (`match/gameSim.ts`)

- The pick branch: `pickCatcher` and `pickReturn` in place of the flat catcher and return; `defInt` to the catcher,
  `passDef` to him 84% of the time.
- The incompletion branch: `breakupRate(band)` and `breakupBy` in place of the flat 30% and the cover man; `passDef` to
  the man credited. A batted ball reads `, batted down at the line by X`; a tipped pick
  `, tipped at the line, INTERCEPTED by X`.
- `SimOptions.defendedTap?: (tap: DefendedTap) => void` on every pass: the band, the outcome (pick, breakup, none), the
  man's group, batted or not, the return and a pick-six.
- No save change: no `SAVE_VERSION` bump. The dice move: pinned games are re-taken.

## 5. The film

- A pick in your games already runs its return on the open field from the named catcher (`turnoverFacts`): it takes the
  new man and the new return as they are.
- A ball batted at the line: the stager reads the text and ends the ball at the line in front of the batter, the batter
  squared up to the passer; in your games the pocket places the rushers and the batter is the one nearest the throwing
  lane. A tipped pick is drawn the same way, the lineman catching it there.

## 6. Checks

- **`npm run picks [-- games]`** (`scripts/picks.ts`, `scripts/picks-core.ts`, the shape of `npm run fumbles`): who
  intercepts by depth; breakups per incompletion by depth; who's credited with breakups, the line's share among them;
  the pick's 20+ returns and pick-sixes by depth; the share of picks crediting a pass defensed. A share is judged once
  its tolerance clears 3.5 standard errors and the NFL's sample is 200 or more; a mean return is reported only, as
  `npm run fumbles` does. Nothing may be ✗.
- **`npm run sim`** judges the same buckets (`calibrate.ts`).
- **Must hold:** `sim` (turnovers, scoring, the leaders' picks), `endings`, `quirks --effects` (Ball Hawk and the other
  pick habits move picks), `audit` (ball skills and coverage still move play), `parity`, `film`.

## 7. Tests

- `defendedPass.test.ts`: each band's group shares sum to one; the cover man first; a lineman only at the line (behind the
  line and 0–9) and never deep; within a group the better ball skills more often; the batter weighted by height and the
  pressure; the pick return capped at the goal.
- Engine: a tap per pass; `defInt`, `passDef` credited as the tap says; a tipped pick's spot at the line.
- Film: a batted ball ends at the line in front of its batter.

## 8. Docs

`docs/MVP.md`: "after an interception" ticked; the Low line Partial (breakups done; return touchdowns left). CLAUDE.md:
`match/defendedPass.ts` and `match/returnBands.ts` beside `match/looseBall.ts`, `npm run picks`. A 0.4.8 changelog entry;
`package.json` 0.4.8.
