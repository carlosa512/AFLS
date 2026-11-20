# Free-agency race: the baseline before any engine change (2026-11-20)

Base: `9af1f07` (the plan's commit, before any engine change).

`npm run offseason -- 6` on branch `claude/amazing-hypatia-dpa9ud` with no engine change (seed `offseason-audit-3`, world
2027 to 2032). Result: **0 numbers outside the target range**, 4m51s wall, 17m17s CPU (it forks three more leagues).
`⚠` marks a line outside its usual band (warns). `≈edge` marks a line within about 5% of a band's edge, the ones a
small push tips.

## Free agency lines (per season)

```
2027 free agency (105 good deals ended): stayed % 30 (not judged yet) · moved % 59 (not judged yet) · no deal % 10 (not judged yet) · good outside signings 89 (not judged yet) · clubs with 3+ 16 (not judged yet) · one-year % 36 (not judged yet) · elite young unsigned 0 (not judged yet)
2028 free agency (144 good deals ended): stayed % 24 (20–55) · moved % 60 (20–60) · no deal % 16 (10–40) · good outside signings 78 (60–135) · clubs with 3+ 12 (8–28) · one-year % 28 (5–40) · elite young unsigned 0 (0–0)
2029 free agency (117 good deals ended): stayed % 25 (20–55) · moved % 62 (20–60) ⚠ · no deal % 14 (10–40) · good outside signings 84 (60–135) · clubs with 3+ 18 (8–28) · one-year % 29 (5–40) · elite young unsigned 0 (0–0)
2030 free agency (107 good deals ended): stayed % 20 (20–55) ⚠ · moved % 64 (20–60) ⚠ · no deal % 16 (10–40) · good outside signings 70 (60–135) · clubs with 3+ 11 (8–28) · one-year % 41 (5–40) ⚠ · elite young unsigned 0 (0–0)
2031 free agency (136 good deals ended): stayed % 32 (20–55) · moved % 49 (20–60) · no deal % 19 (10–40) · good outside signings 54 (60–135) ⚠ · clubs with 3+ 7 (8–28) ⚠ · one-year % 61 (5–40) ⚠ · elite young unsigned 0 (0–0)
2032 free agency (117 good deals ended): stayed % 26 (20–55) · moved % 53 (20–60) · no deal % 21 (10–40) · good outside signings 54 (60–135) ⚠ · clubs with 3+ 5 (8–28) ⚠ · one-year % 67 (5–40) ⚠ · elite young unsigned 0 (0–0)
```

Near an edge (`≈edge`): 2028 moved % 60 (top of 20–60); 2030 stayed % 20 (floor of 20–55). Already ⚠: moved % in 2029 (62)
and 2030 (64); 2030 one-year % 41; 2031 and 2032 good outside signings 54, clubs with 3+ 7 and 5, one-year % 61 and 67.

## Pooled market and the cap books

```
market, seasons 2–6 of 4 leagues: good outside signings 60 (75–120) ⚠ · one-year % 49 (10–30) ⚠ · clubs 3+ 8.9 (8–28) · no deal % 18 (10–40) · released % 9 (NFL 20–27, shown) · starters out of football % 6.1 (2.5–4.5) ⚠
  cap books, 3 leagues × 10 seasons: kickoff room % s4 2.4 (1.5–4) · s5 2.3 (1.5–4) · s6 2.3 (1.5–4) · s7 2.7 (1.5–4) · s8 2.8 (1.5–4) · s9 2.6 (1.5–4) · s10 2.6 (1.5–4)
    FA signings a club, seasons 8–10 ÷ 2–4 0.97 (0.8–1.2) · roster entering camp, 8–10 ÷ 2–4 0.96 (0.8–1.2) · next year used at kickoff, 8–10 − 2–4 (points) -1.6 (-5–5)
free agency, pooled: no deal %, 28 or younger (88 deals) 6 (0–30)
```

The pooled market line already warns (good outside signings 60 against 75–120, one-year % 49 against 10–30, starters out
of football 6.1 against 2.5–4.5). Cap books are well inside their bands (kickoff room 2.3–2.8 in 1.5–4; both ratios
0.96–0.97 in 0.8–1.2), none within 5% of an edge. Clubs with 3+ pooled 8.9 (8–28) is about 11% above its floor.

## Timing

One league's five free-agency days (seed `offseason-audit-3`, `performance.now()` around each `advanceOffseason` call in
the `freeAgency` phase, three offseasons after the first three seasons, milliseconds per day 1 to 5):

| Offseason | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 | Total |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1162 | 739 | 546 | 427 | 415 | 3289 |
| 2 | 1371 | 786 | 655 | 479 | 430 | 3721 |
| 3 | 1129 | 823 | 558 | 494 | 451 | 3455 |

The race may cost no more than the opening offers and one decision pass a day: day 1 (about 1.1 to 1.4 s) is the opening
offers and each later day (0.4 to 0.8 s) is one decision pass. The scratch script lives outside the repo.

