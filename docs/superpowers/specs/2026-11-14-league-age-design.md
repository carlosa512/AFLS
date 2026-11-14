# A league that ages like the NFL's

Status: design; bands and priorities approved by the owner 2026-11-14, the whole for approval. Follows up `docs/MVP.md`, "Leagues grow older than the NFL's (start here)".

## Why

A save should hold up for 20 seasons and more. Today a league drifts old: by season 10 its starters average 27.8 years
against the NFL's 27.0, twice the NFL's share is 31 or older, and two thirds of the NFL's share is 24 or younger. The
gap is worst at quarterback. A long career is how the target player plays this game, so the world has to stay
NFL-shaped for as long as they play. `docs/MVP.md` also suspects this drift feeds the thin free-agency market and the
starters leaving football; those are the next project (B below) and are measured, not fixed, here.

## What we measured

**The NFL** (nflverse snap counts and birth dates, 2016–25; a team-season's starters are its top N at each position by
season snaps, N as `STARTERS` in `positions.ts`, K and P by special-teams snaps; age on September 1). **AFLS**: the same
reading of three 20-season leagues (seeds `age2-a`, `age2-b`, `age2-c`), seasons 11–20, where none of the starting
league's players are left (top N by `StatLine.snaps`, K and P by games). Throwaway probes; the plan commits the NFL one
as `scripts/research-aging.py`.

| Starters | NFL mean age | AFLS | NFL 24 or younger | AFLS | NFL 31 or older | AFLS |
| --- | --- | --- | --- | --- | --- | --- |
| QB | 28.5 | 30.3–30.8 | 32% | 8–10% | 29% | 48–53% |
| RB | 25.6 | 25.7–25.9 | 45% | 28–33% | 4% | 0–3% |
| WR | 26.1 | 26.8–27.2 | 42% | 21–24% | 6% | 9–14% |
| TE | 27.1 | 28.1–28.6 | 31% | 14–19% | 12% | 29–32% |
| OL | 27.2 | 28.4–28.7 | 27% | 15–16% | 12.5% | 31–34% |
| DT | 27.2 | 27.8–28.0 | 27% | 16–20% | 11% | 22–24% |
| EDGE | 27.0 | 26.7–27.0 | 32% | 21–26% | 12% | 10–11% |
| LB | 26.8 | 27.0–27.4 | 29% | 20–23% | 9% | 13–16% |
| CB | 26.2 | 26.4–26.6 | 41% | 25% | 6% | 5–7% |
| S | 26.7 | 27.3–27.5 | 32% | 18–23% | 9% | 17–19% |
| K | 29.5 | 29.1–31.4 | 19% | 12–24% | 33% | 36–55% |
| P | 28.6 | 29.6–30.5 | 23% | 15–25% | 25% | 44–52% |
| All | 27.0 | 27.7–27.8 | 32% | 20% | 11.8% | 21–22% |

The NFL's 2021–25 figures are within a point of these (all: 26.95, 31.7%, 11.5%).

**What happens to a starter the next season** (all positions; NFL 2013–24, AFLS seed `age2-a` seasons 11–20). "Gone"
is no snaps the next season.

| Age | NFL still starting | AFLS | NFL gone | AFLS |
| --- | --- | --- | --- | --- |
| 21–24 | 69% | 78% | 4% | 4% |
| 25–26 | 65% | 80% | 6% | 4% |
| 27–28 | 63% | 76% | 8% | 5% |
| 29 | 61% | 74% | 11% | 6% |
| 30 | 54% | 65% | 16% | 14% |
| 31 | 52% | 63% | 15% | 13% |
| 32 | 60% | 59% | 18% | 23% |
| 33 | 56% | 59% | 22% | 24% |
| 34 | 55% | 56% | 21% | 28% |

By group the shapes differ. Long-prime positions (TE, OL, DT) at 29–31: NFL gone 12–18% a year, AFLS 3–4%, then AFLS
loses them all at 33–35. Short-prime positions (RB, WR, CB, EDGE, LB, S) at 30–34: AFLS gone 21–55%, the NFL 15–28%,
because in AFLS a whole class falls together while the NFL keeps a few who age well.

