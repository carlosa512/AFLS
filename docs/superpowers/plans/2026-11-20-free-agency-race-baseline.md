# Free-agency race: the baseline before any engine change (2026-11-20)

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
