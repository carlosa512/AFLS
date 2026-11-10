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
      narrative arcs remain future work. The head coach's weekly letter now tells your club's storylines from a story
      store (`stories.ts`) whose outlet seam lets a public outlet read the beats a league would know, so SNN stories
      and season arcs have somewhere to start. See `docs/NEWS.md`.
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
- [x] **Out of bounds as the player's choice, not a flat roll (0.4.4).** The flat `pOut` is gone: out of bounds is
      pushed out (where he is across the field, how far he got, who's chasing: pursuit, tackling, the edge setter,
      `alleyCrusher`, `scraper`, `businessDecision`, `thumper`) or stepped out (the clock, a lead, the first-down marker,
      the room and the hit coming, his habits, build, condition and injury history, poise), one call from the play in
      every game (`match/sideline.ts`), fitted to nflverse 2021–25 by bucket (`npm run sideline`, also judged in
      `npm run sim`: sideline 27.6% against the middle's 3.7%, outside runs of 20+ yards 44%, scramblers stepping out
      21%; the spread between players as the NFL's). A man who steps out takes no hit and no fumble; the man who forced
      him is credited as the NFL's scorers do. The clock stops until the ball is spotted outside the late windows too (4
      s back a catch). On film a man pushed out is run down by his escort: over 40 games with the field on, nobody
      alone among 376 pushed out (0.4.2: 11 of 561 catches alone) and 2 of 77 normal-play step-outs. Spec:
      `docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md`.

## Follow-up: the pocket's blocker blame (0.4.3)

- [x] **Blame for a sack follows the engine's own man (0.4.3, #150).** The pocket anchored to a second draw at today's
      odds, so a third of the sacks today charged were charged to nobody, and within a spot it lost the matchup; parity's
      "a blocker's sacks allowed on his protection, spatial ÷ today" was 0.27 (0.55 on 0.4.2 with twice the games). It now
      reads today's own draws off a copy of the credit stream (`creditDraws`) and loses that man (`FieldFacts.bb`); a tight
      end or back today charges stays in to block. Parity's line 1.000; AI games take the same draws.

## Follow-up: choices and situations, not flat odds (audit 0.4.2)

The goal: games that play like the NFL's because the people in them choose, with the odds coming out of those choices
and the situation (down, distance, clock, score, who's near), calibrated against NGS, nflverse and charting data. An
audit of `match/gameSim.ts` found these rolls that ignore what should drive them (lines as of 0.4.4). Out of bounds on a
catch or run is the item above.

- [x] **High: the passer under pressure (0.4.5).** The flat scramble, throwaway and escape rolls are gone: after his read
      (depth, target, separation) the passer chooses to throw it, throw it away or take off (`match/pocketChoice.ts`),
      under pressure or from a clean pocket when he's covered, leaned by the down (3rd for the sticks, 4th under
      pressure he throws it up), the red zone, his own end, the clock late, his decisions, legs, pocket presence, poise,
      health and habits (a gunslinger throws it away a third as often). A throwaway comes from inside the pocket or after
      rolling out, and can be flagged: intentional grounding (loss of down, 10 yards or the spot, a safety from the end
      zone). Fitted to FTN charting and NGS pressure 2023–25 by bucket (`npm run passer`, also judged in `npm run sim`):
      pressured 7.4% scrambles and 9.4% thrown away (NFL 7.6, 9.1), clean 4.3% and 1.1% (4.3, 1.2), grounding 0.19 a
      game (0.19), the spread between passers as the NFL's. On film a clean throwaway, a roll-out and a grounded ball;
      a man stepping out in normal play now paces himself for his escort (parity: 0 of 272 alone over 160 games).
      Spec: `docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md`.
