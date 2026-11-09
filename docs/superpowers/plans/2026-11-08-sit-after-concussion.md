# Sit Him This Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** You can sit a man a week after a concussion his first test cleared, AI clubs make the same call when
their men clear, and your doctor says when he would.

**Architecture:** Everything rides on the existing hold: a sat man is put in the state `clearProtocol` leaves a held
man (`p.injury` a concussion with a week left and no protocol; his file one game and `held`), so `injuryWeek`,
`concussionWindow` and lineups need no change. One odds function (`sitOdds`) serves the AI's draw and the doctor's
advice. The letter is the 0.4.17 "concussed, and cleared to play" all-clear (`cleared:` id).

**Tech Stack:** TypeScript, Vitest, React (server-rendered in tests).

**Spec:** `docs/superpowers/specs/2026-11-08-sit-after-concussion-design.md`

**Status:** Tasks 1–5 were built before this plan (commits `231e2cd`, `ef952b8`) and are checked off; Task 6 is the
work still to do.

## Global Constraints

- No `Math.random`: the AI's draw runs on `${seed}:${season}:${week}:sit:${playerId}`.
- Your players are your call: no code path sits one of yours for you.
- `concussions 0 games %` in `npm run sim` stays inside 33–50; never move the band. Too low: trim `SIT_ODDS.first`.
- The doctor's voice is measured; the letter never promises a mechanic the engine doesn't run.
- A fix bumps PATCH in `package.json` and adds a `src/ui/changelog.ts` entry; `npm run format` before committing.

## Review Focus

1. **A practice injury in the same week, after the first test cleared him:** a person expects the doctor still to
   tell them about the concussion. Today `clearedMail` skips any man with `p.injury` and reads only his latest
   record, so the concussion goes untold again (rare: the practice field hurts about one man in 180 a week). Test and fix in Task 6.
2. **Clicking Sit (or Play) twice:** a person expects one week out and one game on his file, not two. Test in Task 6.
3. **Traded or released after you sat him:** a person expects the button gone from your letter and him still out
   that week with his new club (the caution travels with him). Test in Task 6.
4. **Cleared in week 18:** a person expects to be able to sit him for the first playoff week (`league.week` 19,
   phase `playoffs`). Test in Task 6.
