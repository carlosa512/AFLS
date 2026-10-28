# Draft-day trades

**Goal:** build `docs/TRADES.md` Phase 4 and section 6, "Draft day". Today nothing trades during the draft unless
you build it by hand on the trade table: AI teams never move up or down, and nobody calls you on the clock. After
this, AI front offices trade up and down for real NFL reasons, and teams call you when you're on the clock.

**Decided with the owner (2026-10-28):**
- **Covet inside `judge`:** approach A. Each side's covet (below) is turned into trade points and passed to the one
  evaluator. Rejected: B, a separate draft evaluator (it breaks "one evaluator" and the no-cheese read), and C,
  chart differences alone (far too few trades, and nobody trades up "for his guy").
- **On the clock:** a gold banner line in the clock hero, then the offers as the trade desk's `OfferCard`s in a
  row under it.
- **Shop this pick:** in the draft room only, while you're on the clock, once per pick.
- **Your trade-ups:** a **Call teams ahead** button in the clock hero while you're waiting on your next pick: the
  teams picking before you give their price. The trade table still works for anything else. Any proposal of yours
  for an AI team's pick in this draft is judged with that team's covet, so a team with its man on the board asks more.
- **Picking:** any pick (yours, Auto-pick, Sim the rest) lapses open offers on that pick quietly: no cooldown, no
  trust cost. Sims never make offers to you.
- **History:** "DEN via CHI" plus a **Draft-day trade** pill with the deal in one line.
- **NFL logic:** no trade "just to do it". Every trade-up and trade-down needs a reason a real front office would
  give (below), and the trades check reads those reasons against the NFL's draft-trade record.

## What doesn't change

- How a team picks a player (`aiDraftChoice`, `boardOf`, the consensus), the pick order, and the draft's random
  stream. Trades draw from their own stream, so a draft with no trades plays out exactly as today.
- The in-season and offseason market (`marketMoment`) and its numbers.
- MVP item 10 (trades) is already Done, so this is a PATCH bump (0.2.13 → 0.2.14) with a changelog entry.

## The NFL record it's built on

| Fact | Number | Source |
| --- | --- | --- |
| Trades during a draft | 41 in 2023 (a record); 128–148 picks change hands a year | `docs/TRADES.md`, NFL.com |
| First-round trades | about 5.5 a draft (2016–25); 6–18 first-round picks traded a draft | PFF, NFL.com |
| Where in round 1 | most in the last 10 picks: 46% of them traded at least once over five drafts | PFF, NFL.com |
| Jump size | most first-round moves are short and cheap, a spot or a few | Fox Sports |
| QB trade-ups | about 1 a draft into the top half of round 1; the mover overpaid in every pick-only QB deal | CBS, ESPN |
| Position | trade-up picks are at a premium position (QB, EDGE, OT, CB, WR) 38% of the time, against under 30% for teams that stay put | ESPN (Barnwell, 242 deals) |
| Price | pick-only trades in rounds 1–3 sit close to the Jimmy Johnson chart; movers pay at or above it | Windy City Gridiron (2019), ESPN |
| Who trades most | Chiefs, Rams, Vikings 5.8 draft deals a year, Eagles 5.6, Browns 5.2; league average 4.2 | NFL.com |
| Future picks | about 5–6 deals a year mix current- and future-year picks; a future 2nd ≈ a current 3rd | `docs/TRADES.md` |

## Engine: `src/engine/trade/draft.ts` (new)

### Covet

A team's covet for a prospect is how much better he is on its own board than the best player it expects to get by
staying where it is:

- `boardScore` without its noise term (a new `boardBase`, so the check is stable and costs no draws), from the
  team's own `BoardMemo` (`boardOf`: its scouts' read leaned on the consensus).
- "Expected at my pick": the best board score among available prospects whose consensus rank (among the available)
  is past the number of picks before its turn. Those are the ones likely still there.
