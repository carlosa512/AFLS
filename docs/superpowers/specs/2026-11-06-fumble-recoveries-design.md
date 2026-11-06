# Fumble recoveries and the strip-sack

**Status:** designed (2026-11-06), not built. Follows 0.4.6 (#154, fumbles on contact). MVP follow-ups: "Medium: fumble
recoveries (L2903)" and the strip part of "Medium: a sack's yards and strip (L3815)"; also the "lost per 100" line 0.4.6
left to this item.

## Why

Once the ball is out, today's engine decides everything with flat rolls:

- **Who gets it:** the defense 52% (`fumbleRecoveredByDefense`), whatever the play or how the ball came out.
- **Who's credited:** the tackle picker; on a strip-sack the sacker half the time.
- **The return:** a roll by play type (runs and scrambles 10% for 5–40 else 0–3, catches 0–5, sacks 15% for 5–30 else
  0), whoever has the ball.
- **The strip-sack:** a flat 10% of sacks (18% for Pat-The-Rock), reading nothing about the rusher or the quarterback.

The NFL is nothing like flat on any of these (§1). The owner's calls: who and how far, recovered at the spot (no bounce);
the situation decides who wins the ball, ratings only who's credited; one new module for the loose ball, the strip-sack's
odds beside the contact fumble's; the blind side out, the rusher's spot in (the data shows no blind-side effect, §1).

## 1. The NFL (nflverse 2021–25, regular seasons; `scripts/research-fumbles.py`)

**Strip-sacks, per sack (6,552 sacks):** all 12.36%; early downs 13.82%; 3rd and 1–3 10.47%, 4–9 9.98%, 10+ 10.18%
(n 363, 1,433, 845); 4th 15.03% (n 193); trailing late 15.94% (n 640); leading late 9.09% (n 121). By the sacker's
listed position: edge (DE, OLB) 14.0% (n 3,960), a DB 13.1% (n 519), an off-ball linebacker 8.6% (n 637), interior (DT,
NT) 8.0% (n 1,416). Forced: 92% (747 of 815 sack fumbles). The blind side, from 2025's sided depth charts (left-handed
passers out): the end over the left tackle 9.4% (n 223), over the right tackle 11.6% (n 258): no edge, so no term.

**Who gets it (lost share of fumbles):**

| Play     | Fumbles | All  | Forced | His own | Out of bounds |
| -------- | ------- | ---- | ------ | ------- | ------------- |
| Run      | 1,033   | 0.42 | 0.60   | 0.26    | 4%            |
| Catch    | 662     | 0.50 | 0.54   | 0.21    | 19%           |
| Sack     | 810     | 0.51 | 0.52   | 0.38    | 4%            |
| Scramble | 64      | 0.47 | 0.48   | —       | 28%           |

A ball out of bounds stays the offense's; with no bounce here it is folded into these shares.

**Who's credited (defensive recoveries):** the man who forced it 13% (runs 15%, catches 13%, sacks: the sacker 11%,
scrambles 7%). The rest by position group:

| Play     | DB   | LB   | D-line |
| -------- | ---- | ---- | ------ |
| Run      | 0.38 | 0.36 | 0.26   |
| Catch    | 0.58 | 0.29 | 0.13   |
| Sack     | 0.13 | 0.37 | 0.51   |
| Scramble | 0.50 | 0.36 | 0.14   |

**The return, by who has it (1,193 recoveries):**

| Recovered by | Zero or less | 1–9  | 10–19 | 20+  | Mean | Touchdown |
| ------------ | ------------ | ---- | ----- | ---- | ---- | --------- |
| DB           | 0.64         | 0.17 | 0.08  | 0.12 | 6.7  | 8.1%      |
| LB           | 0.70         | 0.16 | 0.06  | 0.07 | 3.9  | 7.1%      |
| D-line       | 0.84         | 0.09 | 0.04  | 0.03 | 2.1  | 5.2%      |

Return touchdowns by play: runs 5.1%, catches 5.1%, sacks 11.1% (the ball loose in the backfield, nobody behind it).

## 2. The strip-sack (`sackStripOdds` in `match/fumbleOdds.ts`)

The shape of `fumbleOdds`: a base times exp(the sum of named terms, each zero for a typical sack) times the weather
(`wx.fumble`), clamped, drawing nothing.

- **The quarterback:** ball security against a typical quarterback (`PEER_SECURITY.QB`); Pat-The-Rock (today ×1.8, a
  named lean); energy below `TYPICAL.energy`.
- **The rusher:** his spot (`RUSH_SPOT`: an EDGE or a DB at the edge rate, a DT, LB at the interior rate, from §1),
  his tackling and `sizeEdge(rusher, 'contact', qb)`; Thumper, Arm Tackler and Ball-Stripper as on contact.
