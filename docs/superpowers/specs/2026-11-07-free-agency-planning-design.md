# Front offices that plan: keepers first, room on purpose, a market that clears

**Status:** built (0.4.13); approved by the owner 2026-11-07; the bands (§6) rebuilt on NFL data at the owner's request the same
day (`docs/research/free-agency-market.md`). Follows 0.4.11 (the practice-squad holdout fix, which stopped elite free
agents signing for squad pay but left them unsigned).

## Why

A save four seasons in had a 16.3 quarterback, a 15.4 corner and 80-odd players the market prices as good (2%+ of the
cap) unsigned at kickoff. Tracking a fresh league (`track-fa`, four offseasons) showed it is not too much talent, it is
money and planning, and it gets worse every year:

| Offseason into | Good players expiring | Keepers lost (club wanted him) | Median spendable at FA open | Good players unsigned at kickoff |
| --- | --- | --- | --- | --- |
| 2027 | 96 | 26 of 91 | 5.8% of the cap | 3 |
| 2028 | 102 | 40 of 98 | 2.5% | 6 |
| 2029 | 123 | 48 of 117 | 1.6% | 32 |
| 2030 | 170 | 78 of 161 | 0.7% | 82 |

- **Talent is steady.** The market is rank-based, so about 530 players price as good every year. No talent tuning.
- **Keepers walk for want of room.** Of the 78 keepers lost in 2030, 60 couldn't be fitted, 16 chose to test the
  market (`testsMarket`, 30% × (1 − loyalty)), 2 turned the price down. The window takes a club's expiring players in
  roster order, so cheaper ones spend the room before the star is reached, and `makeRoom` works one keeper at a time.
- **Nobody has room.** Every AI club spends to its reserve floor every year: at kickoff the median club holds 2–4% of
  the cap and the roomiest 5% (`payAhead` turns anything above the reserve into next year's salary). In the NFL a few
  rebuilding clubs carry big room into March, and that is where the stars land.
- **The market never clears.** Sights fall by the calendar (`marketPressure`: 5% a day to 20%, 35% at camp), not by
  what clubs can pay. On the last call a player takes his minimum, but 29 of 32 clubs can't fit a minimum by then
  (`spendable` is below it once the in-season, squad and fill reserves are held).
- **It feeds itself.** A stranded player takes a one-year prove-it deal (`fitOffer`) or nothing, and is back on the
  market next spring: veteran deals in their last year rose from 124 to 170.

Measured the NFL's way (`docs/research/free-agency-market.md`: Over The Cap's contracts 2014–2021 through nflverse,
and the same definitions on AFLS), the gap is the market for other clubs' players, not how many clubs keep:

| | NFL | AFLS, into 2027 → 2030 |
| --- | --- | --- |
| Good deals (2%+ of the cap) reaching their end: stayed | 36% | 24–49% |
| … moved to another club | 38% | 71% → 35% |
| … no deal | 25% | 6% → 35% |
| … no deal, 28 or younger | 14% | 0% → 44% |
| Good outside signings a league year | 84–109 | 36–59 |
| Clubs with 3+ of them | 16–22 | 2–10 |
| Their share on one-year deals | 20% | 9% → 56% |

The owner's calls (2026-11-07): AI GMs plan like the user can (they see who is coming to market and who they need to
keep), make calculated moves, and no elite young player stays unsigned. News of re-signings: the players who were set to
hit the market and didn't, in one email. Talent levels are the designer's call: unchanged.

## 1. The cap plan (`offseason/capPlan.ts`)

A pure read, nothing stored: `capPlan(league, team)` built from the league as it stands, cached per calendar step like
`viewCache`. The user's club gets one only when the AI runs it (`autoUser`).

- **Keepers:** its own expiring players `resignCall` keeps or tags, best first by its outlook (`ahead`), each priced at
  its offer (`aiOffer`, as the window prices him today). A keeper is **worth his price** when his gain clears the same
  bar a free agent's price must (`upgradeBar` at his offer) and no target at his position (below) buys more gain for
  the same money; one who isn't walks, and the room goes to the market.
