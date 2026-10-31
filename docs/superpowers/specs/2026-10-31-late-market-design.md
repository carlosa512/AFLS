# The late free-agency market: good players find a club

Date: 2026-10-31 · Same branch and PR as parity (`2026-10-30-parity-design.md`): it is why careers' tree lines read at
their floor, and parity can't merge red.

## Why

Sim teams don't stay good. A team's record correlates with its own three seasons later at −0.03 in the sim against
0.18 in the NFL, and five seasons later at −0.07 against 0.15 (*nflverse* schedules, 2002–24). The roster itself
fades: a top-8 roster loses 0.6 of team overall in three years and a bottom-8 one gains 0.55, at the same age. So no
head coach holds .600 over five seasons (2.6 do in the sim against 7.3 in the NFL, though owners hire and fire as
the NFL's do: 7.1 changes a year against 7.3, with the same curve by record), trees run thin, and a user who builds
a contender can't keep one.

Measured in the careers leagues (main and this branch alike, so it is old):

- **About 56 of the 250 starters whose deals expire each year are still unsigned at the next kickoff:** 23%, at
  12.3 overall against 12.9 for those re-signed. Strong clubs lose the most (2.2 starters a year at 13.3). In the
  NFL, 4.7–6.2% of a season's regular starters don't play the next season at all, retirements and injuries included
  (*nflverse* snap counts, 2021–24); in the sim, retired plus unsigned is about 9.6%.
- **Why they go unsigned.** On the last free-agency pass that looks at each one, about 30 of the 31 AI clubs are
  stopped by their budget: the AI's offer, priced off his market value, doesn't fit the room it has left. None got an
  offer through. And the AI only shops on free-agency days 1–5: the walk-away price is built to keep falling through
  the draft (25% under) and preseason (35%), but no club looks again.

The NFL's late market works the other way: a good veteran still unsigned in April or August signs a one-year
prove-it deal with whoever has room.

## Decisions

1. **A club offers what it can fit.** In `aiFreeAgencyDay`, when a club wants a player (his gain clears its bars)
   but its market-priced offer doesn't fit its budget, it offers a one-year deal at the room it has left (`spendable`,
   never below his minimum), no signing bonus, and checks its upgrade bar again at that price. He signs if it beats
   his walk-away price, which falls as the market wears on (`marketPressure`). He is never paid less than his walk-away
   asks: the deal he takes is his own choice.
2. **The market keeps running after day 5.** The AI's free-agency pass also runs once on draft day (after the draft,
   at the draft's 25% pressure) and once as camp opens (preseason, 35%), for AI clubs only (yours too only when you
   let the staff run it), within the 90-man roster.
3. **Nothing else changes.** Asks, walk-aways, the re-sign window, tags, the cap rules and in-season signings stay as
   they are. No player is capped; the market just stops shutting its door on him.

## Checks

- **`npm run offseason`:** last season's starters out of football at kickoff (unsigned or retired), as a share:
  judged 2.5–4.5% (owner's call, 2026-10-31), counted as nflverse counts it: 3.2% and 2.9% of regular starters were on
  no club's week-1 roster the next season (2022–24), another 1.5–2.1% on one but hurt or on a reserve list. (The first
  version judged 4–7% against the 4.7–6.2% who didn't play at all, injuries included.) Cap space, rosters and talent
  stay stable, as judged today.
- **`npm run careers`:** a team's record against its own one and three seasons later, reported against the NFL's 0.34
  and 0.18; the five tree lines and the rest judged as today.
- **`npm run trades`, `npm run morale`, `npm run sim`:** run as usual on CI; nothing may be flagged, no range moves.
- **Unit tests:** a wanted free agent whose market price doesn't fit gets a one-year offer at the room left and signs
  when it beats his walk-away, and not when it doesn't; a starter unsigned after day 5 signs on draft day or as camp
  opens when a club has room and need; a late pass never signs past the 90.

## Files

| File | Change |
| --- | --- |
| `src/engine/offseason/ai.ts` | the fitted offer in `aiFreeAgencyDay` |
| `src/engine/offseason/index.ts` | the late passes on draft day and as camp opens |
| `scripts/offseason*.ts`, `scripts/careers*.ts` | the out-of-football share; record persistence reported |
| tests | the cases above |

## Out of scope

- Re-sign behaviour and extensions (clubs keep 49% of expiring starters; measured, not changed).
- Your own free agency screens: offers to you and your negotiations are untouched.
- The owner's blurrier-reads idea for lasting winners (a follow-up, if trees still run thin).
