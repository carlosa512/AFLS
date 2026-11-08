# The free-agency market: who stays, who moves, and the room clubs bring

Research input for `docs/superpowers/specs/2026-11-07-free-agency-planning-design.md`: the NFL numbers the offseason
audit's free-agency lines are judged against, and AFLS measured the same way.

## Sources

- **Contracts:** nflverse's copy of Over The Cap's contract history (`historical_contracts.csv.gz`, 31,893 deals,
  signed through 2021 in full; 2022 is partial). Reproduce with
  `python scripts/research-free-agency.py --data work/nfl-contracts --download`.
- **Cap room in February:** Over The Cap's tables as Pro Football Rumors printed them: 2023-02-02 (cap $224.8M),
  2024-02-24 ($255.4M), 2025-02-15 (a projected $272.5M; the post says the figures include carryover).
  [2023](https://www.profootballrumors.com/2023/02/2023-nfl-cap-space-by-team),
  [2024](https://www.profootballrumors.com/2024/02/2024-nfl-cap-space-by-team),
  [2025](https://www.profootballrumors.com/2025/02/2025-nfl-cap-space-by-team).

## Definitions (the same for the NFL and AFLS)

- **A good deal:** its APY was 2% of the cap or more the year it was signed (rookie deals included).
- **Reaching its end:** its last season was the one just played. An extension with the same club any time before then
  counts as staying; a new club before his last year was a release, not an end, and is left out.
- **Stayed / moved / no deal:** the next deal (signed in the spring after the end) is with the club he finished the deal
  with, with another club, or there is none. A long deal with the same club a year later also counts as staying: a
  franchise tag or a fifth-year option isn't a deal in this data. Age is 22 plus the years since his draft.
- **A good outside signing:** a deal at 2% of the cap or more with a club other than the one his previous deal ended
  with, counted by the league year it was signed.

## The NFL

**Good deals reaching their end, 2014–2020** (1,269):

| | n | Stayed | Moved | No deal |
| --- | --- | --- | --- | --- |
| All | 1,269 | 36% | 38% | 25% |
| 28 or younger | 336 | 37% | 50% | 14% |
| 29–31 | 475 | 37% | 44% | 19% |
| 32 and older | 453 | 36% | 25% | 40% |
| Old deal 2–5%, 28 or younger | 268 | 38% | 50% | 12% |
| Old deal 5%+, 28 or younger | 68 | 31% | 49% | 21% |

"No deal" for a young player is an upper bound: injuries, retirements and a deal the data missed all land there.

**Good outside signings by league year:**

| Year | Total | Clubs with none | Clubs with 3+ | Median a club | Most by a club |
| --- | --- | --- | --- | --- | --- |
| 2015 | 97 | 4 | 21 | 3 | 8 |
| 2016 | 84 | 2 | 17 | 3 | 5 |
| 2017 | 99 | 1 | 20 | 3 | 6 |
| 2018 | 109 | 0 | 19 | 3 | 8 |
| 2019 | 106 | 0 | 22 | 3 | 6 |
| 2020 | 91 | 3 | 16 | 2.5 | 7 |
| 2021 | 96 | 3 | 19 | 3 | 9 |

20% of them (of 682) were one-year deals.

**Cap room in February** (cap space for the coming league year, before the March cuts):

| Year | Median | Clubs with 10%+ | Clubs over the cap | Most |
| --- | --- | --- | --- | --- |
| 2023 | 2.8% | 8 | 14 | 40% |
| 2024 | 11.4% | 17 | 8 | 31% |
| 2025 | 12.3% | 18 | 9 | 44% |

## AFLS before the fix (seed `track-fa`, the same definitions, at the window's start and at kickoff)

| Into | Ends | Stayed | Moved | No deal | No deal, 28 or younger | Outside signings | Clubs 3+ | One-year | Room median | Clubs 10%+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2027 | 17 | 24% | 71% | 6% | – (0) | 44 | 5 | 9% | 32% | 29 |
| 2028 | 34 | 41% | 47% | 12% | 0% (5) | 59 | 10 | 15% | 25% | 29 |
| 2029 | 37 | 49% | 41% | 11% | 20% (5) | 38 | 6 | 32% | 31% | 32 |
| 2030 | 78 | 31% | 35% | 35% | 44% (25) | 36 | 2 | 56% | 30% | 30 |

What it says: clubs keep about as many of their own as NFL clubs do, but they sign half as many good players from
elsewhere and spread them over far fewer clubs; one-year deals climb from a tenth to over half; and by the fourth year
a third of the good players whose deals end, and nearly half of the young ones, sign nothing. AFLS clubs open the
window with far more nominal room than NFL clubs (a median near 30% against 3–12%) because so many of their deals run
out each year: the room goes on refilling the roster, not on the market. That room isn't judged against the NFL's
(the rosters it has to refill aren't alike); the outcomes are.

## AFLS before the fix, the audit's own run (`npm run offseason -- 4`, seed `offseason-audit-3`, after 0.4.12)

| Into | Ends | Stayed | Moved | No deal | Outside signings | Clubs 3+ | One-year | Elite young unsigned | Room median | Clubs 10%+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2027 | 73 | 58% | 40% | 3% | 51 | 10 | 14% | 3 | 33.7% | 30 |
| 2028 | 83 | 49% | 41% | 10% | 46 | 7 | 41% | 0 | 29.1% | 32 |
| 2029 | 102 | 52% | 31% | 17% | 32 | 3 | 44% | 8 | 29.2% | 31 |
| 2030 | 116 | 50% | 26% | 24% | 38 | 4 | 53% | 20 | 33.2% | 30 |

Pooled over 2028–30, 13% of 56 young good deals ended with no deal. 12 numbers outside their bands.

## AFLS after the fix (0.4.13, the same run)

| Into | Ends | Stayed | Moved | No deal | Outside signings | Clubs 3+ | One-year | Elite young unsigned |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2027 | 73 | 52% | 45% | 3% | 65 | 14 | 42% | – |
| 2028 | 104 | 54% | 44% | 2% | 57 | 8 | 37% | 0 |
| 2029 | 106 | 42% | 47% | 11% | 74 | 14 | 42% | 0 |
| 2030 | 126 | 50% | 37% | 13% | 71 | 12 | 41% | 0 |

Four numbers outside their bands (from twelve): no deal 2% in 2028 (AFLS now places nearly every good player; the
NFL's 25% includes injuries and retirements), and one-year deals at 41–42% in 2029–30 (the NFL's 20%; older veterans
testing the market sign prove-it deals). Stayed and outside signings sit in their warning bands. No player 28 or
younger priced at 5%+ of the cap was unsigned at any kickoff. Two-year fitted deals up to age 30 brought one-year
deals to 27–28% but left a young star unsigned in 2030; the spec's 28 stands.
