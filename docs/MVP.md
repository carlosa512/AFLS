# AFLS MVP

Alpha means every item below works end to end. Status was read off the code on 2026-10-20, at version 0.1.0.
Each MVP item finished from here bumps the middle version number (`docs/VERSIONING.md`).

**Score: 13 Done · 2 Partial · 0 Missing.**

## The season

- [x] **1. 32 fictional teams, schedule, standings, playoffs, a champion** · **Done**: real markets with original
      nicknames, the NFL's 17-game formula (`season/schedule.ts`), tiebreakers (`season/standings.ts`) and a
      14-team bracket to a champion (`season/playoffs.ts`).
- [x] **2. Match engine with box scores** · **Done**: a play-by-play engine (`match/gameSim.ts`) with box scores and
      a replay viewer (`BoxScore.tsx`, `GameViewer.tsx`).
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
- [ ] **11. Coaches (HC, OC, DC) whose ratings affect results** · **Partial**: their ratings (youth, veterans) drive
      development and aging. Their styles, schemes and evolving quirks affect game decisions and specific execution
      windows, with player fit, career history and staff reports (`docs/COACH_QUIRKS.md`). HC/OC/DC numeric ratings
      still do not directly supply a general game-day quality edge; the special teams coordinator has one
      (`specialTeamsEdge`).
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
- [ ] **Morale and holdouts** · **Partial** (hooks into #6 and #8): every rostered player has a mood (0.2.21,
      `morale.ts`): a weekly target from his contract against his market, the role he plays against the one he expects
      (a depth man accepts depth), his team's results and his locker room, around a resting level his makeup sets,
      with fading jolts for big moments (a benching, a raise, the C, a friend cut). Your players' moods show as
      smileys on the Roster and the Locker Room's morale board, a pill on the card, and in the head coach's locker
      room report; `npm run morale` holds the league's moods to range. No effect on play yet: players speaking up and
      promises (G3), effects on practice, play and talks (G2), and hold-ins, holdouts and trade requests (G4) are to
      come. Spec: `docs/superpowers/specs/2026-10-29-morale-core-design.md`.
- [x] **Schedule weather forecasts (fog of war)** · **Already in** (hooks into #5): forecasts at three stages with
      calibrated rain chances on the schedule and the next-game card (`forecast` in `weather.ts`). Trend arrows and a
      staff hook are not built yet (`docs/WEATHER.md`).

## Not in the shipped game

- **A real-world start file** (real players and rosters), for legal reasons. If this is ever revisited, the usual
  route is letting the community make roster mods.


## Follow-up: rate-stat qualification

- [ ] Use shared, scope-aware minimum opportunities for rate leaders (passer rating, completion percentage,
      yards/attempt and similar categories), based on team games rather than a backup's own appearances.
      Apply the same eligibility to widgets, sorted league tables, season/career leaders and awards; show the
      minimum clearly without hiding a player's actual statistics. Verify early-season and partial-season
      samples, traded players and postseason scopes. A 2-for-2 passer must not lead a season rate category.
      Current Stats sorting already has a per-player-GP qualification; that is an incomplete foundation.
