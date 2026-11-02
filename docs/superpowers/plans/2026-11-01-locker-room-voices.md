# Locker room, part 1 (L1): who runs the room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every club's room a shape (leaders, voices, units and how each unit is feeling), let a voice's mood rub
off on his unit, and tell it in the head coach's report, the position coaches' weekly notes and the Locker Room
screen, in words a GM wants to read.

**Architecture:** One new model module (`standing.ts`: weight, tiers, units, a unit's read, your club's views), one
facts module (`roomFacts.ts`: what a line may read, our club only) and one words module (`roomVoice.ts`: the banks,
picked with `say()`). `morale.ts` gains one term in `roomScore` and a few context fields; the report, the staff notes
and the screen consume the views and the banks. Nothing new is stored.

**Tech Stack:** TypeScript, Vitest, React (server-rendered in tests with `renderToStaticMarkup`), `tsx` scripts.

**Spec:** `docs/superpowers/specs/2026-11-01-locker-room-voices-design.md`

## Global Constraints

- No `Math.random` and no RNG stream: nothing in L1 draws. Every line is picked by `say()` (`voice.ts`).
- `League` stays plain JSON. No new stored field, no `SAVE_VERSION` bump. Memory of what was told lives in `covered`
  keys only.
- Screens show your club only, in words: they read moods only through `moraleView`, and the room only through
  `roomView` / `standingView` (Task 4). Never `playerOvr`, `player.ratings`, `moraleLevel` or a weight in a screen.
- Ratings and traits are 1–20; `TRAIT_MEAN` 10.5; trait spread 3.5 (`z = (v − 10.5) / 3.5`).
- Constants (spec values; tune only `LEADER_AT`, `VOICE_AT` and `SPLIT_SHARE`, only in Task 9, never a check's
  range): `LEADER_AT = 1.25`, `VOICE_AT = 0.85`; seniority 0.6 at 0 seasons, +0.1 a season to 1.0 at 4, then
  +0.0375 a season to 1.15 at 8+; newcomer ×0.8; honoured ×1.2; starting QB ×1.15; field 1 / 0.7 / 0.4;
  `TONE = { weight: 0.5, floor: 2.0, friend: 0.15, friends: 2 }`; loudness: stirs 1.5 down, 0.75 up; steadies 0.5
  down; `SPLIT_SHARE = 0.3`; `READ_MIN = 3`; a read's weight floor 0.3; `NOTE_GAP = 3` clock steps.
- Every line follows spec §6. Banned in any L1 line: `/standing|weight|influence|\btiers?\b|hierarch|faction|clique|cohesion|contagion|\bspread|atmosphere|gauge|chemistry|\bmorale\b|\blevel\b|marble|\btraits?\b|z-score/i`.
  Unit and standing lines carry no digits. "Sets the tone" is allowed.
