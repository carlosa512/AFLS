# AFLS — working notes for Claude

AFLS is an American football management sim ("Football Manager for the NFL"). Vision, scope and
roadmap live in `docs/GAME_DESIGN.md`; the market research behind it is in `docs/research/`.

**`docs/MVP.md` is the working checklist to alpha.** When a change finishes an MVP item (or moves one to
Partial), update its line there in the same PR and bump `package.json`'s version per `docs/VERSIONING.md`: the
middle number for a finished MVP item, the last number for fixes.

## Standing instructions from the project owner

- **Subagents: cheapest model that still does the job well.** Saving tokens matters, but not
  at the cost of speed or quality. Use `model: "haiku"` for simple, mechanical work (searches,
  data lists, boilerplate) and `model: "sonnet"` for anything needing judgment or real coding.
  Do the work inline when an agent isn't clearly needed.
- Keep explanations short and concrete, with a clear next step.

## Commands

**CI is the full run; a session runs only what it needs to steer.** Every pull request runs the checks
its changes call for (one job per check, `.github/workflows/ci.yml`), and every push to main runs them
all, so a session never runs `npm run check` (quick or full) unless the owner asks for it. Locally:

1. **UI, docs, copy, tests, or anything the sim never reads:** `npm run typecheck` and the tests you
   touched (`npx vitest run <file>`). No sims.
