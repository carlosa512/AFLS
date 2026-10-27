# Player Origins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player gets an origin (a US college by tier, the International Pathway with a country, or the CFL),
shown on his card and the draft board, feeding only the fog of war, with Pathway and CFL arrivals each offseason.

**Architecture:** A static append-only table (`data/origins.ts`) and a pure draw module (`origin.ts`) on its own
seeded stream. Generation sites call it after `generatePlayer`. `knowledge()` scales film by origin. A new
personnel profile `afls-2026-v2` adds the international squad place. A v54 migration fills old saves.

**Tech Stack:** TypeScript, Vitest, React (Vite).

**Spec:** `docs/superpowers/specs/2026-10-27-player-origins-design.md`

## Global Constraints

- Origin never reads a name or a heritage; `identity.ts` and `data/heritage.ts` are unchanged.
- No `Math.random`. Every origin draw uses `new Rng(`${league.seed}:origin:${playerId}`)`; arrivals use
  `new Rng(`${league.seed}:pathway:${season}`)` and `new Rng(`${league.seed}:cfl:${season}`)`.
- True ratings, development, contracts, trade value and the match engine never read origin.
- `ORIGINS` is append-only: an index is a saved id.
- Real school names only: no nicknames, mascots, colors or CFL club names.
- Screens render origin only through `OriginTag`; not on rosters, free agency or stats tables.
- `SAVE_VERSION` 53 → 54. `package.json` 0.2.0 → 0.2.1 with a `src/ui/changelog.ts` entry.
- Never loosen an audit range. Run `npm run format` before each commit.

## Review Focus

1. An `origin` id beyond the table (a mod that shortened `ORIGINS`) → `OriginTag` renders nothing, no crash (Task 8).
2. A Pathway player who later earns service → still shows his Pathway origin; the reserved place takes only a Pathway
   player with no seasons of service (Task 6).
3. A legacy retired player with no draft record and stale ratings → migration still assigns a college (Task 7).
4. A CFL veteran after his first NFL season → `cflSeasons` is dropped and normal pro film applies (Tasks 4, 5).
5. A v1 career (squads already on) → still exactly 16 places, UI says "16", no reserved place (Task 6).

---

### Task 1: The origins table

**Files:**
- Create: `src/engine/data/origins.ts`
- Test: `src/engine/data/origins.test.ts`

**Interfaces:**
- Produces: `type OriginKind = 'college' | 'pathway' | 'cfl'`, `type OriginTier = 'power' | 'group5' | 'fcs' | 'small'`,
  `interface Origin { name: string; kind: OriginKind; tier?: OriginTier; weight?: number }`,
  `const ORIGINS: readonly Origin[]`, `const CFL_ORIGIN: number` (its index),
  `const PATHWAY_ORIGINS: readonly number[]`, `const COLLEGES_BY_TIER: Record<OriginTier, readonly number[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
it('pins the first entries (append-only ids)', () => {
  expect(ORIGINS.slice(0, 3).map((o) => o.name)).toEqual(['Alabama', 'Georgia', 'Ohio State']);
});
it('every college has a tier and a positive weight; others have neither', () => {
  for (const o of ORIGINS)
    o.kind === 'college' ? expect(o.tier && o.weight! > 0).toBeTruthy() : expect(o.tier ?? o.weight).toBeUndefined();
});
it('has one CFL entry, at least 12 Pathway countries and every tier', () => {
  expect(ORIGINS.filter((o) => o.kind === 'cfl')).toHaveLength(1);
  expect(PATHWAY_ORIGINS.length).toBeGreaterThanOrEqual(12);
  for (const t of ['power', 'group5', 'fcs', 'small'] as const) expect(COLLEGES_BY_TIER[t].length).toBeGreaterThan(5);
});
it('names are unique', () => expect(new Set(ORIGINS.map((o) => o.name)).size).toBe(ORIGINS.length));
```

