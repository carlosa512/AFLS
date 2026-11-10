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
  `--quick` skips the slow four (careers, audit, quirks, parity), `--all` runs everything,
  `npm run check -- sim endings` runs just those. CI runs the same plan on every pull request, one job
  per check (`.github/workflows/ci.yml`), so a red ✗ here is a red PR there. Every check fails on its
  own (non-zero exit) when a number leaves its range (`offseason` included: it judges its numbers per
  season and first vs last): never loosen a range to get green. A few lines swing with the league (trade requests, rooms in doubt and Tight rooms in
  `morale`, live trees and leagues with no founding tree left in `careers`, head-coach retreads, median dead money and median kickoff room in `offseason`, a habit's most held share in `gm-habits`, draft day's trades, QB trade-ups,
  deals with a future pick and starting quarterbacks traded in season in `trades`, win spread and a bucket's scramble share in `sim`): outside their usual band they warn (⚠: this league drifted),
  outside their normal band they fail (`scripts/band.ts`; both bands the owner's call, never moved to get green). `⚠` lines are warnings that don't fail
  a run: outlier record seasons (luck in small samples) and known engine issues, each gone once fixed.
- **`npm run format`** before committing: Prettier (`.prettierrc.json`, `.prettierignore`), and CI runs
  `format:check` on every pull request. `npm run check` includes it.
- `npm run dev` — local dev server (Vite)
- `npm test` — engine tests (Vitest)
- `npm run typecheck`
- `npm run sim -- 10` — simulate 10 seasons and compare league stats to NFL averages, each season's
  top five (yards, TDs, catches, sacks, picks) to NFL leaders and records (`scripts/leaders.ts`), and
  injury rates to the NFL's (`docs/INJURIES.md`); parity against the closing line (who wins, the margin around
  strength, the win spread, with strength read weekly) and passing by depth against nflverse (average air yards and the
  short, 10–19 and 20+ shares, from weeks 1 and 10 replayed). **Run this after any change to `src/engine/match/`
  or `injuries.ts` and keep stats inside the target ranges.** Leaders are noisy over 10 seasons:
  check a change near an edge with `-- 30` or more. `npm run check` (and CI) runs 60: over 10, the
  #1 and #5 passing rows sit close enough to their floors that main itself misses one block in four, and over 30 a
  change to moods alone (which reshuffles every game) moved overtime and the leaders' rows by a block's width.
- `npm run gm-letters` — a preview, not a check: seven AI GMs at each standing with you write a pitch, a bid, an
  enquiry, a counter and a final offer, a table line per band, a refusal and your director's note to `.check/gm-letters.md`
  for reading the words. Run it after changing `gmTalk.ts` or `offerWords`.
- `npm run sideline [-- games]` — out of bounds on catches, runs and scrambles by bucket (the clock, the side of the
  field, the gain, the sticks) against nflverse 2021–25 (`scripts/research-sideline.py` measures the NFL), the clock
  between snaps after a man goes out, and how far the league's men differ; AI games, fast (3,000 in under a minute).
  Run it after changing `match/sideline.ts` or the out-of-bounds code in `match/gameSim.ts`; `npm run sim` judges the
  same lines. Nothing may be ✗.
- `npm run passer [-- games]` — the passer's choices (sacked, scrambled, thrown away) by pressure and situation (the down,
  the red zone, his own end, trailing late) against FTN charting and NGS pressure 2023–25 (`scripts/research-passer.py`),
  throwaways from outside the pocket, intentional grounding a game, and how far passers differ; AI games, fast (3,000
  in under a minute). Run it after changing `match/pocketChoice.ts` or the dropback in `match/gameSim.ts`; `npm run
  sim` judges the buckets and grounding. Nothing may be ✗.
- `npm run fumbles [-- games]` — contact fumbles on runs, catches and scrambles tackled in bounds, by what's known before
  the snap (the down and distance, trailing or leading late), the share a defender forced and how far backs differ;
  strip-sacks by situation and the rusher's spot; who gets a loose ball (lost per 100, forced and own), who on the
  defense, and returns by group; against nflverse 2021–25 (`scripts/research-fumbles.py`); AI games, fast (3,000 in
  under a minute). Run it after changing `match/fumbleOdds.ts`, `match/looseBall.ts` or the fumble rolls in
  `match/gameSim.ts`; `npm run sim` judges the buckets. Nothing may be ✗.
