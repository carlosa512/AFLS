# Mentoring (PR 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Veterans mentor young players, moving work ethic, temperament and poise at most a point a year each; teams
name captains; the Locker Room tab arrives with Leaders and Mentoring.

**Architecture:** A new `mentoring.ts` owns who can mentor, how much rubs off, pairing (one planner for your staff and
AI teams), the weekly count of weeks together and the season-end shift. Shifts are stored beside the traits
(`Player.shifts`) and read through accessors (`workEthicOf`, `temperamentOf`, `poiseOf`, `effectiveTraits`), so
`traits` never changes. Leadership gets its job, so `TRAITS_ON` gains `leads`.

**Tech Stack:** TypeScript, Vitest, React (Vite), Prettier.

**Spec:** `docs/superpowers/specs/2026-10-28-personality-relationships-design.md` (§1.6, §2, §5.1–5.4). Also
`docs/TRAINING.md` §8, whose rules stand.

**Branch:** stacked on PR 1's branch (`claude/relaxed-archimedes-hyjd24`); the branch name is confirmed with the owner
before the first push.

## Global Constraints

- Everything in PR 1's Global Constraints holds (seeded draws, plain JSON, fog of war, plain copy, format, checks).
- §8's rules: at most 1 point a year per trait, young players 21–24, cuts both ways, builds week by week while both
  are on the active 53 (IR pauses it), one mentor per player, at most two players per mentor, position bonus
  ×1.1–1.15, words only.
- The planner chooses mentors by **leadership and standing only**, never by work ethic (the drift guard, spec §2.5).
- Nothing here is ever "needs you"; the staff pair by default.
- Save: optional fields only, so the step is a version bump (`if (league.version < 61) league.version = 61;`).

## Review Focus

1. **A pair split mid-season** (trade, cut, IR, retirement): weeks so far settle once, the pair ends, nothing is
   counted twice (Task 3 test).
2. **A mentor who leaves your club** while you set the pair yourself: the pair ends and you get one letter (Task 6
   test).
3. **A young player turning 25** at the new league year: no further shifts, earlier shifts stay (Task 3 test).
4. **League drift:** league averages of the three traits stay within ±0.02 over 6 seasons (Task 7, `npm run
   training`).
5. **A team with no eligible mentor** (all-rookie room): the planner leaves young players unpaired, no crash (Task 3
   test).

---

### Task 1: Shifts and accessors

**Files:**
- Modify: `src/engine/types.ts` (`Player`: `shifts?`, `mentorWeeks?`, `mentorSetByYou?`, `mentoredBy?`; keep the
  reserved `mentor?` at `:298-299` and update its comment; `Team`: `mentoringByYou?: true`, `captains?`)
- Modify: `src/engine/traits.ts` (`workEthicOf` reads the shift; new `temperamentOf`, `poiseOf`, `effectiveTraits`)
- Modify: every engine reader of `traits.workEthic`, `traits.temperament`, `traits.poise` and every
  `growthMult(`/`declineMult(`/`temperOffset(` caller (find them with
  `grep -rn "traits\.\(workEthic\|temperament\|poise\)\|growthMult(\|declineMult(\|temperOffset(" src/engine --include=*.ts | grep -v test`)
- Modify: `src/engine/scouting.ts` (`characterRead` reads `effectiveTraits(p)` as the truth)
- Modify: `src/engine/generate.ts` (`SAVE_VERSION` + 1), `src/engine/migrate.ts` (version-only step)
- Test: `src/engine/development.test.ts`

