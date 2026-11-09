# A cap cut that counts next year

## The problem

When an AI club needs cap room (`aiCapCompliance`, and `makeRoom` for its keepers), it cuts the man `capCut` picks:
the lowest rating per dollar the cut saves **this league year**. Next year never enters it. In camp every cut is booked
post-June 1, so the cut takes only this year's share of his bonus now and pushes the rest into next year: it can look
cheap today and leave next year worse than keeping him.

What that does, from a traced six-season league (`npm run offseason -- 6`, default seed):

- Main: 131 releases that left more than $15M of dead money, 86 of them cap cuts; in 23 the dead money was more than
  twice what the cut saved.
- With AI concussion sits and the passer tune on top (the held-back 0.4.19 work), 148, 101 and 41: WAS cut DT Makai
  Tupua (signed that year) for $52M dead to save $6M; NYK traded for QB Tobias Bowen, extended him at $78M a year, and
  cut him in camp for $74M dead to save $28M.
- Those cuts drive `dead median %cap` in the league's sixth season past its ceiling of 6 in two of three worlds tried
  (6.5 and 7.9; main 2.0-4.3), which is why the sit feature was held back.

Real clubs do eat dead money, but they rarely cut a man they signed or extended weeks earlier, and a cut that makes
next year's books worse than keeping him is a last resort, not the first choice.

## The change

`capCut` (`offseason/ai.ts`) judges a cut by the room it makes over **two league years**:

- **Room** = this year's savings (`releasePreview(...).savings`, as today) + next year's net: his cap hit next year
  that the cut removes (`capHit(contract, season + 1)`, 0 if his deal ends) minus the dead money it books there
  (`releasePreview(...).nextYear`).
- The two-year room is a **filter**, not the ranking: a cut needs this year's savings past 200 (as today) **and**
  two-year room past 0, and among those the club cuts the least rating per dollar saved **this year** (today's rule:
  room now is what it needs). Ranked by two-year room, the first build cut a re-sign-window man whose cut (all its dead
  money this year) freed $1M now and $40M next year, $104M of dead money for $1M of room: 69 bad cuts against main's 23.
- **A deal signed this league year** (`contract.signedSeason === league.season`, a signing, re-signing, extension or
  trade-and-extend) is cut for cap only when no one else frees room: the club made that call weeks ago.
- **Desperate** (today: short more than 4% of the cap) keeps its meaning, floors at starters, and may still take a cut
  with two-year room at or below 0, or a deal signed this year, when nothing else is left. The cap is the law.

Nothing else moves: restructures still come first (`restructureRoom`), `cutChoice` (the cut to 53 by rating) is
untouched, and the user's club is never cut for (as today).

## Expected effect and checks

- Fewer big-dead releases, fewer "dead > 2x savings" cuts; restructures and cuts of cheaper veterans take their place.
- `npm run offseason -- 6` on the default seed and alt-1, alt-2: dead median and max inside their bands every season,
  over cap 0, rosters at 53; the restructuring share is a known swing (warning) and may rise.
- `npm run trades` (dumps and cap-driven deals read the same cap), `npm run careers` (who leaves football), the unit
  tests for `capCut` and cap compliance (`offseason/*.test.ts`).
- Then the held-back 0.4.19 work (Sit him this week, AI sits, the third-and-medium tune) is re-landed on top and the
  full check run, so the sixth-season dead-money line is judged with the fix in.

## Tests

- `capCut` ranks a cut that makes next year worse below one that doesn't, at the same rating and this-year savings.
- `capCut` skips a deal signed this league year while anyone else frees room; desperate, it takes him when nothing else
  is left.
- A camp scene: a club over the cap with a just-extended veteran and a cheaper man of similar rating cuts the cheaper man.

## Files

`src/engine/offseason/ai.ts` (`capCut`), its tests in `src/engine/offseason/`, `docs/MVP.md` only if an item names it,
changelog and a PATCH bump.
