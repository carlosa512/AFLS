# Morale Talks (G3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unhappy player with a cause asks his club for something; you answer his letter (Promise, Reassure, Be
firm), AI GMs answer theirs by their tendencies, and promises are kept or broken by what happens and remembered. No
effect on play.

**Architecture:** A new pure module `playerTalks.ts` runs one talk step at the end of each `moraleAdvance` (asks, the
AI's answers, unanswered letters, promise checks, the new league year's fade) and exposes `answerTalk` for your
letters' buttons. It stores a small `talk` record on `Player.morale`, adds jolts through G1's jolt list, and fills G1's
`promises` factor. `talkMail.ts` files your letters from the asks on record; `playerVoice.ts` holds his words.

**Tech Stack:** TypeScript, React, Vitest; scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-morale-talks-design.md` (G1, which this builds on:
`docs/superpowers/specs/2026-10-29-morale-core-design.md`)

## Global Constraints

- Engine pure: no DOM, no `Math.random`, nothing drawn from any `Rng` stream. **No shared cache filled or read**:
  everything a talk step needs comes from the `MoraleContext` `moraleAdvance` already built (G1 broke play once by
  filling `leagueMarket`'s cache; `buildMarket` is the pattern).
- G3 changes no play: no club changes a lineup, a cut or a contract to keep a promise. Sim, careers, audit and offseason
  numbers must not move.
- Numbers from the spec, verbatim: ask after **three steps in a row** at Poor or worse; **eight steps** quiet after an
  answer; **two asks per club per step**, unhappiest first (lowest `moraleLevel`, then lowest id); talk steps are
  regular-season and playoff weeks, the re-sign window (week index 0) and camp (week index 7). Promise +2 × trust
  (trust = `max(0, 1 − 0.25 × broken)`); kept +2; broken −4; reassure +1 halved for each reassurance this league year;
  firm `−min(1.5, max(0, −0.5 × zTemp))`; ignored = firm plus −1; unanswered by the second step after filing. Snaps
  promise: kept over ≥ 2 club games at 60% (starter) or 20% (rotation) of a league-average starter's snaps per game;
  broken within the club's next four games he's fit for. Deal promise: due at the end of the next re-sign window.
  Promises factor `clamp(0.5 × kept − 1.5 × broken, −3, 1)`; kept and broken fade one each at every new league year,
  reassurances reset.
- AI answers (`GmTraits`): snaps/deal → promise when `loyalty − stubbornness ≥ 0.2`, firm when `stubbornness ≥ 0.6`,
  else reassure; losing/feud → firm when `stubbornness ≥ 0.6`, else reassure; no GM → reassure.
- Fog of war: screens read talks only through `moraleView` and the letter's own subject, for your players only.
- Every sentence of new prose through `say` (`voice.ts`); the player's words in `playerVoice.ts`; the head coach's in
  `lockerVoice.ts`. No mood numbers on a screen (week numbers and counts in words are fine).
- `League` stays plain JSON: `SAVE_VERSION` 67 → 68 (optional fields only, nothing to fill). Every `talk` field left out
  when empty, and `talk` itself when it holds nothing.
- Save budget: a measured `morale` entry in `SAVE_FEATURE_ALLOWANCES` (`scripts/save-budget.ts`), sized from the
  offseason audit against main plus a small margin; over about 50 KB retained → stop and show the owner first.
- Checks a session runs: `npm run typecheck`; `npx vitest run --maxWorkers=2 <files>` (more workers run the container
  out of memory); `npm run format` before each commit; `npm run morale` from Task 3 on. Never loosen a range. Never
  force push.
- Ship: `package.json` 0.2.21 → 0.2.22, a `src/ui/changelog.ts` entry, the MVP "Morale and holdouts" line,
  `CLAUDE.md`'s architecture list (`playerTalks.ts`, `talkMail.ts`, `playerVoice.ts`).
- **Review checkpoints** (dark theme, desktop and phone, from the owner's save, wait for the owner's OK before going
  on): after Task 5 (a letter before and after answering) and after Task 6 (the Locker Room's Promises list, the card's
  pill, the report's rows).

## Review Focus

- **An answer that arrives late:** you click a letter's button after its ask has closed as ignored (or after the step
  moved on): nothing happens, no jolt, and the letter shows the closed state. Test in Task 2.
- **A traded player mid-promise:** traded or cut with a promise open, the broken jolt lands once, the record clears, and
  his new club (AI) starts clean; a player traded *to* you arrives with no open ask. Test in Task 3.
- **The season boundary:** a snaps promise open at the season's end carries its games left into next season (the
  counters re-seat on the new season); a deal promise made in season is due when next year's re-sign window closes.
  Test in Task 3.
- **The inbox flood:** the re-sign window, camp and week one fall close together; the cap (two per club per step) and
  the eight-step quiet still hold across them, so your inbox gets at most two letters a step. Test in Task 2.
- **A GM who changes clubs:** letters from your old club stop needing you (`canReadMail`), and your new club's players
  who asked their old AI GM aren't re-filed as your letters. Test in Task 5.

---

### Task 1: The talk record, the promises factor, the new jolts, save v68

**Files:**
- Modify: `src/engine/types.ts` (`MoraleJolt`, `Morale.talk`, `TalkCause`, `TalkReply`), `src/engine/morale.ts`,
  `src/engine/generate.ts` (`SAVE_VERSION = 68`), `src/engine/migrate.ts`
- Test: `src/engine/morale.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces:
  - `type MoraleJolt` gains `'promised' | 'kept' | 'broken' | 'reassured' | 'firm' | 'ignored'`.
  - `type TalkCause = 'snaps' | 'deal' | 'losing' | 'feud'`; `type TalkReply = 'promise' | 'reassure' | 'firm'`.
  - `Morale.talk?: Talk`, `Talk` exactly as the spec's Data block (`club`, `ask`, `downSince`, `answered` with `ask`,
    `promise`, `reassured`, `kept`, `broken`).
  - `promisesScore(p: Player): number` in `morale.ts` (0 with no talk record); `moraleFactors(...).promises` uses it.
  - `addJolt(p: Player, kind: MoraleJolt, size: number, at: number): void` in `morale.ts`: push and keep the four
    biggest by live size at `at` (the rule `moraleAdvance` already applies), sizes rounded to two decimals.
  - Reasons: `FACTOR_WORDS.promises = ["Doesn't trust your word", 'Trusts your word']`; `JOLT_WORDS` for the six kinds
    in the spec's words; `DOWN_REASONS` gains broken, firm, ignored and "Doesn't trust your word".

