# The free-agency market and the 31–32 exits (one tuning pass)

Owner: carlosa512 · 2026-11-16 · follows the front offices (0.4.48, `2026-11-15-front-offices-design.md`)

## Intent

Bring two known issues the checks still warn about to the NFL's averages, then make their lines real checks. The game
already feels right to the owner; this pass is about the numbers (the owner: "check numbers mostly"; "aim for the
average, not hyper-realism").

1. **The free-agency market runs about half the NFL's size.** Good outside signings (a deal at 2% of the cap or more
   with a new club) 43–74 a year against the NFL's 84–109; the one-year share of them climbs from about 25% to 50–70% by a
   league's fifth season against the NFL's 20%; clubs with three or more 4–13; almost no good player left without a deal.
2. **Starters leave football at 31–32 about twice as often as the NFL's.** About two-thirds of it is retirement, a third
   veterans nobody signed. Starters out of football at kickoff reach 5–8% by season 6 (NFL 2–4%).

## What the recon found (2026-11-16, `offseason-audit`, six offseasons)

- **One-year deals come from the ask, not the table.** A player's asked length follows his *market* price
  (`demand` → `dealYears(player, market / cap)`), but bidding often signs him at 2% of the cap or more while his market
  sat in the 0.8–2% tier, so he signs a cheaper player's one- or two-year ask. Of 16–28 one-year good outside signings a
  season from 2029 on, the length table itself called for one year in only 3–5.
- **Clubs keep too many of their own; almost nobody goes unsigned.** Good deals ending: stayed 47–57% (NFL 36%), moved
  38–49% (NFL 38%), no deal 2–8% (NFL 25%; 40% at 32 and older, 14% at 28 or younger).
- **A source the NFL has and we don't: spring cuts.** 20–27% of the NFL's outside signings at 0.8% of the cap or more
  left a deal with years still to run (released). AI clubs here rarely cut a veteran with years left, and after 0.4.48's
  shorter deals they no longer cut in the re-sign window at all (`capCut` finds no fair cut).
- **The 31–32 exits:** two-thirds retirement (`retireChance`, `RETIRE_BODY` in `aging.ts`), a third unsigned veterans.
  Project A found retirement for age alone can't take it under the band without starving 29–30.
- **A tension:** more good players left without a deal (2–8% → about 25%) and fewer starters out of football (5–8% →
  2–4%) pull opposite ways. In the NFL they are different men: the unsigned are mostly 32 and older and backups, not
  last season's starters.

## Goals

At the end, each line inside its **usual band**, judged on the average of seasons 2–6 of `npm run offseason -- 6` (one
season of one league is luck), and then made a **real check** (fails outside its normal band):

| Line | Now | Usual band (target) | NFL |
| --- | --- | --- | --- |
| Good outside signings a year | 43–74 | 75–120 | 84–109 |
| One-year share of good outside signings | ~25% → 50–70% | 10–30% | 20% |
| Clubs with 3+ good outside signings | 4–13 | 8–28 | 16–22 |
| Good deals ending with no deal | 2–8% | 10–40% | 25% |
| Starters out of football at kickoff (steady) | 5–8% | 2.5–4.5% | 2–4% |
| Starters gone at 31–32 (`careers`) | ~2× the NFL | the careers usual band | NFL by group |

Everything else holds: every check that passes on main still passes (`offseason`, `trades`, `morale`, `careers`, `sim`,
`gm-habits`), and the lines near their edge on main stay inside: win spread (3.58, fails 3.6), margin spread (13.33, fails
13.6), meetings a club a season (5.55, fails 6), young starting QBs (27.6%, floor 22.5%).

## Non-goals

- Tags spiking, restructures in a new league's first seasons, the save growing: other known issues, untouched.
- The game's feel and screens beyond the one new refusal below.
- Hyper-realism: the average across seasons in band is enough.

## Anti-goals

- Your own offseason changing much: the market's fixes act on AI clubs; your players change only by the small chance
  below.
- Loosening a band to get green. A line that won't come in after its tuning step goes back to the owner with the numbers.
- Young good players left unsigned (the existing "no young star unsigned at kickoff" line keeps failing on any).

