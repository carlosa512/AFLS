# Offseason Mail Diet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user's expiring GM deal becomes an offer to accept or decline; the owner sends one letter per league
year; other clubs' offseason front-office news arrives as one SNN digest per offseason step; outlets get fixed
avatar badges; GM public perception varies by career.

**Architecture:** Engine changes in `leadership.ts` / `gm.ts` (the offer), mail assembly in `inbox.ts` (letter,
digest), presentation in `ui/screens/Inbox.tsx`, `ui/mail.tsx`, `ui/screens/GmEmployment.tsx` and `ui/gm.tsx`. One save
bump (v50) for two optional fields.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-offseason-mail-diet-design.md`

## Global Constraints

- `League` stays plain JSON; `SAVE_VERSION` 49 → 50 with a `migrate.ts` step (no-op rewrite).
- The sim never sends mail; mail is built in `deliverMail` paths in `inbox.ts`.
- Mail ids are stable: an event's own id `leadership:{season}:{eventId}` counts as delivered when a digest carries it.
- No hidden ratings or private reasons in public (SNN) text; private text only in the owner's letter to us.
- Text about a GM uses `pron` (`pronouns.ts`); GMs can be women.
- Commands per task: `npm run typecheck` and `npx vitest run <touched test files>`. No sims. `npm run format` before
  each commit.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011v2LBUCkesLYVVQ4bbGtKB`.

## Review Focus

1. The owner fires the user (review `gmChange`/`bothChange`) while the deal is also up → no extension offer, only the
   job-pool offers. (Task 1 test.)
2. The user is an interim GM → gets the existing permanent offer, never also an extension offer. (Task 1 test.)
3. The user declines the extension when no other club has an opening → the guaranteed job-pool offer still appears,
   and it is not our old club. (Task 1 test.)
4. A save reloaded (JSON round trip) mid-window keeps the open offer, the calendar block and Needs you on the letter.
   (Task 3 test.)
5. Our own club's offseason event falls in the same phase as other clubs' → it never appears in the SNN digest. (Task 4
   test.)

---

### Task 1: The extension offer (engine)

**Files:**
- Modify: `src/engine/types.ts` (`GmJobOffer`), `src/engine/gm.ts`, `src/engine/leadership.ts` (`leadershipNewYear`
  extension branch ~line 215, `beginGmSearch`, `acceptGmOffer`, `declineGmOffers`), `src/engine/offseason/index.ts`
  (`offseasonBlockers` text), `src/engine/generate.ts` (`SAVE_VERSION = 50`), `src/engine/migrate.ts`
- Test: `src/engine/leadership.test.ts`

**Interfaces:**
- Produces: `GmJobOffer.extension?: boolean`; `extendGm(league: League, gmId: number, through: number): void` in
  `gm.ts`; `userExtensionOffer(l: League): GmJobOffer | undefined` in `leadership.ts` (the open extension offer, or
  undefined). Task 2 and 3 read these.

- [ ] **Step 1: Write the failing tests** in a new `describe('your contract offer', …)`. Helper: a world in `resign`
  whose user appointment has `through = l.season - 1`, then `leadershipNewYear(l)`. Force the review outcome by
  setting `t.leadershipReview` beforehand only where a test needs a specific outcome, or by stubbing history.

