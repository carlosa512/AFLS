# AFLS — working notes for Claude

AFLS is an American football management sim ("Football Manager for the NFL"). Vision, scope and
roadmap live in `docs/GAME_DESIGN.md`; the market research behind it is in `docs/research/`.

## Standing instructions from the project owner

- **Subagents: cheapest model that still does the job well.** Saving tokens matters, but not
  at the cost of speed or quality. Use `model: "haiku"` for simple, mechanical work (searches,
  data lists, boilerplate) and `model: "sonnet"` for anything needing judgment or real coding.
  Do the work inline when an agent isn't clearly needed.
- Keep explanations short and concrete, with a clear next step.

## Commands

- **`npm run check` — run before every push.** It reads what changed (vs `origin/main`, committed or
  not), runs the checks below that the change calls for side by side, and prints one ✓/✗ line each;
  full logs land in `.check/`. `--quick` skips the slow two (careers, audit), `--all` runs everything,
  `npm run check -- sim endings` runs just those. CI runs the same plan on every pull request, one job
  per check (`.github/workflows/ci.yml`), so a red ✗ here is a red PR there. Every check fails on its
  own (non-zero exit) when a number leaves its range (`offseason` included: it judges its numbers per
  season and first vs last): never loosen a range to get green. `⚠` lines are warnings that don't fail
  a run: outlier record seasons (luck in small samples) and known engine issues, each gone once fixed.
- `npm run dev` — local dev server (Vite)
- `npm test` — engine tests (Vitest)
- `npm run typecheck`
- `npm run sim -- 10` — simulate 10 seasons and compare league stats to NFL averages, each season's
  top five (yards, TDs, catches, sacks, picks) to NFL leaders and records (`scripts/leaders.ts`), and
  injury rates to the NFL's (`docs/INJURIES.md`). **Run this after any change to `src/engine/match/`
  or `injuries.ts` and keep stats inside the target ranges.** Leaders are noisy over 10 seasons:
  check a change near an edge with `-- 30` or more.
- `npm run endings` — audit thousands of game endings for nonsense (trailing team running out the
  clock, missed last-second kicks…). Run it after any coaching (`match/coach.ts`) change.
- `npm run audit` — raise each attribute in turn, replay the same games, and check it moves play;
  rewrites `docs/ATTRIBUTES.md`. **Run it after changing `attributes.ts`, `OVR_WEIGHTS` or how the
  engine reads ratings.** Nothing may be listed under "Needs attention".
- `npm run careers` — age a draft class of every position and play four 16-season leagues in
  parallel child processes (about 3 minutes on 4 cores, slower with fewer); checks peaks, declines,
  retirements, trait and coaching effects and long-run play against the research ranges. Run it after changing `development.ts`, `aging.ts`, `traits.ts`, `coaching.ts`
  or retirement. Nothing may be flagged ▲/▼.
- `npm run offseason -- 6` — run seasons back to back and summarize AI front-office activity, cap
  health, roster sizes, league talent, injuries and the scouting, coaching and medical economies. Run
  it after changes to `finance/`, `offseason/`, `trade.ts`, `staff.ts`, `coaching.ts`, `medical.ts`
  or `injuries.ts`; talent, cap space, rosters and the coaching ledger (growth and decline ×1.00)
  should stay stable across seasons.
- `npm run quirks` — run the quirk marble bag for 10 seasons and check how often each quirk is carried,
  gained and lost; `npm run quirks -- --effects` also gives each quirk to every player at its positions
  and checks it moves its stat the right way. Run it after changing `quirks.ts` or a quirk hook in
  `match/gameSim.ts`. Nothing may be flagged. `npm run check` runs it (with `--effects`) when the
  quirks module, the match engine or what builds a league changes.
