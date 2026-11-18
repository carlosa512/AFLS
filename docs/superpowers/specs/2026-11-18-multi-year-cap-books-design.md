# Multi-year cap books: AI GMs plan ahead

Owner: carlosa512 · 2026-11-18 · lands in PR #191 (0.4.53), alongside the rookie hold and the SNN fixes

## Intent

AI front offices spend themselves flat by a league's fifth or sixth season, and every patch so far (0.4.49's market,
0.4.50's June 1 cuts and camp cushion) treated the end of the chain, so it keeps coming back: PR #191 went red on the
offseason check's cap-space spread (1.4 against 0–1), and main itself fails that line on seed `alt-1`. The owner: fix it
at the root, no bandaids, and make the GM AI plan like a real GM, ahead, so it merges clean with #191 and stays fixed.

## What the probe found (main, `offseason-audit-3`, one league, six seasons)

| Season | Kickoff room (median) | FA signings a team | Camp roster entering | Next year committed at kickoff | Restructure money on later years |
| --- | --- | --- | --- | --- | --- |
| 2027 | 3.2% | +11 | 55 | 57% | 2.1% |
| 2029 | 2.7% | +11 | 53 | 62% | 1.2% |
| 2031 | 1.3% | +3 | 46 | 70% | 4.8% |
| 2032 | 1.6% | +3.5 | 45.5 | 69% | 5.3% |

The chain: every tool a GM borrows with is checked against **next year only, or nothing**.

- **Restructures** (`restructurePlan`) spread converted money over every remaining year of a deal, but the plan checks
  only next year's room (`clubRoom.nextRoom`, `nextYearCeiling`, up to 97% of next year's cap). Years two and three out
  fill up unchecked.
- **Signing bonuses and void years** (`aiOffer`: `bonusPct`, a void year for a cap-aggressive GM) prorate forward;
  nothing checks the years they land in.
- **Spend first** (`SPEND_FIRST`, 0.4.49): free agency's first two days may spend the in-season reserve and half the fill
  money for the 53, "kept again after", but nothing rebuilds it.
- **Tags** count nothing for next year (`docs/MVP.md`, "Room made for a tag or a one-year deal forgets next year").

So each spring opens tighter (room at free agency 21.5% → 14–15%), free agency signs 3 players a team instead of 11,
clubs reach camp with 46 players, and `aiTrainingCamp` → `aiCapCompliance` cuts expensive restructured veterans to fill
the 53 (39 of 52 costly camp cuts; camp dead money 0.9% → 1.8% of the cap a team). That dead money tightens the next
spring. Switching `SPEND_FIRST` off alone kept kickoff room at 2.5–3.5%, but camp rosters still shrank (59 → 48) and
restructure money still climbed (to 7.8%): it is one leak of several.

## Goals

