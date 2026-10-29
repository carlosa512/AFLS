# Morale Effects (G2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's mood starts to matter: young players' growth tilts by it week by week, every lineup plays a little
up or down by it on game day, it speeds or slows learning a new position, and an unhappy man asks his own club for more.
Your players' screens say so in words.

**Architecture:** One scale in `morale.ts` (`moodLean`, `moodPull`, `moraleMean`) that every effect reads; each effect
sits in the module that owns the number it moves (`development.ts`, `match/lineup.ts`, `training.ts`,
`offseason/negotiation.ts`). Nothing is drawn, nothing new is cached. Words go through `moraleView.effect`, the Locker
Room screen and the head coach's report.

**Tech Stack:** TypeScript, React, Vitest; scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-morale-effects-design.md` (builds on G1
`2026-10-29-morale-core-design.md` and G3 `2026-10-29-morale-talks-design.md`)

## Global Constraints

- Engine pure: no DOM, no `Math.random`, **nothing drawn from any `Rng` stream, no shared cache filled or read** for
  moods (G1 broke play once by filling `leagueMarket`'s cache). `moraleMean` is worked out on the spot.
- Effects import `moodLean` / `moodPull` from `./morale` (never re-derive them): `morale.rng.test.ts` mocks those two
  exports to zero every effect at once.
- Numbers, verbatim from the spec: `moodLean = clamp(level / 6, −1, 1)`; `moodPull = clamp((level − mean) / 6, −1, 1)`;
  growth tilt `0.10 × share × pull / (RELEASE.program + RELEASE.camp + RELEASE.season)` per step, at most ±0.10 a year,
  rising ratings only, growth years only (rolled under 26); game day `0.5 × pull` rating points; learning
  `× (1 + 0.15 × lean)`; own-club ask and walk-away `× (1 + 0.10 × −lean)` when lean < 0, `× (1 − 0.05 × lean)` when
  lean > 0; patience −1 at lean ≤ −0.5 (at least 1), +1 at lean ≥ 0.5.
- `level` is always `moraleLevel(league, p)` (stored level plus live jolts).
- Fog of war: screens read moods only through `moraleView`, for your players only. **Nothing new on the player card.**
- New prose in the coach's voice goes in `lockerVoice.ts` through `say`; no numbers in it.
- Play moves now: CI runs sim, careers, audit, offseason, training, trades and the rest. **Never loosen a range to get
  green**; if one can't be met, stop and tell the owner why.
- Vitest with `--maxWorkers=2` (more runs the container out of memory). `npm run format` before each commit. Never force
  push.
- Commit messages end with the session's attribution lines (`Co-Authored-By: …`, `Claude-Session: …`); no model names.

## Review Focus

1. **A rating stepping back mid-year** for a young player whose mood turns sour: the tilt can fall while `done` rises;
   every step must still move a rating toward its year's end or leave it. Pinned in Task 2 (no-step-back test with a
   mood that swings from Superb to Abysmal mid-season).
2. **League totals drifting because the league runs happy**: growth and game day read the pull (against the mean), so a
   league where everyone is Good gets no edge at all. Pinned in Task 1 (`moodPull` is 0 at the mean) and Task 3 (a
   lineup where every man sits at the mean has no mood entries).
3. **A free agent or another club's negotiation picking up his mood**: only `player.teamId === teamId` reads it. Pinned
   in Task 4 (another club's and a free agent's demand unchanged by mood).
4. **A live game rebuilding its lineup after an injury** losing the edge, or reading a different mean: the mean is taken
   once at kickoff and passed to every rebuild. Pinned in Task 3 (the rebuild call passes the stored mean).
5. **A save from before G2** (no `DevYear.mood`, a year that closed early): loads and plays with no tilt. Pinned in
   Task 2 (migrate test: v68 save → v69, a year with no `mood` lands as before).

---

### Task 1: The scale and what a screen sees

**Files:**

- Modify: `src/engine/morale.ts` (beside `moraleLevel`; `MoraleView`, `moraleView`)
- Test: `src/engine/morale.test.ts` (new describe `morale: the scale its effects read (G2)`)

**Interfaces:**

- Produces:
  - `export const moodLean = (level: number): number` — `clamp(level / 6, -1, 1)`
  - `export const moodPull = (level: number, mean: number): number` — `clamp((level - mean) / 6, -1, 1)`
  - `export function moraleMean(league: League): number` — mean `moraleLevel` over players with `teamId !== null` and
    a `morale`; 0 when there are none
  - `MoraleView.effect?: 'lifting' | 'costing'` — `costing` when `moodLean(level) <= -0.5`, `lifting` when `>= 0.5`

- [ ] **Step 1: Write the failing tests**

```ts
describe('morale: the scale its effects read (G2)', () => {
  it('leans −1…+1: Superb +1, Abysmal −1, Okay 0', () => {
    expect(moodLean(6)).toBe(1);
    expect(moodLean(10)).toBe(1);
    expect(moodLean(-6)).toBe(-1);
    expect(moodLean(0)).toBe(0);
    expect(moodLean(3)).toBe(0.5);
  });
  it('pulls against the league: nothing at the mean', () => {
    expect(moodPull(1, 1)).toBe(0);
    expect(moodPull(4, 1)).toBe(0.5);
    expect(moodPull(10, -2)).toBe(1);
  });
  it('averages the rostered players only', () => {
    const l = structuredClone(league);
    for (const p of Object.values(l.players)) if (p.teamId !== null) p.morale = { level: 2, jolts: [] };
    const fa = Object.values(l.players).find((p) => p.teamId === null && !p.retired)!;
    fa.morale = { level: -10, jolts: [] };
    expect(moraleMean(l)).toBeCloseTo(2, 9);
  });
  it('tells a screen what it costs him, for your players only', () => {
    const [p] = activeRoster(league, league.userTeamId);
    p.morale = { level: -4, jolts: [] };
    expect(moraleView(league, p)!.effect).toBe('costing');
    p.morale = { level: 4, jolts: [] };
    expect(moraleView(league, p)!.effect).toBe('lifting');
    p.morale = { level: 0, jolts: [] };
    expect(moraleView(league, p)!.effect).toBeUndefined();
    const theirs = activeRoster(league, (league.userTeamId + 1) % 32)[0];
    theirs.morale = { level: -8, jolts: [] };
    expect(moraleView(league, theirs)).toBeNull();
  });
});
```

(Restore any player the file's shared `league` is mutated on, as the file's other describes do.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/morale.test.ts --maxWorkers=2`
Expected: FAIL (`moodLean` is not exported)

