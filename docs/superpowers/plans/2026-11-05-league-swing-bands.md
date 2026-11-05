# League-Swing Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lines that swing with the league judge in two bands. Outside the usual band is a ⚠ warning: this league
drifted. Outside the normal band fails: the league is abnormal.

**Architecture:** One pure helper, `scripts/band.ts`, says which band a value is in and how to mark it. The three
scripts that judge the four lines (`morale.ts`, `careers.ts`, `calibrate.ts`) pass it a normal band beside today's
range. `check.ts` already shows ⚠ lines on a passing run and fails only on the scripts' counts, so it needs no change.

**Tech Stack:** TypeScript (`tsx` scripts), Vitest.

**Spec:** the owner's call in conversation (2026-11-05), quoted here because there is no spec file:

> "I'm ok with the butterfly effect in my game, just trying to make sure … it's appearing to diverge in maybe
> interesting ways, but not abnormal."

The owner agreed to two bands, in a separate PR merged before #152.

## The bands

The usual band is today's range, unchanged. The normal band is the owner's to approve, from the evidence below:

| Line (script) | Usual: ⚠ outside | Normal: fails outside | Evidence |
| --- | --- | --- | --- |
| Trade requests a season (`morale.ts`) | 3–15 | **1.5–20** | Main across three leagues: 4.25, 3.75, 7.88; earlier worlds 3.4–6.0 (`morale.ts` comment). The design's first target was 4–15. Under 1.5 means fewer than one club in twenty asks out each season: the escalation is broken. |
| Belief: rooms in doubt (`morale.ts`) | 0.10–0.25 | **0.05–0.35** | Main across three leagues: 0.20, 0.20, 0.26 (the last fails today on main). Under 0.05 no room ever doubts its coach; over 0.35 a third of rooms do every season. |
| Coaching trees: live trees, steady (`careers.ts`) | 2–5 | **1–6** | The NFL had one big tree at a time before 2017 and 4–5 in 2025 (spec 2026-10-28 §4.6). Under 1, trees die out; over 6 is beyond any NFL era. Main dipped to 1.9 once before (`docs/MVP.md`). |
| Win spread, SD of wins (`calibrate.ts`) | 3.0–3.4 | **2.8–3.6** | NFL seasons 2021–25 (nflverse): 2.84, 3.01, 2.70, 3.65, 3.41; pooled 2015–24: 3.09. A 60-season mean should sit inside the single seasons' range, a little narrower. Main reads 3.38 over 200 seasons. |

## Global Constraints

- The usual band is each line's range today, unchanged. Neither band may be moved to get a PR green. Both are the
  owner's call.
- Only these four lines get a normal band. Any other line that turns out to swing gets one only with the owner's OK.
- A warning line carries `⚠`, never `▲` or `▼`, so it reads as a warning and isn't counted as a miss.
- No version bump and no changelog entry: nothing in the game changes.
- `npm run format` before each commit. Commits end with the session's attribution lines.

## Review Focus

- **A value exactly on a band's edge** is inside it: 3 and 15 are usual; 1.5 and 20 are normal. Test in Task 1.
- **A value that isn't a number** (`careers.ts` prints `n/a`) is neither counted nor warned. Test in Task 1.
- **A warning line must not contain `▲`/`▼`.** `check.ts` lists ⚠ lines on a pass, and an arrow would make it look
  like a failure. Test in Task 1.
- **The run's miss count counts abnormal only,** so a league with only ⚠ lines exits 0. Verified in Task 2 on league
  `mw-b`.
- **A line given no normal band** behaves exactly as today (fails outside its range). Test in Task 1.

---

### Task 1: The band helper

**Files:**
- Create: `scripts/band.ts`, `scripts/band.test.ts`
- Modify: `vite.config.ts` (`test.include` gains `'scripts/**/*.test.ts'`)

**Interfaces:**
- Produces:
  ```ts
  export type Band = 'usual' | 'unusual' | 'abnormal' | 'none';
  /** usual: inside `usual`; unusual: outside it, inside `normal`; abnormal: outside `normal` (or outside `usual` when no
   * normal band is given); none: not a number. Edges are inside. */
  export function bandOf(value: number, usual: [number, number], normal?: [number, number]): Band;
  /** What a script appends to its line: '' (usual or none), '  ⚠ unusual for a league (fails outside lo–hi)', or
   * '  ▼ LOW' / '  ▲ HIGH' (abnormal). */
  export function bandMark(value: number, usual: [number, number], normal?: [number, number]): string;
  ```