- `npm run weather` — roll many seasons of weather and check it looks like the NFL's (wind, rain and snow,
  roofs), that shown rain chances come true as often as they say, that `TYPICAL` in `weather.ts` is still
  the season's average, and that each condition, replayed on the same games, cuts passing and kicking by
  its research share. Run it after changing `weather.ts`, `data/stadiums.ts` or the match engine.
- `npm run crews` — play four leagues for a season and check the officiating crews: league flags per
  game within 5% of a league-average crew's, the busiest crew 1.3–1.7× the quietest, the weekly
  rotation, and thirty years of offseason drift. Run it after changing `officials.ts` or the penalty
  rolls in `match/gameSim.ts`.
- `npm run build` — web build to `dist/`
- `npm run build:single` — one self-contained page at `dist-single/afls.html` (for sharing/previews)

## Architecture

- `src/engine/` — pure TypeScript simulation. No DOM, no React, no `Math.random` (all
  randomness goes through the seeded `Rng`, so a league seed reproduces the same world and each
  game is reproducible from `${seed}:${season}:${gameId}`).
  - `attributes.ts` the attribute registry: labels, aging families, and the named **contests** the
    engine resolves (`skill(player, contest)`). The match engine never reads `player.ratings` directly.
  - `scouting.ts` what a team believes: knowledge, perceived ranges (seeded per team and player),
    stars, scout reports, scouting visits, combine generation
  - `staff.ts` scouting departments: who reads which player (`readFor`), accuracy, the staff budget,
    contracts, the market, ageing, AI hiring. All staff changes go through this module (it keeps a
    per-team index; `teamStaff()` returns a shared read-only list)
  - `coaching.ts` coaching staffs: what coaches do for development (`coachingFor`, the parts a screen
    shows via `coachingParts`), play-calling style (`callerStyle`), the special teams coordinator's
    game-day edge on the kick units (`specialTeamsEdge`), the coaching budget, contracts, the market,
    ageing, AI hiring and the head-coach hot seat. All coach changes go through this module (it
    keeps a per-team index; `teamCoaches()` returns a shared read-only list)
  - `injuries.ts` who gets hurt (snap and collision risk, resistance, energy, condition), layoffs,
    scars, injured reserve, the weekly cycle (healing, practice, AI injury moves), the injury-risk
    read and injury retirements. All randomness on its own streams (per game, per practice week)
  - `medical.ts` medical staffs: department ratings (`departmentFor`), the recovery curve, the
    medical budget, contracts, the market, ageing and AI hiring (same shape as `staff.ts`)
  - `schemes.ts` what coordinators run: offenses (personnel, run/pass mix, targets, play action), fronts
    and coverages, the depth-chart spots they name (LT, SLOT, NT…) and scheme fit. The engine reads them
    through `teamScheme()` in `coaching.ts`; every lean trades something, so league totals stay in range
  - `records.ts` team, coach and GM records, all looked up from `league.history`
  - `generate.ts` league/player creation · `roster.ts` depth charts, team ratings
  - `quirks.ts` on-field habits (registry, the marble bag, grip, `activeQuirks`): they change with
    weekly and offseason draws; the engine reads them through `has()` in `match/gameSim.ts`, screens
    through `quirkNotes` in `scouting.ts` (seen on film, so the fog of war applies); AI front offices
    value them through `quirkWorth` (only what their own scouts have seen); game states (Rattled, Shaken, a kicker's
    slump) and event marbles go through `recordForm`, called from `recordResult` in `league.ts`
  - `weather.ts` each game's weather (a pure function of seed, season and game id: nothing stored until
    it's played): night kickoffs, regional storm fronts, rain that starts mid-game (`weatherAt` gives a
    quarter's conditions), its cost to play and the engine's levers (measured against a typical day, so
    league totals hold), its injury hooks (`staminaDrain` scales a snap's energy cost, `turfRisk` the injury
    odds), severity and forecasts;
    `data/stadiums.ts` roofs, altitude, climates, regions and stadium changes by season. Spec and what's
    built so far: `docs/WEATHER.md`
  - `penalties.ts` the foul registry (side, yards, enforcement, crew tendency) and `enforce` (half the
    distance, spot fouls, first downs). The engine rolls fouls in `match/gameSim.ts` (`playFouls`), charges
    a player on its own stream, and `match/coach.ts` decides accept or decline (`takesPenalty` on
    `downValue`). Spec, NFL rates and phases: `docs/PENALTIES.md`
  - `officials.ts` officiating crews: hidden tendencies (Flag Volume, Holding, Coverage, QB Protection;
    generated centred, nudged each offseason), star protection for decorated passers (`starLean`), the
    weekly rotation (`crewAssignments`, a pure function like weather; the result keeps `crewId`), the
    multipliers on the engine's penalty rolls (`crewCalls`), and crew stats read from the box scores'
    penalties by kind (`crewTable`). Screens never show the tendencies. Spec: `docs/OFFICIALS.md`
  - `development.ts` yearly growth and decline · `aging.ts` the one aging table (development,
    retirement, contract asks and trade values all read it) · `traits.ts` hidden traits and their hooks
  - `match/gameSim.ts` play-by-play engine · `match/coach.ts` AI decisions (pure functions)
  - `season/` schedule (NFL 17-game formula), standings + tiebreakers, playoffs
  - `league.ts` week/season orchestration
  - `finance/` contracts as year-by-year ledgers (`contract.ts`: proration, dead money,
    restructures), team cap sheets and moves (`cap.ts`), the rank-based market, rookie scale and
    tags (`market.ts`)
  - `offseason/` the calendar (`index.ts`), negotiation, AI front offices (`ai.ts`), the draft
  - `trade.ts` pick charts, AI trade valuation and guardrails · `migrate.ts` save upgrades