- `npm run picks [-- games]` — after the throw: who intercepts it by the throw's depth, the pick's 20+ returns and
  pick-sixes by depth, breakups per incompletion by depth (throwaways left out) and who's credited with them (the line's
  share batted at the line), the share of picks crediting a pass defensed; against nflverse 2021–25 and FTN charting
  (`scripts/research-picks.py`); AI games, fast (3,000 in under a minute). Run it after changing `match/defendedPass.ts`,
  `match/returnBands.ts` or the pick and incompletion branches in `match/gameSim.ts`; `npm run sim` judges the buckets.
  Nothing may be ✗.
- `npm run dropback [-- games]` — how a play ends: a sack's loss (its shape, by the down, after he'd left the pocket or
  in it, backed up), how often he'd left it, tacklers credited on scrambles in bounds; reported: the loss by the
  defense's call, the slide share by situation and each ending's reason (slides, fights, why a man went out of bounds);
  against nflverse and FTN 2021–25 (`scripts/research-dropback.py`); AI games, fast (3,000 in under a minute). Run it after
  changing `match/dropbackEnd.ts`, `stepReason` in `match/sideline.ts` or the sack and scramble endings in
  `match/gameSim.ts`; `npm run sim` judges the same lines. Nothing may be ✗.
- `npm run situations [-- games]` — a play's time by what happened (incompletions by depth, catches and runs by yards,
  out of bounds, kicks), the half's last possession (the kneel by the clock and timeouts, how drives that try from deep
  end), the two-point try (how often at the same margins, run or pass, how often good) and returns (the shape,
  touchdowns, the spread between returners) against nflverse 2021–25 (`scripts/research-situations.py`); AI games,
  fast (3,000 in under a minute). Run it after changing `match/playTime.ts`, `match/twoPoint.ts`, `match/returns.ts` or
  the play times, the half, the try or the returns in `match/gameSim.ts`; `npm run sim` judges the same lines. Nothing
  may be ✗.
- `npm run endings` — audit thousands of game endings for nonsense (trailing team running out the
  clock, missed last-second kicks…). Run it after any coaching (`match/coach.ts`) change.
- `npm run audit` — raise each attribute in turn, replay the same games, and check it moves play;
  rewrites `docs/ATTRIBUTES.md`. **Run it after changing `attributes.ts`, `OVR_WEIGHTS` or how the
  engine reads ratings.** Nothing may be listed under "Needs attention".
- `npm run careers` — age a draft class of every position and play four 16-season leagues in
  parallel child processes, then four more for work ethic's lean on ceilings (about 6 minutes on 4 cores, slower with fewer); checks peaks, declines,
  retirements, trait and coaching effects and long-run play against the research ranges. Run it after changing `development.ts`, `aging.ts`, `traits.ts`, `coaching.ts`
  or retirement. Nothing may be flagged ▲/▼.
- `npm run offseason -- 6` — run seasons back to back and summarize AI front-office activity, cap
  health, roster sizes, league talent, injuries and the scouting, coaching and medical economies. Run
  it after changes to `finance/`, `offseason/`, `trade/`, `staff.ts`, `coaching.ts`, `medical.ts`
  or `injuries.ts`; talent, cap space, rosters and the coaching ledger (growth and decline ×1.00)
  should stay stable across seasons, and the free-agency market against the NFL's (who stays, who moves, good outside signings, one-year deals, no young star unsigned at kickoff; `scripts/free-agency-core.ts`, `docs/research/free-agency-market.md`). Three more leagues play in child processes for the cap-space drift
  check (one league's 32 teams are too few); `--seed x` plays another world.
- `npm run gm-habits` — four 10-season leagues in child processes: the AI general managers' habits (`gmHabits.ts`) carried,
  gained and lost (active per GM, changes a year, every habit present by season 5, none past 40%, no GM past three, someone
  turns Gun-Shy); `npm run gm-habits -- --effects` also pins each habit on for every AI club for 3 seasons and checks it
  moves its decision against a no-habits baseline (more of its log entries; the rare six are judged on built scenes). Run it
  after changing `gmHabits.ts`, `gmHabitsYear.ts`, `gmTraits.ts` or a habit hook in `offseason/` or `trade/`. Nothing may be
  flagged.
- `npm run quirks` — run the quirk marble bag for 10 seasons and check how often each quirk is carried,
  gained and lost; `npm run quirks -- --effects` also gives each quirk to every player at its positions
  and checks it moves its stat the right way. Run it after changing `quirks.ts` or a quirk hook in
  `match/gameSim.ts`. Nothing may be flagged. `npm run check` runs it (with `--effects`) when the
  quirks module, the match engine or what builds a league changes.
- `npm run parity` — the spatial open field (`src/engine/field/`) against today's engine on the same moments: four
  leagues' runs, catches and returns resolved both ways (yards by situation, tackles and misses, the film ending at the
  credited spot), the spatial-only reads, your team's season on each engine (eight salts) and the speed budget. Run it
  after changing `src/engine/field/`, `match/`, `attributes.ts`, `size.ts` or `quirks.ts`. Nothing may be ✗.
  `npm run parity-fit [-- rounds]` refits the field's knobs (`field/tuning.ts`) against the same judge; paste what it
  prints, then run parity.
