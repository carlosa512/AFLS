# Front office refresh, part 1: the office kit and the trade desk

**Goal:** make the Front Office feel like the Home page and the draft room, starting with Trades. Each tab gets a hero
card that answers "what needs me now", facts tiles, pills instead of number columns, and cards for the top items;
tables stay only where comparing rows matters. NFL front office, not a spreadsheet. On Trades specifically: what each
GM wants, the offers on your desk and your deals in flight, and what your staff thinks of a deal.

**Decided with the owner (2026-10-28):**

1. **Split** the refresh: this spec is the shared office kit plus Trades. Re-sign and Free agents, Coaches / Scouts /
   Medical, and GMs follow as their own short specs and PRs on the same kit.
2. **What a GM wants** is shown on **your pro scouts' read** of his roster (a new read-only helper), never his own
   exact needs, plus his public stance and rumors. It can be wrong when you barely know a team, and says so.
3. **Layout:** a trade desk hero above the five views, which stay routes (`#/office/trades/<view>`); Market becomes a
   grid of GM cards.

## What doesn't change

The trade engine's decisions, every sim number, the save format and the routes. `teamNeeds` keeps its exact output
(the refactor below is tested against it). No MVP item finishes (14, "UI works on desktop and mobile", is already
Done), so this is a PATCH bump (0.2.12 → 0.2.13) with a changelog entry.

## The office kit (`src/ui/office.tsx`, new)

Lifted from the draft room so every Front Office tab can use it. The draft room moves onto it with no visual change.

