# The run's free men, let go: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the All-22 film, a defender the run's blocking leaves free (`RunBlocking.free`) is held only by a blocker
sent to him, never by a lineman passing on his way to someone else. This stops him from standing still in the hole after
that lineman lets go.

**Architecture:** One condition in the film's holding rule (`src/ui/stage/steer.ts`), the same form as the rule a
blitzer already has. The change is film only: the sim never reads `src/ui/stage/`, so no engine numbers move.

**Tech Stack:** TypeScript, Vitest.

**Spec:** none separate. The diagnosis below is the spec. The failing test it fixes is `stage.test.ts` "leaves almost no
unblocked defender standing within 5 yards of the hole as the back goes through" (6.6% of 600 runs against a 6% line).

## Diagnosis (measured, 2026-11-03)

We probed the film over the test's 600 runs. 497 of them reach the hole, and 33 had a defender standing near it.
There are two separate causes:

1. **A free man held by a stranger (16 of 33).** These are mostly safeties and corners on power: men the blocking sends
   nobody to. The holding rule counts any blocker within 1.6 yards. So a lineman passing on his way to a linebacker grabs
   the safety, stops him (1 yd/s) and leans him a yard downfield. When the hold lets go, the safety has to turn round,
   and he's under 2 yd/s for half a second near the hole. Across all runs, **57.5% of free men** look held by a lineman
   for 0.2 s or more, so "free" means little on film. Real heights left a few more free men at the second level, which
   is why this world reads 6.6% and main's 4.1%.
2. **A linebacker waiting for his climber (17 of 33).** His blocker (a lineman coming off a double team, or the pulling
   guard) hasn't got to him yet. He reaches his fit early (paced at the 2.5 yd/s floor) and waits for the back. Main has
   this too, at about main's whole 4.1%.

What we tried:

- **Cause 1's fix** (this plan): 6.6% → **3.4%**. All 164 film tests pass, including "sets the line" (which the
  assignment-only hold for everyone broke) and "no steered defender reaches the carrier before the tackler". Free men who
  look held: 57.5% → 0.2%.
- **A fix for cause 2** (the linebacker steps up to meet his climber): 3.4% → 4.8%, worse. It's not in this plan. Cause
  2 stays as it is on main, under the line.

## Global Constraints

- Film only: `src/ui/stage/` and the changelog. No change under `src/engine/`.
- Never loosen a range: the 6% line and its 600 runs stay.
- Checks: `npm run typecheck` and `npx vitest run src/ui/stage`. No sims, no full suite, no `npm run check`.
- `npm run format` before committing.
- No version bump: this rides in 0.3.6 ("Real heights"), the PR's own bump.
- Commit and push to `claude/real-heights`. No PR.

## Review Focus

- **A free defensive back a stalking receiver is sent to** (`pick(dbs, k)` runs after the run's plan) is still held by
  that receiver. `blockOn.get(b) === k` keeps it. "Sets the line" and the stalk tests stay green.
- **A free man with `stuckOnBlocks`** still latches onto the first blocker to reach him. That's `stuckTo`, a separate
  rule this plan doesn't touch, and the habit tests in `stage.test.ts` pin it.
- **A free man who is also a blitzer** loses the back's pickup exception (on a run the back carries the ball and is out
  of `blockerIdx` anyway). This is accepted: no test needed.
- **Dropbacks and kicks:** `lateMen` is filled on runs only, so pass protection is unchanged. "Holds the pocket" pins it.
- **The tackler and the habit linebackers** (`pk`, the gap-shooter, the scraper) skip the holding block or override it
  as before. "No steered defender reaches the carrier before the tackler" and "reads the run" pin them.

---

### Task 1: Free men held only by their own blocker

**Files:**

- Modify: `src/ui/stage/steer.ts:889-898` (the holding rule and its comment)
- Modify: `src/ui/stage/stage.test.ts`: a new test in `describe('the run game')` beside the standing test (line
  1469), and that test's 600-run comment (lines 1472–1473)
