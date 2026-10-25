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
