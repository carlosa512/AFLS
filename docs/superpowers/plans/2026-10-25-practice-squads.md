# Practice squads, waivers and roster transactions

Implementation plan · October 25, 2026

## Goal and delivery

Give every franchise a practice squad that develops players, supplies injury cover and creates meaningful roster risk. Cutting a prospect exposes him to claims; getting him back requires his agreement; borrowing him for a game differs from signing him to the 53; signing another team's prospect carries a real roster and salary obligation.

Build this as one connected feature in seven dependent PRs. Enable the public feature when the complete season-to-season lifecycle works. Earlier PRs can merge behind a serialized, default-off feature version, so existing games never enter an incomplete transaction system.

This document is a plan, not an implementation. Read current project instructions before implementing. It does not authorize deployment or prescribe agent delegation.

## Repository findings

- Inspected branch: `audit/inbox-news-hardening`, head `18941d1`; package `0.1.11`; save version `40`. Recheck all versions before implementation.
- Start implementation from then-current main, keeping unrelated inbox work separate. Neither parked branch is a prerequisite: `claude/settled-opening-league` is already in main, and `claude/settled-opening-league-v1` contains superseded roster/payroll experiments.
- `roster.ts`: `teamPlayers` means everyone employed; `activeRoster` excludes only IR; `isAvailable` excludes only IR and injury. Depth charts can contain all employed players.
- `finance/cap.ts`: `releasePlayer` immediately books dead money, removes the player and clears his contract. Pending waivers need a different lifecycle.
- `offseason/index.ts`: preseason advances directly to regular-season Week 1. `league.ts` plays a week in a batch; `startLiveGame` is a separate match entry point.
- Existing coaching, practice injuries, learning, development, scouting and AI cap reserves provide the foundations. Reuse them without granting squad members fictitious game reps.
- Saves are JSON; money is in $K; randomness is seeded; screens respect scouting knowledge; inbox delivery follows store mutations.

## Product decisions

1. Favor fun and low micromanagement when realism creates a design choice. Use modern NFL rules as the foundation, with explicit AFLS house rules where they improve play. Freeze the profile per save so future updates cannot silently change a career.
2. Preserve weekly management. Advance between meaningful personnel deadlines instead of requiring daily clicks; process intervening league events in order.
3. The user's staff recommends moves. It does not cut, claim, sign or elevate players without explicit delegation. Weekly protection is the authorized exception: it is assigned automatically by default, with optional user overrides. Fast-forward uses an explicit auto-management policy for other moves.
4. Use existing coaching and practice development, with no separate development currency, guaranteed growth or true-potential information in AI decisions.
5. Show squad pay and continuing obligations in finances and AI budgets, including postseason treatment.
6. Build the ordinary 16-player system first. Defer the qualifying international exemption until eligibility, pay and signing restrictions are implemented; never infer eligibility from a name.
7. Open practice squad spots are legal. A full squad is an AI preference subject to budget and available players, not a user calendar blocker.
8. Give every club two weekly protections, selected automatically for its highest-potential practice squad players according to its own scouts. The user can pin a specific player instead. Routine protection needs no confirmation or weekly reminder.
9. Keep decisions about risking a prospect, claiming a cut, covering an injury and promoting a player. Automate routine deadlines, reversion, payroll and renewals of protection preferences. Where an obscure NFL exception creates bookkeeping without a worthwhile decision, use a documented, consistent AFLS simplification instead of reproducing it solely for authenticity.

## Rule verification gate

Before coding behavior, create `docs/PRACTICE_SQUADS.md` with a rule registry: effective season, NFL source/amendment or explicit AFLS design decision, predicate, deadlines, list/cap effect and boundary examples. Distinguish verified NFL rules from deliberate house rules. The original 2020 CBA alone does not contain every modern rule. Research informs design; it must not turn an already-authorized gameplay choice into an approval gate.