**How good a player is at each age** (AFLS steady state, overall points below his position's average starter): 21:
4.2, 23: 3.5, 25: 2.0, 27: 1.0, 29: 1.0, 31: 1.0, 33: 1.3. A 31-year-old is as good as a 27-year-old.

**What it isn't.** Coaches don't distrust young players: a better player three or more years younger sat behind an older
starter in at most 0.1% of starting spots (the depth chart is `slotOvr` plus a small coach preference, `coachOrder`).
The starting league isn't the cause of the drift: the age holds at 27.7–28.0 once none of its players are left. It does
cause a separate bump: its young starters are rolled as good as its veterans and then grow (`generatePlayer`: potential
adds up to 1.3 a year of growth on top of a starter's roll), so the league's starter overall rises from 12.9 to 13.3–13.4
in seasons 3–6 and slides back to about 12.9 by season 15 (the "talent slide" in `docs/MVP.md`).

**Why it happens.**
1. Young players arrive raw and grow slowly. A rookie sits 4.2 below a starter; growth toward his ceiling stops at 26
   (`rollYear`), and the mental game keeps adding after that (`MENTAL_GROWTH`), so overall peaks late and flat.
2. A prime has almost no year-to-year swing (`rng.normal(0, 0.4)` after 26), so a starter keeps his job until a better
   player arrives.
3. Every player ages along the same smooth curve, shifted at most about ±1.6 years by durability (`bodyShift`). The
   research behind the long plateaus is survivor-biased (`docs/research/attributes-development-scouting-roadmap.md`:
   "tight ends at 89% at 34"), and its suggestion that some players fall off a cliff was only built as that shift.
4. A player under contract can't retire before two years past his position's prime (`retireChance`: QB 36, OL and TE
   33). The careers check's retirement ages are design targets; the research has none.

## Goals

At 20 seasons and beyond, measured the NFL's way in seasons 11–20 of four leagues pooled:

1. **Starter ages by position** inside the bands below: the mean, the share 24 or younger and the share 31 or older.
2. **A starter's next season** shaped like the NFL's: still starting, playing but not starting, gone, by age band, for
   all positions and for the long-prime and short-prime groups.
3. **No talent bump from the starting league:** the league's starter overall (the careers check's mean path, judged
   today at 12.65–13.3 in every season) peaks no more than the band below over its settled level (seasons 11–20).
   Today a new league peaks at 13.22 in year three against about 12.9 settled; the 13.3 ceiling allows that bump.
4. **Everything else the checks hold stays held**, the draft's bust and hit rates included (first-round busts 25–45%,
   Day 3 solid starters 8–20%), with targets re-tuned to, never ranges moved.

