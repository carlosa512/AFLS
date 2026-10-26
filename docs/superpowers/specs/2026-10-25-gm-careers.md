# GM careers and employment

## Agreed scope

The player remains the same GM in the same league after dismissal, seeks another job, or sits out
while watching and simulating the league. GM cards and SVG character icons follow the existing
staff design. Identity, portraits, scouting history and management tendencies follow the person.

New GM entrants come from scouting directors. College and pro scouts can become directors; the
pipeline must use actual people rather than create a replacement GM out of nothing. Opening-world
incumbents are the exception: their pre-save careers are unknown.

Offseason hires are permanent. Interim appointments are available only for a midseason hire,
through that season. A permanent appointment requires a separate offseason offer; advancing the
calendar never silently converts an interim.

Ownership evaluates GM and coach accountability together. Owners can back both, warn, require a
coaching change, retain a coach while firing the GM, or replace both. An owner-protected coach is
already contracted through the promised period before a GM can act; player and AI moves must obey
the same protection and budget consequences.

Midseason dismissals and internal promotions are in scope. Recruitment of another team's employed
staff is blocked during the season, including promotions. Unemployed candidates remain eligible.
Leadership changes require coverage for the roles vacated by promotions. The offseason resolves
interims and permits permanent searches and staff changes.

The GM market should usually have several vacancies, with occasional quiet years. There is no
forced annual minimum or guaranteed offer to the player. Hiring rounds must give the player a
chance to act before every AI vacancy is resolved.

## Delivery order

1. Persistent GM identities, appointments, director pipeline, accurate service records and migration.
2. GM cards, links, SVG appearances and career overview.
3. Owner mandates, protected coach contracts and shared staffing restrictions.
4. Coordinated leadership reviews and midseason succession.
5. Offseason hiring rounds, interim reviews and staff transitions.
6. Player employment transitions and organization-specific permissions and scouting.
7. Unemployment navigation, league spectating and simulation stops.
8. Long-run tenure, vacancy, staff economy and gameplay calibration.

## Phase 1 implemented foundation

`League.gms` holds permanent identities, including the user (`userGmId`); `Team.gmId` points to the
incumbent. To preserve existing AI readers without storing tendencies twice, an employed GM's
tendencies remain in `Team.gm`. On departure they move onto the GM's file; the next appointment
moves them into the new club. `gmTraits` resolves either location after a plain JSON round trip.
The vacant club receives neutral caretaker tendencies until succession is resolved.

Appointments store observed start/end dates, interim status, contract end year and departure
reason. Opening names use an isolated RNG stream. GM ageing consumes no randomness. Appointing a
director preserves the source scouting record and appearance key, removes them from the scouting
department and market, and charges no dismissal severance. Scouts can be promoted into their own
vacant director chair during the hiring window, with contract and budget checks.

`Game.management` captures GM IDs and coach roles when play begins, including live games. Result
recording credits career aggregates once, in the roles held at kickoff. Those aggregates survive
job changes, retirement and game-log pruning. A coach can have separate role rows in one season;
playoff trips and titles are counted once per season. A departed employee receives no successor's
championship credit. The temporary snapshot is removed once credited, avoiding duplicated data on
every completed game. UI record tables support partial seasons and multiple roles.

Save version 41 introduces the model. The legacy user always managed one franchise, so its known
completed history is retained. The current season can be backfilled from retained games: legacy
staff moves were offseason-only. Historical AI GMs cannot be identified from team tendencies and
receive no invented past record. Previously recorded coach seasons retain the history fallback.

Phase 1 exposes engine functions only. It does not enable automatic GM dismissals, search or
employment UI, owner protection, or unemployment/spectator controls. An expired contract
does not yet trigger a carousel decision; that belongs to the review and hiring slices.

## Phase 2: cards, portraits and career overview

The Front Office's GMs tab contains the user's career overview and a sortable directory of all
persistent GMs, with employment filters for active, unemployed and retired people. Names open the
same staff-style card from the home, roster, cap and trade screens, and names in linked text resolve
to the person's GM record. The card shows employment and contract status, recorded GM seasons,
actual career results, appointments and departure reasons, head coaches whose service overlapped,
and the scouting appointments preserved when a director becomes a GM. Opening incumbents' dates
are labelled as recorded history rather than inferred hiring dates. The player is not assigned
their unused AI management tendencies.

