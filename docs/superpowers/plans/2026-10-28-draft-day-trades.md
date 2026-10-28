# Draft-Day Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI front offices trade up and down during the draft for real NFL reasons, teams call you on the clock, and
you can shop your pick or call the teams ahead of you (`docs/TRADES.md` Phase 4).

**Architecture:** One new engine module, `src/engine/trade/draft.ts`, holds covet (how much a team wants the pick
ahead of its own), the AI calls before each pick, and the offers and asks to you. `judge` reads covet itself in the
`draft` phase, so every draft deal (AI, offers, your trade table, counters) goes through the one evaluator unchanged
otherwise. The draft room shows offers with the trade desk's `OfferCard`.

**Tech Stack:** TypeScript, React, Vitest. Seeded `Rng` only (no `Math.random`).

**Spec:** `docs/superpowers/specs/2026-10-28-draft-day-trades-design.md`

## Global Constraints

- Fog of war: screens never render `player.ratings`, `playerOvr`, `player.potential` or `ceilingShifts`; use
  `viewOf`/`Ovr`/`RangeValue`. AI decisions read each team's own board (`boardOf`), never the truth.
- No `Math.random`; draft trades draw from `new Rng(\`${seed}:draft-trades:${season}:${overall}\`)`, never the
  draft's own stream.
- `League` stays plain JSON; `SAVE_VERSION` 59 → 60 with an upgrade step in `migrate.ts`.
- Every screen follows `docs/UI.md` (names through `PlayerLink`/`TeamLink`, `TeamChip`, `Pill`, `CardRow`).
- Local runs: `npm run typecheck`, the touched tests (`npx vitest run <file>`), and while tuning `npm run trades`
  and `npm run offseason -- 6` at small sizes. Never `npm run check`. `npm run format` before each commit.
- Version 0.2.13 → 0.2.14 (PATCH: no MVP item finishes) with a `src/ui/changelog.ts` entry.
- Commits end with the session's attribution lines. No model names in commits, code or docs.
- "Premium positions" in the spec (QB, EDGE, OT, CB, WR) are `QB`, `EDGE`, `OL`, `CB`, `WR` here: the engine has
  one `OL` position.

## Review Focus

1. **Two offers on one pick, you accept one:** the other must close at once ("withdrawn", not left pending on a pick
   you no longer hold). Test in Task 4.
2. **Back-to-back picks of yours (e.g. 31 and 32):** after you use the first, offers for the second arrive; the first's
   lapse; no duplicates. Test in Task 4.
3. **Sim the rest with offers open:** your pick is auto-made, offers lapse "It lapsed when you picked.", and no new
   offers to you are made for later picks. Test in Task 4.
4. **No picks left / no next pick:** Call teams ahead and Shop are hidden or say why; nothing throws. Test in Task 4.
5. **Reload mid-draft:** `market.clockPick` stops the same pick's offers being made twice after a save and load. Test
   in Task 4.

---

### Task 1: Types, save v60, and the words for new offer kinds

**Files:**
- Modify: `src/engine/types.ts` (`DealKind`, `TradeOffer.reason`, `TradeMarket`, `Player.draft`, `DraftPick`)
- Modify: `src/engine/generate.ts:49`, `src/engine/migrate.ts` (after the v59 step)
- Modify: `src/engine/trade/deals.ts` (`TAGS`), `src/ui/offers.tsx` (`KIND`), `src/engine/inbox.ts` (`offerWords`,
  `offerMail`)
- Test: `src/engine/migrate.test.ts` (or the file that holds the v59 test), `src/engine/inbox.test.ts`

**Interfaces:**
- Produces:
  - `DealKind` gains `'draft'`; `TAGS.draft = 'draft-day trade'`.
  - `TradeOffer['reason']` gains `'draft' | 'ask'`; `KIND.draft = 'Draft day'`, `KIND.ask = 'Their price'`.
  - `TradeMarket`: `clockPick?: number` (pick id offers were made for), `shoppedPick?: number` (pick id),
    `calledAhead?: number` (overall on the clock when used).
  - `DraftPick.moved?: { from: number; got: string[] }` (set when the pick changes hands during the draft).
  - `Player.draft`: `via?: number` (original team id), `deal?: { from: number; got: string[] }`.

