# Front Offices Like NFL Teams (Project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI front offices sign deals whose length follows a player's worth, give young players the job early like NFL
teams, and (only if still needed) cut overpaid veterans in the spring, so the market and job turnover reach the NFL's.

**Architecture:** One length rule (`dealYears` by pay tier, then age) in `finance/market.ts` read by every deal maker;
one start score (`startScore` = rating + a fading youth lean from public facts) in `coachDecisions.ts` read by every
depth chart; a deal-size grouping (`dealTier`) shared by the length rule and the re-sign screen. Measured by new and
existing lines in `npm run offseason` and `npm run careers`.

**Tech Stack:** TypeScript engine (`src/engine/`), React screens (`src/ui/`), Vitest, tsx check scripts (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-15-front-offices-design.md`

## Global Constraints

- Deterministic: no `Math.random`; any new draw on its own seeded stream. A seed reproduces its world.
- `League` stays plain JSON; no new stored field is planned. If one is added, bump `SAVE_VERSION` with a `migrate.ts` step.
- Existing contracts keep their lengths; rookie deals, fifth-year options and tags are untouched.
- The lean reads public facts only: `p.age`, `p.experience`, `p.draft` (`round`, `pick`), plus `slotOvr` as today.
- Never loosen a band; a line that can't hold goes to the owner with evidence. The owner's existing bands hold, the
  sim lines included (`sim` at 60 seasons is the judge for play).
- Screen and letter words follow `docs/UI.md` "Words on a screen" and `docs/NEWS.md` "Words in a letter" (a team, never
  a club, on screens and in letters).
- Working agreement: steer with fast probes; before the PR exists, commit and push to the branch freely (no CI runs
  without a PR); once a PR is open, push only after the affected checks pass locally.
- `npm run format` before each commit; `npm run typecheck` clean.

## Review Focus

- The coaches' quirk notes (`coachDecisions.ts`, the pass that compares `coachOrder` against a pure-rating ranking at
  ~line 186) must not credit the youth lean to a coach's quirk: the comparison ranks by `startScore`, so only a quirk's
  own difference is reported (test in Task 4).
- A manually set depth chart (your own, `autoDepth` false) keeps your order; the lean only orders players you haven't
  placed, as auto-sorting does today (test in Task 4).
- An injured or unavailable young player never starts through the lean: it orders only the available pool it is given
  (test in Task 4).
- Your own contract talks: a cheap player now asks one or two years, and offering him five still works with the term
  penalty (`demand`), never refused for length alone (test in Task 2).
- A player whose ask sits exactly on a tier boundary (0.8% or 2% of the cap) lands in one group, the higher one, on the
  re-sign screen and in the letter, and the two agree (test in Task 3).

---

### Task 1: Measure deal lengths by worth (NFL and AFLS)

**Files:**
- Modify: `scripts/research-free-agency.py` (print veteran deal lengths by pay band, 2018–2021)
- Modify: `docs/research/free-agency-market.md` (add the NFL table and AFLS before)
- Modify: `scripts/free-agency-core.ts` (new measure), `scripts/offseason.ts` (new line)
- Test: `scripts/free-agency-core.test.ts` (create if absent)

**Interfaces:**
- Produces: `export const NFL_DEAL_LENGTH: Record<'min' | 'mid' | 'good' | 'big' | 'star', { mean: number; oneYear: number }>`
  and `export function dealLengths(l: League, signedSeason: number): Record<keyof typeof NFL_DEAL_LENGTH, { n: number; mean: number; oneYear: number }>`
  in `scripts/free-agency-core.ts`; bands by APY ÷ cap: min < 0.008, mid 0.008–0.02, good 0.02–0.05, big 0.05–0.10, star ≥ 0.10.

- [ ] **Step 1: Extend the research script** to print, for veteran deals (not this year's rookies) signed 2018–2021, n,
  mean years and one-year share by the five bands. Expected output (nflverse `historical_contracts.csv.gz`):
  min 1.17 (84%), mid 1.38 (70%), good 2.26 (31%), big 3.11 (20%), star 3.83 (11%). Add the table to the research doc
  with AFLS before (seed `pay-recon`, seasons 2–5): min 2.34 (48%), mid 2.94 (25%), good 2.61 (34%), big 2.77 (26%),
  star 3.38 (11%).
- [ ] **Step 2: Write the failing test** `dealLengths counts every veteran deal signed this offseason by pay band`:
  build a league, give three players fresh veteran contracts signed this season at 0.5%, 1.5% and 6% of the cap with
  lengths 1, 2 and 4, a rookie deal and a tag; expect `min {n:1, mean:1, oneYear:1}`, `mid {n:1, mean:2, oneYear:0}`,
  `big {n:1, mean:4, oneYear:0}`, the rookie deal and tag not counted.
- [ ] **Step 3: Run it** — `npx vitest run scripts/free-agency-core.test.ts` — FAIL (`dealLengths` not defined).
- [ ] **Step 4: Implement** `NFL_DEAL_LENGTH` (the Step 1 values) and `dealLengths` (contracts with `signedSeason ===
  signedSeason`, kind not `rookie` or `tag`, on a team).
- [ ] **Step 5: Run it** — PASS.
- [ ] **Step 6: Add the line to `npm run offseason`**, judged per band from the second offseason on, pooled over the run:
  mean within ±0.35 years and one-year share within ±12 points of the NFL's (tolerances: the owner approves them when
  he approves this plan). On main today it prints ✗ for min and mid; that is expected until Task 2.
- [ ] **Step 7: Commit** — `git commit -m "Deal lengths by worth: the NFL's table and a line in npm run offseason"`.

### Task 2: Deal length by worth, then age

**Files:**
- Modify: `src/engine/finance/market.ts` (`dealTier`, `dealYears`; `preferredYears` becomes `dealYears` with a share)
- Modify: `src/engine/offseason/negotiation.ts:121` (`demand().askYears`)
- Modify: `src/engine/generate.ts` (`dealCycle` ~:355, `initialContract` ~:390, `rookieExtension` ~:455, the expiring
  extension ~:655: each passes the deal's share of the cap)
- Test: `src/engine/finance/market.test.ts`, `src/engine/offseason/negotiation.test.ts`, `src/engine/generate.test.ts`

**Interfaces:**
- Produces: `export type DealTier = 'key' | 'role' | 'depth';`
  `export function dealTier(share: number): DealTier` (≥ 0.02 key, ≥ 0.008 role, else depth; a share exactly on a bound
  goes up); `export function dealYears(player: Pick<Player, 'age' | 'position'>, share: number): number` (1–5).
- Consumes: Task 1's `dealLengths` and its `npm run offseason` line to tune against.

Starting table (age read on the position's clock, `age − ageShift(position)`; the builder tunes it to the NFL's means):

| Share of cap | ≤ 25 | 26–27 | 28–29 | 30–31 | 32+ |
| --- | --- | --- | --- | --- | --- |
| under 0.8% | 2 | 1 | 1 | 1 | 1 |
| 0.8–2% | 2 | 2 | 1 | 1 | 1 |
| 2–5% | 3 | 3 | 2 | 1 | 1 |
| 5–10% | 4 | 4 | 3 | 2 | 2 |
| 10%+ | 5 | 5 | 4 | 3 | 2 |

- [ ] **Step 1: Write the failing tests** in `market.test.ts`: `dealTier(0.008) === 'role'`, `dealTier(0.02) === 'key'`,
  `dealTier(0.0079) === 'depth'`; `dealYears` returns the table's cell for a WR aged 24, 27, 29, 31, 33 at shares
  0.005, 0.015, 0.03, 0.07, 0.12; a QB aged 33 reads as 29 on its clock.
- [ ] **Step 2: Run them** — `npx vitest run src/engine/finance/market.test.ts` — FAIL.
- [ ] **Step 3: Implement** `dealTier` and `dealYears` with the table as a named constant `DEAL_YEARS` (rows by share,
  columns by clock age) so a probe can override it; remove `preferredYears` and point its callers at `dealYears` with
  the deal's share: `demand` uses its own market price ÷ the cap; `dealCycle`, `initialContract`, `rookieExtension` and
  the expiring extension use the APY they build ÷ the cap of that league year.
  Fitted (prove-it) and last-call offers keep their one year (`fitOffer`, `YOUNG_PROVE_IT_YEARS`), the owner's setting.
- [ ] **Step 4: Run them** — PASS.
- [ ] **Step 5: Write the failing test** `a cheap player asks one or two years, and a five-year offer still closes`
  (`negotiation.test.ts`): a 27-year-old at 0.6% of the cap has `askYears` 1; `offerValue` of a five-year offer at his
  ask is ≥ his walk-away.
- [ ] **Step 6: Run it, implement nothing new if it passes** (it pins the term penalty), else fix `demand` so length
  alone never refuses an offer at his price.
- [ ] **Step 7: Tune with the probe**: `npm run offseason -- 6` locally; adjust `DEAL_YEARS` until Task 1's line passes
  for every band. Record the table that passes.
- [ ] **Step 8: Hold the neighbors**: `npm run morale` (contract disputes, holdouts, underpaid final-year starters),
  `npm run trades`, `npm run offseason -- 6` (dead money, kickoff room, free agency, save size). A miss on a band goes
  to the owner with evidence; never loosen.
- [ ] **Step 9: Re-pin moved fixtures**: `npx vitest run`; for each failure, find whether the reshuffle moved its scene
  (re-scene or re-pin with a dated note `2026-11-15: deal lengths by worth`) or exposed a real bug (fix it).
- [ ] **Step 10: Commit** — `git commit -m "Deal lengths by worth, then age (dealYears)"`.

### Task 3: The re-sign window grouped by deal size

**Files:**
- Modify: `src/ui/screens/FrontOffice.tsx` (`Resign`, the expiring table ~:160)
- Modify: `src/engine/contractMail.ts` (row order in `contractMail` ~:172)
- Test: `src/ui/ui.test.ts` or the FrontOffice test file, `src/engine/contractMail.test.ts`

**Interfaces:**
- Consumes: `dealTier(share)` from Task 2; the ask is `demand(league, p, league.userTeamId).askApy` ÷ the cap.

- [ ] **Step 1: Write the failing test** `the re-sign window groups expiring players by the size of the deal they ask`:
  render `Resign` in the re-sign window with three expiring players asking 3%, 1% and 0.5% of the cap; expect group
  headings in order `Key players`, `Role players`, `Depth`, each with its count, and each player under his group.
- [ ] **Step 2: Write the failing test** `a player asking exactly 2% of the cap is a key player on the screen and in the
  letter`.
- [ ] **Step 3: Write the failing test** (`contractMail.test.ts`) `the contracts letter lists players in the screen's
  group order`.
- [ ] **Step 4: Run them** — FAIL.
- [ ] **Step 5: Implement**: the expiring table renders one body per tier (key, role, depth), tiers with no players
  omitted, sorting inside a tier with the existing `SortTh`; the depth group carries `Let all N walk` (the same
  `letRestWalk` call, limited to the depth group's open contracts); the existing `Let the other N walk` stays. The
  letter orders its rows by tier, then as today.
- [ ] **Step 6: Run them** — PASS; `npx vitest run src/ui` (screen contract tests) PASS; `npm run copy` and read the new
  lines in `.check/copy.txt`; `npx vitest run src/engine/letterRules.test.ts` PASS.
- [ ] **Step 7: Commit** — `git commit -m "Re-sign window grouped by the size of the deal asked"`.

### Task 4: The lineup lean (young players get the job early)

**Files:**
- Modify: `src/engine/coachDecisions.ts` (`START_LEAN`, `startLean`, `startScore`; `coachOrder` ~:54; the quirk-note
  comparison ~:186 ranks by `startScore`)
- Test: `src/engine/coachDecisions.test.ts` (create or extend)

**Interfaces:**
- Produces: `export const START_LEAN: { firstRound: number; secondRound: number; young: number; fullThrough: number; fadeBy: number; ageCap: number }`
  (starting values: `firstRound 0.8`, `secondRound 0.5`, `young 0.4`, `fullThrough 1` (experience 0–1 full),
  `fadeBy 3` (zero from his third season, experience ≥ 2 half), `ageCap 25` (zero from 25));
  `export function startLean(p: Pick<Player, 'age' | 'experience' | 'draft'>): number` (the larger of the pick lean and
  `young`, times the fade);
  `export function startScore(p: Player, position: Position): number` (= `slotOvr(p, position) + startLean(p)`).

- [ ] **Step 0: Re-check the draft-round breakdown on main** with a scratch probe: start rate of rostered players 21–24
  by draft round (1, 2–3, 4–7, undrafted) in seasons 11–20 of two leagues, against the NFL's .42–.55 overall. If round 1
  no longer starts at the NFL's rate and rounds 2–7 do, stop and tell the owner before tuning (approach a rests on it).
- [ ] **Step 1: Write the failing tests**:
  - `startLean gives a first-round rookie 0.8, a second-rounder 0.5, an undrafted 22-year-old 0.4, and nothing at 25 or
    in his third season`;
  - `coachOrder starts a first-round rookie 0.5 below the veteran, and the veteran 1.0 above him`;
  - `a coach's quirk note never names the youth lean` (a staff with no quirk produces no note when a rookie starts
    through the lean);
  - `an unavailable rookie never starts through the lean` (he isn't in the pool `buildAutoDepthChart` is given);
  - `a chart you set yourself keeps your order` (`syncDepthChart` with `autoDepth` false leaves placed players as placed).
- [ ] **Step 2: Run them** — FAIL.
- [ ] **Step 3: Implement** `START_LEAN`, `startLean`, `startScore`; `coachOrder` sorts by `startScore +
  selectionPreference`; the quirk-note pass ranks `usual` by `startScore`.
  One rule for every chart: no win-now term (the spec left it to the builder; `buildAutoDepthChart` has no team, and a
  new league's charts are built before GMs read the room), so AI teams, your staff's sort and game-day charts agree.
- [ ] **Step 4: Run them** — PASS.
- [ ] **Step 5: Tune with fast probes** (a scratch script playing two 12-season leagues with `START_LEAN` overridden,
  reading starters 24 or younger and still-starting by age in seasons 6–12), then one `npm run careers`: starters 24 or
  younger inside 28.2–36.2%, QBs inside 22.5–42.5%, still starting by age inside the NFL's bands (spec Goals). Record the
  values that pass.
- [ ] **Step 6: Hold play and the room**: `npm run sim -- 60` (every line in its bands, the two-band lines included),
  `npm run morale` (benching, talks, disputes), `npm run endings`. A miss goes to the owner with evidence.
- [ ] **Step 7: Re-pin moved fixtures** as in Task 2 Step 9 (`2026-11-15: the lineup lean`).
- [ ] **Step 8: Commit** — `git commit -m "The lineup lean: young players get the job early (startScore)"`.

### Task 5: Read the market; spring cuts only if it is still short

**Files (only if built):**
- Modify: `src/engine/offseason/ai.ts` (`aiSpringCuts`), `src/engine/offseason/index.ts` (call it at the new league
  year, before the re-sign window)
- Test: `src/engine/offseason/springCuts.test.ts`

**Interfaces (only if built):**
- Produces: `export function aiSpringCuts(league: League, team: Team): Player[]` (the veterans it released): a veteran
  whose cap hit exceeds his outlook's market worth by a margin and whose dead money fits the team's books, never a
  player inside `KEEP_MIN` or signed this league year.

- [ ] **Step 1: Read** `npm run offseason -- 6` after Tasks 2 and 4: good outside signings a year. At 75 or more (the
  usual band) skip to Task 6 and note "spring cuts not needed" in the spec.
- [ ] **Step 2 (only if under 75): Write the failing tests** `aiSpringCuts releases an overpaid veteran before the market
  opens` and `never cuts a player the team can't replace at his position (KEEP_MIN) or one signed this year`.
- [ ] **Step 3: Run them** — FAIL. **Step 4: Implement** `aiSpringCuts` and its call. **Step 5: Run them** — PASS.
- [ ] **Step 6: Tune** to the NFL's 41–59 released veterans a year at 0.8%+ of the cap, with `offseason`'s dead-money
  bands held; re-run `npm run offseason -- 6` and `npm run trades`.
- [ ] **Step 7: Commit** — `git commit -m "Spring cuts of overpaid veterans"`.

### Task 6: Judge the lines, document, verify, and ship

**Files:**
- Modify: `scripts/careers.ts` (the age block: `24 or younger %` and `still starting %` lines from `soft` to `judge`;
  the 31–32 exits stay soft; the known-issue banner names only what remains)
- Modify: `docs/MVP.md` (the free-agency market item and "Starters leave football more" item), `docs/GAME_DESIGN.md`
  (how players develop and age: who starts; contracts), `CLAUDE.md` (the `careers` and `offseason` descriptions),
  `docs/superpowers/specs/2026-11-15-front-offices-design.md` (what was built), `package.json` (patch bump),
  `src/ui/changelog.ts` (an entry in a player's words)

- [ ] **Step 1: Switch the careers lines to judged** and run `npm run careers` once: 0 outside target range.
- [ ] **Step 2: Docs and version**: the edits above; `npx vitest run src/ui/changelog.test.ts` PASS.
- [ ] **Step 3: Full local verification** (sequential, so timings stay honest): `npx vitest run`, `npm run typecheck`,
  `npm run format:check`, `npm run offseason -- 6`, `npm run trades`, `npm run morale`, `npm run sim -- 60`,
  `npm run careers`, `npm run gm-habits`, `npm run gm-habits -- --effects --no-churn`, `npm run audit` (commit the
  regenerated `docs/ATTRIBUTES.md`), `npm run size`, `npm run quirks -- --effects`, `npm run parity`. Every one passes.
- [ ] **Step 4: Commit, then ask the owner** whether to open the PR; once opened, push only after local checks pass,
  then read CI and fix what is red.
