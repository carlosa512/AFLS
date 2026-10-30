# AFLS Plan: Pedigree as Demand in Coaching Hires

Oct 30, 2026 · @Carlos Ancira (hooks checked against main at `b70290b`)

The problem and the done criteria are the MVP entry "Follow-up: coaching trees run at the floor of their NFL bands"
(commit `f2eb90b`). The pass zones below are that entry's bands with 10% of each band's width to spare at each edge.

**Two facts every task leans on:**

- **Hiring scores are lower-is-better** (`trees.ts:410`, `TREE_PULL`). Every pull is _subtracted_: the new term is
  `− W × pedigreeDemand`, and "the stronger pull" means the more negative one.
- **There is one search for every chair.** `fillChairs` (`coaching.ts:1789`) scores head coaches, coordinators and
  assistants with the same `score` (`coaching.ts:1837–1851`), and it already calls `treeLean(league, hc, c, role)`.
  So the pedigree term goes inside `treeLean` (`trees.ts:428`), with a weight per role. That keeps the "not the sum"
  overlap with tree standing in one place, next to the tests that already cover it.

## 1. Setup and baseline

**Task 1: Branch and cherry-pick**

- [ ] Work on this session's branch (`claude/dreamy-ptolemy-ewoozy`, now equal to main)
- [ ] `git cherry-pick f2eb90b` (the MVP entry; it's the only commit on `claude/gallant-ramanujan-rzydgt` past main)
- [ ] ~~Commit the approved spec~~ **No pedigree spec exists** in `docs/superpowers/specs/` or the upload. Either add
      it here, or treat the MVP entry as the spec and drop this step. The plan below only needs the MVP entry.

**Task 2: Baseline (8 worlds)**

- [ ] ~~`git worktree add` main~~ Not needed: until Task 4 the branch _is_ main (the cherry-pick only touches
      `docs/MVP.md`). Run the baseline here, before any code changes.
- [ ] Write a scratch runner (scratchpad, not committed). `npm run careers` pools its 4 seeds and never prints a
      per-world number, so the runner forks `scripts/careers-league.ts` once per seed with
      `CAREERS_SEED=<seed> CAREERS_SEASONS=16` (it already sends its `LeagueRun` back by `process.send`). Seeds: the 4
      in `scripts/careers.ts:34` plus 4 more. With 4 cores, that's two rounds of about 3 minutes each.
- [ ] Per world, read each number the way `scripts/careers.ts:445–462` does:
  - live trees: mean of the **second half** of `trees.live` (seasons 9–16)
  - share of HCs in a tree: mean of `trees.inTreeShare` over **all** seasons
  - share of hires from a tree: sum of `fromTree` / sum of `total`
  - trees born: `trees.born`
  - biggest tree (steady), most from one tree in an offseason, founding trees alive (careers fails on these too)
  - HC changes per year: mean of `trees.hires[].total`
- [ ] YoY win-share correlation **isn't measured anywhere** in the repo. Add it as a scratch patch to
      `careers-league.ts` (each team's win share by season from `league.history`, then the correlation of season n
      with n+1). Save the patch in the scratchpad and apply the same one for every later run. Don't commit it.
- [ ] Guardrail baseline: `npm run offseason -- 6` (coaching ledger ×1.00, "new HC" per year) and `npm run trades`.
      Leave `sim` to CI: a hiring change can't move play directly.

**Task 3: Hypothesis check (gate)**

- [ ] Temporary logging in `fillChairs` for `headCoach` and coordinator chairs (`winnerAsOf` is private, so export
      it for the log only). For each market candidate with a 3+ season `headCoach` link (`linksOf`) to a mentor where
      `winnerAsOf(league, mentorId, league.season)` is true, record whether he was:
  - **budget-filtered:** in `candidates` but not in `pool` (`coaching.ts:1826`), or
  - **outscored:** in `pool` but not the pick.
- [ ] Run on all 8 worlds
- [ ] **Gate:** if pedigree candidates are rarely skipped, stop and report before building
- [ ] **This also decides Task 7:** if few are budget-filtered, the price isn't the blocker, so skip Task 7
- [ ] Remove the logging and the export (don't commit them)

## 2. Build

Test-first, one task per local commit. After each task, run only the tests it touches:
`npx vitest run src/engine/trees.test.ts src/engine/coaching.test.ts` (the full suite has two 300-second tests, and CI
runs it anyway). Push the branch whenever you like: CI runs on pull requests and main only, and this container doesn't
last forever.

**Task 4: `pedigreeDemand` (trees.ts, next to `winnerAsOf`)**

Reads `linksOf(league, c.id)`, keeps `headCoach` links (3+ seasons is already the link rule), and for each mentor who
is `winnerAsOf` the current league year: strength from the mentor's win share times a recency fade from `link.last`.
The result is the max across mentors, from 0 to 1.

- [ ] Write the failing tests first:
  - returns 0 under 3 seasons on a winner's staff
  - returns more than 0 from the season the mentor becomes a winner (`WINNER`: 5 seasons at .550), with no tree
  - scores higher for a stronger winner
  - fades with seasons since `link.last`
  - takes the max across mentors, not the sum
  - **founding service** (`pastUnder`, `last = -Infinity`) fades to 0. That's what keeps the existing carousel tests
    green (`trees.test.ts:300` and `:317` expect `treeLean(..., 'offCoord')` to be 0 for a `pastUnder` man). Founding
    men are already in a tree, so `treeLean`'s standing term covers them.
  - is pure: same answer twice, league unchanged. (This replaces "draws no RNG": the function takes no `Rng`.)
- [ ] Implement it, with constants for the mentor curve and the recency half-life
- [ ] **Strength needs the win share**, and `winnerAsOf` only answers yes or no. Keep each root's win share by season
      in `Index.winners` (`trees.ts:40`), next to the winning set, so a search doesn't rebuild `coachRecord` per
      candidate. That would slow `offseason` and `trades`, and `trades` checks speed. A founding root (`'always'`)
      has no record, so give him a fixed strength.
- [ ] ~~`COORD_SERVICE_WEIGHT`~~ Leave it out for now. `Link` adds up every season under a mentor and doesn't keep
      roles, so this weight would mean reading `career` rows again. Add it in Task 8 only if the spread needs it.

**Task 5: The pull in `treeLean` (one change for HC and coordinator searches)**

- [ ] Tests (in `trees.test.ts`, "the carousel"):
  - a market candidate with pedigree scores lower (better) than an equal one without, for `headCoach` and for
    `offCoord`/`defCoord`
  - an in-tree HC candidate gets the **stronger pull** of tree standing and pedigree, not the sum
  - a withering tree's penalty (`+0.4`) and `TREE_CROWD` still apply on top. A plain `max` or `min` of the whole
    `treeLean` would drop them.
  - position-coach and other assistant chairs get no pedigree term
- [ ] Implement with `PEDIGREE_PULL: Partial<Record<CoachRole, number>>` (`headCoach` = W_HC, coordinators = W_COORD
      below it):
      `pull = min(min(0, standing), −PEDIGREE_PULL[role] × demand)`, then `lean += pull + max(0, standing) + crowd`
- [ ] **Decide the overlap with `HOT`** (`coaching.ts:1847`, risers only). A riser still on a winner's staff now gets
      both. Recommended: the same rule as trees (the stronger pull), with a test. Or let them add up and let Task 8 set
      the weight.
- [ ] Scale: score units are rating points with `rng.normal(0, 0.6)` noise. `HOT` gives a riser off a 13–4 staff
      about −0.5; a hot tree gives −0.15. Start the sweep with W_HC around 0.5.

**Task 6: ~~Coordinator search~~** Merged into Task 5 (same `score`, same `treeLean` call).

**Task 7: Price (`coachAsk`, `coaching.ts:545–563`), only if Task 3 says the budget is the blocker**

The original step (check the budget at the base ask, pay the full ask) breaks two things:

- **One rule for AI and you.** Your own moves check the full ask (`moveOverspend`, `coaching.ts:692`). The AI would
  sign men whose real pay it never checked, and that would break `spare`'s money set aside for the other chairs.
- **`pedigree` cuts both ways today.** A losing staff's men ask about a fifth _less_. Swapping it for a demand that is
  never below 0 raises asks league-wide: re-signings (`:1306`, `:1351`), forecasts (`:1466–1485`), `emptyChairGap`,
  and your screens (`ui/mail.tsx`). That puts the `offseason` coaching ledger at risk.

If Task 3 does call for it:

- [ ] Tests:
  - the ask is `base × (1 + PEDIGREE × demand)`, capped near +20%
  - the budget check and the salary use the **same** ask
  - a pedigree man just past `within` but inside the owner's leeway beats an equal man without pedigree (the demand
    pull outweighs `overspend`)
- [ ] Replace `pedigree` with `pedigreeDemand` inside `coachAsk`. Or keep last season's two-sided term for the
      discount and add demand on top; pick whichever holds the ledger at ×1.00.
- [ ] Note: changing who's in `pool` changes how many `rng.normal` draws a search makes, so every later hire in that
      offseason reshuffles. Compare worlds by their numbers, not season by season.

## 3. Calibrate and verify

Tune on all 8 worlds with the scratch runner, against the pass zones, and compare each run to Task 2. No band or check
range changes.

**Task 8: Weight sweep**

- [ ] Sweep W_HC until live trees (steady) average about 3 a league, with every world in 2.3–4.7
- [ ] Set W_COORD
- [ ] On every world, confirm: HCs in a tree 0.175–0.375 · hires from a tree 0.125–0.325 · biggest tree (steady)
      3–6 · most from one tree ≤ 0.4 · trees born 1–4 · founding trees alive ≥ 1. More tree hires push "most from one"
      up; `TREE_CROWD` is the lever for that, not the band.
- [ ] If a number can't reach its zone, stop and report why

**Task 9: Guardrails**

- [ ] `npm run offseason -- 6`: coaching ledger growth and decline ×1.00; "new HC" per year near main's
- [ ] Scratch runner: HC changes about 7 a year; YoY win-share correlation about 0.335
- [ ] `npm run trades` doesn't move
- [ ] `npm run typecheck` and `npm run format`

**Task 10: Tree-birth gate**

- [ ] Compare the spread of trees born across the 8 worlds to Task 2
- [ ] Narrower: done. Still wide: stop and bring a step-two proposal (a simpler birth rule) for your OK before coding.

## 4. Ship

**Task 11: Docs and PR**

- [ ] Version: this is a follow-up, not an MVP item, so bump **PATCH**: `0.2.24` → `0.2.25`
- [ ] Add a `src/ui/changelog.ts` entry for 0.2.25 (`docs/VERSIONING.md` requires one with every bump)
- [ ] Tick the MVP.md follow-up and update its line
- [ ] This plan is already in `docs/superpowers/plans/`
- [ ] Push, then open the PR with the 8-world before/after table and the guardrail results. Changing `package.json`
      makes CI run **every** check (`scripts/check.ts`), and careers stays at 4 leagues there.
- [ ] Read CI once; batch fixes locally, then push again