- [ ] **Step 3: Implement** the three exports and `effect` (spread in only when set, like `promise`). Doc comments say
      who reads which: talks and learning the lean, growth and game day the pull.

- [ ] **Step 4: Run to see them pass** — same command, all of `morale.test.ts` green.

- [ ] **Step 5: Commit** — `git commit -m "Morale G2: the scale its effects read"`

---

### Task 2: Growth: mood tilts the year

**Files:**

- Modify: `src/engine/development.ts` (`DevContext`, `applyShare`, `developPlayer`, `releaseTo`, `trueUp`,
  `developBlock`, `developWeek`)
- Modify: `src/engine/types.ts` (`DevYear.mood`), `src/engine/generate.ts` (`SAVE_VERSION` 69), `src/engine/migrate.ts`
  (v69 step)
- Test: `src/engine/release.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**

- Consumes: `moodPull`, `moraleMean`, `moraleLevel` (Task 1).
- Produces:
  - `export const MOOD_TILT = { growth: 0.1 }` — a dial like `RELEASE`; the release tests and `scripts/training.ts`
    set `growth` to 0 to hold the release to one jump
  - `DevContext.mood?: number` — a year's tilt, for a one-jump replay (`developPlayer` lands rising targets at
    `1 + mood`)
  - `DevYear.mood?: number` — the tilt so far, four places, absent at 0

- [ ] **Step 1: Hold the old release tests at no tilt.** In `release.test.ts` add a file-level
      `beforeAll(() => (MOOD_TILT.growth = 0))` and `afterAll(() => (MOOD_TILT.growth = 0.1))`: they test the release,
      and moods seeded by `createLeague` would otherwise tilt them.

- [ ] **Step 2: Write the failing tests** — new describe `mood tilts a young player's year (G2)` with its own
      `beforeAll(() => (MOOD_TILT.growth = 0.1))` / `afterAll(() => (MOOD_TILT.growth = 0))`. Setup: a fresh
      `createLeague({ seed: 'tilt' })`; every player's morale `{ level: 0, jolts: [] }`; 40 rostered growth players
      (age ≤ 23, `potential > playerOvr`), the first 20 at level 10, the next 20 at −10 (so `moraleMean` is 0 and every
      pull is ±1); 10 rostered players aged 30+ at level 10. Roll each with `beginYear` on the `year()` helper's stream
      and inputs, `p.age++`, then `developBlock(league, 'program')`, `developBlock(league, 'camp')`, 18 ×
      `developWeek(league, [])`.