| Topic | Working requirement | Detail to settle before implementation |
| --- | --- | --- |
| Capacity | 16 ordinary places; international exception deferred | Which injured/reserve statuses consume a place |
| Eligibility | Overlapping basic categories and limited experience categories; up to six unrestricted-experience players | Exact category assignment and combined ten-player limit for expanded categories; do not simplify to ten young plus six veterans |
| Waivers | A claim awards the existing NFL contract | Article 29 uses pension-credited service for the veteran exception; distinguish accrued and minimum-salary credited service |
| Priority | Original draft priority early; current-season priority after Week 3 | Tiebreakers, deadline snapshot, award order and multiple/conditional claims; do not reverse playoff standings |
| Cutdown | Initial waivers resolve before squad agreements take effect | Personnel notices, claim-related cuts and subsequent waiver batches |
| Elevations | Two per club/game; three regular-season uses per player/club; automatic reversion; unlimited postseason uses | Current amendment, same-club re-sign restriction, new-club treatment, deadline and elevated-player signing lock |
| Game-day list | 47 dressed; 48 with eight qualifying OL; elevations permit 54/55 total | Emergency QB treatment and legal active-list selection using AFLS positions |
| Poaching | Player chooses an NFL deal elsewhere; no direct squad-to-squad transfer | Six-day opponent cutoff, ten-day bye exception, Super Bowl restriction and elevated-player lock |
| Poaching obligation | Three salary weeks and three roster-count games; bye counts | Offsets, release/trade before expiry, return to signing club's squad and season-end boundary |
| Protection | AFLS house rule: two weekly protections, automatic by perceived potential with optional pins | Weekly selection/lock, persistent preferences, no cycling, symmetry for AI and save/reload stability; no NFL verification prerequisite |
| Pay | Weekly agreement; elevation changes that week's entitlement | Annual tables, eighteen weekly payments, cap classification, injury continuation, playoff pay and accrued/remaining amounts |
| Lifecycle | Squad injured status and a route into next offseason | Injured waivers/settlements, return rules, contract expiry, futures effective date and postseason restrictions |

Corrections to the initial brainstorm: published sources disagree on current NFL weekly protection. AFLS intentionally chooses its own two-player rule, regardless of that dispute. Also, accrued seasons alone do not implement Article 29's pension-service exception. Some NFL summaries contain conflicting elevation wording; resolve those against amendments or document an intentional AFLS simplification.

For 2026, the published squad salary table gives $13,750/week for the applicable developmental categories and $18,350–$22,850/week for the experienced category. Store these as 13.75, 18.35 and 22.85 in $K. Use sourced annual tables through the covered years, then a documented AFLS cap-indexed extrapolation. Do not round checks to whole $K or confuse seventeen games with eighteen weekly payments.

**Gate passes when:** each enabled rule has an NFL source or explicit AFLS rationale and concrete boundary cases. Resolve ambiguous details through the fun-first product principles and document departures. Do not block implementation to verify whether an intentional house rule exists in the NFL. Research factual questions during implementation without making the user adjudicate sources.

## Two weekly protections: settled gameplay design

This is an AFLS rule, not a claim about current NFL rules. Its purpose is to keep the user's best developmental bets safe with no routine upkeep while leaving the rest of the squad exposed to interesting roster decisions.

- **Default:** protect up to two eligible current practice squad players automatically. Rank by the club's existing scout-estimated ceiling (`projectedCeiling`), with stable player-ID tiebreaks. Do not use hidden `potential`: automatic selection must not become a secret talent detector. Use the same policy and scouting limits for AI clubs.
- **Overrides:** offer “Always protect” on a practice squad row/player card. A pinned player takes one of the two spots; automatic ranking fills the rest. Pins persist across weeks while the player remains eligible, with at most two pins. Unpinning returns that spot to automatic selection. There is no required weekly lineup submission.
- **Timing:** show the coming week's automatic choices and allow optional changes during roster preparation. The normal continue/sim action locks them before the week's poaching offers resolve; it asks for no additional confirmation. Selections last through that league management week, including a bye, then renew automatically.
- **No cycling:** once locked, neither scouting updates nor changes to pins rotate the current week's shields. Edits update next week's preferences. If a protected player is permanently promoted, released or otherwise leaves the squad, his protection ends and that slot is spent until renewal; it cannot be reassigned repeatedly. A temporary elevation retains the underlying selection and does not free a shield.
- **Boundaries:** only current available-for-poaching squad members are candidates; injured-list members are handled by their own rules. Initial practice squad formation gets its first protection pass before the first poaching round. Protection cannot prevent an earlier waiver claim, undo a completed signing or block the player's own club from promoting him.
- **Effect:** other clubs cannot complete a poaching signing for a protected player during that window. They can pursue unprotected squad players through the ordinary NFL-contract route. Protection has no fee, consumable currency or growth bonus.
- **UI:** show “Protected this week” and whether it came from automatic selection or a pin. After locking, show when an override will take effect. Explain the house rule once; do not generate routine inbox tasks. The user sees estimated-potential context, never a revealed true ceiling.
- **Persistence:** save the locked player IDs, window, spent slots and pin preferences. Reloading, reordering the roster, signing another prospect or toggling auto mode cannot reroll the week's selections.