## Approaches (the owner picked A)

- **A. Fix the market, then retirement (picked).** Deal length by the pay signed; AI clubs re-sign their own less; AI
  clubs cut overpaid veterans in the spring; then, measured, a starter at 31–32 retires less while he still starts. One
  pass, one reshuffle, each lever with its own measured line.
- B. Lengths and retirement only: smaller, but good outside signings and no-deal likely stay short, two warnings kept.
- C. The market only, retirement later: two reshuffles of the seeded worlds (two rounds of moved tests).

## The design

Four levers, built and measured in this order (each moves the next one's numbers):

1. **A deal's length follows the pay signed.** An AI club's offer runs `dealYears(player, offer APY / cap)`, not the ask's
   length read from his market price. Since 0.4.48 a longer deal at his price costs the player nothing
   (`offerValue`), so the offer still clears. Your own offers are yours to set, as today. Expected: the one-year share
   of good outside signings falls toward the table's own (about 20–30%).

2. **AI clubs re-sign their own less (the owner's choice: the club side, "1").** `resignCall` and the re-sign window keep
   a good player only when his price fits the club's plan (his ask against what the club reads him worth where he's
   headed, `teamOutlook`), and otherwise let him test the market (he may still come back in free agency). One knob,
   tuned so stayed falls toward 36–45% and moved and no-deal rise.
   **And a small player side (the owner: "some chance for 2, just lower but non zero"):** a good player of yours whose
   deal ends may want to test free agency before he re-signs: a low chance a league year, less for a loyal one, drawn
   once per player per league year on its own stream (AI clubs already have this: `TESTS_MARKET` 0.3 × (1 − loyalty)).
   In your re-sign window his row and the contracts letter say he wants to see the market; your offers before free
   agency are refused with that reason; you can still sign him once free agency opens. Never a player you promised a
   deal (`promisedDeal`), as today for AI clubs.

3. **AI clubs cut overpaid veterans in the spring.** At the new league year, an AI club releases a veteran with years left
   whose cap charge runs well past what it reads him worth where he's headed, when the release saves room this year
   and next (`twoYearRoom`), never a young star, never below the position's floor (`KEEP_MIN`), after the trade market's
   call-around for cap casualties (`marketMoment`) has had its turn. Sized so released players are about a fifth to a
   quarter of good outside signings, as the NFL's are.

4. **A starter at 31–32 retires less while he still starts** (only what levers 1–3 leave). `retireChance` leans down for
   a player who started last season (read from his snaps, as the careers check reads starters), so a starter on the
   field plays on and a backup at the same age still goes. Sized against the careers 31–32 lines without moving 29–30.

## Constraints

- Engine purity: no `Math.random`; every new draw on its own stream (`${seed}:…`), so other streams don't move.
- `League` stays plain JSON; a new stored field means `SAVE_VERSION` and a `migrate.ts` step (a player's market-test
  answer for the league year, if stored).
- Letters and screen text follow `docs/NEWS.md` "Words in a letter" and `docs/UI.md` "Words on a screen"; the new
  refusal goes through `letterRules`/`copy`.
- The fog of war: AI clubs judge other clubs' players on their own read (`perceive`); your staff never cuts or signs.

## How we work (the lessons in `CLAUDE.md`)

- All engine changes first, moved tests fixed once at the end; tests find their scene rather than pin a seed.
- Steer each lever with a fast probe (six offseasons of one league, the market lines; two careers leagues for lever 4),
  then confirm with `npm run offseason -- 6` and `npm run careers`, one CPU-heavy job at a time.
- Stop rule: each lever's knob gets at most three probe rounds; a line still out goes to the owner with the numbers.
- Measure moods early: more players moving and cut may move morale (rooms, meetings, trade requests) and the trade
  market (cap casualties on the phone). Run `npm run morale` and `npm run trades` after levers 2 and 3.
- A fresh reviewer before the PR; local checks steer, CI verifies; one push per CI fix.

## What becomes a check at the end

- `offseason`: good outside signings, one-year share, clubs with 3+, no deal, starters out of football: judged on the
  seasons' average (seasons 2–6), failing outside the normal band; per-season values stay printed. The known-issue
  banner names only what remains.
- `careers`: the 31–32 exits judged again (made soft in 0.4.48 as retirement's follow-up), if lever 4 brings them in.

## Calls made after the builder check (mine, for the owner to check)

- **"Good" is 2% of the cap everywhere the market lines judge** (`GOOD` in `scripts/free-agency-core.ts`): good deals
  ending, stayed/moved/no deal and good outside signings. The NFL's 0.8% figure for released players is a sizing guide
  for lever 3 only.
- **The spring-cut share is printed, not judged:** a line in `offseason`'s market block (good outside signings who left
  a deal with years still to run, as a share), to size lever 3 against the NFL's fifth to a quarter.
- **Lever 3 extends the existing cut logic** (`capCut`, `twoYearRoom`, and the trade market's call-around for cap
  casualties, `marketMoment`), not new code beside it. A player the call-around trades away counts as moved, as today.
- **When the two lines pull apart, starters out of football wins:** no starter is kept out of the market, but a starter
  of last season still unsigned in camp is one a club with the need signs at his price or the minimum (the late market
  and `needSigning` that exist), so the unsigned are the fading and the backups, as in the NFL. No deal may then sit at
  the low end of its band (10%+).
- **Lever 1 offers the longer of the two lengths:** the table's at the offer's pay, or his asked years when that is
  longer (an offer under his market price), so an offer never loses value to its length.
- **The player-side test is a draw, not a stored answer:** `${seed}:testsMarket:${season}:${playerId}`, read the same
  every time, so nothing new is saved (no `SAVE_VERSION` bump). He counts as decided in the re-sign window (the advance
  button doesn't wait on him: he goes to free agency unless you sign him there); his row says he wants to see the market.
- **Lever 4 reads "started last season" from the season just finished, by snaps** (top N at his position, as the careers
  check reads starters; kickers and punters by games), at the new league year when retirement runs.
- **The judged market averages pool the four leagues** `offseason` already plays (this one and the three in child
  processes), seasons 2–6, for less noise; each league's season values stay printed.

## Left to the builder

The knob values (tuned), how "his price fits the plan" is measured exactly, the spring-cut threshold, the player-side
chance (low: a few in a hundred), the wording of the refusal, the probe scripts, and the order of fixing moved tests.

## What was built (2026-11-16)

- Lever 1 (`aiOfferYears`), lever 2 (`RESIGN_VALUE` 1.2; your side `wantsMarket`, `USER_TESTS_MARKET` 0.08), lever 3
  (`springCuts`, `SPRING_CUT.margin` 0.5, the floor at starters under contract: `KEEP_MIN` let nobody go in March),
  lever 4 (`campStarterSignings` with the in-season cushion and no roster limit in camp; `RETIRE_BODY.starterLean` 0.55,
  kickers and punters aside, a part of it at 31 and all of it from 32 after his birthday: `starterFrom` 31, `starterFirst` 0.5). Added on the way, the owner's calls: free agency passes more on fading veterans (`FADING`)
  and clubs spend first (`SPEND_FIRST`). Tried and undone: a March room share (no effect) and longer cheap deals (broke
  the judged length line).
- Result, four leagues' seasons 2–6: stayed 35–45%, no deal 15% (judged), released 18%; good outside signings 59,
  one-year 48%, clubs 3+ 8.0, starters out of football 7.2% stay warnings. Careers: all 31 gone 15.5%, long prime 31–32
  in band; short prime 31–32 and all 32 still high (soft).
- CI (2026-11-16): the whole lean at every age took long-prime starters at 30 under the NFL's exits (8.7%, fails under
  9.2); none at 31 made linemen retire from rosters at 31 (median, fails under 32). Half at 31: starters at 30 gone 12.7%
  (NFL 15.2); linemen's median retirement age made soft (the owner's call), since no lean at 31 brought it back.
- Follow-ups: the pay structure (fewer good deals end each year than the NFL's), short-prime veterans walking away,
  linemen retiring young from rosters (veteran linemen cut or passed over retire unsigned), and the median club's room
  at kickoff, which runs 0.5–1.0% of the cap in seasons 4–6 against main's 0.9–1.0 (warns under 1, fails under 0.5).