2. **A change that can move play or numbers** (`src/engine/`): the unit tests it touches and, while
   tuning, the one command for that area at a small size (`npm run sim -- 10`, `npm run endings`, or the
   area's script below): about a minute each, enough to see which way a tweak moves play. Then push.
3. **Then read CI on the pull request** and fix what is red before calling the PR ready. A red check on
   the PR is the PR's job, even when main is red for the same reason; the planner picked that check
   because the change can move it. Never merge over red: the branch rule on main requires "CI result".

- **`npm run check`** reads what changed (vs `origin/main`, committed or not), runs the checks below
  that the change calls for side by side, and prints one ✓/✗ line each; full logs land in `.check/`.
  `--quick` skips the slow three (careers, audit, quirks), `--all` runs everything,
  `npm run check -- sim endings` runs just those. CI runs the same plan on every pull request, one job
  per check (`.github/workflows/ci.yml`), so a red ✗ here is a red PR there. Every check fails on its
  own (non-zero exit) when a number leaves its range (`offseason` included: it judges its numbers per
  season and first vs last): never loosen a range to get green. `⚠` lines are warnings that don't fail
  a run: outlier record seasons (luck in small samples) and known engine issues, each gone once fixed.
- **`npm run format`** before committing: Prettier (`.prettierrc.json`, `.prettierignore`), and CI runs
  `format:check` on every pull request. `npm run check` includes it.
- `npm run dev` — local dev server (Vite)
- `npm test` — engine tests (Vitest)
- `npm run typecheck`
- `npm run sim -- 10` — simulate 10 seasons and compare league stats to NFL averages, each season's
  top five (yards, TDs, catches, sacks, picks) to NFL leaders and records (`scripts/leaders.ts`), and
  injury rates to the NFL's (`docs/INJURIES.md`). **Run this after any change to `src/engine/match/`
  or `injuries.ts` and keep stats inside the target ranges.** Leaders are noisy over 10 seasons:
  check a change near an edge with `-- 30` or more. `npm run check` (and CI) runs 30: over 10, the
  #1 and #5 passing rows sit close enough to their floors that main itself misses one block in four.
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
  it after changes to `finance/`, `offseason/`, `trade/`, `staff.ts`, `coaching.ts`, `medical.ts`
  or `injuries.ts`; talent, cap space, rosters and the coaching ledger (growth and decline ×1.00)
  should stay stable across seasons. Three more leagues play in child processes for the cap-space drift
  check (one league's 32 teams are too few); `--seed x` plays another world.
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
- `npm run trades` — the trade market (`docs/TRADES.md`): what buyers pay for stars, quality starters,
  deadline rentals and depth against the NFL's prices (every eligible player in 48 leagues' first season,
  45 of them priced in child processes, `scripts/trades-prices.ts`), what a future first is worth, every AI deal
  read as it closes (no cheese: no side may lose in its own eyes, both teams legal on cap and rosters
  afterwards; bad business, like a lopsided deal or a team's ledger, is shown with what explains it,
  its scouts' misreads or its own situation, never failed), the AI market's volume and mix
  (in season, deadline day, offseason, swaps, dumps, division rivals) against the NFL's, offers to you
  (how many, a week's most, none after the deadline or for an Untouchable, listing draws a call),
  physicals (deals voided or through with concerns, sound players failing, a sharp doctor against a
  weak one), the
  exploit probes (junk for a star, stacked firsts, dumps, sign and flip, buying straight back, probing
  one GM all week) and speed. Run
  it after changing `trade/` or what it values players with (`scouting.ts`, `finance/`, `aging.ts`,
  `coaching.ts`). `--verbose` lists every price and trade and each team's ledger; `--seasons 6` plays
  longer leagues. Nothing may be flagged.
- `npm run training` — the training layer (`docs/TRAINING.md` §12): position moves' invariants (a position
  written only on cut-down day, slots, the cooldown, a mover's ceiling and habits, learning calls that never
  touch a rating) and development released in steps (the dial sums to 1, a year released in steps lands
  where one jump would for every player left alone that year, ratings on the scale all season, the tick's
  speed and what a save carries). Run it after changing `training.ts`, `familiarity.ts`, `development.ts`
  or the calendar steps that run them. Nothing may be flagged.
- `npm run build` — web build to `dist/`
- `npm run build:single` — one self-contained page at `dist-single/afls.html` (for sharing/previews)

## Architecture

- `src/engine/` — pure TypeScript simulation. No DOM, no React, no `Math.random` (all
  randomness goes through the seeded `Rng`, so a league seed reproduces the same world and each
  game is reproducible from `${seed}:${season}:${gameId}`).
  - `attributes.ts` the attribute registry: labels, aging families, and the named **contests** the
    engine resolves (`skill(player, contest)`). The match engine never reads `player.ratings` directly.
  - `scouting.ts` what a team believes: knowledge, perceived ranges (seeded per team and player),
    stars, scout reports (`scoutReportParts`: a verdict, his game, then the rest; one judgment with
    the observations behind it, never a list of every rating or habit), habit wording over time
    (`habitChangeText`, `habitChangeDetail`: a logged loss is a fade), last season in one sentence
    when it decides something (`seasonNote`: a starter's line only when it stood well clear of a
    league-average starter's, a rotation player's role, growth off the bench; `seasonRole` reads
    the role from scrimmage snaps, `StatLine.snaps`, counted in `match/gameSim.ts` for the units on
    the field and the pass-rush rotation on dropbacks), scouting visits, combine
    generation. Prose rules: the sim makes the facts, the writing says what they mean; every
    sentence is chosen by a condition on what the team can see, so a report is reproducible
  - `staff.ts` scouting departments: who reads which player (`readFor`), accuracy, the staff budget,
    contracts, the market, ageing, AI hiring; owners' budgets from their markets' revenue (`ownerBudgets`,
    `TeamSeed.revenue`). All staff changes go through this module (it keeps a
    per-team index; `teamStaff()` returns a shared read-only list)
  - `coaching.ts` coaching staffs: what coaches do for development (`coachingFor`, the parts a screen
    shows via `coachingParts`), play-calling style (`callerStyle`), the special teams coordinator's
    game-day edge on the kick units (`specialTeamsEdge`), the coaching budget, contracts, the market,
    ageing, AI hiring, the head-coach hot seat and the carousel (promotions, poaching, a new head coach's
    staff, his vision for his coordinators), former players going into coaching, the archive of retired
    coaches (`league.retiredCoaches`) and the owner's leeway past the budget (`ownerLeeway`). All coach
    changes go through this module (it keeps a per-team index; `teamCoaches()` returns a shared
    read-only list)
  - `injuries.ts` who gets hurt (snap and collision risk, resistance, energy, condition), layoffs,
    scars, treatments (pain injections, protective gear, fast-tracks; the player's say on each, AI
    teams' calls for their starters), the concussion protocol (a weekly marble draw from a bag his
    concussion history fills; shutdowns and concussion retirements), injured reserve, the weekly cycle (healing, practice, injury
    moves: a short position is covered from the roster first, `chooseCover` lining up a spare with "Play at…",
    which `Team.playingAt` keeps through auto-sort; then AI teams sign at the player's price from their in-season
    reserve, `needSigning`, then at the minimum; the user's staff never signs or cuts), the injury-risk read and injury retirements. All randomness on its own streams (per game,
    per practice week, per player's answer)
  - `medical.ts` medical staffs: department ratings (`departmentFor`), the recovery curve, the
    medical budget, contracts, the market, ageing and AI hiring (same shape as `staff.ts`)
  - `schemes.ts` what coordinators run: offenses (personnel, run/pass mix, targets, play action), fronts
    and coverages, the depth-chart spots they name (LT, SLOT, NT…) and scheme fit. The engine reads them
    through `teamScheme()` in `coaching.ts`; every lean trades something, so league totals stay in range
  - `gm.ts` persistent GM identities, observed appointments, scouting-director promotions and management
    tendencies that follow the person; `service.ts` captures each game's staff and credits their actual
    results, preserving partial seasons and former jobs. `records.ts` reads those careers, with
    `league.history` as the fallback for legacy entries. `leadership.ts` runs the owners' reviews (offseason and week by
    week), GM searches and succession; `ownerBag.ts` is each owner's marble bag: calm marbles for patience, heat on the
    GM and head coach from losing seasons (blame split by roster talent against results), drawn at each review
  - `inbox.ts` the user's mail (awards, injuries, expiring deals, retirements, scouting, opposition reports and recaps,
    trades, the playoff race, the owner's letter, staff deals, coaches hired away, the coaching carousel, free agency):
    `deliverMail` runs after every `store.mutate` and files what's new, each message keyed by what it's
    about so nothing doubles up. The sim never sends mail itself. A recap tells one thing that decided
    the game, read off the box score (`gameStory`: comeback, lead let go, turnovers, control, a result
    against the yardage, a late shutdown, a close one; a routine game gets the yards); the opposition
    report is a briefing on our scouts' read, qualified when they barely know the team, and never
    promises a tactic the engine doesn't run. Each sender keeps a voice: the head coach direct, the
    director analytical and hedged, the doctor measured, agents advocates, the league office neutral. `mailSubject` reads that key back, and
    `needsYou` works out from the league as it is now whether a message still asks something (nothing
    stored); the cards a message opens with (`ui/mail.tsx`) are looked up the same way
  - `generate.ts` league/player creation · `roster.ts` depth charts, team ratings
  - `size.ts` height and weight: each position's bell curve (`SIZE`, from combine percentiles), the roll (`rollSize`,
    the same two draws the flat rolls cost), `sizeZ` (the only size z-score). Spec: `docs/superpowers/specs/2026-10-27-player-size-design.md`
  - `identity.ts` names for new people (players by position, staff by chair, referees): a heritage drawn
    from `data/heritage.ts`, then names from `data/names.ts` for that heritage and generation; scouts and
    medics can be women (drawn with the name). Costs the caller's stream exactly two draws. Heritage is
    never stored or read by the sim. `rename.ts` is the v27 pass for older saves (keeps typed names,
    `Player.nameEdited`, and rewrites stored text). `pronouns.ts` (`pron`) for any text about one scout or
    medic. Spec and sources: `docs/NAMES.md`
  - `quirks.ts` on-field habits (registry, the marble bag, grip, `activeQuirks`): they change with
    weekly and offseason draws; the engine reads them through `has()` in `match/gameSim.ts`, screens
    through `quirkNotes` in `scouting.ts` (seen on film, so the fog of war applies); AI front offices
    value them through `quirkWorth` (only what their own scouts have seen); game states (Rattled, Shaken, a kicker's
    slump) and event marbles go through `recordForm`, called from `recordResult` in `league.ts`
  - `weather.ts` each game's weather (a pure function of seed, season, game id and kickoff: nothing stored until
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
  - `outlook.ts` where a player is headed: the overall a club expects from him over the next three
    seasons (growth toward its scouts' ceiling, the aging curve's fade via `expectedAging`, its read of
    his injury risk, the GM's win-now). Trade rooms, the trade block, free agency (`upgradeBar`),
    re-signing and fifth-year options plan on it; lineups still use today's play
  - `training.ts` position moves (`docs/TRAINING.md`): the pairs coaches teach and the knock for playing
    out of position live in `familiarity.ts` (`knockFor`, read by the engine through `skill()`'s overlay,
    `useKnocks`); plans and the learning clock (offseason program, camp, practice weeks), cut-down-day flips
    (`changePosition`, the one writer of `player.position`), the coaches' read with its reason
    (`conversionRead`: no move without a `MoveReason`), and the same planner for your suggestion and AI teams
    (`suggestMove`, `planMoves`). A mover's body keeps aging as his first position (`DevContext.bodyAs`)
  - `development.ts` yearly growth and decline · `aging.ts` the one aging table (development,
    retirement, contract asks and trade values all read it) · `traits.ts` hidden traits and their hooks
  - `match/gameSim.ts` play-by-play engine · `match/coach.ts` AI decisions (pure functions)
  - `season/` schedule (NFL 17-game formula, built at the start of each offseason under the NFL's rules:
    byes in weeks 5–14, week 18 all division games, rematches three weeks apart, no three road games in a
    row), kickoffs (`kickoff.ts`: Thursday, Sunday 1:00/4:05/4:25, Sunday and Monday nights, the playoffs'
    windows; western hosts never at 1:00), flex scheduling (`flex.ts`: the league moves better match-ups
    into prime time on the NFL's notice and sets week 18 after week 17), standings + tiebreakers, playoffs
  - `league.ts` week/season orchestration
  - `finance/` contracts as year-by-year ledgers (`contract.ts`: proration, dead money,
    restructures), team cap sheets and moves (`cap.ts`), the rank-based market, rookie scale and
    tags (`market.ts`)
  - `offseason/` the calendar (`index.ts`), negotiation, AI front offices (`ai.ts`), the draft
  - `trade/` trades (`docs/TRADES.md`): pick charts and player value (talent × control by the role he'd
    have on the buyer's depth chart, his contract against the market weighed by cap room) in
    `value.ts`, with the league's going rate for a pick (`goingRate`); the window, deadline day and
    blockers in `rules.ts`, with the hidden wait on new signings (each GM's own, never shown); `judge`
    in `judge.ts`, the one evaluator every deal goes through (seller floors at the going rate, soft
    first-round pricing by the drafts a team is left without a first, scaled by the GM's win-now, a centrepiece for a star, division rivals; `releasing` weighs a deal against
    a cut); `executeTrade` (retained salary as the sender's dead money, the AI buyer's trade-and-extend
    on arrival, `willExtend` priced in by the buyer only); each front
    office's stance, needs, trade block and interest in `plans.ts` (on its own read); the deal search
    in `deals.ts` (a price between the seller's floor and the buyer's most, picks or a swap, dumps,
    salary kept to fit a buyer in season, late-pick sales before a cut, future-for-current pick swaps);
    the AI market at the NFL's moments (`marketMoment` in `market.ts`, its own RNG stream: league year,
    FA days, camp, weeks, deadline day; cap casualties and camp cuts go to the phone first; `dealWatch`
    lets the trades check read each deal as it closes), its
    history and rumors in `league.market`; the buyer's doctor in `physicals.ts` (pass, concerns,
    failed, cleared to rehab; the public file a team reads before it calls); offers to you in
    `offers.ts` (bids, pitches, dumps, enquiries on their own stream; accept, decline, counter, your
    players' statuses, shop, ask a price; they lapse when you advance the calendar), your dealings with
    each GM in `talks.ts` (about four proposals a moment, cooldowns, trust), your staff's word on a
    deal in `advice.ts` (your view only); `TradeContext`, one decision pass's cache ·
    `migrate.ts` save upgrades
- `src/ui/` — React screens. State is one mutable `League` in `ui/store.ts`; call
  `store.mutate(fn)` to change it (triggers re-render + IndexedDB autosave). **Every screen follows
  `docs/UI.md`**: names through `PlayerLink`/`TeamLink`, one `TeamPicker`, tables sorted with `SortTh`, your row
  `tr.is-user`, tabs as routes, and the fog-of-war list of what a screen may show. The "screen contract" tests
  in `ui/ui.test.ts` enforce it.

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