**If the goals fight.** Every existing check stays green whatever happens. If the age lines can't reach their bands
that way, the work stops and brings the owner how close it got (the owner's call, 2026-11-14).

**Bands (the owner's call, approved 2026-11-14).** Each mean within 0.75 years of the NFL's (K and P within 1.5); each share within
8 points (QB, K and P within 10); the all-positions line within 0.4 years and 4 points. Next season, each band through
age 32: still starting within 7 points, gone within 6; "playing but not starting" is what's left, shown and not judged.
Starter overall: the highest season no more than 0.15 over the settled level. The NFL's figures are 2016–25 as tabled
above; `scripts/band.ts` gives the warn and fail bands as it does for the other lines that swing with the league.
Starters are counted with `STARTERS` as it stands (three receivers, three corners), the same for the NFL and AFLS.

## Non-goals

- The free-agency market, starters leaving football and teams weighing age and cost: the next project (B). Their
  `npm run offseason` lines are watched here and reported, not tuned.
- How games play out (comebacks, results against the yardage): a later project.
- Save size.
- A per-game form system. The new year-to-year swing is in development, not in games.

## Anti-goals (this fails if, however green)

- The league's talent drops, or game stats leave their NFL ranges (`npm run sim`, the careers leaders).
- A young star collapses for no reason. A cliff before 28 is rare and nearly always follows a severe injury.
- A cliff or a player's swing shows anywhere as a number, or ahead of time. Screens keep the scouts' words.
- A check goes green because what it measures got easier. The careers curve lines change how they read survivors (below),
  never their ranges.
- One stream's draws shift another's: everything new draws from the player's own development stream, or a new stream of
  his own.

## Constraints

- All randomness through the seeded `Rng`. A player's year stays on `${seed}:dev:${season}:${id}`, so tuning never
  reshuffles drafts or schedules (the comment in `beginOffseason`).
- Development is released in steps across the year (`rollYear` then `applyShare`); `npm run training` holds that a year
  in steps lands where one jump would. Anything new rolls inside `rollYear` with the rest of the year.
- Front offices plan on `expectedAging` (`outlook.ts`): trade values, contract asks and the AI's re-sign, tag and length
  limits. It must stay the average of what the engine does, cliffs included, or the AI misprices veterans.
- True versus perceived: the engine and development use true ratings; screens use the user's view. Hidden traits are
  never numbers.
- `League` stays plain JSON. If a new field is stored, bump `SAVE_VERSION` and add a step to `migrate.ts`. The design
  below needs none: a player's best overall can be read from his yearly snapshots (`recordRatings`).
- Bands are the owner's; a check is never loosened to go green.

## Approaches

Considered with the owner on 2026-11-13:

- **A. Cliffs and earlier exits.** Spread how players decline and let retirement follow the body. Fixes the long-prime
  hold and, with a real year-to-year swing, the job churn. Alone, it leaves young starters near 20%.
- **B. Teams weigh age and cost.** A younger, cheaper player close in rating gets the job, and a first-round
  quarterback starts by year two. Contained, but no team starts a player three or four points worse, so it can't fix the
  young end alone. It overlaps the free-agency work.
- **C. Young players reach their level sooner.** Less raw on arrival, faster growth, less late growth, the league's total
  talent held. Fixes the young end; moves the draft's bust rates, which are re-tuned to their NFL targets.

**Picked: A plus the timing part of C**, for the reason above: A alone misses the biggest gap (young starters 20%
against 32%, quarterbacks 9% against 32%). B is the next project, with the free-agency market.

## The design

### 1. Measure first

Commit the NFL probe as `scripts/research-aging.py` (the `research-squads.py` pattern: `--data`, `--download`) and its
tables as `docs/research/league-age.md`. Add a block to `npm run careers` Part 2 that reads each league the same way
(top N by season snaps, K and P by games) and judges the goals' lines against the bands. Part 2's leagues run 20
seasons and judge seasons 11–20 (today 16 and 9–16), so the check covers the owner's 20-season target. Starter age by
position at kickoff (the current informational line) can go.

### 2. Young players reach their level sooner (timing)

Move when growth lands, not how much there is: a player's ceiling and the league's settled starter overall stay where
they are. Levers, for the builder to tune together: how raw a prospect arrives (`RAW`), growth's pace (`rollYear`'s pace
and its `reps` weight), the age growth ends (26), and the mental game's late gains (`MENTAL_GROWTH`, the mental lag in
`declineOnset`). The aim is an age curve whose peak lands where the careers peak-age lines put it (by position, as
today) and whose young players are close enough to win jobs at the NFL's rate (goal 1's 24-and-younger shares). The
draft's class strength (`14.1` in `generateDraftClass`) is re-tuned so the settled starter overall holds. Bust and hit
rates are re-tuned to their existing ranges.

### 3. A real swing in the prime

Past growth, a year's change is wider than today's sd of 0.4, so good years and bad years move who starts. Tuned to the
"still starting" column. The swing is centred (no talent drift); `npm run careers` already judges yearly change by age.

### 4. Cliffs