- [ ] **Step 1: Write the failing tests** in `scripts/band.test.ts`:
  - `bandOf(4, [3, 15], [1.5, 20])` → 'usual'; `bandOf(3, …)` and `bandOf(15, …)` → 'usual' (edges).
  - `bandOf(2.5, [3, 15], [1.5, 20])` → 'unusual'; `bandOf(1.5, …)` → 'unusual'; `bandOf(20, …)` → 'unusual'.
  - `bandOf(1.4, [3, 15], [1.5, 20])` → 'abnormal'; `bandOf(21, …)` → 'abnormal'.
  - With no normal band: `bandOf(2.5, [3, 15])` → 'abnormal'; `bandOf(4, [3, 15])` → 'usual'.
  - `bandOf(NaN, [3, 15], [1.5, 20])` → 'none'.
  - `bandMark(2.5, [3, 15], [1.5, 20])` is `'  ⚠ unusual for a league (fails outside 1.5–20)'` and contains neither `▲`
    nor `▼`; `bandMark(1, [3, 15], [1.5, 20])` is `'  ▼ LOW'`; `bandMark(30, …)` is `'  ▲ HIGH'`;
    `bandMark(4, …)` and `bandMark(NaN, …)` are `''`.
- [ ] **Step 2: Run** `npx vitest run scripts/band.test.ts`. Expected: FAIL (no tests found until the include is added,
  then the module is missing).
- [ ] **Step 3: Add** `'scripts/**/*.test.ts'` to `test.include` in `vite.config.ts`, and implement `scripts/band.ts`
  with a comment quoting the owner's call and naming the four lines.
- [ ] **Step 4: Run** `npx vitest run scripts/band.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** ("Checks: a band helper for lines that swing with the league").

### Task 2: Morale's two lines

**Files:**
- Modify: `scripts/morale.ts` (`check` at about L98; the two calls at about L544 and L603)

**Interfaces:**
- Consumes: `bandOf`, `bandMark` (Task 1).
- Produces: `check(label, value, usual, digits = 2, normal?: [number, number])`. A miss is counted only when
  `bandOf` says 'abnormal'. The mark is `✓` for usual, `⚠` for unusual, `✗` for abnormal, with `bandMark` appended.

- [ ] **Step 1: Change `check`** as above. Pass the normal bands: trade requests `[1.5, 20]`; rooms in doubt
  `[0.05, 0.35]`. Above each call, a one-line comment: "Swings with the league: ⚠ outside the usual band, fails
  outside the normal (the owner's call, Nov 5)."
- [ ] **Step 2: Run** `npx tsx scripts/morale.ts --seed mw-b`. Expected: the rooms-in-doubt line reads `⚠ … 0.26 …
  unusual for a league (fails outside 0.05–0.35)`, and the summary counts no miss for it (today it's ✗).
- [ ] **Step 3: Run** `npm run morale`. Expected: 0 outside, no ⚠ (main's default league sits in both usual bands).
- [ ] **Step 4: Commit** ("Checks: morale's trade requests and rooms in doubt judge in two bands").

### Task 3: Careers' live trees and sim's win spread

**Files:**
- Modify: `scripts/careers.ts` (`check` at about L66; the live-trees call at about L502)
- Modify: `scripts/calibrate.ts` (`PARITY_TARGETS` at about L67; the parity loop at about L480)

**Interfaces:**
- Consumes: `bandOf`, `bandMark` (Task 1).
- Produces:
  - `careers.ts`: `check(label, value, lo, hi, digits = 2, normal?: [number, number]): string`. It returns
    `${label} ${value} (${lo}–${hi})` plus `' ⚠'` when unusual, `' ▼'`/`' ▲'` when abnormal, and keeps `n/a` for a
    non-number. Only abnormal counts.
  - `calibrate.ts`: `const PARITY_NORMAL: Partial<Record<string, [number, number]>> = { 'win spread (SD)': [2.8, 3.6] }`,
    read by the parity loop through `bandOf`/`bandMark`. Only abnormal counts.

- [ ] **Step 1: Change both** as above. Live trees' normal band is `[1, 6]`; win spread's is `[2.8, 3.6]`. Add the
  same one-line comment, and in `calibrate.ts` the NFL seasons (2.84, 3.01, 2.70, 3.65, 3.41).
- [ ] **Step 2: Run** `npm run sim -- 10`. Expected: the parity block prints, and the win-spread line is ✓ or ⚠, never
  counted unless outside 2.8–3.6.
- [ ] **Step 3: Run** `npm run careers`. Expected: 0 flagged (main's live trees sit in the usual band).
- [ ] **Step 4: Commit** ("Checks: live trees and win spread judge in two bands").

### Task 4: Say so where the rules live

**Files:**
- Modify: `CLAUDE.md` (the `npm run check` paragraph, after "never loosen a range to get green")

- [ ] **Step 1: Add one sentence:** "A few lines swing with the league (trade requests and rooms in doubt in `morale`,
  live trees in `careers`, win spread in `sim`): outside their usual band they warn (⚠: this league drifted), outside
  their normal band they fail (`scripts/band.ts`; both bands the owner's call, never moved to get green)."
- [ ] **Step 2: Run** `npm run typecheck` and `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** ("Docs: the two bands in CLAUDE.md"), push `claude/swing-bands`, and open the PR. The PR
  body carries the bands table and the evidence. After it merges, merge main into #152's branch; its morale and
  careers lines then read ⚠, not ✗.
