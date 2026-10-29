# Contract Letters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One players' contracts letter and a fuller staff contracts letter, each with the staff's call per person and
the buttons to act on it in the inbox; and a draft whose main button never picks for you.

**Architecture:** The AI's re-sign keeper rule moves into one pure function (`resignCall`) that both the AI and the
letter use. A new `contractMail.ts` files the players' letter as a `MailSection` whose rows carry a `contract` marker;
the UI draws live buttons from the league as it is (as the waiver wire's `claim` rows do). A small season-scoped walk
list on the team records "let him walk". The staff letter's cards gain Let go and a call line. The top bar's draft step
navigates instead of simming; auto-drafting goes through the confirm dialog.

**Tech Stack:** TypeScript, React, Vitest. Screenshots via `npm run mail-preview` / `npm run screens -- --mail`.

**Spec:** `docs/superpowers/specs/2026-10-29-contract-letters-design.md`

## Global Constraints

- Engine pure: no DOM, no `Math.random`; mail never draws from the sim's `Rng` streams.
- `aiResignWindow` decides exactly as before on the same seed (same signings, tags, RNG draw order).
- Own players' visible ratings are exact (`perceive` on our own team); no hidden trait or `potential` in any text.
  Tests reuse `BANNED = /marble|\btraits?\b|z-score/i`.
- `League` stays plain JSON; `SAVE_VERSION` 65 → 66, no-op migrate step (`Team.lettingWalk` optional).
- Old saves keep their per-player agents' letters (`contracts:{season}:{playerId}`); the new letter's `covered` lists
  those ids. New letter id: `expiring:{season}`.
- Every sentence through `say` (`voice.ts`); the director signs the players' letter (`director` in `senders.ts`).
- Checks a session runs: `npm run typecheck`, `npx vitest run --maxWorkers=2 <touched files>` (two workers: the
  container runs out of memory with more), `npm run format` before each commit, and `npm run offseason -- 6` once after
  Task 1 (the AI's re-sign code changes shape). CI runs the rest.
- Ship: `package.json` 0.2.19 → 0.2.20 and a `src/ui/changelog.ts` entry.
- **Review checkpoints:** send screenshots with `SendUserFile` (`status: 'proactive'`) where a task says so, and keep
  going; fold the owner's input in when it arrives.

## Review Focus

- The cap or roster changes between the letter filing and a click (another signing used the room): Sign at ask must
  re-check (`makeOffer` does) and show the reason, not sign over the cap.
- A player signed, tagged or walked from the Re-sign screen instead of the letter: the letter's row shows it on next
  render, and Needs you clears.
- The tag used on one row: every other row's Tag button disables with the reason (`tagBlocker`), and a Tag call on
  another row reads as Keep.
- A save loaded mid re-sign window from v65: no new letter if the per-player letters were already filed this window
  (`covered` against `have`), and the old ones still open.
- During the draft with picks remaining, the main top-bar button must not change the league at all (no pick, no
  phase move).

---

### Task 1: The re-sign call, shared by the AI and the letter

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiResignWindow`, new `resignCall`)
- Test: `src/engine/offseason/offseason.test.ts`

**Interfaces:**
- Produces:
  - `type ResignReason = 'starter' | 'young' | 'depth' | 'fading' | 'age' | 'backup'`
  - `resignCall(league: League, teamId: number, p: Player, depth = depthOutlooks(league, league.teams[teamId])): { call: 'keep' | 'tag' | 'walk'; reason: ResignReason; ahead: number }`
    — keep: today's keeper test (outlook clears the starter bar less 0.5 → `starter`; 25 or under with projected
    ceiling 12+ → `young`; room under `KEEP_MIN` → `depth`; and `age − ageShift ≤ 33`). tag: a keeper with
    `payTier ≥ 0.75`, `age − ageShift ≤ 30` and `tagBlocker(league, p) === null`. walk: `age` when past the age line,
    `fading` when his outlook is under his overall today (`ahead < playerOvr`) and under the bar, else `backup`.
    `ahead` is `teamOutlook` with the team's win-now, as `aiResignWindow` reads it.
  - `aiResignWindow` uses `resignCall(...).call !== 'walk'` as its keeper test; everything after (offer, tests-the-market
    draw, tag coin flip) unchanged and in the same order.

- [ ] **Step 1: Pin today's AI decisions, then the failing tests** — (a) before touching `aiResignWindow`, add a test
  that runs it for every AI team on a seeded league (`fresh()`, `beginOffseason`, `new Rng('resign-pin')`) and records
  each team's re-signed and tagged player ids with `toMatchSnapshot()`; run it once so the snapshot holds today's
  behavior, and commit it. (b) `resignCall` on our team: a starter above the bar is `keep`/`starter`; a 34-year-old is
  `walk`/`age`; a keeper in the top pay quarter with the tag open is `tag`; after `applyFranchiseTag` on someone else,
  the same player is `keep`.
- [ ] **Step 2: Run** — `npx vitest run --maxWorkers=2 src/engine/offseason/offseason.test.ts` → the snapshot writes
  on first run (commit it), (b) fails (no `resignCall`).
- [ ] **Step 3: Implement** `resignCall`, have `aiResignWindow` call it.
- [ ] **Step 4: Run** the same → PASS with the snapshot unchanged; `npm run typecheck`; `npm run offseason -- 6`
  → nothing flagged.
- [ ] **Step 5: Commit** — `Contracts: one re-sign call for the AI and our staff`

---

### Task 2: Let him walk

**Files:**
- Modify: `src/engine/types.ts` (`Team.lettingWalk`), `src/engine/offseason/index.ts` (`setLettingWalk`,
  `lettingWalk`), `src/engine/generate.ts`, `src/engine/migrate.ts`, `src/ui/screens/FrontOffice.tsx`
- Test: `src/engine/offseason/offseason.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces:
  - `Team.lettingWalk?: { season: number; ids: number[] }` — scoped to its league year: a list from an earlier year
    reads as empty, so nothing has to clear it.
  - `setLettingWalk(league: League, playerId: number, on: boolean): void` — the one writer; only for our expiring
    players in the re-sign window (throws otherwise).
  - `lettingWalk(league: League, playerId: number): boolean`.
  - Re-sign table: a walk-listed row shows "Letting him walk" and a **Keep talking** button (calls
    `setLettingWalk(..., false)`), in place of Negotiate/Tag.

- [ ] **Step 1: Failing tests** — toggling on and off; a list from last season reads false; throws for a player not
  expiring; v65 save loads at 66 (`migrate.test.ts`: update the version assertions to 66, keep the inbox-unchanged
  check).
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement**, `SAVE_VERSION = 66`, no-op step.
- [ ] **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Contracts: let him walk, a choice you can undo (save v66)`

---

### Task 3: The players' contracts letter

**Files:**
- Create: `src/engine/contractMail.ts`
- Modify: `src/engine/inbox.ts` (`newYearMail` stops filing per-player letters; call `contractMail`; `mailSubject`
  case `expiring` → `{ kind: 'expiring'; season }`; `needsYou`), `src/engine/types.ts` (`MailSection` row
  `contract?: { playerId: number }`), `src/ui/screens/Inbox.tsx` (`KIND_TAGS.expiring = 'Contracts'`)
- Test: `src/engine/contractMail.test.ts`; update `src/engine/inbox.test.ts:205-230` (the per-player letter tests)

**Interfaces:**
- Consumes: `resignCall` (Task 1), `lettingWalk` (Task 2), `say`, `recentBodies`, `toldKeys`, `director`, `Draft`.
- Produces:
  - `contractMail(league: League, have: Set<string>): Draft[]` — in `resign`, one letter `expiring:{season}`, only when
    we have expiring players; none if `have`/`toldKeys` already holds this window's per-player ids for all of them
    (an upgraded save mid-window). Section "Expiring contracts", columns Player, Age, Our read, Ask, Market, Call;
    rows sorted keep → tag → walk, then by our read; each row `{ playerId, cells, note, contract: { playerId } }`.
    Ask cell: `$X.XM × N, G% gtd` from `demand`. Call cell: Keep / Tag / Let walk. Note from a director bank keyed on
    `reason` (two or more lines each; e.g. starter: "Starter at a thin spot, and he's still climbing."; fading: "He's
    fading, and {better} is already ahead of him." when a teammate at his position reads higher; tag: "Top-of-market
    money for a top-of-market player. Tag him if talks stall."). `covered`: every row's `contracts:{season}:{id}`.
    Actions: `[{ kind: 'resign' }]`. Opener through `say`: "N deals are up. My calls below; the money is each agent's
    opening ask."
  - `contractDecision(league: League, playerId: number): 'signed' | 'tagged' | 'walking' | 'broken' | null` — read
    from the league as it is (his contract no longer expiring and with us: signed, or tagged by `kind === 'tag'`;
    walk list; talks broken this phase).
  - `needsYou` case `expiring`: in `resign` and some row's `contractDecision` is null.

- [ ] **Step 1: Failing tests** — one letter per window, re-delivery none, no `contracts:{season}:{id}` letters filed;
  rows equal the expiring players, sorted by call; a fading veteran behind a better teammate reads Let walk with a
  note naming him; Needs you true, then false after every row is signed, tagged or walk-listed; a v65-style inbox
  already holding this window's per-player letters files no new letter; no text matches `BANNED`.
- [ ] **Step 2: Run** — `npx vitest run --maxWorkers=2 src/engine/contractMail.test.ts src/engine/inbox.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Update the two inbox tests at `inbox.test.ts:205-230` to the new letter.
- [ ] **Step 4: Run** the same → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Mail: one contracts letter for the re-sign window, with our calls`

---

### Task 4: The letter's buttons

**Files:**
- Modify: `src/ui/mail.tsx` (contract rows in `SectionCard`), `src/ui/screens/Inbox.tsx` (hosts
  `NegotiationDialog`)
- Test: `src/ui/mail.test.tsx`

**Interfaces:**
- Consumes: `contractDecision` (Task 3), `setLettingWalk` (Task 2), `makeOffer`, `askOffer`, `demand`, `offerProblem`,
  `applyFranchiseTag`, `tagBlocker`, `tagValue`.
- Produces:
  - A row with `contract` draws, while `contractDecision` is null and the phase is `resign`: **Sign at ask**
    (`store.mutate(l => makeOffer(l, p, user, askOffer(demand(l, p, user))))`, disabled with
    `offerProblem(...)` text), **Tag $X** (disabled with `tagBlocker`), **Let walk** (`setLettingWalk(..., true)`),
    **Negotiate** (calls `onNegotiate(playerId)`). Otherwise the outcome: "Re-signed thru {lastSeason}", "Tagged",
    "Letting him walk" with Keep talking, "Talks broken off", or after the window "Signed with the {team}" / "Still a
    free agent".
  - `MailSections` and `MessageBody` take an optional `onNegotiate?: (playerId: number) => void`; `Inbox` keeps
    `talking: number | null` state and renders `NegotiationDialog` as `FrontOffice` does.

- [ ] **Step 1: Failing tests** — rendering a contract row in `resign` shows the four buttons; over the cap, Sign at ask
  is disabled with the problem text; after `setLettingWalk` the row reads "Letting him walk"; after signing, "Re-signed
  thru …"; the screen contract (`ui.test.ts`) still passes.
- [ ] **Step 2: Run** — `npx vitest run --maxWorkers=2 src/ui/mail.test.tsx src/ui/ui.test.ts` → FAIL.
- [ ] **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Review checkpoint** — add an `end` preview (already in `mail-preview`: `end.json`, the re-sign window)
  and shoot `--mail expiring:,staff:` on it, dark theme, desktop and phone; send with the "before" shot of the folded
  "14 contracts are up" letter from the owner's original screenshots.
- [ ] **Step 6: Commit** — `Mail: sign, tag, let walk or negotiate from the contracts letter`

---

### Task 5: The staff letter: Let go and a call per person

**Files:**
- Create: `src/engine/staffCall.ts`
- Modify: `src/ui/mail.tsx` (`StaffDealsCards`, its `PersonRow`)
- Test: `src/engine/staffCall.test.ts`, `src/ui/mail.test.tsx`

**Interfaces:**
- Produces:
  - `staffCall(league: League, person: { kind: 'coach' | 'scout' | 'medic'; id: number }): string` — one line through
    `say`, from facts: his two ratings' mean against the league median of the same chair (`role`), his two-year ask
    against his salary, and whether the ask goes past our budget (the same `moveOverspend` / `*MoveProblem` checks the
    card already runs). Lines: above the middle and the ask fits → "Worth the raise." / "Keep him; good ones cost
    this."; around the middle and a modest ask → "Fair price for what he gives us."; over budget → "Over the budget at
    his ask."; below the middle with a big raise → "We can do better for the money."
  - Each live row: the call line under his name; **Let go** beside **Extend** (`releaseCoach` / `releaseStaff` /
    `releaseMedic`); for the head coach, Let go opens a `Dialog` confirm ("Let {name} go? You'll need a new head coach
    before camp.") first.

- [ ] **Step 1: Failing tests** — `staffCall` gives "Over the budget" when the ask overruns the budget and "Worth the
  raise" for a top-rated man whose ask fits; the card renders Let go for a live row; the head coach's Let go renders a
  confirm before releasing.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Mail: let staff go from the contracts letter, with a call on each`

---

### Task 6: The draft's buttons ask before they pick

**Files:**
- Modify: `src/ui/App.tsx` (`offseasonStep` exported; the draft case; `secondary` during the draft),
  `src/ui/screens/Draft.tsx` (Sim the rest behind a `Dialog`)
- Test: `src/ui/draftTrades.test.tsx` (or `src/ui/ui.test.ts`)

**Interfaces:**
- Produces:
  - `offseasonStep(league)` exported; while `draftComplete(league)` is false it returns
    `{ label: 'Go to the draft', run: () => {}, then: { view: 'office', tab: 'draft' } }`.
  - `secondary` while picks remain: `{ label: 'Auto-draft…', fn: draftToEnd, title: 'Let the AI make the rest of the
    picks?', body: "The AI makes every remaining pick, yours included. This can't be undone.", ok: 'Auto-draft',
    cancel: "I'll pick", then: { view: 'office', tab: 'draft' } }`. Draft complete: "Sim offseason…" as now.
  - Draft room: **Sim the rest (AI picks for you)** opens a `Dialog` with the same wording; only its confirm runs
    `draftToEnd`.

- [ ] **Step 1: Failing tests** — in a league in the `draft` phase with picks left, running `offseasonStep(l)!.run(l)`
  leaves `l.phase === 'draft'` and the number of made picks unchanged; its label is "Go to the draft"; the Draft
  screen's Sim the rest renders no `draftToEnd` call until the confirm (render with the dialog open via its state, or
  assert the button's handler opens the dialog: test the exported `SimTheRest` component).
- [ ] **Step 2: Run** — `npx vitest run --maxWorkers=2 src/ui/draftTrades.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Draft: the main button opens the draft room; auto-drafting asks first`

---

### Task 7: Wrap-up

**Files:** `src/ui/changelog.ts`, `package.json`, `CLAUDE.md` (the inbox line: the contracts letter)

- [ ] **Step 1:** Leak check over a re-sign window's letters (extend the season test in `inbox.test.ts` or add to
  `contractMail.test.ts`): no `BANNED`, no `undefined`/`NaN`.
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 src/ui`, then `src/engine/offseason src/engine/inbox.test.ts
  src/engine/contractMail.test.ts`; `npm run typecheck`; `npm run format`.
- [ ] **Step 3:** Version 0.2.20; changelog "Contracts you can act on": the contracts letter with your staff's calls
  and the buttons, Let go for staff, and a draft that never picks for you without asking.
- [ ] **Step 4:** Final screenshots (contracts letter, staff letter, the draft's confirm) sent to the owner; commit,
  push, open the PR, watch CI.
