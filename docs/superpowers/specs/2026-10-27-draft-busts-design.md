# Draft busts: ceilings that settle in the league

Date: 2026-10-27 · Branch: `claude/friendly-fermat-g1x4bv`

## Why

Busts almost never happen. A prospect's true ceiling is rolled once and never sits below him
(`offseason/draft.ts:60`), every young player grows toward it each year (`development.ts`), and only an injury from
26 on can lower it (`injuries.ts:752`). The one way to bust is a misread, and the league's misread is small: an sd
of 1 on the grade and 1.4 on the ceiling, on a 1–20 scale. A top-10 pick is about what he was graded. In the NFL
roughly a third of first-rounders never become reliable starters, and Day 3 picks break out often enough to matter.

This is the first of two pieces. The second, a fresh look for the draft screen (in Home's style, with a hit or miss
mark on every pick in the draft history), gets its own brainstorm and spec once this lands.

## Decisions (agreed in the brainstorm)

1. **A mix of causes.** A ceiling on draft day is a best guess. It settles in the league, and makeup and how he
   plays push it. Good scouts narrow the misread and see the makeup, so they see the risk, but never remove it.
2. **NFL-like rate.** About 1 in 3 first-rounders bust; late-round steals come as often the other way.
3. **Revealed over 2–3 seasons.** The ceiling settles a little each year, with the swing shrinking. Ratings stall
   or jump, the staff's read moves, and the coach or director says so in the mail.
4. **Approach: the ceiling settles** (not a wider fixed ceiling, not a hidden bust flag).
5. **Performance counts, not only playing time:** how well he played against players rated like him.
6. **It settles when his team's season ends:** after week 18 if they miss the playoffs, after their last playoff
   game if they make it. Not at the new league year.
7. **Rawer prospects, and a bust can slip (added after the first careers run).** With the class as it was, a
   first-rounder entered already at a solid starter's level, so a stalled ceiling never made a bust (4.4% busted).
   Prospects now come in 0.75 rawer with 0.75 more room (`RAW` in `draft.ts`), and a player under 26 whose ceiling
   settled under him slips toward it, a point a year at most (`rollYear`, past a 0.3 dead zone).
8. **A first-rounder is judged against his slot (owner's call after the prototypes).** Neither settling nor noisier
   draft reads nor a flatter class top could make a third of first-rounders miss a solid starter: teams draft on
   ceiling, and round 1's true ceilings sit about 3.5 points above that line. So a first-round bust is one who never
   becomes a high-end starter (60th percentile), and ceilings are vaguer: `SWING` 2.2, 1.5, 0.8, and hype: in his first
   season's settle only, each point of ceiling past three over his entry overall leans it down by 1.4 (`hypeLean`).
   The class gets 0.9 more room to grow (`HYPE_ROOM`) and a top of 13.95 (from 13.7) for the talent hype takes back.
   Aimed at the upper part of 25–40%, since nobody has seen him against the pros. Careers, 8 seasons: 34.9%
   first-round busts, 17.6% Day 3 hits, starters 12.71–12.91, every row in range.

## The settle

`settleCeiling(league, p, season)` in `development.ts`: a pure function of the league and the player, on its own
stream, `new Rng(`${seed}:ceiling:${season}:${id}`)`. No other stream gains or loses a draw, so development,
retirement and every game replay as they did.

**Who:** a player who is under 26 and in his first three league years (`experience` 0, 1 or 2 during that season):
draft picks, undrafted rookies, young Pathway and practice-squad players alike. A steal can come from anywhere.

**When:** when his team's season ends: after week 18 for a team out of the playoffs, after its playoff exit or
the title game otherwise. A player traded during the year settles with the club he ends it on; a free agent after
week 18. The caller lives in `league.ts` where week 18 and each playoff round are recorded. It settles each player
once a season (`ceilingShifts[season]` present means done), so a re-run never settles twice.

**The roll:** his true ceiling moves by `rng.normal(lean, SWING[year])`, rounded to a tenth and capped at 20.

- `SWING` by year in the league (0, 1, 2): about 1.6, 1.1, 0.6. Tunable.
- `lean` is the sum of three parts, each small:
  - **Work ethic:** `0.02 × (workEthic − TRAIT_MEAN)`, about ±0.2 at the extremes. Work ethic already sets how fast
    he grows, so a bigger lean doubled its effect past the careers audit's range (the first run's 0.085 put the
    work-ethic gap at 26 at 1.6 against 0.3–1).
  - **How well he played:** his season against players rated like him (below), about ±0.4 at the extremes.
  - **Playing time and coaching:** a little up for a starter's snaps (`seasonRole`), a little down for a year
    that barely saw the field; his coaches' development rate tilts it slightly (`0.1 × (rate − 1)`, for the same reason).
- The ceiling may fall below his current overall. He then stops growing, and past a 0.3 dead zone slips toward it,
  a point a year at most (decision 7).

