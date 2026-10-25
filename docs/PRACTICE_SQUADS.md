# Practice squads and personnel rules

## Status

Steps 1–2 implement service/list foundations and the staged personnel calendar, waivers, AI claims and waiver desk. Save version 42 retains the disabled-by-default `afls-2026-v1` profile; ordinary careers are not automatically opted into an unfinished practice squad lifecycle. Enabled development careers exercise waivers; `npm run waivers -- 2` runs the reproducible AI audit. Practice squad contracts, elevations, poaching and weekly protections remain later steps. The seven-step plan is in `superpowers/plans/2026-10-25-practice-squads.md`.

## Design authority

Fun and low micromanagement take priority when choosing between plausible designs. NFL rules are the foundation; deliberate AFLS departures are labeled. Each save stores its profile ID; later changes must introduce a new profile instead of silently rewriting existing careers.

The planned AFLS protection rule is two players per management week, automatically chosen by scout-estimated ceiling. Persistent optional pins override automatic choices; the weekly lock prevents cycling protection through the squad. The same rule applies to every club. This is an authorized AFLS house rule, independent of conflicting descriptions of NFL protection. Step 1 records the choice; the protection behavior arrives in step 5.

## Implemented rule registry: profile afls-2026-v1

| Rule | Definition and examples | Authority |
| --- | --- | --- |
| Employment | `teamPlayers` includes everyone employed, including IR and squad members. It must not be used as a synonym for the 53 or game eligibility | AFLS query contract |
| List membership | `rosterList` derives active/IR from existing employer and IR records; the new discriminated `squad` record identifies practice squad or squad injured. Retired/unattached players cannot play. Squad status takes precedence over stale IR metadata, keeping contradictory imported data off the field | AFLS compatibility design |
| Ordinary 53 | `activeRoster` counts active-list members regardless of injury; excludes IR and both squad lists. No cap-obligation changes are implied by excluding a list | AFLS compatibility design |
| Practice | Healthy ordinary squad members can be queried as practice participants; squad injured and IR cannot. Integration into training/injury decisions remains step 6 | AFLS design |
| Match eligibility | Non-elevated squad members cannot be selected through charts, special teams, returner overrides or emergency hurt fallbacks. Elevation/game-day-list support arrives in step 4 | AFLS boundary invariant |
| Accrued season | Six regular-season game dates on active/inactive or IR membership. Five does not qualify; six does. Ordinary squad time and postseason games do not qualify | [CBA Article 8 §1](https://overthecap.com/collective-bargaining-agreement/article/8/section/1) |
| Salary-credited season | Three regular-season game dates on active/inactive membership, including standard elevations when implemented. IR does not count. Three roster games and no snaps still qualify | [CBA Article 26 §2](https://overthecap.com/collective-bargaining-agreement/article/26/section/2), [Article 33 §5](https://overthecap.com/collective-bargaining-agreement/article/33/section/5) |
| Pension-credited season | Three qualifying regular/postseason game dates, including IR. Two regular games plus a playoff game qualify for pension, but not a salary-credited or accrued season | [NFLPA credited-service guidance](https://nflpa.com/active-players/faq/what-is-a-credited-season-and-what-does-it-mean-to-be-vested) |
| No service from a bye | No game means no service credit. A future poaching roster obligation may count a bye; that is a different rule | Game-date service definitions above |
| No duplicate service | Regular-season credit is deduplicated by season/week and postseason pension credit by round. A repeated result or midweek trade cannot double-credit it | AFLS deterministic settlement contract |
| Historical estimates | Generated/legacy calendar experience initializes estimated prior accrued, salary and pension totals. This does not invent observed past game-day lists. Rookies start at zero without an estimated-history flag | AFLS migration policy |
| Unknown active list | Until step 4 records who dressed, observed roster membership cannot establish game-day actives. An unknown active mask makes the active count unknown, never a false zero | AFLS evidence boundary |
| Contract/trade boundary | Squad members cannot be traded or signed through ordinary FA/extension shortcuts. Later squad transactions must use their own validators | Planned transaction separation |

Accrual intentionally covers statuses supported by AFLS. PUP/NFI, holdouts, injury settlements and elevated-player salary-continuation exceptions require their relevant lifecycle implementation; they are not inferred from the current injury flags.

## Service storage and collection

`Player.service` keeps an estimated historical baseline through a named season plus observed seasonal records. The baseline and live-season records use documented named tuples to avoid repeating field labels for thousands of players in exported JSON. Game dates are compact integer bitmasks rather than arrays of roster snapshots. Separate masks track accrued, salary, pension and game-day active evidence; pension playoff dates use a separate round mask. At the new league year, completed masks are folded into one integer per season in a baseline-relative array retaining earned-service flags, active-count evidence and the incomplete-history marker. `historicalActives` and `incompleteServiceSeason` read this archive without exposing its encoding to callers. Each season can qualify at most once per definition. Calendar `experience` continues to advance as before and is not replaced in agents, salaries, aging or UI during this foundation step.

`prepareGame` snapshots active/IR membership onto the game. Completion settles that snapshot before injuries, IR management, trades or signings can change membership, and then removes it. Live-game reloads preserve the snapshot; repeated `recordResult` calls do not settle twice. For an older in-progress game without a snapshot, completion observes the available membership rather than manufacturing its missing kickoff record.

Migration adds no transactions and changes no employer, contract, rating, chart order, cap or RNG stream. A midseason legacy save marks the current service season incomplete; unobserved earlier games are not backfilled from statistical appearances. Its resulting totals can be conservative, and the incomplete marker must remain visible to future eligibility/migration logic. New draft prospects initialize at zero after their experience is reset; generated fill-ins initialize before their next experience increment or first observed game.

Queries of completed service can pass a `throughSeason` cutoff. In particular, Article 29 waiver handling examines pension service through the last completed season; earning a third game in the current season must not prematurely activate the veteran exception.

## Rules queued for later steps

| Step | Rule work before enabling |
| --- | --- |
| 3: formation/pay | Sixteen ordinary places; exact assignment across overlapping NFL eligibility categories. Weekly pay schedule and cap handling; competing offers and return intents. Qualifying international exception remains deferred |
| 4: elevations | Two per club/game; current regular/postseason usage rules, per-club history and same-club re-sign restriction; reversion, pay/service, signing lock and dressing lists. Resolve original CBA versus later amendment wording before enabling |
| 5: poaching/protection | Player choice, opponent cutoffs, three salary weeks/three roster-count games and offsets. Implement the settled two-player AFLS protection rule with no routine prompt and no cycling |
| 6: lifecycle | Practice/coaching integration, squad injured and return, injury continuation, playoff transaction permissions, expiry and reserve/futures effective dates |

Full predicates and boundary scenarios are listed in the implementation plan. Resolve disputed NFL summaries against amendments, or record a deliberate AFLS simplification under the fun-first instruction. Do not silently present a gameplay choice as an NFL requirement.

## Verification

`personnel/personnel.test.ts` covers service thresholds and distinct definitions, IR, elevations at the service layer, no squad/bye credit, duplicate dates, playoffs, estimated and incomplete history, roster/chart/lineup boundaries, contract shortcuts, migration and JSON reload. A pre-change seed fingerprint verifies unchanged generated players (apart from service metadata), RNG state, schedule, depth charts and match result. Existing affected engine suites remain part of the verification.


### Step 1 validation (2026-10-25)

- Typecheck passes. The 180 existing tests in the affected engine/finance/injury/training/offseason/trade suites passed; the final personnel suite has 23 passing tests. The 19 trade tests were rerun after the final squad boundary guards and passed again.
- Six-season offseason audit, including the four-league cap-drift check: zero out-of-range numbers. First-season save: 6,404 KB against 6,450; first year of player-data growth: 796 KB against 800. No audit bounds were changed. The existing warning about retaining retired players remains.
- Trade audit: zero out-of-range numbers.
- Ten-season simulation: one existing rushing-leader threshold failure. Running the same command against unchanged `18941d1` produces identical statistics across all 2,720 games and the same failure; only elapsed runtime differs. No tuning or threshold change is included here.
- Formatting and whitespace checks pass. Validation ran locally, not in remote CI. The `tsx` CLI cannot create its IPC socket in this sandbox, so equivalent audit entry points ran with `node --import tsx scripts/<name>.ts`.

Historical service estimates and unknown game-day-active history are explicit compatibility limits. Practice squad transactions and two automatic protections are still disabled pending their implementation steps.


## Step 2: calendar, contract assignment and AI

| Rule | Implemented behavior | Authority |
| --- | --- | --- |
| Veteran exception | Four completed pension seasons bypass waivers during the pre-deadline window; all releases use waivers after the trade deadline or in the postseason. Expired deals use normal termination. The current season cannot vest the exception early | [CBA Article 29 §1](https://overthecap.com/collective-bargaining-agreement/article/29/section/1) |
| Early claiming priority | Freeze the original first-round order using `originalTeamId`, independent of the pick owner. A world without a recorded prior draft gets a stable seeded order, with no invented standings | NFL draft-based priority; AFLS initialization fallback |
| Later priority | After Week 3, worst current record first, then current strength of schedule. Remaining ties use frozen original priority, an explicit AFLS simplification instead of the complete NFL secondary procedures. A winner never rotates to the back | [NFL important dates](https://operations.nfl.com/calendar-events/nfl-important-dates), AFLS final tie rule |
| Notice timing | A Tuesday-based football clock distinguishes Thursday/Saturday/Sunday/Monday games. Requests enter daily 4 PM ET notices with at least 24 hours of exposure. Offseason phases use compressed ordinal dates; camp begins at minus 21 days. Daily notices replace actual holiday/cutdown exceptions for this AFLS profile | NFL waiver procedure as foundation; AFLS timing simplification |
| Pending contract | The player leaves the roster, retains the exact contract and gets a waiver marker. He cannot negotiate, be signed, be traded, play or re-enter the draft through that marker. Existing draft history also prevents a cleared current-year pick being drafted twice | Contract-preserving waiver design |
| Originating liability | Reserve the worst-case release cost until the notice settles. Assignment books original bonus acceleration/already-paid salary and transfers remaining salary/guarantees; clearance books the full release once. Holds and projections use the same $K rounding as the actual ledger | Existing AFLS cap ledger and [NFL contract guidance](https://operations.nfl.com/calendar-events/nfl-free-agency/contract-language) |
| Assignment | Preserve contract kind, control, options and future salary/guarantees. Remove originating bonuses/void years; reduce current base and guarantees only by amounts already paid. Claiming does not negotiate a new deal | NFL assumption of existing contract, AFLS ledger representation |
| Claim instructions | Clubs submit ordered claims, optional alternative groups and named conditional cuts. Validate current and future cap, actual roster space, ownership and positional coverage before mutation. Revalidate after earlier wins; rejected claims never trigger their cuts | AFLS atomic transaction implementation |
| Subsequent cuts | A winning claim's cuts enter the next notice, never the resolving batch. Submitted claims remain private; the wire shows only the user's instructions and public awards/clearances | NFL notice/priority foundation, AFLS manager flow |

### Manager and game flow

The first camp advance performs camp learning/development, position changes, camp business and AI cutdowns once, then pauses at the complete league-wide wire. The manager can submit/reorder/withdraw claims and name a conditional release. The main continue action settles submitted claims and remaining notices, then opens Week 1. Processing notices individually is optional; it is not a mandatory daily chore. A user roster that is already illegal is rejected before camp/offer state changes.

Games settle due notices before kickoff. Opening a Sunday live game first simulates earlier unplayed games, so a Friday waiver award cannot rewrite Thursday's roster. Transactional game entry points (`playGame`, `startLiveGame`, `recordResult`) enforce preparation; the pure match simulator remains usable for hypothetical simulations. Personnel events cannot be advanced manually past an earlier unplayed kickoff. Game start also requires legal roster size and current cap.

The front office has a routed, sortable waiver desk with own claim preferences, conditional release selection, deadlines, remaining contract costs and public results. Player cards mark pending waivers, release previews show clearance and assignment outcomes, and finances distinguish pending holds. Rendering these views does not mutate the save or expose opposing claims. Inbox integration remains step 7.

### AI business policy

Every club submits against the same pre-award world using its own `perceive` read. It considers an immediate positional upgrade, modest scouted upside for young players and the cost of assuming the contract. It skips players expected to miss at least two weeks, rejects unaffordable future commitments, names a same-position replacement when full and reserves its existing in-season budget. The budget floor is part of each automatic claim and is checked again after earlier wins.

To avoid claim churn, AI clubs make at most two additions per camp or weekly management window (each free-agency day is its own window). This is a front-office policy, not an NFL rule and not a cap on manual user claims. New claims are not used as AI waiver replacement cuts during the same camp, or during their first two regular-season weeks. Competing alternatives share a position group and at most one can win per notice. A high-priority club can still win multiple claims when its budget, roster and plan allow it; its league priority never changes.

The first unconstrained trial produced 81 awards across 16 notices and ran past the opener. The bounded policy settled the two reproducible trial worlds at 35 awards over three notices and 29 over eight. Both had all 32 opening rosters at 53, no over-cap teams, legal play through four regular-season weeks and identical persisted outcomes after reloading before every notice. These are observations, not hard-coded volume targets.

### Staging and remaining limits

Waiver state is initialized only for enabled personnel careers. Migration from version 41 preserves the existing profile and creates no retroactive cuts, claims or clock events. The serialized queue contains contract snapshots; settled results are limited to the latest 96 and retain only the user's own unsuccessful-claim explanation. The existing transaction log keeps the public history.

Full injured-waiver reversion, injury settlements, salary continuation, playoff signing permissions, practice squad formation and later protections are not claimed complete in this step. In enabled development careers, cuts currently follow ordinary clearance/assignment; the complete profile stays off for normal careers until the lifecycle work ships. Historical service estimates from step 1 remain estimates.

### Step 2 verification

- Targeted regression suites passed, including the foundation fingerprint, finance, offseason, trades, game flow and UI contracts. The final focused run includes 31 waiver engine tests, three waiver desk tests and 30 UI/route tests.
- `scripts/waivers.ts` explicitly enables the staged feature and checks two seeded leagues, every notice across JSON reload, roster size, cap legality, unchanged pending contracts and AI addition limits. It is registered in the existing CI check planner for affected personnel/roster/finance/offseason/trade/calendar code.
- The existing six-season/four-league offseason audit and trade audit each report zero out-of-range numbers with ordinary careers still disabled. The existing retired-player save-growth warning remains; no threshold was loosened.
- Typecheck, formatting and the production build are checked locally. Remote CI has not been run. In this sandbox, audit entry points use `node --import tsx` because the `tsx` CLI cannot open its IPC socket.