- [ ] **Step 1: Write the failing tests**
  - `migrate: v60 fills draft.via from picks still kept`: a v59 league with a drafted player whose kept pick has
    `originalTeamId !== ownerId` → after `migrate`, `player.draft.via === pick.originalTeamId`; a player whose pick
    was never traded has no `via`; `league.version === 60`.
  - `offerWords: draft offer reads as a pick deal`: an offer with reason `'draft'`, his side `{ picks: [No. 18, No. 82] }`,
    yours `{ picks: [No. 12] }` → subject `The Bears want to move up to No. 12`, body contains `No. 18` and `now`.
  - `offerWords: shop on a pick` (reason `'shop'`, no players) → subject `The Bears answer your call about No. 12`.
  - `offerWords: ask` → subject `The Bears' price for No. 9`.
  - `offerMail skips draft and ask offers`: a pending `'draft'` and a pending `'ask'` offer file no mail.
- [ ] **Step 2: Run them, expect FAIL** — `npx vitest run src/engine/migrate.test.ts src/engine/inbox.test.ts`
- [ ] **Step 3: Implement**
  - The type fields above; `SAVE_VERSION = 60`; the v60 step: for each `league.draftPicks` entry with `playerId` set
    and `originalTeamId !== ownerId`, set `players[playerId].draft.via = originalTeamId`.
  - `offerWords` cases. Exact copy:
    - `draft`: subject `The ${team.name} want to move up to No. ${n}`, body `${capital(packageWords(his))} for No. ${n},
      now.${close}`
    - `shop` with no players on either side: subject `The ${team.name} answer your call about No. ${n}`, body `You're
      shopping No. ${n}. Our best: ${packageWords(his)}.${close}`
    - `ask`: subject `The ${team.name}' price for No. ${n}` (`n` = their pick), body `For No. ${n} we'd want
      ${packageWords(yours)}.`
  - `offerMail`: `continue` for reasons `'draft'` and `'ask'`.
- [ ] **Step 4: Run them, expect PASS**; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `npm run format`; `git commit -m "Draft-day trades: offer kinds, pick history fields, save v60"`

---

### Task 2: Covet, and `judge` reading it in the draft