- [x] **High: fumbles on contact (0.4.6).** A tackle in bounds on a run, a catch or a scramble (scramblers fumble now)
      reads the hit (the tackler's tackling, his size against the carrier's, Thumper and Arm Tackler), the carrier
      (ball security, fatigue, Loose Carriage, High Knee, Contact Averse), the fight for yards (3rd and 4th down,
      trailing late, Finishes Forward) and a defense going for the ball (Ball Stripper, ahead late it needs it back,
      and a back covers it up), then whether a defender forced it: half of run fumbles, nearly all of catches' and
      scrambles' (`match/fumbleOdds.ts`). The play names why (stripped, jarred loose by the hit, fighting for the extra
      yard, puts it on the ground), only a forced one credits a forced fumble, and the film shows it: a strip from
      behind, a hit from the front, a second man on a back fighting forward. Fitted to nflverse 2021–25 by bucket
      (`npm run fumbles`, also judged in `npm run sim`): over 20 seasons runs 1.63 a hundred (NFL 1.46), catches 1.26
      (1.31), forced 0.50 and 0.95 (0.50, 0.95), fumbles lost 0.42 a game. Ball security reads against a man's position
      (a quarterback's sneak is no riskier for his position's ratings) and backs differ as the NFL's do, luck taken
      out on both sides (0.0095 against 0.0117). Spec:
      `docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md`.
- [x] **Medium-High: a play's time (0.4.11).** A play takes the NFL's time for what happened (`match/playTime.ts`):
      an incompletion 4.0 seconds behind the line to 5.7 deep (it was 5–8 whatever the depth, so two-minute drills
      gain a snap), a catch or a run longer the farther it goes (a 40-yard catch-and-run about 8–9 seconds), out of
      bounds the trip to the sideline, a returned punt 10.9, a fair catch 6.9, a kickoff run back 5.7; the field still
      times your games' runs and catches, held to the same table (`npm run parity`). The half's last possession
      (the owner, Nov 7): with 75 seconds or less the drive decides once, at the NFL's rate by the clock, timeouts and
      spot (kneel 64% at 20 seconds or less, 9% at 21–40, never past midfield), the head coach's appetite leaning it; a
      team that tries from deep plays it safe until its own 35 and scores as the NFL's do (21%, a touchdown 5%).
      Fitted to nflverse 2021–25 (`npm run situations`, also judged in `npm run sim`); the time between snaps and the
      spot's pause refit to hold plays a game (61.7) and the clock after a man goes out. Spec:
      `docs/superpowers/specs/2026-11-07-a-plays-time-design.md`.
- [x] **Medium-High: after an interception (0.4.8).** Who picks it off reads the throw's depth (`match/defendedPass.ts`):
      the cover man first, else a group the depth points to and a man of it by his ball skills (to the fourth: the ball
      hawk gets his group's picks); a lineman only at the line, a ball tipped up (the pick changes hands there). Deep
      the safeties have over half (0.53, NFL 0.535), a jumped short route is a linebacker's three times in ten (0.30,
      0.309). The return by depth (`match/returnBands.ts`, shared with fumbles): pick-sixes 0.17 on 0–9 yards (NFL
      0.184), 0.06 on 10–19 (0.043), none deep (0.005). Fitted to nflverse 2021–25 (`npm run picks`, also judged in `npm
      run sim`); over 20 seasons the leaders' #1 picks 8.0 a season. Spec:
      `docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md`.
- [x] **Medium: fumble recoveries (0.4.7).** Who gets a loose ball reads how it came out (`match/looseBall.ts`): a ball
      a defender punched out goes the defense's way about 55–60% of the time, one the carrier lost himself about a
      quarter (NFL 0.60 and 0.25 on runs). The man credited is the one who forced it about one time in eight, else the
      group the play puts near the ball (a catch's among the DBs, a strip-sack's among the linemen), and his return is
      his group's: a safety picks it up and runs, a tackle falls on it, and most long returns go the distance. Fitted
      to nflverse 2021–25 (`npm run fumbles`, also judged in `npm run sim`): lost per 100 runs 0.61 (NFL 0.65),
      catches 0.60 (0.67), fumbles lost 0.41 a game. Spec: `docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md`.