- [ ] **Step 2: Run** `npx vitest run src/engine/data/origins.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Write the table.** Order: Alabama, Georgia, Ohio State first, then the rest of the power schools
  (SEC, Big Ten, ACC, Big 12, Notre Dame), Group of 5 (all), FCS (about 40 with NFL alumni), small (about 25 Division
  II/III and NAIA), the Pathway countries (Germany, United Kingdom, Australia, Nigeria, Mexico, France, Austria,
  Italy, Brazil, Japan, Ghana, New Zealand, Canada, Ireland, Sweden), then `CFL`. College weights are each school's
  approximate NFL players on rosters (round numbers, top power schools about 50–60, small schools 1–3). A header
  comment cites the spec's sources and says the table is moddable data.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `Origins: the school, Pathway and CFL table`.

### Task 2: The origin draw

**Files:**
- Create: `src/engine/origin.ts`
- Test: `src/engine/origin.test.ts`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `type RankBand = 0 | 1 | 2 | 3` (rows: 1–32, 33–100, 101–224, 225+/undrafted)
  - `bandForRank(rank: number): RankBand`
  - `bandForDraftRound(round: number): RankBand` (1 → 0, 2–3 → 1, 4–7 → 2)
  - `bandForShare(share: number): RankBand` (his overall's place at his position, 0 = best: <0.2 → 0, <0.45 → 1,
    <0.8 → 2, else 3)
  - `collegeOrigin(seed: string, playerId: number, band: RankBand): number`
  - `originOf(p: Player): Origin | undefined`
  - `FILM: Record<OriginTier | 'pathway', number>` = `{ power: 1, group5: 0.85, fcs: 0.7, small: 0.55, pathway: 0.4 }`
  - `filmScale(p: Player): number` (1 when no origin, CFL or unknown id)
- `TIER_ODDS` (private) are the spec's table: `[[0.97,0.03,0,0],[0.9,0.08,0.02,0],[0.8,0.13,0.05,0.02],[0.55,0.2,0.17,0.08]]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is deterministic per seed and id', () =>
  expect(collegeOrigin('s', 7, 2)).toBe(collegeOrigin('s', 7, 2)));
it('a class lands on the real draft mix', () => {
  // 224 drafted, ranks 1..224, over 200 classes
  // expect power 0.83–0.89, group5 0.08–0.12, fcs 0.02–0.05, small ≤ 0.02
});
it('a roster (70% drafted, 30% undrafted) lands near FBS 0.89, FCS 0.075, small 0.03', () => {
  // FBS (power + group5) 0.86–0.92, fcs 0.06–0.10, small 0.015–0.045
});
it('reads no name: the same seed and id give the same origin whatever the player is called', () => {
  // collegeOrigin takes no Player; assert its signature by calling with only (seed, id, band)
});
it('filmScale follows the tier and is 1 for CFL or a missing origin', () => { /* FILM values */ });
```

- [ ] **Step 2: Run** `npx vitest run src/engine/origin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `collegeOrigin`: one stream `new Rng(`${seed}:origin:${id}`)`; `rng.weighted` over the
  band's tiers, then over `COLLEGES_BY_TIER[tier]` by `weight`.
- [ ] **Step 4: Run.** Expected: PASS. If a share misses, tune `TIER_ODDS` (not the test ranges).
- [ ] **Step 5: Commit** `Origins: the seeded draw by rank band`.

### Task 3: Every new player gets an origin

**Files:**
- Modify: `src/engine/types.ts` (`Player.origin?: number; cflSeasons?: number` with doc comments)
- Modify: `src/engine/generate.ts` (`createLeague`, around line 735: after each position's players are made, rank by
  overall within position and set `p.origin = collegeOrigin(seed, p.id, bandForShare(i / n))`)
- Modify: `src/engine/offseason/draft.ts` (`generateDraftClass`: `p.origin = collegeOrigin(league.seed, p.id,
  bandForRank(i + 1))` before the consensus draw; the consensus noise becomes `rng.normal(0, 1) * CONSENSUS_SD.x /
  Math.sqrt(filmScale(p))`, same number of draws)
- Modify: `src/engine/offseason/ai.ts` (`streetFreeAgent`: band 3) and `src/engine/personnel/squadMarket.ts`
  (`ensureSquadSupply`: band 3)
- Test: `src/engine/origin.test.ts` (league section)

**Interfaces:** Consumes Task 2.

- [ ] **Step 1: Write the failing tests**