- `src/ui/` — React screens. State is one mutable `League` in `ui/store.ts`; call
  `store.mutate(fn)` to change it (triggers re-render + IndexedDB autosave).

## Conventions

- Ratings are 1–20 (FM-style). Salaries are in **thousands of dollars**.
- **Injuries are public, proneness isn't:** an injury, its estimate and a player's history show for
  everyone (screens show the doctor's estimate, never `weeksRemaining`); condition shows for your own
  players; injury resistance and natural fitness are hidden traits, shown only as `injuryRisk` tiers.
  Lineups skip unavailable players (`isAvailable`); the 53 counts `activeRoster` (IR excluded).
- **True vs. perceived:** the match engine, development, contracts and agents use true ratings. AI
  front-office decisions about *other* teams' players (draft, free agency, trades) use that team's
  own read (`perceive`, `viewCache` for loops); keep it that way. The UI shows the user's view only,
  via `viewOf`/`Ovr`/`RangeValue` in `ui/scouting.tsx`. Never render `player.ratings`, `playerOvr` or
  `player.potential` in a screen: it leaks the truth past the fog of war. Hidden traits are never
  numbers anywhere: screens use `characterNotes`/`careerOutlook` (words), AI uses `characterRead`.
- No attribute without an engine hook: anything in `OVR_WEIGHTS` must feed a contest at that
  position (unit-tested) and move outcomes in `npm run audit`.
- `yardLine` is always yards from the *offense's own* goal line (0–100).
- `League` must stay plain JSON. If you change its shape, bump `SAVE_VERSION` in `generate.ts` and
  add an upgrade step to `migrate.ts` (old saves are migrated on load, never thrown away).
- `league.season` is the league year: it ticks over when the offseason begins (like the NFL's March
  new year). Results screens use `resultsSeason()` to show the season just played.
- Cap math lives in `finance/contract.ts`; never store a single "salary" number on a contract.
- Teams use the real NFL markets and divisional alignment with **original nicknames**. Never
  ship NFL nicknames, logos, "Super Bowl" or "AFC/NFC" (see `RESERVED_NICKNAMES`). Real player
  names are a community mod concern.
- Match the existing style: small pure functions in the engine, comments that explain *why*.
