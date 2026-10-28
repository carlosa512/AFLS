# Coaching Trees (PR 4 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rare coaching trees that are born, run hot, wither and fade over a long save, starting from a few founding
trees, and that lean the coaching carousel: a head coach brings his people, searches follow a tree's standing, and
schemes carry on.

**Architecture:** A new `trees.ts` works out links (3+ seasons together), trees (two disciples became head coaches),
branches and standing from `Coach.career` plus a small `Coach.pastUnder` for founding history; nothing else is stored.
Results are cached per calendar step. `coaching.ts` reads three small terms from it in `cleanHouse`, `fillChairs`,
`asPromoted` and `headCoachVision`.

**Tech Stack:** TypeScript, Vitest, React (Vite), Prettier.

**Spec:** `docs/superpowers/specs/2026-10-28-personality-relationships-design.md` (§4, §5.3, §5.4). The research
behind §4.6 is `docs/research/coaching-trees.md`.

**Branch:** stacked on PR 3's branch; confirmed with the owner before the first push.

## Global Constraints

- Everything in PR 1's Global Constraints holds.
- A **link** needs 3+ seasons together: on a head coach's staff, or as a position coach on a coordinator's side.
- A **tree** needs two linked assistants who became head coaches. **Live**: 2+ active head coaches in it, branches
  included. Standing thresholds exactly as spec §4.6: hot ≥ .550 over 3 seasons; withering ≤ .450 over 5 seasons with
  2+ disciples fired; faded after 4 seasons with no active head coach.
- Pure functions of the seed and careers: the scheme and vision leans draw on their own streams
  (`${league.seed}:treeScheme:${coachId}:${role}`); no new draw on any existing stream.
- No fake career rows: founding history lives only in `pastUnder`, so `records.ts` never counts it.
- Carousel weights are tuned until §4.6's hire share holds; never widen a range.

## Review Focus

1. **Interim head coaches:** a season with two head coaches credits the link to the one with more weeks (Task 1
   test).
2. **A coach who served under the same man at two clubs:** seasons add up into one link (Task 1 test).
3. **A root who is also someone's disciple:** his tree is a branch of his mentor's, with no cycle and no double count
   (Task 2 test).
4. **Retired roots:** a retired legend's tree stays live through his disciples' disciples (Task 2 test).
5. **Old saves:** founding trees are seeded once on upgrade, from the league seed, the same way a new league would
   seed them (Task 3 test).

---

### Task 1: Links

**Files:**
- Create: `src/engine/trees.ts`
- Modify: `src/engine/types.ts` (`Coach.pastUnder?: { coachId: number; role: CoachRole; seasons: number }[]`)
- Test: `src/engine/trees.test.ts`

**Interfaces:**
- Consumes: `Coach.career` (`CoachSeason`: season, teamId, role, room, `record?.fromWeek/throughWeek`), `ROOM_OF`,
  `league.coaches`, `league.retiredCoaches`.
- Produces:
  - `LINK_SEASONS = 3`
  - `interface Link { mentorId: number; seasons: number; role: CoachRole }`
  - `linksOf(league: League, coachId: number): Link[]` (3+ seasons only, `pastUnder` included)
  - `mainMentor(league: League, coachId: number): Coach | undefined` (the head coach with the most seasons; most
    recent breaks a tie; looks in `coaches` and `retiredCoaches`)
  - `disciplesOf(league: League, mentorId: number): Coach[]`
  - A cache keyed by `${league.season}:${league.phase}:${league.week}` (house pattern: `viewCache`)

- [ ] **Step 1: Write the failing tests** — build careers by hand on a `createLeague({ seed: 'trees' })` league:
  three seasons as OC under one head coach → one link; two seasons → none; two seasons at one club and one at another
  under the same man → one link of 3; an interim season → the head coach with more weeks; a position coach's 3
  seasons under his side's coordinator → a link to the coordinator; `pastUnder` of 4 → a link.