```ts
it('lands a Superb year where one jump with a +0.10 tilt would, an Abysmal one at −0.10', () => {
  for (const p of happy) expect(p.ratings).toEqual(jump(p, 0.1).ratings);
  for (const p of sad) expect(p.ratings).toEqual(jump(p, -0.1).ratings);
});
it('tilts only the ratings he was gaining', () => {
  // jump(p, m): developPlayer on a copy taken before the roll, with { ...ctx, mood: m }
  for (const p of [...happy, ...sad])
    ATTRIBUTES.forEach((a) => {
      const flat = jump(p, 0).ratings[a] - before.get(p.id)!.ratings[a];
      if (flat <= 0) expect(jump(p, 0.1).ratings[a]).toBe(jump(p, 0).ratings[a]);
    });
});
it('keeps no tilt for a year rolled at 26 or older', () => {
  for (const p of veterans) expect(p.dev?.mood).toBeUndefined(); // checked after camp and after week 9
});
it('never steps a rating back, though his mood turns mid-season', () => {
  // A second run: the happy 20 go to −10 after week 9. Record every step's ratings; at the end each rating's
  // sequence only moves toward where it ended (or stays), and every value is an integer.
});
it('keeps a growth year open until it has landed in full', () => {
  for (const p of [...happy, ...sad]) expect(p.dev).toBeDefined(); // after camp
  for (const p of [...happy, ...sad]) expect(p.dev).toBeUndefined(); // after week 18
});
```

Migrate test (`migrate.test.ts`): a v68 league upgrades to 69 with every open `dev` as it was (no `mood` added).

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run src/engine/release.test.ts src/engine/migrate.test.ts --maxWorkers=2`
Expected: the new tests FAIL (`MOOD_TILT` not exported); the old ones still pass under the file-level hook.

- [ ] **Step 4: Implement.**
  - `applyShare(player, targets, applied, s, tilt = 0)`: a target `t > 0` lands at `round(start + s × (1 + tilt) × t)`;
    everything else as today. `developPlayer` passes `ctx.mood ?? 0`; `releaseTo` passes `p.dev.mood ?? 0`.
  - A growth year (`DevYear.potential !== undefined`) is not closed early in `releaseTo`: only at `to >= 1`. Other years
    close as today.
  - `tiltStep(league, p, share, mean)` (module-private): when the year is a growth year and `MOOD_TILT.growth > 0`,
    `d.mood = r4((d.mood ?? 0) + MOOD_TILT.growth × share × moodPull(moraleLevel(league, p), mean) / tilting)` with
    `tilting = RELEASE.program + RELEASE.camp + RELEASE.season`; delete it at 0 (`|| 0`, no −0 in a save).
  - `developBlock`: `mean = moraleMean(league)` once, then for each open year `tiltStep(…, RELEASE[block], mean)` before
    `releaseTo`. `developWeek`: same with the nominal `RELEASE.season / REGULAR_SEASON_WEEKS` (a week he sat counts in
    full for the tilt; reps still set how much lands).
  - `SAVE_VERSION` 69; `migrate.ts`: `// v69: DevYear.mood (G2's growth tilt): optional, absent to start.`

