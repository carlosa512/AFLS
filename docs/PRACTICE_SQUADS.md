# Practice squads and personnel rules

## Status

Step 1 implements the data/query/service foundation only. Save version 41 stores a disabled personnel state with profile `afls-2026-v1`. It creates no practice squads, waiver claims, protections, signing obligations or calendar steps. Existing contracts, cap pricing, experience, coaching and match randomness retain their existing behavior. The seven-step implementation plan is in `superpowers/plans/2026-10-25-practice-squads.md`.

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

Queries of completed service can pass a `throughSeason` cutoff. In particular, future Article 29 waiver handling must examine pension service through the last completed season; earning a third game in the current season must not prematurely activate the veteran exception.

## Rules queued for later steps

| Step | Rule work before enabling |
| --- | --- |
| 2: waivers/calendar | Preserve and transfer the existing contract; freeze correct original/current priority independently of pick ownership; resolve award batches and conditional cuts. Article 29's veteran exception uses completed pension service, not generic `experience` or accrued seasons. Document personnel deadlines and cap settlement timing |
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
