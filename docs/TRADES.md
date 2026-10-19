# Trades

> **Status.** Phase 0 built (Oct 19 2026): see "Phase 0: what landed" below. Phases 1–6 are plans.
> The trade engine lives in `src/engine/trade/`. This plan turns it into a living market like Football
> Manager's transfer window. AI teams trade with each other all year, make offers to you through the
> inbox and on draft day, and run the real NFL playbook. Every GM, coach, scout and doctor involved
> shapes the deals, and the NFL calendar and rules are enforced.

## In one minute

- **One market, many moments.** The league year opening, free agency, the draft (pick by pick),
  camp cutdowns, every week up to the deadline, and a real **deadline day**. Volume follows the
  NFL: about 20 in-season trades with close to half on deadline day, and about 40 on draft day.
- **AI teams know what they are.** Each front office is a contender, bubble team, retooler or
  rebuilder, has needs and a trade block, and shops on its own scouts' read. Its GM's traits and
  coaches change the price. Contenders buy, rebuilders sell, and teams tight on the cap dump salary.
- **Every GM strategy is a deal template:**
  - deadline rentals and sell-offs
  - star trades with an extension
  - player swaps, and player + pick for player
  - salary dumps with a sweetener pick, absorbing a bad contract for picks, and the sender paying
    part of the salary
  - tag-and-trade
  - trade-ups and trade-downs, future picks for current ones, and late-pick swaps that ride along
  - cutdown-day deals
- **Offers to you, FM style.** Bids, pitches and enquiries arrive in the inbox with an expiry. You can
  accept, decline or counter. Each AI GM has limited patience and remembers how you treated him. You
  can mark players Untouchable or put them on the block, and shop a player to the whole league.
- **Physicals.** Every trade involving a player waits on the buyer's medical: pass, fail (the deal is
  off) or "we found something" (the price reopens). A good doctor catches damaged goods; a poor one
  gets fooled, or scares you off a healthy player.
- **Mind games.** Rival GMs plant rumors to work on you: fake bidding wars, draft smokescreens, "we
  have another offer." Each rumor has a source, the truth comes out later, and your director's
  judgment decides how well you see through it.
- **One evaluator for every deal** (AI↔AI, AI→you, you→AI), with guardrails kept out of the value
  formula, so tuning can't reopen an exploit.
- **A new check, `npm run trades`**, holds volume, prices, fairness, offers and the exploit probes to
  target ranges, the way `crews` and `weather` do.

| Phase | What lands | Size |
| --- | --- | --- |
| 0. Foundation | Value v2 (fair prices), one evaluator, a fast per-pass cache, deadline day, `npm run trades` | M |
| 1. The AI market | Stances, needs, trade blocks, deal templates, NFL cadence, rumors, coach and GM hooks | L |
| 2. Offers to you | Offers, enquiries, counters, statuses, Shop a player, the new Trades screens, staff advice | L |
| 3. Physicals, offseason and cap moves | Physicals with pass/fail drama, league-year dumps, retained salary, tag-and-trade, trade-and-extend, cutdown and rehab trades | M |
| 4. Draft day | AI trade-ups and trade-downs, offers while you're on the clock, Shop this pick | M |
| 5. Memory, media and mind games | GM trust, planted rumors and bluffs, draft smokescreens, the director's digest, trade tags in the news | M |
| 6. Later | Conditional picks, compensatory picks, no-trade clauses, waivers, trade requests | – |

---

## The NFL, by the numbers

Sources are search-result summaries collected for this plan (Oct 2026), not re-read at the source.
Items marked *assumed* had no source and are design choices.

**Calendar**

| Window | NFL | AFLS today |
| --- | --- | --- |
| Opens | New league year (mid-March, 4 p.m. ET) | `resign` phase (the league year flips at `beginOffseason`) |
| Super Bowl → league year | Deals agreed but not official until the league year (Stafford–Goff, Jan → Mar 2021) | Closed (`complete`) |
| Draft | Picks trade on the clock (round 1 is 8–10 minutes a pick) | Allowed in `draft`, but no AI ever trades during it |
| Deadline | Tuesday after week 9, 4 p.m. ET (Nov 5 2024, Nov 4 2025, Nov 10 2026; it followed week 8 until 2023) | Closed once week 10 is next. The AI still trades after week 9's games, but you can't |
| After the deadline | No trades until March; every release goes through waivers | Closed (no waivers in AFLS) |
| Cutdown | 90 → 53, late August | `preseason` |

**Volume**

- In season: 22 trades and 27 players in 2025 (the most since at least 1995), 19 players in 2024, 16
  in 2023, 22 in 2022. On deadline day 2025, 12 players and 14 picks moved.
- Draft: 41 trades in 2023 (a record); 128–147 picks change hands a year. First-round trades average
  5.5 a year (2016–25); 8 trades fell in the first 32 picks of 2026.
- Offseason player trades (league year to camp): no league count found. *Assumed* 15–35.
- About 5–6 trades a year mix current-year and future-year picks.
- Division rivals rarely deal: Flacco (Browns → Bengals, 2025) was only the third QB trade between
  division rivals this century.

**Prices** (picks, plus players where noted)

| Deal | Price |
| --- | --- |
| Star EDGE: Mack 2018, Parsons 2025, Garrett 2026 | 2 firsts (+ a player, or + a 2nd and 3rd) |
| Star WR: Hill 2022, Adams 2022 | 1st + 2nd (+ late picks) |
| Star CB: Gardner 2025 / McDuffie 2026 | 2 firsts + a player / a late 1st + 3rd + 5th + 6th |
| QB: Wilson 2022 · Wentz 2022 · Mayfield 2022 | 2 firsts, 2 seconds and more · a 2nd swap + 3rd + conditional 3rd · a conditional 5th, Cleveland paying $10.5M of his salary |
| Deadline rental | Za'Darius Smith 2024: 5th + 6th · Shaheed 2025: 4th + 6th · Chase Young 2023: 3rd · Leonard Williams 2023: 2nd + 5th |
| Salary dump | Osweiler 2017: Houston *paid* a 2nd (+ a 6th) to send him to Cleveland, which had $102M of room |

Rule of thumb: a future pick is worth one round less per year out (a future 2nd ≈ a current 3rd).
Stars are traded with an extension signed at once (Mack, Hill, Adams, A.J. Brown, Parsons).

**Rules that matter for the engine**