- **Next year's keepers:** `nextYearNeeds` (already there: planned starters whose deals end after this league year, at
  market, plus next year's draft class).
- **Fixed costs:** the rookie class (`rookieReserve`), the minimum fills for open spots, the in-season and squad
  reserves: what `spendable` already holds back.
- **Targets:** other clubs' expiring players its scouts rate as an upgrade at a need (the same "Coming to market" list
  the user sees, on its own read): the best one or two, priced at market.
- **Stance**, from `winNow` (the GM's temperament and the roster): **spend** (contender: keepers, then upgrades to the
  reserve floor), **balance** (keepers and next year's keepers first, then upgrades), **bank** (rebuilder: keepers, then
  only young players or big upgrades; what it doesn't spend `payAhead` already moves into next year's room, so a
  rebuilder reaches the next March with real room).
- **Free-agency room (dropped in the build):** next year's hold is enforced on big multi-year deals (§3), not as a budget; cap space less fixed costs less the keepers it will sign, less next year's keepers' room held by
  `balance` and `bank`.

## 2. The re-sign window in priority (`aiResignWindow`)

- Keepers are taken best first (`ahead`, starters before depth), not in roster order.
- **Room on purpose, before the window:** when the plan's keepers cost more than its room, the GM makes the room once
  for the set it can afford, in priority order: restructures of players in its plans (`restructurePlan`), then cap
  casualties (`capCut`: the least play per dollar, never a player better than the keeper he funds). A keeper still out
  of reach is tagged when he is worth the tag (`tryTag`, unchanged), else he walks and the plan knows it.
- A depth keeper doesn't take room the plan holds for a better target coming to market.
- Unchanged: `testsMarket`, promised deals (G4), the GM habits that run here (Tags First, Extends Early, His Guys).

## 3. Spending discipline (`aiFreeAgencyDay`)

- A multi-year bid must leave next year's keepers' room: next year's commitments + next year's keepers + this deal's
  APY within the GM's `nextYearCeiling`. Replaces the flat check (`committedNext + apy > 0.92 × next cap`, only for deals
  over 3% of the cap).
- A **bank** club bids only on players 27 or younger, or on an upgrade that clears twice the bar its price sets
  (`upgradeBar`).

## 4. A market that clears

- **Sights by the market, not the calendar.** From free agency's third day, a free agent no club bid for at his floor
  takes the best fitted offer clubs made for him (`fitOffer`, which a club already computes for a player it wants but
  can't pay in full) when it is at least half his walk-away. Stateless: the passes already price every bid; the best
  fitted one is his market that day. Never under his minimum; below half, `marketPressure` keeps lowering his sights as
  today, and the last call still takes anything from his minimum up.
- **The last call, funded.** On the last call (camp opens) and in camp, a club with a need may sign a clear upgrade (the
  `needGain` bar doubled) on a one-year deal by releasing its weakest minimum-salary player at that position (a minimum
  deal carries no dead money) and drawing up to half its in-season reserve.
- **Young players sign for more than a year.** A fitted offer to a player 28 or younger runs two years (still no bonus):
  the one-year prove-it deal is a veteran's (the NFL's one-year share of good outside signings is 20%; AFLS's climbs to
  56%).
- **Goal:** no player 28 or younger whom the market prices at 5%+ of the cap is unsigned at kickoff (the owner's call);
  older veterans may wait for an injury call (`needSigning`, unchanged) or retire.

## 5. News: off the market (`inbox.ts`)

One SNN story when free agency opens (phase `freeAgency`, day 1), filed once a league year (`offMarket:${season}`):

- **Headline:** "Off the market: 14 re-signed, 4 tagged before free agency".
- **Table:** other clubs' players whose deals ran out and who re-signed or were tagged in the window, best first by our
  scouts' read (`seenOvr`): player, position, club, the deal (years and total, or "Franchise tag"). Twelve rows, then
  "and N more".
- **Closing line:** the three best by our read still heading to market, with a button to free agency.
- **Fog of war:** overalls through our view; deals are public. Our own club's re-signings are left out (the front
  office already reports them in the free agency wrap-up).
