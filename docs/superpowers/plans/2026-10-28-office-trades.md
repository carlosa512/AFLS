# Front Office Refresh, Part 1 (Office Kit + Trade Desk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a shared office kit (hero, facts, card row, pill) lifted from the draft room, and a Trades tab rebuilt on it:
a trade desk hero, offer cards with a staff strip, a partner card on the trade table, block cards, and a Market of GM
cards with wants on your scouts' read.

**Architecture:** three pure engine reads (`scoutedNeeds` in `trade/plans.ts`, `tone` + `staffTake` in
`trade/advice.ts`, `deskState` + `askedAbout` in the new `trade/desk.ts`) feed React components in `src/ui/office.tsx`
(new), `src/ui/offers.tsx` and `src/ui/screens/Trades.tsx`. No engine decision, sim number, save field or route
changes.

**Tech Stack:** TypeScript, React 19, Vitest (node environment, `renderToStaticMarkup` for UI tests), plain CSS in
`src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-10-28-office-trades-design.md`

## Global Constraints

- Fog of war: no `player.ratings`, `playerOvr`, `player.potential`, `player.ceilingShifts`, `teamRatings`, trust or
  talks counts, trade values or `league.market.interest` in any screen or in `desk.ts`. Players through `PlayerLink`,
  teams through `TeamLink`/`TeamChip`, GMs through `GmLink`, ratings through `Ovr`.
- `teamNeeds` output must not change (AI behaviour is untouched).
- Routes stay `#/office/trades/<offers|table|block|market|history>`.
- Stance words, exactly: contend → "Buying", bubble → "Listening", retool → "Selling veterans", rebuild → "Selling".
- `littleFilm` threshold: mean `ctx.view(viewerId, p).knowledge` over the team's starters `< 0.35`.
- Advice wording is unchanged (`mail.test.tsx` reads it); only `tone` is added.
- Version 0.2.12 → 0.2.13 (PATCH) with a `src/ui/changelog.ts` entry.
- Locally: `npm run typecheck` and the touched tests (`npx vitest run <file>`); `npm run format` before each commit.
  Never `npm run check`.

## Review Focus

1. **A league with no market yet** (`league.market` undefined: a brand-new league before its first moment): the hero,
   block cards and GM grid render with zeros and "Quiet so far", no throw. Test in Task 4 and Task 9.
2. **Practice squad and expiring players** (no contract, the 0.2.12 crash): the block cards list only players under
   contract, like `BlockPanel` today. Test in Task 8.
3. **A team with no starters at a position or no film at all** (injuries, a new league): `scoutedNeeds` returns a hole
   and `littleFilm: true`, not NaN. Test in Task 2.
4. **The playoffs and the offseason** (window closed, or open all offseason): the deadline fact reads "Reopens in the
   new league year" / "Week 9" + "open all offseason". Test in Task 4.
5. **A 390px phone**: hero facts wrap, the card row swipes, the GM grid is one column and rumors fall below it. Checked
   by the phone screenshots in Task 10.

---

### Task 1: The office kit, and the draft room onto it

**Files:**

- Create: `src/ui/office.tsx`
- Modify: `src/ui/screens/Draft.tsx:488-657` (`DraftClock`, `StaffTop5`)
- Modify: `src/styles.css:2588-2650` (draft room block → office kit block)
- Test: `src/ui/office.test.tsx` (new)

**Interfaces:**

- Produces (all exported from `src/ui/office.tsx`):
  - `OfficeHero({ eyebrow?: ReactNode; headline: ReactNode; team?: Team; urgent?: boolean; action?: ReactNode; children?: ReactNode }): JSX.Element`:
    a `Panel` with `className="office-hero"` (+ `" is-urgent"`), title = row of `TeamChip large` (when `team`) and a
    block with `<span className="eyebrow">` + `<h2>`; `action` into the panel's `action` slot.
  - `Facts({ children })`: `<div className="facts">`.
  - `Fact({ label: string; children: ReactNode; note?: ReactNode })`: `<span className="fact"><span className="eyebrow">{label}</span><b>{children}</b>{note && <span className="muted small"> {note}</span>}</span>`.
  - `CardRow({ children; label?: string })`: `<div className="card-row" aria-label={label}>`.
  - `OfficeCard({ children; className?: string })`: `<div className="office-card">`.
  - `type PillTone = 'good' | 'warn' | 'bad' | 'early' | 'inactive'`;
    `Pill({ tone?: PillTone; title?: string; className?: string; children })`: `<span className="tag-pill tag-<tone> …">`.