- `covet = boardBase(target) − boardBase(expected at own pick)`, in board points.
- Turned into trade points as a share of the value of the pick it would give up: `covetPoints = pickValue(own pick)
  × clamp(covet / COVET_SCALE, 0, COVET_MAX)`. Tuned so the volumes below land in range.

### A trade-up needs a reason (all of these)

1. **Need or premium:** the target's position is one of the team's needs (from its own roster: fewer than
   `STARTERS + 1`, or its weakest starter below the target's grade), or a premium position (QB, EDGE, OT, CB, WR).
2. **Likely gone:** his consensus rank among the available is inside the picks before its turn, or the teams picking
   before it need his position (read from rosters any club can see: `positionDepth`), so a run is likely.
3. **A tier break:** covet clears `COVET_MIN`.
4. **Distance:** within the next 10 picks. A jump of more than 8 spots only for a QB, with a covet at least twice
   `COVET_MIN`.
5. **Limits:** at most 2 trade-ups a team per draft; never for a K or P before round 5 (`specialistPenalty`).
6. **It takes him:** a team that trades up drafts the player it moved up for (its pick skips `aiDraftChoice`).

### A trade-down needs a reason (one of these)

The team on the clock judges the offer with `judge` on its own chart, its covet counted as a cost (what it gives up
by passing on its man now). So it says yes when:
- **it sees a tier:** the player it expects at the later pick is close to its best now (small covet);
- **it runs a flat chart:** an analytics GM values the extra pick more;
- **it has many holes:** three or more urgent needs make a second pick worth more (a small need bonus on picks in);
- **it's a Pick Hoarder:** a little extra on picks in (`HOARDER_PICKS`), the archetype the doc names.

### The price

- The buyer offers its own pick plus the cheapest add-on that both `judge`s accept: a later pick in this draft
  first, then a future pick (next year's round one later, the NFL's "round a year"). A win-now GM (high
  `futureDiscount`) reaches for the future pick first, because it costs him least.
- `judge` reads covet itself in the `draft` phase (`draftCovet`): added to the buyer's `get` and to the seller's
  `give`. Nothing else in `judge` changes, so a draft deal goes through the same floors, margins and refusals as every
  other deal, whoever proposes it.

### When it runs

- `simDraft` builds one `TradeContext` per call and, before each AI pick, calls `draftCalls(ctx, pick, boards)`:
  1. candidates: AI teams in the next 10 picks, not the team on the clock and not you;
  2. each one's top target and covet (cached boards, no `judge` yet);
  3. the best 3 by covet get one try each; the first deal both sides accept closes (`executeTrade`, kind `draft`);
  4. then the pick is made by its owner: the team that traded up takes its man.
- Also before each pick, at a small rate: future-for-current swaps (`pickSwapFor`, opened to the `draft` phase:
  "our 2028 2nd for your 3rd now"). They count as kind `futureSwap`.
- Its own random stream: `${seed}:draft-trades:${season}:${overall}`.
- Draft deals don't count against a team's trade limits (`MINOR`).
- Cost: at most 3 trade checks a pick; boards come from the memo. Target: under 3 ms a pick.
- The AI never trades into your pick here. What it wants from you comes as offers (below).

### The news

`logTransaction` for each deal: "The Broncos trade up to No. 12 with the Bears (No. 18, No. 82) and take QB Jalen
Ellis." A trade record carries kind `draft` (`TAGS.draft = 'draft-day trade'`).

## Offers to you on the clock

- **When:** the draft stops at your pick (Next pick, Sim to my pick, or the draft opening on your pick). They're
  made once per pick (`market.clockPick`, the pick id they were made for); "Sim the rest" never makes any.
- **Who:** AI teams that pass rules 1–5 above for your slot. Each builds its offer: its pick plus the cheapest
  add-on its own `judge` accepts against you (with its small edge, `vsUser`), and never less than the league's going
  rate for your pick (`goingRate`). So you never see an insulting offer.
- **How many:** at most 2, one per team, the best for you first (at the league's prices). Reason `draft`, kind
  `draft`.
- **When they end:** when the pick is made, whoever makes it (`lapseUsedPicks`, below, inside `draftPlayer`): status
  `expired`, outcome "It lapsed when you picked." No cooldown, no trust cost.
- **Accept:** the usual `acceptOffer` (rechecked first). The pick moves; you're off the clock; the room shows the new
  team on the clock and your new pick in your list.
- **Counter:** the usual flow (the trade table, loaded). It still ends when the pick is made.
- **Inbox:** not mailed; they'd be dead before you read them. `offerMail` skips reason `draft`; the trade desk's
  history keeps their outcome lines.
- **Shop this pick:** `shopPick(league)`: every AI team that would trade up into your slot answers now; the best 3
  come back as cards (reason `shop`), skipping teams already offering. Once per pick (`market.shoppedPick`). If nobody
  bites: "Nobody wants to move up to No. 12."

## Your trade-ups

- **Call teams ahead:** `callAhead(league)`, while the draft is waiting on a pick before your next one. The AI teams
  holding the (at most 10) picks just before your next pick each give their price for their pick: your next pick plus
  the cheapest add-on of yours (a later pick this draft, then a future one) their `judge` accepts against you, their
  covet for that pick counted. The 3 cheapest for you (at the league's prices) come back as cards, reason `ask` ("Their
  price"). A team that can't make it work stays quiet. Once per pick on the clock (`market.calledAhead`, the overall
  it was used at). If none: "No one ahead of you will move their pick for what you have."
- **Any proposal for a pick this draft** (the trade table, a counter, an accepted ask) is judged with the AI side's
  covet for its own pick in this draft (`judge` reads `draftCovet` itself). A team with its man
  on the board asks more or says no; one in a tier deals.
- **Lapsing, in general:** `lapseUsedPicks(league)` runs inside `draftPlayer`. Any pending offer to you with a pick
  that has now been used (on either side) closes: status `expired`, outcome "It lapsed when the pick was made." (or
  "It lapsed when you picked." for your own), no cooldown, no trust cost.

## Draft room (`src/ui/screens/Draft.tsx`)

- **Banner:** inside `DraftClock` when you're up and offers are open: a gold line, "2 teams want No. 12 · gone when
  you pick". A **Shop this pick** button next to Auto-pick (disabled once used, with its message shown).
- **Call teams ahead:** a button next to Next pick while you have a pick coming (disabled once used for this pick,
  with its message shown).
- **Cards:** a `CardRow` under the hero with an `OfferCard` per open offer or ask on a pick in this draft (the trade
  desk's card). On a phone the row stacks.
- **Staff strip, one draft line:** your director reads your own board: "At No. 18 we'd still likely get one of our
  top 6." Built from your board (`boardOf` for your team) and the consensus order only.
- **Ticker and Your picks:** "via CHI" on picks that came from another team.

## Draft history

- `Player.draft` gains `via?: number` (the team that held the pick first) and `deal?: { from: number; got: string[] }`
  (for a pick moved during the draft: the team that sent it and what it got, as pick labels, "No. 18", "2028 round
  2"). Stored on the player, so it outlives pruned picks.
- The team cell shows "DEN via CHI" and a **Draft-day trade** pill. Tap or hover: "CHI sent No. 12 for No. 18 and
  No. 82."
- `SAVE_VERSION` 59 → 60. The upgrade fills `via` for drafted players whose picks are still in `league.draftPicks`
  (the last two drafts); older ones have none, which reads as no trade.

## Fog of war

- The banner, cards and staff line read only your offers, your board and the consensus. Never `player.ratings`,
  `playerOvr`, `player.potential` or `ceilingShifts`.
- AI covet uses each team's own board (`boardOf`, its scouts' read), never the truth. Needs come from its own roster,
  as `boardScore` does today. Other teams' needs (the "run" check) use `positionDepth`, a roster count any club sees.
- The `deal` line names picks and teams only.

## Files

- `src/engine/trade/draft.ts` (new): covet (`draftCovet`), `draftCalls`, `clockOffers`, `shopPick`, `callAhead`,
  `lapseUsedPicks`.
- `src/engine/trade/judge.ts`: `judge` adds `draftCovet` in the draft (so `evaluateTrade`, `proposeTrade` and offers get
  it too).
- `src/engine/trade/deals.ts`: `pickSwapFor` in the `draft` phase; `TAGS.draft`.
- `src/engine/trade/market.ts`: `draft` kind in `MINOR`.
- `src/engine/trade/offers.ts`: reason `draft`; skip `draft` in the lapse cooldown.
- `src/engine/offseason/draft.ts`: `boardBase`; `simDraft` calls `draftCalls` and makes the trade-up pick;
  `draftPlayer` stores `via`/`deal` and lapses clock offers.
- `src/engine/offseason/index.ts`: draft controls make clock offers when they stop at your pick.
- `src/engine/types.ts`: `DealKind` `'draft'`, `TradeOffer.reason` `'draft' | 'ask'`, `TradeMarket.clockPick?`,
  `shoppedPick?`, `calledAhead?`, `Player.draft.via?`, `deal?`.
- `src/engine/generate.ts`, `migrate.ts`: `SAVE_VERSION` 60 and the upgrade.
- `src/engine/inbox.ts`: no mail for reasons `draft` and `ask`.
- `src/ui/screens/Draft.tsx`, `src/ui/offers.tsx` (`KIND.draft`, `KIND.ask`), `src/styles.css`.
- `scripts/trades.ts`: the Draft day section. `scripts/offseason.ts`: draft trades counted apart.
- `docs/TRADES.md`: Phase 4 "what landed", section 6 updated. `src/ui/changelog.ts`, `package.json` 0.2.14.

## Testing

**Unit tests** (`src/engine/trade/draft.test.ts`):
- no trade-up when the target is likely to last; none for a K or P early; none past 8 spots unless a QB;
- a team that trades up takes the player it moved up for;
- every AI draft deal passes both sides' `judge` (with covet);
- a draft with trades off (no candidates) picks exactly as before;
- on the clock: at most 2 offers, one per team; none from "Sim the rest"; they lapse on any pick with no cooldown;
- Shop this pick: once per pick, skips teams already offering;
- Call teams ahead: only teams picking before your next pick; their asks pass their own `judge` with covet; once per
  pick; an ask lapses when its pick is made;
- a team on the clock with its man on the board asks more on the trade table than one in a tier;
- `via` and `deal` are stored; an old save upgrades.

**`npm run trades`, new Draft day section** (several drafts, each read as it closes through `dealWatch`):

| Check | Range |
| --- | --- |
| Trades a draft | 35–45 |
| ...with a first-round pick | 3–9 |
| Time a pick (median) | under 3 ms |
| Deals a side lost in its own eyes | 0 |
| Trade-ups where the buyer took the player it moved up for | 90% or more |
| Trade-up picks at a premium position, against picks that stayed put | higher |
| Round-1 price against the Jimmy Johnson chart (median, what the mover paid ÷ what he got) | 0.95–1.25 |
| QB trade-ups into the top 16 | about 1 a draft (0.3–2) |
| Teams trading down most | analytics GMs and Pick Hoarders lead |

**`npm run offseason`:** the draft-quality lines (R1 worth, R2–3, staff gap, slot vs consensus) stay in range;
offseason trades (15–35) exclude draft deals, which print on their own line.

**UI:** the screen-contract tests in `ui/ui.test.ts`; a test that the banner and cards render on the clock and the
via label and pill render in history. Screenshots of the draft room with an offer on the clock, desktop and 390px,
before the PR.
