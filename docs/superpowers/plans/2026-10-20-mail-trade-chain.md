# Mail and Trade-Chain Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saying yes to an AI team's trade call never reads as a decline. Every offer mail tells you how it ended, and mail text links teams and players consistently.

**Architecture:** Two PRs on `claude/gallant-meitner-m9pxr0`. **PR A** (Tasks 1–5) fixes the engine's offer lifecycle in
`src/engine/trade/offers.ts`. It gives `TradeOffer` a new `'answered'` status and a stored `outcome` line, and links offers in a chain through the existing `replyTo` field. The offer card and its mail thread then show that chain. **PR B** (Tasks 6–9) is UI only: team links in mail text, `about` for every player in an offer, a flex-schedule card, and leaner offer text.

**Tech Stack:** TypeScript, React 19, Vitest, Vite, Playwright (screenshots only, from the scratchpad, never committed).

**Spec:** The audit and design agreed in this session (no spec file). Findings, reproduced in the dev build at seed `shots`, team 0:
1. "Make me an offer" sets the enquiry to `'declined'` (`offers.ts:586`), and about 60% of the time no bid follows (`bidFor` returns null).
2. About 7% of new bids fail on first Accept with "pulled the offer", because values drift between `aiTrades` and the end of `playWeek`.
3. A counter marks the original `'declined'`. Withdrawals, lapses and physical failures leave no lasting record.
4. Team names are never linked in mail text. Players who share a name stay plain. `flex` mail has no card. An offer that has been pruned from `market.offers` renders no card at all.
5. The offer body's "(proj. No. 51)" goes stale against the live card's "(proj. No. 54)". The result note in the offer card looks indented (a `.callout` with no background).

## Global Constraints

- Engine: no `Math.random`, no DOM. Comments explain *why*. Small pure functions.
- `League` stays plain JSON. A shape change bumps `SAVE_VERSION` (33 → 34) in `src/engine/generate.ts` and adds a step in `src/engine/migrate.ts`: `if (league.version < 34) league.version = 34; // v34: …`.
- Screens never render `player.ratings`, `playerOvr` or `player.potential`.
- Voices: an AI GM writes in the first person plural ("We've…"). The status line on the card is neutral, in the second person ("You…").
- `npm run format` before each commit. `npm run typecheck` plus the touched test files. `npm run trades` once, at the end of PR A (it must show nothing flagged). Never loosen a check's range.
- Version: PR A bumps `package.json` 0.1.0 → 0.1.1, PR B → 0.1.2 (fixes bump the last number, per CLAUDE.md). No `docs/MVP.md` change (item 13 is already Done).
- Commits end with the session's attribution lines.

## Review Focus

1. **An offer gone from `market.offers`** (pruned after `KEEP_RESOLVED` = 60): the mail still opens with a readable stub, never a blank or a crash. Test in Task 7.
2. **An enquiry answered when no bid exists:** the enquiry reads as answered, with "They couldn't make the numbers work", never as declined. Test in Task 1.
3. **An old save** whose offers carry `'declined'` from an enquiry answer loads and renders: no crash, and the old wording is acceptable. Test in Task 3.
4. **A team name inside a longer word or a player's name** (city "Kansas City" and a player named "Kansas"): only whole team names link, and a player's link wins over a team's. Test in Task 6.
5. **A counter chain three deep:** every mail in it folds into one thread, and each card points to the next. Test in Task 4.

---

## PR A — the trade chain

### Task 1: An enquiry you answer "Make me an offer" is answered, not declined

**Files:**
- Modify: `src/engine/types.ts:642-663` (`TradeOffer`)
- Modify: `src/engine/trade/offers.ts:249-263` (`enquiry`), `:582-598` (`answerEnquiry`)
- Modify: `src/engine/generate.ts:29`, `src/engine/migrate.ts:64`
- Test: `src/engine/trade/offers.test.ts`