5. Checked and covered: opening the letter after the week is played leaves no button (Task 4's test).

---

### Task 1: The sit odds and the AI clubs' call — done

**Files:** Modify `src/engine/injuries.ts` (after `holdAfterProtocol`; `clearProtocol`). Test
`src/engine/injuries.test.ts`.

**Interfaces — Produces:**
- `concussionsLately(p: Player): { season: number; year: number }` — his concussions this season and in the past
  52 weeks, counted at the latest one.
- `sitOdds(league: League, team: Team, p: Player, opts?: { stakes?: boolean }): number` — `SIT_ODDS` first 0.1,
  second (2+ this season or 2+ in 52 weeks) 0.6, third (3+ this season) 0.9; × 0.5 when `stakes` and (playoffs, or a
  starter by `STARTERS` with `gm.winNow >= AI_PUSH`); × 1.5 for a non-starter; `SIT_MAX` 0.95.

- [x] **Step 1:** Test `weighs sitting a cleared man by his file first, then the stakes`: 0.1, 0.1 (one >52 weeks
  ago), 0.6 (one inside 52 weeks), 0.6 (two this season), 0.9 (three); backup 0.15 and 0.95; win-now starter 0.3;
  playoffs starter 0.3, backup 0.45; `{ stakes: false }` 0.6.
- [x] **Step 2:** Test `has AI clubs sit some men a week once they clear, at about those odds, and never yours`: every
  rostered man concussed with `{ clear: 1, symptoms: 0, setbacks: 0 }`; after `injuryWeek`, held count within ±25% of
  the summed odds (over 100); held men show `weeks: 1`, unavailable; yours `weeks: 0`, never `held`.
- [x] **Step 3:** Run `npx vitest run src/engine/injuries.test.ts -t sit`: FAIL (not defined).
- [x] **Step 4:** Implement both, and `aiSits(league, p): boolean` (false for a free agent or yours) OR'd into
  `clearProtocol`'s `held`.
- [x] **Step 5:** Run again: PASS. Commit.

### Task 2: Your sit, and undoing it — done

**Files:** Modify `src/engine/injuries.ts`. Test `src/engine/injuries.test.ts`.

**Interfaces — Produces:**
- `sitProblem(league, p): string | null` — null when you can sit him or stop sitting him: in season, his latest record
  a concussion this season with `league.week === record.week + 1` and `weeks: 0` (or `weeks: 1` and `held`), not hurt
  otherwise.
- `sittingAfterClear(league, p): boolean` — the held state for that record.
- `sitAfterClear(league, p, on: boolean): void` — on: record `weeks: 1`, `held`, severity by `severityFor`;
  `p.injury` `{ type: 'concussion', weeksRemaining: 1, estimate: [1, 1], where: 'game', season/week of the record }`.
  Off: restores `weeks: 0`, no `held`, no injury. Then `syncDepthChart`.

- [x] **Step 1:** Test `lets you sit a man his first test cleared, and change your mind until the week is played`
  (problem while in protocol; null once cleared; sit → unavailable, `weeks: 1`, `held`; undo → available, `weeks: 0`;
  sit, play the week → back, `concussionWindow` 1, problem again).
- [x] **Step 2:** Test `offers no sit for a longer protocol (his card's hold covers it) or once the week is played`.
- [x] **Step 3:** Run: FAIL. **Step 4:** Implement. **Step 5:** Run: PASS. Commit.

### Task 3: The doctor's advice, and no extra letter — done

**Files:** Modify `src/engine/inbox.ts` (`clearedMail`, `injuryMail`). Test `src/engine/inbox.test.ts`.

**Interfaces — Consumes:** `sitOdds`, `concussionsLately`, `sitAfterClear`.

- [x] **Step 1:** Test `advises sitting a second one in twelve months, and sitting him files nothing new`: body has
  `With two in twelve months, I'd sit him this week anyway.`; after `sitAfterClear` and another `playWeek`, still one
  letter about him. Add `not.toMatch(/I'd sit him/)` to the first-concussion letter's test.
- [x] **Step 2:** Run: FAIL.
- [x] **Step 3:** `sitAdvice(league, p): string` appended to the quick-clear body: `sitOdds(..., { stakes: false })`
  at least `SIT_ADVISE` 0.6 → ` With ${small(n)} this season, I'd sit him this week anyway.` (else `in twelve
  months`). `injuryMail` skips an injury whose `cleared:` key is filed.
- [x] **Step 4:** Run: PASS. Commit.

### Task 4: The button on the letter — done

**Files:** Modify `src/ui/mail.tsx` (`ClearedCards`). Test `src/ui/mail.test.tsx`.

- [x] **Step 1:** Test `offers to sit him this week, then to play him after all, until the week is played`
  (`MailCards` HTML: `Sit him this week`; after `sitAfterClear`: `Play him after all`; after `playWeek`: neither).
- [x] **Step 2:** Run: FAIL. **Step 3:** A `mail-fact-card` when `ours`, the letter's record is his latest and
  `sitProblem` is null; the button toggles `sitAfterClear` through `store.mutate`. **Step 4:** Run: PASS. Commit.

### Task 5: Docs, version, checks — done

**Files:** `docs/INJURIES.md` (Your call, AI clubs' call, the league's share), `src/ui/changelog.ts` and
`package.json` (0.4.18), `src/engine/offseason/__snapshots__/offseason.test.ts.snap`,
`src/engine/offseason/capPlan.test.ts`.

- [x] **Step 1:** `npm run sim -- 30`: `concussions 0 games %` 36.53 (33–50), no ✗.
- [x] **Step 2:** Full `npx vitest run`: two offseason fixtures the new dice moved (both pass on `eaf704b`). Re-take
  the pinned re-sign snapshot; the makeRoom check compares each cut with the best keeper (keepers come in outlook
  order, so the first isn't always the best rated).
- [x] **Step 3:** `npm run format`, typecheck. Commit, push.

### Task 6: Review Focus — to do

**Files:** Modify `src/engine/inbox.ts` (`clearedMail`). Test `src/engine/inbox.test.ts`,
`src/engine/injuries.test.ts`. `src/ui/changelog.ts`, `package.json` (0.4.19).

**Interfaces — Consumes:** `sitAfterClear`, `sitProblem`, `sittingAfterClear` (Task 2); `setTeam` (`roster.ts`).

- [ ] **Step 1: Write the failing tests**
  - inbox: `still tells the concussion when practice hurts him the same week` — quick clear, then
    `applyInjury(... 'hamstring', where: 'practice', same week)` before `deliverMail`; expect one letter whose id
    starts `cleared:` and ends `:concussion` and whose body matches `/concussed in the game/`, and no `Sit him`
    button (he's hurt).
  - injuries: `sitting twice is one week` — `sitAfterClear(l, p, true)` twice: `weeks: 1`; `false` twice: `weeks: 0`.
  - ui: `a man you sat stays out with his new club, and leaves your letter` (in `src/ui/mail.test.tsx`) — sit,
    `setTeam` him to another club: `isAvailable(p)` false, and `MailCards` shows no `Sit him this week|Play him
    after all`.
  - injuries: `can sit a man cleared in week 18 for the first playoff week` — record week 18, `league.week` 19,
    phase `playoffs`: `sitProblem` null; sit → unavailable.
- [ ] **Step 2: Run** `npx vitest run src/engine/inbox.test.ts src/engine/injuries.test.ts src/ui/mail.test.tsx -t
  "practice hurts|twice|new club|week 18"` — expected: the practice test FAILS (no letter); the others may already
  pass (they pin behavior).
- [ ] **Step 3: Fix `clearedMail`:** the quick-clear branch reads the concussion record cleared at its first test in
  the week just played wherever it sits on his file (`findLast(clearedAtFirstTest)`), and doesn't skip a man whose
  current injury is something else; the regular all-clear path is unchanged.
- [ ] **Step 4: Run** the same command: all PASS. Then `npx vitest run src/engine/inbox.test.ts
  src/engine/injuries.test.ts src/ui/` and `npm run typecheck`: all PASS.
- [ ] **Step 5: Version and commit.** 0.4.19 and a changelog line (the concussion is told even when practice hurts
  him that week); `npm run format`; commit; push.