**Examples:** automatic selection chooses prospects A and B. Pinning C before the lock yields C plus the higher-ranked of A/B. Pinning C after the lock schedules C for next week. Promoting A after the lock leaves B protected and the second slot spent until renewal. Doing nothing renews sensible choices automatically.

## Calendar and user flow

### Cutdown

`Camp complete → submit initial 53 → claim deadline → awards/clearance → practice squad offers → opening-week preparation`

- Apply camp development and position changes once before final evaluations and cuts.
- Offer “Practice squad contract if he clears” as an intent, never a guaranteed return or reserved right.
- Collect initial cuts across clubs before resolving claims. Team iteration order must not determine access to players.
- Claim-related cuts enter a later waiver batch; no recursive immediate clearance/re-signing.
- Resolve competing squad offers together. Familiarity can influence the player, who may choose another club or remain unsigned.
- Pre-authorized conditional cuts can make a claim legal atomically. Revalidate against actual awards; stop for user input only when an unapproved decision is necessary.
- Matches cannot start with due personnel events unresolved or illegal game rosters.

### Season and playoffs

`Postgame settlement/reversion → claims and squad preparation → automatic protection lock → poaching market → final elevations and dressing list → kickoff`

The protection lock is a deliberate AFLS weekly boundary, not an imitation of a disputed NFL Tuesday window. It must occur before any poaching resolution for that management week. Intervening waiver deadlines still follow their event ordering.

Use an ordinal football clock anchored to season/week/day and Eastern personnel deadlines. It must distinguish Thursday, Saturday, Sunday and Monday games, cross week boundaries for opponent restrictions, and derive display dates consistently. A season/week flag alone is insufficient.

An event driver processes deadlines in stable order. “Play week” drains necessary events automatically when no user decision is pending. Fast-forward uses the same move validators. All match entry points share a game-preparation guard, including live games.

Reversion is scheduled at the applicable first-business-day deadline. Do not revert one team's players merely because another game was simulated, or leave Thursday elevations active all week. Stable event IDs make reload and repeated mutations safe.

## Data and engine design

Represent employer and list membership explicitly. Keep `teamId` for employer; distinguish regular roster, IR, practice squad and squad injured. A pending waiver has its own record containing the originating team and preserved contract. Avoid independently writable booleans that permit impossible membership combinations.

| Data | Purpose |
| --- | --- |
| Service record | Accrued service, minimum-salary credited service, pension service and qualifying game/status history; preserve calendar `experience` for existing career logic |
| Squad agreement | Employer, effective time, weekly salary, salary category and termination/expiry; separate from an ordinary NFL `Contract` |
| Waiver entry | Player, originating club, contract snapshot, designation, notice/deadline, claims and outcome |
| Claim instructions | Own club's ordered preferences, conditional cuts and limits; private to that club |
| Elevation history | Season + club + game, status and reversion; survives release/re-signing |
| Continuing obligations | Salary, roster charges and offsets that can outlive employment |
| Personnel state | Clock, event cursor, rules profile and stable transaction IDs |
| Weekly protection | Locked club/player/window, spent slots and persistent pin preferences; two by default under the AFLS profile |

Suggested modules: `personnel/rules.ts`, `calendar.ts`, `transactions.ts`, `service.ts`, `waivers.ts`, `practiceSquad.ts`, `elevations.ts`, `ai.ts`; financial calculations remain in `finance/`.

Keep queries separate: employed players, players counting toward 53, squad members, eligible players for a particular game, practicing players and cap obligations. Keep `teamPlayers` broad and audit callers rather than silently narrowing it.

Moves use preview/validate/commit functions. Validate everything before mutation. A failed claim or signing must leave cap, contracts, memberships, charts and logs unchanged. Separate waiver request, contract assignment and final unclaimed release; book originating bonus costs and transferred salary exactly once at the appropriate stage.

## Implementation sequence

### PR 1 — Rules, list membership, service and save foundation

**Depends on:** verified rules. **Files:** `types.ts`, `roster.ts`, `generate.ts`, `migrate.ts`, new rules/service modules and roster-query callers.

