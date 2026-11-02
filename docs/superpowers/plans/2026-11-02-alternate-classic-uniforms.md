# Alternate and classic uniforms: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every club gets a colour rush and a classic (eight also a blackout), worn in schedule-chosen home games; every
number is outlined and some clubs get their own number font.

**Architecture:** The designs are data (`engine/data/uniforms.ts`), copied onto each team like `Team.helmet`. The
schedule stamps each game's special uniform (`Game.uniform`) when it's made, on its own random stream. The UI's
`uniformFor` turns club, game and data into what the avatar draws (kit, sleeve style, font, helmet); `PlayerAvatar`
draws it.

**Tech Stack:** TypeScript, React 19 (SVG), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-alternate-classic-uniforms-design.md` · drawing and rule reference:
`docs/superpowers/specs/2026-11-02-alternate-classic-uniforms-mockup.tsx`.

## Global Constraints

- `assignUniforms` draws only from its own stream, `new Rng(\`${league.seed}:${season}:uniforms\`)`; it never takes or
  advances the schedule's `rng`. League creation, schedules and every sim number must stay exactly as they are.
- Nothing in the sim reads uniforms; no `Math.random`; `League` stays plain JSON; `SAVE_VERSION` 75 → 76 with a step.
- Names: black `#1b1d22`, white `#F2F4F6`, cream `#EDE6D6`, the outline's dark `#0F172A` and light `#F8FAFC`.
- Our own designs only; no real club's throwback look.
- Per task: `npm run typecheck` and the touched tests; `npm run format` before each commit; never `npm run check`.
  Task 2 touches `season/schedule.ts`: run `npm run sim -- 10` once to confirm the numbers didn't move.
- Commits in the repo's style (`Uniforms: …`) with the session's attribution lines.

## Review Focus

- An old save in mid-season, with games already flexed: their uniforms come from the slot they were scheduled in
  (`g.flexed ?? g.kickoff`), not the flexed one. Test in Task 3.
- A club with no primetime home game gets no alternate but still its classics. Test in Task 2.
- A mod's club with no data entry gets readable fallback sets. Test in Task 4.
- The visitors against a home whiteout wear their colours; against a home colour rush on a hot day, white (the special
  beats the hot-day white). Test in Task 4.
- A club's blackout and classic helmets are only worn with their uniform; every other game wears the usual helmet.
  Test in Task 5.

---

### Task 1: Uniform data for the 32 clubs

**Files:**
- Modify: `src/engine/types.ts` (beside `HelmetDesign`; `Game`, ~line 1743)
- Create: `src/engine/data/uniforms.ts`
- Test: `src/engine/uniformData.test.ts` (new)

**Interfaces:**
- Produces in `types.ts`:
  - `type NumberFont = 'standard' | 'tall' | 'wide' | 'squared' | 'slab'`
  - `type SleeveStyle = 'two' | 'three' | 'wide'`
  - `interface UniformSet { jersey: string; pants: string; ink: string; outline?: { color: string; width: number }; sleeves: SleeveStyle; accent: string; pantsStripe: string; helmet?: HelmetDesign }`
  - `interface ClubUniforms { font: NumberFont; rush: UniformSet; blackout?: UniformSet; classic: UniformSet }`
  - `Game.uniform?: 'rush' | 'blackout' | 'classic'` (the home team's set); `Team.uniforms?: ClubUniforms`
- Produces in `data/uniforms.ts`: `UNIFORMS: Record<string, ClubUniforms>` keyed by abbreviation, all 32 written out.

- [ ] **Step 1: Write the failing tests** in `src/engine/uniformData.test.ts`:

```ts
it('dresses every default club', () => {
  for (const s of TEAM_SEEDS) {
    const u = UNIFORMS[s.abbrev];
    expect(u, s.abbrev).toBeDefined();
    expect(!!u.blackout, s.abbrev).toBe(['PIT', 'CHI', 'LV', 'NO', 'HOU', 'ATL', 'CAR', 'ARI'].includes(s.abbrev));
  }
});
it('makes every number read on its jersey', () => {
  for (const [ab, u] of Object.entries(UNIFORMS))
    for (const [name, set] of Object.entries({ rush: u.rush, blackout: u.blackout, classic: u.classic }))
      if (set) {
        const best = Math.max(contrast(set.ink, set.jersey), set.outline ? contrast(set.outline.color, set.jersey) : 0);
        expect(best, `${ab} ${name}`).toBeGreaterThanOrEqual(3);
      }
});
it('gives the fonts as set', () => {
  for (const ab of ['MIN', 'TEN', 'LAS', 'JAX', 'NYK']) expect(UNIFORMS[ab].font).toBe('tall');
  for (const ab of ['NYE', 'IND', 'NE', 'BAL', 'CLE']) expect(UNIFORMS[ab].font).toBe('wide');
  expect(UNIFORMS.SEA.font).toBe('squared');
  expect(UNIFORMS.KC.font).toBe('standard');
});
it('keeps the helmet count to three: the colour rush wears the usual helmet', () => {
  for (const u of Object.values(UNIFORMS)) expect(u.rush.helmet).toBeUndefined();
  expect(UNIFORMS.ATL.classic.helmet?.shell).toBe('#a71930');
  expect(UNIFORMS.SEA.classic.helmet?.shell).toBe('#a5acaf');
  expect(UNIFORMS.KC.classic.helmet?.finish).toBe('matte');
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/uniformData.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Add the types and write out `UNIFORMS`** from the spec's sets: the colour-rush rule (jersey and pants the
  primary, `ink: readableOn(primary, secondary)`, `sleeves: 'wide'`, `accent` and `pantsStripe` white) and its eight
  exceptions; the blackout for the eight; the classic rule (ink white, `sleeves: 'three'`, `accent` the secondary,
  cream pants, `pantsStripe` the primary, `helmet` the club's seed helmet with `finish: 'matte'`) and its exceptions
  (11 classic helmets, two jerseys). The mockup reference has each rule (`rushOf`/`RUSH`, `blackoutOf`, `classicOf`,
  `CLASSIC_HELMET`, `CLASSIC_JERSEY`); a throwaway script may print the literal values to paste. Set `outline` only
  where the spec names one (the whiteouts, Carolina, Arizona's blackout).

- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** (`Uniforms: every club's colour rush, blackout and classic as data`).

---

### Task 2: The schedule picks the special games

**Files:**
- Create: `src/engine/season/uniforms.ts`
- Modify: `src/engine/season/schedule.ts:616` (call it after `assignKickoffs`)
- Test: `src/engine/season/uniforms.test.ts` (new)

**Interfaces:**
- Consumes: `Game.uniform`, `UNIFORMS` (Task 1), `isPrimeTime` (`season/kickoff.ts`), `Rng`.
- Produces: `assignUniforms(league: League, games: Game[], season: number): void`; reads each game's scheduled slot as
  `g.flexed ?? g.kickoff`, a club's blackout from `league.teams[id].uniforms ?? UNIFORMS[abbrev]`.

The rule (stamp the home team's set; regular season only):
1. For each team in id order, its home games of weeks 1–17 by week. Primetime ones (`isPrimeTime(slot)`), Thursday
   (`slot.day === 'thu'`) first, then by week: the first gets `'rush'`, the second `'blackout'` if the club has one,
   else `'rush'`.
2. Then `rng.chance(0.5) ? 2 : 1` classics from its other home games of weeks 1–17: division games first, each group in
   `rng.shuffle` order, skipping a game in the week next to an already-picked classic.

- [ ] **Step 1: Write the failing tests** (a league from `createLeague({ seed: 'uniforms' })`, its season's games):

```ts
it('gives every club two alternates at most, in primetime home games, Thursday first', () => { /* per team: count ≤ 2; each is home, week ≤ 17, isPrimeTime(g.flexed ?? g.kickoff); a Thursday home game, if any, is among them */ });
it("puts a blackout club's blackout in its second alternate", () => { /* PIT: [rush, blackout] in the order above, when it has two primetime home games */ });
it('gives one or two classics, division games first, never in back-to-back weeks, four specials at most', () => { /* per team */ });
it('leaves a club with no primetime home game its classics', () => { /* clear every kickoff to 1:00 for one club, re-run, expect no rush and ≥1 classic */ });
it('never dresses a playoff game or week 18, and gives the same seed the same uniforms', () => {});
it('leaves the schedule as it was', () => {
  const a = createLeague({ seed: 'same' });
  expect(a.games.map((g) => [g.week, g.homeId, g.awayId, g.kickoff])).toEqual(SNAPSHOT_FROM_MAIN); // computed once on main before this task
});
```

  (Write the bodies as the comments say; for the last test, record the snapshot by running the same expression on
  main before the change.)

- [ ] **Step 2: Run** `npx vitest run src/engine/season/uniforms.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `assignUniforms` and call it in `generateSchedule` after `assignKickoffs`.
- [ ] **Step 4: Run** the test, `npx vitest run src/engine/season`, `npm run typecheck`, and `npm run sim -- 10`.
  Expected: PASS; the sim's numbers identical to main's (no draws from the shared stream).
- [ ] **Step 5: Commit** (`Uniforms: the schedule picks each club's special games`).

---

### Task 3: Teams carry their uniforms; saves v76

**Files:**
- Modify: `src/engine/generate.ts` (team builder: `uniforms`, like `helmet`; `SAVE_VERSION` 76)
- Modify: `src/engine/migrate.ts` (v76 step), `src/engine/migrate.test.ts` (the pinned version)
- Test: `src/engine/uniformData.test.ts`

**Interfaces:**
- Consumes: `UNIFORMS` (Task 1), `assignUniforms` (Task 2).

- [ ] **Step 1: Write the failing tests:**

```ts
it("copies each club's uniforms into a new league", () => { /* team.uniforms toEqual UNIFORMS[abbrev], not the same object */ });
it('dresses an older save: clubs by abbreviation, this season from the slots it was scheduled in', () => {
  const league = createLeague({ seed: 'v76' });
  const before = league.games.map((g) => g.uniform);
  for (const t of league.teams) delete t.uniforms;
  for (const g of league.games) delete g.uniform;
  const g = league.games.find((x) => x.uniform === undefined && x.kickoff && isPrimeTime(x.kickoff))!; // any game
  g.flexed = g.kickoff; g.kickoff = EARLY; // flexed out of primetime since
  league.version = 75;
  const out = migrateLeague(league)!;
  expect(out.version).toBe(76);
  expect(out.games.map((x) => x.uniform)).toEqual(before);
  expect(out.teams[0].uniforms).toEqual(UNIFORMS[out.teams[0].abbrev]);
});
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the copy in the team builder, `SAVE_VERSION = 76`, and the v76 step: each team without
  `uniforms` gets a clone of its abbreviation's entry (a mod's keeps none); then `assignUniforms` over
  `league.games` of `league.season` without a `uniform` and without `playoffRound`. Update the pinned version in
  `migrate.test.ts` (75 → 76) as every bump does.
- [ ] **Step 4: Run** `npx vitest run src/engine/uniformData.test.ts src/engine/migrate.test.ts` and typecheck. PASS.
- [ ] **Step 5: Commit** (`Uniforms: teams carry their uniforms, saves v76`).

---

### Task 4: What each club wears (`src/ui/uniform.ts`)

**Files:**
- Create: `src/ui/uniform.ts`
- Modify: `src/ui/color.ts` (`Kit` gains `outline: number`; `kitFor` applies the outline rule), `src/ui/components.tsx` (the move)
- Test: `src/ui/uniform.test.ts` (new); `src/ui/avatar.test.tsx` (kit tests that pin the old trim)

**Interfaces:**
- Consumes: `UniformSet`, `ClubUniforms`, `NumberFont`, `Game.uniform`, `Team.uniforms` (Tasks 1, 3);
  `helmetDesignOf` (`helmet.ts`).
- Moves: `wearsWhite` and `HOT_KICKOFF_F` from `components.tsx` into `uniform.ts` (`components.tsx` imports
  `uniform.ts`, so the other way round would be circular); `components.tsx` re-exports both, so their callers and
  tests don't change.
- Produces:
  - `NUMBER_FONTS: Record<NumberFont, { family: string; stretch: number; scale: number }>`: standard
    `var(--font-display)` 1.15 1; tall `'Anton', 'Arial Narrow', sans-serif` 1.25 0.91; wide
    `'Archivo Black', 'Arial Black', sans-serif` 0.85 1; squared `'Russo One', sans-serif` 0.85 1; slab
    `'Bitter', Georgia, serif` 0.95 1.
  - `numberOutline(jersey: string, ink: string, secondary: string): { color: string; width: number }`: the secondary at
    2.4 when it stands off both (contrast ≥ 1.5 each), else dark or light at 2.0, whichever stands off the ink more.
  - `clubUniforms(team: Pick<Team, 'colors' | 'helmet' | 'uniforms'>): ClubUniforms` (the data, or the fallback rules:
    colour rush and classic from the colours, no blackout, standard font).
  - `interface Dressed { set: 'home' | 'away' | 'rush' | 'blackout' | 'classic'; kit: Kit; sleeves: SleeveStyle; font: NumberFont; helmet: HelmetDesign }`
  - `uniformFor(league: League | null, team: Team, game?: Game): Dressed`

- [ ] **Step 1: Write the failing tests:**

```ts
it("dresses the home team in its game's set, and the visitors opposite", () => { /* a game with uniform 'classic': home set 'classic', visitors 'away' */ });
it('puts the visitors in colours against a home whiteout', () => { /* PIT home, uniform 'rush' (white jersey): visitors 'home' */ });
it('lets a special beat the hot-day white', () => { /* MIA home in a hot open-air game with uniform 'rush': home 'rush', visitors 'away' */ });
it("wears the classic's helmet only in a classic game, the usual otherwise", () => { /* ATL: classic → shell #a71930; plain home game → helmetDesignOf(team) */ });
it("dresses a mod's club from its colours", () => { /* team without uniforms or helmet: rush jersey = primary, classic sleeves 'three', no blackout, font 'standard'; every number reads (≥ 3 with its outline) */ });
it('outlines every number', () => {
  expect(numberOutline('#e31837', '#ffb81c', '#ffb81c')).toEqual({ color: '#0F172A', width: 2 }); // gold on red reads: no second-colour outline
  expect(numberOutline('#008e97', '#ffffff', '#fc4c02')).toEqual({ color: '#fc4c02', width: 2.4 });
});
it('dresses home colours in a bye week and the offseason', () => {});
```

  (Check the outline expectations against the rule when writing them; adjust the first pair to what the rule yields
  if contrast says otherwise, and say so in the ledger.)

- [ ] **Step 2: Run** `npx vitest run src/ui/uniform.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `uniform.ts` and the outline in `kitFor` (`trim` from `numberOutline`, `outline` its
  width). A set's kit: `jersey`, `ink`, `trim`/`outline` from the set's `outline` or the rule, `accent`, `pants`,
  `stripe` = `stripeThin` = `pantsStripe`, `belt` = `shade(pants, 0.35)`. The classic's font is `slab`; the others the
  club's `font`.
- [ ] **Step 4: Run** `npx vitest run src/ui/uniform.test.ts src/ui/avatar.test.tsx` and typecheck. Expected: PASS
  (kit tests that pinned the old `trim` are updated to the outline rule, with a ledger ruling).
- [ ] **Step 5: Commit** (`Uniforms: what each club wears, and every number outlined`).

---

### Task 5: The avatar draws it

**Files:**
- Modify: `src/ui/components.tsx` (`PlayerAvatar`), `index.html` (fonts)
- Test: `src/ui/avatar.test.tsx`

**Interfaces:**
- Consumes: `uniformFor`, `NUMBER_FONTS` (Task 4).

- [ ] **Step 1: Write the failing tests** (render a player of a club with a stamped game passed as `game`):

```ts
it('draws each set at every size with no NaN', () => { /* rush, blackout, classic × 24/32/56/128 */ });
it("draws the classic's three sleeve stripes and its slab numbers", () => { /* 128px: font-family contains 'Bitter'; three band paths */ });
it("draws a club's own number font", () => { /* MIN at 128: font-family contains 'Anton', font-size 32*0.91 */ });
it("wears the blackout's black helmet in a blackout game only", () => { /* shell gradient stops from #1b1d22 vs the usual */ });
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** in `PlayerAvatar`: `const dressed = team ? uniformFor(store.get(), team, game) : null`
  replaces `kitFor`/`wearsWhite` (free agents keep `kitFor(FREE_AGENT)`); the sleeve stripes by `dressed.sleeves`
  (`two` today's; `three` the upper band at −1.2 and +1.5 and the lower at +1.6, 1.2 wide, ink/accent/ink; `wide` the
  upper band at +1.6, 4 wide in ink under 2.4 in accent: the mockup's `SleeveStripes`); the svg's `fontFamily`, the
  number's stretch and size from `NUMBER_FONTS[dressed.font]`; the number's `strokeWidth` from `kit.outline`; the
  helmet from `dressed.helmet`. Add `Anton`, `Archivo Black`, `Russo One` and `Bitter:wght@800` to `index.html`'s
  Google Fonts link.
- [ ] **Step 4: Run** `npx vitest run src/ui/avatar.test.tsx src/ui/ui.test.ts src/ui/captainPatch.test.tsx` and
  typecheck. PASS. Then look: dump a league to `work/` with the user's week-1 game stamped `classic` (and another save
  with `rush` for a whiteout club), `npm run screens -- --save … --screens roster,card`, and check the sets, fonts and
  outlines by eye, light and dark.
- [ ] **Step 5: Commit** (`Uniforms: players wear their club's special uniforms`).

---

### Task 6: Docs and version

**Files:** `docs/AVATARS.md`, `src/ui/changelog.ts`, `package.json`

- [ ] **Step 1:** `AVATARS.md`: section 4 (colours) the outline rule and fonts; section 5 (home and away) the sets, the
  schedule rule, the visitors and the hot-day precedence; section 6 the new tunables; section 7 drops "alternate and
  throwback uniforms" and adds the spec's "Later".
- [ ] **Step 2:** the next PATCH (one past main's) and a changelog entry in a player's words (title "Colour rush"):
  each club's colour rush under the lights, blackouts for eight, a classic or two a season, outlined numbers and new
  fonts for some clubs.
- [ ] **Step 3:** `npm run format`, typecheck, `npx vitest run src/ui src/engine/season src/engine/uniformData.test.ts src/engine/migrate.test.ts`. PASS.
- [ ] **Step 4:** commit and push to `claude/gallant-johnson-gqsz8w`.