## Tuning the race (Task 8)

A probe (one league, seed `offseason-audit-3`, three offseasons, staff-run) counts free-agency signings by day, good
(2%+ of the cap) and elite (5%+) race signings by day, the contested share, step-asides by day, players with a valid
offer on day 5 left unsigned, and the time of the step that opens the race and of each day. The same probe on `9af1f07`:

| Offseason | FA signings by day | Total | Open ms | Days ms |
| --- | --- | --- | --- | --- |
| 2027 | 211/78/37/11/4 | 341 | 1008 | 3602 |
| 2028 | 205/89/50/13/13 | 370 | 1104 | 4016 |
| 2029 | 230/123/62/33/5 | 453 | 1134 | 3608 |

Round 0, the race as Task 7 left it (`lead` 0.08, `wait` 2, `patienceDays` 2, `raise` 0.04, `ceiling` 1.15,
`overcommit` 2). `npm run offseason -- 6`: **0 outside target**, feuds a team 0.70, FA signings a club 8–10 ÷ 2–4 0.90.

| Offseason | FA signings by day | Good by day | Elite by day | Contested | Step-asides by day | Unsigned with an offer |
| --- | --- | --- | --- | --- | --- | --- |
| 2027 | 42/52/28/51/50 = 223 | 18/9/7/10/16 | 8/4/3/7/5 | 43% | 4/7/1/3/3 | 0 |
| 2028 | 91/39/48/59/89 = 326 | 13/7/8/16/14 | 4/1/3/8/4 | 60% | 21/0/0/4/127 | 24 |
| 2029 | 76/57/36/63/83 = 315 | 21/11/9/11/16 | 10/2/5/6/9 | 47% | 53/12/6/17/80 | 3 |

Race lines by season (6): signed by day 2 % 45, 34, 47, 63, 58, 65 · contested % 43, 60, 47, 32, 18, 15 · elite mean
day 2.9, 3.4, 3.1, 2.4, 2.7, 1.9.

Round 1, `wait` 2 → 1. `npm run offseason -- 3`: mid one-year % 58 (58–82) ▼ (the base itself fails big one-year % 7 at
three seasons: the pooled deal lengths are noisy over three).

| Offseason | FA signings by day | Good by day | Elite by day | Contested | Step-asides by day | Unsigned with an offer |
| --- | --- | --- | --- | --- | --- | --- |
| 2027 | 42/52/50/41/66 = 251 | 18/9/13/12/16 | 8/4/7/6/2 | 51% | 4/7/5/16/59 | 4 |
| 2028 | 78/62/66/53/55 = 314 | 15/19/15/12/12 | 5/6/7/3/4 | 53% | 35/19/20/16/28 | 5 |
| 2029 | 71/57/74/66/86 = 354 | 18/12/22/13/7 | 9/7/12/5/5 | 44% | 50/18/45/44/183 | 10 |

Round 2, `lead` 0.08 → 0.05 (with `wait` 1). `npm run offseason -- 3`: big one-year % 7 (8–32) ▼, as the base.

| Offseason | FA signings by day | Good by day | Elite by day | Contested | Step-asides by day | Unsigned with an offer |
| --- | --- | --- | --- | --- | --- | --- |
| 2027 | 53/46/59/57/86 = 301 | 23/13/18/10/11 | 11/3/8/4/2 | 53% | 7/12/6/20/114 | 7 |
| 2028 | 90/63/58/53/84 = 348 | 21/9/17/11/10 | 11/2/7/5/2 | 62% | 46/17/12/6/132 | 27 |
| 2029 | 80/58/76/62/58 = 334 | 17/15/21/10/10 | 8/7/10/4/1 | 45% | 49/34/42/48/41 | 4 |

Round 3, `patienceDays` 2 → 1 (with `wait` 1, `lead` 0.05). `npm run offseason -- 3`: **2 outside**, mid one-year % 56
(58–82) ▼ and big one-year % 5 (8–32) ▼: signing earlier, at full market terms, makes longer deals.

| Offseason | FA signings by day | Good by day | Elite by day | Contested | Step-asides by day | Unsigned with an offer |
| --- | --- | --- | --- | --- | --- | --- |
| 2027 | 53/55/65/58/71 = 302 | 23/17/20/7/9 | 11/5/8/2/1 | 57% | 7/13/15/59/133 | 37 |
| 2028 | 98/66/77/71/83 = 395 | 24/12/14/8/5 | 6/6/6/2/3 | 60% | 21/35/55/99/150 | 25 |
| 2029 | 93/82/83/67/82 = 407 | 17/19/18/11/6 | 8/14/8/2/1 | 59% | 73/31/30/98/152 | 17 |

Judged with `npm run offseason -- 6` (three steering rounds, the stop rule):

