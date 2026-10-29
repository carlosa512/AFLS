# Morale, part 3: moods matter (G2)

Date: 2026-10-29 · Chunk G2 of the owner's notes (Oct 28–29, 2026) · Follows G1 (`2026-10-29-morale-core-design.md`,
0.2.21) and G3 (`2026-10-29-morale-talks-design.md`, 0.2.22)

## Why

G1 gave every player a mood and G3 let him speak up about it, but a mood still changes nothing: a miserable rookie
grows like a happy one, plays like one and signs like one. G2 gives moods their effects, the ones agreed in G1:
practice and development, a small game-day edge, and what he asks for in contract talks. It is the first morale chunk
that **changes play**, so league stats, careers and the offseason must stay inside their ranges.

Order stays G1 → G3 → G2 → G4. Hold-ins, holdouts and trade requests stay in G4.

## Decisions (agreed with the owner)

1. **Subtle.** At the extremes (Superb, Abysmal): ±0.5 of a rating point on game day, young players' growth ±10% over
   a year, learning a new position ±15%, a contract ask up to 10% higher and a round less patience (unhappy; a happy man asks as he would anyway, the owner's call after CI: see Contract talks)
   round.
2. **Growth week by week** (approach A, "mood tilts the year"): the year's roll is unchanged, no new draws. At each
   practice step his mood adds to a small tilt on the growth he's due this year; it lands with each step's release.
3. **Practice includes learning a new position** (`training.ts`'s learning clock).
4. **Every club.** The same rules for every player; AI clubs negotiate against the same asks.
5. **Shown in words, your players only, never a number,** on the Locker Room screen and in the head coach's locker
   room report. **Nothing new on the player card** (the owner's call).

## One scale

Every effect reads one number from his mood, **the lean**, −1…+1:

- `moodLean(level) = clamp(level / 6, −1, 1)`: Superb (≥ 6) is +1, Abysmal (≤ −6) is −1, Okay is about 0. `level` is
  `moraleLevel(league, p)`, his stored level plus live jolts, as every screen reads it.
- **The pull** is the lean measured against the league: `moodPull = clamp((level − mean) / 6, −1, 1)`, where `mean` is
  the average `moraleLevel` of every rostered player at that moment (worked out on the spot, never stored, never put in a
  shared cache). Growth and game day read the pull, so the league's totals hold however happy the league runs; talks and
  position learning read the lean, since neither feeds a league total.

Moods only move at morale steps (after a week's games, at each offseason step), so within a week every read agrees.

## Growth: mood tilts the year

Development rolls a player's year once, at the new league year, and releases it in steps (`development.ts`,
`RELEASE`: 0.6 in March, 0.05 over the spring program, 0.05 in camp, 0.3 across the regular season's weeks).

- **Who:** a player whose year was rolled before 26 (`p.dev.rate` present, the growth years). Veterans' decline and
  prime drift are the body's and are untouched.
- **The tilt:** `p.dev.mood`, starting at 0. At each release step after March (the program, camp, and each regular
  season week) it adds `0.10 × share × pull / 0.4`, where `share` is that step's nominal release (0.05, 0.05, 0.3 / 18)
  and `pull` his pull at that step, measured against the mean of the young players growing (they run a little unhappier than veterans; against the league's mean the league's growth fell about 1%). Over a whole year it sums to at most ±0.10. A week he sits counts the same as a week
  he plays: his mood in practice counts whether or not he dressed (reps already set how fast the year lands).
- **Where it lands:** each step lands `round(start + done × t × (1 + tilt))` for a rating whose year target `t` is
  positive; a falling rating (noise, a slip toward a settled ceiling) lands as today. So a happy year leaves him up to
  10% further along on the ratings he was gaining, a miserable one up to 10% short, landing a little each week.
- **No jitter:** a step adds at least 0.05 (or a sat week's ~0.009) to `done` and at most 0.0125 (0.004) to the tilt,
  so `done × (1 + tilt)` only rises and ratings never step back mid-year.
- **Closing early:** a growth year isn't closed early (today a year whose remainder rounds to nothing closes early); it
  closes when the season's last week lands it in full, tilt included, or at the true-up.

## Game day

In every game, each player in a lineup plays `0.5 × pull` rating points better (a negative pull, worse) in every contest,
through the same overlay as the out-of-position knock (`useKnocks`: the knock becomes `knock − 0.5 × pull`). The mean is
worked out once per game at kickoff, from the league as it stands. Nothing is drawn, so a game stays reproducible from its
seed and the league's state.

## Practice: learning a new position

`learnRate` multiplies in `1 + 0.15 × lean` beside work ethic (still clamped 0.3–2). The coaches' estimate reads it too
(a mood is no secret in his own building).

## Contract talks

In `demand`, **only against his own club** (`player.teamId === teamId`; free agents' flat mood and clubs he left keep
their own rules in `contractLean`):

| His mood | Ask and walk-away | Patience |
| --- | --- | --- |
| lean < 0 | × (1 + 0.10 × −lean): up to 10% more at Abysmal | −1 round at Very poor or worse (lean ≤ −0.5), at least 1 |
| lean > 0 | unchanged | unchanged |

The first draft gave a happy man a 5% discount and a round more patience. Both kept AI clubs' happy starters on their books, and QB trade-ups in the draft fell to about half of main's (0.26 a draft over 159 against about 0.5; with the talk terms off, 0.50), so the owner took the happy side out. Walk-away keeps its floor at the minimum salary. AI clubs read the same `demand` (re-signing, `resignCall`, the
contracts letter), so an unhappy man is dearer to keep for everyone.

## Where you see it

Your players only (fog of war: through `moraleView`, never `p.morale`), in words, never a number:

- `MoraleView` gains `effect?: 'lifting' | 'costing'`: `costing` at Very poor or worse (lean ≤ −0.5), `lifting` at
  Very good or better (lean ≥ 0.5). The player card ignores it.
- **Locker Room screen, Morale section:** one muted line under the section title ("A player's mood moves how he
  practices, grows and plays, and what he asks for in a new deal."); in *Needs a word*, a man it's costing gets a
  muted line under his row ("It's costing him in practice and on game day."); in *Flying*, a man it's lifting gets
  "It's lifting his practice and his play."
- **The head coach's locker room report:** `MORALE_NOTE` gains a `costing` fact and lines for it, in his voice ("Davis is
  sulking about snaps, and it's showing in practice."), so a man slipping to Very poor or worse is told with what it's
  costing.

## Data

- `DevYear.mood?: number`: the tilt so far, kept to four places, absent at 0.
- `SAVE_VERSION` 69; the upgrade step fills nothing (a year rolled before G2 starts with no tilt).
- `MoraleView.effect` is worked out, not stored.

## Checks

- **Unit tests:** `moodLean` and `moodPull` (bands, caps, centring); the tilt (sums to at most ±0.10 a year, only growth
  years, only rising ratings, no step back, true-up lands it); the game-day overlay (a happy lineup's `skill` up, capped
  at ±0.5, knocks still applied); `learnRate` by mood; `demand` by mood (own club only, the caps, patience floor);
  `moraleView.effect` (bands, `null` for another club's player); the Locker Room lines and the report's costing lines;
  the player card shows none of the new words; the save step.
- **`morale.rng.test.ts`** keeps its promise in a new form: with G2's effects held at zero, a season and an offseason
  play out the same with moods on or off (moods still draw nothing). A second test shows the effects, switched on, do
  change something.
- **`npm run morale`** adds: the game-day edge's league mean within ±0.05 rating points and every edge within ±0.5; the
  growth tilt's league mean late in the season (after week 17: the year closes in week 18) within ±0.01; young players who spent the year Good or better out-tilt
  those who spent it Poor or worse by at least 0.04.
- **`npm run training`:** holds the tilt at zero (`MOOD_TILT.growth`, a dial like `RELEASE`), so "a year released in
  steps lands where one jump would" still holds for every player left alone; the tilt's own exactness (a tilted year
  lands where one jump with the same tilt would) is `release.test.ts`'s, its size `npm run morale`'s.
- **Play moves now, inside its ranges:** CI's planner runs `sim`, `careers`, `audit`, `offseason`, `training`, `trades`
  and the rest on these files. No range is loosened to get green; if one can't be met, stop and tell the owner why.
- **Save budget:** one small number per young player with a year landing; measured in the plan, an allowance only if
  the budget needs it.

## Files

| File | Change |
| --- | --- |
| `src/engine/morale.ts` | `moodLean`, `moodPull`, `moraleMean`, `MoraleView.effect` |
| `src/engine/development.ts` | the tilt: built at `developBlock` and `developWeek`, landed in `applyShare`, closing early |
| `src/engine/match/lineup.ts` (or `gameSim.ts`) | the game-day edge in the knocks overlay |
| `src/engine/training.ts` | `learnRate` reads the lean |
| `src/engine/offseason/negotiation.ts` | `demand` reads the lean, own club only |
| `src/engine/lockerReport.ts`, `lockerVoice.ts` | the costing fact and lines |
| `src/ui/screens/LockerRoom.tsx` | the section's line and the rows' lines |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | `DevYear.mood`, save v69 |
| `scripts/morale.ts`, `scripts/training.ts`, `scripts/check.ts` | the new checks; the planner runs `morale` for these files |
| `docs/MVP.md`, `package.json` (0.2.24), `src/ui/changelog.ts`, `CLAUDE.md` | the Morale line, version, changelog, notes |

## Out of scope

- Hold-ins, holdouts, trade requests, fines, AI clubs acting on moods or to keep promises (G4).
- AI depth charts or lineups weighing a player's mood.
- Mood in injuries, veterans' decline or the ceiling settling (`ceiling.ts`).
- Any new word on the player card.