- Modify: `src/ui/changelog.ts:19-25` (one sentence in 0.3.6)

**Interfaces:**

- Consumes: `lateMen` (`steer.ts:312`, a `Set<number>` of defender indices from `a.runBlocks.free`, runs only),
  `blockOn` (blocker index → his man), `StagedPlay.run.free` (ids) in the test.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test** in `describe('the run game')`, after the standing test:

```ts
it("lets the run's free men go: a lineman blocking someone else never holds a man the blocking left free", () => {
  let men = 0;
  let held = 0;
  for (const x of runs) {
    const p = stage(x);
    if (!p.run || p.carrier === null || p.loose) continue;
    const c = p.ids.indexOf(p.carrier);
    const pos = (st: number, k: number) => ({
      x: p.pos[(st * p.ids.length + k) * 2],
      y: p.pos[(st * p.ids.length + k) * 2 + 1],
    });
    for (const id of p.run.free) {
      const k = p.ids.indexOf(id);
      men++;
      // From the handoff until the back is two and a half yards past the line: a block's pace (1 yd/s on a run) beside
      // a lineman for a fifth of a second is a hold.
      let streak = 0;
      for (let st = Math.round(p.release / p.dt) + 1; st < p.steps; st++) {
        if ((pos(st, c).x - p.ball[0]) * p.dir >= 2.5) break;
        const v = Math.hypot(pos(st, k).x - pos(st - 1, k).x, pos(st, k).y - pos(st - 1, k).y) / p.dt;
        const lineman = p.ids.some(
          (_, j) =>
            p.offense[j] && p.roles[j] === 'OL' && Math.hypot(pos(st, j).x - pos(st, k).x, pos(st, j).y - pos(st, k).y) < 1.6,
        );
        streak = v <= 1.05 && lineman ? streak + 1 : 0;
        if (streak === 4) {
          held++;
          break;
        }
      }
    }
  }
  expect(men).toBeGreaterThan(2000);
  // (A man pushed off a lineman for a moment, or reaching his spot beside one, is the odd exception.)
  expect(held / men).toBeLessThan(0.01);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `npx vitest run src/ui/stage/stage.test.ts -t "free men go"`
Expected: FAIL. The share is about 0.575 (measured: 2543 of 4426).

- [ ] **Step 3: Change the holding rule in `steer.ts`.** The predicate inside `blockerIdx.some(...)` becomes:

```ts
(blockOn.get(b) === k || (!lateMen.has(k) && (!sent || members[b].role === 'RB'))) &&
```

Rewrite the comment above it to say why. A man the run's blocking leaves free has nobody sent to him, so a lineman on
his way to someone else doesn't stop him (held, then let go, he'd turn round and stand in the hole). Only a man sent to
him holds him, as with a blitzer.

- [ ] **Step 4: Run the film tests**

Run: `npx vitest run src/ui/stage`
Expected: all pass (165), the new test and "leaves almost no unblocked defender standing" among them.

- [ ] **Step 5: Update the standing test's comment** (lines 1472–1473) to the measured numbers. Over three hundred runs a
world's rate swung across the line with nothing changed. Held by any lineman passing, the real-heights world's free men
stood here in 6.6% of 600 runs; held only by their own blocker, 3.4%.

- [ ] **Step 6: Add one sentence to the 0.3.6 changelog text**, at its end (double-quoted, for the apostrophe):
`"On the All-22, a defender the run's blocking leaves free is no longer grabbed by a lineman on his way to someone else, so he no longer stands in the hole."`

- [ ] **Step 7: Typecheck, format, commit, push**

```bash
npm run typecheck && npm run format
git add src/ui/stage/steer.ts src/ui/stage/stage.test.ts src/ui/changelog.ts
git commit -m "All-22: a run's free men are held only by a blocker sent to them"
git push -u origin claude/real-heights
```
