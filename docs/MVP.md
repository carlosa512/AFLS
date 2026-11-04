# AFLS MVP

Alpha means every item below works end to end. Status was read off the code on 2026-10-20, at version 0.1.0.
Each MVP item finished from here bumps the middle version number (`docs/VERSIONING.md`).

**Score: 15 Done · 0 Partial · 0 Missing.** Alpha (0.4.0).

## The season

- [x] **1. 32 fictional teams, schedule, standings, playoffs, a champion** · **Done**: real markets with original
      nicknames, the NFL's 17-game formula (`season/schedule.ts`), tiebreakers (`season/standings.ts`) and a
      14-team bracket to a champion (`season/playoffs.ts`).
- [x] **2. Match engine with box scores** · **Done**: a play-by-play engine (`match/gameSim.ts`) with box scores and
      a replay viewer (`BoxScore.tsx`, `GameViewer.tsx`). Games as uncertain as the NFL's (a team's day, new
      leagues as even as lived-in ones) and a passing game shaped like today's, checked against nflverse (0.2.36).
- [x] **3. Rosters and depth charts** · **Done**: 53-man rosters, a drag-to-reorder depth chart and scheme spots
      (`roster.ts`, `Roster.tsx`).
- [x] **4. Injuries that matter** · **Done**: snap and collision injuries with layoffs and IR (`injuries.ts`).
      Lineups skip unavailable players (`isAvailable`) and auto depth rebuilds the chart before each game.
- [x] **5. Weather** · **Done**: a seeded roll per game, real roof types and changes by season (`data/stadiums.ts`),
      and outdoor conditions that cut passing and kicking (`weather.ts`, checked by `npm run weather`).

## The players

- [x] **6. Ratings by position, development, position-based aging, retirement** · **Done**: position-first 1–20
      ratings (`attributes.ts`), growth for young players (`development.ts`), one aging table by position
      (`aging.ts`) and position-aware retirement (`retireChance`), checked by `npm run careers`.

## The front office

- [x] **7. Contracts and salary cap** · **Done**: year-by-year ledgers with bonus proration, dead money and
      restructures (`finance/contract.ts`), plus cuts with a pre/post-June 1 preview (`releasePlayer` in `cap.ts`).
- [x] **8. Re-signing and free agency** · **Done**: a re-sign window, tags, fifth-year options and extensions, then
      free agency with negotiation (`offseason/negotiation.ts`).
- [x] **9. Draft with basic scouting** · **Done**: a 7-round, 260-prospect draft with a combine and AI boards
      (`offseason/draft.ts`). Prospect ratings stay fuzzy ranges until scouted (`scouting.ts`, visits). Ceilings
      settle over a player's first three seasons (`ceiling.ts`, 0.2.10), so about a third of first-rounders bust and
      some Day 3 picks break out (`npm run careers`, `docs/research/draft-outcomes.md`).
- [x] **10. Trades with AI teams** · **Done**: one judge for every deal, with pick charts, contract value and seller
      floors (`trade/judge.ts`, `value.ts`). `npm run trades` fails on lopsided deals and exploit probes.
- [x] **11. Coaches (HC, OC, DC) whose ratings affect results** · **Done** (0.4.0): their ratings (youth, veterans)
      drive development and aging. Their styles, schemes and evolving quirks affect game decisions and specific execution
      windows, with player fit, career history and staff reports (`docs/COACH_QUIRKS.md`). On Sunday a side's coach
      lifts his rooms by up to ±0.2 rating points and the head coach every room by up to ±0.1, from their quality and how
      far each room believes in them (`staffEdge.ts`, `belief.ts`); losses and a Locker-Room Lawyer wear belief down,
      meetings answer it, and coordinators can be relieved in season, by you or by AI clubs at the NFL's rate
      (`relieve.ts`). The special teams coordinator keeps his own edge (`specialTeamsEdge`).
- [x] **12. AI teams that manage their rosters sensibly** · **Done** (0.2.0): AI front offices draft, sign, cut, trade
      and stay cap-legal (`offseason/ai.ts`), keeping a cap reserve for the season by their GM's cap style. Practice
      squads (`personnel/`, `docs/PRACTICE_SQUADS.md`), on for every new career, give them ready cover: waivers on a
      weekly settle, one-game call-ups for short absences, promotions for long ones, poaching with two weekly
      protections, and futures deals that keep squads into the next season. `npm run offseason` now holds every club
      at 53 at kickoff (roster min >= 50 and nobody under 53 with cap room, both strict).