**Interfaces:**
- Produces:
  - `Player.shifts?: { workEthic?: number; temperament?: number; poise?: number }`
  - `Player.mentor?: number` (the mentor's id), `Player.mentorWeeks?: number`, `Player.mentorSetByYou?: true`,
    `Player.mentoredBy?: { id: number; from: number; to: number }[]`
  - `Team.mentoringByYou?: true`, `Team.captains?: { season: number; offense: number; defense: number; specialTeams: number }`
  - `type Shifted = 'workEthic' | 'temperament' | 'poise'`
  - `workEthicOf(p)`, `temperamentOf(p)`, `poiseOf(p)`: trait + shift, clamped 1–20
  - `effectiveTraits(p: Pick<Player, 'traits' | 'shifts'>): Traits`

- [ ] **Step 1: Write the failing test**

```ts
it('reads a mentored trait through its accessor, and development feels it', () => {
  const p = rookie('WR', 22, 1, { workEthic: 10 });
  p.shifts = { workEthic: 1, temperament: -1, poise: 0.5 };
  expect(workEthicOf(p)).toBe(11);
  expect(temperamentOf(p)).toBe(p.traits.temperament - 1);
  expect(poiseOf(p)).toBe(p.traits.poise + 0.5);
  expect(effectiveTraits(p).workEthic).toBe(11);
  expect(p.traits.workEthic).toBe(10); // traits never change
  const shifted = growth('WR', 21, 5, (x) => (x.shifts = { workEthic: 4 }));
  const plain = growth('WR', 21, 5, () => {});
  expect(shifted).toBeGreaterThan(plain);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/engine/development.test.ts`
Expected: FAIL (`temperamentOf` is not exported).

- [ ] **Step 3: Implement**

Accessors in `traits.ts` beside `workEthicOf` (update its comment: mentoring is here now). Route every reader found
by the grep through them: pass `effectiveTraits(p)` where a function takes `Traits`; use the accessor for single
reads (`discipline`, `fillBag`'s temperament and poise, `coachQuirks.ts:382`). Bump the save version.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine && npm run typecheck`
Expected: PASS (no behaviour changes yet: nobody has a shift).

- [ ] **Step 5: Commit**

```bash
npm run format
git add -A src/engine
git commit -m "Mentoring: shifts beside the traits, read through accessors (save v61)"
```

---

### Task 2: How much rubs off (pure core)

**Files:**
- Create: `src/engine/mentoring.ts`
- Test: `src/engine/mentoring.test.ts`

**Interfaces:**
- Consumes: accessors (Task 1), `seasonRole` (`scouting.ts:1062`, `SeasonRole` `'starter' | 'rotation' | 'backup'`),
  `positionIn` (`training.ts:80`), `TRAIT_MEAN`.
- Produces:
  - `MENTOR_MIN_AGE = 27`, `MENTOR_MIN_SEASONS = 5`, `YOUNG_AGES: [number, number] = [21, 24]`, `MAX_MENTEES = 2`,
    `RATE = 0.6` (starting value; tuned in Task 7), `POSITION_BONUS = 1.12`, `SEASON_WEEKS = 18`
  - `canMentor(p: Player): boolean`, `canBeMentored(p: Player): boolean` (age and experience only; roster checks live
    in Task 3)
  - `leadFactor(leads: number): number` = `clamp(0.9 + 0.4 * (leads - TRAIT_MEAN) / 3.5, 0.3, 1.5)`
  - `standingFactor(league: League, p: Player): number`: starter 1, rotation 0.7, backup or no line 0.4
  - `takes(p: Player): number` = `clamp(1 - 0.3 * Math.max(0, (p.traits.controversy - TRAIT_MEAN) / 3.5), 0.4, 1)`
  - `positionBonus(league: League, mentor: Player, young: Player): number` (1.12 when the mentor plays or has played
    the young player's position, by `positionIn` over his seasons; else 1)
  - `mentorShift(league: League, mentor: Player, young: Player, weeks: number): Record<Shifted, number>`: per trait
    `clamp(RATE * weeks / SEASON_WEEKS * leadFactor * standingFactor * takes * positionBonus * (mentorValue - youngValue) / 3.5, -1, 1)`

- [ ] **Step 1: Write the failing tests**

```ts
describe('mentoring: what rubs off', () => {
  it('pulls toward the mentor on all three, both ways, never past a point a year', () => {
    const [vet, kid] = pair({ vet: { workEthic: 18, temperament: 4, poise: 16, leads: 18 }, kid: { workEthic: 8, temperament: 12, poise: 9 } });
    const s = mentorShift(league, vet, kid, 18);
    expect(s.workEthic).toBeGreaterThan(0);
    expect(s.temperament).toBeLessThan(0); // a hothead teaches the wrong habits too
    expect(s.poise).toBeGreaterThan(0);
    for (const v of Object.values(s)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
  it('a quiet backup barely registers; a Born Leader who starts pulls hard', () => {
    expect(Math.abs(mentorShift(league, quietBackup, kid, 18).workEthic)).toBeLessThan(Math.abs(mentorShift(league, leaderStarter, kid, 18).workEthic) / 3);
  });
  it('a young player who stirs the room takes less', () => {
    expect(takes({ ...kid, traits: { ...kid.traits, controversy: 18 } })).toBeLessThan(takes(kid));
  });
  it('nothing for a pair that never shared a week', () => {
    expect(mentorShift(league, vet, kid, 0)).toEqual({ workEthic: 0, temperament: 0, poise: 0 });
  });
});
```

(`pair` builds two players on one team from `createLeague({ seed: 'mentoring' })`; `leaderStarter` and `quietBackup`
set `leads` and a last-season stat line that `seasonRole` reads as starter or backup.)

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/mentoring.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the constants and functions above in `mentoring.ts`, with a header comment pointing to
spec §2 and `docs/TRAINING.md` §8.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/mentoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/mentoring.ts src/engine/mentoring.test.ts
git commit -m "Mentoring: how much a mentor rubs off, on three traits"
```

---

### Task 3: Pairs, weeks together and the season's end

**Files:**
- Modify: `src/engine/mentoring.ts`
- Modify: `src/engine/league.ts:175-176` (call `mentoringWeek(league)` after `trainingWeek(league)`)
- Modify: `src/engine/offseason/index.ts` (in `beginOffseason`'s player loop, call `settleMentoring(league, p)` before
  `trueUp`; in the retirement branch delete `mentor`, `mentorWeeks`, `mentorSetByYou`, `shifts`)
- Test: `src/engine/mentoring.test.ts`

**Interfaces:**
- Consumes: Task 2; `activeRoster(league, teamId)` (`roster.ts:39`); `characterRead` for the staff's read of
  leadership (exact for your own players).
- Produces:
  - `planMentors(league: League, teamId: number): void`: keeps valid pairs and pairs you set; fills the rest (skipped
    for your team when `mentoringByYou`): young players youngest first, each to the free mentor (fewer than
    `MAX_MENTEES`) with the highest read `leadFactor × standingFactor`, same position first, then same side of the
    ball, then anyone
  - `mentoringWeek(league: League): void`: for each team, end pairs that are no longer valid (`endPair`), run
    `planMentors`, then `mentorWeeks += 1` for each pair where both are in `activeRoster`
  - `endPair(league: League, young: Player): void`: applies `mentorShift` for the weeks banked into `shifts`, extends
    or appends `mentoredBy` (keep the last 2), clears `mentor`, `mentorWeeks`, `mentorSetByYou`
  - `settleMentoring(league: League, p: Player): void`: at the new league year, for a young player with a mentor:
    apply the banked weeks, reset `mentorWeeks` to 0, end the pair if he is past `YOUNG_AGES[1]` after his birthday
  - `setMentor(league: League, youngId: number, mentorId: number | null): void` (user action; sets
    `mentorSetByYou`; throws a plain-words error if either is ineligible or the mentor is full)
  - `setMentoringByYou(league: League, on: boolean): void`

- [ ] **Step 1: Write the failing tests**

- `it('pairs every young player it can, two at most per mentor, by leadership not work ethic')`: run `planMentors` on
  every team of a fresh league; expect no mentor with more than 2; expect `corr(mentor work ethic, league)` of chosen
  mentors to be within 0.1 of all eligible veterans' (no work-ethic selection).
- `it('counts a week only while both are on the active 53')`: put the mentor on IR for one of three weeks; expect
  `mentorWeeks === 2`.
- `it('settles a pair split by a trade once, and keeps the record')`: trade the mentor away with `executeTrade`, run
  `mentoringWeek`; expect the young player's `shifts` changed by exactly `mentorShift(...)` for the weeks banked,
  `mentor` undefined, `mentoredBy` with one entry.
- `it('stops at 25 and keeps what he learned')`.
- `it('leaves a room without a veteran unpaired')`.
- `it('never touches a pair you set')`.
- `it('moves each trait at most a point a year')`: simulate a season with `RATE` × 10 and expect every |yearly change|
  ≤ 1.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/mentoring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the functions and the two wiring calls. `mentoringWeek` runs in the regular season only.

- [ ] **Step 4: Run the tests and a short league**

Run: `npx vitest run src/engine/mentoring.test.ts src/engine/league.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/mentoring.ts src/engine/mentoring.test.ts src/engine/league.ts src/engine/offseason/index.ts
git commit -m "Mentoring: pairs, weeks together and the shift at the new league year"
```

---

### Task 4: Captains, and leadership switched on

**Files:**
- Modify: `src/engine/personality.ts` (`TRAITS_ON` gains `'leads'`; add `nameCaptains(league: League): void`)
- Modify: `src/engine/offseason/index.ts:323` (call `nameCaptains(league)` where camp opens, beside
  `learnBlock(league, 'camp')`)
- Test: `src/engine/personality.test.ts`

**Interfaces:**
- Produces: `nameCaptains(league)`: for each team, offense and defense captains are the starters (depth chart) on
  that side with the highest read `leadFactor × standingFactor`; the special-teams captain is the best of the kicker,
  punter and players who start on neither side. Writes `Team.captains = { season, offense, defense, specialTeams }`.

- [ ] **Step 1: Write the failing tests**

- Update `it('never names a trait whose job has not shipped')`: the list shrinks to Locker-Room Lawyer, Volatile,
  Diva; add `expect(names).toContain('Born Leader')` over a full league.
- `it('names three different captains at camp, from starters on each side')`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/engine/personality.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**, then re-run the spread test; tune thresholds only if a share leaves its range.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/personality.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/personality.ts src/engine/personality.test.ts src/engine/offseason/index.ts
git commit -m "Mentoring: leadership names (Born Leader, Quiet Pro) and captains at camp"
```

---

### Task 5: The Locker Room tab and the card's mentor line

**Files:**
- Create: `src/ui/screens/LockerRoom.tsx`
- Modify: `src/ui/routes.ts` (`{ view: 'locker' }`), `src/ui/App.tsx:56` (`TABS` entry `{ view: 'locker', label:
  'Locker Room' }`, shown only with a job like `cap`), the route switch near `App.tsx:417`
- Modify: `src/ui/screens/PlayerCard.tsx` (one extra line under the character block)
- Test: `src/ui/ui.test.ts` (routes round-trip), a render test beside `gm.test.tsx`

**Interfaces:**
- Consumes: `Team.captains`, `planMentors`, `setMentor`, `setMentoringByYou` (via `store.mutate`), `personalityRead`.
- Produces: `LockerRoom({ league }: { league: League })`; `lockerLine(league: League, p: Player): string | null` in
  `ui/scouting.tsx` (PR 2: the mentor line only; PR 3 adds feud, grudge and friend in front of it).

- [ ] **Step 1: Write the failing tests**

- Routes: `'locker'` round-trips through the address bar.
- Render: the Leaders section names your three captains through `PlayerLink`; the Mentoring section lists each pair
  with a status word (`early days` under 4 weeks, `learning well` when the banked shift points the right way on
  work ethic, `not taking` otherwise) and shows *Let the coaches handle it* checked by default.
- Card: one of your mentored players shows `Learning from <name>`; a player with a past entry shows
  `Learned from <name> (2027–29)`; a player with neither shows no extra line.
- `docs/UI.md` rules hold: names through `PlayerLink`, tables sorted with `SortTh`, your rows `tr.is-user`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/ui`
Expected: FAIL.

- [ ] **Step 3: Implement**

Sections: **Leaders** (captains, then up to five more players your staff read as leaders, with their personality
name); **Mentoring** (each young player, his mentor or "—", a select of eligible mentors to change it, the status
word, the toggle). Copy is the coaches' read ("the way our coaches see it"). No numbers.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/ui
git commit -m "Mentoring: the Locker Room tab (leaders, mentoring) and the card's mentor line"
```

---

### Task 6: Letters

**Files:**
- Create: `src/engine/lockerMail.ts` (`lockerMail(league: League, have: Set<string>): Omit<InboxMessage, 'read'>[]`)
- Modify: `src/engine/inbox.ts:2839` (`deliverMail` pushes `...lockerMail(league, have)` when employed); export the
  `headCoach` sender helper (or a new `positionCoachSender(league, position)` using `ROOM_OF` from `coaching.ts:69`)
- Test: `src/engine/inbox.test.ts`

**Interfaces:**
- Produces, each with a stable id so nothing doubles up:
  - `mentor:${season}:took:${youngId}`: resign phase, your position coach: a young player's banked work ethic rose at
    least 0.5 this year (*"Hale's picking up Okafor's habits in the film room."*)
  - `mentor:${season}:${week}:gone:${youngId}`: a pair of yours ended because the mentor left the club, the head coach
    (*"Hale loses his mentor…"*); never for a pair that ended at 25
  - `persona:${season}:${playerId}:${name}`: resign phase, your position coach: your player's personality name
    changed this year because of mentoring (*"He's grown up."*)
  - `captains:${season}`: preseason, the head coach names the three captains

- [ ] **Step 1: Write the failing tests** (one `it` per letter: arrives once, from the right sender, survives a second
`deliverMail` without duplicating, and its body passes the banned-words regex).
- [ ] **Step 2: Run to see them fail** — `npx vitest run src/engine/inbox.test.ts` → FAIL.
- [ ] **Step 3: Implement**, each sender in their voice (`CLAUDE.md`, inbox: the head coach direct, position coaches
  plain and specific). None is "needs you".
- [ ] **Step 4: Run the tests** — `npx vitest run src/engine/inbox.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/lockerMail.ts src/engine/inbox.ts src/engine/inbox.test.ts
git commit -m "Mentoring: letters for a mentor who takes, one who leaves, a player who grows up, and the captains"
```

---

### Task 7: The guard, the tune, docs and the PR

**Files:**
- Modify: `scripts/training.ts` (replace §8's "work ethic identical for every player" guard)
- Modify: `docs/TRAINING.md` §8 (built, with what changed), `docs/GAME_DESIGN.md` (mentoring and captains),
  `CLAUDE.md` (architecture lines for `mentoring.ts` and `lockerMail.ts`), `package.json`, `src/ui/changelog.ts`

- [ ] **Step 1: Write the guard**

With the file's `check(label, value, [lo, hi], digits)`: over its leagues, for each of work ethic, temperament and
poise, `check('<trait>: league average change over 6 seasons', delta, [-0.02, 0.02], 3)` and
`check('<trait>: biggest change for one player in a year', maxYearly, [0, 1], 2)`.

- [ ] **Step 2: Run it and tune**

Run: `npm run training -- 6`
Expected: no ▲/▼. If an average drifts, lower `standingFactor`'s spread first (spec §2.5), then `RATE`.

- [ ] **Step 3: Run the owner's checks**

Run: `npm run quirks -- --effects && npm run sim -- 10 && npm run careers`
Expected: nothing flagged. `careers` is for the owner to sign off: paste its summary in the PR.

- [ ] **Step 4: Docs, version, commit, push**

```bash
npm run format
git add scripts/training.ts docs CLAUDE.md package.json src/ui/changelog.ts
git commit -m "Mentoring 0.2.x: the drift guard, docs and changelog"
git push -u origin <PR 2 branch>
```

- [ ] **Step 5: When the owner asks, open the PR (base: PR 1's branch), then read CI and fix anything red.**