- [ ] **Step 1: Failing tests** — `promisesScore` is 0 with no record, +0.5 with one kept, −1.5 with one broken, −3
  with three broken, +1 with four kept; `moraleReasons` gives "You broke your word" for a live broken jolt and "Doesn't
  trust your word" for a promises factor of −1.5, both in `DOWN_REASONS`; `addJolt` keeps four; a v67 save migrates to
  68 with nothing added (`JSON` of every player's morale unchanged).
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/engine/morale.test.ts src/engine/migrate.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Refactor `moraleAdvance`'s keep-four code onto `addJolt` (same results).
- [ ] **Step 4: Run** → PASS; `npm run typecheck`; `npm run morale` → all ✓, numbers as before (nothing writes a
  talk record yet).
- [ ] **Step 5: Commit** — `Talks: the record, the promises factor, the new jolts, save v68`

---

### Task 2: Who asks, the answers, the AI, `answerTalk`

**Files:**
- Create: `src/engine/playerTalks.ts`
- Modify: `src/engine/morale.ts` (call `talkStep` at the end of `moraleAdvance`, after the per-player loop)
- Test: `src/engine/playerTalks.test.ts`

**Interfaces:**
- Consumes: Task 1's types, `addJolt`, `promisesScore`; G1's `moraleContext`, `moraleFactors`, `moraleReasons`,
  `moraleLevel`, `moraleStepOf`, `expectedRole`, `MoraleContext`; `teamGm` (`gm.ts`) for `GmTraits`.
- Produces:
  - `talkStep(league: League, ctx: MoraleContext, clock: number, week: number, newYear: boolean): void` — in this
    order: club check (Task 3), new-year fade (Task 3), promise checks (Task 3), `downSince` for every rostered player
    (set at the first step at Poor or worse, cleared when it lifts), your unanswered asks closing as `ignored` when
    `clock ≥ ask.at + 2`, then new asks.
  - `talkCause(league: League, p: Player, f: MoraleFactors, clock: number): TalkCause | null` — from his biggest
    reason in `DOWN_REASONS` by the spec's table.
  - `talksAt(league: League, week: number): boolean` — regular season or playoffs, or week index 0 or 7.
  - `aiReply(league: League, teamId: number, cause: TalkCause): TalkReply` — the spec's rule.
  - `answerTalk(league: League, playerId: number, reply: TalkReply): boolean` — your answer; false (and nothing
    changes) unless he's yours, has an open ask, and `promise` matches a `snaps` or `deal` cause. Answers at
    `league.moraleAt`'s clock. A snaps promise records `role = expectedRole(p, moraleContext(league))`.
  - `canPromise(cause: TalkCause): boolean`.
- `moraleAdvance` passes the `newYear` flag it already computes; the cycle `morale.ts` ⇄ `playerTalks.ts` is calls at
  run time only (no module-level reads), which ESM resolves.

- [ ] **Step 1: Failing tests** (`playerTalks.test.ts`, leagues from `createLeague`, moods set by hand, steps by
  `moraleAdvance(l, clock)`):
  - a player at Poor with a snaps reason asks at his third step down, not his second; no cause → never asks;
  - two asks per club per step, the unhappiest first; none while an ask or a promise is open; none within six steps
    of an answer; none on a free-agency day or the draft step;
  - **the flood (Review Focus):** with five of your players down, the re-sign window, camp and week one file at most
    two asks a step and never one player twice;
  - your ask stays open; an AI club's ask is answered at once by `aiReply` (a GM with loyalty 0.8, stubbornness 0.3
    promises a snaps ask; stubbornness 0.7 is firm; no GM reassures; a losing ask is never promised);
  - jolts: a promise +2 (+1.5 with one broken on his record); reassure +1, then +0.5 the same league year; firm 0 at
    temperament 14 and −1.5 at temperament 1; unanswered by `ask.at + 2` → `firm` and `ignored` (−1) jolts and
    `answered.reply === 'ignored'`;
  - `answerTalk` returns false for another club's player, for a closed ask, and for `promise` on a losing cause;
  - **a late answer (Review Focus):** after the ask closed as ignored, `answerTalk` returns false and adds no jolt;
  - determinism: the same league stepped twice from a copy gives the same asks and answers.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/engine/playerTalks.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx vitest run --maxWorkers=2 src/engine/morale.test.ts src/engine/morale.rng.test.ts`;
  `npm run typecheck`.
- [ ] **Step 5: Commit** — `Talks: who asks, the answers, the AI's replies`