**Interfaces:**
- Produces: `TradeOffer.status` gains `'answered'`. New optional `TradeOffer.outcome?: string`, the one line the card shows once it is resolved. `answerEnquiry(league, id, answer): { offer: TradeOffer | null; message: string }` (the return type changes; the only UI caller is `src/ui/offers.tsx:287-297`). A bid filed from an enquiry has `replyTo = enquiry.id`.

- [ ] **Step 1: Write the failing tests** in `describe('offers to you')`:

```ts
it('treats "Make me an offer" as an answer, and the bid replies to the enquiry', () => {
  const l = fresh();
  let enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
  for (let w = 0; w < 6 && !enquiry; w++) {
    playWeek(l);
    enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
  }
  if (!enquiry) return;
  const { offer: bid, message } = answerEnquiry(l, enquiry.id, 'offer');
  expect(enquiry.status).toBe('answered');
  expect(enquiry.outcome).toBe(message);
  expect(bid).not.toBeNull(); // Task 1 step 3: enquiries are only made when a bid exists
  expect(bid!.replyTo).toBe(enquiry.id);
  expect(bid!.status).toBe('pending');
});

it('only asks about a player it could bid for', () => {
  const l = fresh();
  for (let w = 0; w < 8; w++) {
    for (const e of openOffers(l).filter((o) => o.kind === 'enquiry')) {
      const p = l.players[e.sides[1].players[0]];
      expect(bidFor(tradeContext(l), l.teams[e.teamId], p)).not.toBeNull();
    }
    playWeek(l);
  }
});
```