```ts
it('every player of a new league and a draft class has a college origin', () => {
  const l = createLeague({ seed: 'o1' /* minimal options as other tests use */ });
  for (const p of Object.values(l.players)) expect(ORIGINS[p.origin!]?.kind).toBe('college');
});
it('draft-class ratings are unchanged by origins (fingerprint)', () => {
  // generateDraftClass on a fixed seed: the ratings of every prospect equal a stored snapshot hash taken on main
  // before this change (compute it with git stash once and paste the number)
});
it('a top-32 prospect is almost always from a power school', () => { /* over several classes, ≥ 0.95 */ });
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the four call sites as listed.
- [ ] **Step 4: Run** the new tests plus `npx vitest run src/engine/offseason src/engine/personnel`. Expected: PASS
  (any existing snapshot that includes `scouting.grade` moves; update it only if the change is the noise scale).
- [ ] **Step 5: Commit** `Origins: every new player gets a school`.

### Task 4: The fog of war

**Files:**
- Modify: `src/engine/scouting.ts` (`knowledge`)
- Test: `src/engine/scouting.test.ts`

**Interfaces:** Consumes `filmScale` (Task 2), `Player.cflSeasons` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
it('prospects on less film start less known: power > group5 > fcs > small > pathway', () => {
  // same prospect (fixed grade), origin swapped; knowledge for an AI team with no visits strictly decreasing
});
it('own players stay exact and visits still narrow a pathway prospect', () => { /* knowledge = 1; after scoutPlayer, higher */ });
it('a CFL veteran sits between a rookie and an NFL veteran with the same years', () => {
  // experience 0, cflSeasons 4 → 0.45 + 0.08 * 2 = 0.61; NFL 4-year 0.77
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/scouting.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prospect film `(0.2 + 0.15 × …) × filmScale(p)`; pro film
  `Math.min(0.9, 0.45 + 0.08 * (p.experience + (p.experience === 0 ? (p.cflSeasons ?? 0) / 2 : 0)))`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Scouting: small schools and Pathway prospects start on less film`.

### Task 5: Pathway and CFL arrivals

**Files:**
- Create: `src/engine/offseason/arrivals.ts`
- Modify: `src/engine/offseason/draft.ts` (`finishDraft` calls `pathwayClass(league)` after the undrafted are freed)
- Modify: `src/engine/offseason/index.ts` (`beginOffseason`, right after `generateDraftClass`: `cflArrivals(league)`)
- Modify: `src/engine/offseason/index.ts` or `development.ts` where experience ticks: delete `p.cflSeasons` once
  `p.experience > 0`
- Test: `src/engine/offseason/arrivals.test.ts`

**Interfaces:**
- Produces: `PATHWAY_CLASS = 13`, `CFL_ARRIVALS = 6` (AFLS estimate, commented),
  `pathwayClass(league: League): Player[]`, `cflArrivals(league: League): Player[]`, `isPathway(p: Player): boolean`.
- Pathway: positions weighted `{ DT: 3, EDGE: 2, OL: 3, TE: 2, RB: 2, LB: 1, P: 0.6, K: 0.4 }`; age 22–26; quality
  `rng.float(5, 8)`; potential `ovr + rng.float(1, 5)`; experience 0; `ensureService(p, season)`; origin a
  `PATHWAY_ORIGINS` entry.
- CFL: positions by `SUPPLY_WEIGHT` shape (any but K/P weighted low); age 24–29; `cflSeasons` 1–4; quality
  `rng.float(7, 10)`, one in six `rng.float(10, 12.5)`; experience 0, no service; origin `CFL_ORIGIN`.
- Both: `teamId: null`, no contract, `recordRatings`, added to `league.players`.

- [ ] **Step 1: Write the failing tests**