Past a point near his position's turn (`declineOnset`, earlier for a fragile body), each year carries a chance of a
sharp drop: several points of physical and technical ratings at once, drawn from his own year's stream. More likely
after a severe injury that year (scars, `injuries.ts`), with a fragile body (durability) and with age. Rare before 28.
A player past a cliff is the one who retires (below). The rest age as the research's survivors do. Tuned to the "gone"
column by group, so the long-prime positions lose players from 29 and the short-prime groups keep a few into their mid
30s.

### 5. Retirement follows the body

`retireChance` for a player under contract reads how far he has fallen from his own best and his age against his
position's clock, with no fixed two-year wait past the prime. An injury retirement (`injuryRetireChance`,
`concussionRetireChance`) stays as it is. Unsigned veterans keep today's rule; the next project looks at who goes
unsigned. Tuned with the cliffs to the "gone" column and the age a starter leaves for good (`league-age.md`). The
careers check's retirement ages (`RETIRE`, design targets) are replaced by the NFL's exit ages from the research.

### 6. Front offices see it coming, on average

`expectedAging` includes the average cost of a cliff at each age, so trade values, contract asks and the AI's age limits
price the risk. It stays a public judgment by calendar age. The scouts' career outlook keeps its words; durability's
"Wears down early" already reads the risk.

### 7. A starting league that's already settled

`createLeague` rolls each founding player as a settled league carries a player of his age and slot: a young starter
rated as a settled league's young starters are, with growth still ahead of him to his ceiling, so the young don't grow
past the draft. Goal 3 judges it. Team balance (`evenDeal`, the opening records' tilt) and the founding rosters' checks
(`npm run size`, `offseason`'s first season) still hold.

### 8. The careers curves read like the research

Part 1 ages a synthetic class with no retirement, so every player's curve counts, while the research it's judged against
measured players still in the league. With cliffs, the lines that read late ages (TE and OL below peak at 32 and 35, QB
at 33 and 37, K and P at 35 and 38, the front seven and safeties at 33) read the players a league would still roster:
those not past a cliff. Their ranges don't change. Peak age, the median of each player's own best season, reads everyone
as today.

## Checks this moves

`careers` (the target of the work), `offseason` (talent, cap and rosters stable; its free-agency and starters-leaving
lines reported for B), `trades` (prices by age), `training` (a year in steps), `morale` (the growth tilt), `sim` (game
stats and leaders in an aged league: the "Attribute scaling" note in `docs/GAME_DESIGN.md` says aged leagues score more,
and a younger league may close it), `gm-habits`, and through `generate.ts` `quirks`, `weather`, `size`, `crews`,
`parity`. Each runs on the pull request as `npm run check` plans it.

## How it lands (calls made in writing this, for the owner to check)

- **Three pull requests, in order.** (1) Measurement: the research script, `league-age.md` and the careers block, its
  new lines shown as `⚠ known issue` (the `offseason` pattern) so main stays green. (2) The starting league (section 7)
  alone, judged by goal 3. (3) The mechanisms together (sections 2–6 and 8), which interact and are tuned as one; the
  known-issue lines become judged lines here.
- **Saves in progress** age under the new rules from their next new league year. No migration: nothing stored changes,
  and a founding league already played is left as it is.
- **A player past a cliff** retires through today's path at the next new league year: his bonus proration accelerates
  as dead money (`accelerateProration`), as a retirement under contract does now. He isn't held back for the cap's sake.
  `npm run offseason`'s dead-money and cap lines stay judged; if they move out of band, that is reported to the owner
  rather than tuned around.
- **Knobs may move as far as the goals need** (the draft class's `14.1`, `RAW`, `MENTAL_GROWTH`, the pace), with each
  move noted in its comment as the repository does.

## Left to the builder

The mechanisms' exact form and constants; whether the swing and the cliff share one draw; how to read a player's best
overall; the order of tuning; how Part 2's longer leagues fit CI's time; the warn bands inside the owner's fail bands.
On finishing: the `docs/MVP.md` line, `docs/GAME_DESIGN.md`'s "How players develop and age", a PATCH bump with a
`changelog.ts` entry (this finishes a follow-up, not an MVP item).