---

### Task 3: Promises kept and broken, leaving the club, the new league year

**Files:**
- Modify: `src/engine/playerTalks.ts`
- Test: `src/engine/playerTalks.test.ts`

**Interfaces:**
- Consumes: Task 2's `talkStep` order; `ctx.live` (season snaps of a league-average starter) and `ctx.records`.
- Produces, inside `talkStep`:
  - **Club check:** `talk.club !== p.teamId` → an open promise breaks (`broken` jolt −4 at `clock`), then `delete
    m.talk`.
  - **New year (`newYear`):** `kept` and `broken` −1 each (floor 0, deleted at 0), `reassured` deleted.
  - **Snaps:** per in-season step, `dg` = his club's games played since `promise.seen` (all of this season's when
    `seen.season` differs) and `ds` = his snaps since (games dressed for K/P); if he's hurt or on IR, `left` doesn't
    move; else `left -= dg`, `games += dg`, `snaps += ds`; re-seat `seen`. Per-game yardstick = `ctx.live[pos] /` the
    mean games played across `ctx.records`. Kept when `games ≥ 2` and `snaps / games ≥ (role === 2 ? 0.6 : 0.2) ×`
    that yardstick (K/P: `snaps / games ≥ that share`); broken when `left ≤ 0` and not kept. Made in the offseason,
    `seen` starts at the new season with 0.
  - **Deal:** `due` = clock at which the next re-sign window closes (`season × 32 + 1` when made at week index 0, else
    `(season + 1) × 32 + 1`). Kept when a `paid` jolt landed at this clock and `clock ≤ due`; broken when `clock ≥ due`
    and not kept.
  - Kept → `kept` jolt +2, `kept += 1`; broken → `broken` jolt −4, `broken += 1`; either deletes `promise`.