- [ ] **Step 1: Write the failing test** `src/ui/office.test.tsx`:

```tsx
describe('office kit', () => {
  it('draws an urgent hero with its eyebrow, headline and facts', () => {
    const html = renderToStaticMarkup(
      <OfficeHero eyebrow="Trade desk" headline="2 offers need an answer" urgent>
        <Facts>
          <Fact label="Offers waiting">2</Fact>
        </Facts>
      </OfficeHero>,
    );
    expect(html).toContain('office-hero is-urgent');
    expect(html).toContain('Trade desk');
    expect(html).toContain('2 offers need an answer');
    expect(html).toContain('<span class="eyebrow">Offers waiting</span>');
  });
  it('maps a pill tone to its class and leaves a plain pill plain', () => {
    expect(renderToStaticMarkup(<Pill tone="warn">Hole</Pill>)).toBe('<span class="tag-pill tag-warn">Hole</span>');
    expect(renderToStaticMarkup(<Pill>CB</Pill>)).toBe('<span class="tag-pill">CB</span>');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/office.test.tsx`. Expected: FAIL (cannot resolve `./office`).
- [ ] **Step 3: Implement `src/ui/office.tsx`** per the Interfaces block, with a header comment saying it is the Front
      Office's shared layout, lifted from the draft room.
- [ ] **Step 4: Move the draft room onto it.** `DraftClock`: the three `<Panel className="draft-clock" …>` become
      `OfficeHero` (`urgent={userUp}`, `team={team}` only on the clock, eyebrow "Round r · Pick n"), every
      `<span className="fact">` becomes `Fact`, the `.facts` div becomes `Facts`; the ticker stays a child. `StaffTop5`:
      `.prospect-cards` → `CardRow`, `.prospect-card` → `OfficeCard`. `GapPill`, `DraftDayPill`, `VerdictPill` keep
      their markup.
- [ ] **Step 5: Rename the CSS.** `.draft-clock.is-up` → `.office-hero.is-urgent`, `.draft-clock-head h2` →
      `.office-hero-head h2` (and the class in `OfficeHero`), `.prospect-cards` → `.card-row`, `.prospect-card` →
      `.office-card` (including the 600px media query and `.prospect-card .tag-pill`). Move these rules under a new
      `/* ───────── office kit ───────── */` heading above the draft room block. `.prospect-grade` stays.
- [ ] **Step 6: Run** `npx vitest run src/ui/office.test.tsx src/ui/ui.test.ts && npm run typecheck`. Expected: PASS;
      `grep -rn "draft-clock\|prospect-card" src` finds nothing.
- [ ] **Step 7: Commit** `git add -A && git commit -m "Office kit: hero, facts, card row and pill, lifted from the draft room"`.

### Task 2: Needs on your scouts' read

**Files:**

- Modify: `src/engine/trade/plans.ts:171-215` (`starterLine`, `teamNeeds`)
- Modify: `src/engine/trade/context.ts` (`TradeContext` gains `viewLines?: Map<number, Record<Position, number>>`)
- Modify: `src/engine/trade/index.ts` (export `scoutedNeeds`, `type ScoutedNeeds`)
- Test: `src/engine/trade/needs.test.ts` (new)

**Interfaces:**

- Produces:
  - `needsOn(league: League, roster: readonly Player[], line: Record<Position, number>, ovr: (p: Player) => number): Need[]`
    (module-private is fine; exported for the test).
  - `scoutedNeeds(ctx: TradeContext, viewerId: number, team: Team): { needs: Need[]; littleFilm: boolean }`.

- [ ] **Step 1: Write the failing tests** `needs.test.ts`:

```ts
it('needsOn with true ratings is teamNeeds, in season and in the offseason', () => {
  for (const l of [inSeason, offseason]) {
    const ctx = tradeContext(l);
    for (const t of l.teams)
      expect(needsOn(l, rosterOf(ctx, t.id), starterLine(ctx), (p) => ovrOf(ctx, p))).toEqual(teamNeeds(ctx, t));
  }
});
it("reads a rival's needs through your scouts, and flags a team they haven't seen", () => {
  const l = createLeague({ seed: 'needs-film' }); // no scouting visits yet
  const ctx = tradeContext(l);
  const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
  const read = scoutedNeeds(ctx, l.userTeamId, rival);
  expect(read.littleFilm).toBe(true);
  expect(read.needs.every((n) => Number.isFinite(n.urgency))).toBe(true);
  expect(scoutedNeeds(ctx, l.userTeamId, l.teams[l.userTeamId]).littleFilm).toBe(false);
});
it('calls an empty position a hole on any read', () => {
  const l = createLeague({ seed: 'needs-hole' });
  const rival = l.teams.find((t) => t.id !== l.userTeamId)!;
  for (const p of Object.values(l.players)) if (p.teamId === rival.id && p.position === 'K') p.teamId = null;
  const read = scoutedNeeds(tradeContext(l), l.userTeamId, rival);
  expect(read.needs.find((n) => n.position === 'K')?.reason).toBe('hole');
});
```

`inSeason` is a league after `playWeek` twice; `offseason` one after `simToEndOfSeason` and `beginOffseason` (both in
a `beforeAll`, as `offers.test.ts` builds its leagues). If `createLeague` already gives scouts some film on rivals,
pick the rival with the lowest mean knowledge for the first assertion.

- [ ] **Step 2: Run** `npx vitest run src/engine/trade/needs.test.ts`. Expected: FAIL (`needsOn` not exported).
- [ ] **Step 3: Implement.** Move `teamNeeds`'s loop into `needsOn` (same rules, same `NEED_WEIGHT`, same
      `lookAhead`), with `healthy` and `underContract` unchanged; `teamNeeds` calls it with `rosterOf(ctx, team.id)`,
      `starterLine(ctx)`, `(p) => ovrOf(ctx, p)` and keeps its memo. Split `starterLine` into
      `lineOn(league, rosters, ovr)` (the median-starter loop) so the viewer's line is the same computation;
      `scoutedNeeds` memoises it per viewer on `ctx.viewLines`. `littleFilm`: mean of
      `ctx.view(viewerId, p).knowledge` over `starters(league, team, pos)` for every position, `< 0.35`; a team with no
      starters counts as little film.
- [ ] **Step 4: Run** `npx vitest run src/engine/trade/needs.test.ts src/engine/trade/offers.test.ts && npm run typecheck`.
      Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Trades: a team's needs on your scouts' read (scoutedNeeds); teamNeeds unchanged"`
      (add the new test file first).

### Task 3: A tone on every staff line, and the staff's take

**Files:**

- Modify: `src/engine/trade/advice.ts`
- Modify: `src/engine/trade/index.ts` (export `staffTake`, `type StaffTake`, `type AdviceTone`)
- Test: `src/engine/trade/advice.test.ts` (new)

**Interfaces:**

- Produces:
  - `type AdviceTone = 'good' | 'warn' | 'bad' | 'note'`; `Advice` gains `tone: AdviceTone`.
  - `type StaffTake = 'likes' | 'split' | 'against'`; `staffTake(advice: readonly Advice[]): StaffTake`.

- [ ] **Step 1: Write the failing tests** `advice.test.ts`:

```ts
const line = (tone: AdviceTone): Advice => ({ who: 'coach', line: '', tone });
it('takes a side from the tones', () => {
  expect(staffTake([line('good'), line('note')])).toBe('likes');
  expect(staffTake([line('good'), line('warn')])).toBe('split');
  expect(staffTake([line('good'), line('good'), line('bad')])).toBe('split');
  expect(staffTake([line('good'), line('bad')])).toBe('against');
  expect(staffTake([line('note')])).toBe('split');
  expect(staffTake([])).toBe('split');
});
it('tones each line by what it says', () => {
  // A generated league: give away the user's best QB for nothing and take their best WR.
  const advice = dealAdvice(l, [theirs, yours]);
  expect(advice.find((a) => a.who === 'scouts')!.tone).toBe('note');
  expect(['good', 'note']).toContain(advice.find((a) => a.who === 'coach' && /would/.test(a.line))!.tone);
  expect(advice.find((a) => a.who === 'cap')!.tone).toMatch(/good|warn|bad/);
});
```

