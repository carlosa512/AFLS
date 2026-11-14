# Fast-forward between highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every still landing the highlight level reaches by playing on into a short fast-forward beat: the field
glides, the game clock counts down, and a centred card over a dimmed field says what was skipped.

**Architecture:** Pure reads (`src/ui/fastForward.ts`, `gameRead.ts`) time the beat, count its clock and word its line.
A card component (`screens/FastForward.tsx`) draws them. The beat is not stored state: each screen derives it ("a still
landing, playing, its field not done yet") and passes its length to the field, which glides over it and calls `onDone`
as it does today. Pausing or stepping ends the beat because the derivation stops holding.

**Tech Stack:** React 19, TypeScript, SVG, Vitest (node, static render only: no DOM test library).

**Spec:** `docs/superpowers/specs/2026-11-14-fast-forward-between-highlights-design.md`

## Global Constraints

- Screens only: nothing in `src/engine/` or the save changes.
- Beat length: `max(800, 2000 / √speed)` ms, rounded: 2000 at 1×, 1414 at 2×, 1000 at 4×, 800 at 8×. 800 is
  `BANNER_FLOOR` from `moments.ts`.
- Screen words follow `docs/UI.md` "Words on a screen": a team (never a club), American English, no semicolons. Teams
  are named by `team.city`, as the banners do ("Buffalo ball").
- Text sizes only from the scale (`var(--step-*)`); no `text-transform: uppercase` (`ui.test.ts` holds both).
- Icons only through `Icon` (`ui/icons.tsx`); the card's is `forward`.
- `prefers-reduced-motion`: nothing glides or ticks; the card shows the landed clock for the same length of time.
- Per CLAUDE.md: `npm run typecheck` and the touched tests locally, `npm run copy` after new screen text, `npm run format`
  before committing. No sims (nothing the engine reads changes).

## Review Focus

1. **The speed button pressed mid-beat.** The beat's length changes, so the field restarts its glide. The clock must
   never run backwards: `beatProgress` only moves forward (Task 3 test).
2. **Pause mid-beat, then Play.** Everything lands at once and Play goes on to the next highlight; the beat is not
   replayed (Task 4 browser check).
3. **A gap of notes only** (a two-minute warning, a timeout). No "0 plays", no empty line: the card shows the clock and
   the spot (Task 2 test). Also: the landed play is often a note, which the screens count as told at once, so the beat
   must not read `told` (Task 4).
4. **A gap that ends the half or the game.** No "Ball on" line, and the clock never counts into the next half
   (Tasks 1 and 2 tests).
5. **A gap into overtime.** The clock flips to the overtime's own length (10:00 in the regular season), not 15:00
   (Task 1 test).

---

### Task 1: The beat's length and its clock

**Files:**
- Create: `src/ui/fastForward.ts`
- Modify: `src/ui/gameRead.ts` (the clock section, ~line 299; the `half` helper, line 81)
- Test: `src/ui/fastForward.test.ts`

**Interfaces:**
- Produces:
  - `gameRead.ts`: `export const halfOf = (quarter: number): 1 | 2 | 3` (rename the private `half` and update its four
    uses in the file); `export function clockOf(plays: readonly PlayLogEntry[], seconds: number): { quarter: number;
    clock: number }`, the inverse of `secondsOf`: the period and clock `seconds` after the kickoff; at a period's exact
    end, the period ending, at 0.
  - `fastForward.ts`: `export const BEAT_MS = 2000`; `export function beatMs(speed: number): number`;
    `export function beatSpan(plays: readonly PlayLogEntry[], from: number, to: number): { start: number; end: number }`
    (game seconds: from `secondsOf[from]` to `secondsOf[to + 1]` when that play exists and `halfOf` matches
    `plays[to]`'s, else `secondsOf[to]`); `export function beatClock(plays, span, k: number): { quarter: number;
    clock: number }` = `clockOf(plays, Math.round(span.start + (span.end - span.start) * k))`.

- [ ] **Step 1: Write the failing tests** in `src/ui/fastForward.test.ts` (fixture `entry()` as in
  `highlights.test.ts`):

```ts
it('beats 2 s at 1×, about 1.4 s at 2×, 1 s at 4× and never under the banner floor', () => {
  expect([1, 2, 4, 8].map(beatMs)).toEqual([2000, 1414, 1000, 800]);
});
it('reads the clock back from game seconds, a period's end as its own 0:00', () => {
  const plays = [entry({ quarter: 1, clock: 900 }), entry({ quarter: 2, clock: 700 })];
  expect(clockOf(plays, 0)).toEqual({ quarter: 1, clock: 900 });
  expect(clockOf(plays, 900)).toEqual({ quarter: 1, clock: 0 });
  expect(clockOf(plays, 901)).toEqual({ quarter: 2, clock: 899 });
});
it('flips into overtime at the overtime's own length', () => {
  const plays = [entry({ quarter: 4, clock: 30 }), entry({ quarter: 5, clock: 600 })];
  expect(clockOf(plays, 3600)).toEqual({ quarter: 4, clock: 0 });
  expect(clockOf(plays, 3601)).toEqual({ quarter: 5, clock: 599 });
});
it('counts from the last highlight to the next one’s snap, but never into the next half', () => {
  const plays = [
    entry({ quarter: 1, clock: 500 }),
    entry({ quarter: 1, clock: 470 }),
    entry({ quarter: 1, clock: 430 }),
  ];
  expect(beatSpan(plays, 0, 1)).toEqual({ start: 400, end: 470 });
  const half = [entry({ quarter: 2, clock: 40 }), entry({ quarter: 2, clock: 5 }), entry({ quarter: 3, clock: 900 })];
  expect(beatSpan(half, 0, 1)).toEqual({ start: 1760, end: 1795 });
  // No next play (the game ends in the gap): the last play's snap.
  expect(beatSpan(plays.slice(0, 2), 0, 1)).toEqual({ start: 400, end: 430 });
  expect(beatClock(plays, { start: 400, end: 470 }, 0.5)).toEqual({ quarter: 1, clock: 465 });
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/fastForward.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `halfOf` and `clockOf` in `gameRead.ts` (`clockOf` walks `periodEnds`), then `BEAT_MS`,
  `beatMs` (`Math.round(Math.max(BANNER_FLOOR, BEAT_MS / Math.sqrt(speed)))`), `beatSpan` and `beatClock` in
  `fastForward.ts`, with a header comment naming the spec.
- [ ] **Step 4: Run** the test file and `npx vitest run src/ui/viewer.test.tsx src/ui/gameRead.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Fast-forward: the beat's length and its clock"`.

### Task 2: The line under the clock

**Files:**
- Modify: `src/ui/fastForward.ts`, `src/ui/gameRead.ts` (export `booked`, line 65, and `kicked`, ~line 377),
  `src/ui/screens/Scorebug.tsx` (`downParts` also returns `where`)
- Test: `src/ui/fastForward.test.ts`

**Interfaces:**
- Consumes: `halfOf` (Task 1), `booked`, `kicked`, `gainOf` (`gameRead.ts`), `downParts` (`Scorebug.tsx`).
- Produces: `export function skipSummary(plays: readonly PlayLogEntry[], from: number, to: number, home: Team, away:
  Team): string[]`, zero to two lines; `downParts(...)` gains `where: string` ("NO 30", "midfield").

Rules (the gap is plays `from + 1` through `to`; `next` is `plays[to + 1]`):
- **Count:** the gap's `booked` snaps, "1 play" or "N plays", left out at 0.
- **A hand-over** is a punt that was kicked (`kicked`), a kickoff, an extra point (`kind 'xp'`) or the note
  `Turnover on downs.`. Its words, from the last hand-over in the gap that has some: a punt "{offense city} punt", an
  extra point "Extra point good" or, when its text ends `NO GOOD.`, "Extra point missed", the note "Turnover on downs".
  A kickoff has none.
- **Line 1:** the count, then the hand-over's words; with no hand-over, the count then the yards (the sum of `gainOf`
  over the counted snaps, "17 yds", omitted with no snaps). Joined by " · ". No line when empty.
- **Line 2:** only when `next` exists, is in `plays[to]`'s half, has `down > 0` and is not a punt. With a hand-over in
  the gap, "{next offense city} ball on {where}"; without, "Ball on {where}".

- [ ] **Step 1: Write the failing tests** (Buffalo id 1, home; New Orleans id 2; fixtures as in `moments.test.ts`):

```ts
it('a drive that carries on: its plays, its yards and the spot', () => {
  const plays = [entry({ down: 3 }), entry({ from: 25, to: 30 }), entry({ kind: 'pass', from: 30, to: 42 }),
    entry({ yardLine: 42 })];
  expect(skipSummary(plays, 0, 2, BUF, NO)).toEqual(['2 plays · 17 yds', 'Ball on BUF 42']);
});
it('a punt: who punted, and who has the ball where', () => {
  const plays = [entry({ kind: 'sack' }), entry({ kind: 'punt', down: 4, text: 'B.Shaw punts 45 yards.' }),
    entry({ offense: 2, yardLine: 25, from: 75, to: 70 }), entry({ offense: 2, down: 2, yardLine: 30 })];
  expect(skipSummary(plays, 0, 2, BUF, NO)).toEqual(['1 play · Buffalo punt', 'New Orleans ball on NO 30']);
});
it('after a touchdown: the extra point, then the other team’s ball', () => {
  const after = (text: string) => [entry({ text: 'Run, TOUCHDOWN' }), entry({ kind: 'xp', down: 0, text }),
    entry({ kind: 'kickoff', down: 0 }), entry({ offense: 2, yardLine: 35 })];
  expect(skipSummary(after('M.Sherman extra point is GOOD.'), 0, 2, BUF, NO)).toEqual(['Extra point good',
    'New Orleans ball on NO 35']);
  expect(skipSummary(after('M.Sherman extra point is NO GOOD.'), 0, 2, BUF, NO)[0]).toBe('Extra point missed');
});
it('a turnover on downs, and a gap of notes only', () => {
  const downs = [entry({ down: 4 }), note('Turnover on downs.'), entry({ offense: 2, yardLine: 32 })];
  expect(skipSummary(downs, 0, 1, BUF, NO)).toEqual(['Turnover on downs', 'New Orleans ball on NO 32']);
  const warn = [entry(), note('Two-minute warning.'), entry({ down: 3, yardLine: 40 })];
  expect(skipSummary(warn, 0, 1, BUF, NO)).toEqual(['Ball on BUF 40']);
});
it('no spot when the game, the half or a kick comes next', () => {
  const kneels = [entry(), entry({ kind: 'kneel', from: 54, to: 53 }), entry({ kind: 'kneel', from: 53, to: 52 })];
  expect(skipSummary(kneels, 0, 2, BUF, NO)).toEqual(['2 plays · -2 yds']);
  const half = [entry({ quarter: 2 }), entry({ quarter: 2, from: 25, to: 28 }), entry({ quarter: 3, kind: 'kickoff',
    down: 0 })];
  expect(skipSummary(half, 0, 1, BUF, NO)).toEqual(['1 play · 3 yds']);
  const punt = [entry(), entry({ from: 25, to: 28 }), entry({ kind: 'punt', down: 4 })];
  expect(skipSummary(punt, 0, 1, BUF, NO)).toEqual(['1 play · 3 yds']);
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/fastForward.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the exports and `skipSummary` to the rules above; `downParts` builds `spot` from `where`.
- [ ] **Step 4: Run** `npx vitest run src/ui/fastForward.test.ts src/ui/viewer.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Fast-forward: the line under the clock"`.

### Task 3: The card, and the clock that ticks

**Files:**
- Create: `src/ui/screens/FastForward.tsx`
- Modify: `src/ui/fastForward.ts`, `src/ui/screens/Scorebug.tsx` (the `.vb-clock` span, ~line 101),
  `src/styles.css` (after `.moment-card.small`, ~line 1943)
- Test: `src/ui/fastForward.test.ts`, `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `beatSpan`, `beatClock`, `skipSummary` (Tasks 1–2).
- Produces:
  - `fastForward.ts`: `export function beatProgress(elapsedMs: number, ms: number, prev: number): number` =
    `max(prev, min(1, elapsedMs / ms))`, 1 when `ms <= 0`.
  - `FastForward.tsx`: `export function BeatClock({ plays, span, ms }: { plays: readonly PlayLogEntry[]; span: { start:
    number; end: number }; ms: number })`, the text "Q2 · 6:41" ("OT" past the fourth), counted on its own
    `requestAnimationFrame` from its mount through `beatProgress` and `beatClock`, re-rendering only when the shown
    second changes; under reduced motion (or with no `window`) the end clock at once.
    `export function FastForward({ plays, from, to, home, away, ms }: { plays: readonly PlayLogEntry[]; from: number;
    to: number; home: Team; away: Team; ms: number })`.
  - `Scorebug`: new prop `clock?: ReactNode`, shown in place of `{period} · {gameClock(entry.clock)}` (the live dot
    stays).

The card's markup: a `.ff` layer over the whole scene (`position: absolute; inset: 0; pointer-events: none`, display
grid, centred) that carries the dim: a dark wash lighter than `.moment-card.small`'s plus `backdrop-filter:
grayscale(…)`, its strength in one custom property `--ff-dim` on `.ff`. Inside, `.ff-in`, a compact box on
`var(--scene-panel)` like `.mc-in` but `width: min(86%, 300px)`: a `.ff-top` row (`<Icon name="forward" />` and the
`BeatClock`, `font-size: var(--step-3)`, `aria-hidden`: it ticks), then one `.ff-line` per `skipSummary` line
(`var(--step-0)`), the lines in an `aria-live="polite"` block. `.ff` sets `--beat: {ms}ms` and fades: in over 150 ms,
out over the last 150 ms (`animation-delay: calc(var(--beat) - 150ms)`, `animation-fill-mode: forwards`), no
animation under reduced motion.

- [ ] **Step 1: Write the failing tests.** In `fastForward.test.ts`:

```ts
it('never runs the clock backwards when the beat is made longer', () => {
  expect(beatProgress(400, 800, 0)).toBe(0.5);
  expect(beatProgress(450, 2000, 0.5)).toBe(0.5); // the speed went from 8× to 1× mid-beat
  expect(beatProgress(3000, 2000, 0.5)).toBe(1);
  expect(beatProgress(10, 0, 0)).toBe(1);
});
```

In `viewer.test.tsx` (its `league`, `game`, `plays` and `render`):

```tsx
describe('the fast-forward', () => {
  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const at = plays.findIndex((_, i) => playOn(plays, i, home.id, 'key').still);
  const to = playOn(plays, at, home.id, 'key').index;
  it('draws the forward icon, the clock as the beat starts and the line', () => {
    const html = render(<FastForward plays={plays} from={at} to={to} home={home} away={away} ms={2000} />);
    expect(html).toContain('class="ff"');
    expect(html).toContain('M13 5v14l8-7z'); // the forward icon
    expect(html).toContain(gameClock(beatClock(plays, beatSpan(plays, at, to), 0).clock));
    for (const line of skipSummary(plays, at, to, home, away)) expect(html).toContain(line);
  });
  it('puts a clock it is given on the scorebug in place of the play’s', () => {
    const html = render(
      <Scorebug league={league} game={game} home={home} away={away} plays={plays} index={to} told={false}
        label="Week 1" clock={<span>Q9 · 9:99</span>} />,
    );
    expect(html).toContain('Q9 · 9:99');
    expect(html).not.toContain(gameClock(plays[to].clock));
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/fastForward.test.ts src/ui/viewer.test.tsx`. Expected: the new tests
  FAIL.
- [ ] **Step 3: Implement** `beatProgress`, `FastForward.tsx`, the `clock` prop and the CSS.
- [ ] **Step 4: Run** the two files and `npx vitest run src/ui/ui.test.ts`. Expected: PASS (the text-scale and icon
  rules included).
- [ ] **Step 5: Commit** `git commit -m "Fast-forward: the card and the ticking clock"`.

### Task 4: The beat in the Broadcast view, live and replay

**Files:**
- Modify: `src/ui/live.ts`, `src/ui/screens/BroadcastField.tsx` (the effect, lines ~170–318),
  `src/ui/screens/LiveGame.tsx`, `src/ui/screens/GameViewer.tsx`
- Test: `src/ui/live.test.ts`

**Interfaces:**
- Consumes: `beatMs`, `beatSpan` (Task 1), `FastForward`, `BeatClock`, `Scorebug`'s `clock` (Task 3).
- Produces: `LiveSession.from: number` (the play on screen when a skip began: where its beat counts from; set to 0 by
  `start`, to the old `current` by `skipTo` before it moves); `Field` prop `beat?: number` ("a still landing reached by
  playing on: glide to it over this many ms; 0 lands at once"), also used by Task 5's `TopDownField`.

How each screen derives the beat (never from `told`: a landed note is told at once):
- `GameViewer`: new state `beatFrom`, set in `advanceFrom` when `playOn` returns `still`. `beating = still && playing
  && !seen && !pre`.
- `LiveGame`: `beating = s.still && s.playing && toldKey !== playKey && !s.finished && !pre`; from is `s.from`.
- Switching view mid-beat: the new view mounts mid-derivation and runs a fresh beat (the card stays up until it
  ends). The spec has it land still; that costs stored beat state for a moment nobody will notice, so this plan
  accepts the difference and the handoff tells the owner.
- Both: `beat = beating ? beatMs(speed shown) : 0`, passed to the field; while `beating`, `<FastForward key={…}>` goes
  in `.viewer-scene` after the field, and the `Scorebug` gets `told={told || beating}` (the score through the gap) and
  `clock={<BeatClock … span={beatSpan(plays, from, index)} ms={beat} />}`. Pause and ▶▶/◀◀ end the beat by ending the
  derivation; the field's effect re-runs and lands at once.

`Field`: add `beat` to the effect's deps (`[animKey, beat]`). In the branch that today lands a still play at once:
when `still && beat > 0` and motion is allowed, glide the ball (`place`) and both lines (`lineAt`) from `from` to the
landed spot with `ease(k)`, `k` from real elapsed ms over `beat` (not scaled by speed: `beat` already is), then
`finish()` and `doneRef.current()`. With reduced motion, `finish()` at once and call `doneRef.current()` after `beat`
ms. Otherwise unchanged (`450 / speed`).

- [ ] **Step 1: Write the failing test** in `live.test.ts`, inside the first `skipTo` test:
  `const before = …; live.skipTo(bigMoment); expect(live.get()!.from).toBe(before);`
- [ ] **Step 2: Run** `npx vitest run src/ui/live.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `LiveSession.from`, the `Field` glide and both screens' wiring.
- [ ] **Step 4: Run** `npm run typecheck` and `npx vitest run src/ui/live.test.ts src/ui/viewer.test.tsx`. Expected:
  PASS.
- [ ] **Step 5: Check in the browser** (Broadcast). Start `npm run dev`, open a replay of a game with a full log at Key
  (`localStorage['afls-viewer-highlights'] = 'key'`), press Play with a scratch Playwright script (Chromium is
  pre-installed). Expected: between highlights `.ff` appears for about 2 s at 1× and 0.8 s at 8×, the `.vb-clock`
  text changes during it, the ball moves; pressing Pause during a beat removes `.ff` within a frame and the scorebug
  shows the landed play's clock; Play then animates the next highlight with no second beat.
- [ ] **Step 6: Commit** `git commit -m "Fast-forward: the beat in the broadcast view"`.

### Task 5: The beat in All-22

**Files:**
- Modify: `src/ui/screens/TopDownField.tsx` (the main effect, its still branch ~line 862, deps line 957),
  `src/ui/screens/LiveGame.tsx` and `src/ui/screens/GameViewer.tsx` (pass `beat` to `TopDownField`)

**Interfaces:**
- Consumes: the `beat` prop and the screens' derivation (Task 4).
- Produces: `TopDownField` prop `beat?: number`, the same meaning as `Field`'s.

Add `beat` to the effect's deps. When `still && beat > 0` and motion is allowed, run one `requestAnimationFrame` loop
over `beat` real ms in three parts: to 30%, the dots on the field (`mem.spots`) fade out where they stand; 30–70%, the
ball glides from `mem.ballX/ballY` (else the landed play's first ball spot) to the landed play's last ball spot, the
camera following; from 70%, `clearBench()` and `place(last, Infinity)` with the dots fading in (add an `opacity`
argument to `place`, default 1, passed to `drawDot`). Then, when `ending`, the final whistle (`finaleFrame`) as a still
landing on the last play runs today; else `doneRef.current()`. Under reduced motion, today's still landing, with
`onDone` after `Math.max(450 / speed, unstaged, beat)`.

- [ ] **Step 1: Implement** the prop and the beat.
- [ ] **Step 2: Run** `npm run typecheck` and `npx vitest run src/ui/viewer.test.tsx`. Expected: PASS.
- [ ] **Step 3: Check in the browser** (All-22, 1× and 4×): the players fade, the ball glides, they reappear at the
  landed spot, `.ff` shows throughout; a replay at Key whose last plays are skipped plays the beat, then the final
  whistle, then the final card.
- [ ] **Step 4: Commit** `git commit -m "Fast-forward: the beat in All-22"`.

### Task 6: Ship it

**Files:**
- Modify: `package.json` (version), `src/ui/changelog.ts` (a new entry at the top)

- [ ] **Step 1: Bump** the patch number of `package.json`'s version as it stands on `origin/main` (0.4.44 → 0.4.45
  today) and add the entry (title 40 characters at most, text 200 at most; `changelog.test.ts` holds both):

```ts
{
  version: '0.4.45',
  date: '2026-11-14',
  title: 'A fast-forward between highlights',
  text: 'On Key and Ext the game no longer jumps between highlights. The field glides, the clock runs down and a card says what you skipped.',
},
```

- [ ] **Step 2: Run** `npm run copy` and read the new lines in `.check/copy.txt` against `docs/UI.md` "Words on a
  screen". Expected: no line the owner would not want.
- [ ] **Step 3: Run** `npm run format`, `npm run typecheck`, and `npx vitest run src/ui/fastForward.test.ts
  src/ui/viewer.test.tsx src/ui/live.test.ts src/ui/ui.test.ts src/ui/changelog.test.ts`. Expected: PASS.
- [ ] **Step 4: Screenshots for the owner** with the scratch Playwright script from Task 4: the card mid-beat in both
  views at 1× and 8× (All-22 at 4×), light and dark, desktop 1440×900 and phone 390×844, saved under the scratchpad.
- [ ] **Step 5: Commit and push** `git commit -m "Fast-forward between highlights: 0.4.45"`, then
  `git push -u origin claude/hopeful-turing-jb1b2q`. The pull request is opened when the owner asks; CI then runs the
  checks it picks and must be green.
