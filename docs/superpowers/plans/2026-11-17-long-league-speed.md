# Long Leagues Stay Fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A season ten years into a league runs within 10% of an early one, with every seeded league byte-identical to
today's.

**Architecture:** Indexes beside the league (a `WeakMap`, never in the save), like `teamPlayers`: players still in
football and unsigned players, kept current by `addPlayer`, `setTeam` and a new `retirePlayer`; hot loops read them
instead of every player who ever played. The coaching-trees cache stops rebuilding every week. A fingerprint script
proves nothing in play moved.

**Tech Stack:** TypeScript, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-17-long-league-speed-design.md`

## Global Constraints

- Byte-identical: the same seed gives the same league JSON before and after every task (`scripts/fingerprint.ts`).
  Any difference stops the work until explained; no test may move.
- No new stored field, no `SAVE_VERSION` bump; indexes live in a `WeakMap` keyed by the league.
- Every index lists players in id order, the order `Object.values(league.players)` gives.
- An index read returns a `readonly Player[]` (TypeScript stops an in-place sort or splice by a caller).
- No `Math.random`, no new draws.
- One CPU-heavy job at a time.
- Stop rule: the named loops, then up to three profile rounds; past 10% slower, stop and bring the owner the numbers.
- Version: `package.json` 0.4.51 (a fix), a changelog entry in `src/ui/changelog.ts` (≤ 200 characters).

## Review Focus

1. A loop switched to `activePlayers` that read retired players after all (a former player turned coach, records):
   the fingerprint catches play; screens it doesn't. The reviewer checks each switched loop's filter was `!retired`.
2. A player retired or moved behind the writers' backs (`migrate.ts`, tests): the index heals on read (tested in
   Task 2).
3. A caller that kept a returned array and mutated it, or mutated the league while iterating it (a loop that retires
   or signs players while walking `activePlayers`): iterate a copy where the loop body can change the index.
4. A league copied with `structuredClone` or `JSON.parse` in tests: it builds its own indexes (tested in Task 2).
5. Draft prospects: in `activePlayers` (not retired), never in `freeAgents` (tested in Task 3).

---

### Task 1: The fingerprint and the baseline

**Files:**
- Create: `scripts/fingerprint.ts`
- Modify: `package.json` (script `"fingerprint": "tsx scripts/fingerprint.ts"`)

**Interfaces:**
- Produces: `npm run fingerprint -- <seed> <seasons> [--personnel]` prints one line:
  `<seed> <seasons> <personnel on|off> <sha256 of JSON.stringify(league)>` after playing that many seasons with
  `simToEndOfSeason`, `beginOffseason` and `advanceOffseason(l, { autoUser: true })` to the next regular season.

- [ ] **Step 1:** Write the script (no test: it is the test harness).
- [ ] **Step 2: Baseline on this commit, before any engine change:**

Run: `npm run fingerprint -- fp-a 3 --personnel` and `npm run fingerprint -- fp-b 3`
Expected: two hashes. Run each twice; the same hash both times (the script itself is deterministic). Record both in
the ledger as the baseline.

- [ ] **Step 3: Commit** `git commit -m "scripts: fingerprint a seeded league"`

### Task 2: `retirePlayer` and `activePlayers`

**Files:**
- Modify: `src/engine/roster.ts`, `src/engine/offseason/index.ts` (the new league year's retirement),
  `src/engine/personnel/futures.ts` (`retireCastoffs`)
- Test: `src/engine/roster.test.ts` (create)

**Interfaces:**
- Produces: `retirePlayer(league: League, p: Player): void` (sets `p.retired = true` and keeps the indexes current;
  nothing else) and `activePlayers(league: League): readonly Player[]` (every player not retired, id order).
- Callers keep their own other steps around `retirePlayer` in the same order as today.

- [ ] **Step 1: Failing tests** in `roster.test.ts`, on a league played a season (`createLeague` + `simToEndOfSeason` +
  `beginOffseason`, built once in `beforeAll`):

```ts
const truth = (l: League) => Object.values(l.players).filter((p) => !p.retired);
it('lists every player still in football, in id order', () => {
  expect(activePlayers(l).map((p) => p.id)).toEqual(truth(l).map((p) => p.id));
});
it('drops a player retirePlayer retires and adds one addPlayer adds, in id order', () => {
  // retire one active player, add a new one with an id below the max (in its place by id)
  // expect activePlayers ids === truth(l) ids after each
});
it('heals when a player is retired behind its back', () => {
  // read activePlayers once, then set p.retired = true directly; next read excludes him
});
it('a copied league builds its own list', () => {
  // structuredClone(l): retire a player in the copy; the original's activePlayers still lists him
});
```

- [ ] **Step 2:** `npx vitest run src/engine/roster.test.ts` — Expected: FAIL (`activePlayers` not exported).
- [ ] **Step 3: Implement** in `roster.ts` beside `byTeam`: a `WeakMap<League, Player[]>` built in one pass on first
  read; `addPlayer` places a new player by id (reuse `place`); `retirePlayer` removes him; a read checks the listed
  players for one now retired and rebuilds if found. Switch the two engine retirement writers to `retirePlayer`.
- [ ] **Step 4:** `npx vitest run src/engine/roster.test.ts && npm run typecheck` — PASS. Then both fingerprints from
  Task 1 — Expected: identical to the baseline.
- [ ] **Step 5: Commit** `git commit -m "roster: retirePlayer and a list of players still in football"`

### Task 3: Free agents from the unsigned list

**Files:**
- Modify: `src/engine/roster.ts`, `src/engine/offseason/negotiation.ts` (`freeAgents`)
- Test: `src/engine/roster.test.ts`

**Interfaces:**
- Produces: `unsignedPlayers(league: League): readonly Player[]` (not retired, `teamId === null`, id order), kept
  current by `setTeam`, `addPlayer` and `retirePlayer`, healing as Task 2. `freeAgents` filters it with today's
  squad, waiver and prospect conditions: same result, same order.

- [ ] **Step 1: Failing tests:**

```ts
it('lists the unsigned, in id order, through signings and cuts', () => {
  // setTeam a free agent to a club and a rostered player to null; after each:
  expect(unsignedPlayers(l).map((p) => p.id)).toEqual(
    Object.values(l.players).filter((p) => !p.retired && p.teamId === null).map((p) => p.id));
});
it('freeAgents is what it always was, prospects never in it', () => {
  const prospects = new Set(l.draftClass);
  const old = Object.values(l.players).filter(
    (p) => p.teamId === null && !p.retired && !p.squad && !p.waiver && !prospects.has(p.id));
  expect(freeAgents(l).map((p) => p.id)).toEqual(old.map((p) => p.id));
  for (const id of l.draftClass) expect(freeAgents(l).some((p) => p.id === id)).toBe(false);
});
```

  (The prospect test runs on a league in its draft phase, where `draftClass` is filled.)
- [ ] **Step 2:** run, see them fail. **Step 3:** implement. **Step 4:** the tests, typecheck, both fingerprints
  identical. **Step 5:** commit `"negotiation: free agents read the unsigned list"`.

### Task 4: The hot loops

**Files:** the loops the recon named (`morale.ts` `moraleContext`/`moraleMean`, `scouting.ts`,
`personnel/service.ts` `serviceRoster`, `personnel/payroll.ts`, `personnel/squadMarket.ts`, `relationships.ts`
`rapport`/`contractLean`, `offseason/ai.ts`), then any other loop a profile shows.

**Interfaces:**
- Consumes: `activePlayers` (Task 2), `unsignedPlayers` (Task 3).

- [ ] **Step 1:** For each named loop: if it walks `Object.values(league.players)` and skips retired players before
  anything else, read `activePlayers` (or `unsignedPlayers` when it also needs `teamId === null`) and drop the now-dead
  filter. A loop that reads retired players stays. A loop body that can retire, add or sign players iterates a copy.
- [ ] **Step 2:** after each file: `npm run typecheck`, the file's own tests, both fingerprints identical.
- [ ] **Step 3: Measure** with the two-save probe (a season from the season-1 save and from the season-10 save of
  `archive-probe`, personnel on; the probe scripts in the scratchpad's `prof/`, rebuilt from main if missing). Record
  both times and the ratio.
- [ ] **Step 4:** while the season-10 season is more than 10% slower: profile both again, switch the next loops the
  profile names, repeat Steps 2–3; at most three rounds. Past that, stop and bring the owner the numbers.
- [ ] **Step 5:** commit per file or per round, `"<file>: walk players still in football"`.

### Task 5: Coaching trees rebuilt when careers change

**Files:**
- Modify: `src/engine/trees.ts` (`index`'s cache key)
- Test: `src/engine/trees.test.ts`

- [ ] **Step 1: Failing test** `"the trees a cached read gives are the ones a fresh build gives, week by week"`: play a
  season week by week; each week compare `linksOf`, `disciplesOf` and `treeFor` for every coach on the
  league against the same on `JSON.parse(JSON.stringify(l))` (a fresh build); count the rebuilds through a test-only
  counter (`treeBuilds()`), and assert fewer rebuilds than weeks played.
- [ ] **Step 2:** run, see it fail on the rebuild count. **Step 3:** key the cache on what the build reads changing
  (the league year, the coach and retired-coach counts, and each coach's career length), not the week. If any weekly
  comparison differs, keep the week in the key and make `build` cheaper instead (a ruling in the ledger).
- [ ] **Step 4:** trees tests, typecheck, both fingerprints identical. **Step 5:** commit.

### Task 6: Checks, docs and the PR

**Files:** `CLAUDE.md` (the conventions line: a player retires through `retirePlayer`; `roster.ts` gains
`activePlayers`/`unsignedPlayers`), `src/ui/changelog.ts`, `package.json` 0.4.51, the spec ("What was built" with the
times).

- [ ] **Step 1:** `npx vitest run src/engine` (the engine suite; results must be unchanged, since play is identical).
- [ ] **Step 2:** `npm run careers` once; record its time against main's (about 16 minutes locally on 4 cores).
- [ ] **Step 3:** docs, version, changelog ("Long careers play faster: later seasons no longer slow down." or similar).
- [ ] **Step 4:** a fresh reviewer on the branch (Review Focus above); fix Critical/Important with a failing test first.
- [ ] **Step 5:** push, open the PR, read CI; every check's numbers should match main's.
