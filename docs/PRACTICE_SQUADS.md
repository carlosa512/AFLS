# Practice squads and personnel rules

## Status

Steps 1–5 are in: service time, waivers, practice squad formation and pay, one-game call-ups, game-day active
lists, and poaching with two weekly protections. They run only in careers created with `createLeague({ personnel: true })`; ordinary careers stay off until
step 6 (the yearly lifecycle) and step 7 (activation) ship. Save version 47 adds
the `afls-2026-v1` profile, switched off; 48 adds the poaching state. The seven-step plan is `superpowers/plans/2026-10-25-practice-squads.md`.

On 2026-10-26 the rules were trimmed for play (`superpowers/specs/2026-10-26-personnel-trim-design.md`): one
service counter instead of three CBA credits, weekly settle points instead of an Eastern-minute clock, plain
call-up pay, no injury pay continuation, one release per claim. What follows describes the trimmed rules.

## Design authority

Fun and low micromanagement come first when two designs are plausible. NFL rules are the foundation; AFLS
departures are labeled. Each save stores its profile id: a later rule change introduces a new profile instead of
rewriting existing careers.

Protection is an AFLS house rule: two players a week, chosen automatically by the scouts' estimated ceiling, with
optional pins and a weekly lock so it can't cycle through the squad. The same rule applies to every club.

## Rules: profile afls-2026-v1

| Rule | What it does | Authority |
| --- | --- | --- |
| Lists | `teamPlayers` is everyone employed, IR and squad included; never use it for the 53. `rosterList` gives active, IR, practice squad, squad injured, waivers, unattached or retired. `activeRoster` is the 53 (IR and squad excluded) | AFLS query contract |
| Match eligibility | A squad member plays only when called up for that game. Charts, special teams, returners and injury fallbacks never pick one up otherwise | AFLS |
| Service | One counter: completed seasons with six or more regular-season games on the 53, called up, or on IR. Squad weeks, byes and playoff games earn nothing; a week counts once. `PlayerService` is `[through, seasons, weeks]`, seeded from calendar experience | NFL accrued season, simplified |
| Squad places | 16. Players with no seasons of service take a standard spot; one or two seasons use the 10 special slots; three or more makes a veteran, at most 6 | NFL eligibility categories, simplified to the counter |
| Squad pay | Weekly, separate from an NFL contract: the CBA's rates through 2030 (2026: $13,750 standard, $18,350–$22,850 veterans), then scaled with the cap. No bonuses, no guaranteed weeks. A signing commits the current week's check | CBA table; AFLS accounting |
| Squad injuries | An injured squad member keeps his weekly check and his place, and can't be released until cleared | AFLS |
| Promotion | A free place on the 53, medical clearance and cap room: a new one-year minimum contract for his seasons of service. This week's squad check is credited | NFL; AFLS accounting |
| Veteran exception | Four completed seasons of service skip waivers before the trade deadline. After the deadline week (`TRADE_DEADLINE_WEEK`), in the playoffs and after, every release goes on waivers | CBA Article 29 |
| Waiver priority | Through week 3, the original first-round order (by `originalTeamId`); after, worst record, then strength of schedule, then original order. A winner keeps its place | NFL; AFLS tie rule |
| Settle points | Waivers settle once a week, before its first kickoff (Thursday included), and at each offseason step until the wire is empty. A release after the week's first kickoff waits for next week. Entries carry a batch number; a settle resolves every batch before it, and cuts its awards cause join the next one | AFLS (replaces NFL daily 4 PM notices) |
| Pending contract | On waivers a player keeps his exact contract and can't negotiate, sign, be traded or play. The old club's worst-case release cost is held until the claim settles | Contract-preserving waiver design |
| Claims | You rank your claims and may name one player to release if the claim wins, optionally inviting him back to the squad. AI clubs may also group alternatives. Opposing claims stay private | AFLS |
| Call-ups | Two per club per game; three regular-season uses per player per club, playoffs unlimited. Planned any time before the game; filed when the game is prepared (AI clubs plan theirs then); back on the squad when the result is recorded. Cancel any time before it's filed. No 53 place, no NFL contract | NFL elevation rules, AFLS timing |
| Call-up pay | Regular season: the NFL minimum for his seasons of service, one game's eighteenth, replacing that week's squad check. Playoffs: no cap charge. A same-week promotion absorbs the check | CBA minimum table; AFLS simplification |
| Re-sign block | Leaving and rejoining the same club after a filed call-up blocks further call-ups there that year | Original CBA wording |
| Game-day list | 47 active, or 48 with eight primary-position linemen. Staff choose automatically; you can change it. It locks when the game is prepared | NFL |
| Emergency QB | A healthy QB on the 53, outside the active list, with exactly two QBs active. Enters only when both are out | NFL |
| Protection | Two squad players a club a week: "Always protect" pins first (at most two), then the club's own best estimated ceilings (`perceive(...).potMid`, never `potential`). Locked at the week's settle; later pin changes wait a week; a protected player who leaves leaves his slot empty until then | AFLS house rule |
| Poaching | Any club can sign another club's unprotected squad player to its 53: a minimum deal for his service, one or two years. He always accepts. Regular season only; not from the club you play this week; needs an open place on the 53 and cap room, rechecked at the settle. Two offers: the longer deal, then waiver priority. A planned call-up is cancelled | NFL shape, AFLS timing |
| Poaching cost | Three weeks of base guaranteed on the new deal; cut early and the rest is dead money. No roster-count obligation | AFLS trim of the NFL's three checks and three roster games |
| AI poaching | Where an AI club picks injury cover, an unprotected squad player elsewhere who reads a point better than the free agent it would sign; his place on the 53 is held until the settle. At the settle, a club still short makes the same call. One offer a club a week, above its in-season reserve, never a cut. Target 0.5–3 a club a season (an AFLS estimate; no public NFL count) | AFLS |
| Losing a player | One mail from your head coach when a club signs your squad player | AFLS |