## The feel

- [x] **13. Basic inbox for key events** · **Done**: mail for injuries, free agency signings, trades and offers, the
      combine and draft, and a recap of every game (`inbox.ts`, `Inbox.tsx`).
- [x] **14. UI works on desktop and mobile** · **Done**: breakpoints from 480 to 960px, phone tab bars, a phone
      layout for the inbox and pinned table columns (`styles.css`). Not re-tested on a phone for this list.
      Names always link: `PlayerLink` and `TeamLink` (`components.tsx`) are the only way a screen shows a player or
      a team, `TeamPicker` the only team dropdown; `ui.test.ts` enforces it. Every list of comparable rows sorts
      through `SortTh` (or `SortSeg` for a list); `tr.is-user` is the one row mark; the trade screen's views are routed
      tabs (`#/office/trades/<view>`). Team strength reads through your scouts (`perceivedTeamRatings` in
      `scouting.ts`); only New Game reads `teamRatings`, for each club's overall before you pick (you have no scouts
      yet). It shows no record: a new league has no history. The rules every screen follows are in `docs/UI.md`.
- [x] **15. Save and load** · **Done**: IndexedDB autosave after every change, backup export and import (`saves.tsx`)
      and old saves migrated on load (`migrate.ts`). Known issue: saves grow about 430 KB a season because retired
      players are never pruned.

## After alpha

Not needed for alpha. Some are already built; each one shows the MVP item it hooks into, for the history.