- [ ] **Step 1: Failing tests:**
  - snaps kept by a starter's snaps over two games (stats set by hand, records advanced), not by one game; broken after
    four games without them; a game missed hurt doesn't count against him; a promise made at camp counts from week one;
  - **the season boundary (Review Focus):** a snaps promise with two games left at the season's end has two left in
    the new season; a deal promise made in week 6 is kept by a raise in next year's re-sign window and broken when that
    window closes without one;
  - **traded mid-promise (Review Focus):** traded to another club with a promise open → one `broken` jolt, `talk`
    gone, and at his new club he asks again only by the normal rule (three steps down there); a player traded to you
    arrives with no open ask;
  - the new league year fades `kept` and `broken` by one and clears `reassured`;
  - `promisesScore` follows the counts.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Talks: promises kept and broken, and remembered`

---

### Task 4: The league check

**Files:**
- Modify: `scripts/morale.ts`, `src/engine/morale.rng.test.ts`
- Test: the script itself

**Interfaces:**
- Counts per step from the records: an ask filed or answered this step (`ask.at === clock` or `answered.at ===
  clock` with `answered.ask === clock`), a promise made (`answered.reply === 'promise'`), kept and broken jolts with
  `at === clock`.
- New ranges (fixed by the spec; never loosen one): asks per club per season 4–30 (every club counted alike, yours
  answered by the AI rule via `aiReply` in the script, since nobody clicks); promises kept 25–75% of those resolved.
  G1's twelve lines unchanged and still ✓.

- [ ] **Step 1:** add the counters and the two `check` lines; in the script, answer your club's asks with
  `answerTalk(league, id, aiReply(league, league.userTeamId, cause))` each step.
- [ ] **Step 2:** `npm run morale` → all ✓. If a new range misses, stop and report to the owner: the cadence and the
  sizes are the owner's, and no range is ever loosened.
- [ ] **Step 3:** extend `morale.rng.test.ts`: the season-and-offseason comparison also holds with talks on (it already
  mocks `moraleWeek`/`moraleStep`; assert some talk records exist in the "on" run).
- [ ] **Step 4: Commit** — `Talks: the league check`

---

### Task 5: Your letters

**Files:**
- Create: `src/engine/playerVoice.ts`, `src/engine/talkMail.ts`
- Modify: `src/engine/senders.ts` (`playerSender`), `src/engine/inbox.ts` (`deliverMail`, `MailSubject`,
  `mailSubject`, `needsYou`), `src/ui/mail.tsx` (`MailCards` case `talk`)
- Test: `src/engine/talkMail.test.ts`, `src/ui/talk.test.tsx`

**Interfaces:**
- Consumes: Task 2's `answerTalk`, `canPromise`; `say`, `recentBodies` (`voice.ts`).
- Produces:
  - `playerSender(p: Player): Sender` — `{ from: '<First> <Last>, <POS>' }` (no card).
  - `playerVoice.ts`: `TALK_LETTER: Line<LetterFact>[]` with `LetterFact = { name: string; cause: TalkCause; loud:
    boolean; calm: boolean }` (`loud`: controversy z ≥ 0.5; `calm`: temperament z ≥ 0.5) — at least three lines per
    cause, sharper when `loud`, plainer when `calm`, including the spec's "I want to be out there on Sundays" (snaps)
    and "I've earned a new deal" (deal); `TALK_ANSWER: Line<AnswerFact>[]` with `AnswerFact = { cause: TalkCause;
    reply: TalkReply | 'ignored'; loud: boolean; calm: boolean }` — at least two per reply, including "Four games. I'll
    hold you to that." (snaps promise); `TALK_SUBJECT: Record<TalkCause, string>` = `About my snaps`, `About my
    contract`, `About the losing`, `About the room`.
  - `talkMail(league: League, have: Set<string>): Draft[]` — one letter per open ask on your roster not yet filed, id
    `talk:{season}:{ask.at}:{playerId}`, category `staff`, `playerSender`, body from `TALK_LETTER`.
  - `MailSubject` gains `{ kind: 'talk'; season: number; clock: number; playerId: number }`; `needsYou` true while that
    player is yours with `talk.ask?.at === clock`.
  - UI `TalkCards({ league, s })`: live → buttons *Promise more snaps* / *Promise a new deal* (only when `canPromise`),
    *Reassure him*, *Be firm*, each `store.mutate((l) => answerTalk(l, s.playerId, reply))`; answered
    (`talk.answered?.ask === s.clock`) → what you said and his line from `TALK_ANSWER`; otherwise "This talk is
    closed."

- [ ] **Step 1: Failing tests:** an ask on your roster files one letter (twice delivered, still one); an AI club's ask
  files none; `needsYou` is true until answered, false after; the card shows the promise button only for snaps and
  deal; clicking Reassure (calling the handler's `answerTalk`) turns the card into the answered line; an ignored ask
  shows its line; no text in `TALK_LETTER`/`TALK_ANSWER` matches `BANNED` (`lockerVoice.test.ts`'s) or a reserved
  nickname; **a GM who changes clubs (Review Focus):** after `userTeamId` changes, the old letter no longer needs you
  and the new club's players with AI-answered talks file nothing.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/engine/talkMail.test.ts src/ui/talk.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx vitest run --maxWorkers=2 src/ui src/engine/inbox.test.ts`; `npm run typecheck`.