- [x] Establish the rules profile and explicit list queries, preserving current behavior while disabled.
- [x] Add status-aware service counters. Stats `gp` cannot reconstruct roster/inactive/IR service.
- [x] Document estimates for unknown pre-save service; mark legacy estimates and collect exact records prospectively.
- [x] Serialize the new structures with no pending transactions by default; allocate the next save version at implementation time.
- [x] Audit trades, signing pools, depth charts, strength calculations and match fallback selection for list leakage.

**Acceptance:** old saves preserve contracts, rosters and hand-sorted charts; migration is idempotent; synthetic histories distinguish service definitions correctly; non-elevated squad players cannot play.

### PR 2 — Personnel clock and waivers

**Depends on:** PR 1. **Files:** personnel calendar/transactions/waivers; `finance/cap.ts`, `offseason/index.ts`, `offseason/negotiation.ts`, `offseason/ai.ts`, `league.ts`, trade cut callers, `Home.tsx`, `FrontOffice.tsx`.

- [x] Add cutdown/weekly event stages and shared guards for every game entry point.
- [x] Route every cut through waiver-aware behavior. Pending waivers are excluded from free-agent signing and negotiation.
- [x] Preserve the full NFL contract while pending; transfer applicable obligations on assignment or terminate on clearance. Preview both outcomes.
- [x] Persist original priority independently of traded picks. For a league without historical standings, generate a stable documented opening order without inventing played seasons.
- [x] Resolve claims in batches with correct priority, preferences, conditional cuts, cap and list capacity. Winning does not move a club to the back.
- [x] Add the waiver wire, claim controls, deadlines and result notices. Opponent claim instructions remain private.

**Acceptance:** competing claims award correctly regardless of iteration order; contracts survive; cap/dead money settles once; follow-on cuts wait for another deadline; failed claims leave no partial changes.

### PR 3 — Squad formation, contracts and payroll

**Depends on:** PR 2. **Files:** personnel squad module, `finance/`, offseason signing/calendar, `generate.ts`, roster/player/finances screens.

- [ ] Implement eligibility as a feasible assignment across overlapping categories, returning a precise rejection reason.
- [ ] Add offers, acceptance, release and permanent promotion. A cleared rookie's old contract never resumes.
- [ ] Add contingent return offers and simultaneous formation rounds using existing player preferences and club scouting reads.
- [ ] Track earned and projected pay/cap commitments without double charging promotion or allowing sign/cut between payroll ticks to erase liabilities.
- [ ] Reserve squad costs before AI offseason spending and opening payroll fitting; preserve the separate injury/trade reserve.
- [ ] Create new-game squads through a deterministic market with adequate eligible supply and affordable payroll, without taking players from existing 53s.
- [ ] Add the squad roster view, category explanation, weekly pay and promotion preview.

**Acceptance:** clubs can form legal affordable squads; clearance does not guarantee return; overlapping eligibility does not depend on signing order; squad membership alone grants no match eligibility.

### PR 4 — Elevations and game-day lists

**Depends on:** PR 3. **Files:** personnel elevations; `roster.ts`, `league.ts`, `match/gameSim.ts` and lineup consumers, `finance/`, home/roster/player screens.

- [ ] Separate temporary elevation from signing to the 53; preserve club-specific use history and verified re-sign restrictions.
- [ ] Persist a legal 47/48 dressing list and eight-OL requirement, plus verified emergency-QB treatment. Audit every match selection path.
- [ ] Allow up to two elevations into the permitted 54/55 list; lock at the right deadline and schedule reversion.
- [ ] Settle pay and service even without snaps. Handle pregame and in-game injuries.
- [ ] Display remaining uses, pay effects, dressing status and when permanent promotion is required.

**Acceptance:** a prohibited fourth use fails; permanent promotion requires space; playoffs use the correct separate limits; live and batch simulation share eligibility and settlement behavior.

### PR 5 — Poaching and obligations

**Depends on:** PR 4. **Files:** personnel transactions/squad/AI, `finance/`, negotiation, trade rules, front-office/player screens.

- [ ] Allow NFL-contract offers to other clubs' squad players under opponent deadlines and elevated-player locks. Block direct squad-to-squad transfers.
- [ ] Resolve offers through player choice. Provide recommendations when action is still legal, without inventing a matching right or guaranteed response window.
- [ ] Retain three salary weeks and three roster-count games with the signing club after an early release/trade; implement offsets and the season boundary.
- [ ] Support legal waiver/re-sign paths without erasing the original obligation. Do not replace accounting with an artificial ban on legal early releases.
- [ ] Implement the two-player AFLS protection policy above: automatic scout-estimated ceiling ranking, persistent optional pins, weekly lock and no reassignment of spent slots. Use the same rule for every club.