- [ ] **Step 5: Run to see them pass** — same command, plus `npx vitest run src/engine/development.test.ts
      --maxWorkers=2`.

- [ ] **Step 6: Commit** — `git commit -m "Morale G2: mood tilts a young player's year"`

---

### Task 3: Game day

**Files:**

- Modify: `src/engine/match/lineup.ts` (`buildLineup`, `Lineup.knocks` doc), `src/engine/match/gameSim.ts` (constructor,
  the injury rebuild at the second `buildLineup` call)
- Modify: `src/engine/morale.rng.test.ts`
- Create: `src/engine/moraleEffects.test.ts` (game day here; Task 4 adds practice and talks)

**Interfaces:**

- Consumes: `moodPull`, `moraleMean`, `moraleLevel` (Task 1).
- Produces: `buildLineup(league, team, out = new Set(), game?: Game, mean?: number): Lineup`. With `mean` given, every
  player in the lineup's slots (the rush rotation included) gets `knock − MOOD_EDGE × moodPull(level, mean)` in
  `knocks`, `MOOD_EDGE = 0.5`; an entry that comes to 0 is left out. Without it (tests, any caller but the sim), knocks
  as today.

- [ ] **Step 1: Write the failing tests** (`moraleEffects.test.ts`, describe `game day (G2)`): a `createLeague` copy
      with every morale `{ level: 0 }`; on the user's team the starting QB at 10 and a starting CB at −10.

```ts
it('plays a happy man up and an unhappy one down, half a point at most', () => {
  const mean = moraleMean(l);
  const lineup = buildLineup(l, team, new Set(), undefined, mean);
  expect(lineup.knocks.get(qb.id)).toBeCloseTo(-0.5 * moodPull(10, mean), 9);
  expect(lineup.knocks.get(cb.id)).toBeCloseTo(-0.5 * moodPull(-10, mean), 9);
  // Everyone in his own position: his whole entry is his mood's, never past half a point.
  for (const [id, k] of lineup.knocks) if (!outOfPosition.has(id)) expect(Math.abs(k)).toBeLessThanOrEqual(0.5);
  const prev = useKnocks(lineup.knocks);
  const up = skill(qb, 'pocketPresence');
  useKnocks(prev);
  expect(up - skill(qb, 'pocketPresence')).toBeCloseTo(0.5 * moodPull(10, mean), 9);
});
it('gives a lineup sitting at the mean no entries for mood', () => {
  // every morale level 0, mean 0: knocks with the mean equal knocks without it
});
it('keeps an out-of-position knock, less his edge', () => {
  // a WR listed at CB: knock(with mean) === knock(without) − 0.5 × pull
});
it('changes nothing without a mean', () => {
  expect([...buildLineup(l, team).knocks]).toEqual([...withoutMoods.knocks]); // same as before G2
});
it('passes the kickoff mean to every lineup it builds, the rebuild after an injury too', () => {
  // vi.mock('./match/lineup') wraps buildLineup to record its fifth argument (passing through). Play games with
  // simulateGame until one rebuilds (more than two calls); every call in a game got moraleMean at its kickoff.
});
it('plays a game out differently when moods differ, and the same when they do not', () => {
  // simulateGame on two copies: all at 0 vs the user team's starters at 10. Stats differ.
  // Two copies with the same moods: identical results.
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/moraleEffects.test.ts --maxWorkers=2`
Expected: FAIL (no entries for mood)