Also update `'stops a team asking after "Not for sale"'` to read `answerEnquiry(...).offer`, and assert `enquiry.status === 'declined'` with an `outcome` matching `/not for sale/i`. Add `bidFor` to the `'.'` import (export it from `src/engine/trade/index.ts` if it isn't already).

- [ ] **Step 2: Run** `npx vitest run src/engine/trade/offers.test.ts`. Expected: the new tests FAIL (status `'declined'`, no `replyTo`).

- [ ] **Step 3: Implement.**
  - `enquiry(ctx, market, team, player)` returns null unless `bidFor(ctx, team, player)` is non-null. A team says it's interested only if it has a number in mind.
  - `answerEnquiry`, for `'notForSale'`: `status = 'declined'`, `outcome = "You told them he's not for sale."`, return `{ offer: null, message: outcome }`.
  - `answerEnquiry`, for `'offer'`: `status = 'answered'`. File the bid as now. If filed, set `bid.replyTo = offer.id` and `outcome = "You asked for an offer: the ${team.name} came back with one."`. If not, `outcome = "You asked for an offer, but the ${team.name} couldn't make the numbers work."`. Return `{ offer: bid, message: outcome }`.
  - In `expireOffers`'s `resolved` filter, `'answered'` counts as resolved. That already holds, since it isn't `'pending'`.
  - Bump `SAVE_VERSION` to 34. Add to migrate: `if (league.version < 34) league.version = 34; // v34: offers may be 'answered' and carry an optional \`outcome\` line, nothing to fill in`.

- [ ] **Step 4: Run** `npx vitest run src/engine/trade/offers.test.ts src/engine/inbox.test.ts` and `npm run typecheck`. Expected: PASS. Typecheck flags `src/ui/offers.tsx`'s `void answerEnquiry` only if its type changed. Leave the UI call as is until Task 3.

- [ ] **Step 5: Commit** `fix(trade): answering an enquiry is an answer, not a decline`.

### Task 2: Every resolved offer keeps the reason it ended

**Files:**
- Modify: `src/engine/trade/offers.ts`: `expireOffers` (:342), `acceptOffer` (:391-438), `resolveExam`'s `off()` (~:541-568), `declineOffer` (:570), `counterOffer` (:611-666)
- Modify: `src/engine/league.ts:110-125` (`playWeek`)
- Test: `src/engine/trade/offers.test.ts`

**Interfaces:**
- Consumes: `TradeOffer.outcome` (Task 1).
- Produces: `recheckOffers(league: League): void`, exported from `offers.ts` and `trade/index.ts`. Every status change away from `'pending'` sets `outcome`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('never shows you an offer its own team would already refuse', () => {
  for (const seed of ['trades-0', 'trades-1', 'trades-2']) {
    const l = createLeague({ seed });
    for (let w = 0; w < 9; w++) {
      playWeek(l);
      const ctx = tradeContext(l);
      for (const o of packaged(l))
        expect(judge(ctx, o.teamId, { sides: o.sides }, { rosterCuts: true }).accepts).toBe(true);
    }
  }
});

it('says why every offer ended', () => {
  const l = fresh();
  const [a, b] = packaged(l);
  declineOffer(l, a.id);
  expect(a.outcome).toMatch(/turned/i);
  playWeek(l);
  if (b) expect(b.outcome).toMatch(/lapsed/i);
  for (const o of l.market!.offers.filter((x) => x.status !== 'pending')) expect(o.outcome).toBeTruthy();
});

it('a counter leaves the original pointing at the reply', () => {
  // reuse the setup of 'runs out of patience' to get a 'countered' result
  // assert: original.status === 'answered', original.outcome matches /countered/i,
  // result.offer!.replyTo === original.id
});
```

Fill in the third test from the existing `'runs out of patience…'` test's setup (`offers.test.ts:104-122`). If the result is `'walked'`, assert that `original.status === 'declined'` and its `outcome` matches `/walked away/i`.

- [ ] **Step 2: Run** `npx vitest run src/engine/trade/offers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, with these exact lines:
  - `expireOffers`: `outcome = league.phase === 'regular' ? \`It lapsed when you played week ${league.week}.\` : 'It lapsed when you moved on.'`. This is the same week the card's "Open until you play week N" promised. `expireOffers` runs first in `playWeek`, before `league.week` moves.
  - `declineOffer`: `"You turned it down."`
  - `acceptOffer`: on window expiry, outcome = the window message. On `!stillThere`, use the existing message. On the judge failing: `his.problem ?? \`The ${ai.name} re-ran the numbers and pulled the offer.\``. On success, set it from `finish`'s `message` (look `offerId` up inside `finish`/`settle`, where the status becomes `'accepted'`).
  - `resolveExam`'s `off(msg)`: `outcome = msg`.
  - `counterOffer`: when a counter is filed, set the original `status = 'answered'` and `outcome = "You countered: they've come back with an answer."`. When he walks: `status = 'declined'` and `outcome = \`You countered and the ${ai.name} walked away.\``. When accepted: `'accepted'` with the existing message.
  - `recheckOffers(league)`: for each pending non-enquiry offer, re-run `judge(ctx, o.teamId, { sides: o.sides }, { rosterCuts: true })`. If it no longer accepts, set `status = 'withdrawn'` and `outcome = 'They pulled it before it reached you.'`. Call it in `playWeek` right after `developWeek` (inside the `regular` block). The offseason needs no call: there, `marketMoment` already runs after development in each step.
  - Comment above `recheckOffers`: an offer withdrawn here never reaches the inbox, because `offerMail` files only `'pending'` offers and `deliverMail` runs after `store.mutate`.

- [ ] **Step 4: Run** `npx vitest run src/engine/trade/` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `fix(trade): drop offers their team would refuse, and keep why each one ended`.

### Task 3: The offer card shows the outcome and links to the reply

**Files:**
- Modify: `src/ui/offers.tsx:170-305` (`OfferCard`)
- Modify: `src/styles.css` (only if a new class is needed; prefer the existing `callout-good` / `callout-bad`)
- Test: create `src/ui/mail.test.tsx` (render with `renderToStaticMarkup`, as `src/ui/avatar.test.tsx` does; no provider is needed, because `useNav()` returns null and is only called inside click handlers)

**Interfaces:**
- Consumes: `answerEnquiry(...): { offer; message }` and `TradeOffer.outcome` (Tasks 1–2). `replyTo`.
- Produces: `replyOf(league: League, offer: TradeOffer): TradeOffer | undefined`, exported from `src/engine/trade/offers.ts`: the offer whose `replyTo === offer.id`.

- [ ] **Step 1: Write the failing test.** Render `OfferCard` for an `'answered'` enquiry that has a reply in `market.offers`. Expect the text `offer.outcome` and a button named `/see their offer/i`. Render it again for a `'declined'` enquiry with no `outcome` (an old save) and expect `/turned down|declined/i` with no crash.

- [ ] **Step 2: Run** `npx vitest run src/ui/mail.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The `when` line for a closed offer reads `offer.outcome ?? FALLBACK[offer.status]`. Fallbacks: `accepted: 'You accepted.'`, `declined: 'You turned it down.'`, `expired: 'It lapsed.'`, `withdrawn: 'They pulled it.'`, `answered: 'You answered.'`.
  - When `replyOf(league, offer)` exists, show a `btn btn-sm` "See their offer →". It navigates to `{ view: 'inbox', messageId: \`offer:${reply.season}:${reply.id}\` }`.
  - Enquiry buttons: keep `answerEnquiry`'s `message` in the existing `note` state.
  - The result `note`: `className={\`callout ${ok ? 'callout-good' : 'callout-bad'}\`}` (this fixes the "indented" look).

- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `fix(ui): offer cards say how they ended and link to the reply`.

### Task 4: One thread per trade conversation

**Files:**
- Modify: `src/engine/inbox.ts`: `offerMail` (:806), the `MailSubject` `offer` variant (:473), `mailSubject` (:529), `threadKey` (:1888), `threadLabel` (:1894)
- Test: `src/engine/inbox.test.ts`

**Interfaces:**
- Consumes: `replyTo` chains (Tasks 1–2).
- Produces: offer mail ids `offer:${season}:${id}:${rootId}` (the 4th segment is new; old ids without it still parse, with `root = offerId`). `MailSubject` offer: `{ kind: 'offer'; season; offerId; root: number }`.

- [ ] **Step 1: Write the failing test.** Build an enquiry → bid → counter chain as in Tasks 1–2, then call `deliverMail`. Expect `threads(l.inbox!)` to have exactly one thread whose messages are all of `kind: 'offer'`, and `threadLabel(thread).subject` to equal `` `${firstMessage.subject} (${n} messages)` ``. Also expect `mailSubject({ id: 'offer:2026:7', … })` to give `root: 7` (an old id).

- [ ] **Step 2: Run** `npx vitest run src/engine/inbox.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** In `offerMail`, find the root by walking `replyTo` through `market.offers` (stop at a missing id). `threadKey`: `kind === 'offer'` gives `offer:${season}:${root}`. `threadLabel`, `case 'offer'`: `{ from: lead.from, subject: \`${lead.subject} (${n} messages)\` }`. Keep the existing offer id test in `offers.test.ts:174-184` passing: look the message up by prefix `offer:${season}:${id}` (`startsWith`), or update it.

- [ ] **Step 4: Run** `npx vitest run src/engine/inbox.test.ts src/engine/trade/offers.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(inbox): a trade conversation folds into one thread`.

### Task 5: Verify PR A and open it

- [ ] **Step 1:** `npm run format && npm run typecheck && npx vitest run src/engine/trade src/engine/inbox.test.ts src/ui/mail.test.tsx`. Expected: all PASS.
- [ ] **Step 2:** `npm run trades`. Expected: nothing flagged. Fewer enquiries are expected (Task 1). If an "offers to you" volume range is missed, report it to the owner instead of loosening it.
- [ ] **Step 3:** Rerun the scratchpad screenshot scripts (`click.mjs` with `2 enquiry "Make me"` and `6 star Accept`). Confirm the enquiry reads "You asked for an offer…" with "See their offer →", and the thread folds.
- [ ] **Step 4:** Bump `package.json` to 0.1.1, commit, `git push -u origin claude/gallant-meitner-m9pxr0`, and open PR A (title: "Trade offers: a yes is never a decline, and every offer says how it ended"). Then read CI and fix anything red.

## PR B — mail polish

### Task 6: Team names link in all mail text

**Files:**
- Modify: `src/ui/moves.tsx` (`Who`, `Segments`, `nameIndex`)
- Test: `src/ui/ui.test.ts` (it already imports `linkedSegments` and `nameIndex`)

**Interfaces:**
- Produces: `Who` gains `{ kind: 'team'; id: number }`. `nameIndex` adds each team as `${city} ${name}` and as `name` alone (nicknames are unique). `Segments` calls `nav.openTeam(id)` for `team`.

- [ ] **Step 1: Write the failing test** with `linkedSegments(league, text)`:
  - `"We face the Denver Summit on the road"` gives one segment `{ text: 'Denver Summit', who: { kind: 'team', id } }` (the longest match wins over `Summit`).
  - `"The Scorpions ask about…"` links `Scorpions`.
  - A player named the same as a nickname links as the player, because people are added after teams and `set` overwrites. The test sets a player's name to equal a team nickname.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Teams go into the index first, so a person's name overrides.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS (fix any exhaustive `Who['kind']` switches the typecheck finds, e.g. `personOf`, which returns `undefined` for a team).
- [ ] **Step 5: Commit** `feat(ui): team names in mail link to their roster`.

### Task 7: Every player in an offer links, and a pruned offer still reads

**Files:**
- Modify: `src/ui/screens/Inbox.tsx:119-125` (`aboutOf`)
- Modify: `src/ui/mail.tsx:157-161` (`case 'offer'`)
- Test: `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: `aboutOf(league: League, m: InboxMessage): Who[]`. For `kind: 'offer'` it adds every player on both sides of the offer, when the offer is still in `market.offers`.

- [ ] **Step 1: Write the failing test.** Render `MailCards` for an offer message whose offer id is missing from `market.offers`. Expect the text `/no longer on file/i` and no throw.
- [ ] **Step 2: Run.** Expected: FAIL (it renders `null`).
- [ ] **Step 3: Implement.** For a missing offer, render `<Card><span className="muted small">This offer is closed and no longer on file.</span></Card>`. Update `aboutOf`'s two callers (`Inbox.tsx:458`, `:608`) to pass `league`.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ui): offer mail reads after the offer is gone, and links all its players`.

### Task 8: Flex mail gets the opponent card, and offer text drops stale projections

**Files:**
- Modify: `src/ui/mail.tsx` (`MailCards` switch: add `case 'flex'`)
- Modify: `src/engine/inbox.ts:754-761` (`packageWords`), `offerWords` (:764-800)
- Modify: `src/engine/trade/value.ts:171` (`pickLabel`)
- Test: `src/engine/inbox.test.ts`, `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: `pickLabel(league, pick, opts?: { projected?: boolean })`. With `projected: false` it omits the "(proj. No. N)" part; a made pick keeps "(No. N)". `packageWords(league, side, opts?: { projected?: boolean })` passes the option through. `offerWords` uses `{ projected: false }`. `FlexCards({ league, s })` renders `OpponentCard` for the flexed game.

- [ ] **Step 1: Write the failing tests.**
  - `offerWords(...).body` for a bid with an unmade pick does not match `/proj\. No\./`.
  - `MailCards` for a `flex:` message renders the opponent's team name as a button.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `FlexCards`: `const g = league.games.find((x) => x.id === s.gameId)`. If it is missing, return null. Otherwise show `<OpponentCard league={league} opp={opponent} game={g} />`.
- [ ] **Step 4: Run** the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(mail): flex mail shows the opponent; offer text leaves live projections to the card`.

### Task 9: Verify PR B and open it

- [ ] **Step 1:** `npm run format && npm run typecheck`, plus the touched tests. Expected: PASS.
- [ ] **Step 2:** Rerun `kinds.mjs` (mid and late) and `mobile.mjs` from the scratchpad. Check team names are linked in matchup, offer and flex bodies, at 1280 px and 390 px.
- [ ] **Step 3:** Bump `package.json` to 0.1.2, commit, push, open PR B, and read CI.