- **The situation:** 3rd down below base, trailing late above; 4th down and leading late held at base (too few NFL
  sacks to judge).
- **Forced:** `forcedOdds('sack')` 0.92. An unforced one credits no forced fumble; its text is the contact fumble's own
  (", puts it on the ground"), so the film reads it as it reads a carrier's.

It replaces the flat 10%/18%. Its constants are fitted on weeks 1 and 10 of played seasons, as `npm run sim` reads them.

## 3. The loose ball (`match/looseBall.ts`)

A pure module, no draws, no league reads; the engine rolls against what it returns.

- **`defenseRecovers(kind, forced): number`** — the lost share by play and forced or own (§1's table); a scramble
  the quarterback fumbled himself takes a sack's own share (0.38: the NFL has four).
- **`recovererGroup(kind): Record<'DB' | 'LB' | 'DL', number>`** and **`FORCER_RECOVERS`** (by kind) — who on the
  defense is credited: the forcer first, else a group by §1's split, then a man of that group on the field (the
  engine's lineup: `cb`/`s`, `lb`, `edge`/`dt`), weighted evenly. A group with nobody on the field passes to the next.
- **`returnYards(group, toGoal, u): number`** — the return from the group's distribution (zero or less, 1–9, 10–19,
  20+ by §1, the tail an exponential), capped at `toGoal`: reaching it is a touchdown. Sack touchdowns run higher
  because the spot is deeper, not by hand.

An offensive recovery stays "Fumble, recovered by the offense" (no man named, no stat), as today.

## 4. The engine (`match/gameSim.ts`)

- Every fumble (run, catch, scramble through `contact()`; the sack through the strip roll) goes through one helper that
  asks `looseBall.ts` and builds the turnover. `fumbleRecoveredByDefense`, the 50%-sacker recoverer, the four return
  rolls and the flat strip go.
- The turnover keeps its shape (`spot`, `returnYds`, `by`): drives, the clock, scoring and the return touchdown text are
  untouched. Stats as today: `fumbles`, `fumblesLost`, `forcedFum` only when forced, `fumRec`.
- Taps: `contactTap` gains the recovery (`lost`, the recoverer's group, `returnYds`, `td`); a new `stripTap` reports
  every sack (the rusher's spot, the situation, `fumbled`, `forced`, and the same recovery fields).
- No save change: no `SAVE_VERSION` bump. The dice move: pinned games are re-taken.

## 5. The film

- A lost strip-sack in your games already plays its return on the open field from the named recoverer
  (`turnoverFacts`); it gets the new man and the new return as they are.
- A lost run or catch fumble is drawn, the named recoverer at the ball, his return to the entry's `to`.
- A sack fumble the quarterback lost himself reads ", puts it on the ground": `field/fumble.ts` already knows it.

## 6. Checks

- **`npm run fumbles`** grows: strip-sacks per 100 sacks by bucket (all, early, 3rd short, mid, long, 4th, trailing
  and leading late) and by the rusher's spot (edge, interior); the forced share on sacks; lost per 100 by play; the
  defense's share forced and own by play; the recoverer's group split by play and the forcer's share; returns by group
  (mean, 20+ share, touchdown share). Judged as before: a bucket only when its tolerance is 3.5 standard errors or
  more, and its NFL sample is 500 or more. Nothing may be ✗.
- **`npm run sim`** judges the buckets (`calibrate.ts`).
- `scripts/research-fumbles.py` prints §1's tables.
- **Must hold:** `sim` (turnovers, scoring, the leaders), `endings`, `quirks --effects` (Pat-The-Rock still moves
  strip-sacks), `audit` (ball security, tackling), `parity` and `film`.

## 7. Tests

- `looseBall.test.ts`: each share in range, each group split sums to one, the forcer's share, a return capped at the
  goal (a touchdown only when it reaches it), a D-lineman's return shorter than a DB's on the same draw.
- `fumbleOdds.test.ts`: `sackStripOdds` sits on its base for a typical sack; an edge rusher strips more than an
  interior one; each lean its way; in bounds.
- Engine: a strip tap per sack, a recovery on every fumble tap; stats credited (no forced fumble on an unforced one;
  the forcer recovering credits both).
- Film: a sack fumble the quarterback lost himself is staged with its reason.

## 8. Docs

`docs/MVP.md`: "fumble recoveries" ticked; "a sack's yards and strip" Partial (the strip done, the yards left).
CLAUDE.md: `match/looseBall.ts` beside `match/fumbleOdds.ts`, `npm run fumbles` naming recoveries and strip-sacks. A
0.4.7 changelog entry; `package.json` 0.4.7.