- [x] **Medium: a sack's yards and strip (0.4.10).** The strip (0.4.7) reads the rusher's spot, his hit, the
      quarterback's ball security and the down (`sackStripOdds`). The yards come from the NFL's shape (`match/dropbackEnd.ts`):
      no loss on 7% of sacks, 10+ on 19%, 15+ on 2%, deeper on passing downs and against a blitz, shorter after he'd
      left the pocket (23% of sacks, 5.2 yards against 6.9 in it) and backed up near his own goal; pocket presence and
      Muddy Pockets lean it. Fitted to nflverse and FTN 2021–25 (`npm run dropback`, also judged in `npm run sim`). On
      film an escaped sack is run down on the move. Spec: `docs/superpowers/specs/2026-11-07-dropback-endings-design.md`.
- [x] **Medium: a scramble's slide (0.4.10).** The scrambler who stays in bounds slides or fights for it: 40% of the
      league's slide (the owner's call: no data records slides), more with the first down in hand (55%), protecting a
      lead late or a hitter closing, a concussion history or a cool head; fewer short of the sticks on 3rd and 4th
      (17%), trailing late, a runner's legs or Gunslinger. The man who touches him down has the tackle (93% of in-bounds
      scrambles credit one, the NFL's 93.2%), and scramble fumbles count slides as the NFL does (1.72 a hundred against
      1.75). The play says why ("slides with the first down in hand", "to keep the clock running", "to avoid the hit",
      "fights for every yard"), and why a man went out of bounds ("steps out of bounds to stop the clock", "gets out of
      bounds before the hit"), and the film shows it.
- [x] **Medium: the two-point try (0.4.11).** A real snap from the 2 by the side that scored (`match/twoPoint.ts`): the
      play-caller runs or throws (28% runs, more with a quarterback who runs), the defense lines up for the goal line,
      and runs are good 56%, passes 44% (the NFL's); nothing is booked, as the NFL keeps conversions apart, the play
      names its men and your film shows it. When to go is today's NFL: certain down 10, 5 or 2 and up 1 or 5 late; the
      judgment calls at the NFL's odds (down 8 or 9 late about 40%, down 1 in the last minute 39%, up or down 5 before
      the 4th about 40%), leaned by the head coach. A turnover on a try can come back for two.
- [x] **Low:** pass breakups credited on a flat 30% of incompletions (L3428); return touchdowns as small edge-scaled rates.
      **Partial (0.4.8):** breakups by depth, throwaways left out (0.45 behind the line to 0.29 deep, NFL FTN 2022–25),
      credited as the NFL's by depth (the line, a ball batted down at the line and drawn there on film, 0.54 of a
      screen's, 0.16 at 0–9, 0.04 at 10–19, 0.01 deep). **Done (0.4.11):** a return is drawn whole from the NFL's shape
      (`match/returns.ts`; kickoffs on the 2025 rules, 40+ 4.2%; punts, 20+ 8%), leaned by the returner (mostly in the
      tail, held to the NFL's spread between returners), the coverage unit, the coaches and the punter; a touchdown is
      the return that reaches the end zone.

Read and fine: completion and interception odds, pressure and sack odds, penalties (crew- and player-scaled), kicks.
Measured on the field (0.4.2): a man going out of bounds slips past defenders no more often than a man who's tackled
does (3+ within reach and untouched: 28% against 31%), so the crowd isn't a separate gap.

## Follow-up: rate-stat qualification

- [x] Use shared, scope-aware minimum opportunities for rate leaders (passer rating, completion percentage,
      yards/attempt and similar categories), based on team games rather than a backup's own appearances.
      Apply the same eligibility to widgets, sorted league tables, season/career leaders and awards; show the
      minimum clearly without hiding a player's actual statistics. Verify early-season and partial-season
      samples, traded players and postseason scopes. A 2-for-2 passer must not lead a season rate category.
      Current Stats sorting already has a per-player-GP qualification; that is an incomplete foundation.
      **Done (0.4.16):** one table of minimums (`qualify.ts`: the NFL's per team game and career for passing, rushing and
      receiving; the game's own for kicking, punting and returns), read by the Leaders and Records boards (six new rate
      boards), the Stats table's rate sorts, the awards (passer rating counts once he qualifies: no 200-attempt cliff,
      weekly and monthly honors too) and the rookie report. Spec:
      `docs/superpowers/specs/2026-11-08-rate-stat-qualification-design.md`.

## Follow-up: what the speed pass left (0.2.41)

- [x] **Free agency re-reads every free agent each day.** Each club's scouting read, injury risk, character and habits
      for each free agent are worked out again on every free-agency day and both late passes (7–9 times an
      offseason), though most don't change between days: 10–15% of a multi-season league. A club's win-now lean does
      change as it signs, so a cache must key on what each read uses, proven by an unchanged league fingerprint.
      **Done (0.4.15):** each club's read is kept across the passes, stamped with what it uses (`offseason/faReads.ts`),
      the win-now lean laid on fresh; an offseason plays byte for byte as before, and four seasons run 69 s → 63 s (free
      agency 17 s → 11 s).
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
- [ ] **The free-agency market runs about half the NFL's size** (0.4.13, `npm run offseason`'s free-agency block, shown as a
      known issue): 43–74 good outside signings a year against the NFL's 84–109, 5–14 clubs with three or more against
      16–22, 38–42% of them one-year against 20%, and too few good players left with no deal (the market places nearly
      everyone). Clubs carry far more room into the window than NFL clubs (a median near 30% against 3–12%) and spend it
      refilling rosters, not on the market. Look at how much of the roster turns over each spring and the room clubs
      bring to March (`docs/research/free-agency-market.md`). Young stars are judged strictly and placed.