Add one case per tone-table row of the spec that a real deal can produce in a generated league: trading away the
user's only K yields the coach's "nobody behind" line with `tone: 'bad'`; a deal that leaves room `< 0` yields cap
`bad`.

- [ ] **Step 2: Run** `npx vitest run src/engine/trade/advice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the spec's tone table in `dealAdvice` (Medical: `injuryRisk(...).tier` `'Low'` → good,
      `'Medium'` → warn, `'High'` → bad) and `staffTake`: against when some `bad` and `good ≤ bad`; likes when no
      `bad`, no `warn` and some `good`; else split.
- [ ] **Step 4: Run** `npx vitest run src/engine/trade/advice.test.ts src/ui/mail.test.tsx && npm run typecheck`.
      Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: each staff line on a deal carries a tone, and the staff's take sums them"`.

### Task 4: The desk's state

**Files:**

- Create: `src/engine/trade/desk.ts`
- Modify: `src/engine/trade/index.ts` (export `deskState`, `askedAbout`, `type DeskState`, `type DeskHeadline`)
- Test: `src/engine/trade/desk.test.ts` (new)

**Interfaces:**

- Consumes: `openOffers`, `tradeWindow`, `isDeadlineDay`, `TRADE_DEADLINE_WEEK`, `isBuyer`.
- Produces:
  - `askedAbout(league: League): Map<number, number[]>`: AI team id → your player ids it asked for in this league
    year's offers to you (`league.market?.offers`, any status, `season === league.season`, the player ids on your side
    `sides[1].players` that are still yours).
  - `type DeskHeadline = 'exam' | 'offers' | 'deadlineDay' | 'closed' | 'quiet'`.
  - `interface DeskState { headline: DeskHeadline; text: string; urgent: boolean; deadline: { value: string; note?: string }; offers: number; listed: number; untouchable: number; asking: number }`.
  - `deskState(league: League): DeskState`.

- [ ] **Step 1: Write the failing tests** `desk.test.ts`:

```ts
it('puts a physical first, then offers, then deadline day, a closed window, and quiet', () => {
  expect(deskState(quiet).headline).toBe('quiet');
  expect(deskState(quiet).text).toMatch(/^No calls waiting · \d+ teams are buying$/);
  expect(deskState(withOffer).headline).toBe('offers');
  expect(deskState(withOffer).urgent).toBe(true);
  expect(deskState(withExamAndOffer).headline).toBe('exam');
  expect(deskState(deadlineDay).text).toBe('Deadline day: the window shuts when you advance.');
  expect(deskState(pastDeadline).headline).toBe('closed');
});
it('words the deadline for every part of the year', () => {
  expect(deskState(week7).deadline.value).toBe('Week 9 · 2 weeks away');
  expect(deskState(week9).deadline.value).toBe('This week');
  expect(deskState(deadlineDay).deadline.value).toBe('Today');
  expect(deskState(pastDeadline).deadline.value).toBe('Passed');
  expect(deskState(offseason).deadline).toEqual({ value: 'Week 9', note: 'open all offseason' });
  expect(deskState(playoffs).deadline.value).toBe('Reopens in the new league year');
});
it('counts teams asking from offers to you only', () => {
  expect(deskState(withOffer).asking).toBe(new Set(openOffers(withOffer).map((o) => o.teamId)).size);
  withOffer.market!.interest.push({ teamId: 3, playerId: anyOfYours, level: 3, at: withOffer.market!.moment });
  expect(deskState(withOffer).asking).toBe(/* unchanged */ askingBefore);
});
it('works before the market exists', () => {
  const l = createLeague({ seed: 'desk-new' });
  delete l.market;
  expect(deskState(l)).toMatchObject({ offers: 0, listed: 0, untouchable: 0, asking: 0 });
});
```