- **What it reads:** the transaction log, which gains the player's id on signings, re-signings and tags
  (`Transaction.playerId?`, optional; SAVE_VERSION bump with a no-op upgrade). A save loaded mid-window gets the story
  from the next window on.

## 6. Checks (`npm run offseason`)

New lines, measured with the research doc's definitions (window start to kickoff), judged from the second offseason
on (the generated league's first contracts aren't a market's). Usual band: inside it nothing is said; between usual and
normal the line warns (⚠, `band.ts`); outside normal it fails. Both bands are the owner's call, set around the NFL:

| Line | NFL | AFLS today (into 2030) | Usual | Normal |
| --- | --- | --- | --- | --- |
| Good deals reaching their end: stayed % | 36 | 31 | 28–45 | 20–55 |
| … moved % | 38 | 35 | 30–50 | 20–60 |
| … no deal % | 25 | 35 | 15–32 | 10–40 |
| … no deal %, 28 or younger (pooled over the run: a season has too few) | 14 | 44 | 5–22 | 0–30 |
| Good outside signings | 84–109 | 36 | 75–120 | 60–135 |
| Clubs with 3+ good outside signings | 16–22 | 2 | 12–24 | 8–28 |
| One-year share of good outside signings % | 20 | 56 | 10–30 | 5–40 |
| Players 28 or younger priced at 5%+ unsigned at kickoff (the owner's rule) | – | – | 0 | 0 |

Reported, not judged: keepers lost to room (the window's diagnostic), and room at the window's start (median, clubs
with 10%+, over the cap) beside the NFL's February tables: AFLS rosters refill far more each spring, so the room isn't
alike even when the market is.

The existing lines must hold as they are: median kickoff space 1–4%, dead money median ≤ 6%, clubs restructuring
40–70%, tags 4–10, the free-agent pool 100–650.

## 7. What doesn't change

Talent generation and development; the market's price curve (`TOP_APY_PCT`, `payTier`); the rookie scale; the user's
own decisions (the plan is the AI's; your club is planned only when the AI runs it); trade valuation; the 0.4.11 squad
rule.

## 8. Saves

No new stored state besides `Transaction.playerId`. An existing career picks the plan up at its next offseason step;
the good free agents already stranded in it are signed by the funded last call and the clearing passes the next time
they run (the next league year's free agency at the latest).

## 9. The other open branch (`claude/quirky-shannon-18tnms`)

A play's time, the two-point try and returns: 19 commits in `match/` and `field/`, no engine file in common with this
work. Shared files: `package.json` and `src/ui/changelog.ts` (both claim 0.4.11: whichever merges second takes the next
number), and the offseason, trade and personnel fixtures and snapshots it re-takes because the dice moved (this work
moves them too). Its match changes shift league finances a little, so this work's tuning and audits run after rebasing
onto it once it is on main.

## 10. Testing

- **Unit:** `capPlan` (keepers best first, stance from `winNow`, targets on the club's own read); the window keeps a
  star over cheaper keepers when room is short and makes the room once (restructure, then a cap casualty never better
  than the keeper); a multi-year bid refused when it eats next year's keepers' room; a bank club passing on a marginal
  veteran; a keeper not worth his price walking; a fitted offer to a young player running two years; an unbid free
  agent signing at the best fitted offer after day 2, never under his minimum; the funded last
  call (releases the weakest minimum man, half the in-season reserve at most, one-year deal); the news story (filed
  once, ordered by our read, our club left out, no truth past the fog).
- **Audits:** `npm run offseason -- 6` (the new lines and every existing one), `npm run trades`, `npm run gm-habits`
  (the habits that run in the window and in free agency still move their decisions), `npm run careers`,
  `npm run morale` (`negotiation.ts` changes) and `npm run squads -- 2`. CI runs what the change calls for.
- **Save size:** `Transaction.playerId` adds a few bytes to each of up to 3,000 log entries; the save's allowance grows by
  what it measures (the owner's call, 2026-11-07: "the save will need more room").
