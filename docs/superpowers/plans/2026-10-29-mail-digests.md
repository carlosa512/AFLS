# Fewer, Fuller Letters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-line locker room, waiver and position-move letters with four fuller letters (the locker
room report at four check-ins, a daily waiver letter, one position-change letter, a weekly staff-notes letter), written
through a reusable line picker so the staff sound like people.

**Architecture:** A new `voice.ts` picks each sentence from a bank of conditional lines (most specific wins, stable
tie-break, no repeats in a sender's last five letters) and reads what the inbox has already told. Each new letter is
its own engine module that returns `Draft`s for `deliverMail`, with its table in a new optional `sections` field on
`InboxMessage`. One UI component draws `sections`. Preview tooling builds saves at each moment and screenshots the
letters so the owner can review them as we go.

**Tech Stack:** TypeScript, React, Vitest, Vite, Playwright (machine-installed, via `scripts/screens.ts`).

**Spec:** `docs/superpowers/specs/2026-10-29-mail-digests-design.md`

## Global Constraints

- Engine stays pure: no DOM, no React, no `Math.random`, and mail never draws from the sim's `Rng` streams.
- Every sentence is chosen by a condition on what our staff can see; the same league builds the same letter.
- Character and ceilings come from our read (`personalityRead`, `perceive`, `characterRead`), never `p.traits`,
  `p.ratings` or `p.potential` in any text. Tests reuse `BANNED = /marble|\btraits?\b|z-score/i`.
- Never NFL nicknames, real people's names or their quotes; no "Super Bowl", "AFC/NFC".
- `League` stays plain JSON; `SAVE_VERSION` 64 → 65 with a no-op step in `migrate.ts`.
- Old saves keep their letters; old message ids keep parsing in `mailSubject`.
- Covered keys reuse the old letters' ids, so an upgraded save never retells what an old letter told:
  `mentor:{season}:{week}:gone:{pid}`, `mentor:{season}:took:{pid}`, `persona:{season}:{pid}`,
  `feud:{season}:{a}:{b}` (a < b), `friend:{season}:left:{a}:{b}`, `captains:{season}`,
  `waiverClaim:{season}:{entryId}`, `waiverOut:{season}:{entryId}`, `position:{season}:moved:{pid}`; new:
  `friend:{season}:{a}:{b}` (a < b), `wire:{season}:{entryId}`.
- Checks a session runs: `npm run typecheck`, `npx vitest run <touched files>`, `npm run format` before each commit.
  No sims (mail never changes play). CI runs the rest on the PR.
- Ship: bump `package.json` 0.2.18 → 0.2.19 and add a `src/ui/changelog.ts` entry (`docs/VERSIONING.md`).
- **Review checkpoints:** where a task says so, build the preview saves, take the screenshots and send them to the
  owner with `SendUserFile` (`status: 'proactive'`), then wait for their input before the next UI task.

## Review Focus

- A sim that jumps several weeks in one step (Sim to deadline, Sim to end of season) passes several check-ins at
  once: only the latest due report files, and it covers everything since the last one (Task 7).
- A save upgraded from v64 mid-season, whose old one-off letters already told a feud or a lost mentor: the next
  report must not tell it again (Task 7, Task 4).
- A waiver player claimed by another club (or our roster at 53) between the letter filing and the click: the Claim
  button shows the `claimProblem` reason and the letter stops needing you (Task 4).
- A team with no head coach or no position coach in a chair: letters sign as "Coaching staff" and still file
  (Tasks 5–8).
- A week with a staff note but no game (bye week): the staff-notes letter still files that week (Task 6).

---

### Task 1: The line picker (`voice.ts`)

**Files:**
- Create: `src/engine/voice.ts`
- Test: `src/engine/voice.test.ts`

**Interfaces:**
- Produces:
  - `interface Line<C> { when?: (c: C) => boolean; reads?: number; text: (c: C) => string }` — `reads` is how many
    facts `when` looks at (default 0); higher is more specific.
  - `say<C>(bank: readonly Line<C>[], c: C, at: { key: string; slot: string; recent?: readonly string[] }): string`
    — the matching lines with the highest `reads`; among them, drop any whose text appears in one of `recent` (unless
    that drops all); pick by `stableHash(`${at.key}:${at.slot}`) % n`. Returns `''` if nothing matches.
  - `stableHash(s: string): number` — FNV-1a 32-bit, unsigned.
  - `recentBodies(league: League, from: string, n = 5): string[]` — bodies of the last `n` inbox messages with that
    `from`, newest first.
  - `toldKeys(league: League): Set<string>` — every inbox message id plus every entry of every message's `covered`.
  - `MOTTOS: readonly string[]` (at least eight, our own wording: "Next man up.", "We don't make excuses in this
    building.", "It's a long season.", "Ball's in our hands." …) and `mottoOf(coachId: number): string`.

- [ ] **Step 1: Write the failing tests**

```ts
it('the most specific matching line wins', () => {
  const bank: Line<{ still: boolean }>[] = [
    { text: () => 'They don\'t see eye to eye.' },
    { when: (c) => c.still, reads: 1, text: () => 'Still not talking.' },
  ];
  expect(say(bank, { still: true }, { key: 'k', slot: 's' })).toBe('Still not talking.');
  expect(say(bank, { still: false }, { key: 'k', slot: 's' })).toBe("They don't see eye to eye.");
});
it('ties break the same way every time, and differently across letters', () => {
  const bank = ['a', 'b', 'c', 'd'].map((t) => ({ text: () => t }));
  const pick = (key: string) => say(bank, {}, { key, slot: 'verdict' });
  expect(pick('locker:2028:camp')).toBe(pick('locker:2028:camp'));
  expect(new Set(['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => pick(`locker:${k}`))).size).toBeGreaterThan(1);
});
it('skips a line the sender used recently when another fits', () => {
  const bank = [{ text: () => 'Quiet room.' }, { text: () => 'Nothing to report.' }];
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f'])
    expect(say(bank, {}, { key, slot: 'v', recent: ['Quiet room. Good week.'] })).toBe('Nothing to report.');
});
it('keeps a recent line when it is the only one that fits', () => {
  expect(say([{ text: () => 'Only.' }], {}, { key: 'a', slot: 'v', recent: ['Only.'] })).toBe('Only.');
});
it('a coach keeps one motto', () => {
  expect(mottoOf(7)).toBe(mottoOf(7));
  expect(MOTTOS).toContain(mottoOf(7));
});
```

Plus a `toldKeys` test: a league whose inbox holds `{ id: 'x', covered: ['feud:2028:1:2'] }` returns both keys.

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/engine/voice.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `voice.ts`** (pure; imports only types). `covered` doesn't exist on `InboxMessage` yet: add
  `covered?: string[]` to `InboxMessage` in `src/engine/types.ts` now (Task 2 adds the rest).
- [ ] **Step 4: Run** — `npx vitest run src/engine/voice.test.ts` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** — `git commit -m "Mail: a line picker for every voice (voice.ts)"`

---

### Task 2: Sections on a message, the save step, and the component that draws them

**Files:**
- Modify: `src/engine/types.ts` (`InboxMessage`, `InboxAction`), `src/engine/generate.ts:50`, `src/engine/migrate.ts`,
  `src/engine/inbox.ts` (`MailSubject`, `mailSubject`), `src/ui/mail.tsx` (`MailCards`), `src/ui/screens/Inbox.tsx`
  (`KIND_TAGS`, `actionLabel`, the `act` switch, `MessageBody`)
- Test: `src/engine/migrate.test.ts`, `src/ui/mail.test.tsx`, `src/ui/ui.test.ts` (screen contract)

**Interfaces:**
- Produces:
  - On `InboxMessage`: `sections?: MailSection[]` with
    `interface MailSection { title: string; lead?: string; columns?: string[]; rows: { playerId?: number; cells: string[]; note?: string; claim?: { entryId: number } }[] }`
    (export `MailSection` from `types.ts`).
  - `InboxAction` gains `{ kind: 'locker' }` (label "Locker room", route `{ view: 'locker' }`) and
    `{ kind: 'waivers' }` (label "Waiver wire", route `{ view: 'office', tab: 'waivers' }`).
  - `MailSubject` gains `{ kind: 'lockerReport'; season; checkin: 'camp' | 'cutdown' | 'deadline' | 'end' }` (id
    `locker:{season}:{checkin}`), `{ kind: 'waivers'; season; week }` (id `waivers:{season}:{phase}:{week}`),
    `{ kind: 'staffNotes'; season; week }` (id `staffNotes:{season}:{week}`), `{ kind: 'positionMoves'; season }` (id
    `positions:{season}:{phase}:{week}`). `KIND_TAGS`: Locker room, Waivers, Staff, Training.
  - `MailSections({ league, sections, act })` in `src/ui/mail.tsx`: per section a title, the lead, a table (header
    from `columns`, sorted with `SortTh` when it has more than one column), the row's player name via `PlayerLink`
    in the first cell, `note` muted under the row; `claim` rows get a Claim button (Task 4 fills its handler). Phones
    stack cells under the name (reuse the mail table CSS the advice cards use).
  - `MessageBody` draws `MailSections` whenever `m.sections` exists, and skips the `coachNote` aside when it does.

- [ ] **Step 1: Failing tests**
  - `migrate.test.ts`: a v64 save loads at version 65 with its inbox unchanged (deep-equal messages).
  - `mail.test.tsx`: a message with two sections renders both titles, a `PlayerLink` per row, and a row's note.
  - `ui.test.ts`: the new component passes the screen contract (names through `PlayerLink`, tables with `SortTh`).
  - `mailSubject` reads each of the four new ids to its kind; an old `feud:2028:1:2` still reads as `locker`.
- [ ] **Step 2: Run** — `npx vitest run src/engine/migrate.test.ts src/ui/mail.test.tsx src/ui/ui.test.ts` → FAIL.
- [ ] **Step 3: Implement** — `SAVE_VERSION = 65`; the migrate step only sets the version.
- [ ] **Step 4: Run** the same command → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** — `git commit -m "Mail: sections on a message (save v65) and the table that draws them"`

---

### Task 3: Preview saves and letter screenshots for review

**Files:**
- Create: `scripts/mail-preview.ts`
- Modify: `scripts/screens.ts` (a `--mail <prefix>[,<prefix>…]` option), `package.json` (`"mail-preview"` script)

**Interfaces:**
- Produces:
  - `npm run mail-preview -- --save <save.json> --out <dir>`: loads and migrates the save (`migrateLeague`), then
    steps the calendar the way the app does (`playWeek` in season, `advanceOffseason` between, `deliverMail` after
    every step) and writes a save at each moment: `deadline.json` (regular, week 9), `end.json` (re-sign window),
    `camp.json` (preseason, captains named), `cutdown.json` (regular, week 1, after cut-down day). Stops early with a
    clear message if the user loses his job.
  - `npm run screens -- --save <s> --out <d> --mail locker:,waivers:` opens `#/inbox/<encoded id>` for the newest
    message whose id starts with each prefix and writes `mail-<prefix>.png` at 1440×900 plus `mail-<prefix>-phone.png`
    at 390×844. A prefix with no message prints a warning and moves on.

- [ ] **Step 1: Build previews from the owner's save** —
  `npm run mail-preview -- --save "/root/.claude/uploads/6546d6b1-b35f-5809-ae41-ea9204454acf/24b6fe63-afls-ten-2028-regular.json" --out <scratchpad>/preview`
  → four saves written, each line naming its phase and week.
- [ ] **Step 2: Screenshot today's letters (the "before")** —
  `npm run screens -- --save <scratchpad>/preview/deadline.json --out <scratchpad>/before --mail feud:,waiverOut:,recap:`
  → PNGs written. Keep them for side-by-side review later.
- [ ] **Step 3: Commit** — `git commit -m "Scripts: preview saves at each mail moment, and letter screenshots"`

---

### Task 4: The waiver letter (`waiverMail.ts`)

**Files:**
- Create: `src/engine/waiverMail.ts`, `src/engine/senders.ts` (move `headCoach`, `director`, `doctor` out of
  `inbox.ts` and `headCoach`, `roomCoach` out of `lockerMail.ts`, so the new letter modules can sign without importing
  `inbox.ts`, which imports them)
- Modify: `src/engine/inbox.ts` (remove `waiverMail`; call the new one where it was; `needsYou` case `waivers`;
  import the senders), `src/engine/lockerMail.ts` (import the senders), `src/engine/directorAdvice.ts` (export `MIN_KNOWLEDGE`), `src/ui/mail.tsx` (Claim handler)
- Test: `src/engine/waiverMail.test.ts` (move the existing waiver-mail cases from `src/engine/personnel/mail.test.ts`
  and adapt them)

**Interfaces:**
- Consumes: `say`, `toldKeys`, `recentBodies` (Task 1); `MailSection` (Task 2); `waiverOrder`, `claimProblem`,
  `setWaiverClaim` (`personnel/waivers.ts`); `ROSTER_TEMPLATE` (`positions.ts`); `starterLine`, `tradeContext`.
- Produces: `senders.ts` exports `type Sender = Pick<InboxMessage, 'from' | 'fromCard'>`, `headCoach(league)`,
  `director(league)`, `doctor(league)`, `roomCoach(league, p)` (same output as today), and `type Draft = Omit<InboxMessage, 'read'>`.
  `waiverMail(league: League, have: Set<string>): Draft[]` — at most one letter, id
  `waivers:{season}:{phase}:{week}`, `covered` = every result key and `wire:` key it tells; and
  `wireChance(league: League, entry: WaiverEntry): { place: number; word: 'good chance' | 'maybe' | 'long shot' }`.

Rules (from the spec):
- **Results section** ("What happened"): one row per result not in `toldKeys`; columns Player, Age, Our read, Deal,
  What happened. Released and claimed: "Claimed by the Fog; his contract went with him." Cleared: "Cleared; his release
  stays on our cap" with the dead money from the entry. Our claim won / lost: as today's text.
- **Wire section** ("On the wire now"): pending entries not released by us and not already `wire:`-told, where
  active, available bodies at the position < `ROSTER_TEMPLATE[pos]`, our `potMid` ≥ the starter line at the
  position, and our `knowledge` ≥ `MIN_KNOWLEDGE`. Thinnest position first (template minus bodies), then higher
  `potMid`; three at most. Each row's note is one director sentence from a bank (e.g. "Two safeties behind the
  starters. Raw, but our scouts see a starter in him by 25."). `claim: { entryId }`.
- **Chance:** `place` = our index in `waiverOrder` + 1; `word` from how many clubs ahead of us are thin at that
  position: 0 → good chance, 1–2 → maybe, 3+ → long shot.
- **Needs you:** while a wire row's player is still pending and we have no claim on his entry.
- **Claim button:** `store.mutate((l) => setWaiverClaim(l, { entryId, teamId: l.userTeamId, cutIds: [], preference: <our claim count> }))`;
  disabled with `claimProblem`'s text when it returns one; shows "Claimed" once our claim is on file.

- [ ] **Step 1: Failing tests** (`waiverMail.test.ts`)
  - three of our releases settled on one day file one letter with three result rows;
  - delivering twice files nothing new; a result whose old `waiverOut:` id is already in the inbox isn't told again;
  - the wire lists only thin positions and ceilings at or above the line on our read; never our own release; at
    most three; thinnest first;
  - `wireChance` gives `long shot` when three thin clubs sit ahead of us;
  - `needsYou` is true until we put a claim in, then false; false once the entry settles;
  - no row text matches `BANNED`.
  - `mail.test.tsx`: the Claim button calls `setWaiverClaim` with our team and that entry, and shows the
    `claimProblem` text when the roster is full.
- [ ] **Step 2: Run** — `npx vitest run src/engine/waiverMail.test.ts src/ui/mail.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same → PASS; also `npx vitest run src/engine/personnel` and `npm run typecheck`.
- [ ] **Step 5: Review checkpoint** — rebuild previews (Task 3), screenshot `--mail waivers:` on `cutdown.json` and
  `deadline.json`, send with the "before" shot of three claim letters; wait for the owner's input.
- [ ] **Step 6: Commit** — `git commit -m "Mail: one waiver letter a day, with who's worth a claim"`

---

### Task 5: The position-change letter

**Files:**
- Modify: `src/engine/inbox.ts` (`positionMovedMail` → one letter; `FOLDED` loses `positionMoved`)
- Test: `src/engine/inbox.test.ts` (or the existing position-move mail test file, wherever `position:…:moved` is
  tested today: `grep -rln "moved:" src/engine/*.test.ts`)

**Interfaces:**
- Consumes: `MailSection` (Task 2), `say` (Task 1), `moveNews`, `reasonLine`, `positionTeachingNote`.
- Produces: `positionMovedMail(league, have): Draft[]` returns at most one letter, id
  `positions:{season}:{phase}:{week}`, `covered` = each mover's `position:{season}:moved:{pid}`; one section with
  columns Player, From, To, Why, Learning it (from `knockWord(knockFor(p, move.to))` in `familiarity.ts`: none →
  "at home there", small → "still learning it", big → "a long way to go"); actions `{ kind: 'team', teamId: user }` ("Your roster"). Opening
  sentence from a head-coach bank keyed on the day's moves ("Two moves at cut-down: both corners going inside.").

- [ ] **Step 1: Failing tests** — two movers on cut-down day file one letter with two rows; a mover whose old
  `position:` id is already in the inbox isn't listed; re-delivery files nothing.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS, `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "Mail: position changes as one letter"`

---

### Task 6: The staff-notes letter, and recaps about the game

**Files:**
- Create: `src/engine/staffNotes.ts`
- Modify: `src/engine/coachReports.ts` (add `teachingNoteFor`), `src/engine/inbox.ts` (`matchupMail` drops
  `coachAdviceObservation`; recap drops `teachingObservation` and puts `userCoachGameObservation` in its own
  sentence after the result; call `staffNotesMail`)
- Test: `src/engine/staffNotes.test.ts`; existing `src/engine/coachStories.test.ts`, `coachDecisions` tests stay green

**Interfaces:**
- Consumes: `coachAdviceObservation`, `adviceKey` (unchanged); `headCoach`, `Draft` (`senders.ts`, Task 4).
- Produces:
  - `teachingNoteFor(league: League): { coachId: number; coachName: string; playerId: number; text: string } | undefined`
    (the same condition `teachingObservation` reads; `teachingObservation` becomes a thin wrapper or goes).
  - `staffNotesMail(league: League, have: Set<string>): Draft[]` — phase regular or playoffs, at most one letter a
    week (id `staffNotes:{season}:{week}`), only with a note. One section "From the staff", a row per note: the coach
    (name and chair) and his line. When the depth-chart note is present the letter carries `coachNoteKey` and
    `coachNote` exactly as `matchupMail` does today. Actions: each note's player, then `{ kind: 'team', teamId: user }`.
    Signed by the head coach ("Coaching staff" when the chair is empty).

- [ ] **Step 1: Failing tests**
  - a week with a recommendation files a staff-notes letter with `coachNoteKey`, and `recordAdvicePublications`
    marks it noted (the recommendation isn't offered again next week);
  - the opposition report that week has no `coachNote` and no recommendation text;
  - a recap in a week with a teaching note doesn't contain "focused coaching attention";
  - a bye week with a note still files the letter;
  - no note, no letter.
- [ ] **Step 2: Run** — `npx vitest run src/engine/staffNotes.test.ts src/engine/coachStories.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `npx vitest run src/engine/coachDecisions` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "Mail: the staff's notes in their own letter; recaps stick to the game"`

---

### Task 7: The locker room report: check-ins, sections, what's been told

**Files:**
- Create: `src/engine/lockerReport.ts`
- Modify: `src/engine/mentoring.ts` (add `mentorStatus`, `betterMentor`; `planMentors` uses a shared sort),
  `src/ui/screens/LockerRoom.tsx` (import `mentorStatus` from the engine), `src/engine/lockerMail.ts` (drop `took`,
  `grownUp`, `gone`, `captains`, `feudMail`, `friendGoneMail` from delivery; their conditions move to the report),
  `src/engine/inbox.ts` (call `lockerReportMail`)
- Test: `src/engine/lockerReport.test.ts`; `src/engine/lockerMail.test.ts` (the moved cases now assert the report)

**Interfaces:**
- Consumes: `toldKeys` (Task 1), `MailSection` (Task 2), `headCoach`, `Draft` (`senders.ts`, Task 4), `leadersOf`, `personalityRead`, `TRADE_DEADLINE_WEEK`.
- Produces:
  - `mentorStatus(league: League, young: Player): 'early days' | 'learning well' | 'not taking' | 'picking up his bad habits'`
    (moved unchanged from `LockerRoom.tsx`).
  - `betterMentor(league: League, teamId: number, young: Player): Player | undefined` — a free mentor (under
    `MAX_MENTEES`, not his current one) whose `mentorShift(...).workEthic` over the pair's weeks so far is ≥ 0.05 and
    beats the current pair's; ties by the planner's order.
  - `dueCheckin(league: League, have: Set<string>): 'camp' | 'cutdown' | 'deadline' | 'end' | null` — camp:
    `preseason` with this season's captains; cutdown: `regular`, week < `TRADE_DEADLINE_WEEK`; deadline: `regular`,
    week ≥ `TRADE_DEADLINE_WEEK`; end: `resign`. Already-filed check-ins are skipped; only the latest due one returns
    (a jump past cut-down to week 12 files the deadline report only).
  - `lockerReportMail(league: League, have: Set<string>): Draft[]` — at most one letter, id
    `locker:{season}:{checkin}`, category `staff`, signed by `headCoach`, actions `[{ kind: 'locker' }]`, `covered` =
    every key it told. Sections (each only with rows), in order:
    1. **Captains and leaders** (camp only): three captains then `leadersOf`, columns Player, Role, How we read him;
       note = why he has the C (Task 8 writes the words).
    2. **Mentoring**: current pairs with `mentorStatus`; lost mentors (`p.lostMentor` this season, key
       `mentor:{season}:{week}:gone:{pid}`) with the new pairing or "waiting"; a `betterMentor` suggestion as the
       note where the pair is "not taking" or "picking up his bad habits".
    3. **Friction**: feuds with `since === season` (key `feud:{season}:{a}:{b}`), with how it started.
    4. **Getting along**: friendships `since === season` (key `friend:{season}:{a}:{b}`) and friends gone (the
       `friendGoneMail` condition, key `friend:{season}:left:{a}:{b}`).
    5. **Grew up** (end only): the old `grownUp` (key `persona:…`) and `took` (key `mentor:…:took:…`) conditions.
    The body holds the verdict and every row as text (for search). Task 7 writes plain placeholder sentences; Task 8
    replaces them through banks.

- [ ] **Step 1: Failing tests** (`lockerReport.test.ts`, using the `world()` setup from `lockerMail.test.ts`)
  - six lost mentors in one week file no mentor letters, and the next report lists all six;
  - each check-in files once a season; re-delivery files nothing;
  - a feud told in the deadline report isn't in the end report;
  - an old `feud:{season}:{a}:{b}` letter already in the inbox keeps that feud out of the report;
  - a jump from preseason to week 12 files the deadline report, not the cut-down one;
  - empty sections are left out; a quiet check-in still files with just its verdict;
  - no head coach: signed "Coaching staff";
  - no text matches `BANNED`.
- [ ] **Step 2: Run** — `npx vitest run src/engine/lockerReport.test.ts src/engine/lockerMail.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `npx vitest run src/engine/mentoring src/ui` → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "Mail: the locker room report at four check-ins, in place of one-off letters"`

---

### Task 8: The locker room report's voice

**Files:**
- Create: `src/engine/lockerVoice.ts` (the head coach's banks for the report)
- Modify: `src/engine/lockerReport.ts` (sentences through `say`)
- Test: `src/engine/lockerVoice.test.ts`

**Interfaces:**
- Consumes: `Line`, `say`, `recentBodies`, `mottoOf` (Task 1); the report's facts (Task 7).
- Produces: banks `VERDICT`, `CAPTAIN_WHY`, `MENTOR_ROW`, `MENTOR_LOST`, `MENTOR_SUGGEST`, `FRICTION`, `GETTING_ALONG`,
  `GREW_UP`, each `readonly Line<Fact>[]` with its own small `Fact` type. Every bank has a plain fallback line
  (`reads: 0`). The coach's motto appears at most once a report, as the verdict's closer when the verdict line asks
  for one.

Register (spec, "The register"): short, flat sentences; the room's business stays in the room; captains are the
room's call. The spec's samples are the floor for tone, e.g. VERDICT: "Quiet room. The kind I like heading into
October." (no new rows, month from the week), "Mostly good. One thing on the line to watch, and Jefferson needs a new
voice." (one feud and one lost mentor); FRICTION: "Dunn and Mack still aren't talking." (`reads: 2`, a feud from an
earlier report still on) over "Dunn and Mack don't see eye to eye." (fallback), with "It's handled. If it ever gets
onto the field, you'll hear it from me before you hear it from SNN." as a closer; CAPTAIN_WHY: "Second year, I know,
but the room already goes to him." (experience ≤ 2, leader read).

- [ ] **Step 1: Failing tests**
  - the same league builds the same report twice (deep-equal `body` and `sections`);
  - a still-running feud reads "still" and a new one doesn't;
  - the verdict differs across at least two of four seasons' camp reports on one save (variety on the line players
    read most);
  - no sentence repeats one in the head coach's last five letters when the bank has another that fits;
  - the motto appears at most once per report;
  - no text matches `BANNED`, names an NFL nickname (`RESERVED_NICKNAMES`) or says "Super Bowl".
- [ ] **Step 2: Run** — `npx vitest run src/engine/lockerVoice.test.ts` → FAIL.
- [ ] **Step 3: Write the banks and wire them in.** Each bank: 4–8 lines, most with conditions; the verdict 10+.
- [ ] **Step 4: Run** the same plus `src/engine/lockerReport.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 5: Review checkpoint** — rebuild previews; screenshot `--mail locker:` on all four preview saves (desktop
  and phone), plus `staffNotes:` and `positions:`; send them to the owner with the "before" shots; wait for input on
  tone and layout, and fold it in before the commit.
- [ ] **Step 6: Commit** — `git commit -m "Mail: the head coach's voice for the locker room report"`

---

### Task 9: Wrap-up: leak checks, changelog, version, PR

**Files:**
- Modify: `src/engine/inbox.test.ts` (or wherever the inbox's fog-of-war test lives:
  `grep -rln "playerOvr\|BANNED" src/engine/*.test.ts`), `src/ui/changelog.ts`, `package.json`

- [ ] **Step 1: Extend the leak test** to every new letter: across a preview season, no `body`, `sections` cell or
  note contains a true rating, `potential` or a trait value for another club's player, or matches `BANNED`.
- [ ] **Step 2: Run** — `npx vitest run src/engine src/ui` → PASS; `npm run typecheck`; `npm run format`.
- [ ] **Step 3: Version and changelog** — `package.json` 0.2.19; changelog entry, title "Fewer, fuller letters", one
  paragraph in a player's words: the locker room report four times a year, one waiver letter with who's worth a
  claim, position changes in one letter, the staff's notes in their own weekly letter, recaps about the game.
- [ ] **Step 4: Commit and push** — `git push -u origin claude/clever-bell-3tr3fx`.
- [ ] **Step 5: Final screenshots** — every new letter on the preview saves, desktop and phone, sent to the owner.
- [ ] **Step 6: Open the PR** (only if the owner asks), then read CI and fix what's red.