- [ ] **Step 5: Review checkpoint:** `npm run mail-preview -- --save <owner's save> --out <dir>`, then `npm run screens
  -- --save <a preview with a talk letter> --out <dir> --dark --mail talk:` before answering, and again after
  answering one (a copy of the save with `answerTalk` applied by a small script in the scratchpad). Send them; wait for
  the owner's OK. If the owner's save isn't attached in the session, ask for it.
- [ ] **Step 6: Commit** — `Talks: your players write to you`

---

### Task 6: Promises on the Locker Room, the card and the head coach's report

**Files:**
- Modify: `src/engine/morale.ts` (`MoraleView.promise`), `src/ui/screens/LockerRoom.tsx`,
  `src/ui/screens/PlayerCard.tsx`, `src/engine/lockerReport.ts`, `src/engine/lockerVoice.ts`
- Test: `src/ui/morale.test.tsx`, `src/ui/playerCard.test.tsx`, `src/engine/lockerReport.test.ts`

**Interfaces:**
- Produces:
  - `MoraleView.promise?: { kind: 'snaps' | 'deal'; text: string }` — snaps: `More snaps: <n in words> games left`
    (`one game left` at one); deal: `A new deal by the end of the re-sign window`.
  - Locker Room: a **Promises** block on the morale board (right column, under Flying): each open promise (face,
    `PlayerLink`, its text), then "Kept lately" / "Broken lately" from live `kept`/`broken` jolts (names only). Hidden
    when all are empty.
  - Card: a `TipPill` beside the Morale pill, `Promised snaps` / `Promised a new deal`, its text in the tooltip.
  - Report: in the Morale section, a row per `kept` or `broken` jolt since the last report, keyed
    `promise:{fs}:{playerId}:{at}` in `covered` (each told once); `MORALE_NOTE` lines for reasons "You kept your word"
    and "You broke your word" (e.g. "You told Davis he'd play. He's still waiting.").

- [ ] **Step 1: Failing tests:** the Locker Room lists an open snaps promise with "games left" and hides the block with
  none; another club's promise never renders anywhere (render that club's roster and a rival's card); the card shows
  the pill only with an open promise; a report after a broken promise has one row for it and the next report none;
  no digits in the new report notes.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx vitest run --maxWorkers=2 src/ui
  src/engine/lockerReport.test.ts src/engine/lockerVoice.test.ts`.
- [ ] **Step 5: Review checkpoint:** `npm run screens -- --save <a preview save with promises> --out <dir> --dark
  --screens locker,card` and `--mail locker:`; send; wait for the owner's OK.
- [ ] **Step 6: Commit** — `Talks: promises on the Locker Room, the card and the report`

---

### Task 7: The save budget, wrap-up, review, PR

**Files:**
- Modify: `scripts/save-budget.ts`, `package.json`, `src/ui/changelog.ts`, `docs/MVP.md`, `CLAUDE.md`

- [ ] **Step 1: Measure.** `npm run offseason -- 6` on this branch and on `origin/main` (a `git worktree` with
  `node_modules` linked), logs to the scratchpad; take each season's `size KB` and `players growth KB` from both.
- [ ] **Step 2: The allowance.** A `morale` entry in `SAVE_FEATURE_ALLOWANCES`: `retainedSeasons` = the largest
  measured difference rounded up to the next 10 KB plus 10 KB margin; `playersGrowth` the same way if it moved; the
  others 0. Comment: what it holds (talk records, the letters' inbox entries if the audit delivers mail), the measured
  numbers, "Agreed by the owner" (the owner asked for room for a cap bump, Oct 29). Over 50 KB retained → stop and show
  the owner first.
- [ ] **Step 3:** `npm run offseason -- 6` → 0 outside range.
- [ ] **Step 4:** version 0.2.22; changelog "Players speak up": unhappy players write to you; promise, reassure or be
  firm; promises are tracked and remembered; AI clubs do the same with theirs. MVP line: talks and promises done, G2
  and G4 to come. `CLAUDE.md`: `playerTalks.ts`, `talkMail.ts`, `playerVoice.ts` in the architecture list.
- [ ] **Step 5:** `npx vitest run --maxWorkers=2 src/ui`, then `src/engine` in two halves; `npm run typecheck`;
  `npm run format:check`; `npm run morale`.
- [ ] **Step 6:** a fresh whole-branch review (Sonnet, the owner's rule) with this plan's Review Focus; fix Critical and
  Important findings test-first.
- [ ] **Step 7:** push, open the PR (template: What changed / Why / `npm run check`), subscribe, drive CI green.