"Fixed" (the owner's words, agreed 2026-11-18), on CI's seed and three other seeds, through **season 10**:

- Kickoff room flat around the NFL's average (median 2–3% of the cap; NFL median 2.3%), no downward trend.
- Free-agency signings a team a year, the roster entering camp, and next year's committed share at kickoff flat: no
  trend from seasons 2–4 to seasons 8–10.
- Every check green: `offseason` on all four seeds, and the full CI plan on the PR (`careers`, `trades`, `gm-habits`,
  `gm-habits-fx`, `morale`, `sim`, tests and the rest).
- **A GM keeps multi-year books** and every money decision reads them, so a new way to borrow later plugs into the
  same books instead of needing its own patch.

## Non-goals

- Your team: nothing here decides for you. Your cap screens may show the same books later; not in this change.
- The cap's path itself (`nextCap`), the rookie scale, the market's prices (`leagueMarket`).
- In-season trades' valuation (`trade/value.ts`) beyond what already reads `spendable`.
- Hitting NFL distributions exactly (the owner: aim for the average, not hyper-realism).

## Anti-goals

- No band moved to get green. A judged line that still fails after the tuning step goes back to the owner with numbers.
- No new behavior that only fires when a check is looking (no tuning to a seed).
- GMs don't become timid: contenders still borrow, restructure and spend early; they just don't borrow what they can't
  carry. A league where nobody restructures or free agency dies is a failure even if room is flat.

## Constraints

- Engine rules (`CLAUDE.md`): pure functions, seeded `Rng` only. The books are **computed, never stored** (no save
  change, no `SAVE_VERSION` bump) and draw nothing, so a reload decides the same.
- A GM reads the cap's path as the league would project it, not the drawn future: expected growth, not `nextCap`'s draw.
- The cap and contracts are public: no fog-of-war issue.
- One CPU-heavy job at a time; local runs steer, CI verifies; push only after the owner confirms.
- The lines nearest their edge before starting (watch them first): `offseason` free agency (good outside signings 60
  against a floor of 60 pooled; one-year deals a known issue), `trades` QB trade-ups 0.3 (warn edge), `gm-habits`
  youngQb most held 0.484 (fails 0.5), `careers` TE median retirement age, long-prime starters gone at 29.

## Approaches

- **A. Multi-year books every money decision reads (chosen).** One forecast per club over the next three league years:
  projected cap, what's committed, what's needed, and the room left. Restructures, bonuses and void years, free-agency
  offers, early spending, extensions and tags all keep every year of it under its limit. Biggest change, moves the
  free-agency lines (retune), but it fixes the cause in one place and is how a real GM plans.
- **B. Patch the three leaks separately** (restructures check all years, spend-first leaves the fill money, void years
  counted). Smaller, but three rules each checking its own way: the bandaid pattern the owner rejected.
- **C. Fixed limits per future year** (e.g. next year ≤ 85% committed, the year after ≤ 70%). Simple, but a rule of thumb
  that ignores the roster a GM will need: a club with many expiring starters is still squeezed.

## The design

### The books (`src/engine/offseason/capBooks.ts`, new)

`capBooks(league, team): CapBooks`, a pure read built once per decision pass (cheap enough to call per offer; memoize
per pass where a loop calls it). For each future league year `y` of the horizon (`BOOKS.horizon`, 3: `s+1`, `s+2`,
`s+3`):

- **Projected cap**: `capFor(league, y)`, which already projects a year the league hasn't set at
  `PROJECTED_CAP_GROWTH` from the last known cap. No separate growth knob: the books and `capSheet` read the same cap.
- **Committed**: `capSheet(league, team.id, y).used`: salaries, every bonus's proration (void years included) and dead
  money already booked for `y`.
- **Needed**: what the club must still pay for in `y` to field a team, each roster spot counted once:
  - keepers: players whose deals end before `y` that the club plans to keep today (`inPlans`, read now: a GM can't see
    three years out either), at their market price scaled by `capFor(y) / capFor(s)`; a tagged player counts his next
    price. A keeper re-signed in an earlier year of the horizon is counted once, at that price, for every later year;
  - the draft class: the picks it owns for `y` (as `nextYearNeeds` prices them); a year with no picks on file yet counts
    a typical class (seven picks at their rounds' middle slots);
  - the 53: spots left after players under contract for `y`, keepers and picks (53 less all three, never below zero), at
    the minimum;
  - the in-season reserve for `y` (`inSeasonReserve` at `y`'s cap).
- **Limit**: projected cap × the GM's ceiling for that year. Next year keeps today's `nextYearCeiling` (aggression and
  win-now move it); each later year's ceiling is **lower** by `BOOKS.fade` (starting at 3 points a year), so more of it
  stays free, because the further out, the less a GM knows. Money a deal or restructure adds past `s+3` is added to
  `s+3`'s line, so the horizon's last year carries the tail and nothing lands unchecked.
- **Room(y)** = limit − committed − needed. The books also give `canCarry(adds: number[])`: whether adding these amounts
  to `s+1..s+3` keeps every year's room at or above zero, and `carryable(perYear)`: the most of a spread a club can add.

`nextYearNeeds` and `clubRoom.nextRoom` become reads of the books (next year's line), so there is one definition.

### Every money decision reads them

1. **Restructures** (`restructurePlan`): a step's added proration lands on each remaining year of that deal; the
   amount is capped so no year of the horizon goes below zero room (replacing the single `nextRoom`).
2. **Offers** (`aiOffer` and every path that builds an AI deal: free agency, the re-sign window, `campStarterSignings`):
   the deal's cap hits in `s+1..s+3` (base, bonus proration, void years) must fit the books. If they don't, the GM
   shapes the deal before he walks away from it: void years go first, then bonus share, then years. If a one-year
   deal at the room he has still doesn't fit, he doesn't make it.
3. **Early spending** (`SPEND_FIRST`): free agency's first days may still spend the in-season reserve (the NFL's March),
   but never the money that fills the 53 (`SPEND_FIRST.fillShare` goes to 1). This year's room stays `spendable`'s, as
   today; the books cover the years after it.
4. **Extensions and tags** (`aiExtendEarly`, `aiExtendArrival`, `makeRoomFor`, `tryTag`): the new deal's later years
   must fit the books; a tag counts his next year's price (closes the MVP item on tags forgetting next year).
5. **Hard and soft limits** (my call, from how GMs behave): the books are a hard limit for free agents, early extensions
   and arrival extensions. Re-signing a starter the plan keeps and judges worth his price (`PlannedKeeper.worth`), or
   tagging him, may use the next-year ceiling without the fade in the later years: a GM finds a way to keep his core,
   as `makeRoom`'s "a keeper's room is a want, not the law" already says for this year.
   "The room he has", for a deal that fits some years and not others, is the smallest room across the horizon.
6. **The safety nets stay** (`aiCapCompliance` at camp, spring cuts, `payAhead`): success is that camp compliance cuts
   become rare, not that they are removed.

### Measuring it

- A probe script, `scripts/cap-books.ts` (`npm run cap-books [-- seed seasons]`): plays a league and prints, per
  season, kickoff room, free-agency signings a team, the roster entering camp, next year's committed share, restructure
  money on later years, and camp compliance dead money. A preview, not a check: what this design was steered with.
- The offseason check's cap-drift leagues play **10 seasons** instead of 6 (they already run in child processes beside
  the main league), and judge the trend: kickoff room, free-agency signings and the roster entering camp in seasons 8–10
  against 2–4. The child leagues run in parallel, so the job grows by a few minutes, well inside CI's 30-minute limit.
  Bands (the owner, 2026-11-18), warn outside the first, fail outside the second: kickoff room each settled season
  (4–10) 1.5–4% and 1–5%; free-agency signings a team and the roster entering camp, seasons 8–10 against 2–4, within
  20% and 35%; next year's committed share, seasons 8–10 against 2–4, within 5 and 10 points.

### Tuning step and stop rule

Knobs: `BOOKS.fade` and the early-spend share. Steer with
`npm run cap-books` on two seeds (about 10 minutes each), at most three rounds; then the real checks once
(`offseason` on four seeds, `trades`, `gm-habits`, `careers`). If the goals aren't met after three rounds, stop and
bring the owner the table of rounds.

## Left to the builder

- Exact data shapes, memoization, and where each read lands in `ai.ts`.
- The order a shaped deal gives things up in, within "void years, bonus, years".
- Tests: the books' arithmetic on built scenes; each decision refusing what the books can't carry; a restructure never
  pushing a later year below zero room; a season-long test that camp compliance cuts stay rare.
- Updating `docs/MVP.md` (kickoff room, tags forgetting next year, restructures), `CLAUDE.md`'s `offseason/` line, and
  `docs/GAME_DESIGN.md`'s cap section.

## What shipped (rulings made while building, 2026-11-18)

The design above, with these changes, each found by a probe and recorded in the build ledger:

- **Keepers are next spring's only, best first.** The books count players whose deals end this league year (not every
  deal ending inside the horizon: by the third year that put every club past its books), and only as many as the GM's
  full ceiling holds, best first by the club's outlook, a tag before anyone. Counted all at market, the keepers alone
  read next year past the limit at 20–24 of 31 clubs every season, and no club could sign a free agent for more than a
  year. A deal that has already ended (the re-sign window's own) is a decision being made now, not a need.
- **A deal is never shortened to fit** (the owner: a club signs the players who matter and makes the money work around
  them). `shapeToBooks` gives up void years, then bonus, then makes no offer. Shortening always "fit" (a one-year deal
  lands nothing on later years), only pushed the price onto next spring, and ran one-year deals to half the market.
- **A better player is kept ahead of the keepers below him** (`aside`): their price, less the minimum their spot then
  costs, is his to use; they face the books when their own deals end.
- **The books' last year stands for each year after it** (the largest add on or past it, not their sum: summed, a
  five-year deal read as twice its price).
- **A free agent the market passed by keeps his years at a lower price** (`priceToBooks`, from the clearing day): never
  a one-year deal at his full price. In the market's first days a club whose books can't carry him stays out.
- **Free agency credits the spot a signing fills** (`aiFreeAgencyDay`): the minimum the fill reserve held for it comes
  back, as it already did for a re-sign. Uncredited, a club's room ran dry on its first good signings, its minimum
  signings waited for camp, and free agency's signings a club fell from 11 to 4 by a league's fifth season.
- **No early spending** (`SPEND_FIRST.days` 0, `fillShare` 0): with the credit, the cushion spent in the first days took
  kickoff room under 1.5% of the cap, and nothing rebuilt it.
- **The fading rule from 30, at a bar of 2.0** (`FADING`, from 32 and 1.6; the owner's call after three rounds on the
  bar): once clubs could afford every downhill veteran, good deals ending with no deal fell to 8–9% (NFL 25%), and
  29–31-year-olds found a club 98% of the time (NFL 81%). A higher bar at 32 alone barely moved it.
- **A fresh review's fixes:** a deal's years past the horizon are netted like the last year they fold onto; a lowered
  offer that falls back keeps the restructure that pays for it; a restructure reserves every year of the deals it makes
  room for, the window's earlier keepers included (it reserved next year's pay alone).
- Tried and left out: a two-year cell for 32-and-older good deals (`DEAL_YEARS`; NFL 2–5% at 32+: mean 1.62 years, 48%
  one-year, nflverse 2018–21) moved nothing on the line it aimed at.

Result on `npm run offseason -- 6` (CI's seed, three drift leagues to season 10): kickoff room 2.1–2.8% in every season
4–10, cap spread 0.3, next year's commitments −0.7 points, free agency's signings a club 0.90 and the roster entering
camp 0.97 (seasons 8–10 against 2–4), good deals ending with no deal 11%, deal lengths by pay all inside the NFL's,
nothing outside its range. The
free-agency market's size is still a known issue, now supply-bound: about 105 good deals end a year against the NFL's
181, stars over 10% of the cap run 2.0 a club against the NFL's 1.2, and 8–10% of good outside signings were released
against 20–27% (`docs/MVP.md`).
