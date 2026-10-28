# Trade Table Rework (Deal Slip + Picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the trade table's two long checkbox lists with a deal slip (the deal, with remove buttons) and a
picker (Fits / position / Picks chips and a search) that adds to it.

**Architecture:** one pure engine helper (`pickerFits`, with `shoppingOf` moved beside it in `trade/desk.ts`) and two
React components in `src/ui/screens/Trades.tsx` (`DealSlip`, `AssetPicker`) that read and write the table's existing
`Picked` state. Nothing else in `TradeTable` changes.

**Tech Stack:** TypeScript, React 19, Vitest with `renderToStaticMarkup`, `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-10-28-trade-table-design.md`

## Global Constraints

- Ships in the same PR as the trade desk, version stays **0.2.13**; the changelog entry gains a sentence.
- No engine decision changes: `evaluateTrade`, `proposeTrade`, `counterOffer`, `suggestSweetener`, `KeepPaying`,
  `tradeDesk` untouched.
- Fog of war: `Ovr`, `PlayerLink`, `pickLabel`, rumors and `scoutedNeeds` on your read only.
- `pickerFits` returns at most 8 players and never one `playerTradeBlocker` refuses.
- Copy, exactly: "Add from the picker below.", "Nothing stands out: pick a position.", "Add", "Added ✓",
  "Your players", "Their players", "Fits", "Picks", remove button label "Remove <first> <last>" (picks: "Remove
  <pickLabel>").
- Locally: `npm run typecheck`, the touched tests, `npm run format`. Never `npm run check`.

## Review Focus

1. **A team with no picks left or no tradable players on a chip**: the picker shows an empty-state line, not a blank
   box. Test in Task 3.
2. **A deal handed over by a counter or "Ask their price"** lands in the slip (the `tradeDesk` wiring is untouched;
   `DealSlip` renders whatever `Picked` it is given). Test in Task 2; checked live in Task 4's screenshots.
3. **Switching partner** clears their side and the search, keeps the chip. Checked live in Task 4.
4. **A player who leaves mid-deal** (released, traded elsewhere): `TradeTable`'s existing `valid()` drops him before
   the slip renders. No new code; covered by the existing filter.
5. **A 390px phone**: slip columns stack, picker rows stay one line, the pick grid wraps. Task 4 screenshots.

---

### Task 1: What fits (`pickerFits`), and `shoppingOf` into the engine

**Files:**

- Modify: `src/engine/trade/desk.ts` (add `shoppingOf`, `pickerFits`), `src/engine/trade/index.ts` (export both)
- Modify: `src/ui/offers.tsx` (delete its `shoppingOf`, import from `../engine/trade`), `src/ui/screens/Trades.tsx`
  (import `shoppingOf` from the engine)
- Test: `src/engine/trade/desk.test.ts` (extend)

**Interfaces:**

- Produces:
  - `shoppingOf(league: League, teamId: number): Player[]` (same behaviour as today's UI copy).
  - `pickerFits(league: League, ctx: TradeContext, partnerId: number, side: 'yours' | 'theirs'): Player[]`.

- [ ] **Step 1: Write the failing tests** in `desk.test.ts` (`describe('what fits')`), on
      `createLeague({ seed: 'fits-0', personnel: true })` with `l.market = emptyMarket()` and `updateStances`:
  - `pickerFits(l, ctx, rival.id, 'theirs')[0]` is the player named by a `shopping` rumor you push
    (`{ id: 'x', season: l.season, phase: l.phase, week: l.week, kind: 'shopping', teamIds: [rival.id], playerId, text: '' }`).
  - every player in `pickerFits(l, ctx, rival.id, 'yours')` is at a position in
    `scoutedNeeds(ctx, l.userTeamId, rival).needs`, belongs to you, and the list has at most 8.
  - no player in either list has a `playerTradeBlocker` (put a practice-squad player of the rival in a shopping rumor:
    he is left out).
  - with `scoutedNeeds` stubbed empty (override `ctx.view` so every player reads 20, so no upgrade needs; and no
    rumors), `pickerFits(..., 'yours')` is `[]`.
- [ ] **Step 2: Run** `npx vitest run src/engine/trade/desk.test.ts`. Expected: FAIL (`pickerFits` not exported).
- [ ] **Step 3: Implement** per the spec's "What Fits lists": theirs = shopped (via `shoppingOf`), then for each of
      your needs (`scoutedNeeds(ctx, userTeamId, league.teams[userTeamId]).needs`) their two best at that position by
      `ctx.view(userTeamId, p).ovr` from `rosterOf(ctx, partnerId)`; yours = for each of their needs your three best
      from `rosterOf(ctx, userTeamId)`; filter `!playerTradeBlocker(league, p)`, dedupe, `slice(0, 8)`. Move
      `shoppingOf` verbatim.
- [ ] **Step 4: Run** `npx vitest run src/engine/trade/desk.test.ts src/ui/trades.test.tsx && npm run typecheck`.
      Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: what fits a deal with a club (pickerFits); shoppingOf moves into the engine"`.

### Task 2: The deal slip

**Files:**

- Modify: `src/ui/screens/Trades.tsx` (add `DealSlip`)
- Test: `src/ui/trades.test.tsx`

**Interfaces:**

- Produces: `DealSlip({ league: League; teamId: number; picked: Picked; onChange: (p: Picked) => void; label: string })`:
  one column (`<div className="deal-side">` with `<h3>{label}</h3>`), exported for the test. `TradeTable` renders two
  inside `<div className="deal-slip">` ("You send" with `teamId=userId`, "You get" with `partnerId`).

- [ ] **Step 1: Write the failing test**: a slip with one player and one pick lists `p.lastName` and
      `pickLabel(l, pick)`, and has buttons labelled `Remove ${p.firstName} ${p.lastName}` and
      `Remove ${pickLabel(l, pick)}`; an empty `Picked` renders "Add from the picker below.".
- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL (`DealSlip` not exported).
- [ ] **Step 3: Implement** `DealSlip`: players first (`p.position`, `PlayerLink short`, `Ovr`, cap hit or
      "practice squad"), then picks (`pickLabel`), each with a ghost `btn-sm` "×" (`aria-label` as above) that calls
      `onChange` with the item removed (the `toggle` helper). In `TradeTable`, put the `.deal-slip` above the verdict
      block; `KeepPaying` stays under "You send", the retained-salary note under "You get".
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the deal slip"`.

### Task 3: The picker, in place of the asset lists

**Files:**

- Modify: `src/ui/screens/Trades.tsx` (add `AssetPicker`, delete `AssetList`, wire into `TradeTable`)
- Test: `src/ui/trades.test.tsx` (the 0.2.12 `AssetList` test moves onto `AssetPicker`)

**Interfaces:**

- Consumes: `pickerFits`, `shoppingOf` (Task 1), `DealSlip`'s `Picked` state (Task 2), `playerTradeBlocker`,
  `listSortValue`, `LIST_SORT_OPTIONS`, `SortSeg`, `useSort`, `tradeContext`.
- Produces: `AssetPicker({ league; partnerId; mine: Picked; theirs: Picked; onMine; onTheirs; start?: { side?: 'yours' | 'theirs'; chip?: Chip; query?: string } })`,
  exported; `type Chip = 'fits' | Position | 'picks'`. `start` seeds the state (tests and nothing else use it).

- [ ] **Step 1: Write the failing tests** (`describe('the picker')`, personnel league, `emptyMarket`,
      `updateStances`):
  - Fits on their side lists exactly `pickerFits(l, tradeContext(l), rival.id, 'theirs')` (each last name present);
    with nothing fitting it reads "Nothing stands out: pick a position.".
  - `start={{ chip: 'K' }}` lists their kickers and no QB.
  - `start={{ query: someOtherPositionPlayer.lastName.toLowerCase(), chip: 'K' }}` finds him anyway.
  - `start={{ chip: 'picks' }}` renders a button per unused pick of theirs (count `button` titles equal to
    `pickLabel` of each).
  - `start={{ side: 'yours', chip: squad.position }}` with one of your practice-squad players shows
    "Practice squad players cannot be traded." and no "Add" on his row (the 0.2.12 regression).
  - a player already in `theirs` reads "Added ✓".
- [ ] **Step 2: Run** `npx vitest run src/ui/trades.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `AssetPicker` per the spec's layout: side seg (default theirs), chip seg (Fits, the
      positions in `POSITIONS` order that side has a player at, Picks), search input, `SortSeg` (Position default),
      rows `.picker-row` (`PlayerLink avatar={26}`, pos, age, `Ovr`, cap hit, thru/practice squad, Add/Added ✓ or the
      blocker reason), Picks as `.pick-grid` (row per season, `aria-pressed` buttons "R<round>" titled `pickLabel`).
      Search ignores the chip and matches `firstName` or `lastName` case-insensitively. One `tradeContext` per render,
      `useMemo` keyed like `PartnerFacts`. Reset the query when `partnerId` changes. Delete `AssetList` and its
      `.asset-list` usage; replace the two `grid-2` asset columns in `TradeTable` with one `AssetPicker`.
- [ ] **Step 4: Run** `npx vitest run src/ui/trades.test.tsx src/ui/ui.test.ts && npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `"Trades: the picker (Fits, positions, picks, search) replaces the asset lists"`.

### Task 4: Styles, changelog, screenshots

**Files:**

- Modify: `src/styles.css` (trade desk block: `.deal-slip`, `.deal-side`, `.deal-item`, `.picker`, `.picker-row`,
  `.pick-grid`; remove `.asset-list` rules no longer used), `src/ui/changelog.ts` (0.2.13 text)

- [ ] **Step 1:** CSS: `.deal-slip` two columns (`grid-template-columns: 1fr 1fr`, one column under 600px),
      `.deal-item` a one-line flex row with the × at the end; `.picker-row` a one-line grid (name, pos, age, OVR, cap,
      thru, action) that drops age and thru under 600px; `.pick-grid` rows of small buttons that wrap. Grep
      `asset-list|asset-name|\.asset\b` in `src/` and delete the rules nothing uses.
- [ ] **Step 2:** Changelog 0.2.13: add "The trade table is a deal slip: you add players and picks from a picker
      that opens on the ones that fit, filter by position or search by name, and remove anything with one tap." 
- [ ] **Step 3: Run** `npm run format && npm run typecheck && npx vitest run src/ui src/engine/trade/desk.test.ts`.
      Expected: PASS.
- [ ] **Step 4: Screenshots** with the owner's save (Playwright, `npm run dev`), desktop 1280 and phone 390: the
      table opened from an offer's Counter (slip pre-filled), the picker on Fits, on a position, on Picks; switch
      partner once and confirm their side and search cleared. Send to the owner, wait for a yes.
- [ ] **Step 5: Commit and push** `"Trade table: deal slip and picker"`; then open the one PR for 0.2.13 (template:
      What changed / Why / `npm run check`) and watch CI.