**Acceptance:** one-game rentals still incur the required roster/pay cost; byes and late-season cases settle correctly; contract churn cannot erase obligations or reset exhausted elevation history. Routine protection takes zero extra clicks, manual pins work, protected signings fail and no player can protect an entire squad by cycling selections.

### PR 6 — AI, injuries, development and offseason lifecycle

**Depends on:** PR 5. **Files:** personnel AI, `offseason/ai.ts`, `injuries.ts`, `development.ts`, `training.ts`, `coaching.ts`, offseason calendar, generation/service modules.

- [ ] Choose between roster cover, elevation, promotion, FA signing and poaching based on duration, perceived quality and full costs. Short absences must not force permanent signings.
- [ ] Balance developmental candidates with emergency coverage, using club scouting knowledge rather than true potential or forced position quotas.
- [ ] Include healthy squad members in ordinary practice, learning and coaching; count no game reps without activation. Preserve the yearly development budget and true-up rules.
- [ ] Implement squad injured membership, return procedures and elevated-player salary continuation; support the injury release/waiver routes in the rule registry.
- [ ] Expire agreements properly, negotiate reserve/futures contracts and activate them next league year. Do not retain rights automatically.
- [ ] Permit required playoff moves; replace blanket playoff transaction blockers with rule-specific restrictions for playing, eliminated and Super Bowl clubs.
- [ ] Add explicit user delegation controls and consistent fast-forward behavior through the same validators. Automatic protection remains the default in both manual and fast-forward play; other transactions still require delegation.

**Acceptance:** camp → season → playoffs → next camp completes without stuck events, leaked membership, duplicate pay or uncontrolled player-pool growth.

### PR 7 — Inbox, usability, audits and public activation

**Depends on:** PR 6. **Files:** `inbox.ts`, `ui/mail.tsx`, home/roster/front-office/player/finances screens, navigation, audit scripts/check planner, design/MVP/version docs.

- [ ] Add actionable notices for claims, clearance, failed returns, signings away, elevation limits and continuing obligations, using existing linked names and deduplication.
- [ ] Show deadlines and specific reasons in previews; retain scouting-based comparisons, sorting and mobile usability. Make two weekly protections visible and automatic, with optional persistent pins and no weekly inbox chore.
- [ ] Place waiver wire under front office, and regular/squad/injured lists under roster; reuse shared move previews.
- [ ] Extend audit/CI selection and distinguish list counts from total employed players in reports.
- [ ] Validate new/migrated activation and enable the completed profile. Follow `docs/VERSIONING.md`; this feature alone does not automatically finish MVP item 12.

**Acceptance:** all scenarios below work through engine and UI, relevant CI passes, and release notes identify deferred NFL exceptions.

## Save compatibility and rollout

- New games include squad payroll in initial financial planning, alongside legal 53s and populated squads.
- Existing games preserve rosters, IR, contracts and live state. No retroactive waivers, invented historical salary charges or forced cuts to fund squads.
- Activate at the next safe personnel boundary after any live game; bootstrap through normal offers to eligible available players. Empty spots remain legal if money is tight.
- Give setup its own deterministic stream. Explain historical service estimates in upgrade notes.
- Persist pending claims/offers, event cursor, pay accrual, elevation history and obligations. Export/import at any decision point resumes the same outcome.
- Bound event history and retain only service/financial facts needed for future behavior; measure save growth and runtime over several seasons.

## Acceptance scenarios and verification

| Scenario | Required result |
| --- | --- |
| Cut rookie and request return | Claim period first; winner inherits contract; no squad signing before clearance |
| Rookie clears | Contract terminates; original costs settle once; another club can win his squad agreement |
| Veteran cut around deadline | Correct pension-service exception before boundary, waiver route afterward |
| Multiple claims with limited room | Preferences/conditional cuts resolve legally and deterministically without partial mutations |
| Overlapping experience categories | Correct feasible/infeasible results independent of signing order |
| Elevate, release and re-sign | Club history survives; prohibited further use cannot be obtained through churn |
| Elevated player injured | Reversion, membership, continuation pay and service remain correct |
| Thursday/Sunday/Monday and bye | Correct per-game deadlines, opponent cutoff and reversion across week boundaries |
| Poach then immediately cut/trade | Original roster charge remains; salary offsets reconcile; capacity is not freed prematurely |
| Six-/ten-day and Super Bowl cutoffs | Correct before/at/after results |
| Advance without touching protection | Two highest scout-estimated ceilings are protected automatically before poaching, with no extra prompt |
| Pin zero, one or two players | Automatic choices fill remaining slots; preferences persist; a third pin requires replacing one |
| Change pin/ranking after lock or promote a protected player | Current selection stays fixed; spent slot cannot be reused; next week's choices update correctly |
| Protection through save/load, bye and fast-forward | Same locked players and window; no reroll, no hidden true-potential access and identical AI rules |
| Inactive or non-elevated squad member | No starter, substitute, specialist or fallback appearance |
| Reload before award/after live game | Same outcome with no duplicate pay, service, transactions or inbox mail |
| Full season/offseason | Expiry/futures occur once; legal postseason moves and next-camp rosters |
| Multi-season AI | Stable cap/legal lists, squad supply, career mix, runtime and save size |

