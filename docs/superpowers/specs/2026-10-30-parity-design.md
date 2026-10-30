# Parity: any given Sunday

Date: 2026-10-30 · Comes before #115 (fewer sulkers), which rebases on it

## Why

Every pull request this week tripped over a different line of the sim check: #5 rushing, red-zone trips, #1 receptions,
overtime. Each sits on or near its limit on main, so any change that moves play (moods, injuries, anything) tips one.
Three attempts to tune rushing alone moved nothing over 60 seasons: the problem isn't one stat.

Measured on main over 16 fresh leagues (`scripts/calibrate.ts`'s seeds):

| | Sim (main) | NFL |
|---|---|---|
| Stronger team wins | 70.7% | 66–67% (betting favourites, 2015–24) |
| Final margin's spread around what strength predicts | 12.5 pts | about 13.5 (around the closing line) |
| Margin that team strength predicts | about 9.3 pts | about 5.5–6 |
| Spread of team wins in a season (SD) | 3.9 | 3.0–3.3 |
| Team seasons with 30+ rushing TDs (60 seasons) | 52 of 1,920 | 3 of 160 (2021–25) |
| Lead back: games, share of the backs' carries | 15.5, 61% | similar |
| Yards a carry by the back's skill | 3.7 (weak) to 5.3 (elite) | the best about a yard clear of the league |

So the carry is right and so is the workload. What's off is **parity**: the gap between two teams decides a game about
1.6 times as much as in the NFL. Strong teams win too often and pile up stats (their backs, receivers and red-zone
trips), which is why the leaders' rows and the scoring rows all lean to their edges at once.

Two causes, both measured: the gaps between teams are about 25% too big (team overall SD 0.71 at a new league's
kickoff, about 9 points of margin per point), and a game's own randomness is a little small (12.5 against 13.5).

## Decisions

1. **Fix the season's shape, not single stats.** No change to how one carry, catch or sack works; no range moves.
2. **Simple and realistic, in two stages**, measured over 60 seasons each:
   - **Stage 1, any given Sunday:** each team brings a form to each game, a small draw on the game's own stream, so a
     strong team sometimes plays a flat game and a weak one a sharp one, as in the NFL.
   - **Stage 2, only if stage 1 leaves the win spread above 3.3:** narrow the talent gaps a new league starts with.
3. **Running-back workloads stay as they are.** They already match the NFL.

## Stage 1: a team's form on the day

- **What:** at kickoff each team draws its form for the game, `normal(0, FORM_SD)` rating points, from its own
  stream (`${seed}:form:${season}:${gameId}:${teamId}`), so no other draw in the game moves and a game is still
  reproducible from its seed. Every player in that team's lineup plays `form` points better (or worse) in every
  contest, through the same knocks overlay as the out-of-position knock and the mood edge (`buildLineup`).
- **How big:** sized so the margin's spread around strength reads about 13.5, the NFL's. From the numbers above that's
  a form SD of about 0.45 of a rating point; the plan measures it, one value, no per-unit tuning.
- **Hidden:** nothing shows it, like a crew's tendencies. A recap can keep telling what decided the game from the box
  score; no new words in this change.
- **What it moves:** the stronger team wins less often, the win spread narrows a little (to about 3.7 by the
  numbers above), stat totals stay where they are (it averages out), and the leaders' rows ease off their edges (a
  strong offence has its flat days too).

## Stage 2: narrower gaps at a new league's start (only if needed)

- If stage 1 leaves the win spread above 3.3 over 60 seasons, trim `PEDIGREE` in `generate.ts` (how much a franchise's
  real recent record seeds its starters' quality; 4 today) until it reads 3.0–3.3. Its cost: a new league's year-one
  ratings follow the real records a little less closely (0.7 today, the plan reports the new figure).
- Long leagues are read too: `npm run careers` reports the win spread in its steady state (seasons 9–16). If long
  leagues drift wider than fresh ones, that's the AI's roster building, and it goes to the owner as a finding, not into
  this change.

## Checks

- **`npm run sim`** gains three checks, today informational or unmeasured: the stronger team wins 65–69%, the
  margin's spread around strength 13–14.5, the win spread 3.0–3.4. Every existing line stays in its range; the edge
  lines (#5 rushing, red-zone trips, #1 receptions, overtime) should move toward their middles, and the plan reports
  where each lands.
- **`npm run careers`:** the steady-state win spread, reported (a check once a long league's NFL figure is agreed).
- **Everything that reads play** runs on CI as usual (audit, size, weather, crews, quirks, endings, careers); nothing
  may be flagged and no range moves.
- **Unit tests:** the form draw is reproducible from the seed, costs no draw from any other stream, averages zero, and
  moves a game's outcome; a lineup's knocks carry it.

## After it lands

#115 rebases on it and its sim check is read again. If #115's own change still moves play (it shouldn't: on new seeds
it matched main), that's #115's to fix.

## Files

| File | Change |
| --- | --- |
| `src/engine/match/gameSim.ts`, `match/lineup.ts` | the form draw at kickoff and its overlay |
| `src/engine/generate.ts` | stage 2 only: `PEDIGREE` |
| `scripts/calibrate.ts`, `scripts/careers.ts` | the parity checks and report |
| `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`, `CLAUDE.md` | notes, a fix version, changelog |

## Out of scope

- How one play is decided (the skill slopes, the break-away), running-back committees, injuries.
- The AI's roster building over many seasons (reported, not changed).
- Showing a team's form anywhere.
