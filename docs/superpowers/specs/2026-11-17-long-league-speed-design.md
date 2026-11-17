# Long leagues stay fast (indexes beside the league)

Owner: carlosa512 · 2026-11-17 · follows 0.4.50 (`2026-11-16-cap-room-and-linemen-design.md`)

## Intent

A long league gets slower every season. The owner wants both a small save and seasons that don't slow down, speed
first. The careers check went past CI's 30-minute limit twice (it now has 45), and the same slowdown is in every long
career someone plays. The save's size is the next project (an archive for retired players); this one is speed only.

## What the recon found (2026-11-17, one league `archive-probe` with personnel on)

- A season from a save after season 1 took 37.9s; from a save after season 10, 47.3s (25% slower). The save grew from
  9.5 MB to 17.5 MB; 2,989 of its 5,164 players were retired.
- Deleting every retired player from the season-10 save made its next season 42.3s: retired players explain about 55%
  of the slowdown, because code that skips them still walks them first (`Object.values(league.players)` appears in about
  90 places in the engine).
- A CPU profile of each season, compared function by function, put the growth in many places, none of them large alone:
  the free-agent list built from every player each read (`freeAgents`, +1.0s), the coaching-trees index (+1.1s), garbage
  collection (+0.8s), morale (`moraleContext`, `moraleMean`, +0.8s), scouting (+0.6s), the practice squad and payroll
  (`serviceRoster`, `squadMarket`, `payroll`, +1.4s), relationships (`rapport`, `contractLean`), `lastSeasonHolder`.
- The coaching trees are rebuilt every week: `trees.ts` keys its cache on the season, phase, week and the coach
  counts, but careers only change at hires and at season's end.
- The game already solves the same problem once: `teamPlayers` (`roster.ts`) keeps each club's players in an index
  beside the league (a `WeakMap`, never in the save), kept current by `setTeam` and `addPlayer`, and rebuilt when it
  finds a player changed behind its back. Reading every player for each club was 14% of a 16-season league before it.

## Goals

- **Speed:** a season from the season-10 save runs within 10% of a season from the season-1 save on the same probe
  (today 47.3s against 37.9s; the target is 41.7s or less).
- **Nothing in play changes:** the same seed gives the same league, byte for byte, before and after (a league played
  for several seasons serializes to the same JSON). Every check's numbers stay identical, and no test moves.
- **The save is untouched:** no new stored field, no `SAVE_VERSION` bump.

## Non-goals

- The save's size: the retired-player archive is the next project.
- Screens, letters, words: nothing a player sees changes.

## Anti-goals

- A different result for the same seed. Faster but different would reshuffle every seeded world and every test.
- A stale index: a player who retired, joined or changed clubs and is read in the wrong list.

## Approaches

- **Indexes beside the league, no save change (the owner picked this).** Lists of players still in football and of
  free agents, kept beside the league like `teamPlayers`; hot loops read them instead of every player who ever played;
  the coaching trees built when careers change, not weekly. Fast to build, low risk, and the save format is unchanged,
  but the save keeps growing.
- The retired-player archive: retired players move into a compact record. Speed and size at once, but every screen that
  shows a retired player changes and saves need an upgrade. Deferred to its own project, for size.
- Indexes now, the archive next: the order the owner chose (this design is the first half).

## The design

1. **One writer for retirement.** `retirePlayer(league, p)` in `roster.ts` sets `p.retired` (and does what the two
   callers do today on retirement), so an index of players still in football can be kept current. The new league
   year (`offseason/index.ts`) and camp castoffs (`personnel/futures.ts`) call it; save upgrades (`migrate.ts`) may keep
   writing directly, since a loaded league builds its indexes fresh.
2. **Players still in football.** `activePlayers(league)`: every player not retired, in id order (the order
   `Object.values(league.players)` gives), kept beside the league by `addPlayer` and `retirePlayer`, and rebuilt when it
   finds a player retired behind its back (the way `teamPlayers` heals). It returns a read-only list.
3. **Free agents.** `freeAgents` reads players still in football without a club, in the same order, instead of every
   player (kept current by `setTeam` too). Its result and its order are unchanged.
4. **The hot loops.** A loop over `Object.values(league.players)` that skips retired players reads `activePlayers`
   instead; a loop that needs retired players (records, history, renames, save upgrades, a former player turned coach)
   stays as it is. Profile-guided: the loops the recon named first, then any other the profile shows.
5. **Coaching trees.** `trees.ts` rebuilds its index when careers change (a hire, a firing, a retirement, the season
   turning over), not every week. Whatever the key, the trees it gives must be the ones a weekly rebuild would give.

## Constraints

- Engine purity: no `Math.random`, no new draws; the order of every pass that draws or breaks ties stays id order.
- `League` stays plain JSON; the indexes live beside it (a `WeakMap` keyed by the league), so a loaded or copied league
  builds its own.
- A player changes club through `setTeam` and joins through `addPlayer`, retires through `retirePlayer` (CLAUDE.md
  gains that line).

## How we work

- Before touching code: a determinism harness. A script plays a league for a few seasons and writes its JSON; the same
  script after each change must give identical bytes. Any difference stops the work until it is explained.
- Measure with the two-save probe (one season from the season-1 save and from the season-10 save, timed, profiled).
- Then the checks: since results must be byte-identical, `npm run careers` once at the end shows the time saved, and
  CI's numbers must match main's.

## Left to the builder

Which loops to switch beyond the named ones (by profile), the exact shape of the indexes, how the trees decide careers
changed, and the determinism script.

## Calls made after the builder check (mine, for the owner to check)

- **`retirePlayer` does only the common part:** sets `retired` and keeps the index current. Each caller keeps its own
  extra steps where they are (the new league year's proration, log entry, `setTeam(null)` and contract; the castoffs'
  field deletes), so nothing changes order and the bytes stay identical.
- **"Still in football" means not retired, draft prospects included,** exactly what a loop over every player filtering
  `!retired` sees. Each switched loop keeps its own other filters (prospects, squad, waivers).
- **`freeAgents`** reads an index of players still in football with no club, and keeps its squad, waiver and prospect
  filters on read: the same result in the same order, kept current by `setTeam`, `addPlayer` and `retirePlayer`.
- **Healing:** a read checks only the players the index lists; one found retired (or moved to a club, for the
  free-agent index) rebuilds it, as `teamPlayers` does. A player added behind `addPlayer`'s back isn't caught, the rule
  CLAUDE.md already sets for tests.
- **Trees:** the cache key drops the week only where that can't change a tree. If the determinism script shows any
  difference, the weekly key stays and the rebuild is made cheaper instead.
- **The 10% target is a goal with a stop rule:** the named loops first, then up to three profile rounds. If a season
  from the season-10 save is still more than 10% slower, the work stops and goes back to the owner with the numbers.