```ts
it('offers the user an extension instead of extending silently', () => {
  // user's through < season, review outcome 'back'
  const o = userExtensionOffer(l)!;
  expect(o).toMatchObject({ teamId: l.userTeamId, through: l.season + 2, incumbent: true, extension: true });
  expect(l.leadership.search!.offers[0]).toBe(o);
  expect(l.gms[l.userGmId].appointments.at(-1)!.through).toBe(l.season - 1);
  expect(l.leadership.events.some((e) => e.kind === 'gmExtended' && e.gmId === l.userGmId)).toBe(false);
  expect(pendingGmOffers(l)).toBe(true);
  expect(() => advanceOffseason(l)).toThrow(/offers/);
});
it('makes a one-year prove-it offer on a warning', () => { /* outcome 'warning' → through === l.season */ });
it('accepting extends the deal and files the public line', () => {
  acceptGmOffer(l, l.userTeamId);
  expect(l.gms[l.userGmId].appointments.at(-1)!.through).toBe(l.season + 2);
  expect(l.leadership.events.at(-1)).toMatchObject({ kind: 'gmExtended', gmId: l.userGmId });
  expect(l.knowledge).not.toEqual({}); // set l.knowledge[10] = 1 first: no scouting reset
  expect(pendingGmOffers(l)).toBe(false);
});
it('declining ends the job and opens the job market without our old club', () => {
  declineGmOffers(l);
  const user = l.gms[l.userGmId];
  expect(user.teamId).toBeNull();
  expect(user.appointments.at(-1)!.reason).toBe('expired');
  const offers = l.leadership.search!.offers;
  expect(offers.length).toBeGreaterThan(0);
  expect(offers.every((o) => o.teamId !== oldTeam && !o.extension)).toBe(true);
  expect(l.leadership.search!.playerDeclined).toBeFalsy();
});
it('declining with no other opening still guarantees one way back', () => { /* no vacancies but ours → one offer, replacesGmId set, teamId !== oldTeam */ });
it('sim offseason accepts the extension', () => { /* advanceOffseason(l, { autoUser: true }) → through === season + 2 */ });
it('no extension offer when the owner lets the user go', () => { /* outcome gmChange → userExtensionOffer undefined */ });
it('an interim user gets the permanent offer, not an extension', () => { /* interim appointment → offers have no extension */ });
it('AI GMs are still extended in place', () => { /* an AI GM with through < season → through === season + 2, gmExtended filed */ });
```

- [ ] **Step 2: Run** `npx vitest run src/engine/leadership.test.ts -t "your contract offer"`. Expected: FAIL
  (`userExtensionOffer` not exported).