- [ ] **Step 2: Run** — `npx vitest run src/engine/trees.test.ts` → FAIL.
- [ ] **Step 3: Implement**; header comment on why links take 3 seasons (the owner's call, stricter than the press:
  `docs/research/coaching-trees.md`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Coaching trees: links (three seasons together)"`

---

### Task 2: Trees, branches and standing

**Files:**
- Modify: `src/engine/trees.ts`
- Test: `src/engine/trees.test.ts`

**Interfaces:**
- Produces:
  - `type TreeStanding = 'hot' | 'steady' | 'withering' | 'faded'`
  - `interface Tree { rootId: number; disciples: number[]; branches: number[]; activeHeadCoaches: number[]; standing: TreeStanding }`
    (`disciples`: direct links who became head coaches; `branches`: roots of trees nested in this one)
  - `hasTree(league: League, coachId: number): boolean` (2+ disciples who became head coaches)
  - `treeOf(league: League, rootId: number): Tree | null`
  - `liveTrees(league: League): Tree[]` (2+ active head coaches, branches included, no tree counted inside its own
    branch twice)
  - `treeFor(league: League, coachId: number): Tree | null` (the nearest tree a coach belongs to, for searches and the
    card)
  - `standingOf(league: League, tree: Tree): TreeStanding` (thresholds from Global Constraints; win share from
    `record` on career rows, legacy rows from the team's season in `league.history`)

- [ ] **Step 1: Write the failing tests**: two disciples who became head coaches make a tree, one doesn't; a
  disciple's own tree shows as a branch; a cycle in hand-built data doesn't loop; a .600 tree over three seasons is
  hot; .420 over five with two firings is withering; .420 without firings is steady; no active head coach for four
  seasons is faded; a retired root's tree stays live through a grand-disciple.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Coaching trees: trees, branches and standing"`

---

### Task 3: Founding trees

**Files:**
- Modify: `src/engine/trees.ts` (`seedFoundingTrees`)
- Modify: `src/engine/generate.ts` (`createLeague`: call it after `generateCoachingWorld`; `SAVE_VERSION` + 1)
- Modify: `src/engine/migrate.ts` (the step calls `seedFoundingTrees(league)` once)
- Test: `src/engine/trees.test.ts`

**Interfaces:**
- Produces: `seedFoundingTrees(league: League): void` on `new Rng(\`${league.seed}:trees:init\`)`: 3–4 roots; one or
  two are retired legends (new coaches made with the same constructor `generateCoachingWorld` uses, aged 66–80, moved
  into `retiredCoaches` the way retirement does at `coaching.ts:1404`); the rest are active head coaches aged 55+. Each
  root gets two active head coaches as disciples and one to three coordinators or position coaches, each with a
  `pastUnder` entry of 3–6 seasons in a fitting role. A head coach joins at most one founding tree.

- [ ] **Step 1: Write the failing tests**: a new league has 3–4 live trees with 6–8 of its head coaches in them;
  the same seed gives the same trees; no career row is added (`records.ts` totals unchanged); a v(N−1) save upgraded
  has the same trees a new league from that seed would.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `npx vitest run src/engine/trees.test.ts src/engine/records.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Coaching trees: a few founding trees at the start (save bump)"`

---

### Task 4: The carousel

**Files:**
- Modify: `src/engine/coaching.ts:1704` (`cleanHouse`), `:1783` (`fillChairs`' `score`), `:973` (`asPromoted`),
  `:454` (`headCoachVision`)
- Test: `src/engine/coaching.test.ts` (or `trees.test.ts` for the pure parts)

**Interfaces:**
- Consumes: `linksOf`, `mainMentor`, `treeFor`, `standingOf`.
- Produces (constants in `coaching.ts`, starting values, tuned in Task 6):
  - `TREE_KEEP = 0.25`: added to `wanted`'s chance in `cleanHouse` for a coach linked to the new head coach
  - `TREE_PULL = 0.5`: subtracted from `score` for a candidate linked to the hiring head coach (any chair)
  - `TREE_STANDING: Record<TreeStanding, number> = { hot: -0.4, steady: -0.15, withering: 0.4, faded: 0 }`: added to
    `score` in a head-coach search for a candidate whose `treeFor` has that standing
  - `TREE_SCHEME = 0.5`: in `asPromoted`, on `${league.seed}:treeScheme:${c.id}:${chair.role}`, the chance a new
    coordinator takes his main mentor's offense (OC) or front and coverage (DC) instead of his own roll
  - In `headCoachVision`, a head coach who didn't inherit last season's coordinators takes
    `pass = 0.5 × his own + 0.5 × his main mentor's style.passLean` when the mentor has one

- [ ] **Step 1: Write the failing tests**: a linked coordinator is kept more often than an unlinked one over many
  seeds (same vision fit); a linked candidate outranks an equal unlinked one; a hot tree's disciple outranks an equal
  outsider in a head-coach search and a withering one's ranks below; `asPromoted` is stable for a seed and takes the
  mentor's scheme about half the time over many coaches; `headCoachVision` is a pure function (same call, same
  answer).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, each term with a one-line comment on why.
- [ ] **Step 4: Run** — `npx vitest run src/engine/coaching.test.ts src/engine/trees.test.ts && npm run sim -- 10`
  → PASS, league totals in range.
- [ ] **Step 5: Commit** — `git commit -m "Coaching trees: he brings his people, searches follow standing, schemes carry on"`

---

### Task 5: The coach card, news and letters

**Files:**
- Modify: `src/ui/screens/Coaches.tsx` (`CoachCard`: a **Tree** section)
- Modify: `src/engine/lockerMail.ts` (SNN items), `src/engine/inbox.ts:2137` (`poachedMail`: the staff line)
- Test: `src/ui/gm.test.tsx` (renders `CoachCard`), `src/engine/inbox.test.ts`

**Interfaces:**
- Consumes: `treeFor`, `treeOf`, `mainMentor`, `disciplesOf`, `standingOf`.
- Produces:
  - Card words for standing: hot *"the hottest tree in the league"* (or *"one of the hottest"* when two are hot),
    steady *"a respected tree"*, withering *"hasn't produced a winner in years"*, faded *"one of the great trees of its
    day"*. A former player who coaches for the head coach he played for: *"Played for Haskins, now coaches for him."*
    Nothing at all for a coach with no links.
  - SNN items (ids): `tree:${season}:born:${rootId}` when a root's second disciple becomes a head coach;
    `tree:${season}:${week}:meet:${gameId}` the week before the first ever game between a mentor and his disciple as
    head coaches; `tree:${season}:retired:${rootId}` when the root of a live tree retires.
  - `poachedMail` adds: *"…the third head coach off our staff in five years."* when two or more others left our staff
    to be head coaches in the last five seasons (career rows).

- [ ] **Step 1: Write the failing tests**: the card lists mentor, disciples (through the coach link component) and
  the standing words, never a number; a coach without links shows no Tree section; each SNN item arrives once and
  passes the banned-words check; the poached letter counts correctly.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `npx vitest run src/ui src/engine/inbox.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Coaching trees: the coach card, SNN and the poached letter"`

---

### Task 6: The NFL numbers, docs and the PR

**Files:**
- Modify: `scripts/careers-league.ts` (`LeagueRun.trees`), `scripts/careers.ts` (judge them)
- Modify: `docs/GAME_DESIGN.md` (roadmap: coaching trees built), `CLAUDE.md` (architecture line for `trees.ts`),
  `package.json`, `src/ui/changelog.ts`

**Interfaces:**
- Produces: `LeagueRun.trees: { live: number[]; biggest: number[]; inTreeShare: number[]; hires: number; hiresFromTree: number; worstOffseasonShare: number; born: number; foundingAlive: number }`
  (per season where it says `[]`).

- [ ] **Step 1: Add the checks** with the script's range helper, exactly the spec §4.6 table: live trees `[2, 5]`
  every season; biggest `[3, 6]`; head coaches in a live tree `[0.15, 0.40]`; hires from a tree over the run
  `[0.10, 0.35]`; the most any one tree took of one offseason `≤ 0.40`; new trees `[1, 4]` per league; founding trees
  alive at season 16 `≥ 1` per league.
- [ ] **Step 2: Run and tune** — `npm run careers`. Tune `TREE_PULL`, `TREE_KEEP`, `TREE_STANDING` only.
- [ ] **Step 3: Run the rest** — `npm run offseason -- 6 && npm run sim -- 10` → nothing flagged.
- [ ] **Step 4: Docs, version, commit, push**

```bash
npm run format
git add scripts/careers.ts scripts/careers-league.ts docs CLAUDE.md package.json src/ui/changelog.ts
git commit -m "Coaching trees 0.2.x: NFL numbers in careers, docs and changelog"
git push -u origin <PR 4 branch>
```

- [ ] **Step 5: When the owner asks, open the PR (base: PR 3's branch), then read CI and fix anything red.**