- [ ] **Step 3: Implement.** `buildLineup` adds the edges after the out-of-position knocks, before `useKnocks`. The sim
      takes `this.moodMean = moraleMean(league)` once in its constructor (before the two lineups) and passes it to both
      calls and to the injury rebuild.

- [ ] **Step 4: Rewrite `morale.rng.test.ts`** to its G2 form: mock `moodLean` and `moodPull` to return 0 alongside the
      existing `moraleWeek`/`moraleStep` switch, so a season and an offseason still play out the same with moods on or
      off (moods draw nothing; effects at zero move nothing). Header comment says so. The test above shows the effects,
      switched on, do change a game.

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run src/engine/moraleEffects.test.ts src/engine/morale.rng.test.ts src/engine/training.test.ts
--maxWorkers=2`
Expected: PASS (`training.test.ts` still finds its out-of-position knocks > 0: it builds without a mean)

- [ ] **Step 6: Commit** — `git commit -m "Morale G2: a small game-day edge"`

---

### Task 4: Practice and talks

**Files:**

- Modify: `src/engine/training.ts` (`learnRate`), `src/engine/offseason/negotiation.ts` (`demand`)
- Test: `src/engine/moraleEffects.test.ts` (describes `practice (G2)`, `contract talks (G2)`)

**Interfaces:**

- Consumes: `moodLean`, `moraleLevel` (Task 1).
- Produces: no new exports. `learnRate` multiplies in `1 + MOOD_LEARN × lean` (`MOOD_LEARN = 0.15`, in `training.ts`).
  `demand` reads `moodTerms(league, player, own): { price: number; patience: number }` (module-private): price
  `lean < 0 ? 1 + 0.10 × −lean : 1 − 0.05 × lean`, patience `lean <= −0.5 ? −1 : lean >= 0.5 ? 1 : 0`, both neutral
  when `!own`. Price multiplies `askApy` (inside its `Math.max(min, …)`) and `walkAway` (inside its `Math.max`);
  patience becomes `Math.max(1, 1 + Math.round(p.patience × 3) + terms.patience)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('practice (G2)', () => {
  it('learns a new position up to 15% faster happy, slower unhappy', () => {
    // a mid player (learnRate well inside 0.3–2) moved to a neighbouring position
    const at = (level: number) => ((p.morale = { level, jolts: [] }), learnRate(l, p, to));
    expect(at(10) / at(0)).toBeCloseTo(1.15, 9);
    expect(at(-10) / at(0)).toBeCloseTo(0.85, 9);
  });
});
describe('contract talks (G2)', () => {
  // a starter on the user's team whose market is well above the minimum
  it('an unhappy man asks his own club up to 10% more, and walks away higher', () => {
    const base = ask(0), sour = ask(-10);
    expect(sour.askApy / base.askApy).toBeCloseTo(1.1, 2);
    expect(sour.walkAway / base.walkAway).toBeCloseTo(1.1, 9);
  });
  it('a happy one asks up to 5% less', () => {
    expect(ask(10).askApy / ask(0).askApy).toBeCloseTo(0.95, 2);
  });
  it('gives a round of patience more past Very good, one less past Very poor, never under one', () => {
    expect(ask(4).patience).toBe(ask(0).patience + 1);
    expect(ask(-4).patience).toBe(Math.max(1, ask(0).patience - 1));
    expect(ask(2).patience).toBe(ask(0).patience);
  });
  it('another club and a free agent ask the same whatever his mood', () => {
    // demand(l, p, otherTeam) at −10 equals at 0; a free agent's demand at −10 equals at 0
  });
});
```

(`ask(level)` sets his morale and returns `demand(l, p, p.teamId!)`.)

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/engine/moraleEffects.test.ts --maxWorkers=2`

- [ ] **Step 3: Implement** both, each with a one-line comment on why (a happy man works harder at it; an unhappy one
      makes his club pay to keep him).

