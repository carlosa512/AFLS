# Personality (PR 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four new hidden traits (leadership, poise, controversy, sportsmanship), a personality name and a one-sentence
character line per player, sportsmanship's dirty fouls, and poise's pull on the pressure habits.

**Architecture:** Traits are rolled in `generateTraits` after the existing six so nothing already rolled moves. A new
pure module `personality.ts` turns ten character values (six traits plus the four negotiation dials) into a name and
a sentence; it never stores anything. Teams see the name through `characterRead` (perceived, seeded). A trait whose
job hasn't shipped yet (leadership, controversy) is left out of names and sentences through one set, `TRAITS_ON`.

**Tech Stack:** TypeScript, Vitest, React (Vite), Prettier.

**Spec:** `docs/superpowers/specs/2026-10-28-personality-relationships-design.md` (§1, §5.1, §5.5, §6). Read it first.

**Branch:** `claude/relaxed-archimedes-hyjd24` (the spec's branch). PRs 2–4 stack on this one.

## Global Constraints

- Traits are 1–20, mean `TRAIT_MEAN` 10.5, sd 3.5; never shown as numbers, never read by a screen (`development.test.ts`
  guards `src/ui`).
- No `Math.random`: every draw goes through a seeded `Rng`. New draws come **after** existing ones on any stream.
- `League` stays plain JSON; a shape change bumps `SAVE_VERSION` and adds a `migrate.ts` step.
- Screens show your staff's read only; AI uses its own read (`characterRead`), never the truth for other clubs.
- Copy talks like football people. Never on a screen or in mail: *marble, trait, z-score*, or code names (`workEthic`,
  `leads`, `poise` as an identifier).
- Run `npm run format` before each commit. Locally run `npm run typecheck` and the tests you touched; for engine
  changes also `npm run sim -- 10` and `npm run quirks -- --effects`, `npm run crews`. Never loosen a range.
- Version: patch bump in `package.json` plus a `src/ui/changelog.ts` entry (not an MVP item).

## Review Focus

1. **Old saves:** a v59 save loads, every player gets the four traits from his own seed, and the six old traits are
   untouched (Task 1 test).
2. **Other clubs' reads stay put:** adding the new guesses must not change any existing perceived value of a player
   (`characterRead` draws on shared streams; Task 3 snapshot test).
3. **A player your scouts don't know:** the card shows "Unknown", never a name (Task 4 test).
4. **Jargon leaking into copy:** every generated sentence is free of the banned words (Task 2 test).
5. **Flags drifting:** the sportsmanship split must leave league personal fouls in range (`npm run sim`, `npm run
   crews` in Task 5).

---

### Task 1: The four traits, generation and migration

**Files:**
- Modify: `src/engine/types.ts:414-427` (`Traits`)
- Modify: `src/engine/traits.ts` (`generateTraits`, new `sportsOffset`)
- Modify: `src/engine/generate.ts:137` (zeroed traits literal), `SAVE_VERSION` 59 → 60 (or main's current + 1)
- Modify: `src/engine/migrate.ts` (v60 step)
- Test: `src/engine/development.test.ts` (`describe('hidden traits')`), `src/engine/quirks.test.ts` or the migration
  test file that already round-trips old saves (`scouting.test.ts` uses `migrateLeague`)

**Interfaces:**
- Produces: `Traits.leads`, `Traits.poise`, `Traits.controversy`, `Traits.sportsmanship` (numbers, 1–20);
  `sportsOffset(t: Pick<Traits, 'sportsmanship'>): number` = `0.3 * (t.sportsmanship - TRAIT_MEAN)`.

- [ ] **Step 1: Write the failing tests**

First, on the current code, pin the six existing traits of the first five players of `createLeague({ seed:
'traits-new' })` with `toMatchInlineSnapshot()` and run it once so the snapshot holds today's values. Then in
`describe('hidden traits')` add:

```ts
it('rolls leadership, poise, controversy and sportsmanship after the others, leaving them as they were', () => {
  const league = createLeague({ seed: 'traits-new' });
  const players = Object.values(league.players);
  const keys = ['leads', 'poise', 'controversy', 'sportsmanship'] as const;
  for (const p of players) for (const k of keys) expect(Number.isInteger(p.traits[k]) && p.traits[k] >= 1 && p.traits[k] <= 20).toBe(true);
  for (const k of keys) expect(Math.abs(mean(players.map((p) => p.traits[k])) - TRAIT_MEAN)).toBeLessThan(0.3);
  const temp = players.map((p) => p.traits.temperament);
  expect(corr(temp, players.map((p) => p.traits.controversy))).toBeLessThan(-0.15);
  expect(corr(temp, players.map((p) => p.traits.sportsmanship))).toBeGreaterThan(0.15);
  // Mentors are chosen by leadership: it must not lean on work ethic (spec §1.1).
  expect(Math.abs(corr(players.map((p) => p.traits.workEthic), players.map((p) => p.traits.leads)))).toBeLessThan(0.08);
});
```

And a migration test: take `createLeague({ seed: 'v60' })`, delete the four keys from every player's traits, set
`league.version = 59`, run `migrateLeague`, and expect every player's traits to equal `generateTraits(p)` for the four
keys and the stored six to be unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/development.test.ts`
Expected: FAIL (`p.traits.leads` is undefined).

- [ ] **Step 3: Implement**

`types.ts`: add the four fields to `Traits` with one-line doc comments (leadership: how much the room follows him;
poise: how he holds up when it counts; controversy: how readily he says it out loud; sportsmanship: how clean he
plays). `generate.ts:137`: add the four as `0`. `traits.ts`, after `const versatile = rng.normal();`:

```ts
// Drawn last for the same reason. Leadership stands alone: mentors are picked by it, and a lean on work
// ethic would lift the whole league's (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §1.1).
const leads = rng.normal();
const poise = rng.normal();
const controversy = -0.3 * temper + 0.954 * rng.normal();
const sportsmanship = 0.3 * temper + 0.954 * rng.normal();
```

Return them through `roll`. Add `sportsOffset` beside `temperOffset`. `migrate.ts`: `toV60` fills the four from
`generateTraits(p)` when `p.traits.leads === undefined` (pattern: `toV31`), wired as `if (league.version < 60)`.
Bump `SAVE_VERSION`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/development.test.ts src/engine/scouting.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/types.ts src/engine/traits.ts src/engine/generate.ts src/engine/migrate.ts src/engine/*.test.ts
git commit -m "Personality: leadership, poise, controversy and sportsmanship (save v60)"
```

---

### Task 2: `personality.ts`: names and the character line

**Files:**
- Create: `src/engine/personality.ts`
- Test: `src/engine/personality.test.ts`

**Interfaces:**
- Consumes: `Traits` (Task 1), `Personality` (`types.ts:399`), `TRAIT_MEAN` (`traits.ts`).
- Produces:
  - `type CharacterKey = 'workEthic' | 'temperament' | 'leads' | 'poise' | 'controversy' | 'sportsmanship' | 'loyalty' | 'winning' | 'greed' | 'patience'`
  - `interface Character extends Traits, Personality {}` (traits 1–20, dials 0–1)
  - `type PersonalityName` (the 18 names of spec §1.2, exact spelling)
  - `const TRAITS_ON: ReadonlySet<CharacterKey>` (PR 1: every key except `leads` and `controversy`)
  - `characterZ(c: Character): Record<CharacterKey, number>`
  - `personalityOf(c: Character, on = TRAITS_ON): PersonalityName`
  - `characterLine(c: Character, on = TRAITS_ON): string`
  - `trueCharacter(p: Player): Character` = `{ ...p.traits, ...p.personality }`

- [ ] **Step 1: Write the failing tests**

```ts
describe('personality', () => {
  const league = createLeague({ seed: 'personality-spread' });
  const players = Object.values(league.players).filter((p) => !p.retired);
  const all = new Set<CharacterKey>(['workEthic', 'temperament', 'leads', 'poise', 'controversy', 'sportsmanship', 'loyalty', 'winning', 'greed', 'patience']);

  it('spreads names like FM: Even-Keeled for a quarter or so, nobody else past 9%', () => {
    for (const on of [TRAITS_ON, all]) {
      const counts = new Map<string, number>();
      for (const p of players) counts.set(personalityOf(trueCharacter(p), on), (counts.get(personalityOf(trueCharacter(p), on)) ?? 0) + 1);
      const share = (n: string) => (counts.get(n) ?? 0) / players.length;
      expect(share('Even-Keeled')).toBeGreaterThan(0.2);
      expect(share('Even-Keeled')).toBeLessThan(0.35);
      for (const [n] of counts) if (n !== 'Even-Keeled') expect(share(n)).toBeLessThan(0.09);
    }
  });

  it('never names a trait whose job has not shipped', () => {
    for (const p of players) expect(['Born Leader', 'Quiet Pro', 'Locker-Room Lawyer', 'Volatile', 'Diva']).not.toContain(personalityOf(trueCharacter(p)));
  });

  it('checks rules in order: a leader who stirs the room is a Locker-Room Lawyer, not a Born Leader', () => {
    const c = { ...trueCharacter(players[0]), leads: 18, controversy: 16 };
    expect(personalityOf(c, all)).toBe('Locker-Room Lawyer');
  });

  it('says one sentence on what stands out, in plain words', () => {
    const c = { ...trueCharacter(players[0]), workEthic: 18, temperament: 17, poise: 10, sportsmanship: 11, leads: 10, controversy: 10, loyalty: 0.5, winning: 0.5, greed: 0.5, patience: 0.55 };
    expect(characterLine(c)).toBe('Outworks everyone and keeps his cool.');
    for (const p of players) expect(characterLine(trueCharacter(p))).not.toMatch(/marble|trait|z-score|\bsd\b/i);
  });
});
```

Every rule in spec §1.2 also gets one row in an `it.each` table: a character at the league average except the rule's
own values, expecting that name with `all` switched on.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/personality.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/engine/personality.ts`**

- z-scores: traits `(x - TRAIT_MEAN) / 3.5`; dials `loyalty (x - 0.5) / 0.22`, `winning (x - 0.5) / 0.22`,
  `greed (x - 0.5) / 0.289`, `patience (x - 0.55) / 0.2` (how `generatePersonality` rolls them).
- Rules: an ordered array `{ name, needs: CharacterKey[], test: (z) => boolean }` copied from spec §1.2, starting
  thresholds as written. `personalityOf` returns the first rule whose `needs` are all in `on` and whose test holds;
  otherwise `'Even-Keeled'`. Tune thresholds only until the spread test passes; note any change in the spec's table.
- `characterLine`: among keys in `on`, take those with `|z| >= 1`, sort by `|z|` descending, keep two, map each to the
  spec §5.1 phrase (high or low column), join with " and ", capitalise, end with ".". None: `"Nothing about him stands
  out."`.
- File header comment: what the module is for and that nothing here is stored (house style: comments say why).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/personality.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/personality.ts src/engine/personality.test.ts
git commit -m "Personality: names and the character line (personality.ts)"
```

---

### Task 3: What a team sees (`characterRead` and `personalityRead`)

**Files:**
- Modify: `src/engine/scouting.ts:376-428` (`CharacterRead`, `characterRead`)
- Modify: `src/engine/personality.ts` (add `personalityRead`)
- Test: `src/engine/scouting.test.ts`, `src/engine/personality.test.ts`

**Interfaces:**
- Consumes: `characterRead(league, teamId, p): CharacterRead | null` (existing), Task 2's `Character`, `personalityOf`,
  `characterLine`.
- Produces:
  - `CharacterRead` now `extends Traits, Personality` (dials perceived on 0–1).
  - `personalityRead(league: League, teamId: number, p: Player): { name: PersonalityName; line: string; hedged: boolean } | null`
    (null when `characterRead` is null; `hedged` = `!read.exact && read.sd > 1.2`, the same rule as `characterNotes`).

- [ ] **Step 1: Write the snapshot test first, on the old code**

In `scouting.test.ts`: for a seeded league (`createLeague({ seed: 'char-read-stable' })`), team 0, and the first 40
players another club knows at 0.5–0.9 (raise knowledge with the existing test helpers), record `workEthic,
durability, temperament, injuryResistance, naturalFitness, versatility` from `characterRead` with
`toMatchInlineSnapshot()`. Run it on the current code so the snapshot holds today's values. Commit nothing yet.

Then add the failing test:

```ts
it('reads the new character on the same streams, after the old ones', () => {
  const read = characterRead(league, 0, known)!;
  for (const k of ['leads', 'poise', 'controversy', 'sportsmanship'] as const) expect(read[k]).toBeGreaterThanOrEqual(1);
  for (const k of ['loyalty', 'winning', 'greed', 'patience'] as const) expect(read[k]).toBeGreaterThanOrEqual(0);
  expect(personalityRead(league, 0, unknownProspect)).toBeNull();
});
```

- [ ] **Step 2: Run to see the new test fail and the snapshot pass**

Run: `npx vitest run src/engine/scouting.test.ts`
Expected: snapshot PASS, new test FAIL.

- [ ] **Step 3: Implement**

In `characterRead`: the exact branch returns `{ ...p.traits, ...p.personality, sd: 0, exact: true }`. In the perceived
branch, **after** `versatility` is computed (move it out of the object literal into a `const` first, keeping its
draw order), add in this order: `leads` and `controversy` (projector, `sdProj`: seen in a sit-down), `poise` and
`sportsmanship` (evaluator, `sdEval`: seen on film), then the four dials on the projector with
`clamp(truth + (sd / 19) * (0.8 * team.normal() + 0.6 * own.normal()), 0, 1)`. Update the doc comment.
`personalityRead` in `personality.ts` builds its `Character` from the read.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/scouting.test.ts src/engine/personality.test.ts && npm run typecheck`
Expected: PASS, with the snapshot unchanged.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/scouting.ts src/engine/personality.ts src/engine/*.test.ts
git commit -m "Personality: scouts read the new character, and the name, on their own streams"
```

---

### Task 4: The player card's character block

**Files:**
- Modify: `src/engine/scouting.ts` (`CharacterNote.about`: add `'work' | 'temper'`; tag the work-ethic and
  temperament notes in `characterNotes`)
- Modify: `src/ui/scouting.tsx` (new `personalityOf(league, p)` wrapper: `personalityRead(league, league.userTeamId, p)`,
  exported as `characterOf` to avoid the name clash)
- Modify: `src/ui/screens/PlayerCard.tsx:741-750` (the "Makeup" fact)
- Test: `src/ui/ui.test.ts` (or `src/ui/gm.test.tsx`, which already renders cards with `renderToStaticMarkup`)

**Interfaces:**
- Consumes: `personalityRead` (Task 3).
- Produces: `characterOf(league: League, p: Player)` in `ui/scouting.tsx`; `CharacterNote.about` values `'work'`,
  `'temper'` (screens filter on them).

- [ ] **Step 1: Write the failing test**

Render `PlayerCard` for (a) one of your players: the markup contains his `personalityRead(...).name` and `.line`, and
none of the labels `Model pro`, `Driven`, `Coasts`, `Needs a push`, `Hothead`, `Even-keeled`; (b) a prospect your
scouts haven't met: contains `Unknown` and no personality name. Also extend `describe('screen contract')` with:

```ts
it('keeps engine words off the screen', () => {
  const bad = files.filter((f) => /['"`>][^'"`<{}]*\b(marbles?|traits?|z-score)\b/i.test(src(f)));
  expect(bad).toEqual([]);
});
```

(If an existing file trips it on legitimate copy, fix the copy, not the test.)

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/ui/gm.test.tsx src/ui/ui.test.ts`
Expected: FAIL (card still shows the old tags).

- [ ] **Step 3: Implement**

The "Makeup" fact keeps its eyebrow (`Makeup · early word` while hedged). Inside: the personality name as one pill
(dashed while hedged, same as `MakeupPills`), the line beneath it in `muted`, then `MakeupPills` with the notes
filtered to drop `about === 'work' || about === 'temper'`. Unknown stays `Unknown`. The scout report
(`scoutReportParts`) is unchanged: it still uses the clauses.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/scouting.ts src/ui/scouting.tsx src/ui/screens/PlayerCard.tsx src/ui/*.test.ts*
git commit -m "Personality: the player card shows a name and one sentence in place of the work and temper tags"
```

---

### Task 5: Sportsmanship takes the dirty fouls

**Files:**
- Modify: `src/engine/match/lineup.ts:114-115` (add `roughness`)
- Modify: `src/engine/match/gameSim.ts:3050-3090` (`personalFouls`)
- Test: `src/engine/penalties.test.ts` (`describe('personal fouls')`)

**Interfaces:**
- Consumes: `sportsOffset` (Task 1).
- Produces: `roughness(p: Player): number` = `skill(p, 'discipline') + sportsOffset(p.traits)`.

- [ ] **Step 1: Write the failing test**

```ts
it('charges roughness to sportsmanship and pre-snap flags to temperament', () => {
  const p = league.players[league.teams[0].depthChart.EDGE[0]];
  const base = { ...p.traits };
  p.traits = { ...base, sportsmanship: 3 };
  const dirty = roughness(p);
  p.traits = { ...base, sportsmanship: 18 };
  expect(roughness(p)).toBeGreaterThan(dirty + 4);
  expect(discipline(p)).toBe(discipline({ ...p, traits: { ...base, sportsmanship: 3 } }));
  p.traits = base;
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/engine/penalties.test.ts`
Expected: FAIL (`roughness` not exported).

- [ ] **Step 3: Implement**

`lineup.ts`: `roughness` beside `discipline`, comment: how clean he plays, not how cool he keeps. In `personalFouls`
add `const dirty = (p, typical) => Math.exp(-0.06 * (roughness(p) - typical))` and use it for roughing the passer and
the tacklers' roughness and face mask odds. The after-the-whistle unsportsmanlike roll keeps `loose` (temperament).
`DL_DISCIPLINE` and `TACKLER_DISCIPLINE` stay: both offsets are centred on the league average. Update the method's
doc comment.

- [ ] **Step 4: Run the tests and the checks**

Run: `npx vitest run src/engine/penalties.test.ts && npm run sim -- 10 && npm run crews`
Expected: PASS; every league flag line inside its range (no ▲/▼, no ✗).

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/match/lineup.ts src/engine/match/gameSim.ts src/engine/penalties.test.ts
git commit -m "Personality: sportsmanship decides roughing, unnecessary roughness and face masks"
```

---

### Task 6: Poise in the marble bag

**Files:**
- Modify: `src/engine/quirks.ts:27-40` (`QuirkInfo.poise?: 'bad' | 'good'`), the registry entries `bailsEarly`,
  `seesGhosts`, `yips` (`'bad'`) and `iceWater` (`'good'`), `fillBag` (`:711`)
- Test: `src/engine/quirks.test.ts`

**Interfaces:**
- Consumes: `Traits.poise` (Task 1).
- Produces: `QuirkInfo.poise`; `fillBag` unchanged in signature.

- [ ] **Step 1: Write the failing test**

```ts
it('feeds the pressure habits from poise, both ways', () => {
  const qb = someQb(); // an existing helper or createLeague player at QB, no quirks
  qb.traits = { ...qb.traits, poise: 3 };
  const shaky = fillBag(qb).seesGhosts;
  qb.traits = { ...qb.traits, poise: 10 };
  expect(shaky).toBe(fillBag(qb).seesGhosts + 2);
  const k = someKicker();
  k.quirks = { yips: 1 };
  k.traits = { ...k.traits, poise: 17 };
  const calm = fillBag(k);
  k.traits = { ...k.traits, poise: 10 };
  expect(calm.iceWater).toBe(fillBag(k).iceWater + 1);
  expect(calm['fix:yips']).toBe(fillBag(k)['fix:yips'] + 1);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/engine/quirks.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `fillBag`, with `nerve = (p.traits.poise - TRAIT_MEAN) / 3.5`: a `poise: 'bad'` habit gets `+2` at `nerve <= -1.5`,
`+1` at `nerve <= -1`; a `poise: 'good'` habit gets `+1` at `nerve >= 1`; a held `poise: 'bad'` habit gets `+1` fix
marble at `nerve >= 1`. Update `fillBag`'s doc comment.

- [ ] **Step 4: Run the tests and the quirks check**

Run: `npx vitest run src/engine/quirks.test.ts && npm run quirks -- --effects`
Expected: PASS; nothing flagged. If Sees Ghosts or Yips gains run high, the lever is `-1` bad marble at
`nerve >= 1` (spec §1.4: balanced both ways), never a wider range.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/quirks.ts src/engine/quirks.test.ts
git commit -m "Personality: poise feeds Sees Ghosts, Bails Early, the yips and Ice-Water Veins"
```

---

### Task 7: Docs, version, and the PR

**Files:**
- Modify: `docs/GAME_DESIGN.md:125-145` (hidden traits table: four rows; scouts' words: personality names)
- Modify: `CLAUDE.md` (architecture: one line for `personality.ts` beside `traits.ts`)
- Modify: `package.json` (patch bump), `src/ui/changelog.ts` (newest-first entry, in a player's words: every player
  now has a personality your scouts can read, and dirty players draw the late-hit flags)

- [ ] **Step 1: Write the docs and the changelog entry** (plain language; no code names in the changelog).
- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx vitest run src/engine/personality.test.ts src/engine/scouting.test.ts src/engine/quirks.test.ts src/engine/penalties.test.ts src/engine/development.test.ts src/ui`
Expected: PASS.

- [ ] **Step 3: Commit and push**

```bash
npm run format
git add docs/GAME_DESIGN.md CLAUDE.md package.json src/ui/changelog.ts
git commit -m "Personality 0.2.x: docs and changelog"
git push -u origin claude/relaxed-archimedes-hyjd24
```

- [ ] **Step 4: Open the PR only when the owner asks; then read CI and fix anything red before calling it ready.**
