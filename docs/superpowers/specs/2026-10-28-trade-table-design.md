# Trade table rework: a deal slip and a picker

**Goal:** the trade table is too much to scan: two long checkbox lists (fourteen picks and fifty-odd players a side).
Replace them with a compact **deal slip** that shows the deal, and a **picker** that adds to it, opening on the
players that fit.

**Decided with the owner (2026-10-28):** the pain is scanning (not pricing, not the start point); approach: deal slip +
picker; the picker opens on a **Fits** chip; it rides in the same PR as the trade desk (one 0.2.13). Draft-day trades
(`docs/TRADES.md` Phase 4) are **not** in this change: they get their own spec next, since they change the AI.

## What doesn't change

The engine and every sim number: `evaluateTrade`, `proposeTrade`, `counterOffer`, `suggestSweetener`, cap impact,
eat-salary. The table's deal state (`Picked` for each side, `partnerId`, `counterTo`) and `tradeDesk.put` stay as they
are, so counters, "Ask their price" and the Market's "Open table" keep working. The partner card from the trade desk
spec stays.

## Layout (`TradeTable` in `src/ui/screens/Trades.tsx`)

1. **Partner card** (unchanged): team, GM, stance, wants, shopping, talks; `TeamPicker` in the action slot.
2. **Deal slip** (`DealSlip`): two columns, **You send** and **You get**; one column each on a phone, You send first.
   - Each item is one line with a remove button (×, labelled "Remove <name>"):
     - a player: position, `PlayerLink short`, `Ovr`, cap hit;
     - a pick: `pickLabel` ("2027 round 3 (proj. No. 82)").
   - An empty side reads "Add from the picker below."
   - Under the columns, as today: the "their view" meter and mood, the cap line, the live `StaffStrip`, the eat-salary
     control (`KeepPaying`) for players you send, their retained salary note, and Propose · What would make it work? ·
     Clear.
3. **Picker** (`AssetPicker`):
   - A seg **Your players / Their players** (default: Their players).
   - A chip row (a `seg`): **Fits** (default), each position `QB … P` that side has a player at, **Picks**.
   - A name search box (`aria-label="Search players"`); typing searches the whole side whatever the chip, by first or
     last name, case-insensitive.
   - Player rows (a list with a `SortSeg`: Position, OVR, Cap hit, as the asset lists sort today): `PlayerLink` with
     avatar, position, age, `Ovr`, cap hit, "thru <year>" or "practice squad" (no contract), and **Add** (or
     **Added ✓**, which removes it again). A player `playerTradeBlocker` refuses shows the reason, muted, and no button.
   - **Picks** shows that side's unused picks as a grid: a row per season, a button per round (`2027` · `R1 … R7`,
     a pick held twice shows twice, titled with `pickLabel`), pressed when in the deal.
   - Fits on their side lists their players first, then yours on Your players; switching team clears the picker's
     search and keeps the chip.

## What "Fits" lists (`pickerFits` in `src/engine/trade/desk.ts`)

`pickerFits(league: League, ctx: TradeContext, partnerId: number, side: 'yours' | 'theirs'): Player[]`, at most 8,
your view only, never a player `playerTradeBlocker` refuses:

- **Theirs:** the players they're said to be shopping this league year (`shopping` rumors naming them, still on their
  roster), then for each of **your** needs on your scouts' read (`scoutedNeeds(ctx, userTeamId, yourTeam)`, most urgent
  first) their best two at that position by your read (`ctx.view(userTeamId, p).ovr`). No duplicates.
- **Yours:** for each need of **theirs** on your read (`scoutedNeeds(ctx, userTeamId, partner)`), your best three at
  that position by your read.
- Empty when nothing qualifies: the picker then reads "Nothing stands out: pick a position."

`shoppingOf` moves from `src/ui/offers.tsx` into `desk.ts` (engine) so `pickerFits` can use it; `offers.tsx` imports it.

## Fog of war

As the trade desk: `Ovr`, `PlayerLink`, `pickLabel`, public rumors, `scoutedNeeds` on your read. No ratings, values,
trust or talks counts.

## Files

- `src/ui/screens/Trades.tsx`: `DealSlip`, `AssetPicker` replace the two `AssetList`s (removed); `TradeTable` wires
  them.
- `src/engine/trade/desk.ts`: `pickerFits`, `shoppingOf` (moved).
- `src/ui/offers.tsx`: imports `shoppingOf` from the engine.
- `src/styles.css`: `.deal-slip`, `.picker`, `.picker-row`, `.pick-grid`.
- `src/ui/changelog.ts`: the 0.2.13 entry gains a sentence on the slip and picker (no new version).

## Testing

- `desk.test.ts`: `pickerFits` lists their shopped players first; your side follows their wants; a blocked player
  (practice squad, IR) is never listed; empty when there are no needs and no rumors.
- `ui/trades.test.tsx`:
  - the slip lists a ticked player and pick, each with a remove button; an empty side says "Add from the picker below";
  - the picker on Fits lists `pickerFits`' players; a position chip lists that position; search finds a player by last
    name across positions; the Picks chip lists that side's picks;
  - a practice squad player in the picker shows "Practice squad players cannot be traded." and no Add button (the
    0.2.12 regression test, moved from `AssetList`);
  - a deal put on `tradeDesk` (as a counter does) shows in the slip.
- Locally: `npm run typecheck` and the touched tests. Screenshots (desktop and 390px) with the owner's save before the
  PR.