- Round 2's numbers (`lead` 0.05, `wait` 1): **1 outside**, feuds a team, mean of 6 seasons 0.48 (0.5–1.8) ▼. The race
  lines: signed by day 2 % 48, 44, 44, 58, 72, 66 · contested % 53, 62, 45, 37, 33, 24 · elite mean day 2.4, 2.4, 2.4,
  2.0, 1.8, 2.1. FA signings a club 8–10 ÷ 2–4 0.87.
- Round 1's numbers (`wait` 1), **shipped**: **0 outside**. The race lines: signed by day 2 % 40, 47, 42, 49, 62, 46 ·
  contested % 51, 53, 44, 36, 23, 31 · elite mean day 2.6, 2.8, 2.7, 2.4, 2.4, 3.0. Near an edge: FA signings a club
  8–10 ÷ 2–4 **0.81** (0.8–1.2), feuds a team 0.66 (0.5–1.8). Market pooled: good outside signings 63 (75–120) ⚠,
  one-year % 39 (10–30) ⚠ (the base: 60 and 49). Deal lengths pooled: mid one-year % 67, big 15.

Timing (the probe, round 1 against `9af1f07`): the five days alone 4004, 3336, 3866 ms against 3602, 4016, 3608 (1.0×);
the opening offers moved day 1's pass into the step that opens free agency (2301, 2234, 2692 ms against 1008, 1104,
1134), so the opening step and the five days together are 6305, 5570, 6558 ms against 4610, 5120, 4742 (**1.27×**,
under the 1.5× that would send it back to the pass).

`npm run morale` on the shipped numbers: **0 outside**. Near an edge: meetings a club a season 5.50 (3–6; 5.55 after
0.4.48), trade requests a season 14.50 (3–15), Tight rooms 0.34 (0.15–0.35), rooms in doubt 0.23 (0.1–0.25).

## Owner's calls

`RACE.lead` lowered from 0.08 as far as the stop rule allows (no check line may fail; no range moved). Each run is
`npm run offseason -- 6`.

- `lead` 0.05: **1 outside** (exit 1), feuds a team, mean of 6 seasons 0.48 (0.5–1.8) ▼. Signed by day 2 % 48, 44, 44,
  58, 72, 66 · contested % 53, 62, 45, 37, 33, 24 · elite mean day 2.4, 2.4, 2.4, 2.0, 1.8, 2.1. FA signings a club
  8–10 ÷ 2–4 0.87. Rejected.
- `lead` 0.06, **shipped**: **0 outside** (exit 0). Signed by day 2 % 47, 41, 41, 61, 61, 57 · contested % 49, 63, 59,
  54, 32, 33 · elite mean day 2.4, 2.9, 2.9, 2.1, 2.4, 2.0. Feuds a team, mean of 6 seasons 0.57 (0.5–1.8). FA
  signings a club 8–10 ÷ 2–4 0.84 (0.8–1.2), roster entering camp 0.97, next year used at kickoff +0.7. Round 1's
  0.08 ran elite mean day 2.4–3.0 and signed by day 2 % 40–62.
- `npm run morale` on 0.06: **0 outside**. Meetings a club a season 5.63 (3–6), trade requests a season 10.50 (3–15),
  trade requests resolved by a trade 0.15 (0.15–0.75, on its floor), Tight rooms 0.34 (0.15–0.35), rooms in doubt 0.22
  (0.1–0.25).

The 0.07 step was not needed (0.06 was clean). The last-day rule (an offer that led when placed stays first) touches
only a team you run and moves no AI-only number.

## Depth bidders capped

A real save showed a punter with 21 teams' offers on day 2. `placeOffers` now keeps each player's most interested AI
bidders by his place in the pool by market worth (`RACE.bidders`: top 32 up to 6, next 96 up to 4, the rest up to 2;
NFL depth players draw one to three suitors). A team already holding a standing offer keeps it; new entrants fill what
is left by their `gain`. Your offer never counts and is never trimmed; the late passes are untouched. The bid-builder
golden hash in `bids.test.ts` was re-pinned.

AI bidders per player on day 1 (opening offers, two leagues, players with at least one offer), median / max:

| Tier | Before | After |
| --- | --- | --- |
| Top 32 | 4 / 18 | 4 / 6 |
| Next 96 | 1 / 22 | 2 / 4 |
| Rest | 1 / 7 | 1 / 2 |

`npm run offseason -- 6` (exit 0, 0 outside): signed by day 2 % 72, 59, 65, 69, 80, 82 · contested % 45, 41, 53, 33,
24, 26 (before: signed by day 2 % 47, 41, 41, 61, 61, 57, contested % 49, 63, 59, 54, 32, 33) · elite mean day 2.2,
2.4, 2.2, 1.7, 1.6, 1.5. FA signings a club 8-10 / 2-4 0.88 (0.8-1.2; was 0.84), feuds a team mean 0.61 (0.5-1.8; was
0.57).

`npm run morale` (exit 0, 0 outside): meetings a club a season 5.71 (3-6; was 5.63), Tight rooms 0.33 (0.15-0.35; was 0.34), trade requests
resolved by a trade 0.15 (0.15-0.75, on its floor, as before).