- **`OfficeHero`**: a `Panel` with an eyebrow, a headline (the "what needs me now" line), an optional large
  `TeamChip`, actions on the right (the panel's `action` slot), children below, and `urgent` for the gold accent
  border (today's `.draft-clock.is-up`).
- **`Fact`** (`eyebrow`, value, optional muted note) and **`Facts`** (the row; today's `.facts` / `.fact`).
- **`CardRow`** and **`OfficeCard`**: the draft room's top-5 row (`.prospect-cards` / `.prospect-card`), wrapping on
  a phone.
- **`Pill`**: the existing `tag-pill` with one `tone` prop: `'good' | 'warn' | 'bad' | 'early' | 'inactive'` or none
  (plain), mapping to today's `tag-good`, `tag-warn`, `tag-bad`, `tag-early`, `tag-inactive`.
- `RiskBar`, `GapPill` and `VerdictPill` stay in `Draft.tsx`: they are draft-only.
- **CSS:** `.draft-clock` → `.office-hero` (with `.is-up` → `.is-urgent`), `.prospect-cards` → `.card-row`,
  `.prospect-card` → `.office-card`. Same rules, one block in `styles.css`, the draft-only names removed.
- `DraftClock` and `StaffTop5` render through `OfficeHero`, `Facts` and `CardRow`.

## Engine reads (pure, no state)

### Needs on your scouts' read (`trade/plans.ts`)

- The body of `teamNeeds` moves into `needsOn(league, roster, line, ovr)`, where `ovr` rates a player and `line` is
  the league's median starter by position. `teamNeeds(ctx, team)` calls it with `ovrOf(ctx, ·)` and
  `starterLine(ctx)`: identical output, still memoised on the context.
- **`scoutedNeeds(ctx, viewerId, team)`** calls it with `ctx.view(viewerId, p).ovr` and a starter line built the same
  way on the viewer's read (memoised on the context per viewer). Returns `{ needs: Need[]; littleFilm: boolean }`.
- **`littleFilm`**: the mean `knowledge(league, viewerId, p)` over the team's starters is under 0.35 (the level at
  which the engine says a front office's pro scouts "know" a player).
- Screens show at most three needs, as position pills: a hole (`'hole'`) in amber, an upgrade plain, next year's need
  faded ("next year"). With `littleFilm`, a muted "our scouts barely know them" after the pills.

### A tone on every staff line (`trade/advice.ts`)

`Advice` gains `tone: 'good' | 'warn' | 'bad' | 'note'`:

| Who | Line | Tone |
| --- | --- | --- |
| Coach | would start for us | good |
| Coach | would be depth for us | note |
| Coach | we'd be thin at … without him | warn |
| Coach | we'd have nobody behind him | bad |
| Scouts | our read and his makeup | note |
| Medical | `injuryRisk` tier: low / elevated / high | good / warn / bad |
| Cap | room after the deal below 0 | bad |
| Cap | dead money on our books | warn |
| Cap | otherwise | good |

**`staffTake(advice)`** sums them into one pill:

- **Staff against** (red): at least one `bad`, and no more `good` than `bad`.
- **Staff likes it** (green): no `bad` and no `warn`, and at least one `good`.
- **Split** (plain): anything else.

The lines' wording does not change (`mail.test.tsx` reads them).

### The desk's state (`trade/desk.ts`, new)

`deskState(league)` returns the hero's headline and facts, pure and on the user's view only:

- **Headline**, first match wins:
  1. `exam`: a deal of yours waits on your call after a physical (`league.market.exam`, what `ExamPanel` reads):
     "A physical flagged <name>: your call." Urgent.
  2. `offers`: `openOffers(league).length > 0`: "<n> offer(s) need an answer." Urgent.
  3. `deadlineDay`: `isDeadlineDay(league)`: "Deadline day: the window shuts when you advance."
  4. `closed`: `tradeWindow(league)` returns a reason: that reason, as the headline.
  5. `quiet`: "No calls waiting · <n> teams are buying" (`isBuyer` over the AI teams).
- **Facts:** *Deadline*: in the regular season before it, "Week 9 · <n> weeks away" ("This week" in week 9);
  on deadline day "Today"; after it, "Passed"; in the offseason, "Week 9" with the note "open all offseason"; in the
  playoffs, "Reopens in the new league year".
  *Offers waiting*, *On your block*, *Untouchable* (from `league.market.status`), *Teams asking about your players*.
- **Teams asking** counts distinct teams from public signals only: this league year's offers and enquiries to you
  (`league.market.offers`, any status) that ask for one of your players. The rumor mill never names your players
  (`market.ts` leaves them out), and `league.market.interest` is never read.

## The trade desk (Trades tab)

All five views keep their routes. The hero sits above the view tabs on every view.

### Hero

`OfficeHero` from `deskState`: the headline, urgent (gold) for `exam` and `offers`; the facts row; the primary action
"Answer offers" (to `#/office/trades/offers`) when offers wait, else "Build a trade" (to the table).

### Offers

- One `OfficeCard` per offer, full width, built from today's `OfferCard`: the caller's `TeamChip` and `GmLink`, a kind
  pill (Bid, Pitch, Dump, Enquiry, Counter, from `reason`), an expiry pill, both sides (`SideList`, as today), then the
  **staff strip**, then Accept · Counter · Decline as today.
- **Staff strip** (`StaffStrip`, in `offers.tsx`): one row per advice line, its speaker as a toned pill (Head coach,
  Pro scouts, Medical, Cap) followed by the line, and the `staffTake` pill at the head of the strip. Enquiries carry no
  package, so no strip.
- The physical's panel (`ExamPanel`) stays where it is, under the hero; the hero's `exam` headline points at it.
- Resolved offers (the last few) stay as today's muted list under the open ones.

### Trade table

- **Partner card** replaces the header line: large `TeamChip`, "Trade with the <team>", `GmLink` and GM style (as
  today), a stance pill (Buying / Listening / Selling veterans / Selling, the words the Market uses), **Wants (our
  read)** from `scoutedNeeds`, **Shopping**: players named in this league year's `shopping` rumors about this team
  (`PlayerLink`, at most three), and talks in words from `talkRefusal` / `peekTalks`: "Taking proposals",
  "Nearly done talking this week" (one proposal left), or the refusal. Never a count. `TeamPicker` stays in the
  action slot.
- **Staff take** beside Propose: the same `StaffStrip` over `dealAdvice` for the deal as ticked, updating as you tick;
  hidden until both sides have something.
- The asset lists, sort, eat-salary control, buttons and footnote stay as they are.

### Your block

- **Cards on top** (`CardRow`): your players On the block, then Untouchable, each an `OfficeCard` with avatar
  `PlayerLink`, position, `Ovr`, the status picker, Shop, and an interest pill ("3 teams asking", public signals as in
  `deskState`, per player). No cards: the row is not shown.
- The full roster list stays below as today (`SortSeg`, status toggle, Shop): it is where you set a status.

### Market

- `home-grid`: **GM cards** (`span-8`) and **Around the league** (`span-4`, today's rumors feed); each takes the full
  row on a phone, the grid first.
- GM cards are grouped by stance under eyebrows (Buying, Listening, Selling veterans, Selling), one `OfficeCard` per
  AI team: `TeamLink` with chip, `GmLink`, stance pill, wants pills (`scoutedNeeds`, as on the table), the latest
  player they are shopping (rumors), "Asked about <your player>" when a public signal links them to one of yours, and
  "Open table" (selects the team on the trade table, as the team picker does, and routes there).
- Today's "Who's dealing" panel is replaced by the grouping.

### History

Unchanged under the hero: a table is right for comparing deals.

## Fog of war

Every word on the desk comes from your view (`perceive`, `ctx.view`, `Ovr`, `knowledge`) or from public signals
(rumors, offers to you, stance words). No `player.ratings`, `playerOvr`, `player.potential`, `ceilingShifts`, trust or
talks counts, trade values or `league.market.interest`. The screen-contract tests in `ui/ui.test.ts` read every file
under `src/ui`, so `office.tsx` falls under them with no change.

## Files

- `src/ui/office.tsx` (new): the kit.
- `src/ui/screens/Draft.tsx`: onto the kit, no visual change.
- `src/ui/screens/Trades.tsx`: hero, partner card, staff take.
- `src/ui/offers.tsx`: `StaffStrip`, offer cards, block cards, the GM grid.
- `src/engine/trade/plans.ts`: `needsOn`, `scoutedNeeds`.
- `src/engine/trade/advice.ts`: `tone`, `staffTake`.
- `src/engine/trade/desk.ts` (new): `deskState`.
- `src/styles.css`: the kit's block replaces the draft-only names; trade desk rules (partner card, staff strip, GM
  grid).
- `package.json`, `src/ui/changelog.ts`: 0.2.13.

## Testing

- `plans.test.ts` (or the trade tests' file): `needsOn` with true ratings equals `teamNeeds` for every team of a
  generated league in season and in the offseason; `scoutedNeeds` returns `littleFilm` for a team your scouts haven't
  seen and not for your own.
- `advice.test.ts`: each row of the tone table; `staffTake`'s three outcomes and their edges.
- `desk.test.ts`: the headline order (an exam beats offers, offers beat the deadline, closed and quiet); teams asking
  counts rumors and offers only.
- `ui/trades.test.tsx`: the block cards, the GM grid and the staff strip render on a personnel league without touching
  the save (JSON before and after).
- Locally: `npm run typecheck` and the touched tests. CI runs the rest (`trades` among them, since `trade/` changes).
- Screenshots of the desk (desktop and a 390px phone: Offers with an offer, the table with a deal ticked, Your block,
  Market) sent to the owner before the PR.