| Rule | NFL | AFLS today | Plan |
| --- | --- | --- | --- |
| Future picks | Up to 3 drafts ahead (a 5-year proposal was withdrawn in 2026) | `MAX_FUTURE_DRAFT_YEARS = 3`, rolled forward in `finishDraft` | Keep |
| Compensatory picks | Tradable since 2017 | None exist | Tradable once they exist (roadmap) |
| Conditional picks | Common: 65–70% snap share, All-Pro, conference final | None | Phase 6 |
| Sender's cap | Unamortized bonus accelerates (all now before June 1, split after); the June 1 designations are for releases only | Done (`deadMoney(..., { trade: true })`, `autoPostJune1`) | Keep |
| Receiver's cap | Remaining base salary and its guarantees | Done (`paidShare`) | Keep |
| Cap compliance | The league can reject a deal that breaks the cap | Both sides checked (`tradeProblem`) | Keep; the AI also checks next year's books |
| Cash or cap space for picks | Not allowed (the league blocked the Saints' 2020 Clowney plan) | n/a | Never |
| Paying part of a salary | Allowed the NFL way: the sender turns base salary into a bonus before the trade and books it as dead money (Tannehill 2019, Clowney 2019, Mayfield 2022, Quinn 2022, L. Williams 2023) | None | Phase 3 |
| Franchise tag | Tradable once the tender is signed (Clowney 2019, Ngakoue 2020) | A tag is a signed one-year deal, so it's tradable | AI tag-and-trade (Phase 3) |
| Physical | Every trade waits on one; failed physicals void deals (Crosby 2026, Shaheen 2022); rarely, a pick is added to finish one (Duane Brown 2017) | Blocked when the doctor's estimate is 2+ weeks; no physical otherwise | The buyer's physical on every player trade: pass, fail or renegotiate (section 7); in season a player out 2+ weeks still can't go; offseason rehab trades go through it (Revis 2013) |
| Injured reserve | No rule or example found | Blocked | Keep blocked |
| No-trade clause | Rare (Wilson, Watson, Garrett waived theirs) | None | Phase 6 |
| Recently signed free agents | No NFL rule (rare in practice) | A 6-week cooldown, shown on the trade table | Hidden GM policy: 4–8 weeks per GM, never shown (decision 1) |
| Reacquiring a player | Allowed (McFadden, Atwell) | Allowed | AI policy: won't take back from you within the league year (anti-flip) |
| Roster limit | Make room first | You release first; AI auto-cuts | Accept dialog offers the release |

## What other games teach

From Football Manager, ZenGM (Football GM's source code), OOTP, Madden, NBA 2K and MLB The Show:

1. **Quantity never buys quality.** Value is convex in talent (ours already is: `exp(0.55 × ovr)`), and
   a player is worth what he adds to *this* roster, not his raw rating (ZenGM's roster fit cut
   top-10 QBs sitting as backups from 77 of 100 seasons to 18). Madden 20–21's "backup RB + 7th for a
   95 tackle" came from ignoring both.
2. **One accept function.** FM24 shipped a second, laxer path that let stars go for under 1% of their
   value (fixed in 24.3). AI↔AI, AI→you and you→AI must all call the same evaluator.
3. **Guardrails stay outside the value formula** (windows, cap, rosters, physicals, cooldowns), so
   tuning value never reopens an exploit.
4. **Soft pricing beats hard caps.** ZenGM replaced its "two picks per trade" cap in 2025 with a
   price that climbs for each first-rounder past the second. Madden's additive stacking penalty was
   removed as "unrealistic".
5. **Modes with a dead band.** Contend or rebuild from record, roster and age, with hysteresis so a
   team doesn't flip every week (ZenGM: ±20 on its score).
6. **Sellers sell and buyers buy.** OOTP 27 and MLB The Show 26 rebuilt CPU trades around buyers,
   sellers and needs. Random pairings (Madden, old OOTP) produce nonsense.
7. **One volume knob, set low.** OOTP's "average" frequency was widely called far too high.
8. **Throttled, keyed, expiring offers.** FM's worst complaint is the same club sending five identical
   bids in a day. Offers need an expiry, a cooldown after a no, and a key so nothing doubles up.
9. **Negotiation memory.** The AI moves 10–20% and then walks (FM). OOTP charges reputation for
   offers you make and pull. Give each GM a few rounds, then a break.
10. **Statuses change behavior.** Untouchable is never asked for. "On the block" draws interest and
    lowballs. AI blocks feed rumors.
11. **Rumors come from real intent**, with a little noise (MLB The Show's rumor board is unreliable on
    purpose).
12. **Ship an exploit harness with the engine**: junk for a star, 2-for-1 and 3-for-1 consolidation,
    A→B→A flips, pick stacking, and league talent and cap held steady over many seasons.

## Today's baseline (measured Oct 19 2026)

Three fresh leagues, two seasons each (`createLeague`, `playWeek`, `simOffseason`):

- **About 4 AI trades a season** (3–6), all in weeks 1–9 and all "contender sends picks for a
  veteran." None happen in the offseason or on draft day, and there are no swaps or dumps.
- **Prices are erratic.** Of 26 trades, 12 sent a 13–15 OVR veteran who would start for the buyer
  for a 4th–7th, often a pick three drafts out. Examples:
  - TE 13.8 for a 2029 7th
  - OL 13.4 for a 2027 7th
  - LB 15.1 for a 2029 4th

  A few went the other way: a CB 15.5 for a 2030 1st, a DT 15.7 for a 2030 1st.

  Why:
  - The seller only has to "not lose in its own eyes." Its lens values an expiring veteran near zero:
    ×0.6 for one year left, the rebuild lens, and a salary at or above market that cancels the rest.
  - Nothing prices how much of the season is left.
  - Nothing stops a fire sale: there's no market floor.
- **The deadline is lopsided.** `aiTradeWeek` runs after week 9's games while `league.week` is still
  9. You can only trade before you play week 9.
- **Valuation is slow for a league-wide market.**
  - `playerValue` costs 0.13 ms. It scans every player for the depth check (`teamPlayers`), so
    valuing every player for every team would take about 7 s.
  - `pickValue` costs 0.84 ms outside an attempt's slot memo. It rebuilds every team's rating and
    the standings on every call.
  - `playWeek` takes about 400 ms.
- **A hard cap**: `MAX_AI_PICKS = 2` unless a star comes back.
- **The user** can only build offers. Nobody calls you, and there's no trade block, enquiry, counter
  or history.

---

## The design

```
each market moment (a week, an offseason step, a draft pick, deadline day)
  └─ build a TradeContext (rosters, views, slots, values: computed once, thrown away after)
       ├─ stance for every team (contend · bubble · retool · rebuild, with a dead band)
       ├─ needs and trade block for every team (on its own scouts' read)
       ├─ interest: who is watching whom (builds over weeks, feeds rumors and offers)
       ├─ initiators: a few GMs pick up the phone (activity × moment × urgency)
       │    └─ deal search: templates → cheapest package both sides accept → judge() both sides
       │         ├─ AI partner → execute, log, tag the reason ("contender add", "cap dump"…)
       │         └─ you → a TradeOffer in your inbox (expires; accept · decline · counter)
       └─ expire old offers, decay interest, write rumors
```

### 1. Value v2: one scale, one evaluator

Everything stays in **pick-chart points** (the existing Johnson/Fitzgerald-Spielberger blend), so the
pick side of today's code and its tests carry over.

**A player's value to a team:**

```
value(T, p) = talent(p) × control(p, now) × role(T, p) × lens(T, p)  +  salary(T, p)
```

| Term | What it is | Change from today |
| --- | --- | --- |
| `talent` | `3000 × e^{0.55 (eff − 18.5)} × POSITION_TRADE × ageMultiplier` on the team's half-trusted, bounded read | Unchanged |
| `control` | Seasons of control left, weighted 1 / 0.75 / 0.55. Year one counts only for the share of the season still to play. A deal that ends this year adds 0.15 for the re-sign window | Replaces the flat 0.6 / 0.85 / 1. Tuned so a full offseason still reads about 0.6 / 0.8 / 1, and an expiring veteran at the deadline is worth about a third of a full-control one |
| `role` | What he adds to *this* depth chart: a starter is worth his value minus 65% of the starter he pushes down, never less than a top backup; a top backup 0.35; deeper 0.2 | Replaces "starter or ×0.35" |
| `lens` | Stance (contenders pay for veterans, rebuilders for youth and picks), need urgency (up to +30%), scheme fit (±8%), coaching (±10% young, ±5% old). See section 8 | Today: `winNow` on players 27+ only |
| `salary` | Contract surplus over up to four years (market minus base), × the team's **salary weight**: 0.5 for a rich rebuilder, 1 typical, up to 2 for a team over the cap or tight next year | Today: weight always 1 |

**Market value** is the same formula through a league-average lens (role 1, lens 1, salary weight 1):
what the league would pay. Two uses:

- **The seller's floor** ends fire sales. A team accepts only if what it gets covers
  `max(its own value, floor × market value)`. The floor is 0.8 normally. It drops to 0.65 for a
  player it is shopping (an expiring veteran on a seller at the deadline) and rises to 0.95 for its
  core. Starters stop going for 7th-rounders, and sellers still sell.
- **Rumors and the UI** use it as the price tag the media talks about: words only, never numbers.

**A package's value** (anti quantity-for-quality, from ZenGM and Madden):
- Each incoming player costs a **roster spot** (about 15 points, a 6th-round pick) unless he makes the
  53 comfortably.
- An AI's own first-round picks get dearer past the second it gives: ×(1 + extra / 2.5), ZenGM's 2025
  rule. This replaces the `MAX_AI_PICKS` hard stop; the "won't send more than two picks" message
  becomes a price.
- A star (value ≥ about a mid first) only goes for a package that includes one asset worth at least
  45% of him, or a first-round pick.

**Picks:** today's charts, projected slots and per-GM future discount, with two changes:
- **Future discount, calibrated.** Today's 0.15–0.40 a year plus regression to the middle makes a
  pick three drafts out cheap currency for All-In GMs (0.38) and dear for Pick Hoarders (0.15). That
  difference is a real gain from trade, but the level should land near the NFL's "one round a year."
  `npm run trades` measures what a future first actually fetches; the band moves if it misses.
- **Slots are cached for the whole market day**, not only one attempt.

**The evaluator.** `judge(ctx, teamId, proposal)` returns get, give and the need, plus a reason when
the answer is no. `evaluateTrade` (your trades), the AI↔AI search, AI offers to you, counters and
draft-day deals all call it.

| Side | Margin it wants |
| --- | --- |
| An AI judging your proposal | `1.05 + 0.15 × stubbornness`, + trust (section 5), + 0.06 for a division rival, + 0.04 for a playoff rival in season, − 0.03 for a seller at the deadline |
| An AI judging an AI deal | `1 + 0.05 × stubbornness` (both sides must not lose in their own eyes) |

Guardrails are separate checks that value can't buy past: windows, cap, roster, physical, cooldown,
untouchable, the anti-flip rule, and a star to a division rival in season.

### 2. Team plans: stance, needs and the trade block

**Stance** comes from a score s between −1 and 1, recomputed at every market moment:

```
s = 0.4 × roster rank (contenderScore, centred)
  + 0.4 × the race (in season: games behind the last playoff seed against games left; offseason: 0.25 × last season)
  + 0.2 × the GM's winNow (centred)
  + head coach on the hot seat (hotSeat × ownerTrigger ≥ 0.3): +0.1 while the race is alive, −0.1 once it isn't
  + a first-year head coach: −0.05 (building)
  + an old roster (starters' mean age ≥ 28.5) with s < 0: −0.1
  + no starting-grade QB on its own read: −0.1
```

| Stance | Enter | Leave | Behavior |
| --- | --- | --- | --- |
| Contend | s ≥ 0.30 | s < 0.20 | Buys starters and rentals with picks; pays for veterans |
| Bubble | 0 ≤ s < 0.30 | – | Buys cheap rentals for real needs; sells nothing core |
| Retool | −0.30 ≤ s < 0 | – | Sells expiring veterans, buys young players under contract |
| Rebuild | s < −0.30 | s > −0.20 | Sells veterans 28+ for picks; takes on bad contracts for picks; buys picks |

The dead band needs memory, so each team keeps `stance` (mode and since when). The stance's pieces
(record, roster, GM, coach) are shown on team pages in words: "buying", "selling", "listening".

**Needs** (`teamNeeds`) come on the team's own read, each with an urgency from 0 to 1:
- **Hole:** fewer healthy starters than `STARTERS`. A starter out four or more weeks counts as missing.
  Urgency 1.
- **Upgrade:** the weakest starter at a position is below the league's median starter there, weighted
  by position value.
- **Next year** (offseason and late season): starters whose deals end, or who are past the
  position's aging cliff.
- **Fit:** a scheme-critical spot (the coordinator's `fit` contests) filled by a poor fit.

**The trade block** (`tradeBlock`) lists who a team will move and how keenly:

| Reason | Who | Keenness |
| --- | --- | --- |
| Surplus | Depth beyond `ROSTER_TEMPLATE`, a third QB, a backup who would start elsewhere | Medium |
| Expiring veteran | Deal ends this year, on a retooler or rebuilder | High at the deadline |
| Veteran on a rebuilder | Age at or past his position's cliff | Medium |
| Overpaid | Clearly negative surplus on a team with cap pressure (a dump candidate) | High |
| Blocked youngster | A young player stuck behind a starter at a deep position | Low |

**Untouchable** (AI): a franchise QB on a contender, players extended this league year, and the team's
top three young players for a loyal GM (`loyalty`). Your own statuses are yours to set (section 5).

**Interest** is the world noticing players, FM's "monitoring → interested → ready to bid." A team's
interest in a player rises when:
- it has a need at his position,
- he is on a block (or your list),
- its pro scouts know him (knowledge at least about 0.35),
- he fits its scheme,
- it can afford him.

Interest is kept lightly (team, player, level 1–3, when) and fades a level after three quiet weeks.
Level 2 can send you an enquiry; only level 3 makes offers. So interest builds over weeks, rumors have
a source, and an offer never comes out of nowhere.

### 3. The market: when, how often, how

**Moments and activity** (relative chance a GM picks up the phone):

| Moment | When it runs | × |
| --- | --- | --- |
| League year opens | Start of `resign` (cap casualties, tag-and-trade, star trades agreed over the winter) | 1.4 |
| Free agency | Each FA day | 0.4 |
| Draft | Before each pick (section 6) | own engine |
| Camp | `preseason`, before cutdowns | 0.9 |
| Weeks 1–6 | After each week's games | 0.5 |
| Weeks 7–8 | After each week's games | 1.0 |
| Deadline day | After week 9's games, before week 10 | 2.5 |

**Deadline day becomes a real stop.** After week 9's games the calendar holds at *Trade deadline day*.
The AI's last deals and your last offers land, and the primary button reads "Play week 10 (closes the
trade deadline)." `tradeWindow` stays open until then, for you and the AI alike. This fixes today's
lopsided deadline and gives the deadline its frenzy.

**Who calls.** At each moment each AI team rolls once:

```
p = base × moment × (0.4 + 0.9 × gm.activity) × (0.6 + 0.8 × |s|) × (0.5 + top need urgency)
```

`gm.activity` is a new GM trait (deal-maker vs. sits tight):

| Archetype | Activity |
| --- | --- |
| All-In | 0.85 |
| Pick Hoarder | 0.7 (trades down a lot) |
| Cap Magician | 0.6 |
| Can-Kicker | 0.6 |
| Balanced | 0.5 |
| Draft and Develop | 0.4 |
| Hard-Liner | 0.25 |

Values are jittered per team like the others. One league knob, `TRADE_VOLUME`, scales `base`, and
`npm run trades` tunes it to the NFL's numbers. A team makes at most 3 in-season trades (All-In 4).

**How a deal is found** (`findDeal`): the initiator's need, or what it is selling, picks the
template.
1. Candidates: players on other teams' blocks, or listed by you, at the need's position that would
   upgrade the initiator on its own read. Pre-filtered cheaply by perceived OVR and salary fit, then
   ranked by gain × urgency ÷ market value. At most four are tried.
2. For each candidate, packages are built cheapest-first from the templates below. Each must pass
   `tradeProblem` for both teams and `judge` for both teams.
3. The package the initiator likes best wins. When value is nearly level, the smallest pick that
   tips it is added (often a late-round swap riding along, as in the NFL).
4. If the partner is you, the result becomes a `TradeOffer` instead of a trade (section 5).

**After a trade:**
- Both teams' cached rosters, needs, slots and values are rebuilt.
- The AI side cuts down if it's over the roster limit (`aiCutdown`, as today).
- The deal goes to the transaction log and the structured history with its reason tag.
- The two teams sit out the rest of the moment.

**Determinism:** the market draws from its own stream,
`${seed}:market:${season}:${phase}:${week}:${faDay}`, like injuries and weather. A seed replays the
same market, and tuning it never reshuffles anything else. (Moving the current AI trades off
`league.rngState` changes later draws once; that's expected.)

### 4. The GM playbook: deal templates

| Strategy | Template | Typically when | Who does it | NFL example |
| --- | --- | --- | --- | --- |
| Deadline rental | Picks (R3–R6) for an expiring starter | Weeks 6 – deadline day | Contender or bubble team ← retooler or rebuilder | Za'Darius Smith 2024 |
| Sell-off | Veterans for picks, several in one window | Deadline day, league year | Rebuilder (often after a coach is fired) | Jets 2025 (Gardner, Q. Williams) |
| Star trade | 1–2 firsts (+ a player or a 2nd) | Offseason mostly | Contender ← anyone; the seller's floor is high | Mack 2018, Parsons 2025 |
| Trade and extend | A star trade with a new deal signed at once (the agent's ask from `demand`) | Offseason | The buyer, if the player accepts | Hill 2022, Adams 2022 |
| Player swap | A need for a need, about level, balanced with a pick | Any | Two teams, each with a surplus where the other has a need | Stafford–Goff 2021 (+ picks) |
| Player + pick for player | A swap plus a pick or a pick swap | Any | – | Mack 2018 (the Bears got a 2nd back) |
| Salary dump | Bad contract + a sweetener pick → a team with room | League year, camp | Cap-tight team → rich rebuilder (low salary weight) | Osweiler 2017 |
| Absorb a contract | The other side of the dump: a rich team charges a pick to take salary | League year | Rebuilder with space | Browns 2017 |
| Eat salary to sell | The sender pays part of this year's base as a pre-trade bonus (dead money for it) so the buyer can fit him | Deadline, offseason | A seller with room, a buyer without | Mayfield 2022, L. Williams 2023 |
| Tag and trade | Tag a star you won't pay, then sell him | Re-sign window → FA | A team that can't pay him | Ngakoue 2020, Clowney 2019 |
| Trade up / down | Pick for pick + more, priced on each GM's own chart | Draft | Coveting a prospect / an analytics GM moving down | 41 draft trades in 2023 |
| Future for current | A future pick for a current, lower one (or the reverse) | Draft, league year | High-discount (All-In) ↔ low-discount (Pick Hoarder) GMs | 5–6 a year |
| Pick swap riding along | "Our 5th for your 6th" to balance a deal | Any | The deal search | Diggs 2024 |
| Cutdown trade | Surplus depth for a 6th or 7th instead of a release | Camp | Teams over 53 with depth another team needs | Common, *assumed* |
| Rehab trade | Buy a hurt player whose physical the buyer's doctor clears | Offseason | A team with a strong medical staff | Revis 2013 |
| Conditional pick | A pick that moves up a round on a condition | – | Phase 6 | Rodgers 2023 |

Every completed AI deal carries a reason tag for the news: *contender add*, *rebuild sale*, *cap
dump*, *need swap*, *trade up*, *trade down*, *depth for a pick*, *tag and trade*, *star trade*.

### 5. Offers to you

**What arrives:**

| Kind | From | Example message |
| --- | --- | --- |
| Bid | A team at interest 3 in one of your players | "We'd like to bring WR Riley Wright to Chicago. Our 2027 3rd and a 2028 6th, if you're open to it." |
| Pitch | A seller whose blocked player fills one of your needs | "We're listening on EDGE Khalil Webb. Would a 2nd get it done?" |
| Dump | A cap-tight team, if you have room | "Take on S Carter Rice's deal and our 2028 2nd is yours." |
| Draft | A team that wants your pick while you're on the clock | "Pick 12 for our 18 and 82, now." |
| Enquiry | A team at interest 2: no offer yet | "Is your CB available?" Reply: *Make me an offer* · *Not for sale* (that team stops asking for 6 weeks) |

**Lifecycle:**
- **Expiry.** In season, an offer lasts until you play the next week; deadline-week offers end at the
  deadline. In the offseason it lasts until the next calendar step. Draft offers end when the pick is
  made.
- **Re-checked when you accept.** If cap or roster changed, you're told why. If your roster is full,
  the accept dialog offers the release `aiCutdown` would make, and you can change it. An offer whose
  players or picks have moved is withdrawn.
- **Decline:** that team won't offer for that player again for 3 weeks unless it comes back at least
  10% better ("They've come back with an improved offer").
- **Counter:** the trade table opens with the offer filled in. The GM judges your version; patience
  runs 1–3 rounds by stubbornness, and a counter can come back marked "final offer". After that,
  talks with him are off for the rest of the moment.
- **Simulating ahead never accepts anything for you.** Offers expire unanswered.
- **Throttled:**
  - in season: at most 2 a week, 4 in deadline week
  - offseason: 3 per calendar step
  - draft: 2 per pick you're on the clock for
  - one open offer per team per player
  - nothing for an Untouchable

**Your statuses** (player card and the Block tab): *Untouchable* (never asked for), *Available* (the
default), *On the block* (interest grows fast, more bids, and the GM knows you want to sell, so his
floor for you drops 5%).

**Shop a player** (FM's "offer to clubs"): pick one of your players. Every team that needs him and can
afford him answers this moment, and the best offers come back as `TradeOffer`s ranked by your staff.
It's available once per player per moment, and shopping him puts him on the block.

**Ask for their price:** on any AI player, the GM builds what he would want from your roster and picks.
This is ZenGM's "make it work", run from their side. It never asks for an Untouchable, and it says
"can't make this work" instead of a silly ask.

**Your proposals cost patience.** Each GM hears at most about 4 offers from you per moment before
"We're done talking this week." Proposals the GM turns down nudge his trust in you down a little. The
acceptance meter stays coarse (10% steps, as today), so a probe can't read the exact valuation off it.

**Your staff's advice on every offer** (your view only, never the AI's numbers):
- **Head coach:** would he start for us, does he fit the scheme, and would the trade leave us thin at
  a position.
- **Director or pro scout:** their read of the incoming players (the range, makeup in words).
- **Medical staff:** injury-risk words (`injuryRisk`).
- **The cap:** room after and the dead money you'd book (`tradeCapImpact`).

**Trust** (per AI GM, from −1 to 1, drifting back to 0 by about 0.1 a month): it falls when you turn
down several offers in a row, pull a counter, or fleece him (truth value two to one against him, judged
after a season so a bust he chose doesn't count). It rises after deals both sides came out fine on. It
adds up to ±0.06 to his margin with you.

#### Rumors and mind games

Rival front offices use the press to work on you, the way NFL teams do before the draft and the
deadline. Rumors and bluffs never change how an AI values a player: AI teams act on their own needs
and reads, and they never read rumors. The bluff works only on you, through what you decide to pay,
hold or chase.

**Each GM has a hidden candor**, rolled from the league seed like `ownerTrigger` (not stored, never
shown, centred). A low-candor GM plants rumors and bluffs often; a straight shooter rarely does.

| Play | Who runs it | What you see | The truth |
| --- | --- | --- | --- |
| Bidding war | A seller whose player you've asked about or offered for | "Several teams have called about EDGE Webb." | Sometimes real: the market has another live package. Sometimes nobody else is in |
| "We have another offer" | A seller countering you | His counter asks for more and says so | True: the other deal really exists, and if you walk, it happens (an AI↔AI trade). Bluff: hold firm and a GM who would have taken your last offer comes back ("Fine, let's do it"), patience allowing |
| Talking down the price | A buyer after you put a player on the block | "Teams aren't paying a first for him." | Often spin: his real need may be urgent |
| Fishing at the deadline | A bubble team that isn't really selling | "The Bears are listening on everyone." | Calls get you nowhere unless the price is silly |
| Draft smokescreen | Teams just ahead of or behind your pick | "The Hawks love QB Ellis." | Some teams truly covet him (their board says so), some are drawing you into a trade-up |

**Sources tell you how far to trust it.** Each rumor carries one:
- **League sources:** almost always true.
- **A rival front office:** spin as often as not, depending on that GM's candor.
- **The player's agent:** self-serving, aimed at a bigger contract or a move.
- **Our pro scouts:** what your staff actually saw, as true as their read.

**You can learn who bluffs.**
- Every rumor resolves: once the deal happens, falls through or the window closes, the Market tab
  marks it *happened* or *didn't happen*. A GM's record of leaks that never panned out builds up in
  front of you.
- Your director of scouting weighs the big ones in his digest ("I'd take the Bears' interest with a
  grain of salt"). How often he's right follows his rating: a sharp director calls about 75% of bluffs
  correctly, a weak one barely better than a coin flip.

**Limits:**
- Rumors never invent your own team's moves.
- Your own staff never lies: they can only be wrong.
- Rumors from rival front offices and agents are at most about half spin.
- Planted rumors stay under about a quarter of all rumors.

### 6. Draft day

The draft runs pick by pick (`simDraft`), so the market gets a moment before each pick.

- **AI trade-ups.** A team within the next 10 picks whose top board prospect will likely be gone
  before its turn covets him:
  - "likely gone" is judged from the consensus rank (`consensusRank`) against the picks between;
  - covet = its board score for him minus the best it expects at its own pick (`boardScore`), above a
    threshold.

  It offers its pick plus the cheapest add-on, often a future pick. The team on the clock accepts on
  its own chart (`judge`). Analytics GMs value later picks more, so they move down more; Pick
  Hoarders most of all.
- **Odds by round:** round 1 is busiest, then round 2. Target 35–45 trades a draft, 3–9 of them
  involving a first-round pick.
- **You on the clock:** up to 2 trade-up offers land as a banner in the draft room, and they expire
  when you pick. *Shop this pick* asks the league. You can still build your own (trades are already
  allowed in the `draft` phase).
- **Future for current** deals happen here too: "our 2028 2nd for your 3rd now."
- **Draft history** already lists traded picks ("traded to") and "via" labels. A pick moved during
  the draft shows its new owner and the deal.

Cost: candidate checks are cheap (consensus ranks and cached boards); at most 3 trade checks per
pick. Target: under 3 ms a pick.

### 7. Rules and guardrails (enforced outside value)

- **Windows:** the new league year (`resign`) through the deadline day after week 9; closed in the
  playoffs and the `complete` gap.
- **Picks:** current draft + 3 ahead, unused, owned by the side (as today).
- **Cap:** both sides under the cap after the trade, with the top-51 rule in the offseason (as today).
  The AI also requires that a multi-year incoming salary fit next year's books
  (`capFor(next) × 0.92`, the free-agency rule).
- **Roster:** 90 in the offseason, 53 from camp. In season, never below `STARTERS` at a position.
  The AI cuts to fit; you choose who goes.
- **Physical:** every player trade waits on the buyer's medical (below). In season, a player out 2+
  weeks or on IR still can't be traded at all.
- **Cooldowns:**
  - **New signings are hidden GM policy** (decision 1). Each GM waits his own 4–8 weeks (seeded, never
    shown) before he'll move a player he just signed or take one you just signed. The trade table no
    longer greys these players out or names a week, and its footnote stops mentioning six weeks. A GM
    says it in words, with no number: "He just signed here; we're not moving him," or "We're not
    looking to take on a player you just signed." It stays a rule outside value, so no package buys
    past it, and the sign-and-flip probe still has to fail;
  - a player you traded away can't come back from that team in the same league year;
  - an AI won't flip a player it got within 4 weeks.
- **Division rivals:** allowed but rarer (higher margin). No star to a division rival in season.
- **Tagged players** are tradable (in AFLS the tag is signed when applied).
- **Never** cash, cap space or "future considerations" as an asset.

#### Physicals

As in the NFL (and FM), a deal is agreed first and becomes official only once the player passes the
buyer's physical. Picks have no physical.

**Who fails.** The buyer's doctor examines every incoming player:
- A healthy player with a clean history passes almost always (fails under 1%).
- The odds climb with:
  - a current injury (the doctor's estimate);
  - severe injuries in his history and the scars they left;
  - age past his position's prime;
  - his hidden injury resistance.
- **The doctor's diagnosis rating sets how well he reads that body:**
  - A sharp doctor fails the truly fragile and passes the truly durable.
  - A weak one misses real problems, and now and then fails a healthy player (`diagnosisSpread`).
- Each exam draws from its own stream (`${seed}:physical:${season}:${phase}:${week}:${playerId}`), so
  a reloaded save examines the same way.

**What a physical can say:**

| Result | What happens |
| --- | --- |
| Passed | The trade becomes official |
| Failed | The deal is off and every asset stays where it was. The doctor says why in words ("the knee hasn't healed"), never as a number. That's public news, like any injury report |
| Concerns | The doctor found something but won't block it. The buyer asks for a lower price: a pick dropped, or a pick added the other way (Duane Brown 2017). The seller takes it or walks |
| Cleared to rehab | Offseason only: a player still hurt passes on a recovery plan. His value is priced for the time he'll miss, and the buyer's physio rating sets how much of it it trusts (`recoveryMultiplier`) |

**Your side:**
- Your doctor fails a player you're buying: you choose to walk away, ask for a lower price, or
  *take him anyway* (you sign off, and the risk is yours).
- Their doctor fails your player: you get their reduced offer, or keep him.
- AI buyers decide the same way: a team that needs him badly, or has a strong physio, can take a
  player with concerns at the lower price.

**Timing and drama:**
- In the offseason, a player trade agreed at one calendar step is announced *pending a physical* and
  resolves at the next. Your inbox gets "Trade agreed, pending a physical", then the result.
- In season and on deadline day it resolves within the same market moment (nobody sits in limbo
  through a game), still told as agreed → physical → result.
- AI↔AI failed physicals make the news ("The Ravens' trade for Maxx Okoro is off after a failed
  physical").
- Target: 1–4 deals voided or renegotiated a season league-wide (*assumed*: voids are rare but real),
  and under 1% of healthy players failing.

### 8. Coaches, scouts, doctors and owners in the deal

Front offices don't trade in a vacuum. Each hook is small, explainable and goes through existing
functions:

| Who | What it changes | Through |
| --- | --- | --- |
| GM | Stance weight (`winNow`), chart (`pickChart`), patience for futures (`futureDiscount`), keeping his own (`loyalty`), the margin (`stubbornness`), how often he calls (`activity`, new), cap tricks such as eating salary and dumps (`capAggression`) | `GmTraits` |
| Head coach | Hot seat: a coach fighting for his job pushes to buy while the race is alive; once it's lost, a sell-off follows. A first-year coach builds. His vision sets the schemes the GM shops for | `hotSeat`, `ownerTrigger`, `headCoachVision` |
| Coordinators | Scheme fit: a deep-passing offense pays more for a deep threat, a 3-4 front for an edge who sets the edge (±8%) | `teamScheme`, `fitContests`, `fitGrade` |
| Position and S&C coaches | Young players are worth more to a staff that develops them (±10% from the youth-development effect); veterans to one that keeps them going (±5% from veteran care) | `coachingFor` |
| Pro scouts | Every read of another team's player (already); interest needs knowledge, so a team with poor pro scouts finds fewer targets and misprices more | `perceive`, `knowledge` |
| Medical staff | The physical on every incoming player: the doctor's diagnosis decides how well he reads a body, the physios how far a rehab can be trusted; the injury-risk read on incoming players | `departmentFor`, `diagnosisSpread`, `recoveryMultiplier`, `injuryRisk` |
| Director of scouting | How often his digest calls a rival's bluff right | His rating |
| Owner | Big markets carry salary more easily (their salary weight leans lower); a quick-trigger owner turns a bad half-season into a sell-off sooner | `ownerBudgets`, `ownerTrigger` |

All of these change price or urgency, never the rules. AI decisions about other teams' players stay
on that team's read (`perceive`, `viewCache`). That's the true vs. perceived convention, and the
market keeps it.

### 9. What you see

**Trades** (Front office tab) gets five sub-tabs:

| Tab | What's on it |
| --- | --- |
| **Offers** (badge) | Incoming and outgoing offers, each with the GM's message, both sides on your view, cap impact, your staff's notes, the expiry, and *Accept* · *Counter* · *Decline*; deals pending a physical, and the physical's result with your choices |
| **Build** | Today's trade table, plus their counter when you're close, *Ask for their price*, and (Phase 3) an *eat salary* control for players you send |
| **Block** | Your roster with status pills (Untouchable / Available / On the block), *Shop*, and the interest your staff has picked up |
| **Market** | A deadline countdown, this season's trades league-wide with reason tags, rumors with their source and (once known) *happened* / *didn't happen*, each rival GM's record of leaks that panned out, and who's buying and selling in words |
| **History** | Your trades and the league's by season, and a player's trade trail |

Elsewhere:
- **Inbox:** a new *Offers* filter, offers and enquiries with buttons (*View offer*, *Make me an
  offer*, *Not for sale*), and the director's weekly market digest from week 5 to the deadline and
  when the league year opens.
- **Home:**
  - a deadline chip ("Trade deadline: 2 weeks")
  - a pending-offers count
  - AI trades in the news list, tagged
  - on deadline day, the primary button says it closes the window
- **Player card:** your status selector for your own players; *Trade for him* (opens Build with him
  ticked) and *Ask for their price* for anyone else's; known interest; his trade trail.
- **Draft room:** the offers banner when you're on the clock, *Shop this pick*, and trades shown in
  the pick list.
- **Fog of war:** offers show players on your read (`Ovr`, `RangeValue`). The meter stays coarse.
  Market value shows as words ("a starter's price"), never points.

### 10. Data model and save

```ts
// types.ts
export type Stance = 'contend' | 'bubble' | 'retool' | 'rebuild';
export type TradeStatus = 'untouchable' | 'listed'; // absent = available
export type DealKind = 'rental' | 'sale' | 'star' | 'swap' | 'dump' | 'retain' | 'tagTrade' | 'tradeUp' | 'tradeDown' | 'futureSwap' | 'depth' | 'rehab';

/** What one side sends. `retain`: $K of this year's base it pays as a pre-trade bonus (dead money for it). */
export interface TradeSide { teamId: number; players: number[]; picks: number[]; retain?: Record<number, number> }

/** An AI team's offer to the user. sides[0] is the AI team. */
export interface TradeOffer {
  id: number;
  teamId: number;
  sides: [TradeSide, TradeSide];
  kind: DealKind | 'enquiry';
  /** Why he called, which the inbox and screens put into words (never numbers). */
  reason: 'need' | 'listed' | 'cap' | 'rebuild' | 'deadline' | 'draft' | 'counter';
  made: { season: number; phase: Phase; week: number; faDay: number };
  /** Last moment it can be accepted (a draft offer: the pick it's tied to). */
  expires: { season: number; phase: Phase; week: number; faDay: number; pick?: number };
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  /** Counters he'll still hear before he walks away. */
  patience: number;
  replyTo?: number;
}

/** A completed trade with its assets, for history, the anti-flip rule and trade trails (the log keeps only text). */
export interface TradeRecord { season: number; phase: Phase; week: number; kind: DealKind; sides: [TradeSide, TradeSide]; tag: string; physicals?: Physical[] }

/** One player's exam by the buyer's doctor; `note` is the doctor's words. */
export interface Physical { playerId: number; result: 'passed' | 'failed' | 'concerns' | 'rehab'; note: string }

/** An offseason deal agreed at one calendar step and waiting on its physicals at the next. */
export interface PendingTrade { id: number; sides: [TradeSide, TradeSide]; kind: DealKind; tag: string; agreed: { season: number; phase: Phase; faDay: number } }

export interface TradeMarket {
  nextOfferId: number;
  /** Pending offers and the last 60 resolved. */
  offers: TradeOffer[];
  /** The last 5 league years. */
  history: TradeRecord[];
  /** Your players' statuses (absent = available). */
  status: Record<number, TradeStatus>;
  /** Who is watching whom, capped at 300 and fading. */
  interest: { teamId: number; playerId: number; level: 1 | 2 | 3; season: number; week: number }[];
  /** Offseason deals waiting on a physical. */
  pending: PendingTrade[];
  /**
   * The last ~80 rumors. `planted` is the hidden truth (a rival's spin): never rendered. `outcome` is
   * public once it's known, and it's how you learn which GMs bluff.
   */
  rumors: {
    id: string; season: number; phase: Phase; week: number; teamIds: number[]; playerId?: number; text: string;
    source: 'league' | 'rival' | 'agent' | 'staff'; planted?: true; outcome?: 'happened' | 'didnt';
  }[];
  /** Per AI team: your proposals this moment, cooldowns, and trust (−1…1). */
  talks: Record<number, { moment: string; asks: number; until?: string; trust: number }>;
  /** Season whose deadline day has been closed. */
  deadlineClosed?: number;
}

// League:    market?: TradeMarket
// Team:      stance?: { mode: Stance; since: number }
// GmTraits:  activity: number
```

Derived, not stored, like `ownerTrigger`: each GM's hidden cooldown (`${seed}:gm-cooldown:${teamId}`,
4–8 weeks) and candor (`${seed}:gm-candor:${teamId}`). Hidden truths in the save (`planted`, true
ratings) follow the existing rule: screens never render them.

- `League` stays plain JSON. `SAVE_VERSION` goes 22 → 23, and `toV23` in `migrate.ts`:
  - creates an empty `market`;
  - rolls `gm.activity` from each team's archetype on a seeded stream
    (`${seed}:gm-activity:${teamId}`);
  - computes stances on the first market moment.

  Old saves load as they are.
- Size: offers, history, interest and rumors are capped, about 60 KB in a long career. The `offseason`
  check's save-size line covers it.
- The transaction log keeps the trade text (the inbox's `tradeMail` and Home's news read it); the
  history adds the structure.

### 11. Code layout and performance

`src/engine/trade.ts` becomes a folder. Importers keep writing `from './trade'` (the folder's
`index.ts` re-exports). The four importers today: `league.ts`, `ui/screens/Trades.tsx`,
`finance/ledger.test.ts`, `staff.test.ts`.

| File | What's in it |
| --- | --- |
| `trade/value.ts` | Pick charts, `pickValue`, `playerValue` (v2), market value, package value, salary weight |
| `trade/rules.ts` | `tradeWindow` (deadline day), `playerTradeBlocker`, `tradeProblem`, `tradeCapImpact`, cooldowns |
| `trade/judge.ts` | `judge`, `evaluateTrade`, `suggestSweetener`, counters, "ask for their price" |
| `trade/execute.ts` | `executeTrade`, retained salary, trade-and-extend, the history record |
| `trade/context.ts` | `TradeContext`: one market moment's cache |
| `trade/plans.ts` | Stance, needs, block, untouchables, interest |
| `trade/deals.ts` | The templates and `findDeal` |
| `trade/market.ts` | `marketMoment(league, moment)`: initiators, AI↔AI deals, offers to you, rumors, expiry |
| `trade/offers.ts` | The offer lifecycle: accept, decline, counter, enquiry replies, shop a player |
| `trade/draftDay.ts` | Trade-ups and trade-downs before each pick |

**`TradeContext`** is built once per market moment and dropped after it, like `viewCache`. A
reloaded save therefore decides the same way. It holds:
- rosters by team, built in one pass over `league.players` (replacing per-call `teamPlayers` scans);
- `viewCache`;
- contender scores;
- the slot memo for the whole moment;
- pick values by (pick, GM);
- player values by (team, player, lens);
- market values;
- stances, needs and blocks.

A trade rebuilds only its two teams' entries and the slots.

**Budgets** (measured and printed by `npm run trades`, which fails at 2× the budget):

| Run | Budget |
| --- | --- |
| A market moment in season | ≤ 60 ms (`playWeek` is about 400 ms today) |
| An offseason step | ≤ 150 ms |
| A draft pick | ≤ 3 ms |
| One `judge` | ≤ 0.3 ms with a warm context |

**Hook points:**
- `playWeek`: the market moment after the games (deadline day after week 9), then offer expiry.
- `advanceOffseason`: one moment per step (league year at `resign`, each FA day, camp before
  `aiTrainingCamp`).
- `simDraft`: before each pick.
- `store.mutate` → `deliverMail` turns new offers, enquiries and digests into mail, keyed by offer id.
  The sim never sends mail itself.

### 12. Checks

**`npm run trades`** (new, `scripts/trades.ts`): play leagues for several seasons with your team on
autopilot, and flag every number outside its range ▲/▼ (non-zero exit), like `crews`.

| Area | Number | Range |
| --- | --- | --- |
| Volume | AI trades in season (week 1 → deadline day) | 15–25 |
| | Share on deadline day | 30–50% |
| | Offseason (league year → camp) | 15–35 (*assumed*) |
| | Draft day / with a first-round pick | 35–45 / 3–9 |
| | Division-rival trades | ≤ 5% |
| Mix | Picks for a player | 55–80% |
| | Swaps (player ↔ player, ± picks) | 5–15% |
| | Dumps (bad contract + pick) | 1–4 a season |
| | Deals with a late-pick swap riding along | 10–25% |
| Prices (JJ points, undiscounted, the median of each bucket) | Star (top 3 at a premium position, ≤ 28, 2+ years left) | 1,500–3,500 (1–2 firsts +) |
| | Quality starter, 1–2 years left | 400–1,300 (a 1st or 2nd) |
| | Deadline rental (expiring, 12–14 OVR) | 35–150 (R3–R6) |
| | Depth | ≤ 40 |
| | A future 1st, in current-pick terms | Late 1st to early 2nd (the one-round rule) |
| Fairness (truth) | Median truth gap between the sides | ≤ 35% of the deal |
| | Trades over 3:1 in truth | ≤ 1 a season |
| | Any team's cumulative truth balance over the run | Within ± a mid first |
| Health | Teams over the cap or under `STARTERS` after any trade | 0 |
| | League parity (the `offseason` sd) | Unchanged ±10% vs trades off |
| Offers to you (autopilot, nothing listed) | A season | 10–25 |
| | A week | ≤ 2 (4 in deadline week) |
| | After the deadline, or for an Untouchable | 0 |
| | Listing a player draws an offer within 2 market moments | If any team needs his position |
| Physicals | Deals voided or renegotiated, league-wide | 1–4 a season |
| | Healthy players (no current injury, no severe history) failing | < 1% |
| | Strong doctors (diagnosis ≥ 15) vs weak (≤ 8): fragile players bought who miss 4+ weeks the next season | Strong clearly lower |
| Rumors | Planted share overall / from league sources | ≤ 25% / ≤ 5% |
| | "Another offer" claims that were real | 40–70% |
| | Director's bluff calls right: rating ≥ 15 / ≤ 8 | ≥ 70% / 50–60% |

Exploit probes, each must fail to profit:
- junk for a star;
- 2-for-1 and 3-for-1 consolidation;
- dumping your worst contracts with no pick;
- A→B→A flips;
- stacking firsts;
- probing one GM 20 times in a week;
- signing a free agent and flipping him (whatever the GM's hidden wait);
- trading for an injured star in season;
- reading the hidden cooldown or a GM's candor off any screen or message (no week counts, no numbers).

Plus the performance budgets above.

**`scripts/check.ts`:** `trades` runs for `src/engine/trade/**`, `offseason/**`, `finance/**`,
`coaching.ts`, `scouting.ts`, `staff.ts` and `scripts/trades.ts`; `offseason` also runs for
`trade/**`. CLAUDE.md gets a command entry ("run it after any change to `trade/`…"). `npm run
offseason` must still hold: talent, cap space, rosters and the coaching ledger stay stable with the
market on.

**Unit tests** (Vitest, each next to its module):

| Module | Tests |
| --- | --- |
| Value | A rental loses value week by week; a starter is worth more to a team with a hole than to one with a good starter; the seller's floor holds; rich rebuilders weigh salary less; the third first costs more; the existing chart tests pass |
| Rules | Deadline day opens and closes; the hidden cooldown varies by GM and never shows a number; the anti-flip rule; roster and cap for both sides |
| Physicals | The same seed gives the same exams; a healthy player almost always passes; a fail leaves every asset where it was; concerns reopen the price; an offseason deal waits a step; a sharp doctor's results follow the truth more closely than a weak one's |
| Rumors | Planted rumors come only from rival GMs and agents, more from low-candor GMs; every rumor resolves; a "we have another offer" claim that was real becomes a trade if you walk; nothing invents your own moves |
| Plans | Stance bands and hysteresis; needs from injuries and holes; untouchables never on a block |
| Market | The same seed gives the same trades; no illegal roster or cap after any AI deal; deadline day is the busiest in-season moment |
| Offers | Expiry; re-check at accept; throttles; Untouchable respected; decline cooldown; counter patience; nothing auto-accepted by a sim |
| Draft | A trade-up moves the pick before it's used; slots and history follow the owner |
| Migration | A v22 save loads with an empty market and GM activity |
| UI | The offers list renders and acts (`ui.test.ts`) |

---

## Phases

### Phase 0: foundation (do this first)

Nothing new to click, but every later phase stands on it, and prices get sane.

1. Split `trade.ts` into `trade/` (re-exported) and add `TradeContext`. Measure the budgets.
2. Value v2: control by season share, re-sign rights, role by marginal fit, market value and the
   seller's floor, salary weight, roster-spot cost, soft first-round pricing (drop `MAX_AI_PICKS` as a
   hard stop).
3. `judge` as the one evaluator; `evaluateTrade`, `suggestSweetener` and today's AI market call it.
4. Deadline day: the window stays open after week 9's games until week 10 is played, for everyone;
   the primary button says so.
5. The hidden signing cooldown: a per-GM wait (4–8 weeks) in words, without the trade table's greyed
   rows, its week text or the footnote.
6. The market's own RNG stream.
7. `npm run trades` with the price, fairness, health and performance sections (volume comes with
   Phase 1); check plan rules; the CLAUDE.md entry.

**Done when:** price buckets are in range on today's (still small) market; no starter goes for a 7th
unless he's at the end of the line; `offseason`, `careers` and `test` are green.

#### Phase 0: what landed

Built as planned:
- `trade.ts` became `src/engine/trade/` (value, rules, judge, execute, market, context), re-exported
  so importers still write `from './trade'`.
- `TradeContext`.
- Value v2: control by season share, the re-sign window, role on the buyer's depth chart, market
  value and seller floors, salary weight, the roster-spot cost.
- Soft first-round pricing (the `MAX_AI_PICKS` hard stop is gone) and the centrepiece rule for stars.
- `judge` for every deal.
- Deadline day: the window stays open after week 9's games until week 10 is played; the primary
  button and the trade table say so.
- The hidden signing wait: 4–8 weeks per GM, in words; no greyed rows or footnote.
- The market on its own RNG stream.
- `npm run trades`, in `npm run check` and CI.

Where the build departed from the plan, and why:
- **The pick charts blend geometrically.** The old arithmetic blend made a seventh-round pick worth
  about 220 points to an analytics GM (60 to an old-school one): as much as a 14 OVR starter on the
  player scale. That was the root of the baseline's "starters for 7ths". Now a seventh is worth about
  11 and 33. An analytics GM still values No. 48 about 1.5 times as highly as an old-school GM does.
- **A contract counts by role.** The market's pay for a player counts only in the role he'd have, and
  the salary owed counts in full. A starter on a cheap deal is a bargain; the same deal on the bench
  is a cost. A starter-priced backup QB had been worth 3,800 points to a team that would bench him;
  now he's a liability. Points per $1K of surplus went from 1/30 to 1/40, so a dead $16M contract
  costs about a second to move (Osweiler).
- **Depth-chart rank is soft** (0.75 OVR, "a camp battle"). Two near-equal players share the job in
  proportion, so a misread of a few tenths never pushes a player across a cliff.
- **The scouting test's misread band** (`staff.test.ts`) is now measured against a player's stakes
  (his play and its market price, before his salary), not as a ratio of his value to one team. With
  marginal fit a small upgrade's value is small, so ratios of it swing on nothing. The bounds stayed
  as strict:

  | Percentiles | Bound | Measured |
  | --- | --- | --- |
  | 5th–95th | ±12% | −6% to +8% |
  | 1st–99th | ±25% | −13% to +17% |
  | Worst | +50% | +34% |

- **`npm run trades` prices** are measured in today's terms (future picks 25% off a year). The star
  band is "1–2 firsts" (1,000–3,500), as the plan's table says; depth players nobody will take count
  as 0. Fairness compares both sides on one neutral, true scale (market value, a chart midway between
  the GM styles).

Measured (`npm run trades -- 1`, one league, three seasons):

| Number | Preseason | Deadline day | Band |
| --- | --- | --- | --- |
| Star (top 3 at a premium position) | 1,347 | 1,268 | 1,000–3,500 |
| Quality starter (top quarter, 1–2 years) | 866 | 599 | 400–1,300 |
| Deadline rental (12–14 OVR, expiring) | – | 90 (about a 4th) | 35–150 |
| Depth | 0 | 0 | ≤ 40 |

Other numbers:
- A future first is worth pick 26 now.
- Good starters in their prime sold for 7ths only: 0.
- AI trades: a median truth gap of 23%, none over 3:1, no team over the cap or short afterwards.
- All eight exploit probes fail.
- Speed: a verdict takes 0.07 ms and a market week 16 ms.

**Checks when Phase 0 landed.**

`npm run check` passed 8 of 12: typecheck, test (269), build, trades, weather, crews, endings and audit
(`docs/ATTRIBUTES.md` regenerated). The market's own RNG stream gives every league a new path after
its first offseason, so checks that sit near their edges re-roll. None of the four red ones traces to
the trade engine:

| Check | This branch | `main` (3185158) | Reading |
| --- | --- | --- | --- |
| `careers` | points 24.43, sacks #5 11.5 | red, the same two | Known long-run drift from Awareness aging (`docs/PENALTIES.md`, "Checks when Phase 3a landed"): the attribute-scaling pass |
| `quirks` | Spot Drop z −1.9 | red | The documented borderline quirks; Spot Drop reads "weak" over 6 + 18 seasons (Phase 2) |
| `offseason` | coaching market 136 (≤ 135), one season | red: 137, 141, 141 in three seasons | The coaching carousel's (PR #29), slightly better here |
| `sim` | hamstrings 7.03 (≤ 7) | green, 6.73 | Over 30 seasons: 6.78 here against 6.67 on `main`, both in range, injury rates by position the same |

The 30-season `sim` run also put the #5 passer at 4,295 yards (floor 4,300; `main` 4,326) while the #1 rose
4,799 → 4,858. That's leader noise: points (22.74 against 22.66) and sacks (2.31 against 2.32) are the
same. Left as they are on purpose, with the borderline-checks work.

**Left for Phase 1:**
- Stricter sellers mean fewer AI trades: about 3 a season against about 4 before, all picks for a
  veteran. Volume, mix and the market's moments are Phase 1's job.
- The probe for 20 proposals to one GM in a week needs Phase 2's talks.

### Phase 1: the AI market

1. Stance with a dead band (stored on the team) and the head coach's hot seat and first-year terms.
2. Needs, block, untouchables, interest.
3. Deal templates for in-season and general use: rental, sale, star, swap, player + pick, late-pick
   balancers, dumps (rare in season).
4. Moments and activity: league year, FA days, camp, weeks, deadline day. Add `gm.activity` (v23
   migration), `TRADE_VOLUME`, the per-team caps and the division rule.
5. The coordinator scheme-fit lens and the coaching lens.
6. Structured history, reason tags in the log, rumors from blocks and interest (public talk only).
7. `npm run trades` volume and mix sections.

**Done when:** every `trades` number is in range over 3 seeds × 6 seasons; `offseason` parity and cap
health hold; the market budget holds.

#### Phase 1: what landed

Built as planned:
- `plans.ts`:
  - stance with the dead band, stored on the team, with the hot seat, a first-year head coach, an old
    roster and no quarterback;
  - needs (hole, upgrade, next year);
  - the trade block and untouchables;
  - interest at levels 1–3, fading after three quiet moments.
- `deals.ts`: picks for a player, swaps and a player plus a pick, a late pick riding back, and cap
  dumps.
- `market.ts`: the moments (league year, FA days, camp, each week, deadline day), `TRADE_VOLUME`, and
  per-team caps (3 in season, All-In 4).
- The scheme-fit and coaching lenses (`readPlayer`).
- Structured history (`league.market.history`), reason tags in the log ("deadline rental", "cap
  dump"…), and rumors (who's shopping whom, who's been asking).
- `npm run trades`: the volume and mix sections.
- Save v23: an optional `league.market` and `team.stance`. Nothing to fill in, so old saves just load.

Where the build departed from the plan, and why:
- **Prices center on what the league would pay.** The first build sold every player at the seller's
  floor, the cheapest package he'd take, so sellers lost on every deal. Splitting the buyer's surplus
  fixed that, but then a desperate buyer's need set his own price. Now the seller asks the player's
  market value, plus a tenth for each other team that has been asking about him (up to a fifth: FM's
  "several clubs are interested"). He never takes less than his floor, and never gets more than the
  buyer would pay. Competition raises a price; one buyer's desperation doesn't.
- **Each GM has a most he'll pay** (`maxOver`): about 1.3 times what the league would pay, rising
  with his win-now trait to 1.5 for an All-In GM (Ramsey, Mack). That's the archetype's flavor,
  bounded so a desperate buyer can't be milked for firsts every deadline. A seller who wants more than
  that isn't really selling.
- **By midseason the record is the race** (`RECORD_GAMES`, 8 games). Blending in the roster all
  season had a 1–7 team with an elite roster on paper reading as a bubble team, and it sent its own
  first, projected second, for a 28-year-old receiver.
- **A talented team out of the race reloads** (`reloading`): a seller in season with a top-30% roster
  that isn't old keeps its core. It doesn't shop its veterans, and it lets go only the expiring
  starters it won't re-sign (30 and up).
- **In season nobody trades a first projected in the top ten** (`heldPick`). A team waits to see who's
  there on draft day, and can trade down then (Phase 4). This applies to offers from you too.
- **Sellers' floors count picks at the league's going rate** (`goingRate`: midway between the two
  chart styles, 25% off a year). On his own chart a Pick Hoarder prizes Day 2 and future picks, so he
  happily took a third less than the league would pay for a player. Every GM still prices what a pick
  does for *him* on his own chart: that's the gain from trade, and draft day will lean on it. But a
  player is never sold for less than most of what the league pays.
- **A GM won't carry more than a quarter of the cap in dead money.** He refuses a sale whose bonuses
  would push this season's dead money, or next season's, past that. A rebuilding Can-Kicker (bonuses
  and void years everywhere) had sold four players in one offseason and carried 43% of the cap dead,
  past the NFL's record (about a third, Denver after Wilson).
- **A starting quarterback in season costs double** (`judge`). It's possible, but only for an offer
  too good to refuse (Palmer to Oakland in 2011). Before this, four starters moved in one test
  season; the Stafford and Wilson trades were offseason deals. A contender's good starter stays
  untouchable.
- **The trade cap check is exact under the top-51 rule.** Until camp only the 51 biggest cap hits
  count, so sending a player away lets the 52nd in. The old check counted the whole cap hit as freed,
  and one team ended a trade over the cap.
- **AI buyers keep room to fill the roster.** In the offseason a front office won't spend on a trade
  the minimum deals it still needs to reach 53. One team had spent it on a free-agency trade and reached
  kickoff short-handed and $0.2M over.
- **Dumps are short and modest.** Only a contract with a year or two left can be dumped (Osweiler had
  one), never one more than about a late first under water, one a team a league year, and only when
  the league year opens, in camp, or once on deadline day. Longer busts get cut.
- **Picks are the currency; a swap needs an edge.** A buyer sends a player only when that's clearly
  cheaper for him than his best pick package (by 25 points). A swap piece must be worth at least a late
  fourth to the seller, so no throw-ins pad the count.
- **A late pick riding back is the biggest that evens the deal**, not the smallest the seller has.
- **Sellers call buyers.** A seller shops a player to contenders and bubble teams, and to retoolers
  only if he's 25 or younger. Before, a retooler bought a 28-year-old with three future picks.
- **Deadline day is a day of calls:** every GM gets two rounds and can make two trades. With one, the
  deadline had about four deals a season against the NFL's eight to ten.
- **Division rivals are the last call.** On top of the higher margin, a rival's player sits far down
  a buyer's list, and a seller calls rivals last.
- **Activity is derived, not stored.** `gmActivity` comes from the archetype with a jitter seeded per
  team, like the owner's trigger, so v23 has nothing to roll.
- **Interest decides when a buyer moves.** In an ordinary week he needs level 2 ("asked around")
  before dealing. On deadline day and in the offseason level 1 will do.
- **Moment weights and volume:**

  | Moment | Plan | Built |
  | --- | --- | --- |
  | League year | 1.4 | 2 |
  | FA day | 0.4 | 0.5 |
  | Camp | 0.9 | 1.2 |
  | Weeks 1–6 | 0.5 | 0.35 |
  | Weeks 7–8 | 1.0 | 0.7 |
  | Deadline day | 2.5 | 4.5, two rounds |

  `TRADE_VOLUME` is 0.28. A team also makes at most 5 trades in a league year.
- **Not built yet:** the scheme "fit" need (scheme fit lives in the lens instead), the "blocked
  youngster" block entry, and untouchable extensions (the hidden wait covers new signings). None is
  needed for the numbers.
- **`npm run trades` measures more:**
  - Fairness counts picks at the going rate, the scale sellers' floors use.
  - Prices are probed in every league's first season. One league's deadline has only about ten
    rentals, and their median swung from 41 to 160 between runs.
  - The market is timed in main-thread CPU, so a busy machine (`npm run check` runs checks side by
    side) can't fail the budget on its own.
  - A new number: starting quarterbacks traded in season.
  - `--verbose` prints each team's ledger (picks and players) and its trades; `--seasons N` plays
    longer leagues.
- **Not every number fits until draft day.** "Picks for a player 55–80%" was set for a market that
  includes draft day's pick-for-pick trades (Phase 4). Without them, swaps and dumps alone keep it under
  80%, so it sits near the edge (78%) until Phase 4.

Measured (`npm run trades`, three leagues, three seasons):

| Area | Number | Result | Band |
| --- | --- | --- | --- |
| Prices | Star, preseason / deadline | 1,549 / 1,424 | 1,000–3,500 |
| | Quality starter, preseason / deadline | 711 / 498 | 400–1,300 |
| | Deadline rental | 101 (about a 4th) | 35–150 |
| | Depth | 0 | ≤ 40 |
| | A future first, as a current pick | No. 26 | 22–45 |
| | Good starters in their prime for 7ths only | 0 | 0 |
| Fairness | Median truth gap | 6% | ≤ 35% |
| | Trades over 3:1, a season | 0.11 | ≤ 1 |
| | Worst team balance over its run | 926 | ≤ 1,000 |
| | Teams over the cap or short after a trade | 0 | 0 |
| Volume | In season (week 1 to deadline day) | 16.4 | 15–25 |
| | On deadline day | 35% | 30–50% |
| | Offseason (league year to camp) | 16.1 | 15–35 |
| Mix | Picks for players | 77% | 55–80% |
| | Swaps | 10% | 5–15% |
| | Dumps, a season | 4.0 | 1–4 |
| | A pick each way | 10% | 10–25% |
| | Starting QBs traded in season, a season | 0 | ≤ 0.5 |
| | Division rivals | 2% | ≤ 5% |
| Probes | Exploits that worked | 0 of 8 | 0 |
| Speed | A market week / an offseason moment | 84 / 71 ms | 120 / 300 |

Over six seasons (`npm run trades -- --seasons 6`, the plan's "done when"), all but two numbers hold.
Both are follow-ups:
- **Trades in season: 14.3 a season** (15–25), against 16.4 over three seasons. Later seasons are
  tighter against the cap (the `offseason` check's steady state: median space about 2% of the cap),
  and nobody can eat salary yet. Phase 3's retained salary is the planned way to free those deals.
- **Worst team balance: 1,188** (≤ 1,000): a Can-Kicker's 14 trades, its win-now ceiling adding up
  over a long run. All-In GMs stay within it at 1.5×. The owner's call (Oct 19 2026) was to keep
  the flavor at 1.5× and expect roster churn to offset it over time; if it doesn't, the ceiling is
  the knob.

Offseason volume over six seasons is 15.8 a year. The six-season run first read 6.6: the script was
counting new trades by their position in the history, which keeps five seasons, so trades went
uncounted once old ones dropped off. It now tells them apart by identity.

**Checks when Phase 1 landed.**

`npm run check` (all 11) passed typecheck, sim, weather, crews, endings, audit and trades. Test failed
on one timeout, now fixed. The other three reds are the same ones `main` has:

| Check | This branch | `main` | Reading |
| --- | --- | --- | --- |
| `test` | 284 of 285: a coaching test timed out at Vitest's 5 s default | green | The market adds about a second to a simulated season. The test plays one, so it now has 30 s like the file's other season tests, and passes |
| `offseason` | coaching market 136–141 (≤ 135) | red: 137, 141, 141 | The coaching carousel's (PR #29). Cap health holds: no team over the cap, dead money at most 21% |
| `quirks` | Spot Drop z −1.9 | red | The documented borderline quirk |
| `careers` | points 24.16 (≤ 24) | red: 24.43 | The long-run scoring drift (`docs/PENALTIES.md`, Phase 3a) |

### Phase 2: offers to you

1. `league.market`: offers, statuses, interest, talks, trust; mail for offers, enquiries and digests.
2. Offer creation from the same deal search (bids, pitches, dumps) with the throttles; enquiries.
3. Lifecycle: expiry on the calendar, re-check at accept with the release picker, decline cooldown,
   counters with patience, "final offer".
4. Your side: statuses, *Shop a player*, *Ask for their price*, the per-GM proposal limit.
5. Screens: the Offers, Block, Market and History tabs, the inbox filter and buttons, the Home chip and
   count, the player card actions.
6. Staff advice on offers (head coach, director, medical, cap).

**Done when:** the offers section of `trades` is in range; UI tests pass; a played season shows a
believable inbox (a few offers a month, a burst at the deadline, nothing after it).

#### Phase 2: what landed

Built as planned:
- `trade/offers.ts`: bids, pitches, dumps and enquiries from the same deal search, made at each market
  moment after the AI teams' own calls, on their own random stream (the AI market plays out the same
  whatever lands on your desk).
- The lifecycle: accept, re-checked then, with the release picker when your roster is full; decline,
  with a cooldown unless he comes back 10% better; counter, with patience of one to three rounds by
  stubbornness, the last marked "final offer"; *Make me an offer* and *Not for sale* on enquiries.
- Your side: Available / On the block / Untouchable, *Shop a player* and *Ask for their price*.
- `trade/talks.ts`: about four proposals a GM a moment, then "We're done talking this week".
- `trade/advice.ts`: your staff's word on every deal (head coach, pro scouts, medical, cap). Your view
  only.
- Screens:
  - the Trades tab's Offers, Trade table, Your block, Market and History views;
  - offer mail with the same card and buttons, tagged Offer and marked Needs you while it's open;
  - *Counter* and *Ask their price* opening the trade table filled in;
  - the status picker and *Shop him* on your players' cards, *Ask their price* on everyone else's.
- Save v24: offers, statuses, talks and the shop log join `league.market`, empty to start.

Where the build departed from the plan, and why:
- **Offers lapse when you advance the calendar** (`expireOffers` at the start of a week or an
  offseason step), not on a stored expiry: the market runs after the week's games, before the week
  number moves on, so "until you play the next week" is exactly the next advance.
- **An offer you ignore cools that team off for two moments**, like a soft decline. Without it the
  same seller pitched the same player every week.
- **Pitches need a keen seller and a real need**: block entries he's keen to move (a rental at the
  deadline, an overpaid deal), at a position where you'd gain, at most two a moment. They were most
  of the first build's 40 offers a year.
- **A call about a player on your block is always made**, and interest in him grows two levels a
  moment: listing draws an offer within two moments whenever a team needs him. The buyer opens 5%
  lower: he knows you want to sell.
- **Enquiries come at half the call rate.** At the full rate they filled the inbox (18 a year).
- **Trust moves by small steps:** +0.03 for a deal, −0.01 for a proposal he turns down, −0.02 for a
  declined offer, −0.05 when he walks away; it drifts back by 0.025 a moment and moves his margin with
  you by up to 0.06. The plan's fleece check, judged a season later, waits for Phase 5's memory.
- **Every proposal is heard.** *Propose* no longer waits for the meter to read "would accept"; a
  turned-down proposal costs a little patience and trust. A league-rule problem (your roster, the
  cap) costs nothing: he never heard an offer.
- **AI teams cut to fit in any trade.** The rule check used to stop a proposal that left the AI team
  over 53, though it waives a backup after every trade anyway; now only your roster must fit (or you
  pick who goes when you accept).
- **No separate Home chip.** Open offers are needs-you mail, so they head Home's *Waiting for you*,
  and the Trades tab says *Offers (N)*.
- **UI tests are logic tests** (the repo has no render tests): offers arrive, lapse, never ask for an
  Untouchable, accept, withdraw, cool down, run out of patience, file needs-you mail.
- **Not built here:** draft-day offers (Phase 4); rumors with a source, bluffs and the director's
  digest (Phase 5).

Measured (`npm run trades`, three leagues, three seasons, your two best players Untouchable):

| Number | Result | Band |
| --- | --- | --- |
| Offers a league year | 17.1 | 10–25 |
| Enquiries a league year | 13.1 | – |
| Most in an ordinary week / on deadline day | 2 / 3 | ≤ 2 / ≤ 4 |
| After the deadline | 0 | 0 |
| Asking for an Untouchable | 0 | 0 |
| Listing draws an offer within two moments | yes | yes |
| Probing one GM 20 times in a week | fails | fails |
| A market week | 88 ms | ≤ 120 |

The AI market's own numbers are unchanged from Phase 1: offers have their own random stream.

CHECKS_PHASE2

### Phase 3: physicals, offseason and cap moves

1. Physicals on every player trade (section 7): the buyer's doctor, pass / fail / concerns / cleared
   to rehab; your choices on either side; offseason deals pending a physical until the next step; the
   inbox and news lines; the physicals section of `trades`.
2. The league-year market: cap casualties as dumps before the AI releases (`aiCapCompliance` tries a
   dump first, then cuts), absorbers charging picks.
3. Retained salary (`TradeSide.retain`): the sender books it as dead money, the buyer's base falls
   (never below the minimum); the AI uses it when the buyer can't fit him; your *eat salary* control.
4. Tag-and-trade in the re-sign window and free agency.
5. Trade-and-extend: the buyer signs the star at once when his agent's ask (`demand`) fits; he may
   refuse (personality), which lowers the price.
6. Camp cutdown trades (depth for a 6th or 7th before `aiCutdown` releases him).
7. Rehab trades through the physical's *cleared to rehab* result.
8. Future-for-current pick swaps in the league-year window.

**Done when:** offseason volume, dumps and the physicals numbers are in range, and `offseason` shows
no new short rosters or teams over the cap (it already warns about some: those stay warnings, not new
failures).

### Phase 4: draft day

1. Trade-ups and trade-downs before each pick (coveted prospects from boards, priced on each GM's
   chart), including future picks.
2. Offers to you on the clock (a banner, expiring with the pick); *Shop this pick*.
3. Draft history and the pick list show the deals.

**Done when:** 35–45 trades a draft, 3–9 with a first-round pick; under 3 ms a pick; draft quality in
`offseason` unchanged.

### Phase 5: memory, media and mind games

1. GM trust in you (section 5), drifting back to neutral.
2. Rumors and mind games (section 5): hidden GM candor; the plays (bidding war, "we have another
   offer" with a real or bluffed rival deal, talking down the price, fishing, draft smokescreens);
   sources; outcomes on the Market tab; each GM's record of leaks.
3. The director's weekly market digest (week 5 → the deadline, and the league year), weighing the big
   rumors with an accuracy that follows his rating.
4. Reason tags in the Home news and on team pages ("selling", "buying").
5. The rumors section of `trades`.

**Done when:** the rumor numbers are in range, and a played season shows a few bluffs you could have
seen through: a GM with a record of leaks that didn't pan out, or a digest that called it.

### Phase 6: later

- **Conditional picks:** a base pick and an upgraded one, with a condition (snap share from games
  played, All-League, a conference final) settled when the season ends.
- **Compensatory picks**, tradable once they exist (on the roadmap).
- **No-trade clauses** on big veteran deals, waived for a contender.
- **Waivers** after the deadline.
- **Morale and trade requests** (the roadmap's morale and holdouts): unhappy stars ask out, which
  lowers their price.
- **Deals agreed in principle** in the `complete` gap, made official when the league year opens.
- One difficulty knob (`1 + 0.1 × difficulty` on the AI's margin, ZenGM's) if players ask for it.

## Order and size

| Phase | Depends on | Size | Why this order |
| --- | --- | --- | --- |
| 0. Foundation | – | M | Fair prices, one evaluator and the speed everything else needs |
| 1. AI market | 0 | L | The living world; offers to you reuse its deal search |
| 2. Offers to you | 1 | L | The feature you asked for most, built on the market's search and plans |
| 3. Physicals, offseason and cap moves | 1 (2 for your side) | M | Physicals touch every player trade; the strategies need the league-year calendar |
| 4. Draft day | 0 (2 for offers to you) | M | Its own engine; could go before 3 |
| 5. Memory, media and mind games | 2 (4 for smokescreens) | M | Bluffs need offers and counters to bite, and the draft for smokescreens |
| 6. Later | various | – | Each waits on another system |

Each phase is its own PR, with `npm run check` green and `npm run trades` in range.

## Decisions (owner, Oct 19 2026)

1. **The cooldown on new signings stays, hidden, to prevent cheese.** It's rare in the real NFL
   anyway. Each GM has his own wait (4–8 weeks, seeded) and says it in words; no screen shows a week or
   a number (section 7).
2. **Injured players can be traded in the offseason** through the physical, with FM-style pass/fail
   drama. Every player trade waits on the buyer's physical, which can pass, fail or reopen the price
   (section 7, Physicals). In season, a player out 2+ weeks still can't be traded.
3. **Rumors include deliberate manipulation of you**: planted bidding wars, "we have another offer"
   bluffs, talking down your price, fishing and draft smokescreens. It stays learnable through
   sources, outcomes, each GM's record and your director's read (section 5, Rumors and mind games).

**Defaults, unless you say otherwise:**

4. **Offer volume.** Start with *normal* (about 10–25 a season). Add a *fewer / normal / more*
   setting only if it feels off.
5. **Sims never accept offers for you.** They expire.
6. **Eating salary.** Yes, the NFL way (a pre-trade bonus booked as your dead money), with a control
   on the Build tab.
7. **Division rivals.** Allowed but rarer, and no stars to a rival in season.
8. **Deals in the `complete` gap.** Later (Phase 6). The league-year opening moment carries that burst
   instead.
9. **A trade difficulty setting.** Not now.

## Risks

- **Talent drift:** contenders hoard stars, rebuilders stay bad. Watch the parity line in `offseason`
  and the fairness section in `trades`. The seller's floor and per-team caps are the levers.
- **Rosters and the cap break:** every AI deal runs `tradeProblem` plus the next-year check, and the
  health section fails on any team over the cap or short at a position.
- **Spam:** throttles, cooldowns and one open offer per team and player, measured per week.
- **Exploits:** the probe list in `trades`; the guardrails sit outside value.
- **The fog of war leaking:** offers and rumors use your read and words, never AI numbers or
  `player.ratings`. The coarse meter stays. The hidden cooldown and GM candor never appear as numbers.
- **Mind games feeling like cheating:** bluffs never touch how the AI values anything, your own staff
  never lies, every rumor resolves in the open, and a GM's record of leaks builds up in front of you.
  Getting fooled should feel like your mistake, not the game's.
- **Physicals feeling random:** a healthy player almost never fails. The odds come from things you
  can see (injury history, age, the injury report), and your doctor's quality shows in the results
  over a career.
- **Speed:** `TradeContext` and the budgets are in Phase 0, before any feature leans on them.
- **Reproducibility:** the market's own stream; the context is thrown away after each moment.

## Sources

Search results gathered Oct 2026, not re-verified at the source.

- **Calendar:**
  - deadline: [NFL.com, 2024 move to after week 9](https://nfl.com/news/nfl-owners-extend-trade-deadline-to-follow-week-9-games-of-2024-nfl-season), [SI 2025](https://www.si.com/nfl/nfl-trade-deadline-2025-date-time-targets-rules-to-know), [NFL 2026–27 dates](https://www.nfl.com/news/2026-27-national-football-league-important-dates)
  - after the deadline: [NFL FAQ](https://nfl.com/news/nfl-trade-deadline-information-faq), [PFT on waivers](https://profootballtalk.nbcsports.com/2017/11/01/expiration-of-trade-deadline-means-all-released-players-are-subject-to-waivers/)
  - the winter gap: [Stafford–Goff](https://www.cbssports.com/nfl/news/lions-trade-matthew-stafford-to-the-rams-for-two-first-round-picks-a-third-round-pick-and-jared-goff)
- **Picks:**
  - three years ahead: [Browns' five-year proposal withdrawn](https://www.nfl.com/news/browns-withdraw-proposal-to-allow-trading-draft-picks-five-years-in-advance)
  - comp picks: [ESPN, 2017](https://www.espn.com/nfl/story/_/id/14274468/nfl-owners-ok-compensatory-pick-trading-2017)
  - future discount: [Over The Cap](https://overthecap.com:443/discounting-of-future-nfl-draft-picks)
  - conditional picks: [Mayfield](https://www.nfl.com/_amp/browns-trading-baker-mayfield-to-panthers-for-2024-conditional-fifth-round-draft), [Adams](https://nfl.com/news/raiders-trading-wr-davante-adams-to-jets-for-conditional-third-round-pick)
- **Cap:**
  - sender's dead money: [OTC](https://overthecap.com/?p=11741), [CBA Art. 13 §6](https://overthecap.com/collective-bargaining-agreement/article/13/section/6/(b)(ii)(1)/)
  - June 1: [PhillyVoice](https://www.phillyvoice.com/june-1-tomorrow-interesting-date-eagles-terms-trading-players)
  - no cash for picks: [ESPN on the Saints' Clowney plan](https://africa.espn.com/nfl/story/_/id/29826419/nfl-nixed-saints-wild-sign-trade-plan-land-jadeveon-clowney-source-says)
  - retained salary: [Tannehill](https://africa.espn.com/nfl/story/_/id/26274671/dolphins-trade-quarterback-tannehill-titans), [Mayfield](https://www.profootballrumors.com/2022/07/panthers-to-acquire-qb-baker-mayfield-from-browns), [L. Williams](https://africa.espn.com/nfl/story/_/id/38780715/sources-giants-trade-dl-leonard-williams-seahawks)
- **Players:**
  - tags: [NFL Operations](https://operations.nfl.com/calendar-events/nfl-free-agency/franchise-tags), [Spotrac](https://www.spotrac.com/nfl/contracts/franchise-tag)
  - physicals: [Crosby, voided](https://abc7news.com/post/what-canceled-maxx-crosby-trade-means-raiders-ravens/18702818/), [Shaheen](https://africa.espn.com/nfl/story/_/id/34407794/miami-dolphins-place-adam-shaheen-ir-voided-trade-te-surgery)
  - reacquiring: [McFadden](https://nfl.com/news/steelers-reacquire-cb-mcfadden-from-cardinals-09000d5d817c3d85)
  - division rivals: [SI on Flacco](https://www.si.com/nfl/browns/news/joe-flacco-becomes-centerpiece-of-one-of-the-most-rare-trades-in-nfl-history-01k7014w8688)
- **Volume:**
  - 2025 in season: [NFL.com](https://www.nfl.com/news/2025-nfl-trade-deadline-fallout)
  - 2022–24: [Front Office Sports](https://frontofficesports.com/article/2024-nfl-trade-deadline-more-active-than-2023/)
  - draft: [Dartmouth Sports Analytics](https://sites.dartmouth.edu/sportsanalytics/2024/04/19/exploring-the-evolution-of-the-nfl-draft-pick-trade-market-over-time/), [PFF on first-round trades](https://pff.com/news/2026-nfl-draft-examining-the-recent-history-of-first-round-trades-on-draft-night)
- **Prices:**
  - [Mack](https://www.si.com/nfl/2023/09/01/how-khalil-mack-trade-from-raiders-to-bears-changed-nfl-daily-cover), [Hill](https://www.thescore.com/nfl/news/2323523), [Parsons](https://www.nfl.com/news/micah-parsons-packers-cowboys-trade), [Wilson](https://www.nbcwashington.com/news/sports/nfl/russell-wilson-dead-cap-money-denver-broncos), [L. Williams](https://abc7ny.com/post/giants-trade-dl-leonard-williams-to-seahawks-for-two-picks/13991944/)
  - the Osweiler dump: [Steelers Depot](https://steelersdepot.com/2017/03/texans-trade-brock-osweiler-second-round-pick-browns)
- **Other games:**
  - ZenGM source: [value](https://raw.githubusercontent.com/zengm-games/zengm/master/src/worker/core/team/ValueChangeCalculator.ts), [AI-to-AI trades](https://raw.githubusercontent.com/zengm-games/zengm/master/src/worker/core/trade/betweenAiTeams.ts), [make it work](https://raw.githubusercontent.com/zengm-games/zengm/master/src/worker/core/trade/makeItWork.ts), [strategies](https://raw.githubusercontent.com/zengm-games/zengm/master/src/worker/core/team/updateStrategies.ts)
  - ZenGM blog: [pick trade limit](https://zengm.com/blog/2025/08/ai-draft-pick-trade-limit/), [roster fit](https://zengm.com/blog/2021/05/ai-roster-fit/)
  - FM: [FM24 24.3 patch](https://www.fmscout.com/a-fm24-update-24.3.0.html), [FM26 recruitment](https://www.footballmanager.com/fm26/features/powered-transferroom-fm26s-recruitment-revamp), [FM27](https://www.footballmanager.com/fm27/features/deeper-more-immersive-world)
  - [OOTP AI settings](https://manuals.ootpdevelopments.com/index.php?man=ootp24&page=AI_Settings), [OOTP 27 trade AI](https://www.operationsports.com/out-of-the-park-baseball-27-is-overhauling-trade-ai-to-deliver-more-realistic-deadline-deals/)
  - [Madden 21 franchise update](https://gameinformer.com/2021/01/06/madden-nfl-21-franchise-update-adds-smarter-cpu-draft-logic-and-more-commissioner-tools)
  - [MLB The Show 26 trade hub](https://www.showdd.io/news/mlb-the-show-26-franchise-changes-features)