- [ ] **Starters leave football more as a league ages.** (0.4.13, front offices that plan: 4.9/9.0/10% at seasons 2–4 on `offseason-audit-3` before, 2.6/5.9/6.4% after; the market now places the good ones, what remains is mostly retirements and faded veterans.) About 3% of last season's starters are unsigned or retired
      at kickoff early on, 5–8% by season 6 in every world (NFL 2.1–4.0%, *nflverse* 2021–24). About half is
      retirements, half faded veterans (about 32, rated 9–10, already asking the minimum) no club has room for. It
      shows with or without restructures, so it isn't the cap squeeze; look at when starters retire and how clubs fill
      the bottom of a roster.
- [ ] **Clubs restructuring sits under the NFL's in a new league's first seasons** (about 25–38% against its 55%,
      Over the Cap) and swings 19–59% season to season. NFL clubs also restructure to extend their own players early;
      ours don't.
- [ ] **Tags spike when a big class of stars comes due at once** (0.4.13: with three in four keepers free to test the market, clubs tag more: 14, 19, 16 at seasons 2–4 on `offseason-audit-3`, against 11 and 12 before) (20 in one season, 11–13 in others, against the NFL's
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

## Follow-up: what a play's time left (0.4.11)

- [x] **A squeezed buyer's swap bid isn't repriced for the salary you keep.** **Not a gap (0.4.14):** every bid's price
      and floor count the money you keep (`worth` in `bidFor`); a swap comes in lumps, so the player that cleared the
      floor with room can clear it without. `offers.test.ts` now says so (a squeezed swap is never worth less).
- [x] **Extends Early extends men near the end.** An AI club with the habit extended a 32-year-old tight end to a
      two-year minimum deal: an "extension" that extends nothing. **Fixed (0.4.15):** an early deal must run past the
      one he has; a veteran whose offer is no longer than his years left is passed over.
- [ ] **Defensive twos run under the NFL's** (1% of tries against 3.9%): the league's tries turn it over less than the
      NFL's, so even every turnover coming back couldn't reach it.
- [x] **A two-point try counts snaps and form.** **Fixed (0.4.14):** a try wears bodies and counts nothing: no snap, no
      pass-rush rotation, and a sack on it adds nothing toward Rattled or Shaken.
- [x] **A try from deep before the half stays short on 4th down** from past its own 35. **Fixed (0.4.14):** every snap
      reads `playsSafe`, 4th down included; and a trying drive now takes its timeouts from its own 40
      (`HALF_TIMEOUTS_FROM`), where it ran out the half 50% against the NFL's 42%.
- [x] **`npm run situations` small reads.** **Fixed (0.4.14):** a return touchdown a flag called back taps as none; the
      half's lines read only drives that start with 75 seconds or less, as the NFL figure does; the check plays 3,000
      games by default. Left as it is: the punt table's negative returns floored at 0 (a return is never a loss).
- [ ] **The trades check's draft lines sit near their floors on some worlds.** Deals with a future pick in them ran
      2.3 a draft on the old default world after 0.4.11 reshuffled its seasons (2.9 and 3.7 on two others; main 3.4–4.0),
      with no path from the change to draft trades: the check moved to world `alt` (the owner's call). Worth a look
      whether draft-day future picks run thin.
- [x] **All-22's strip-sack at the line** showed the quarterback about half a yard past it at the hit. **Fixed
      (0.4.14):** a strip-sack's ball comes out at the sack's spot (`loosen` in `ballPath.ts`), so the carry never runs him
      past it; `stage.test.ts`'s allowance is gone.

## Follow-up: what the locker-room work left (0.3.10)

- [x] **Letters about meetings held before you arrived.** **Fixed (0.4.2):** a GM appointment keeps the step it began
      (`GmAppointment.clock`), and `heldLetters` in `meetings/mail.ts` files only meetings held after it. The ids keep
      no club: every letter now comes from your own time at a club, so they can't collide, and a new id would have
      re-filed every meeting letter already in the inbox.
- [x] **Spark and Anchor tags read the truth.** **Closed (0.4.14):** the Locker Room shows only your own room, and a
      club reads its own men exactly (`knowledge` is 1), so a tag gated on our read would show what it shows now: no
      fog of war is crossed. A tag and the personality beside it can still differ: two labels with their own cut-offs
      over the same makeup.
- [x] **A defender set in the offensive backfield before the snap.** In your games (the spatial pocket), a linebacker
      showing blitz or a corner showing press walked up as far as three yards into the offense's backfield, then ran to
      his spot as the ball was snapped. **Fixed (0.4.17):** the moments before the snap read the line from the play
      (`StagedPlay.line`), not the ball's first frame, which the pocket's film starts in the passer's hands; the huddles,
      the crew's spots and the ball the umpire spots read it too.
- [x] **Two backs on one spot.** A formation with two backs put both on the same spot (about one line-up in 1,600, on
      every world tried). **Fixed (0.4.17):** the second back is the fullback in front of the tailback, or from the gun
      the other side of the quarterback (`FIELD_VERSION` 15).
- [x] **A sacked quarterback walked to the spot with the rusher on his back.** The sack's last leg carried him from his
      pocket to the spot, however far: on a 0-yard sack he climbed nine yards back to the line into a rusher who never
      got past his blocker, and on long ones the two went up to 9.5 yards together. **Fixed (0.4.17):** he reaches the
      spot in his pocket (up into the rush, or drifting back from it) and the last leg is the stagger (`SACK_STAGGER`);
      a beaten blocker trails his man from behind, never between him and the quarterback (`BEHIND_HIS_MAN`).
- [ ] **All-22 stage tests pass only on their own world.** **Partly fixed (0.4.2; 0.4.17: worlds b and d pass all, c all but the bounce below).** Run on worlds stage-b, c and d,
      `src/ui/stage/stage.test.ts` failed six tests. The four drawing bugs are fixed: a lost fumble's quarterback stood
      where the defense landed on the ball; a sack's beaten blocker never lost (a play-action back faking away from his
      rusher, a lineman tracking his man to the quarterback); a receiver slid past the sideline to a ball thrown out of
      bounds; a jump-cutter's broken tackle never showed on a short carry. Left: the bounce habit's width is measured on
      runs that go wide anyway (now 1.11 on stage-b against 1.2: its sweeps to the sideline leave little room). The
      line a second in is fixed (0.4.5): on zone a spare lineman doubled the nearest man even on his backside while the
      whole line stepped play-side; he now doubles a man on his play side (stage-d 0.979 to 0.985, stage 0.983). A beaten blocker now sets before he turns and chases
      his man (he stood frozen at the snap on a quick pressure).