GM SVG portraits reuse the existing staff renderer. Every GM wears a suit, preserving the head,
hair and body profile already established for that person. A promoted scouting director retains their appearance key, silhouette and hair; team
colours change with employment and unemployed/retired portraits use the market palette. The same
card handles permanent, interim, unemployed and retired states. No employment actions or automatic
turnover are added in this slice, and no save migration is needed.

Validate with the existing UI and avatar tests plus GM presentation tests. Browser checks cover
directory navigation, sorting, employment filters, opening and closing cards, Escape and focus
restoration, coach/team links, light/dark themes and phone layouts. A supplied 2037 save provides
the real long-career example; any staged interim/unemployed examples use separate preview state.

## Validation

### Phase 3: owner promises and staffing restrictions

Owner retention reviews run when the league year opens, after staff development/retirement and before
any GM reaches the re-sign window. A seeded owner may back a head coach after a first season or clear
improvement, at 5–8 wins. Patient owners are likelier to grant the extra chance. No club must issue a
mandate, decisions do not repeat after reloading, and an extra chance cannot renew in consecutive years.
These are retention decisions only; coordinated GM/coach dismissal reviews remain phase 4.

`protectCoach` immediately signs an expired deal through the promised year (at the higher of the prior
salary or current one-year ask), or extends a live contract at its existing salary. Longer deals are
never shortened. This is an owner's spending commitment: the actual salary counts in coaching payroll,
reduces available room and does not touch the player salary cap. No player extension click is needed.

Each promise names the coach and chair, belongs to the club across GM changes, and expires at the league
year boundary after its final promised season. It blocks dismissal, replacement, internal promotion,
external promotion and a new head coach's staff clear-out. AI candidates and staffing decisions obey the
same restriction, and the low-level dismissal/promotion functions also guard it. Natural retirement
remains possible and does not transfer protection to a replacement. Interims require a separate permanent
offer before another season can be promised.

The coach card, coaching department, GM card and annual owner letter explain the reason and already
signed contract. Disabled actions retain the owner's explanation. A common recruitment rule blocks
another team's employed coaches, scouts and medics during the regular season and playoffs, including
director-to-GM promotions. Midseason firing and hiring controls themselves remain phase 4.

Save version 42 adds each club's mandate history and annual review marker. Old saves receive an empty
history, with no retroactive promise, identity change, contract change or shared-RNG consumption.

A two-season continuation of the supplied long save exercised the new calendar: 2038 had no mandates;
in 2039 Houston retained Randy Palmer after improving from 5–12 to 8–9, and Green Bay retained Elijah
Irving after a 7–10 first season. Both signed commitments survived the hiring window and full season.
All 32 GM appearance profiles matched before and after both seasons and JSON save/load boundaries.
The six-season offseason audit passed with 6.3 head-coach changes per year, within its 4.5–9.5 band.
Browser checks verified signed contracts, blocked dismissal, expiry, the preserved GM portrait and mobile
layout. Player-facing screenshots are labelled as staged examples; the Houston screenshot is an actual
AI decision from this continuation.
The relevant regression run covers 198 tests. Its four-season coaching-economy test hit the runner's
time limit while competing with the calibration workers, then passed alone with the existing timeout.
The four 16-season career leagues finished with zero results outside required target ranges. Typechecking,
the production build and formatting passed.

`npm run gm:playthrough -- --save /path/to/save.json --seasons 5 --output work/gm-playthrough`
finishes the supplied partial season once, then runs two parallel continuations from that shared
baseline with independent future RNG streams. It automates offseason roster decisions, injuries
and training, checks every incumbent's yearly GM record against league history, and verifies each
GM's suit, head, hair and body profile before and after a JSON save/load each season.

The supplied 2037 save's five full seasons (2038–2042) produced 46–39 with three playoff appearances
in Run A and 50–35 with four in Run B. Neither won a title. All 320 GM-season records matched
regular-season, playoff and title results, and all 640 appearance checks passed. There were no
over-cap kickoffs; four kickoffs had one team below 53 active players. Automatic GM reviews and
turnover are not yet enabled, and the existing contract correctly displays as due for review in
2042 rather than receiving an invented extension.