- [ ] **Step 4: Run to see them pass** — same command, plus
      `npx vitest run src/engine/training.test.ts src/engine/offseason --maxWorkers=2`. A snapshot in
      `src/engine/offseason/__snapshots__` that moves because asks moved is expected: look at it, confirm the change is
      the mood terms (seeded moods), then update it with `-u`.

- [ ] **Step 5: Commit** — `git commit -m "Morale G2: moods in practice and in contract talks"`

---

### Task 5: The words

**Files:**

- Modify: `src/engine/lockerVoice.ts` (`MoraleNoteFact.costing`, `MORALE_NOTE`), `src/engine/lockerReport.ts` (the
  Morale rows), `src/ui/screens/LockerRoom.tsx` (the Morale section)
- Test: `src/engine/lockerReport.test.ts`, `src/ui/morale.test.tsx`, `src/ui/playerCard.test.tsx`

**Interfaces:**

- Consumes: `MoraleView.effect` (Task 1).
- Produces: `MoraleNoteFact.costing?: boolean`.

- [ ] **Step 1: Write the failing tests**
  - `lockerReport.test.ts`: `it("tells what a man's mood is costing him once he's Very poor or worse")` — with the
    file's `moody(l)` (Poor at −2, Very poor at −5), the Very poor man's note matches `/practice|game day|his work/`
    and the Poor man's doesn't.
  - `morale.test.tsx`, in `the Locker Room’s Morale section`:
    `it('says once what moods do, and marks whom it costs and lifts')` — roster at level 2, one man at −4, one at −2,
    one at 5: the html holds the section line once, "costing him in practice and on game day" once (the −4 man's row),
    "lifting his practice and his play" once (the 5 man's row). Match without the apostrophes
    (`renderToStaticMarkup` escapes them).
  - `playerCard.test.tsx`: `it('says nothing on the card about what his mood costs him')` — a man at −4: the card has
    no "costing" and no "lifting".

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/lockerReport.test.ts src/ui/morale.test.tsx src/ui/playerCard.test.tsx
--maxWorkers=2`

- [ ] **Step 3: Implement.**
  - `MORALE_NOTE`, new lines (exact copy):
    - reads 3, `costing && reason === 'Wants more snaps'`: `` `${name} is sulking about snaps, and it's showing in practice.` ``
    - reads 3, `costing && reason === 'Wants a new deal'`: `` `${name} has the contract on his mind, and it's in his work. He's a step slow in practice.` ``
    - reads 3, `costing && reason === 'The losing is wearing on him'`: `` `The losing has got into ${name}. You can see it on the practice field.` ``
    - reads 3, `costing && reason === 'A feud in the room'`: `` `${name}'s feud is costing him. His mind isn't on the work.` ``
    - reads 2.5, `costing`: `` `${name} is down, and it's costing him in practice and on game day.` ``
    - reads 2.5, `costing`: `` `Whatever's eating ${name}, it's in his work now.` ``
  - `lockerReport.ts`: pass `costing: !happy && !isBack && view.effect === 'costing'` into the row's fact.
  - `LockerRoom.tsx`: under the Morale title, `<p className="muted small">A player's mood moves how he practices,
grows and plays, and what he asks for in a new deal.</p>`; in *Needs a word* rows with `view.effect === 'costing'`,
    `<span className="muted small mood-effect">It's costing him in practice and on game day.</span>` after the reason
    chips; in *Flying* rows with `'lifting'`, `It's lifting his practice and his play.` the same way. Add a
    `.mood-effect` rule beside `.mood-why` in `src/styles.css` if the row needs it to wrap below (check at phone width
    with `npm run screens` or the dev server).

- [ ] **Step 4: Run to see them pass** — same command, plus `npx vitest run src/engine/lockerVoice.test.ts
      src/ui/ui.test.ts --maxWorkers=2`.

- [ ] **Step 5: Commit** — `git commit -m "Morale G2: what a mood costs, in words"`

---

### Task 6: The checks

**Files:**

- Modify: `scripts/morale.ts`, `scripts/training.ts`, `scripts/check.ts`, `scripts/save-budget.ts` (only if needed)

**Interfaces:**

- Consumes: `moodPull`, `moraleMean`, `moraleLevel`, `MOOD_TILT`.

- [ ] **Step 1: `scripts/morale.ts`** — header gains item 7 (G2). In the season loop:
  - before each regular-season `playWeek`: `mean = moraleMean(league)`; for every rostered player
    `edge = 0.5 × moodPull(moraleLevel(league, p), mean)`; keep each week's league mean of edges and the largest
    `|edge|`;
  - add each rostered growth player's `moraleLevel` to his season sum each regular week;
  - after week 17's `playWeek` (the year closes in week 18), read `p.dev?.mood ?? 0` for every growth year
    (`p.dev?.potential !== undefined`) with his season-average level.
  - New checks (`check(label, value, [lo, hi])`, never loosened):
    - `Game-day edge: league mean (worst week)`, the largest `|weekly mean|`, `[0, 0.05]`
    - `Game-day edge: largest`, `[0, 0.5]`
    - `Growth tilt: league mean late in the season`, `[-0.01, 0.01]`
    - `Growth tilt: Good or better minus Poor or worse (season average)`, `[0.04, 0.2]` (average level ≥ 1 against ≤ −1)

- [ ] **Step 2: `scripts/training.ts`** — `MOOD_TILT.growth = 0` at the top, with a comment: this check holds the
      release to one jump; the tilt's own exactness is `release.test.ts`'s, its size `npm run morale`'s.

- [ ] **Step 3: `scripts/check.ts`** — the Morale rule also runs for the files G2's checks read:
      `/^src\/engine\/(?!.*\.test\.ts$)(morale|playerTalks|development|match\/lineup|training|offseason\/negotiation)\.ts$|^scripts\/morale\.ts$/`.

- [ ] **Step 4: Run them**

Run: `npm run morale` (4 seasons), then `npm run training`, then `npm run sim -- 10`
Expected: every ✓; sim inside its ranges. If a range misses, find why (a sign, the mean, the clamp) before anything
else; never widen it. If it can't be met, stop and tell the owner.

- [ ] **Step 5: Save size** — `npx tsx scripts/save-budget.ts` (or the way `npm run check` runs it). Within budget:
      nothing to add. Over: add a `moraleEffects` allowance as measured (rounded up to the next 10 KB, plus 10), with
      the measured numbers in its comment, and tell the owner in the PR body.

- [ ] **Step 6: Commit** — `git commit -m "Morale G2: the checks"`

---

### Task 7: Docs, version, verify, push

**Files:**

- Modify: `docs/MVP.md` (the Morale line: G2's effects), `package.json` (0.2.24), `src/ui/changelog.ts` (entry
  `Moods matter`), `CLAUDE.md` (the `morale.ts` architecture note: the scale and the effects; `npm run morale` line:
  run it after `development.ts`, `match/lineup.ts`, `training.ts` or `negotiation.ts` changes too)

- [ ] **Step 1: Write the docs.** Changelog text, plain: young players grow a little faster when happy and slower when
      not, everyone plays a touch better or worse on game day, a happy player learns a new position faster, and an
      unhappy one asks more to re-sign; the Locker Room says who it's costing.

- [ ] **Step 2: Verify locally**

Run: `npm run format && npm run typecheck && npx vitest run src/engine/morale.test.ts src/engine/moraleEffects.test.ts
src/engine/release.test.ts src/engine/morale.rng.test.ts src/engine/lockerReport.test.ts src/ui --maxWorkers=2`
Expected: all green, no type errors.

- [ ] **Step 3: Commit and push** — `git commit -m "Morale G2: docs and 0.2.24"`, then
      `git push -u origin claude/gallant-ramanujan-rzydgt`. Open the PR when the owner asks; then read CI and fix what
      is red (sim, careers, audit, offseason, training, trades: ranges are never loosened).
