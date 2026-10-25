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
      (`offseason/draft.ts`). Prospect ratings stay fuzzy ranges until scouted (`scouting.ts`, visits).
- [x] **10. Trades with AI teams** · **Done**: one judge for every deal, with pick charts, contract value and seller
      floors (`trade/judge.ts`, `value.ts`). `npm run trades` fails on lopsided deals and exploit probes.
- [ ] **11. Coaches (HC, OC, DC) whose ratings affect results** · **Partial**: their ratings (youth, veterans) drive
      development and aging. Their styles, schemes and evolving quirks affect game decisions and specific execution
      windows, with player fit, career history and staff reports (`docs/COACH_QUIRKS.md`). HC/OC/DC numeric ratings
      still do not directly supply a general game-day quality edge; the special teams coordinator has one
      (`specialTeamsEdge`).
- [ ] **12. AI teams that manage their rosters sensibly** · **Partial**: AI front offices draft, sign, cut, trade and
      stay cap-legal (`offseason/ai.ts`), keeping a cap reserve for the season by their GM's cap style. One known
      issue is flagged by `npm run offseason`: some teams start a season short of 53.

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
- [ ] **Full news and media outlets** · **Partial** (hooks into #13): SNN division headlines, Arena Gazette
      trajectory features and rookie impact reports join the inbox; broader coverage and narrative arcs remain
      future work. See `docs/NEWS.md`.
- [x] **Staff avatars and the women staff flag** · **Already in** (hooks into #11): drawn staff avatars
      (`staffAvatar.tsx`, `docs/AVATARS.md`). Scouts and medics can be women (`woman`, drawn with the name in
      `identity.ts`), but coaches never are.
- [x] **Void years** · **Already in** (hooks into #7): proration parked in void years, accelerating as dead money
      when the deal voids (`finance/contract.ts`).
- [ ] **Deep scouting network** · **Partial** (hooks into #9): scouting departments with ratings, budgets and a
      market (`staff.ts`) and per-scout reads (`readFor`). No regional network yet.
- [ ] **Owner and job security** · **Partial** (hooks into #11 and #12): owners have market budgets, patience and a
      yearly letter, and AI head coaches get fired from the hot seat (`coaching.ts`). Your own job is never at risk.
- [x] **Schedule weather forecasts (fog of war)** · **Already in** (hooks into #5): forecasts at three stages with
      calibrated rain chances on the schedule and the next-game card (`forecast` in `weather.ts`). Trend arrows and a
      staff hook are not built yet (`docs/WEATHER.md`).

## Not in the shipped game

- **A real-world start file** (real players and rosters), for legal reasons. If this is ever revisited, the usual
  route is letting the community make roster mods.