Unit tests cover identity persistence, moving tendencies, scout-to-director-to-GM continuity,
midseason no-poaching checks, interim/permanent eligibility, split-season attribution, live kickoff
snapshots, ties, duplicate-result protection, successor title credit, and idempotent legacy saves.
Use a seeded pre-change season to check that this recordkeeping foundation does not change game
results or shared RNG. Validate a supplied long-running save separately without committing it.

Run typechecking and the relevant GM, records, scouting, coaching, offseason, engine and UI tests;
use the area-specific offseason audit at a small size. Follow CLAUDE.md for CI and release checks.

## Leadership reviews, hiring and player continuity

Save version 43 adds durable leadership events, each club's latest private review, dated review markers,
and an offseason GM search. New-world AI incumbents have generated prior tenure for owner patience,
without invented historical game records. A new player GM and migrated incumbents receive no fictitious
prior tenure. All ownership and staffing decisions run on isolated seeded streams.

Reviews consider the current appointment's results, recent playoff appearances, improvement, time to
rebuild and owner patience. New hires get two complete seasons. A winning recent season or playoff trip
protects the GM. Owners can retain leadership, warn, require a different head coach, replace the GM
while retaining an already-contracted coach, or open both roles. Expired GM contracts receive an
explicit renewal or search decision. Older AI GMs can retire; the player does not silently retire.

Midseason reviews take place after weeks 8, 12 and 16. Severe current losses and a poor prior record
can lead to GM dismissal; the internal scouting director normally becomes interim GM, with an internal
scout promoted to cover the director chair. A coordinator can become interim head coach, with the
vacated roles filled from the internal staff or unemployed market. Another team's employees cannot
be recruited during the season. A club has at most one midseason GM and head-coach change per year.
Interims expire with the season and require separate permanent offseason offers. Dismissed coaches
cannot immediately be rehired by the same team in that year's replacement search.

Three offseason GM hiring rounds hold shortlisted player offers long enough to respond. Expiry or
continuing the rounds lets AI owners choose other candidates. Permanent hires come from unemployed
experienced GMs or actual scouting directors; employed GMs are not taken from another club. Scouting
appointments and portraits follow the promoted person. Vacated director roles, including retirements,
are covered by the end of hiring. The player can be passed over and sit out a season. Player offers
currently arrive in offseason rounds; midseason succession is handled internally or from the unemployed
AI candidate pool.

A persistent GM appointment grants authority; `userTeamId` retains the last viewed club for legacy
filters. While unemployed, calendar simulation temporarily routes every franchise through its normal
AI path, including the former club, and restores the viewer afterward. Job changes clear old scouting
visits, negotiations, trade offers, statuses and pending physicals; the new club supplies the scouting
budget. The unemployment home supports GM offers, league news, public rosters/stat cards and watching
any scheduled game live. Management screens are replaced by the career directory. User-facing long
simulation stops at dismissal or job offers; automated audits explicitly resolve offers and continue.

Owner mandates, exact review reasons and internal mail are visible only while managing that club.
Public GM and coach cards do not quote them. Leadership news/mail use confirmed moves and selective,
qualified reports such as a rumored prove-it season or an incoming GM expected to keep the existing
head coach. Public transaction logs contain the move only. Migration redacts old retention headlines;
club mail is scoped to its organization, while personal job offers and dismissals remain readable.

`npm run gm:ten-years -- --seasons 10 --output /path/to/work` creates one new world, selects its weakest
team by starting overall and forks two identical saves. The league seed and owner personalities stay
fixed. A separate match salt and future RNG state let results diverge. Both careers use the same AI
roster/hiring policy, accepting the first available GM offer or sitting out if none arrives. The harness
follows the person and the original franchise separately, includes the closing owner review after year
ten, reconciles every team's split GM service and championship credit, and checks portrait and director
coverage across JSON save/load boundaries. It does not force a fired/surviving pair of outcomes.

### First paired ten-year validation