- [ ] **Step 3: Implement.**
  - `types.ts`: add `extension?: boolean` to `GmJobOffer` with a one-line comment ("the owner's offer to extend the
    user in the job he holds").
  - `gm.ts`: `extendGm` sets the current, permanent, unended appointment's `through`; throws like `makeGmPermanent`
    on a missing or interim appointment, or `through < league.season`.
  - `leadershipNewYear`: in the `a.through < l.season` branch, skip when `gm.id === l.userGmId`.
  - `beginGmSearch`: factor the `user.teamId === null` block into `function userJobOffers(l: League, offers:
    GmJobOffer[]): void`. Before it, when the user holds a permanent appointment at `l.userTeamId` with `through <
    l.season` and that team's `leadershipReview` (this season) has outcome `back`, `warning` or `coachChange`, push
    `jobOffer(l, l.userTeamId, { incumbent: true, extension: true, through: outcome === 'warning' ? l.season :
    l.season + 2 })` first.
  - `acceptGmOffer`: branch first on `offer.extension`: `extendGm`, `leadershipEvent(… kind: 'gmExtended', report:
    `${abbrev} extended GM ${name} through ${through}.` )`, record terms, `search.offers = []`, return. No scouting
    reset, no `recordHire`.
  - `declineGmOffers`: if an extension offer is open, `endGmAppointment(l, user.id, 'expired')`, set `s.offers = []`,
    call `userJobOffers(l, s.offers)` and `additionalOffers(l)`, and return without setting `playerDeclined` or
    advancing rounds. Otherwise as today.
  - `export function userExtensionOffer(l)`: the open offer with `extension` from `pendingGmOffers`' search.
  - `offseasonBlockers`: when `userExtensionOffer(league)`, the text is "Answer the owner's extension offer before
    leaving the staffing window."
  - `SAVE_VERSION = 50`; `migrate.ts`: `if (league.version < 50) league.version = 50; // v50: optional
    GmJobOffer.extension and InboxMessage.carousel; nothing to rewrite`.

- [ ] **Step 4: Run** `npx vitest run src/engine/leadership.test.ts src/engine/migrate.test.ts && npm run typecheck`.
  Expected: PASS. If an existing test expected the user to be extended silently, update it to accept the offer.

- [ ] **Step 5: Commit** "Your contract: an extension offer to accept or decline".

### Task 2: The offer on the GM screen

**Files:**
- Modify: `src/ui/screens/GmEmployment.tsx`
- Test: `src/ui/ui.test.ts` (or the existing GM screen test file, whichever renders `GmEmployment`)

**Interfaces:**
- Consumes: `GmJobOffer.extension`, `acceptGmOffer`, `declineGmOffers` (Task 1).

- [ ] **Step 1: Failing test:** render the screen with an extension offer open; expect "Extension through {through}",
  an "Accept" button, and a decline button labelled "Decline and enter the job market"; no "GM job offer" heading for it.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement:** an extension offer row shows the extension wording; its decline button carries
  `title`/confirm text "Your job with the {team name} ends." and calls `declineGmOffers`.
- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "GM screen: the extension offer".

### Task 3: One owner letter per league year

**Files:**
- Modify: `src/engine/inbox.ts` (`ownerMail` ~line 1824, `ownerVoice`, `leadershipMail` ~line 2336, `needsYou`
  `case 'owner'`)
- Test: `src/engine/inbox.test.ts`

**Interfaces:**
- Consumes: `userExtensionOffer(l)` (Task 1); `Team.leadershipReview` (`outcome`, `reason`).

- [ ] **Step 1: Failing tests** in `describe('the owner’s letter for the new league year', …)`:

```ts
it('puts the verdict, the offer and the budgets in one letter', () => {
  // resign window, user's deal up, outcome back
  const owner = mail.filter((m) => m.from === 'The owner');
  expect(owner).toHaveLength(1);
  expect(owner[0].subject).toBe(`Your contract: an offer through ${l.season + 2}`);
  expect(owner[0].body).toContain(`I'd like you back through ${l.season + 2}`);
  expect(needsYou(l, owner[0])).toBe(true);
});
it('names the warning in the subject and offers one year', () => { /* subject 'The new league year: I expect progress' when no offer is open; with an offer the contract subject wins and body has 'One more year, through' */ });
it('sends no separate owner mail for our warning, coach change or extension events', () => {
  expect(mail.some((m) => m.from === 'The owner' && /League sources|Reports suggest|extended GM/.test(m.subject))).toBe(false);
});
it('keeps Needs you after a JSON reload mid-window', () => { /* copy(l) → needsYou still true; advanceOffseason still throws */ });
it('still sends our GM firing as its own owner mail', () => { /* gmDismissed for user → owner mail with privateText */ });
```

- [ ] **Step 2: Run** `npx vitest run src/engine/inbox.test.ts -t "new league year"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `ownerMail` subject: offer open → `Your contract: an offer through ${through}`; else by review outcome `warning` →
    `The new league year: I expect progress`, `coachChange` → `The new league year: we need a new head coach`, else
    `The new league year`. Body leads with `leadershipReview.reason` when the outcome isn't `back`, then the contract
    sentence (`Your deal is up. I'd like you back through ${through}; let me know.` or, for a one-year offer, `Your
    deal is up. One more year, through ${through}, and we'll talk again.`), then the existing budget text. Actions:
    `{ kind: 'gms' }` first when an offer is open, then coaches, cap.
  - `needsYou` `case 'owner'`: true while `userExtensionOffer(league)` is open in this season.
  - `leadershipMail`: when `inside` and the event's phase is offseason (`OFFSEASON_PHASES`) and its kind is
    `warning`, `coachChange` or `gmExtended`, `continue` without a mail. `have` is read from the inbox each delivery
    (no ledger), so the same filter keeps it out on every later delivery; nothing needs marking.