**How well he played:** the measure `PRODUCTION` in `scouting.ts` already defines per position (passer rating,
yards, pressures…), compared not to a league-average starter but to the players at his position rated about the
same that season (true overall at the start of the season, `ratingHistory`, within ±1, widened until there are
enough), in `rule.step` units, clamped and scaled. Against his peers, not the league: otherwise a talented rookie's
numbers would raise a ceiling that was already high. Without enough of a season (`rule.enough`) or at a position
with no rule, this part is 0 and playing time alone counts.

**Kept for later reads:** `Player.ceilingShifts?: Record<number, number>`, the true shift each season. The careers
check reads it, and so do the mail and the scout report (through the user's view, below). It is hidden data: no
screen renders it, and the screen-contract tests say so.

## Development keeps its exactness

A year rolled in March lands in steps, and each step recomputes the year's targets from the player as rolled
(`yearTargets`). That read takes `p.potential`, which until now never moved under 26 during a year. So the year now
keeps the ceiling it was rolled with: `DevYear.potential`, written by `beginYear` for a player under 26, read by
`yearTargets` (`d.potential ?? p.potential`). A settle after the year was rolled changes only the next year's roll.
The release tests (`release.test.ts`, `npm run training`) must still show a year in steps landing where one jump
would.

## Save shape

Two optional fields: `Player.ceilingShifts` and `DevYear.potential`. Bump `SAVE_VERSION` (56 to 57) with a no-op
step in `migrate.ts`: an old save has no shifts (its players settle from their next season end) and its open years
read the player's ceiling, as they did.

## What you see

Never a number, always through the user's view (`viewOf`), under `docs/UI.md`'s fog-of-war list.

- **The ceiling read follows.** Scouts already read a ceiling as truth plus noise (`scouting.ts:205`), so a
  settled ceiling moves the read with no new code. The range also widens by the swing still to come (the root of
  the remaining years' `SWING` squared, combined with the read's own half-width the same way): a rookie's ceiling
  range is honestly wide and tightens as he settles. The centre doesn't move, so boards and valuations read the
  same; the scout report's "could become" tier reads the range without the unsettled part, so a rookie isn't
  called a future star for being unsettled.
- **Mail** (`inbox.ts`), one message per player per season, keyed so it never doubles up, when your own young
  player's ceiling read (`viewOf` before and after the shift) moved a point or more:
  - Down: the head coach, direct. "He's hit a wall. What you see now is about what you'll get."
  - Up: the scouting director, analytical and hedged. "He's outplaying his grades. We may have had his ceiling
    too low."
  - The wording says what the read means; the condition is the read, never the true shift.
- **Scout report** (`scoutReportParts`): one sentence on whether he is still settling ("Still a projection" in
  year one, "His ceiling looks settled" by year three) and which way it has moved when the read moved.
- **Other teams' players** show it only through your scouts' read, as clearly as your scouts know them.

## AI front offices

Nothing new. Draft boards already lean a ceiling on their own read of work ethic (`projectedCeiling(…,
characterRead(…).workEthic)`, `draft.ts:166`), so makeup's new weight is priced in. A busting player's trade value,
extension and fifth-year option fall through `outlook.ts`, which reads each team's perceived ceiling.

## Balance

A ceiling that drops below a player costs less than a rise gains, so league talent would creep up. The class's
starting ceiling spread (`growth` in `generateDraftClass`, `draft.ts:58`) and the arrivals' (`arrivals.ts`) are
pulled back until `npm run careers` holds starter overall by season and `npm run offseason` holds league talent,
rosters and cap health across seasons. No range is loosened to get there.

## Checks

New rows in `npm run careers`, each failing on its own when it leaves its range:

- **First-round busts:** first-rounders who never reach a high-end starter's overall at their position by age 27:
  the 60th percentile of the league's starters there, the scout report's "high-end starter" tier (`tierOf`). Target
  25–40%, tuned toward 40% (decision 8).
- **Late-round steals:** picks from rounds 4–7 who do. Target 8–20%.
- **Settling:** the mean absolute shift by year shrinks (year one > year two > year three), and high work ethic
  settles above low.

Both ranges come from `docs/research/draft-outcomes.md`: NFL first-round bust rates run from about 13% to 44% by slot
and definition (quarterbacks highest, linemen lowest); about 10% of Day 3 picks become regular starters (40 starts in
five years), about 23% on a looser count.

Unit tests (`development.test.ts` or a new `ceiling.test.ts`):

- The settle is reproducible from the seed, settles once a season, and leaves every other stream as it was.
- It skips players 26 and over and players past their third year.
- The performance lean compares against peers rated like him, not the league: two players with the same line,
  rated 10 and 14, lean opposite ways.
- A year rolled before a settle lands, in steps, where one jump would.
- `ceilingShifts` never reaches a screen (screen-contract tests in `ui/ui.test.ts`).

Checks to run on the PR (CI runs them): `careers`, `offseason`, `trades` (rookie values move), `training`,
`sim` (league stats hold).

## Docs and version

`docs/MVP.md` item 9 gains a clause on settling ceilings; `package.json`'s version bumps the last number (a fix to a
finished item, per `docs/VERSIONING.md`). `CLAUDE.md`'s `development.ts` line notes the settle.

## Out of scope

- The draft screen's new look and the draft-history hit or miss mark (the second spec).
- New AI behaviour: AI teams react through the reads they already have.