Fresh seed `afls-gm-careers-new-world-2026` selected Carolina, the weakest starting roster. Both runs
played 2026–2035 and included the closing 2036 ownership review/search, without forcing either outcome.
A's player served nine seasons (48–105, one playoff trip), was dismissed in the 2035 offseason and sat
out 2035. B served six seasons (30–72, one playoff trip), was dismissed in the 2032 offseason and sat
out 2032–2035. Neither received another offer within this sample.

A had 32 actual GM changes (29 dismissals, three retirements); B had 30 (27 dismissals, three
retirements). Annual changes ranged from zero to five. Director entrants numbered 31/29; each league
also hired one experienced former GM. There were 51/63 head-coach changes across the played seasons,
including 2/8 midseason interim appointments. Neither run produced a midseason GM dismissal; that
path is covered by a targeted seeded scenario, not demonstrated at a calibrated rate by this sample.

All 5,700 games completed. Each club's split GM and head-coach service reconciled across 640
team-seasons apiece, with correct title credit. All 20 kickoffs were cap compliant. GM and scouting
director chairs were covered after searches; portrait identity and suits survived JSON reloads.
Lifecycle, privacy, inbox, owner, GM, avatar, UI and coaching regressions passed. Career, trade and
six-season offseason audits completed with zero numbers outside their existing target ranges. The
production build passed. Browser checks exercise private/public views, actual interim coaches,
unemployed viewing, read-only rosters and mobile cards. An explicitly staged offer preview exercises
acceptance; it is not counted as a playthrough result.

Before final balance, revisit the unusually patient Carolina owner in A, prolonged unemployment in B,
the dominance of director hires and the observed rarity of midseason GM dismissal. Broader seeds
should guide tuning; these two careers establish lifecycle correctness and expose the first balance
questions, rather than proving final NFL-like rates.

## Owner marble bag (calibration, delivery step 8)

The first paired run raised four questions: a patient owner kept a GM through 3–14 and 2–15, the dismissed player
never got another offer, directors took 31 of 32 jobs, and no GM was fired in season. Owners now judge through a
marble bag (`ownerBag.ts`, save version 45), the same idea as the concussion protocol and the quirk bag:

- Calm marbles are patience: 5 for the quickest trigger, 9 for the most patient (`ownerTrigger`).
- A losing season adds heat: 8–9 one marble, 6–7 wins two, 4–5 three, fewer four. The head coach owns how far the
  team fell short of its roster (talent rank sets the expectation, .750 to .250); the GM owns how far the roster he
  built sits below .500. Each side's share is 20–80%. A first season in the job counts half.
- At the offseason review the owner draws one marble per heat marble last season added (one more when the GM's
  contract is up), without replacement. A heat marble changes that person; calm marbles drawn are spent for good,
  so a losing run always ends. A playoff trip skips the draw, halves the heat and returns two calm; a winning season
  returns one and cools each side by one. New GMs keep two complete seasons of protection: until then the owner
  reviews only the head coach and spends no patience on the GM.
- In season, from week 8, a club at .300 or worse is reviewed after a loss about three times in ten: one marble,
  put back, with this season's heat so far added. A GM's marble must come out twice.
- About one permanent hire in seven goes to a former GM (NFL 2020–2025), with odds from his record rather than the
  best noisy score in a pool that grows every year. An unemployed player keeps one guaranteed offer from the weakest
  open jobs; a second is now likely.

Same seed, ten seasons each (A / B): GM dismissals 3.9 / 3.9 a year (NFL about four), in-season GM dismissals
0.5 / 0.2 a year (NFL about one every two years), interim head coaches 1.4 / 1.5 a year (NFL about two), former GMs
5 of 34 and 8 of 40 permanent hires. The player was fired twice in each run and always received at least one offer
(A: 2 and 1; B: 2, then 2): A after an 0–8 start in 2031, in season, and again at Baltimore after 4–13, 6–11, 4–13;
B after a 5–12 at Carolina in 2033 following three winning-or-.500 seasons. The six-season offseason audit stays
inside every band (6.7 new head coaches a season against 4.5–9.5; the NFL averages 7).

`npm run screens -- --save <save.json> --out <dir>` loads a save into the real app in headless Chromium and
captures the home, GM directory and cards, inbox, coaches, roster, cap, standings and phone layouts.