- [ ] **Step 4: Run** `npx vitest run src/engine/inbox.test.ts src/engine/leadership.test.ts src/ui/mail.test.tsx`
  and `npm run typecheck`. Expected: PASS (update the old "A letter from the owner" expectations).
- [ ] **Step 5: Commit** "One owner letter per league year".

### Task 4: One SNN carousel digest per offseason step

**Files:**
- Modify: `src/engine/types.ts` (`InboxMessage.carousel`), `src/engine/inbox.ts` (`leadershipMail`, `carouselMail`
  ~line 2019), `src/ui/mail.tsx` (render the card)
- Test: `src/engine/inbox.test.ts`, `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: `InboxMessage.carousel?: { group: 'out' | 'hired' | 'extended' | 'hotSeat' | 'coaches'; teamId: number;
  gmId?: number; coachId?: number; name: string; line: string }[]`.

- [ ] **Step 1: Failing tests** in `describe('the offseason carousel digest', …)`:

```ts
it('gathers other clubs’ events of one offseason step into one SNN digest', () => {
  // leadershipNewYear on a world with badYears → many events
  const snn = mail.filter((m) => m.from === 'SNN league desk' && m.phase === 'resign');
  expect(snn).toHaveLength(1);
  expect(snn[0].id).toMatch(/^leadership-phase:\d+:resign:\d+-\d+$/);
  expect(snn[0].subject).toMatch(/^Front-office carousel: /);
  expect(snn[0].carousel!.length).toBe(otherClubEvents.length);
});
it('never puts our own club in the digest', () => { /* our warning + others' events → no carousel row with teamId === userTeamId */ });
it('files nothing twice for a save that already had single mails', () => { /* have contains leadership:{season}:{id} for some → digest omits them */ });
it('starts a new digest for an event after the first was filed', () => { /* file digest, add event, re-run → a second id with the new range */ });
it('keeps a lone event as its own story', () => { /* one event → subject === e.report */ });
it('sends the coaching carousel from SNN', () => { /* carouselMail from === 'SNN league desk' */ });
```

  `mail.test.tsx`: a digest renders a table with the group headings "Out", "Hired", "Extended", "Hot seat" (only
  those present) and a `TeamLink` per row.

- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `leadershipMail`: route other clubs' events with an offseason phase into a second map keyed
    `${season}:${phase}`, with a `coveredPhase` like `covered` for `leadership-phase` ids. Group from kind: `gmDismissed`
    / `gmRetired` → out; `gmHired` → hired; `gmExtended` → extended; `warning` / `coachChange` → hotSeat;
    `coachPermanent` / `coachDismissed` → coaches. Row `line`: record last season for out (`formatRecord`),
    `through {year}` for extended, `pressure to change the coaching staff` / `prove-it season` for hot seats, the
    report text otherwise.
  - Subject: up to three parts in the order out, hired, hot seat: `${n} GM(s) out`, `${n} hired`, `${n} on the hot
    seat`, joined by ", " after "Front-office carousel: ". Body: one lead sentence built from the same counts.
  - `carouselMail`: `from: 'SNN league desk'`.
  - `mail.tsx`: a `carousel` card, grouped, following the existing SNN table cards (`docs/UI.md`: names through
    `TeamLink`/GM link, no sorting needed).
- [ ] **Step 4: Run** the two files, `src/engine/leadership.test.ts`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "One SNN carousel digest per offseason step".

### Task 5: Outlet badges

**Files:**
- Modify: `src/ui/screens/Inbox.tsx` (`sender` ~line 111)
- Test: `src/ui/mail.test.tsx`

- [ ] **Step 1: Failing test:**

```ts
it.each([
  ['SNN league desk', 'SNN'], ['The Arena Gazette', 'GAZ'], ['League office', 'LO'], ['The owner', 'OWN'],
])('draws %s as %s', (from, badge) => expect(sender(from).initials).toBe(badge));
it('keeps people’s initials', () => expect(sender('Nick Holland, Director of scouting').initials).toBe('NH'));
```

  Export `sender` for the test if it isn't.
- [ ] **Step 2: Run** `npx vitest run src/ui/mail.test.tsx`. Expected: FAIL ("SD").
- [ ] **Step 3: Implement** `const OUTLET_BADGES: Record<string, string>` in `Inbox.tsx`; `sender` returns the badge
  when `from` is a key.
- [ ] **Step 4: Run** the file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "Outlet badges: SNN, GAZ, LO, OWN".

### Task 6: GM public perception

**Files:**
- Modify: `src/ui/gm.tsx` (`gmStyleNotes`)
- Test: `src/ui/gm.test.tsx`

**Interfaces:**
- Consumes: `gmRecord(league, gm).seasons` (`TeamSeasonRecord`: `season`, `teamId`, `regular`, `playoffs`,
  `finish`, `champion`), `gm.appointments` (`end`, `reason`, `teamId`), `league.leadership.events`, `pron`.

- [ ] **Step 1: Failing tests**, one per case, building `gm.career`/history as the existing `gm.test.tsx` cases do:

```ts
expect(notes(firedAfter3_13)[0]).toBe('Out of work since LV let her go after a 3–13 season.'); // pron follows the GM
expect(notes(dealRanOut)[0]).toBe('Left SF when his deal ran out after 2027; available.');
expect(notes(outTwoYears)[0]).toBe('Hasn’t run a front office since 2027.');
expect(notes(twoTitlesIn3)[0]).toBe('Two titles in three years.');
expect(notes(titleThenSlide)[0]).toBe('Won it all in 2026; 9–25 since.');
expect(notes(oneTitle)[0]).toBe('A title in 2026 on the résumé.');
expect(notes(titleGameLoss)[0]).toBe('One win from a title in 2027.');
expect(notes(threeStraight)[0]).toBe('Three straight playoff trips.');
expect(notes(publicWarningThisYear)[0]).toBe(`Starts ${l.season} under pressure from ownership.`);
expect(notes(anyone).length).toBeLessThanOrEqual(2);
expect(notes(longTenure)[1]).toBe('In his fifth year in Miami.');
```

  The existing `toHaveLength(1)` test at line ~230 becomes `≤ 2`.
- [ ] **Step 2: Run** `npx vitest run src/ui/gm.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the order from the spec §5 (between jobs → titles → deep runs → hot seat → existing
  lines → fallback). "Title then a slide" applies when every season after the title is under .500; "since" sums those
  seasons' regular records. Second line: tenure (`In his {ordinal} year in {city}.`) when in a job 3+ seasons, else the
  best season (`Best year: 15–2 in 2028.`) when it's a winning season and not already the lead's subject; else none.
  The user's GM keeps the current lines.
- [ ] **Step 4: Run** the file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "GM public perception: between jobs, champions, hot seat".

### Task 7: Docs and version

**Files:**
- Modify: `docs/NEWS.md`, `package.json` (0.1.17 → 0.1.18), `src/ui/changelog.ts` if it lists versions

- [ ] **Step 1:** `docs/NEWS.md`: add the offseason digest (grouping, ids, no duplicates), the one owner letter, the
  extension offer, and the outlet badges, in the style of the existing rules.
- [ ] **Step 2:** Bump the version; add a changelog entry if `changelog.ts` has one per version.
- [ ] **Step 3: Run** `npm run format && npm run typecheck && npx vitest run src/engine/leadership.test.ts
  src/engine/inbox.test.ts src/ui/mail.test.tsx src/ui/gm.test.tsx src/ui/ui.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** "Offseason mail diet: docs and 0.1.18", push, then read CI on the PR and fix anything red.