```ts
it('13 Pathway players join the pool after the draft, each with a country', () => { /* finishDraft on a league */ });
it('6 CFL veterans arrive at the new league year, squad-eligible, with no NFL service', () => {
  // squadCategory === 'base'; cflSeasons 1–4
});
it('arrivals are deterministic per seed and season', () => {});
it('a CFL veteran loses cflSeasons after his first NFL season', () => {});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/offseason/arrivals.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `arrivals.ts` and the two call sites.
- [ ] **Step 4: Run** the new tests and `npx vitest run src/engine/offseason`. Expected: PASS.
- [ ] **Step 5: Commit** `Offseason: a Pathway class after the draft and CFL veterans each new league year`.

### Task 6: The international practice-squad place (profile v2)

**Files:**
- Modify: `src/engine/personnel/types.ts` (`profile: 'afls-2026-v1' | 'afls-2026-v2'`)
- Modify: `src/engine/personnel/rules.ts` (`PERSONNEL_RULES_V2` = v1 plus `internationalPlace: true`;
  `initialPersonnelState()` uses v2; `squadPlaces(league): number` returns 16 or 17;
  `hasInternationalPlace(league): boolean`)
- Modify: `src/engine/personnel/eligibility.ts` (`squadFit`: on v2, set aside one `isPathway` player with zero service
  seasons, then apply the 16/6/10 rules to the rest)
- Modify: `src/engine/personnel/squads.ts:29`, `squadMarket.ts:43,140` (replace `16` with `squadPlaces(league)`;
  the AI loop, when the international place is open, ranks Pathway players by its own `potMid` and signs the best
  if he reads at least as well as its worst squad player)
- Modify: `src/ui/screens/PracticeSquad.tsx` (the four `16`s read `squadPlaces(league)`; on v2, one line: "plus one
  place for an International Pathway player")
- Modify: `docs/PRACTICE_SQUADS.md` (the v2 profile row)
- Test: `src/engine/personnel/squads.test.ts`

**Interfaces:** Consumes `isPathway` (Task 5). Produces `squadPlaces`, `hasInternationalPlace`.

- [ ] **Step 1: Write the failing tests**

```ts
it('v2: a 17th player fits only when he is a Pathway player with no service', () => {});
it('v1: still 16, a Pathway player takes a standard place', () => {});
it('AI clubs fill the international place from the Pathway pool on v2', () => {});
it('new careers start on afls-2026-v2', () => expect(initialPersonnelState().profile).toBe('afls-2026-v2'));
```

- [ ] **Step 2: Run** `npx vitest run src/engine/personnel`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the listed changes.
- [ ] **Step 4: Run** `npx vitest run src/engine/personnel src/ui`. Expected: PASS.
- [ ] **Step 5: Commit** `Practice squads: profile v2 adds the international place`.

### Task 7: Migration to v54

**Files:**
- Modify: `src/engine/generate.ts` (`SAVE_VERSION = 54`)
- Modify: `src/engine/migrate.ts` (`toV54`: every player without `origin`, retired included, gets
  `collegeOrigin(league.seed, p.id, band)` where band is `bandForDraftRound(p.draft.round)` or, without a draft
  record, `bandForShare` from his `playerOvr` among same-position players in the save; profile stays as saved)
- Test: `src/engine/origin.test.ts` (migration section)

- [ ] **Step 1: Write the failing tests**

```ts
it('a v53 save gets an origin for every player, deterministically', () => {
  // createLeague, strip origin, version = 53; migrate twice from clones; equal origins, all colleges
});
it('a retired player with no draft record migrates', () => {});
it('a migrated career keeps afls-2026-v1', () => {});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `toV54` with a one-line `// v54:` comment like its neighbors.
- [ ] **Step 4: Run** `npx vitest run src/engine` (all `SAVE_VERSION` tests). Expected: PASS.
- [ ] **Step 5: Commit** `Saves: v54 gives every player an origin`.

### Task 8: Screens

**Files:**
- Create: `src/ui/origin.tsx` (`OriginTag({ player }: { player: Player })`: a college as plain text; Pathway as
  `<span className="tag-pill tag-pathway">Pathway · {country}</span>`; CFL as `tag-pill tag-cfl`; nothing when
  `originOf` is undefined)
- Modify: `src/styles.css` (`.tag-pathway`, `.tag-cfl` with token colors for light and dark, next to `.tag-pill`)
- Modify: `src/ui/screens/PlayerCard.tsx` (a "School" fact beside Age/height, around line 719)
- Modify: `src/ui/screens/FrontOffice.tsx` (draft board: a `SortTh label="School" k="school"` column, sort by name)
- Modify: `docs/UI.md` (origin is public; shown only via `OriginTag`, card and draft board)
- Test: `src/ui/ui.test.ts` (screen contract), `src/ui/origin.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
it('renders a college as text, Pathway and CFL as pills', () => {});
it('renders nothing for an unknown origin id', () => {});
it('screen contract: only OriginTag reads ORIGINS in src/ui', () => {
  // grep src/ui for "ORIGINS" / "originOf(" outside origin.tsx → none
});
it('the roster table shows no origin', () => {});
```

- [ ] **Step 2: Run** `npx vitest run src/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/ui` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `UI: origins on the player card and the draft board`.

### Task 9: Budget, checks, docs, version

**Files:**
- Modify: `scripts/save-budget.ts` (an `origins` entry with the measured numbers in its comment)
- Modify: `docs/MVP.md` (After alpha: **Player origins** · Already in (hooks into #9))
- Modify: `package.json` (0.2.1), `src/ui/changelog.ts` (entry "Where they came from", dated 2026-10-27)

- [ ] **Step 1: Measure** `npm run offseason -- 6` on this branch and on `origin/main`; note first-season,
  retained-seasons, games and growth sizes.
- [ ] **Step 2: Add** the `origins` allowance: measured increase plus about 20% room, numbers in the comment.
- [ ] **Step 3: Run** `npm run careers`, `npm run trades`, `npm run offseason -- 6`. Expected: nothing flagged, no
  range touched. If something moves out of range, find the cause (most likely the consensus noise or the arrivals'
  pool size) and fix it there.
- [ ] **Step 4: Docs and version**: MVP line, `package.json`, changelog. `npm run format`, `npm run typecheck`.
- [ ] **Step 5: Commit** `Origins: save allowance, docs, 0.2.1` and push.