- `npm run size` — player size: builds against each position's curve (fitted to real rosters) inside each tier's bounds
  with no pile-up at a bound, the rare gem's rate, no edge past its cap,
  each lever replayed on the same games with one group's builds two sd out (it must move its own stat the right way),
  the league at its medians against the league as built (totals must hold), and four 20-season leagues'
  tails against real rosters' (`scripts/size-long.ts`, each in its own process). Run it after changing `size.ts`, the
  match engine or what builds a league. Nothing may be flagged.
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
- `npm run morale` — play eight seasons (three more leagues alongside in child processes, for the head coaches' worn-thin
  line) and check the league's moods (`morale.ts`): band shares, underpaid
  final-year starters reading Poor or worse, a benching's dip and recovery, winning rooms happier than losing ones,
  no drift and no level out of range; the talks (`playerTalks.ts`): asks per club per season, promises kept; and
  the effects (G2): the game-day edge averaging out, the growth tilt centred and leaning the right way; and the room
  (L1): leaders and voices per club, unit reads (Split, Down, Tight shares) and club rooms not running away; and team
  meetings (L2): meetings per club per season, how many take one well or bristle, head coaches whose word has worn thin
  at season's end and their recovery; and chemistry (L3): centred, Clicking and Out of sync shares, Sparks leaning the right
  way, Anchors calming a room; and backing the staff (L4): the staff edge centred, rooms in doubt and lost, lawyers'
  rooms doubting more, notices kept, AI clubs relieving coordinators at the NFL's rate. Run it after changing
  `morale.ts`, `standing.ts`, `chemistry.ts`, `belief.ts`, `staffEdge.ts`, `relieve.ts`, `playerTalks.ts`, `benching.ts`,
  `development.ts`, `match/lineup.ts`, `training.ts`, `meetings/` or `offseason/negotiation.ts`. Nothing may be
  flagged ✗.
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
  - `gmHabits.ts` hidden ways an AI general manager does business (Signs a Bridge QB, Trades Firsts for Stars, Drafts Best
    Available, Gun-Shy on Big Deals…), drawn from a marble bag like quirks: a grip of 1–3, active from 2, never more than
    three at once, never on your GM; the engine's AI reads them through `habitOn`/`gunShyAt`, and each use goes in
    `habitLog` (`logMove`). `habitsForce` pins one on for tests and the check. `gmHabitsYear.ts` the new-year step inside
    `beginOffseason` (`habitsNewYear`: the draw and fades; `startHabits` and `noteRelease` handle starting habits and blow-ups). `gmVoice.ts` the words that tell them
    (news and your director's notes; never a label on a GM)
  - `gmMemory.ts` what an AI GM remembers of dealings with your GM (spec `docs/superpowers/specs/2026-11-07-gm-memory-voice-design.md`):
    a short list of moments on `GeneralManager.withYou` (trades, offers taken, final no's, being led on; `noteMoment`), a
    trade judged a season on from how the men played (`judgeTrade`, run by `memoryNewYear`), and his standing with you
    worked out from them each time it is read (`standingWith`, `standingBand`; never stored, no draws, never on a
    screen). A GM with no moments is neutral and behaves as before. It leans his price (`marginFor`), his patience (`ASKS`
    in `trade/talks.ts`, an offer's `patience`) and who calls first (`offersMoment`), each by a bounded step.
    `gmTalk.ts` his words: `talkFacts` (manner, band, the one moment he'd mention) feeds `say` for the opener and sign-off
    that `wrapLetter` puts around an offer (`offerWords` in `inbox.ts`), the trade table's line (`tableLine`) and refusal
    (`refusalLine`), and your director's line (`historyNote`). No digit, habit, archetype, "standing" or "trust" in them.
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
    stored); the cards a message opens with (`ui/mail.tsx`) are looked up the same way. Digests replace one-off
    letters: the head coach's locker room report at four check-ins (`lockerReport.ts`, its words in `lockerVoice.ts`),
    the director's daily waiver letter (`waiverMail.ts`), the head coach's weekly letter (`coachWeek.ts`: one letter a
    step or none, `coach:{season}:{clock}`, which replaces the separate player-talk, meeting-request, meeting-result
    and staff-notes letters; its rows are people, each with a face and its own answer; `staffNotes.ts` now gives it
    the rooms and the staff room), the re-sign window's contracts letter (`contractMail.ts`: our call on
    each player from `resignCall`, the AI's own rule, and buttons drawn live from the league); a digest's tables
    are `InboxMessage.sections` and what it told is `covered` (old one-off ids among them). Every sentence goes
    through `voice.ts` (`say`: the most specific line that fits, a stable tie-break, no repeat of a sentence the sender
    has filed this league year: `seasonSaid` and `around`, a line of two sentences counting as said when either was);
    `senders.ts` signs them. `npm run mail-preview` builds saves at each moment and
    `npm run screens -- --mail <prefixes>` shoots the letters
  - `stories.ts` storylines (`docs/NEWS.md`): what happened to one subject of your club (a man's deal, snaps, benching or
    losing, a feud, a room, a coach) kept beat by beat in `League.stories` (open and closed, `MAX_BEATS` each), so a
    letter tells it as one story. Record-keeping only: nothing in the sim reads it, and writing a beat draws nothing
    (`STORIES.on` turns it off in tests to prove play is untouched). Each story keeps how many beats each outlet has
    told (`told`, `markTold`, `untold`) and an outlet is a reader of the store (`Outlet`, `COACH` sees your own club's
    beats; a public outlet, after alpha, only the beats marked `pub`), so two outlets never repeat each other.
    `storiesStep.ts` the step after morale and the meetings: beats for what is read rather than done (a room turning
    Down or Split and holding, a feud, the staff's standing), the links between a man's story and his room's, the men
    who left, and `tellable` (a turn must have stood a week); it may read `standing.ts`, `morale.ts`, `belief.ts` and
    `coaching.ts`, and none of those may import it. `castSheet.ts` what a line may say about one man, the coach writing
    and the moment (`manSheet`, `coachSheet`, `momentSheet`): words and booleans only, each fact through a reader screens
    already use, so the fog of war holds. `coachWeek.ts` the editor of the head coach's weekly letter: it gathers the
    week's items (asks and an ask still waiting, his meeting request, a story closing, last step's meeting told a
    step on, a deal's or promise's clock, the rooms, the staff room), ranks them in five tiers, keeps tiers one to
    three and the notes of four and five fresher than `STALE` steps, then cuts the letter to `MAX_ROWS` rows from the lowest
    tier up (what needs your answer always stays; a result names `RESULT_MEN` men; notes alone never file a letter, and a
    meeting's result or a story closing rides in the next letter, filing one alone only after `RESULT_WAIT` steps), and
    words them through `coachWeekVoice.ts` around everything said this league year. A room is not told twice inside
    `NOTE_GAP` steps (a turn, its chemistry and its coach's belief count together). The losing is the club's, not a man's or a room's:
    one story (`{ kind: 'room', unit: 'team' }`), one row for the man asking with the most standing (the others named, across
    rooms: `talkRoom`, `answerRoomTalk`), one answer for every open losing ask, and one club-wide `LOSING_GAP` (a man asking
    inside it is answered as you last answered, `Team.losingAnswer`, `talkStep`, your club only). A meeting makes no story
    (`roomBeat` adds its beats only to a room already open because it turned), and its result rides in the next letter filed
    for another reason, alone only when it owes something (Negotiate) or has waited `RESULT_WAIT` steps. The coach writes at most every other step (`LETTER_GAP`): the step after a letter files none and its items wait, keeping their `born`; so nothing is lost, your club's ask is ignored after three steps (`waitFor` in `playerTalks.ts`; an AI club's after two) and a suggestion to your club lives a step longer (`meetings/index.ts`, `PENDING_STEPS`, no second one while it is held). Room and staff stories close with the season and the league year, silently; every kind has one story a subject a league year (a beat after it closed re-opens it, keeping what was told), and a man's deal, snaps or feud story with nothing pending closes quietly after `QUIET` steps (`quiet` in `storiesStep.ts`, told so never a closing row). `coachWeek.season.test.ts` plays a
    season and holds the letters to it: one a step, no sentence twice, no room told twice inside three steps, every
    meeting held told within two steps
  - `generate.ts` league/player creation · `roster.ts` depth charts, team ratings, each club's players (`teamPlayers`,
    an index beside the league kept by `setTeam` and `addPlayer`)
  - `size.ts` height and weight: each position's bell curve (`SIZE`, from combine percentiles), the roll (`rollSize`,
    the same two draws the flat rolls cost), `sizeZ` (the only size z-score), the matchup edges the engine adds where
    size decides (`sizeEdge`: contested balls, the jam, a passer's lanes, contact; `rushSizeEdge` and `massEdge` in
    the trenches; each in rating points, capped at ±2, zero between medians) and the rare gem (`Player.playsBig`, from
    `rollGem`: an outlier who loses half of what his build costs). Size on screens and in the AI: `buildNote` (the scout
    report's sentence on an outlier build), `spotNotes` in `roster.ts`, `heightMismatch` in the opposition report,
    `sizeBias` in `gmTraits.ts` on the draft board. Spec: `docs/superpowers/specs/2026-10-27-player-size-design.md`
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
  - `ceiling.ts` ceilings that settle in the league: over a player's first three seasons his true ceiling moves when
    his team's season ends (`settleFinished`, from `playWeek` and the new league year), on its own stream, leaned by
    work ethic, how he played against players rated like him (`playLean`), snaps and coaching; `ceilingShifts` keeps
    each change (hidden: no screen reads it). The swing table and the spread still to come (`CEILING_SWING`,
    `unsettledSpread`, which widens a scout's ceiling range) live in `development.ts`
  - `development.ts` yearly growth and decline · `aging.ts` the one aging table (development,
    retirement, contract asks and trade values all read it) · `traits.ts` hidden traits and their hooks ·
    `personality.ts` the personality name and one-sentence character line read off traits and agent dials (never stored;
    `TRAITS_ON` keeps a trait out of names until its job ships), `personalityRead` for a team's view, captains
    (`nameCaptains`) · `morale.ts` each player's mood: a weekly target (contract, role, team, locker room, promises
    from G3, a resting level from his makeup), a level that moves part of the way there, fading jolts for big moments (a benching's drop and its answers come from `benching.ts`, `BENCH_SIZE`);
    an answer eases the grievance it answered while it holds (`heardWeight`: an open promise, a reassurance until the
    quiet ends);
    `moraleWeek` in `playWeek`, `moraleStep` at each offseason step, nothing drawn from any stream; screens read it only
    through `moraleView` (your players only, in words); its effects (G2) read one scale, `moodLean` (talks in `demand`,
    position learning in `learnRate`) or `moodPull` against `moraleMean` (the growth tilt, `DevYear.mood` and
    `MOOD_TILT` in `development.ts`; the game-day edge in `buildLineup`'s knocks) · `benching.ts` who holds a starting job (storylines, the benching chain; spec `docs/superpowers/specs/2026-11-09-storylines-design.md`
    §8–10): the men in a chart's starting spots hold the jobs from cut-down day (`setJobs`; hurt or not, `Team.jobs.held`), a man earns one by
    `EARN` starts in a row and the longest-sitting holder gives his up, and a club's jobs clear at the new league year. Who started is read at kickoff from the chart and
    availability (`benchKickoff`, `Team.kickoff`), never from snaps. Your lineup is yours to set in camp (`lineupProblem`, `confirmLineup`,
    `Team.lineupSet`: the advance button stops at the door once a year, unless staff sort the chart). A healthy holder left off the lineup
    asks where he stands the same step (`benchWeek`, a `benched` ask, `JobQuestion` in `Team.jobs.questions`, `questionOf`) and, unanswered, is unsure
    each week he sits without ever being "ignored"; the other man who starts in his place asks too once the chart swaps back. Four answers to
    the holder (`BenchReply`: back in next week, just this week, earn it, it's his job now) and three to the other man (`OtherReply`), one
    answer clearing both (`answerBench`); a promise is kept or broken by the next start (a hurt man pauses it), and three starts in a row with
    no word settle it by the chart, a man finding out from the depth chart losing more (`BENCH_SIZE`: sit, backIn, thisWeek, earn, his, kept,
    broken, unsure, settled, chart). An AI club answers at once (`aiBenchReply`, by its GM). `benchWeek` runs in the morale step and draws nothing;
    `BENCH.on` false turns every writer off. A cleared starter not in a starting spot gets a reminder with "Put him back" (`clearedNotStarting`,
    `putBack`, `dismissReminder`). Its words are `benchVoice.ts`, its rows `coachWeek.ts`'s, a note a week while a question waits and a closing
    when it ends (`benchStory`, `benchCard`) · `playerTalks.ts` players speaking up (G3): who asks (three
    steps down with a cause, two a club a step, eight steps' quiet after an answer), your answers (`answerTalk`) and the
    AI's (`aiReply`, by its GM's tendencies), promises kept or broken by what happens and remembered (`promisesScore`),
    run at the end of each morale step; `promiseMail.ts` is the head coach's season's-end reminder of open promises;
    `talkMail.ts` files your letters (a step's letters as one message, `talkCard`
    reads what a letter shows), his words in `playerVoice.ts` · `disputes.ts` hold-ins, holdouts (G4a) and trade requests (G4b): who
    escalates (`escalation`: a soured talk, four Very poor steps; a deal from the re-sign window to camp, snaps, the losing
    or a feud whenever talks run), how a dispute runs and ends (a request private until it leaks, `LEAK_STEPS`, then a
    rumor; refused, it hardens into a hold-in at camp), AI clubs' answers
    (`aiAnswerDispute`, `aiReviewDispute` from camp to week 4, `aiSettle` in `offseason/ai.ts`) and kept promises, your answers (`answerDispute`) and what a screen
    may show (`disputeView`); the readers the roster, training, development and lineup code need live in `disputeRead.ts`
    (no engine imports: `MOOD_ACTS`, `onDidNotReport`, `notPracticing`, `rustKnock`, `promisedDeal`, `wantsOut`: the trade
    market reads a public request through it, `WANTS_OUT` in `trade/judge.ts`); the head coach's
    letters in `disputeMail.ts`, his words in `disputeVoice.ts` · `standing.ts` who runs the room (L1,
    `docs/superpowers/specs/2026-11-01-locker-room-voices-design.md`): a man's weight (leadership, the field, seniority,
    stature), leaders and voices (`tierOf`; captains always lead, last season's until camp), how a voice sounds (stirs,
    steadies: words only), units (the position coaches' rooms plus the specialists), each unit's read (`unitRead`: its
    men's moods with the voices counting more; Tight, Settled, Restless, Down, Split) and your club's views (`roomView`,
    `standingView`, `roomReasons`; words and ids only). A voice rubs off on his room (L3, `TONE` in `roomScore`): a Spark's
    mood (`soundOf` stirs) spreads, an Anchor's (steadies) counts half and halves a Spark's, an Anchor's room draws in toward its
    average (`calmOf`), friends a little; read against the league's typical voice, so the league doesn't drift.
    `chemistry.ts` (L3, `docs/superpowers/specs/2026-11-03-chemistry-on-sunday-design.md`): each room's edge on game day,
    ±0.3 rating points in `buildLineup`'s knocks (`SimOptions.chemistry`, `NO_CHEM` to hold it at zero in tests): its mood
    against the league's through `moodScale` (less for a divided room; complacency trims a winning club's happy rooms unless a
    driven voice keeps them hungry) plus time together (the line, the secondary, the QB with his top targets, from
    `statTeams`), centred on the league each week; the words Clicking, Gelling, Still learning each other, Out of sync.
    `belief.ts` and `staffEdge.ts` (L4, `docs/superpowers/specs/2026-11-04-backing-the-staff-design.md`; MVP #11): each
    room's hidden belief in whoever runs its side (`Coach.belief`, −1…1, on the coordinator or a head coach covering):
    bad games wear it down (three times as far with a Locker-Room Lawyer voice in the room), streaks and meetings move
    it, winning lifts it less the more a club wins, it drifts to the middle and halves at the new league year; read in
    words (they believe in him, doubts about his calls, he's lost them). The staff edge on Sunday, ±0.2 for a side's
    coach and ±0.1 for the head coach in `buildLineup`'s knocks (`SimOptions.staff`, `NO_STAFF`), from each coach's
    quality (`coachValue`) and the room's belief (the head coach's credibility), centred on the league each week. Doubt
    is a meeting trouble with "Stand behind him" and "He's on notice"; `relieve.ts` relieves a coordinator in season,
    yours (`relieveCoordinator`, the move's rules in `coaching.ts`: `relieveProblem`, `relieveMove`) or an AI club's
    (`aiRelieve`: losing, his side in the bottom quarter, his rooms turned, a weekly draw by its GM; a `coachRelieved`
    leadership event SNN reports).
    `roomFacts.ts` builds what a line may read, `roomVoice.ts` the head coach's, position coaches' and screen's words; the
    report and the staff notes remember what they told in clock-stamped, club-named `unit:`/`standing:` keys;
    `TalkContractButton` (`ui/negotiation.tsx`) opens contract talks anywhere for a player `talksOpen` allows · `mentoring.ts` veterans mentoring players 21–24: work ethic, temperament and poise move at most a
    point a year (`Player.shifts`, read through `workEthicOf`/`temperamentOf`/`poiseOf`, never `traits` directly),
    landing at the new league year; one planner for your staff and AI teams (`planMentors`) · `lockerMail.ts` the
    locker room's letters · `relationships.ts` how a player left each club (`Player.left`), friendships and feuds
    (`Player.ties`, three at most, inside a position room), and what's worked out from history (rapport with a coach,
    homecomings, grudges); their marbles (`relationshipMarbles`) and price nudges (`contractLean`, read by `demand` and
    `offerValue`), and who speaks out (`speaksOut`) · `trees.ts` coaching trees worked out from careers (three-season links,
    `Coach.pastUnder` for founding trees only), standing, and the carousel's terms (`keepBonus`, `treeLean`,
    `inheritedScheme`) that `coaching.ts` reads · `meetings/` team meetings (L2,
    `docs/superpowers/specs/2026-11-02-team-meetings-design.md`): when a head coach suggests one (`suggest.ts`: calendar
    moments once a season; trouble when a room turns Split or Down, three straight losses, a feud starting, a leader
    benched or traded; cooldowns per room, team and club), the choices offered (approach, what's behind it, timing),
    how each man takes it (`react.ts`: a score from fit, the coach against his makeup, the backing, the coach's word and
    history, luck on the meeting's own stream; a `meeting` jolt, a quarter as far for a man with nothing wrong),
    commitments kept or broken (`commitments.ts`; AI clubs by their GM's tendencies), the GM address in a crisis
    (`address.ts`), each head coach's hidden credibility (`credibility.ts`, read in words; a worn-thin word adds up to a
    quarter to a losing coach's heat, `credibilityHeat` in `ownerBag.ts`) and AI clubs' choices (`ai.ts`).
    `meetingsStep` runs after every morale step; your club's suggestion waits in `Team.meetings.pending` unless the head
    coach handles them (`setMeetingsByCoach`). The letters (`mail.ts`, from `deliverMail`): the suggestion with your three
    calls (`meetingCard`, rendered by `ui/meetings.tsx`), the result and what we owe, a captain's word after your address,
    due and candid rows in the staff notes, the year in the season's-end report, an SNN rumor for a worn-thin coach on a
    losing run; the Locker Room reads `meetingsView`. Facts in `facts.ts`, the head coach's words in `voice.ts`
  - `field/` the spatial engine (slice one, the open field; spec `docs/superpowers/specs/2026-11-03-spatial-open-field-design.md`),
    on for your games by `League.settings.spatialField` (New Game and the v85 upgrade turn it on, a `?dev` switch
    turns it off; `createLeague` leaves it off unless asked, so scripts keep today's speed) and only for your games
    (`spatialFor` in `league.ts`; AI games never touch it). At a moment of possession (a run past the line, a catch, a return, a pick or a strip-sack's recovery) the stager plays the approach blind
    (`approach.ts`, from `momentEntry`), then `runField` (`run.ts`) steps bodies at 20 a second: the carrier's read
    (`read.ts`), the chase (`chase.ts`), blocks, contests (`contest.ts`, skills from the `burst`/`reads` contests and
    `sizeEdge`), habits. Today's roll still decides yards, touchdowns and out of bounds (`FieldStart.target`): the
    field plays out how he got there and who made the tackle. It draws only from `${seed}:field:${index}`, so today's
    dice are untouched; `FieldRecord.snap` keeps what a replay needs (`replay.ts`). Knobs in `tuning.ts`, fitted by
    `npm run parity-fit`. The stager and its helpers (`stage.ts`, `routes.ts`, `pocket.ts`…) live here too. Slice two,
    the pocket (spec `docs/superpowers/specs/2026-11-04-spatial-pocket-design.md`): every dropback in your games plays
    the line, the rush and the quarterback (`runPocket` in `pocketField.ts`; its moment, staging and composed film in
    `pocketMoment.ts`). Today's rolls decide clean, pressure, hit, sack, scramble or throwaway; the field picks the
    rusher within today's group and loses today's own charged blocker (`FieldFacts.rg`/`bb`), and when and how. A
    scramble hands over to the open field (`scrambleStart`), a catch's open field starts from the pocket's last frame
  - `match/gameSim.ts` play-by-play engine · `match/coach.ts` AI decisions (pure functions) · `match/sideline.ts`
    out of bounds as the carrier's choice: pushed out or stepped out as odds from the play, the clock and the men in
    it (spec `docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md`); one draw in every game, the field
    plays it out (`FieldFacts.oob` 1 pushed, 2 stepped) · `match/pocketChoice.ts` the passer's choice after his read
    (spec `docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md`): throw it, throw it away or take off as
    odds from the pressure, his read, the situation and the man, one draw; a throwaway from inside the pocket or rolled
    out, and its intentional grounding odds (`penalties.ts`: loss of down, the spot, a safety); the field stages it
    (`PocketOutcome` 'away', 'awayClean', 'awayOut'; `FieldFacts.gr`) · `match/fumbleOdds.ts` a fumble on contact (spec
    `docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md`): odds from the hit (the tackler's tackling, size
    and habits), the carrier (ball security, fatigue, habits), the fight for yards (the down, trailing late) and a
    defense going for the ball, then whether a defender forced it and why (strip, hit, fight, his own); the reason is
    in the play's text and the film shows it (`field/fumble.ts`); the strip-sack's odds beside it (`sackStripOdds`: the
    rusher's spot and hit, the quarterback, the down) · `match/looseBall.ts` the loose ball (spec
    `docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md`): who gets it (the play, forced or his own), who on
    the defense is credited (the forcer, else a group by the play) and his return by his group; draws nothing · `match/defendedPass.ts` after the throw (spec
    `docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md`): who picks it off (the cover man, else a group by
    the throw's depth, a man of it by ball skills; a lineman only at the line, tipping it up), breakups by depth and who's
    credited (the line's share batted down at the line), the pick's return by depth; draws nothing ·
    `match/returnBands.ts` the yard-band return a pick and a loose ball share (`bandReturn`) · `match/dropbackEnd.ts` how
    a play ends (spec `docs/superpowers/specs/2026-11-07-dropback-endings-design.md`): a sack's loss from the NFL's shape
    (in the pocket or after he'd left it, the down, the call, the man, backed up), the slide or the fight for a scrambler
    who stays in bounds and why (`slideReason`, `fightsForIt`), the man who touched a slider down (`TOUCHED`); why a man
    stepped out is `stepReason` in `sideline.ts`; the words in the play, the reasons on film (`FieldFacts.ow`, `sw`,
    `tc`, `ex`); draws nothing · `match/playTime.ts` a play's time and the half's last possession (spec
    `docs/superpowers/specs/2026-11-07-a-plays-time-design.md`): `playSeconds` from what happened (the field still times
    your games' runs and catches), `kneelOdds` for a drive with 75 seconds or less before the half (one draw a drive);
    draws nothing · `match/twoPoint.ts` the two-point call (`sureTwo`, `twoPointOdds` at the NFL's odds by the margin,
    leaned by the head coach) and run or pass (`runShare`); the try is a real snap from the 2 (`twoPointTry` in
    `gameSim.ts`: nothing booked, its text `Two-point try: …`); draws nothing · `match/returns.ts` a kickoff's or punt's
    return drawn whole from the NFL's shape (`returnYards`; a touchdown is the return that reaches the end zone);
    draws nothing
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
    each GM in `talks.ts` (about four proposals a moment, cooldowns, his memory of you leaning the count), your staff's word on a
    deal in `advice.ts` (your view only); draft day in `draft.ts` (covet: a team's man at the earlier pick
    against its best at the later one on its own board, which `judge` adds in the `draft` phase; the AI's
    trade-ups before each pick for an NFL reason, offers to you on the clock, *Shop this pick*, *Call teams
    ahead*, offers lapsing with their pick); `TradeContext`, one decision pass's cache ·
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
- **A player changes club through `setTeam`, and joins the league through `addPlayer`** (`roster.ts`), tests included:
  `teamPlayers` reads an index those keep. A club cleared by hand is caught and read again; a club set by hand isn't.
- `League` must stay plain JSON. If you change its shape, bump `SAVE_VERSION` in `generate.ts` and
  add an upgrade step to `migrate.ts` (old saves are migrated on load, never thrown away).
- `league.season` is the league year: it ticks over when the offseason begins (like the NFL's March
  new year). Results screens use `resultsSeason()` to show the season just played.
- Cap math lives in `finance/contract.ts`; never store a single "salary" number on a contract.
- Teams use the real NFL markets and divisional alignment with **original nicknames**. Never
  ship NFL nicknames, logos, "Super Bowl" or "AFC/NFC" (see `RESERVED_NICKNAMES`). Real player
  names are a community mod concern.
- Match the existing style: small pure functions in the engine, comments that explain *why*.