- `src/engine/standing.ts` and `src/engine/morale.ts` import each other: use the other module's exports only inside
  function bodies, never at module top level (spell `UNITS` out; don't spread `COACH_ROOMS`).
- Before each commit: `npm run format` and `npm run typecheck`. Run only the tests you touched (`npx vitest run
  <file>`) and, from Task 2 on, `npm run morale -- --seasons 2` when moods can move. Never `npm run check`.
- Commit messages end with the attribution lines from the session.

## Review Focus

1. **A leader traded or cut, or put on injured reserve:** the next report says "since X left" only when he's off the
   club; a man on IR hasn't left. (Task 6 test.)
2. **A GM's first report, with nothing told before:** no standing-change rows; only Split or Down units get a row.
   (Task 6 test.)
3. **Small rooms:** a two-man quarterback room and the specialists get no read, no row, and no division by zero.
   (Task 4 test.)
4. **A unit flickering between Split and Restless week to week:** at most one staff note for that unit in any three
   weeks. (Task 7 test.)
5. **A signing or a cut inside a step:** `roomView` must not serve a stale context; a released voice disappears from
   it at once, the way `moraleView`'s cache key already handles transactions. (Task 4 test.)

---

### Task 1: Units and weight

**Files:**
- Create: `src/engine/standing.ts`
- Modify: `src/engine/morale.ts` (`MoraleContext`, `moraleContext`: add `honoured`)
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: `actualRole(league, p, ctx)`, `isCaptain(league, p)`, `MoraleContext` (`morale.ts`); `leadFactor`
  (`mentoring.ts`); `seasonRole` (`scouting.ts`); `ROOM_OF`, type `CoachRoom` (`coaching.ts`); `starters`
  (`roster.ts`); `temperamentOf`, `TRAIT_MEAN` (`traits.ts`).
- Produces:
  - `type Unit = CoachRoom | 'ST'`; `const UNITS: readonly Unit[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'ST']`
  - `type Side = 'offense' | 'defense' | 'specialTeams'`; `unitOf(pos: Position): Unit`; `sideOf(unit: Unit): Side`
  - `type Tier = 'leader' | 'voice'`; `type Sound = 'stirs' | 'steadies'`; `LEADER_AT`, `VOICE_AT`
  - `honouredSince(league: League, season: number): Set<number>`
  - `seniority(experience: number, newcomer: boolean): number`; `isNewcomer(league: League, p: Player): boolean`
  - `weightOf(league: League, p: Player, ctx: MoraleContext): number`
  - `tierOf(league: League, p: Player, weight: number): Tier | null`; `soundOf(p: Player): Sound | null`
  - `MoraleContext.honoured: Set<number>` (= `honouredSince(league, league.season - 3)`)

- [ ] **Step 1: Write the failing tests** in `src/engine/standing.test.ts`

```ts
const base = createLeague({ seed: 'standing' });
const fresh = () => structuredClone(base);
const wrOf = (l: League) => starters(l, l.teams[0], 'WR')[0];

describe('standing: weight', () => {
  it('seniority follows the table', () => {
    expect(seniority(0, false)).toBeCloseTo(0.6);
    expect(seniority(2, false)).toBeCloseTo(0.8);
    expect(seniority(4, false)).toBeCloseTo(1.0);
    expect(seniority(8, false)).toBeCloseTo(1.15);
    expect(seniority(12, false)).toBeCloseTo(1.15);
    expect(seniority(4, true)).toBeCloseTo(0.8);
  });
  it('rises with leadership, seniority and an honour', () => {
    const l = fresh(); const p = wrOf(l);
    p.traits.leads = 8; const low = weightOf(l, p, moraleContext(l));
    p.traits.leads = 16; const high = weightOf(l, p, moraleContext(l));
    expect(high).toBeGreaterThan(low);
    p.experience = 1; const young = weightOf(l, p, moraleContext(l));
    p.experience = 6; expect(weightOf(l, p, moraleContext(l))).toBeGreaterThan(young);
    const before = weightOf(l, p, moraleContext(l));
    l.awards.push({ season: l.season - 1, winners: { opoy: { playerId: p.id, teamId: p.teamId } }, allLeague: [[], []] });
    expect(weightOf(l, p, moraleContext(l)) / before).toBeCloseTo(1.2);
  });
  it('a newcomer counts ×0.8 until he has a season at the club', () => {
    const l = fresh(); const p = wrOf(l);
    p.statTeams = { [l.season - 1]: [p.teamId! + 1] }; delete p.draft;
    expect(isNewcomer(l, p)).toBe(true);
    p.statTeams = { [l.season - 1]: [p.teamId!] };
    expect(isNewcomer(l, p)).toBe(false);
  });
});

describe('standing: tiers and sound', () => {
  it('a captain is always a leader', () => {
    const l = fresh(); const p = wrOf(l);
    l.teams[0].captains = { season: l.season, offense: p.id, defense: -1, specialTeams: -1 };
    expect(tierOf(l, p, 0.1)).toBe('leader');
  });
  it('a rookie is never a leader unless he is a captain', () => {
    const l = fresh(); const qb = starters(l, l.teams[0], 'QB')[0];
    Object.assign(qb, { experience: 0 }); qb.traits.leads = 20;
    l.awards.push({ season: l.season - 1, winners: { oroy: { playerId: qb.id, teamId: qb.teamId } }, allLeague: [[], []] });
    expect(tierOf(l, qb, weightOf(l, qb, moraleContext(l)))).not.toBe('leader');
  });
  it('stirs, steadies, and stirs wins when both hold', () => {
    const p = wrOf(fresh());
    Object.assign(p.traits, { controversy: 14, leads: 10, temperament: 10 }); expect(soundOf(p)).toBe('stirs');
    Object.assign(p.traits, { controversy: 10, leads: 14, temperament: 12.25 }); expect(soundOf(p)).toBe('steadies');
    Object.assign(p.traits, { controversy: 14, leads: 14, temperament: 12.25 }); expect(soundOf(p)).toBe('stirs');
  });
  it('units follow the position coaches rooms', () => {
    expect(unitOf('TE')).toBe('WR'); expect(unitOf('EDGE')).toBe('DL'); expect(unitOf('K')).toBe('ST');
    expect(sideOf('OL')).toBe('offense'); expect(sideOf('DB')).toBe('defense'); expect(sideOf('ST')).toBe('specialTeams');
  });
});
```

(Clear `p.shifts` before setting temperament if the fixture player has any: `temperamentOf` adds mentoring's shifts.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL (module `./standing` not found)

- [ ] **Step 3: Implement** the Produces list in `standing.ts`; add `honoured` to `MoraleContext` and build it in
  `moraleContext`.
  - `weightOf = leadFactor(p.traits.leads) × field × seniority(p.experience, isNewcomer(league, p)) × stature`.
  - field: `{ 2: 1, 1: 0.7, 0: 0.4 }[actualRole(league, p, ctx) ?? lastRole]`, where `lastRole` is last season's
    `seasonRole` as 2 / 1 / 0, else 0.
  - stature: ×1.2 when `ctx.honoured.has(p.id)`; ×1.15 when he's `starters(league, team, 'QB')[0]`.
  - `isNewcomer`: no season before `league.season` in `p.statTeams` lists his club, and `p.draft?.teamId` isn't his
    club.
  - `honouredSince`: every `winners` and `allLeague` player in `league.awards` with `season >= season`.
  - `soundOf`: z of `p.traits.controversy`, `p.traits.leads`, `temperamentOf(p)`; stirs at controversy z ≥ 1;
    steadies at leads z ≥ 1 and temperament z ≥ 0.5.
  - `tierOf`: `isCaptain` → leader; then `LEADER_AT`, `VOICE_AT`.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/engine/standing.test.ts src/engine/morale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts src/engine/morale.ts
git commit -m "Standing: units, weight, leaders and voices"
```

---

### Task 2: A voice's mood rubs off

**Files:**
- Modify: `src/engine/standing.ts`, `src/engine/morale.ts` (`MoraleContext`, `moraleContext`, `roomScore`)
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: Task 1's `weightOf`, `tierOf`, `soundOf`, `unitOf`, `sideOf`; `moodLean`, `moraleLevel`,
  `moraleClock` (`morale.ts`).
- Produces:
  - `interface VoiceRef { id: number; weight: number; sound: Sound | null }`
  - `roomVoices(league: League, ctx: MoraleContext): { voices: Map<string, VoiceRef[]>; sideCaptains: Map<string, VoiceRef> }`,
    keyed `${teamId}:${unit}` and `${teamId}:${side}`; leaders and voices only, from `activeRoster`
  - `loudness(sound: Sound | null, lean: number): number`
  - `TONE` (Global Constraints values)
  - `toneOf(p: Player, ctx: MoraleContext): number`, clamped to −1…1
  - `friendLean(league: League, p: Player, ctx: MoraleContext): number`
  - `MoraleContext.leans: Map<number, number>` (every rostered player's `moodLean(moraleLevel(...))` at
    `league.moraleAt ?? moraleClock(league)`), `MoraleContext.voices`, `MoraleContext.sideCaptains`

- [ ] **Step 1: Write the failing tests** (append to `standing.test.ts`)

```ts
describe('standing: tone', () => {
  const setup = () => { const l = fresh(); return { l, ctx: moraleContext(l), p: wrOf(l) }; };
  it('is zero with no voices around him', () => {
    const { l, ctx, p } = setup();
    ctx.voices = new Map(); ctx.sideCaptains = new Map();
    expect(toneOf(p, ctx)).toBe(0);
  });
  it('stays inside −1…1 when the whole league is miserable', () => {
    const { l, ctx, p } = setup();
    for (const id of ctx.leans.keys()) ctx.leans.set(id, -1);
    expect(Math.abs(toneOf(p, ctx))).toBeLessThanOrEqual(1);
  });
  it('a voice who stirs pulls half again as hard when he is down', () => {
    const { ctx, p } = setup();
    const v: VoiceRef = { id: -7, weight: 2, sound: null };
    ctx.voices.set(`${p.teamId}:WR`, [v]); ctx.sideCaptains = new Map(); ctx.leans.set(v.id, -1);
    const even = toneOf(p, ctx); v.sound = 'stirs';
    expect(toneOf(p, ctx) / even).toBeCloseTo(1.5);
  });
  it('a quiet unit-mate never counts', () => {
    const { l, ctx, p } = setup();
    const before = toneOf(p, ctx);
    const quiet = activeRoster(l, p.teamId!).find((q) => unitOf(q.position) === 'WR' && q.id !== p.id && !tierOf(l, q, weightOf(l, q, ctx)))!;
    ctx.leans.set(quiet.id, -1);
    expect(toneOf(p, ctx)).toBe(before);
  });
  it('his own mood never feeds his own tone', () => {
    const { ctx, p } = setup();
    ctx.voices.set(`${p.teamId}:WR`, [{ id: p.id, weight: 2, sound: null }]); ctx.sideCaptains = new Map();
    expect(toneOf(p, ctx)).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL (`toneOf` is not exported)

- [ ] **Step 3: Implement.** In `moraleContext`, build the base context first, then
  `Object.assign(ctx, roomVoices(league, ctx))` (weights need `records` and `live`). Snapshot `leans` before any
  level moves, so a step reads every voice as it stood (order-independent). `toneOf`:
  `Σ w·loudness(sound, lean)·lean / max(Σ w, TONE.floor)` over his unit's voices plus his side's captain, deduplicated,
  excluding him. `friendLean`: his first `TONE.friends` friend ties at his club, `TONE.friend × lean` each.
  `roomScore` adds `TONE.weight * toneOf(p, ctx) + friendLean(league, p, ctx)` before its existing clamp.

- [ ] **Step 4: Run the tests, then the league check**

Run: `npx vitest run src/engine/standing.test.ts src/engine/morale.test.ts src/engine/moraleEffects.test.ts src/engine/morale.rng.test.ts`
Expected: PASS. A morale test pinned to an exact room value may move; update it only if its new value is the tone
term's (explain why in the commit), never to make an unrelated failure pass.

Run: `npm run morale -- --seasons 2`
Expected: every existing line ✓.

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts src/engine/morale.ts src/engine/morale.test.ts
git commit -m "Morale: a voice's mood rubs off on his unit"
```

---

### Task 3: Captains by weight; leaders and voices lists

**Files:**
- Modify: `src/engine/personality.ts` (`nameCaptains`; remove `leadersOf`), `src/engine/standing.ts`,
  `src/engine/lockerReport.ts` and `src/ui/screens/LockerRoom.tsx` (import `leadersOf` from `./standing`)
- Test: `src/engine/personality.test.ts`, `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: Task 1's `weightOf`, `tierOf`.
- Produces: `leadersOf(league: League, teamId: number): Player[]` (non-captain leaders, heaviest first, ties by id)
  and `voicesOf(league: League, teamId: number): Player[]` (voices, heaviest first), both in `standing.ts`.
  `nameCaptains` rates each candidate by `weightOf` with one `moraleContext(league)` per call.

- [ ] **Step 1: Write the failing tests**

```ts
// personality.test.ts
it('names the veteran over a younger starter with a slightly better read', () => {
  const l = createLeague({ seed: 'captains-weight' });
  const side = ['QB', 'RB', 'WR', 'TE', 'OL'].flatMap((pos) => starters(l, l.teams[0], pos as Position));
  for (const p of side) p.traits.leads = 1;
  const [vet, kid] = side.filter((p) => p.position === 'OL');
  Object.assign(vet, { experience: 10 }); vet.traits.leads = 12;
  Object.assign(kid, { experience: 1 }); kid.traits.leads = 13;
  nameCaptains(l);
  expect(l.teams[0].captains!.offense).toBe(vet.id);
});
// standing.test.ts
it('leadersOf leaves out the captains; voicesOf holds only voices', () => {
  const l = fresh(); nameCaptains(l); const ctx = moraleContext(l);
  const c = l.teams[0].captains!;
  for (const p of leadersOf(l, 0)) expect([c.offense, c.defense, c.specialTeams]).not.toContain(p.id);
  for (const p of voicesOf(l, 0)) expect(tierOf(l, p, weightOf(l, p, ctx))).toBe('voice');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/personality.test.ts src/engine/standing.test.ts`
Expected: FAIL (the kid is captain today; `voicesOf` missing)

- [ ] **Step 3: Implement** the Produces list; update both `leadersOf` imports.

- [ ] **Step 4: Run them to see them pass, then the touched suites**

Run: `npx vitest run src/engine/personality.test.ts src/engine/standing.test.ts src/engine/lockerReport.test.ts src/ui/morale.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/personality.ts src/engine/standing.ts src/engine/lockerReport.ts src/ui/screens/LockerRoom.tsx src/engine/*.test.ts
git commit -m "Captains named by weight; leaders and voices lists"
```

---

### Task 4: A unit's read and your club's views

**Files:**
- Modify: `src/engine/standing.ts`, `src/engine/morale.ts` (export the context `moraleView` caches)
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `moraleView`, `moraleStepOf`, `MORALE_WORDS`, `TEMPERAMENT_REASONS` (`morale.ts`);
  `ROOM_LABEL` (`coaching.ts`).
- Produces:
  - `viewContext(league: League): MoraleContext` in `morale.ts`: the cached context `moraleView` uses (same key);
    `moraleView` calls it.
  - `type UnitWord = 'Tight' | 'Settled' | 'Restless' | 'Down' | 'Split'`; `SPLIT_SHARE`, `READ_MIN`
  - `interface UnitRead { teamId: number; unit: Unit; word: UnitWord; members: number[]; setter: number | null; pulling: 'up' | 'down' | 'even' | null; noVoice: boolean }`
  - `unitRead(league, teamId, unit, ctx): UnitRead | null` (null for `'ST'` and below `READ_MIN` men); `unitReads(league, teamId, ctx): UnitRead[]`
  - `type WhyPart = 'captain' | 'veteran' | 'starts' | 'honoured' | 'quarterback' | 'leads' | 'newcomer'`
  - `interface StandingView { tier: Tier | null; sound: Sound | null; parts: WhyPart[] }`;
    `standingView(league, p, ctx?): StandingView | null` (null unless he's on your club)
  - `interface UnitView extends Omit<UnitRead, 'teamId' | 'members'> { label: string; members: number; reasons: { text: string; count: number }[] }`
  - `interface RoomView { word: string; units: UnitView[]; leaders: number[]; voices: number[]; apart: 'young down' | 'vets down' | null }`;
    `roomView(league: League, ctx = viewContext(league)): RoomView`

- [ ] **Step 1: Write the failing tests** (`standing.test.ts`)

```ts
describe('standing: a unit read', () => {
  const levels = (l: League, unit: Unit, f: (i: number) => number) =>
    activeRoster(l, 0).filter((p) => unitOf(p.position) === unit).forEach((p, i) => { p.morale = { level: f(i) }; });
  it('reads Tight, Down and Split off the weighted levels', () => {
    const l = fresh();
    levels(l, 'OL', () => 2); expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Tight');
    levels(l, 'OL', () => -4); expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Down');
    levels(l, 'OL', (i) => (i % 2 ? 2 : -2)); expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Split');
  });
  it('gives no read to the specialists or a room below three men', () => {
    const l = fresh();
    expect(unitRead(l, 0, 'ST', moraleContext(l))).toBeNull();
    const qbs = activeRoster(l, 0).filter((p) => p.position === 'QB');
    for (const q of qbs.slice(2)) q.teamId = null;
    expect(unitRead(l, 0, 'QB', moraleContext(l))).toBeNull();
  });
  it('flags a unit with no voice of its own', () => {
    const l = fresh();
    for (const p of activeRoster(l, 0).filter((p) => unitOf(p.position) === 'DB')) p.traits.leads = 1;
    l.teams[0].captains = undefined;
    expect(unitRead(l, 0, 'DB', moraleContext(l))!.noVoice).toBe(true);
  });
});

describe('standing: your views', () => {
  it('shows your club only', () => {
    const l = fresh(); const other = activeRoster(l, (l.userTeamId + 1) % 32)[0];
    expect(standingView(l, other)).toBeNull();
    expect(roomView(l).units.every((u) => u.unit !== 'ST')).toBe(true);
  });
  it('drops a released voice at once', () => {
    const l = fresh(); const v = voicesOf(l, l.userTeamId)[0];
    expect(roomView(l).voices).toContain(v.id);
    releasePlayer(l, v); // finance/cap.ts: the release the roster screen calls, which logs a transaction
    expect(roomView(l).voices).not.toContain(v.id);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL (`unitRead` not exported)

- [ ] **Step 3: Implement.**
  - Weights in a read: `max(weightOf, 0.3)`. Split when the share at step ≥ 5 and the share at step ≤ 3 are both
    ≥ `SPLIT_SHARE`; otherwise by `moraleStepOf(mean)`: ≥ 5 Tight, 4 Settled, 3 Restless, ≤ 2 Down.
  - `setter`: the heaviest leader or voice in the unit, else the side's captain; `pulling` from his lean
    (≥ 0.17 up, ≤ −0.17 down, else even); `noVoice` when the unit has no leader or voice and the side's captain isn't
    in it.
  - `reasons`: each member's `moraleView` reasons minus `TEMPERAMENT_REASONS`, counted, most-felt first, top two.
  - `RoomView.word`: `MORALE_WORDS[moraleStepOf(weighted mean of the 53)]`; `apart`: vets (experience ≥ 6) and young
    (experience ≤ 2) weighted means two steps apart or more.
  - `StandingView.parts`, in this order when they hold: captain, quarterback (the starting QB), veteran
    (experience ≥ 6), starts (role 2), honoured, leads (leadership z ≥ 1), newcomer.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/engine/standing.test.ts src/engine/morale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts src/engine/morale.ts
git commit -m "Standing: a unit's read and your club's views"
```

---

### Task 5: The room's words: facts and banks

**Files:**
- Create: `src/engine/roomFacts.ts`, `src/engine/roomVoice.ts`
- Modify: `src/engine/lockerVoice.ts` (`VerdictFact`, `quiet`, `VERDICT`)
- Test: `src/engine/roomVoice.test.ts`

**Interfaces:**
- Consumes: Task 4's views; `Line`, `say`, `toldKeys` (`voice.ts`); `TeamRecord.streak` (`"L3"`, `season/standings.ts`).
- Produces, in `roomVoice.ts` (pure: no `League`, no `Player`):
  - `UNIT_PHRASE: Record<Exclude<Unit, 'ST'>, string>` = QB "the quarterbacks", RB "the backs", WR "the receivers",
    OL "the line", DL "the D-line", LB "the linebackers", DB "the secondary"
  - `inWords(n: number): string` (0–20 in words: "no", "one" … "twenty"); `coachCount(n: number, total: number, group = 'them'): string`
    (≤ 4: the word; else share ≥ 0.95 "the whole …"/"all of them", ≥ 0.6 "most of …", ≥ 0.4 "half …", else "several of them")
  - `type Cause = 'snaps' | 'deal' | 'losing' | 'feud'`; `causeOf(reason: string): Cause | null` (snaps: "Wants more
    snaps", "Waiting on his snaps", "Still stung by the benching"; deal: "Wants a new deal", "Waiting on his new deal",
    "Noticed who got paid"; losing: "The losing is wearing on him"; feud: "A feud in the room")
  - `interface UnitFact { unit: string; word: UnitWord; still: boolean; turned: boolean; setter: string | null; setterCaptain: boolean; setterSound: Sound | null; pulling: 'up' | 'down' | 'even' | null; cause: Cause | null; causeCount: string | null; upYoung: boolean; rival: string | null; losingRun: number; noVoice: boolean; goneLeader: string | null; nearVoice: string | null }`
  - `interface StandingFact { name: string; now: Tier | null; was: Tier | null; experience: number; newcomer: boolean; starts: boolean; captain: boolean; benched: boolean; stirs: boolean; unit: string }`
  - `interface WhyFact { parts: WhyPart[]; experience: number; unit: string }`
  - Banks: `UNIT_NOTE` (head coach, report rows), `UNIT_TURN` (position coach, first person), `STANDING_NOTE`,
    `STANDING_WHY` (the screen's reason: "Eight years in, starts, the line goes to him.")
- Produces, in `roomFacts.ts`:
  - `lastTold(told: Set<string>): { units: Map<Unit, { word: UnitWord; clock: number }>; standing: { clock: number; tiers: Map<number, Tier> } | null }`
    (parses `unit:{clock}:{unit}:{word}` and `standing:{clock}:{playerId}:{tier}`; the latest clock wins)
  - `unitFact(league: League, view: UnitView, last: { word: UnitWord } | null, gone: string | null): UnitFact`
  - `standingFact(league: League, p: Player, now: Tier | null, was: Tier | null): StandingFact`
  - `whyFact(league: League, p: Player, view: StandingView): WhyFact`
- `VerdictFact` gains optional `split?: string[]`, `down?: string[]`, `tight?: string | null`,
  `apart?: 'young down' | 'vets down' | null`; `quiet` is false when any is set.

Fact rules (`roomFacts.ts`): `upYoung` when men in their first three seasons hold half the weight on the Good side;
`rival` is the starter at the setter's position when the setter is down with cause `snaps` and doesn't start;
`losingRun` from the club's `streak` (`"L3"` → 3, else 0); `nearVoice` (only with `noVoice`) is the unit's heaviest
man when he's within 0.1 of `VOICE_AT` and in his first three seasons.

- [ ] **Step 1: Write the failing tests** (`roomVoice.test.ts`)

```ts
const BANNED = /standing|weight|influence|\btiers?\b|hierarch|faction|clique|cohesion|contagion|\bspread|atmosphere|gauge|chemistry|\bmorale\b|\blevel\b|marble|\btraits?\b|z-score/i;
const unit = (o: Partial<UnitFact> = {}): UnitFact => ({ unit: 'the receivers', word: 'Split', still: false, turned: true,
  setter: null, setterCaptain: false, setterSound: null, pulling: null, cause: null, causeCount: null, upYoung: false,
  rival: null, losingRun: 0, noVoice: false, goneLeader: null, nearVoice: null, ...o });
const WORDS: UnitWord[] = ['Tight', 'Settled', 'Restless', 'Down', 'Split'];

it('counts like a coach', () => {
  expect(coachCount(2, 9)).toBe('two'); expect(coachCount(4, 9)).toBe('four');
  expect(coachCount(5, 10, 'the line')).toBe('half the line');
  expect(coachCount(7, 10, 'the line')).toBe('most of the line');
});
it('maps reasons to causes', () => {
  expect(causeOf('Waiting on his snaps')).toBe('snaps'); expect(causeOf('Noticed who got paid')).toBe('deal');
  expect(causeOf('Loving the winning')).toBeNull();
});
it('every bank has a line for every case, in plain football words', () => {
  const lines: string[] = [];
  for (const word of WORDS) for (const still of [false, true]) for (const setter of [null, 'Mack'])
    for (const sound of [null, 'stirs', 'steadies'] as const) for (const cause of [null, 'snaps', 'deal', 'losing', 'feud'] as const) {
      const f = unit({ word, still, setter, setterSound: setter ? sound : null, cause, causeCount: cause && 'two' });
      lines.push(say(UNIT_NOTE, f, { key: 'k', slot: `${word}` }), say(UNIT_TURN, f, { key: 'k', slot: `${word}` }));
    }
  for (const now of [null, 'leader', 'voice'] as const) for (const was of [null, 'leader', 'voice'] as const) if (now !== was)
    lines.push(say(STANDING_NOTE, { name: 'Hill', now, was, experience: 1, newcomer: false, starts: true, captain: false, benched: now === null, stirs: false, unit: 'the receivers' }, { key: 'k', slot: 's' }));
  lines.push(say(STANDING_WHY, { parts: ['veteran', 'starts'], experience: 8, unit: 'the line' }, { key: 'k', slot: 'w' }));
  for (const s of lines) { expect(s.length).toBeGreaterThan(10); expect(s).not.toMatch(/\d/); expect(s).not.toMatch(BANNED); }
});
it('the most specific line names the man and the reason', () => {
  const s = say(UNIT_NOTE, unit({ setter: 'Mack', setterSound: 'stirs', pulling: 'down', cause: 'snaps', rival: 'Hill', upYoung: true }), { key: 'k', slot: 'u' });
  expect(s).toMatch(/Mack/); expect(s).toMatch(/Hill|job|snaps/);
});
it('"still" reads as still', () => {
  expect(say(UNIT_NOTE, unit({ still: true, turned: false }), { key: 'k', slot: 'u' })).toMatch(/still/i);
});
it('a split unit never claims it costs us on the field', () => {
  for (const sound of [null, 'stirs'] as const)
    expect(say(UNIT_NOTE, unit({ setter: 'Mack', setterSound: sound }), { key: 'k', slot: 'u' })).not.toMatch(/costing|Sunday|on the field/i);
});
it('lastTold keeps the latest clock', () => {
  const t = lastTold(new Set(['unit:400:WR:Split', 'unit:405:WR:Restless', 'standing:400:7:voice', 'standing:405:8:leader']));
  expect(t.units.get('WR')).toEqual({ word: 'Restless', clock: 405 });
  expect([...t.standing!.tiers]).toEqual([[8, 'leader']]);
});
```

Add one league-built test: `unitFact` over every `roomView` unit of a played league (`simToEndOfSeason` on a fresh
league) returns a fact whose `say(UNIT_NOTE, …)` passes the same three checks.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/roomVoice.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Write the banks.** Seed `UNIT_NOTE`, `UNIT_TURN`, `STANDING_NOTE` and the new `VERDICT` lines with
  spec §6.3's lines verbatim at the `reads` levels it shows, then add variants so each word has at least two
  fallback lines (`reads: 0` or `1`) and the verdict's new cases at least three. Every line follows spec §6.2.
  `UNIT_TURN` lines are first person ("My room…", "my guys"). Numbers go through `inWords`/`coachCount`.

- [ ] **Step 4: Implement `roomFacts.ts`** per the Produces list and the fact rules above.

- [ ] **Step 5: Run them to see them pass**

Run: `npx vitest run src/engine/roomVoice.test.ts src/engine/lockerVoice.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/roomFacts.ts src/engine/roomVoice.ts src/engine/roomVoice.test.ts src/engine/lockerVoice.ts
git commit -m "The room's words: unit, standing and verdict lines"
```

---

### Task 6: The head coach's report

**Files:**
- Modify: `src/engine/lockerReport.ts`
- Test: `src/engine/lockerReport.test.ts`

**Interfaces:**
- Consumes: `roomView`, `standingView`, `tierOf`, `weightOf`, `unitOf` (Task 4); `lastTold`, `unitFact`,
  `standingFact`, `UNIT_NOTE`, `STANDING_NOTE`, `UNIT_PHRASE` (Task 5); `moraleClock`.
- Produces: report sections `'Who the room follows'` (renamed from `'Captains and leaders'`, columns
  `['Player', 'Role', 'Our read']`) and `'The room'` (columns `['Unit', 'Read']`, no `playerId`, placed right after
  "Who the room follows"); `covered` gains `standing:{clock}:{playerId}:{tier}` for every current leader and voice and
  `unit:{clock}:{unit}:{word}` for every read unit, with `clock = moraleClock(league)`, on every report.

Rules: a unit gets a row when its word differs from `lastTold`'s, or it's Split or Down (`still` when the word is
the same as last told). With no earlier `unit:` key, only Split and Down get rows. Standing-change rows (Role cell:
"Now a leader", "Found his voice", "Quieter now") only when `lastTold(...).standing` exists. `gone` for a unit is a
leader in the last told tiers whose player's `teamId` is no longer ours (IR is still ours). The verdict fact gets
`split`, `down`, `tight` and `apart` from `roomView`.

- [ ] **Step 1: Write the failing tests** (`lockerReport.test.ts`; rename the existing `'Captains and leaders'`
  lookups to `'Who the room follows'`)

```ts
describe('the locker room report: the room', () => {
  it('a first report tells only Split and Down units, and no standing changes', () => {
    const l = copy(template); at(l, 'preseason'); nameCaptains(l); deliverMail(l);
    const m = reports(l).at(-1)!;
    for (const r of section(m, 'The room')?.rows ?? []) expect(['Split', 'Down']).toContain(r.cells[1]);
    expect(section(m, 'Who the room follows')!.rows.some((r) => /Found his voice|Now a leader|Quieter now/.test(r.cells[1]))).toBe(false);
  });
  it('stamps every leader, voice and read unit', () => {
    const l = copy(template); at(l, 'preseason'); nameCaptains(l); deliverMail(l);
    const m = reports(l).at(-1)!;
    expect(m.covered!.some((k) => /^unit:\d+:(QB|RB|WR|OL|DL|LB|DB):\w+$/.test(k))).toBe(true);
    expect(m.covered!.some((k) => /^standing:\d+:\d+:(leader|voice)$/.test(k))).toBe(true);
  });
  it('a unit still Split at the next report reads "still"', () => {
    // camp report with the receivers forced Split, then cut-down with the same levels
    const l = copy(template); at(l, 'preseason'); nameCaptains(l); splitUnit(l, 'WR'); deliverMail(l);
    at(l, 'regular', 1); splitUnit(l, 'WR'); deliverMail(l);
    expect(section(reports(l).at(-1)!, 'The room')!.rows.find((r) => r.cells[0] === ROOM_LABEL.WR)!.note).toMatch(/still/i);
  });
  it('a leader on injured reserve has not left', () => {
    const l = copy(template); at(l, 'preseason'); nameCaptains(l); deliverMail(l);
    const inDb = (x: Player) => unitOf(x.position) === 'DB';
    const p = leadersOf(l, l.userTeamId).find(inDb) ?? voicesOf(l, l.userTeamId).find(inDb)!;
    p.ir = { season: l.season, week: 1, weeks: 0 };
    at(l, 'regular', 1); deliverMail(l);
    expect(text(reports(l).at(-1)!)).not.toMatch(new RegExp(`since ${p.lastName} left`));
  });
});
```

(`splitUnit(l, unit)` sets the unit's men's `morale.level` alternately to 2 and −2 and deletes their jolts.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/lockerReport.test.ts`
Expected: FAIL (no 'The room' section)

- [ ] **Step 3: Implement** per the rules above.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/engine/lockerReport.test.ts src/engine/lockerVoice.test.ts src/engine/inbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/lockerReport.ts src/engine/lockerReport.test.ts
git commit -m "Locker report: who the room follows, and the room by unit"
```

---

### Task 7: The position coach's note

**Files:**
- Modify: `src/engine/staffNotes.ts`
- Test: `src/engine/staffNotes.test.ts`

**Interfaces:**
- Consumes: `roomView` (Task 4); `lastTold`, `unitFact`, `UNIT_TURN`, `UNIT_PHRASE` (Task 5); `teamCoaches`,
  `ROOM_LABEL`, `COACH_ROLE_LABEL` (`coaching.ts`); `moraleClock`.
- Produces: `unitTurnFor(league: League, told: Set<string>): { unit: Unit; word: UnitWord; coachId: number; key: string; fact: UnitFact } | null`
  and `NOTE_GAP = 3`. The letter gains a row `{ cells: [ROOM_LABEL[unit], '<coach name>, <chair>'], note }` and
  `covered` gains `key` (`unit:{clock}:{unit}:{word}`). `OPENER`'s fact gains `units: number` with lines for a unit
  note alone and with the others. Subject for a unit note alone: `From the staff: ${UNIT_PHRASE[unit]}`.

Rules: a turn is the current word differing from the last told word with the current word Split, Down or Tight, or
the last told Split or Down. Skip a unit told within `NOTE_GAP` clock steps, and a unit whose room has no position
coach on your staff. One note a week: Split before Down before a recovery before Tight, then `UNITS` order.

- [ ] **Step 1: Write the failing tests** (`staffNotes.test.ts`)

```ts
it('the position coach writes when his unit turns Split', () => {
  const l = inSeason(); told(l, 'WR', 'Settled', -5); splitUnit(l, 'WR');
  const turn = unitTurnFor(l, toldKeys(l))!;
  expect(turn.unit).toBe('WR'); expect(turn.word).toBe('Split');
});
it('says nothing about a unit told within three weeks', () => {
  const l = inSeason(); told(l, 'WR', 'Split', -2); setUnit(l, 'WR', 0); // Settled now, told Split two steps ago
  expect(unitTurnFor(l, toldKeys(l))).toBeNull();
});
it('ignores Settled to Restless', () => {
  const l = inSeason(); told(l, 'WR', 'Settled', -5); setUnit(l, 'WR', -2);
  expect(unitTurnFor(l, toldKeys(l))?.unit).not.toBe('WR');
});
it('stays quiet when the room has no position coach', () => {
  const l = inSeason(); told(l, 'WR', 'Settled', -5); splitUnit(l, 'WR'); fireRoomCoach(l, 'WR');
  expect(unitTurnFor(l, toldKeys(l))?.unit).not.toBe('WR');
});
```

(Helpers in the test file: `inSeason()` is a fresh league at regular-season week 6 with every unit's levels at 0
and `unit:{clock − 5}:{unit}:Settled` filed for each in `l.mailTold` (`Record<string, number>`, any value);
`told(l, unit, word, ago)` files `l.mailTold[\`unit:${moraleClock(l) + ago}:${unit}:${word}\`] = 1`;
`setUnit(l, unit, level)` and `splitUnit(l, unit)` set the unit's men's `morale.level` and delete their jolts;
`fireRoomCoach(l, unit)` calls `releaseCoach(l, l.userTeamId, id)` (`coaching.ts`) for the position coach whose
`room` is `unit`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/staffNotes.test.ts`
Expected: FAIL (`unitTurnFor` not exported)

- [ ] **Step 3: Implement** per the rules; `staffNotesMail` returns nothing only when there's no call, no habit and
  no unit note.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run src/engine/staffNotes.test.ts src/engine/inbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/staffNotes.ts src/engine/staffNotes.test.ts
git commit -m "Staff notes: the position coach on his unit"
```

---

### Task 8: The Locker Room screen

**Files:**
- Modify: `src/ui/screens/LockerRoom.tsx`
- Test: `src/ui/morale.test.tsx`

**Interfaces:**
- Consumes: `roomView`, `standingView` (Task 4); `whyFact`, `STANDING_WHY` (Task 5); `say`; `SortTh`, `useSort`
  (`ui/components.tsx`); `PlayerLink`, `PersonalityPill`.
- Produces: the "Captains" section becomes **"Who the room follows"**: captains as now, then "Leaders" and "Voices"
  lists, each row `PlayerLink`, `PersonalityPill` and the reason `say(STANDING_WHY, whyFact(...), { key: \`why:${p.id}\`, slot: 'why' })`.
  A new section **"The units"** (`id="locker-units"`): a table with `SortTh` columns Unit, Read, Sets the tone
  (`PlayerLink` or "—"), What's going on (top reason with `coachCount`, e.g. "Three of them want more snaps", or "—").
  The room's mood at the top reads `roomView(league).word`.

- [ ] **Step 1: Write the failing test** (`morale.test.tsx`)

```ts
it('shows who the room follows and the units, in words', () => {
  const html = render(<LockerRoom league={league} />);
  expect(html).toContain('Who the room follows');
  expect(html).toContain('The units');
  for (const label of ['Offensive line', 'Secondary']) expect(html).toContain(label);
  expect(html).toMatch(/Tight|Settled|Restless|Down|Split/);
  expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\bweight\b|\btier\b|faction|cohesion/i);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/ui/morale.test.tsx`
Expected: FAIL (no 'The units')

- [ ] **Step 3: Implement** per Produces.

- [ ] **Step 4: Run it and the screen contract**

Run: `npx vitest run src/ui/morale.test.tsx src/ui/ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/LockerRoom.tsx src/ui/morale.test.tsx
git commit -m "Locker Room: who the room follows, and the units"
```

---

### Task 9: The league check, calibration and the release

**Files:**
- Modify: `scripts/morale.ts`, `package.json` (version 0.2.36), `src/ui/changelog.ts`, `CLAUDE.md` (architecture
  list and the `npm run morale` line)
- Test: `npm run morale`

**Interfaces:**
- Consumes: `tierOf`, `weightOf`, `soundOf`, `unitReads`, `toneOf`, `UNITS` (Tasks 1–4); `moraleContext`.

- [ ] **Step 1: Add the checks** to `scripts/morale.ts`, sampled in `sample()` at weeks 9 and 18 over every club,
  with `check(label, value, range)`:

| Label | Value | Range |
| --- | --- | --- |
| `Leaders per club (captains included)` | mean count | `[3, 6]` |
| `Voices per club` | mean count | `[6, 12]` |
| `Clubs with no leader past the captains` | share of club-samples | `[0.1, 0.3]` |
| `Unit reads: Split` / `Down` / `Tight` | share of unit-samples | `[0.05, 0.15]` / `[0.05, 0.2]` / `[0.15, 0.35]` |
| `Club rooms at Poor or worse` | share of club-samples, weighted room mean step ≤ 3 | `[0.05, 0.25]` |
| `A stirrer's mates minus an even voice's (room factor)` | mean `(even − stirs)` over unit-mates of down voices (lean ≤ −0.17) | `[0.01, 10]` |
| `A steadier's mates minus an even voice's (room factor)` | mean `(steadies − even)` likewise | `[0.01, 10]` |
| `Voices' pull on a room factor (mean size)` | mean `|TONE.weight × toneOf|` over rostered players | `[0.05, 0.4]` |

- [ ] **Step 2: Run it and calibrate**

Run: `npm run morale`
Expected: every line ✓. If a standing or unit-read line misses, tune only `LEADER_AT`, `VOICE_AT` or `SPLIT_SHARE`
(Global Constraints), re-run, and note the final values in the commit. Never widen a range. If a direction line
fails, the mechanic is wrong: fix the code.

- [ ] **Step 3: Release notes.** `package.json` 0.2.35 → 0.2.36 (a patch: no MVP item finishes); a changelog entry
  newest first, in a player's words (title "Who runs the room"); in `CLAUDE.md`'s architecture list, a line for
  `standing.ts`, `roomFacts.ts` and `roomVoice.ts` beside `morale.ts`, and the new checks in the `npm run morale`
  line.

- [ ] **Step 4: Run the touched suites and typecheck**

Run: `npm run typecheck && npx vitest run src/ui/changelog.test.ts src/engine/standing.test.ts`
Expected: PASS

- [ ] **Step 5: Read the letters by eye.** `npm run mail-preview`, then `npm run screens -- --mail locker staffNotes`;
  read every report and note against spec §6.2 and fix any line that breaks a rule.

- [ ] **Step 6: Commit and push**

```bash
git add scripts/morale.ts package.json src/ui/changelog.ts CLAUDE.md src/engine/standing.ts
git commit -m "Morale check: standing, unit reads and the voices' pull; 0.2.36"
git push -u origin claude/bold-fermat-4pxknq
```

Then read CI on the pull request when one is opened; `careers` runs there (mood tilts growth), and nothing may be
flagged ▲/▼.