- [x] **Referees** · **Already in** (hooks into #2): seventeen officiating crews with hidden tendencies that
      multiply the engine's penalty rolls (`officials.ts`, `docs/OFFICIALS.md`).
- [ ] **Full news and media outlets** · **Partial** (hooks into #13): SNN division headlines, trade stories and the
      offseason front-office digest, the Arena Gazette's numbers column (EPA, success rate and explosives, counted
      by the engine) and rookie impact reports join the inbox; a Stats screen tab for the advanced numbers and
      narrative arcs remain future work. See `docs/NEWS.md`.
- [x] **Staff avatars and the women staff flag** · **Already in** (hooks into #11): drawn staff avatars
      (`staffAvatar.tsx`, `docs/AVATARS.md`). Scouts and medics can be women (`woman`, drawn with the name in
      `identity.ts`), but coaches never are.
- [x] **Void years** · **Already in** (hooks into #7): proration parked in void years, accelerating as dead money
      when the deal voids (`finance/contract.ts`).
- [ ] **Deep scouting network** · **Partial** (hooks into #9): scouting departments with ratings, budgets and a
      market (`staff.ts`) and per-scout reads (`readFor`). No regional network yet.
- [ ] **Owner and job security** · **Partial** (hooks into #11 and #12): owners have market budgets, patience and a
      yearly letter, and AI head coaches get fired from the hot seat (`coaching.ts`). Phase 1 adds persistent GM
      identities and appointment histories, scout → director → GM promotion functions, and per-game GM/coach
      career records with save migration. Phase 2 adds GM cards, stable SVG portraits, a sortable league GM
      directory and career overview, with links from team, cap and trade screens. Phase 3 adds owner retention
      mandates with signed coach contracts, shared player/AI staffing restrictions and visible owner explanations.
      Joint GM/coach reviews now drive GM dismissals, renewals, midseason interims, director succession and offseason
      hiring rounds. The player can lose the job, accept another offer or spectate while unemployed. Private staffing
      briefings stay with the current club; other teams appear through reported moves and qualified rumors. Owners
      judge through a marble bag (`ownerBag.ts`): bad seasons add heat to the GM or head coach, patience is spent and
      never endless, and in-season reviews run week by week. Broader midseason player recruitment remains in progress.
- [x] **Player origins** · **Already in** (hooks into #9): every player has a school, an International Pathway country
      or the CFL (`data/origins.ts`, `origin.ts`), on his card and the draft board. Tiers follow the real draft and
      rosters; small schools and the Pathway start on less film (`knowledge`). A Pathway class arrives after each
      draft (with a reserved practice squad place on profile `afls-2026-v2`) and CFL veterans at each new league year.
      Spec: `docs/superpowers/specs/2026-10-27-player-origins-design.md`.
- [x] **Morale and holdouts** · **Done** (0.3.0; hooks into #6 and #8): every rostered player has a mood (0.2.21,
      `morale.ts`): a weekly target from his contract against his market, the role he plays against the one he expects
      (a depth man accepts depth), his team's results and his locker room, around a resting level his makeup sets,
      with fading jolts for big moments (a benching, a raise, the C, a friend cut). Your players' moods show as
      smileys on the Roster and the Locker Room's morale board, a pill on the card, and in the head coach's locker
      room report; `npm run morale` holds the league's moods to range. Players speak up (0.2.22, `playerTalks.ts`):
      an unhappy man with a cause writes to you (a step's letters as one message), you promise, reassure or stand
      firm, AI GMs answer theirs by their tendencies, and promises are kept or broken by what happens and remembered.
      Moods matter (0.2.24, G2): a young player's growth tilts by his mood week by week (±10% a year), every lineup
      plays up to half a point up or down on game day (both against the league's mean, so totals hold), a happy man
      learns a new position faster, and an unhappy one asks his own club up to 10% more with less patience; the Locker
      Room and the coach's report say who it's costing. Being heard (0.2.26): a promise eases three quarters of the
      grievance it answers while it's open and a reassurance a quarter until he could ask again, and the head coach
      reminds you of open promises when the season ends. Fewer sulkers (0.2.37): paid 80% of his market or more a man has
      no complaint (a backup feels half of one below it), a rookie-deal star's grievance is capped, and before a season's
      games a man the depth chart starts reads as a starter. Hold-ins and holdouts (G4a, `disputes.ts`): a deal talk that
      ended badly and a man still Very poor four steps later, with his deal still his top reason, holds in (reports, won't
      practice: no position learning, growth as if Abysmal) or, a greedy veteran starter, holds out (the Reserve/Did Not
      Report list, a $2.25M camp fine, a game check a week withheld, the accrued season lost, rust when he reports) until
      a deal, a trade, a promise he takes, giving in, or week 1 for a hold-in. AI clubs settle or hold firm by their GM's
      tendencies, think a firm answer over each step from camp to week 4 (playing without him against his raise and the
      GM's stubbornness), and keep the deal and snaps promises they make; your head coach writes when one starts and ends, with
      your four answers (talks, a promise, firm, shop him), and the Locker Room, the Roster and the card show it. Trade
      requests (G4b, 0.3.0): a talk soured over snaps, the losing or a feud (or a deal, in season, after a hold-in or
      holdout that ended without one) becomes a request, private to his club until it leaks (six steps, three for an
      outspoken man, at once when he's refused and outspoken; then a rumor). Public, his club holds out for 15% less and
      buyers open 10-25% under their price; an AI club shopping him puts him on its block, a stubborn one refuses him.
      Refused and still Very poor at the next camp with a deal in reach, it hardens into a hold-in; it's withdrawn after
      four calmer steps or when his snaps come. Your letter offers shop, refuse, and the promise his cause allows. Team meetings (0.3.4, L2 engine): head coaches hold them at the calendar's moments and when a room turns, players take
      them well or bristle, commitments are kept or broken, and each head coach's credibility with his room rises and
      wears thin (a small push on the hot seat); your coach asks you first (0.3.5): his suggestion letter with three
      calls, the result and what we owe, due reminders in the staff notes, rooms you can ask for a meeting, your own
      address to the team in a crisis, a captain's word after it, and an SNN rumor when a coach is losing his room.
      Chemistry on Sunday (0.3.9, L3): a room's mood and its time together move play a little (±0.3, centred on the
      league), Sparks and Anchors rub off on their rooms, winning clubs get comfortable unless a driven voice keeps them
      hungry, and your coach tells it. Specs:
      `docs/superpowers/specs/2026-10-29-morale-core-design.md`,
      `docs/superpowers/specs/2026-10-29-morale-talks-design.md`,
      `docs/superpowers/specs/2026-10-29-morale-effects-design.md`,
      `docs/superpowers/specs/2026-10-30-morale-escalations-design.md`.
- [x] **Schedule weather forecasts (fog of war)** · **Already in** (hooks into #5): forecasts at three stages with
      calibrated rain chances on the schedule and the next-game card (`forecast` in `weather.ts`). Trend arrows and a
      staff hook are not built yet (`docs/WEATHER.md`).

## Not in the shipped game

- **A real-world start file** (real players and rosters), for legal reasons. If this is ever revisited, the usual
  route is letting the community make roster mods.


## Follow-up: out of bounds on the field (0.4.2)

- [x] **A man who goes out of bounds is chased out.** The engine still calls out of bounds at its odds (18% of catches,
      35% hurrying, 5% protecting a lead), knowing nothing of where anyone is; the field now sends the free defender
      who can reach the exit soonest to run him out (`escortFor` in `field/run.ts`). Over 60 games, catches out of bounds
      with nobody within 3 yards in the last second fell from 18% to 11%, alone (5+ yards) from 25 to 11. Left: those 11,
      where nobody could get there; letting the engine's odds read the field (alone, he'd stay in) is a bigger change.
- [ ] **Out of bounds as the player's choice, not a flat roll.** Today `pOut` in `match/gameSim.ts` is 18% of catches
      (35% hurrying, 5% protecting a lead) whatever the field: nobody chooses it, so a lone receiver in open field can
      be sent out. A real carrier weighs trying to win (clock, score, the room in front of him), staying healthy (his
      condition, injury history, the hit coming; going out skips that hit's injury chance) and his makeup
      (`contactAverse`, `finishesForward`, toughness). In your games the field knows who's near him; AI games need a
      stand-in. It moves every game (clock stops, plays per game, leaders), so it needs a spec and the full sim checks.

## Follow-up: choices and situations, not flat odds (audit 0.4.2)

The goal: games that play like the NFL's because the people in them choose, with the odds coming out of those choices
and the situation (down, distance, clock, score, who's near), calibrated against NGS, nflverse and charting data. An
audit of `match/gameSim.ts` found these rolls that ignore what should drive them (lines as of 0.4.2). Out of bounds on a
catch or run is the item above.

- [ ] **High: the passer under pressure** (L3096, L3101, L3120). Scramble and throwaway are dice: a throwaway is 12% for
      any non-gunslinger, reading neither his decisions nor down, distance, score or field position. Calibrate with NGS
      time to throw, throwaway rate under pressure, nflverse `qb_scramble`.
- [ ] **High: fumbles on contact** (L2988, L3455). They read ball security and the tackler, but not the hit (a gang
      tackle, a strip try), fatigue or condition, or a carrier stretching late. Calibrate: nflverse fumbles per touch.
- [ ] **Medium-High: a play's time** (L2963, L3001, L3022). 4–7 seconds whatever the yards, the throw's depth or the
      tempo; the field times your games, AI games keep the flat draw, so possessions and two-minute drills read it.
- [ ] **Medium-High: after an interception** (L3300–3315). The odds of a pick are rich; who catches it (65% the cover man)
      and the return (normal 9 ± 10, a 6% long one) are flat. Calibrate: return yards by air yards, pick-six rate.
- [ ] **Medium: fumble recoveries** (L2808): 52% the defense's, whoever is near the ball. In your games the field knows.
- [ ] **Medium: a sack's yards and strip** (L3696): yards normal 6.5 ± 2.5 whatever the drop or the rusher; the strip
      reads one habit, not ball security or a hit from behind.
- [ ] **Medium: a scramble's end** (L3821): out of bounds 20% (55% hurrying) and a slide 40%, the same gap as a catch's.
- [ ] **Medium: the two-point try** (L1511): one roll on short accuracy, outside the run and pass engines.
- [ ] **Low:** pass breakups credited on a flat 30% of incompletions (L3326); return touchdowns as small edge-scaled rates.

Read and fine: completion and interception odds, pressure and sack odds, penalties (crew- and player-scaled), kicks.
Measured on the field (0.4.2): a man going out of bounds slips past defenders no more often than a man who's tackled
does (3+ within reach and untouched: 28% against 31%), so the crowd isn't a separate gap.

## Follow-up: rate-stat qualification

- [ ] Use shared, scope-aware minimum opportunities for rate leaders (passer rating, completion percentage,
      yards/attempt and similar categories), based on team games rather than a backup's own appearances.
      Apply the same eligibility to widgets, sorted league tables, season/career leaders and awards; show the
      minimum clearly without hiding a player's actual statistics. Verify early-season and partial-season
      samples, traded players and postseason scopes. A 2-for-2 passer must not lead a season rate category.
      Current Stats sorting already has a per-player-GP qualification; that is an incomplete foundation.

## Follow-up: what the speed pass left (0.2.41)

- [ ] **Free agency re-reads every free agent each day.** Each club's scouting read, injury risk, character and habits
      for each free agent are worked out again on every free-agency day and both late passes (7–9 times an
      offseason), though most don't change between days: 10–15% of a multi-season league. A club's win-now lean does
      change as it signs, so a cache must key on what each read uses, proven by an unchanged league fingerprint.
- Considered and left (the owner's call): slimming retired players further. Retirement already drops what only a
  developing player needs; traits, personality and combine stay for the card (about 13% of a save at season 6).

## Follow-up: what the front-office work left (0.2.36)

Each is a `⚠ known issue` in `npm run offseason` (shown, never counted) until it's fixed; then its line goes back to
being judged. Spec: `docs/superpowers/specs/2026-11-01-front-offices-design.md`.

- [ ] **Leagues grow older than the NFL's (start here: it likely explains the next items).** NFL starters average 26.6,
      12% of them 31 or older (*nflverse* snap counts and birth dates, 2021–24). A new league matches (26.8, 12%), but by
      season 10 its starters average 28.0 with 28% aged 31+ (main: 27.75 and 24%, so it predates 0.2.36). The oldest
      gaps are at QB and TE (+2.4 years), punter (+2.1), WR and OL (+1.5), where ratings hold their peak longest. Look
      at who coaches start (a young player with upside against a veteran barely better), when players retire, and how
      ready draftees are; the league's talent sliding after year three (13.22 to 12.7 over 16 seasons) likely follows.
- [ ] **Starters leave football more as a league ages.** About 3% of last season's starters are unsigned or retired
      at kickoff early on, 5–8% by season 6 in every world (NFL 2.1–4.0%, *nflverse* 2021–24). About half is
      retirements, half faded veterans (about 32, rated 9–10, already asking the minimum) no club has room for. It
      shows with or without restructures, so it isn't the cap squeeze; look at when starters retire and how clubs fill
      the bottom of a roster.
- [ ] **Clubs restructuring sits under the NFL's in a new league's first seasons** (about 25–38% against its 55%,
      Over the Cap) and swings 19–59% season to season. NFL clubs also restructure to extend their own players early;
      ours don't.
- [ ] **Tags spike when a big class of stars comes due at once** (20 in one season, 11–13 in others, against the NFL's
      6–10). NFL clubs extend most stars a year early, so few reach the tag; ours only re-sign a player once his deal
      has run out.
- [ ] **Room made for a tag or a one-year deal forgets next year.** The re-sign window counts a keeper's new deal against
      next year before it borrows, but the tag path (and a one-year deal) counts nothing: a GM that just made no room
      for a keeper's new deal can then restructure to tag him, though next spring he's owed his price again, as
      `nextYearNeeds` counts him once tagged. Counting his market price there (`inPlans` keepers only) fixes it, but
      it moved two checks when tried: `morale`'s underpaid final-year starters reading Poor (0.59 against 0.6–1 then; the floor is 0.5 since G4) and
      `trades`' draft-day deals with a future pick (2.6 against 3–9). Measure both before it ships.

## Follow-up: coaching trees run at the floor of their NFL bands

- [x] **Make coaching pedigree drive hiring, so trees form the way the NFL's do.** Every tree number sits at or near
      the floor of its band (`npm run careers`, spec §4.6 in
      `docs/superpowers/specs/2026-10-28-personality-relationships-design.md`), on main as well as with moods:
      - **Live trees:** 2.2 a league on main (band 2–5).
      - **Share of head coaches in a live tree:** 0.15–0.18 (band 0.15–0.4).
      - **Share of head-coach hires that come from a tree:** 0.11–0.16 (band 0.10–0.35).
      - **New trees born:** swings from 1.5 to 3.5 a league between worlds that play almost alike.

      G2 tripped the live-tree floor (1.9) by reshuffling who wins, not through any mechanism. Parity and head-coach
      turnover held: year-to-year record carryover 0.335 against 0.338, head-coach changes 6.9 against 7.1 a year. A
      system this thin will keep tripping on unrelated changes, so the fix belongs in the hiring model, not in the
      checks.

      **Why trees are scarce (`trees.ts`, `coaching.ts`):**
      1. **Head-coach searches ignore pedigree until a tree already exists.** `treeLean`'s standing term applies only
         to a candidate already in a tree. The only win-share term in the search score (`HOT`) is for risers promoted
         or poached from a club, not for market candidates. In the NFL, having coordinated under a winning head coach
         is the strongest hiring signal, and it's how trees start: Shanahan to McVay, Reid's coordinators.
      2. **Pedigree works backwards on price.** `coachAsk` charges up to about 20% more for a coach off a winning
         staff (`PEDIGREE`). The search then drops anyone over the chair's budget, so a winner's assistants are harder
         to hire, not easier.
      3. **A birth needs a chain of rare events:**
         - a 3-season link;
         - a root at .550 or better over 5 seasons;
         - two established disciples running clubs side by side for 2 seasons.

         With so few births per league, every tree number swings with the world. The live-tree count is now read in
         seasons 9–16 (0.2.24), because a new league starts with no trees and the early seasons only dragged the
         mean; that measure stays.

      **The solution:** model pedigree as demand, not only price.
      - Head-coach and coordinator searches lean toward men who served 3+ seasons under a head coach who is a winner
        (`winnerAsOf`), from the moment he is one, before any tree exists.
      - The price premium follows that demand, so owners pay for pedigree rather than being priced out of it.

      Calibrate against §4.6 so live trees sit mid-band (about 3 a league) on every world.

      **Done when:**
      - Across 8 worlds, every tree number in `npm run careers` sits inside its band with at least 10% of the band's
        width to spare at each edge, and births vary less between worlds.
      - `npm run offseason` keeps the coaching ledger steady (growth and decline ×1.00).
      - Head-coach turnover stays near 7 a year.
      - `npm run trades` doesn't move.
      - No band is widened to get there.

      **Done (0.2.25,** `docs/superpowers/specs/2026-10-30-coach-character-design.md`**):** coaches got character (ambition,
      loyalty, adaptability, discipline) and a say in their careers; pedigree pulls in searches, the strongest pull
      winning; a tree is born as a winner's second man is established in charge, at any time, from a .600 winner. 8-world
      means, main → now: live trees 2.19 → 2.97, head coaches in a tree 0.17 → 0.21, hires from a tree 0.12 → 0.22, biggest
      4.08 → 3.61, born 2.63 → 2.50 (6 of 8 worlds at 3), founding trees alive in every world; head-coach changes 7.2 a
      year, year-to-year win correlation 0.335. The price premium stayed as it was: the budget wasn't what kept a winner's
      men out (they were outscored).

      **Front offices (0.2.36,** `docs/superpowers/specs/2026-11-01-front-offices-design.md`**):** a good team didn't
      stay good, so few coaches lasted as winners. Now good veterans find a club by camp (the late market and the last
      call); a GM plans next year's cap before he borrows, restructures only players he plans to keep (for his own and
      for a free agent he wants), contends or rebuilds by his win-now; the tag goes to a star the club values near its
      price. The upgrade cut was tried and dropped (it put the median club's dead money past 6%). Four 16-season
      leagues: live trees 3.1, head coaches in a tree 0.24, hires from a tree 0.23, born 3.3; record carryover 0.30 a
      season on, 0.01 three on (NFL 0.34 and 0.18). **Left:** three-season carryover; owners' spending; contenders
      selling their stars (a trade-AI question); dead money from trading restructured players.

## Follow-up: what the locker-room work left (0.3.10)

- [x] **Letters about meetings held before you arrived.** **Fixed (0.4.2):** a GM appointment keeps the step it began
      (`GmAppointment.clock`), and `heldLetters` in `meetings/mail.ts` files only meetings held after it. The ids keep
      no club: every letter now comes from your own time at a club, so they can't collide, and a new id would have
      re-filed every meeting letter already in the inbox.
- [ ] **Spark and Anchor tags read the truth.** The tags come from `soundOf`, which reads true hidden traits, so a tag
      can disagree with the personality our scouts show beside it. The L3 spec allows the tags; whether to gate them
      on our read (as L1's "warns" line does) is the owner's call (`ui/screens/LockerRoom.tsx`, `roomFacts.chemFact`).
- [ ] **All-22 stage tests pass only on their own world.** **Partly fixed (0.4.2).** Run on worlds stage-b, c and d,
      `src/ui/stage/stage.test.ts` failed six tests. The four drawing bugs are fixed: a lost fumble's quarterback stood
      where the defense landed on the ball; a sack's beaten blocker never lost (a play-action back faking away from his
      rusher, a lineman tracking his man to the quarterback); a receiver slid past the sideline to a ball thrown out of
      bounds; a jump-cutter's broken tackle never showed on a short carry. Left: the bounce habit's width is measured on
      runs that go wide anyway (0.96–1.27 across worlds against 1.2), and the line a second in (one lineman at 4.04
      yards against 4 on stage-b; 0.979 engaged against 0.98 on stage-d).