Build the leagues by setting `phase`/`week` on a generated league (`createLeague` + `stanceFor` already set by
`updateStances(tradeContext(l))`), pushing a hand-made pending `TradeOffer` into `l.market.offers` for `withOffer`, and
setting `l.market.exam` with one `{ playerId, result: 'concerns', note: '' }` exam for `withExamAndOffer`. Deadline day
is `phase: 'regular'`, `week: 10`, no week-10 results.

- [ ] **Step 2: Run** `npx vitest run src/engine/trade/desk.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `desk.ts`.** Headline texts, exactly:
      exam → `A physical flagged ${first name + last name of the first exam whose result isn't 'passed'}: your call.`;
      offers → `${n} offer${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} an answer.`;
      deadlineDay → `Deadline day: the window shuts when you advance.`; closed → `tradeWindow(league)`;
      quiet → `No calls waiting · ${buyers} teams are buying` (AI teams with `isBuyer`). `urgent` for exam and offers.
      `listed`/`untouchable` count `league.market.status` values for players still on your team; `asking` is
      `askedAbout(league).size`. Header comment: public signals only, never `market.interest`.
- [ ] **Step 4: Run** `npx vitest run src/engine/trade/desk.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the desk's state (headline, deadline, counts) from what your club can see"`.

### Task 5: The trade desk hero

**Files:**

- Modify: `src/ui/screens/Trades.tsx:164-197` (`Trades`)
- Test: `src/ui/trades.test.tsx` (extend)

**Interfaces:**

- Consumes: `deskState` (Task 4), `OfficeHero`, `Facts`, `Fact` (Task 1).
- Produces: `TradeDesk({ league: League }): JSX.Element` (exported for the test).

- [ ] **Step 1: Write the failing test** in `trades.test.tsx`:

```tsx
it('the desk hero says what needs you and the facts behind it', () => {
  const l = createLeague({ seed: 'desk-hero', personnel: true });
  const html = renderToStaticMarkup(<TradeDesk league={l} />);
  expect(html).toContain('office-hero');
  expect(html).toContain(deskState(l).text);
  for (const label of ['Deadline', 'Offers waiting', 'On your block', 'Untouchable', 'Teams asking about your players'])
    expect(html).toContain(label);
  expect(html).toContain('Build a trade');
});
```

`TradeDesk` uses `useNav`; if `renderToStaticMarkup` can't provide it, wrap the render in the nav provider the other UI
tests use, or render the primary button as a plain `<a href="#/office/trades/…">` styled `btn btn-primary`.

- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement `TradeDesk`**: `OfficeHero` eyebrow "Trade desk", headline `state.text`, `urgent`; action
      "Answer offers" (to `sub: 'offers'`) when `state.offers > 0`, else "Build a trade" (to `sub: 'table'`); `Facts`
      with Deadline (`value`, `note`), Offers waiting, On your block, Untouchable, Teams asking about your players.
      Render it in `Trades` above the view seg.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx src/ui/ui.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the trade desk hero"`.

### Task 6: Offer cards with the staff strip

**Files:**

- Modify: `src/ui/offers.tsx:204-383` (`OfferCard`), plus a new `StaffStrip`
- Test: `src/ui/trades.test.tsx` (extend)

**Interfaces:**

- Consumes: `staffTake`, `Advice.tone` (Task 3), `Pill` (Task 1).
- Produces: `StaffStrip({ league: League; advice: readonly Advice[] }): JSX.Element | null` (exported; Task 7 uses it).
  Speaker pill tones: good → `good`, warn → `warn`, bad → `bad`, note → none. Take pill: likes → `good` "Staff likes
  it", split → none "Split", against → `bad` "Staff against".

- [ ] **Step 1: Write the failing test**:

```tsx
it('the staff strip leads with the take and tones each voice', () => {
  const advice: Advice[] = [
    { who: 'coach', line: 'X would start for us at CB.', tone: 'good' },
    { who: 'cap', line: 'Cap room after: -$1.0M.', tone: 'bad' },
  ];
  const html = renderToStaticMarkup(<StaffStrip league={l} advice={advice} />);
  expect(html.indexOf('Staff against')).toBeLessThan(html.indexOf('Head coach'));
  expect(html).toContain('tag-pill tag-good">Head coach');
  expect(html).toContain('tag-pill tag-bad">Cap');
  expect(renderToStaticMarkup(<StaffStrip league={l} advice={[]} />)).toBe('');
});
```

Plus an `OfferCard` render on a hand-made pending bid in a generated league: contains the kind pill "Bid", the staff
take pill, and no `JSON` change to the league (stringify before and after).

- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `StaffStrip`: `<div className="staff-strip">` with the take pill, then one row per line:
      speaker `Pill` (`WHO[a.who]`) + `LinkedText`. `OfferCard`: the `Panel` gets `className="offer-card"`, the title row
      adds a kind pill (`reason`: bid → "Bid", pitch → "Pitch", dump → "Dump", enquiry → "Enquiry", shop → "Answering
      your shop", counter → "Counter") and the lapse text as a `Pill tone="early"`; the `plain-list` of advice becomes
      `StaffStrip`. Everything else in the card stays.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx src/ui/mail.test.tsx && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: offer cards lead with the call's kind and your staff's take"`.

### Task 7: The trade table's partner card and live staff take

**Files:**

- Modify: `src/ui/screens/Trades.tsx:199-426` (`TradeTable`)
- Modify: `src/ui/offers.tsx` (export `STANCE` and a `WantsPills` component, used again in Task 9)
- Modify: `src/engine/trade/index.ts` (add `talkRefusal` to the `./talks` export)
- Test: `src/ui/trades.test.tsx` (extend)

**Interfaces:**

- Consumes: `scoutedNeeds` (Task 2), `StaffStrip` (Task 6), `peekTalks`, `talkRefusal`, `ASKS`, `stanceOf`.
- Produces (in `offers.tsx`): `WantsPills({ league: League; team: Team }): JSX.Element` (at most 3 needs: `hole` →
  `Pill tone="warn"` "<POS> · hole", `upgrade` → plain "<POS>", `nextYear` → `Pill tone="early"` "<POS> · next year";
  "No pressing needs" when none; then `<span className="muted small">our scouts barely know them</span>` when
  `littleFilm`), built from `scoutedNeeds(tradeContext(league), league.userTeamId, team)`;
  `talksWords(league: League, teamId: number): string` ("Taking proposals"; "Nearly done talking this week" when
  `ASKS - asks === 1` for this moment; else the `talkRefusal` text when it refuses).

- [ ] **Step 1: Write the failing test**: render `WantsPills` for a rival in a generated league and assert it contains
      a `tag-pill` or "No pressing needs", and "our scouts barely know them" for a team with no film; `talksWords` is
      "Taking proposals" on a fresh market.
- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `TradeTable`'s `Panel` title, under the GM line, add a `.partner-facts` row: stance
      `Pill` (`STANCE[stanceOf(partner)]`), "Wants (our read)" + `WantsPills`, "Shopping" + up to three `PlayerLink`s
      from this league year's `shopping` rumors whose `teamIds[0] === partnerId` and whose player is still theirs, and
      `talksWords`. The `tradeContext(league)` for `WantsPills` is built once per render of the table (pass it down, or
      `useMemo` on `league` and the market moment). Beside the buttons in `.trade-verdict`, render `StaffStrip` over
      `dealAdvice(league, [{ teamId: partnerId, ...b }, { teamId: userId, ...a }])` when both sides have something.
      `TeamPicker`, the meter, the lists and the footnote stay.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx src/ui/ui.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the trade table's partner card (stance, wants on our read, shopping, talks) and staff take"`.

### Task 8: Block cards

**Files:**

- Modify: `src/ui/offers.tsx:434-495` (`BlockPanel`)
- Test: `src/ui/trades.test.tsx` (extend)

**Interfaces:**

- Consumes: `askedAbout` (Task 4), `CardRow`, `OfficeCard`, `Pill` (Task 1), `StatusPicker`.

- [ ] **Step 1: Write the failing test**: in a personnel league, `setTradeStatus` one contracted player to `'listed'`
      and one practice-squad player too (the setter may refuse; force `l.market.status[id] = 'listed'`); render
      `BlockPanel`; expect the listed contracted player in a `.office-card`, the squad player in no card, and "teams
      asking" text absent when nobody asked (no pill), present as "1 team asking" after pushing a pending offer that
      asks for him.
- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Above the existing list, when any of `players` (the same contracted, unexpired list) is
      listed or untouchable: a `CardRow` of `OfficeCard`s, listed first then untouchable, each with
      `PlayerLink avatar={28}`, position, `Ovr`, `StatusPicker`, Shop, and the asking `Pill` ("n team(s) asking",
      from `askedAbout`). The list below is unchanged.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: your block opens with cards for the players you've listed or locked"`.

### Task 9: Market as GM cards

**Files:**

- Modify: `src/ui/offers.tsx:497-539` (`MarketPanel`)
- Modify: `src/styles.css` (trade desk block: `.partner-facts`, `.staff-strip`, `.gm-grid`)
- Test: `src/ui/trades.test.tsx` (extend)

**Interfaces:**

- Consumes: `WantsPills`, `STANCE` (Task 7), `askedAbout` (Task 4), `tradeDesk.put`, `useNav`.

- [ ] **Step 1: Write the failing test**: render `MarketPanel` on a generated league with `updateStances` run; expect
      the four stance eyebrows that have teams, 31 `.office-card`s (one per AI team, none for yours), and "Quiet so
      far." when there are no rumors; with `delete l.market` it still renders.
- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `<div className="home-grid">`: `home-cell span-8` with a `Panel` "Front offices" holding,
      per stance in the order contend, bubble, retool, rebuild, an eyebrow `STANCE[mode]` and a `.gm-grid` of
      `OfficeCard`s (`TeamLink chip full`, `GmLink`, stance `Pill`, `WantsPills`, the latest `shopping` rumor's player
      for that team as "Shopping <PlayerLink>", "Asked about <PlayerLink>" from `askedAbout`, and an "Open table" button
      that calls `tradeDesk.put({ partnerId, mine: empty, theirs: empty })` then routes to `sub: 'table'`);
      `home-cell span-4` with today's "Around the league" panel. Remove "Who's dealing". One `tradeContext` per render
      for all 31 `WantsPills`. CSS: `.gm-grid` `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`, one
      column under 600px; `.staff-strip` a grid of rows with the take pill on top; `.partner-facts` a wrapping flex row.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx src/ui/ui.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the Market is every front office as a card, grouped by who's buying and selling"`.

### Task 10: Version, screenshots, PR

**Files:**

- Modify: `package.json` (`0.2.13`), `src/ui/changelog.ts` (entry on top)

- [ ] **Step 1:** Bump to 0.2.13 and add the changelog entry: title "The trade desk"; text in a player's words: the
      desk tells you what needs you, offers lead with your staff's take, the trade table shows what a team wants on
      your scouts' read and who it's shopping, your listed players sit on cards, and the Market is every front office
      on one page.
- [ ] **Step 2: Run** `npm run format && npm run typecheck && npx vitest run src/ui src/engine/trade/needs.test.ts src/engine/trade/advice.test.ts src/engine/trade/desk.test.ts`.
      Expected: PASS.
- [ ] **Step 3: Screenshots** with Playwright against `npm run dev` and the owner's backup
      (`/root/.claude/uploads/3b57725f-a673-5974-919a-d4df67add2e1/72df8c7c-afls-ten-2026-regular.json`): Offers (with
      an offer: advance a week or shop a player until one arrives), the table with a deal ticked, Your block with one
      player listed, Market, and the draft room's hero, each at 1280×900 and 390×844. Send them to the owner and wait
      for a yes.
- [ ] **Step 4: Commit and push** `"Trade desk 0.2.13"`, `git push -u origin claude/funny-sagan-kr0n4s`; open the PR
      (template: What changed / Why / `npm run check`), then watch CI and fix anything red.
