# Rate-stat qualification

**MVP:** `docs/MVP.md`, "Follow-up: rate-stat qualification". **Version:** 0.4.16 (a follow-up, not an MVP item:
`docs/VERSIONING.md`'s last number).

## The problem

A rate (passer rating, completion percentage, yards a carry…) ranks only players who did enough to earn it. Today each
place that ranks one sets its own minimum, and the main one is scaled by the wrong games:

- The Leaders and Records boards (`LEADER_CATEGORIES` in `stats.ts`) and the Stats table's rate sorts
  (`ui/screens/Stats.tsx`) ask 14 attempts a game, but a game the **player** dressed for (`StatLine.gp`). A backup who
  dressed once and went 15-for-15 qualifies and leads the league; one who dressed every week and threw twice doesn't
  hurt anyone, but the rule reads the backup's appearances, not his team's season.
- Awards fold passer rating in only at 200 season attempts or more (`qbBonus` in `awards.ts`): 199 attempts score a flat
  80 rating whatever he did, 200 his real one, a swing of up to 36 points of score from one attempt. The weekly and
  monthly honors use the same test on a week's or month's line, which never reaches 200: passer rating never counts in
  them. Kickers and punters are gated by season totals (15 field-goal attempts, 30 punts).
- The rookie report compares rookies on season totals of its own (100 attempts, 40 carries).

Passer rating is the only rate with a board; the other common rates show only as Stats-table columns.

## What a player sees

- A rate leader is someone who played enough **for his team**: the NFL's minimum per team game on a season board, its
  career minimum on a career board. A 2-for-2 passer never leads a season rate category, in week 2 or week 17.
- Everyone keeps his real numbers: below the minimum he still shows on his card, in box scores and in the Stats table;
  he just can't lead a board or top a sorted rate column. Each board and table says what the minimum is ("14 att. per
  team game", "1,500 att. career").
- New boards on Leaders and Records: completion percentage, yards an attempt, yards a carry, yards a catch, field-goal
  percentage and punt average, beside passer rating.
- Awards read the same rule: a quarterback's passer rating counts once he qualifies, in the season's awards and in the
  weekly and monthly honors.

## The rules (`src/engine/qualify.ts`)

One table, read by every place that ranks a rate. Each rate names the volume it is earned on, a season minimum per team
game and a career minimum.

| Rate | Volume | Season (per team game) | Career | Source |
|---|---|---|---|---|
| Passer rating, completion %, yards an attempt | pass attempts | 14 | 1,500 | NFL ([PFR](https://www.pro-football-reference.com/about/minimums.htm)) |
| Yards a carry | carries | 6.25 | 750 | NFL (PFR) |
| Yards a catch | catches | 1.875 | 200 | NFL (PFR) |
| Field-goal % | field-goal attempts | 1 | 100 | the game's own (today's Stats rule; the owner's call) |
| Punt average | punts | 2 | 250 | the game's own (today's rule; the owner's call) |
| Kick-return and punt-return averages | returns of that kind | 1 | 75 | the game's own (today's rule; the owner's call) |

No NFL source was found for kicking, punting and returns (PFR's page refused automated reading; Sports-Reference's
college page uses 1 FGA, 2.5 punts and 1 return a game). The season numbers are the ones the Stats table uses today;
the career numbers are new. All of them sit in the one table, so the owner can change any of them in one place.

- **Team games.** The regular-season games his club has played that season (`league.games`, results only, no
  playoffs), so 17 for a finished season and 0–17 during one. A player's club for a season is the one he finished it
  with (`statTeams[season].at(-1)`), else his club now; a player with neither (a free agent all season) is measured
  against 17. A traded player is measured against the club he finished with; his line is still his whole season's.
- **Career.** The career minimum above, and 64 games played (PFR's rule for career rate leaders).
- **Zero volume never qualifies**, whatever the minimum (week 0 of a season has no team games).
- **Playoffs.** Season totals are regular season only and there is no playoff stats view, so there is no playoff scope
  to qualify; nothing changes there.

The module draws nothing and reads only the league. Its surface:

- `RATES`: the table, each entry `{ key, label, volume: (s: StatLine) => number, perGame, career, unit }` (`unit` for
  the shown minimum: "att.", "carries", "catches", "FGA", "punts", "returns").
- `teamGames(league, player, season): number`.
- `qualifies(league, player, line, scope, rate): boolean`, scope a season or `'career'`.
- `minimumText(rate, scope): string`, the line a board or table shows.
- `periodQualifies(line, games, rate): boolean` for a stretch of games (the weekly and monthly honors): volume at least
  the per-game minimum times the games he played in it.

## Where it applies

- **Boards** (`stats.ts`): `LeaderCategory.qualifies` reads `qualify.ts` (it needs the league, the player and the
  scope, so its signature widens). `leaders()` and `seasonRecords()` pass them. New categories: completion %, yards an
  attempt, yards a carry, yards a catch, field-goal %, punt average, each with its format. Ties break by player id in
  `leaders()` (none today) and by season, then id, in `seasonRecords()`.
- **Stats screen** (`ui/screens/Stats.tsx`): the Leaders and Records tabs show each rate board's minimum under its
  title; the Players tab's tables replace their own `qualifies` with `qualify.ts` (team games, not `gp`), keep sorting
  unqualified rows to the bottom and muting them, and say the minimum in the table's hint.
- **Awards** (`awards.ts`):
  - Season awards (MVP, All-League QB): `qbBonus` uses his passer rating when he qualifies for the season, and the
    league-average baseline (92, the term's own zero) when he doesn't: the cliff goes.
  - Weekly and monthly honors: the same term, qualified by `periodQualifies` on the stretch's line and the games he
    played in it.
  - Kickers and punters: the 15-attempt and 30-punt floors become the season rule (1 FGA and 2 punts a team game).
  - The ten-game floor for the other awards (`MIN_GAMES`) is a games-played rule, not a rate's: it stays.
- **Rookie report** (`rookieReport.ts`): its passer-rating and yards-a-carry comparisons use the season rule in place
  of 100 attempts and 40 carries. Its per-100-snaps reads (receivers, linemen, rushers) aren't rates this table holds and
  keep their 200-snap floor.
- **Not touched:** box scores (one game, nothing ranked by a rate), the player card (shows, never ranks), the gazette's
  advanced tables (their own per-game samples on their own measures: EPA a dropback, success rate, pressure rate), team
  stats and the leaders check (`scripts/leaders.ts`, counting stats only).

## Testing

- `qualify.test.ts`, the rules on built lines:
  - a 2-for-2 passer doesn't qualify in week 2 or at season's end; a starter with 14 attempts a team game does;
  - early season: after two team games, 28 attempts qualifies and 27 doesn't;
  - a player who dressed for one game of a club's five is measured against five;
  - a traded player is measured against the club he finished with;
  - career: 1,499 attempts or 63 games don't qualify, 1,500 and 64 do;
  - zero volume never qualifies.
- `stats.test.ts` (or beside the boards): a 2-for-2 backup is in the league but on no rate board; every new board's
  top man qualifies; Records never lists an unqualified season.
- Awards: an MVP-race quarterback with 199 attempts and one with 200 score their bonus continuously (no jump); a
  weekly honor's quarterback score moves with his rating.
- `ui.test.ts`'s screen contract holds for the new boards (names through `PlayerLink`, tables through `SortTh`).
- Local: typecheck and the touched tests. Awards can move a winner, so CI's checks that read awards will show it; any
  change in who wins is reported on the pull request, not hidden.

## Out of scope

- Playoff stats and a playoff scope.
- New rate stats (catch rate, yards a target, sack rate): only rates the game already records get boards.
- The gazette's advanced samples and the rookie report's per-snap reads.
