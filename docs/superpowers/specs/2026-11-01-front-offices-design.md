# Front offices that work like real ones

Date: 2026-11-01 · Same branch and PR as parity and the late market (`2026-10-30-parity-design.md`,
`2026-10-31-late-market-design.md`): careers' tree lines and the offseason check's out-of-football line wait on it.

## Why

A good team in the sim doesn't stay good, so no coach lasts as a winner and coaching trees run thin. The digging so
far, each step measured in the careers leagues against *nflverse*:

| What | Sim | NFL |
|---|---|---|
| A record against its own a season on / three seasons on | 0.26 → **0.33** / −0.04 → −0.07 | 0.34 / 0.18 |
| Expiring starters unsigned at kickoff | 23% → about 4% (years 1–3) | |
| Starters out of football at kickoff (unsigned or retired), years 1–3 / 4–8 | 3.5–4.2% / **9.6–14%** | 2.9–3.2% |
| A contender's 13+ keepers lost to the cap in the re-sign window | 32% → (now makes room) | |
| Franchise tags a season | about 2 | 6–10 (2021–24; 2 and 4 the last two) |

The late market (a club offers what it can fit, shopping past day 5) and the GM making room for its core (restructures
within next year's books, then a lesser cut) fixed the first season's carryover. What's left is a **cap crunch from
year 4**: clubs re-sign their own on market deals and keep more of them, so when free agency opens the league as a
whole hasn't the room for the prime-age players left over. 8–12% of last season's starters (about 29, rated 12.2–12.9)
sit unsigned at kickoff. Even a fitted offer can't reach them: most clubs have nothing spendable past the money they
hold for rookies, the bottom of the roster and in-season injuries, and a free agent's walk-away stops at about half his
market even in August.

An NFL market always clears. A good veteran still unsigned by camp takes what's left, often a one-year deal near the
veteran minimum; a club with no room cuts a lesser, pricier player to fit a better one; and a club about to lose a
star it can't sign uses its tag.

## Decisions

1. **Front offices decide, with the GM's own tendencies.** Every lever below is a choice a GM makes for a reason his
   club can see, scaled by his traits (cap aggression, win-now, loyalty), never a hidden cap on a player.
2. **Three levers, in this order** (each needs the one before it to work):
   - **The market clears by camp.** A free agent still unsigned when camp opens lowers his floor to what's left: his
     walk-away on the camp pass falls to his minimum. Before camp, nothing changes (the draft's and preseason's
     pressure stand). In season he stays a call-up for an injury, as today.
   - **A GM upgrades by cutting** (measured and dropped: see *What the measurements changed*). On free-agency days and the late passes, a club that wants a free agent (his gain
     clears its bars) but can't fit even a fitted offer may release a player to make the room: the one it can best
     spare (`capCut`), only if he is worse than the free agent at his outlook and his release saves enough for the
     fitted deal. One such cut per club per pass.
   - **The tag keeps a star who'd walk.** In the re-sign window, a keeper who won't sign (he tests the market, or the
     room can't be made) is tagged when he's in the club's plans as a starter, young enough for his position's clock
     (today's age line), the tag's charge fits after the GM makes room, and the club hasn't tagged anyone this year.
     The coin flip goes: it's the GM's decision, more readily for a win-now GM. Sized to the NFL's 6–10 a season.
3. **Owners come next.** Owners already set budgets and judge their GM and coach; how much cash an owner lets his GM
   spend on bonuses and guarantees is its own design, after this.

## Checks

- **`npm run offseason`:** starters out of football 2.5–4.5% every season (as judged now, years 6–7 included); cap
  space, dead money, nobody over the cap, rosters and the free-agent pool stay in their ranges. New: **tags a season,
  judged 4–10** (NFL 2021–24: 10, 8, 6, 9).
- **`npm run careers`:** record carryover reported (NFL 0.34 and 0.18; the aim is three seasons positive), the tree lines
  and the rest judged as today, highest starter overall included (the ceiling 13.2: clubs keeping more of their good
  players must not inflate league talent).
- **`npm run trades`, `npm run morale`, `npm run sim`:** as usual on CI.
- **Unit tests:** a free agent unsigned at camp signs for his minimum when that's all a club can fit, not before camp; a
  club cuts a lesser, pricier player to sign a better free agent and never a better one, at most once a pass; a keeper
  who'd walk is tagged when the tag fits and he's a starter in the club's plans, never a second tag in a year, never one
  past his age line.

## Files

| File | Change |
| --- | --- |
| `src/engine/offseason/negotiation.ts` | the camp pass's floor (`demand`'s walk-away) |
| `src/engine/offseason/ai.ts` | the tag decision in `aiResignWindow`; `inPlans`, `restructureRoom` (make-room and cap compliance); next year's needs and the contend-or-rebuild ceiling |
| `src/engine/offseason/index.ts` | the camp pass marked as the last call |
| `scripts/offseason.ts` | tags a season; clubs restructuring a season |
| tests | the cases above |

## What the measurements changed

Measured in the offseason check and side-by-side probes on one league, six seasons each:

- **The tag is priced against the club's own price for him.** A thin room (its expiring players taken out) read any
  player there as a starter, so clubs tagged 7-rated backups at a starter's wage: 14–24 tags a season. A GM now tags only
  a player he'd offer near the tag's top-of-the-position wage. Tags: 4–12 a season.
- **The upgrade cut is gone.** With it, the median club's dead money ran 9.0, 8.1 and 7.3% of the cap in seasons 4–6;
  without it 3.7, 4.2 and 2.3%, restructures the same. Cuts jumped from about 3 a season to 46 in year four, when clubs
  run short and release pricier veterans whose bonus money then lands at once. Without it good starters still sign (the
  late passes and the last call place them); the starters left unsigned are faded veterans (about 32, rated 9–10)
  already asking the minimum.
- **A GM restructures only a player he plans to keep starting** (`inPlans`: still among his starters at the club's
  three-season read): aging veterans restructured, then cut or traded a year on, carried 51–68% of the league's dead
  money. **A club over the cap gets under it the same way** (only what it needs, only players in its plans, then the
  player it can best spare; anyone only as the last resort, since no team plays over the cap).
- **Retirements are not the problem.** Sim starters retire at 1.4–3.7% a season; in the NFL 2.1–4.0% of a season's
  starters are on no roster the next one, nearly all for good (*nflverse* snap counts and week-1 rosters, 2021–24).

## GMs plan next year before they borrow

What's left: clubs tighten every season. Room made for keepers is 86, 98, 137, 167 and 157 restructures in seasons 1–5
(the cap pass adds 1–4), so by year four no club has room for a faded veteran, and starters out of football run 4.9–5.7%
(2.5–4.5). In the NFL about 45% of clubs restructure nobody in a year and 37% do a major one (over $6.5M); 78% of
playoff teams restructure, and teams coming off a playoff year lean on it hardest (Over the Cap, *Looking at
restructuring NFL contracts*). Ours: nearly every club, three to five times a year, contending or rebuilding. A GM
borrows into next year while next year's committed pay sits under his ceiling (90–97% of the cap), forgetting next
year's own needs, so next year he is short again.

1. **Plan next year first.** Before he borrows, a GM counts next year's needs against next year's cap: the players whose
   deals end after this league year that he plans to keep (`inPlans`), at their market price; next year's draft class
   (this year's rookie pool as the estimate); and the cushion he holds for in-season injuries (`inSeasonReserve` at next
   year's cap). He borrows only what's left under his ceiling.
2. **Contend or rebuild.** How much of next year a GM commits early reads his cap aggression (as now) and how hard he
   plays for now (`winNow`: his temperament with where his roster stands). An all-in contender borrows to the full
   ceiling; a rebuilding club commits less, lets a middling keeper walk and keeps the space (unused cap carries over).
   Nothing is barred: a rebuilder still borrows a little for a keeper he needs. The size of the rebuild's caution is set
   by the NFL's share below.

The worth check tried first (a keeper worth the room's borrowed money, `roomWorth`) is dropped: against a room with its
expiring players taken out, nearly every keeper reads as worth it, so it rarely changed a decision.

**Check (`npm run offseason`):** clubs restructuring anyone a season, judged 40–70% (the NFL's about 55%). Starters out
of football, dead money, tags and cap space judged as before; careers as before.

## Out of scope

- Owners' spending (the next design), the user's own free-agency screens and negotiations, in-season signings.
- Contenders selling their stars (70 rated 13+ in 26 league-seasons, mostly for picks): measured, a trade-AI question
  for after this.