**Files:**
- Modify: `src/engine/offseason/draft.ts` (`boardScore`'s `rng` optional; `availableRanks`)
- Create: `src/engine/trade/draft.ts` (covet part)
- Modify: `src/engine/trade/judge.ts` (`judge` adds `draftCovet`)
- Modify: the spec's "The price" bullet: `judge` reads covet itself in the `draft` phase (no `covet` option).
- Test: `src/engine/trade/draft.test.ts` (new)

**Interfaces:**
- Produces (in `offseason/draft.ts`):
  - `boardScore(depth, p, board, rng: Rng | null, round, sizeBias = 0)`: with `rng` null the noise term is `0`; the
    expression keeps its order, so existing drafts are bit-for-bit the same.
  - `availableRanks(league): Map<number, number>`: each available prospect's consensus rank among the available
    (1 = best), by `boardValue`.
- Produces (in `trade/draft.ts`):
  - `draftBoards(league): BoardMemo`: one memo per league and season (`WeakMap<League, { season, memo }>`).
  - `boardBase(league, teamId, p): number`: `boardScore` with `rng` null, the team's own depth, round of its next pick,
    its `sizeBias` (0 for you).
  - `picksBefore(league, pick): number`: `pick.overall - nextPick(league).overall`.
  - `expectedAt(league, teamId, pick, skip?: Set<number>): { best: Player | null; score: number }`: the best
    `boardBase` among available prospects with available rank `> picksBefore(pick)` (all of them for the pick on the
    clock), skipping `skip`.
  - `draftCovet(ctx, teamId, proposal): { get: number; give: number }`: covet points for an AI team in the `draft`
    phase (zero outside it, and for you). Constants exported for tuning: `COVET_SCALE = 2`, `COVET_MAX = 0.6`,
    `COVET_MIN = 0.8`, `HOARDER_PICKS = 0.1`, `MANY_HOLES = 0.05`.
- Consumes: `boardOf`, `positionDepth`, `nextPick`, `availableProspects`, `boardValue` (`offseason/draft.ts`);
  `pickValue`, `sizeBias`.

`draftCovet` algorithm (the tests don't determine it):
```
E_in  = earliest current-draft pick the team receives; E_out = earliest current-draft pick it sends
kept  = its earliest current-draft pick it holds after the deal, other than E_in
gap(E, L) = expectedAt(E).score - expectedAt(L ?? none → 0 gap).score   // L: the pick it would use otherwise
points(E, gap) = pickValue(E, gm) * clamp(gap / COVET_SCALE, 0, COVET_MAX)
buyer  (E_in earlier than E_out or no E_out): get  += points(E_in,  gap(E_in,  E_out ?? kept))
seller (E_out earlier than E_in or no E_in):  give += points(E_out, gap(E_out, E_in ?? kept))
Pick Hoarder: get += HOARDER_PICKS * Σ pickValue(picks in)
3+ needs with urgency ≥ 0.6 (teamNeeds): get += MANY_HOLES * Σ pickValue(picks in)
```
In `judge`: `const covet = draftCovet(ctx, teamId, proposal)`; add `covet.get` to `get` and `covet.give` to `give`
before the margin is applied.

- [ ] **Step 1: Write the failing tests** (a league advanced to the `draft` phase, seed `'draft-trades'`)
  - `boardScore with no rng adds no noise`: equal to the `rng` version minus that draw (replay the same `Rng` seed).
  - `drafts are unchanged by the refactor`: the first 32 picks' player ids of seed `'draft-trades'` with draft trades
    switched off (`WINDOW` candidates empty via a test hook `draftTrades.off = true`), written down from `main`
    before the refactor. This test passes before and after; it guards the refactor.
  - `covet is zero outside the draft and for you`.
  - `a team on the clock with a clear top prospect asks more`: for the same proposal (its clock pick for a pick 6
    later), `judge(...).need` is higher when its top board score stands ≥ `COVET_MIN` above `expectedAt` the later
    pick than when they're within 0.2 (build the second case by removing its top prospects from the pool).
  - `a buyer whose target won't last gets more`: `draftCovet(...).get > 0` when the target's available rank ≤ picks
    before its own pick; `0` when every prospect it rates is ranked past them.
  - `Pick Hoarder values picks in more`: same deal, `get` higher for a Pick Hoarder GM than a Balanced one.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/engine/trade/draft.test.ts`
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run, expect PASS**; also `npx vitest run src/engine/trade src/engine/offseason`; `npm run typecheck`.
- [ ] **Step 5: Commit** — `"Draft-day trades: covet, read by judge in the draft"`

---

### Task 3: AI trade-ups and trade-downs before each pick

**Files:**
- Modify: `src/engine/trade/draft.ts` (`draftCalls`, `lapseUsedPicks`, `pickMoved`)
- Modify: `src/engine/offseason/draft.ts` (`simDraft`, `draftPlayer`)
- Modify: `src/engine/trade/deals.ts` (`pickSwapFor` allows `'draft'`), `src/engine/trade/market.ts` (`MINOR` has
  `'draft'`; `dealWatch` exported as today)
- Test: `src/engine/trade/draft.test.ts`

**Interfaces:**
- Consumes: `draftCovet`, `expectedAt`, `boardBase`, `availableRanks` (Task 2); `judge`, `executeTrade`,
  `refreshAfterTrade`, `dealWatch`, `pickSwapFor`, `tradeContext`.
- Produces:
  - `draftCalls(ctx, rng): { buyer: number; target: number } | null`: before an AI pick, at most 3 tries; returns the
    team that now holds the clock pick and the prospect it moved up for, or null.
  - `tradeUpReason(ctx, team, ownPick, clock): { target: Player; gap: number } | null`: rules 1–5 from the spec.
  - `PREMIUM = new Set(['QB', 'EDGE', 'OL', 'CB', 'WR'])`, `WINDOW = 10`, `LONG_JUMP = 8`, `MAX_TRADE_UPS = 2`,
    `DRAFT_SWAP_RATE = 0.03`.
  - `lapseUsedPicks(league): void`: any pending offer to you holding a used pick → `expired`; outcome `It lapsed when
    you picked.` if the used pick was yours (in `sides[1]`), else `It lapsed when the pick was made.`; no cooldown.
  - `pickMoved(league, proposal)`: sets `DraftPick.moved = { from, got }` on each current-draft pick in the deal
    (`got` = `pickLabel(..., { projected: false })` of what the sender received).

Rules in `tradeUpReason` (the spec's 1–5):
- need: `depth[pos].length < STARTERS[pos] + 1` or its weakest starter's overall `<` the target's board grade; or
  `PREMIUM.has(pos)`;
- likely gone: `rank ≤ picksBefore(ownPick)`, or `rank ≤ picksBefore(ownPick) + 3` and at least 2 teams picking in
  between have `depth[pos].length < STARTERS[pos] + 1`;
- gap: `boardBase(target) − expectedAt(ownPick, skip {target}).score ≥ COVET_MIN`;
- distance: `ownPick.overall − clock.overall ≤ WINDOW`; `> LONG_JUMP` only for a QB with gap `≥ 2 × COVET_MIN`;
- limits: fewer than `MAX_TRADE_UPS` draft-kind trades this season where it received the earlier pick; not K/P
  before round 5.

`draftCalls`: candidates are AI teams (not the clock owner, not you) holding a current pick within `WINDOW` after
the clock; take each one's earliest such pick; keep those with a reason; sort by gap; for the top 3: try the
package `[ownPick]`, then `[ownPick, addOn]` for add-ons sorted by the buyer's `pickValue` ascending (its later
current picks and next year's picks, at most 6 tried; a GM with `futureDiscount ≥ 0.3` lists next year's first);
the first package both `judge`s accept closes: `dealWatch.onClose?.(ctx, deal, proposal)`, `pickMoved`,
`executeTrade(league, proposal, { kind: 'draft', tag: TAGS.draft })`, `refreshAfterTrade`. News text via
`logTransaction`: `The ${buyer.name} trade up to No. ${n} with the ${seller.name} (${got}) and take ${pos} ${name}.`
(logged by `simDraft` after the pick, replacing the plain draft line for that pick).

`simDraft`: one `tradeContext` per call; before each AI-owned pick: with `rng2.chance(DRAFT_SWAP_RATE)` try
`pickSwapFor` for a random AI team; then `draftCalls`; if it returns a buyer, that team drafts `target` (skip
`aiDraftChoice`); else as today. `rng2` is the draft-trades stream; the draft's `rng` is untouched. `draftPlayer`
copies `pick.moved` → `player.draft.deal`, sets `player.draft.via` when `originalTeamId !== ownerId`, then
`lapseUsedPicks(league)`.

- [ ] **Step 1: Write the failing tests**
  - `no trade-up when the target is likely to last`: a team whose top prospect has available rank > picks before its
    pick → `tradeUpReason` null.
  - `no trade-up for a kicker before round 5` and `no long jump unless QB`.
  - `a team that trades up takes its man`: run `simDraft` for round 1 on seed `'draft-trades'`; for every
    `kind === 'draft'` record, the buyer's pick's `playerId` is the target `draftCalls` returned (spy via a wrapper
    or the news line).
  - `both sides accept every AI draft deal`: set `dealWatch.onClose` in the test; for each, `judge` for both sides
    `.accepts` is true.
  - `never trades into your pick`: no `draft` record has your team on either side.
  - `history and via`: a traded-up player has `draft.via` and `draft.deal.got.length ≥ 1`.
  - `draft trades don't count against limits`: `MINOR.has('draft')`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**; `npx vitest run src/engine/offseason src/engine/trade`; `npm run typecheck`.
- [ ] **Step 5: Quick tune** — `npm run trades -- 1` once Task 6's section exists; until then a scratch count:
  `npx tsx -e` a script that plays one league to the draft and prints the draft-kind records (keep it in the
  scratchpad, not the repo). Aim 35–45 a draft; adjust `COVET_MIN`/`COVET_SCALE` only.
- [ ] **Step 6: Commit** — `"Draft-day trades: AI teams trade up and down before each pick"`

---

### Task 4: Offers to you, Shop this pick, Call teams ahead

**Files:**
- Modify: `src/engine/trade/draft.ts` (`clockOffers`, `shopPick`, `callAhead`)
- Modify: `src/engine/trade/offers.ts` (export `file`; `expireOffers` adds no cooldown for reasons `draft`/`ask`)
- Modify: `src/engine/offseason/index.ts` (`draftNextPick`, `draftToUserPick`, `draftForUser` and entry to the
  `draft` phase call `clockOffers`; `draftToEnd` doesn't)
- Modify: `src/engine/trade/advice.ts` (`draftLine` in `dealAdvice`)
- Test: `src/engine/trade/draft.test.ts`, `src/engine/trade/offers.test.ts` (if a cooldown test belongs there)

**Interfaces:**
- Consumes: `tradeUpReason`, `draftCovet` (judge), `lapseUsedPicks` (Tasks 2–3); `file`, `quickValue`, `goingRate`.
- Produces:
  - `clockOffers(league): TradeOffer[]`: when `nextPick` is yours and `market.clockPick !== pick.id`: AI teams with a
    `tradeUpReason` for your pick each build `[their pick + cheapest add-on]` that their `judge(..., { vsUser: true })`
    accepts and whose `quickValue` ≥ `goingRate(your pick)`; the best 2 by `quickValue` for you are filed (reason and
    kind `'draft'`); sets `clockPick`. Returns them.
  - `shopPick(league): { offers: TradeOffer[]; message: string }`: on the clock only, once per pick
    (`shoppedPick`); like `clockOffers` but top 3, skipping teams with a pending offer on this pick; reason `'shop'`,
    kind `'draft'`. Messages: `${k} team(s) came back with an offer for No. ${n}.` / `Nobody wants to move up to No. ${n}.`
    / not on the clock: `You're not on the clock.` / used: `You've already shopped No. ${n}.`
  - `callAhead(league): { offers: TradeOffer[]; message: string }`: not on the clock, with a next pick N; once per
    clock overall (`calledAhead`); AI teams holding picks in `[max(clock, N − WINDOW), N − 1]` (earliest per team)
    each price their pick: your N + the cheapest add-on of yours (your later current picks, then next year's,
    by their `pickValue` ascending, at most 6) their `judge(..., { vsUser: true })` accepts; the 3 cheapest by
    `quickValue(user, your side)` are filed, reason `'ask'`, kind `'draft'`, sides `[theirs, yours]`. Messages:
    `${k} team(s) gave you their price.` / `No one ahead of you will move their pick for what you have.` /
    `You have no pick coming.` / `You've already called around this pick.`
  - `draftLine(league, [theirs, yours]): Advice | null` (`who: 'scouts'`): for a deal sending your current pick E
    and bringing a later current pick L: `k` = your-board rank (by `boardBase` for you) of `expectedAt(you, L).best`;
    line `At No. ${L} we'd still likely get one of our top ${k}.`; tone `good` if k ≤ 3, `note` if ≤ 8, else `warn`.
    For an ask (you get the earlier pick): `At No. ${E} we'd be sure of our top choice.` tone `good`.

- [ ] **Step 1: Write the failing tests** (league at the `draft` phase; make your team hold a mid-round-1 pick)
  - `clock offers: at most 2, one per team, priced at or above the going rate`.
  - `clock offers are made once per pick` (call twice → second returns none; save/load with JSON round trip →
    still none) — Review Focus 5.
  - `sim the rest lapses them and makes no more`: `draftToEnd` → each was `expired` with `It lapsed when you
    picked.`; no offer with phase `draft` was filed after — Review Focus 3.
  - `accepting one closes the other`: two offers on your pick; `acceptOffer` the first → the second's status is
    `withdrawn` or `expired` and `openOffers` excludes it — Review Focus 1.
  - `back-to-back picks`: your team holds picks n and n+1; `draftForUser` at n → offers for n are closed, `clockOffers`
    has run for n+1 — Review Focus 2.
  - `no picks left`: `callAhead` → `You have no pick coming.`; `shopPick` off the clock → `You're not on the clock.`
    — Review Focus 4.
  - `shop once per pick, skipping teams already offering`.
  - `call ahead: only teams before your next pick; each ask passes its own judge`.
  - `a team on the clock asks more on the trade table with its man on the board`: `evaluateTrade` shortfall for the
    same proposal, with and without its top prospects in the pool.
  - `lapsed draft offers leave no cooldown`.
  - `draftLine` reads your board only (it gives the same line when the truth is changed: mutate `player.ratings` of
    every prospect → line unchanged).
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**; `npx vitest run src/engine/trade src/engine/offseason src/engine/inbox.test.ts`;
  `npm run typecheck`.
- [ ] **Step 5: Commit** — `"Draft-day trades: offers on the clock, shop this pick, call teams ahead"`

---

### Task 5: Draft room and draft history

**Files:**
- Modify: `src/ui/screens/Draft.tsx` (`DraftClock`, new `ClockOffers`, `YourPicks`, `DraftHistory`, ticker)
- Modify: `src/ui/offers.tsx` (`lapse`: in the `draft` phase `Gone when the pick is made.`)
- Modify: `src/styles.css`
- Test: `src/ui/ui.test.ts` or a new `src/ui/draftTrades.test.tsx` (follow `squads.test.tsx` / `trades.test.tsx`)

**Interfaces:**
- Consumes: `clockOffers`, `shopPick`, `callAhead` (Task 4), `openOffers`, `OfferCard`, `CardRow`, `Pill`.
- Produces: `ClockOffers({ league })` (the card row), `draftDayOffers(league): TradeOffer[]` (open offers whose sides
  hold a current-draft pick).

Layout (spec "Draft room"):
- Banner inside `DraftClock`, when you're up and `draftDayOffers` has offers on your pick: a `callout` line with the
  gold token, `${k} team(s) want No. ${n} · gone when you pick`.
- Buttons: on the clock, `Shop this pick` after `Auto-pick for me`; off the clock with a next pick, `Call teams
  ahead` after `Next pick`. Disabled once used for this pick; the returned `message` shows under the buttons
  (`role="status"`).
- `ClockOffers` under the hero: `CardRow label="Draft-day offers"` with an `OfferCard` per `draftDayOffers`; stacks at
  390px (CardRow's existing rule).
- Ticker, `YourPicks`: `via ${abbrev}` (muted small) when `originalTeamId !== ownerId`.
- `DraftHistory` team cell: `TeamChip` + `via ${abbrev}` when `draft.via` is set; `Pill` `Draft-day trade` with
  `title` = `${from.abbrev} sent No. ${pick} for ${got.join(' and ')}.` when `draft.deal` is set (visible text on
  tap: the pill is a `button` that toggles the line below the name).

- [ ] **Step 1: Write the failing tests**
  - `banner and cards render on the clock`: render `Draft` with a league on your pick holding two `draft` offers →
    text `2 teams want No.` and two `.offer-card`.
  - `call teams ahead shows off the clock only`.
  - `history shows via and the draft-day pill` for a player with `draft.via` and `draft.deal`.
  - The screen contract in `ui/ui.test.ts` still passes for `{ view: 'office', tab: 'draft' }`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/ui`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**; `npm run typecheck`.
- [ ] **Step 5: Screenshots** — `npm run dev`; a Playwright script in the scratchpad loads a save at the draft with
  your pick holding offers; capture desktop (1280×900) and 390×844 to the scratchpad; send both to the owner with
  `SendUserFile` and wait for their OK before the PR.
- [ ] **Step 6: Commit** — `"Draft room: offers on the clock, shop this pick, call teams ahead, via in history"`

---

### Task 6: The checks

**Files:**
- Modify: `scripts/trades.ts` (section 8, "Draft day"; offseason volume excludes the draft)
- Modify: `scripts/offseason.ts` (draft trades on their own line; offseason trades exclude them)

**Interfaces:**
- Consumes: `simDraft`, `draftCalls` via a normal `advanceOffseason`; `dealWatch` (already set by the script).

Section 8 reads every league's drafts (each audited record with `phase === 'draft'`), and times `simDraft` on a
clone at the draft once (`cpuMs`, divided by picks). Checks (`check(label, value, range)`):

| Label | Range |
| --- | --- |
| `draft trades a draft` | [35, 45] |
| `…with a first-round pick` | [3, 9] |
| `ms a pick (median)` | [0, 3] |
| `trade-ups where the buyer took its man (%)` | [90, 100] |
| `trade-up picks at a premium position (%) − stay-put (%)` | [0.1, ∞) |
| `round-1 price ÷ JJ chart (median, mover)` | [0.95, 1.25] |
| `QB trade-ups into the top 16, a draft` | [0.3, 2] |
| `trade-downs by analytics or Pick Hoarder GMs (%) − their share of teams (%)` | [0, ∞) |

Plus `note` lines: future picks in draft deals, the top 5 trade-down teams with their GM archetype and chart (info).
"Lost in its own eyes" is already failed by the no-cheese read for every deal, draft ones included. In the season
loop, `volume.offseason` counts audited records with `phase !== 'draft'`.

- [ ] **Step 1: Add the section and the exclusion**
- [ ] **Step 2: Run** `npm run trades -- 1` and `npm run offseason -- 6`; tune `COVET_MIN`, `COVET_SCALE`,
  `COVET_MAX`, `DRAFT_SWAP_RATE` until every Draft day line is inside its range and the offseason draft lines
  (R1 worth, R2–3, |slot − consensus|) stay in range. Never loosen a range.
- [ ] **Step 3: Commit** — `"Trades check: draft day section"`

---

### Task 7: Docs, version, PR

**Files:**
- Modify: `docs/TRADES.md` (section 6 as built; "Phase 4: what landed" with the measured numbers from Task 6;
  the "Draft" row of the NFL table: "Allowed; AI trades up and down")
- Modify: `src/ui/changelog.ts` (0.2.14: "Draft-day trades": AI teams trade up and down for the players they want,
  teams call you on the clock, shop your pick or call the teams ahead; draft history shows who a pick came from),
  `package.json` (0.2.14)
- Modify: `CLAUDE.md` (`trade/` bullet: one clause for `draft.ts`)

- [ ] **Step 1: Write the docs and bump the version**
- [ ] **Step 2: Run** `npx vitest run src/ui/changelog.test.ts`; `npm run typecheck`; `npm run format`
- [ ] **Step 3: Commit and push** — `git push -u origin claude/magical-hypatia-xp000l`
- [ ] **Step 4: After the owner OKs the screenshots, open the PR** (title `Draft-day trades (0.2.14)`), then read CI
  and fix anything red.