Implementation verification: targeted Vitest suites plus typecheck per PR. Finance/AI changes call for offseason and trade audits; training/development changes call for those audits; match eligibility/injury changes call for established simulation checks. Follow `CLAUDE.md`: do not run umbrella `npm run check` locally unless requested; read and fix CI's selected checks without loosening bands.

Add focused personnel tests and a seeded multi-season audit. Capture roster/payroll baselines before behavior changes. Measure transaction volumes and use NFL data before declaring new acceptable bands; changed talent pools are a reason to investigate rather than silently rebaseline failures.

Planning-only delivery requires document/path checks, not engine simulations. No implementation tests are claimed here.

## Sources for the rule registry

Use executed CBA language and current amendments to establish NFL facts; summaries are supporting material. Record deliberate AFLS departures separately, led by the user's fun-first instruction and two automatic protections. Sources inspected during brainstorming/planning:

- [NFL Football Operations: contract language](https://operations.nfl.com/calendar-events/nfl-free-agency/contract-language): roster/eligibility overview; conflicting elevation wording needs amendment-level resolution.
- [CBA Article 29](https://overthecap.com/collective-bargaining-agreement/article/29): waivers and pension-service exception.
- [Article 33 §2](https://overthecap.com/collective-bargaining-agreement/article/33/section/2): outside signing and opponent restrictions.
- [Article 33 §3](https://overthecap.com/collective-bargaining-agreement/article/33/section/3): salary schedule and permitted compensation.
- [Article 33 §5](https://overthecap.com/collective-bargaining-agreement/article/33/section/5): reversion, signing lock, service and injury continuation; original limits require later amendments.
- [Article 33 §6](https://overthecap.com/collective-bargaining-agreement/article/33/section/6): poaching obligations and offsets.
- [Article 8 §1](https://overthecap.com/collective-bargaining-agreement/article/8/section/1) and [Article 26 §2](https://overthecap.com/collective-bargaining-agreement/article/26/section/2): accrued and minimum-salary credited service.
- [Lions' 2026 squad explanation](https://www.detroitlions.com/news/detroit-lions-breaking-down-the-lions-initial-practice-squad-altmyer-whiteside-kennedy): supporting modern summary; its protection claim is not the basis for AFLS's intentional two-player rule.
- [Buccaneers elevation explanation](https://www.buccaneers.com/news/bucs-use-final-practice-squad-elevation-option-ifeatu-melifonwu): modern regular/postseason elevation limits.
- [NFL important dates](https://operations.nfl.com/calendar-events/nfl-important-dates): notices, formation and seasonal boundaries.

## Implementation progress

Step 1 is implemented on `feature/practice-squad-foundation`: save version 41, disabled rules profile, list boundaries, observed service and legacy estimates. Verification is recorded in `docs/PRACTICE_SQUADS.md`: targeted tests and typecheck pass, the six-season roster audit and trade audit report zero out-of-range numbers, and the ten-season simulation matches the unchanged baseline including its existing rushing-leader threshold failure. Step 2 is implemented on `feature/practice-squad-waivers`: save version 42, contract-preserving notices, ordered/conditional claims, scouted AI decisions, chronological game guards and the waiver desk. The complete profile remains off for normal careers. The enabled AI audit is `npm run waivers -- 2`; step 3 (practice squad formation/contracts/payroll) is next.

## Original first implementation action

Branch from current main, settle and commit the NFL/AFLS rule registry with boundary examples and the fun-first decisions above, then implement PR 1. Critical path: rules/service → clock/waivers → squad contracts/payroll → elevations → poaching and automatic protection → AI/lifecycle → release validation. No parked-branch code is required.
