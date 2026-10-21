# In-season signings: AI teams pay for the holes they fill; your staff never signs for you

Follow-up to the camp-minimum fix on this branch (`signMinimum` only signs a player who'd take the minimum).

## Why

- A 2030 save had 31 players rated 14+ on one-year minimums, nine of them on a 17–0 Miami. The camp fix stops that,
  but in season an AI team still only ever fills a hole with a minimum deal, then a generated street free agent. A
  real free agent at the position who'd sign for less than his market never gets a call.
- The owner wants free agency alive in season: a team short at a position signs someone who fits, at what he'll take,
  rather than only trading.
- "Staff handles injuries" signs and cuts on the user's own team. Signings should be the user's call; the staff
  should handle reserve and show who covers.

## Decisions (agreed in chat)

- AI teams sign real free agents in season **for holes only** (a position short of healthy players or an open spot),
  not for upgrades.
- With the toggle on, the user's staff moves long injuries to IR and brings healed players back, **never signs or
  cuts**, and the depth chart shows who covers a short position on game day.
- A healed player on IR with no roster spot stays on IR; the inbox says he's ready and asks the user to make room.
- When a position on the user's team runs short, the inbox says so and links to free agency, filtered to that
  position.
- Street free agents stay as the last resort (today: about 80 in a new league's first season, 0–3 a season after).

## Design

### 1. AI teams fill a hole at a price (`offseason/ai.ts`, `injuries.ts`)

`coverPositions` (in-season, AI teams only after this change) finds the short position and makes roster room as it
does now. The signing becomes a ladder:

1. **`signForNeed(league, team, rng, position, budget)`**, new in `offseason/ai.ts`. Candidates: healthy free agents at
   the position. Each one's price is a one-year deal at what he'll take now: the APY whose `offerValue` meets his
   `demand(...).walkAway` (in season, `marketPressure` puts that near 55% of his market). The team takes the best one
   by its own read (`perceive` + `quirkWorth`, as `signMinimum` ranks) whose price fits `budget`. The contract is
   built as any in-season deal: `contractFromOffer` prorates year one by the weeks left.
2. If nobody fits, **`signMinimum`** as today (a minimum-taker, then a street free agent).

`budget` is the team's cap room in full-season terms (`roomForMinimum`'s proration), up to its in-season reserve
(`reserve()` in `offseason/ai.ts`, 3% of the cap × (1.5 − the GM's cap style)): the reserve is kept for exactly this,
and one hole never spends more than it. The minimum rung keeps today's budget (all the room), so a team that could
cover a hole before still can.

`coverPositions` checks a signing fits before it cuts (it does today via `minimumFits`); that check reads the real
rung too, so no one is released for a deal the team then can't make.

### 2. Your staff (`injuries.ts`)

`manageInjuries` for the user's team (toggle on):

- IR placement and returns as today, except a return onto a full 53 doesn't run `aiCutdown`: the player stays on IR
  (healed) until the user makes room.
- No `coverPositions` call: no signing, no cut.
- AI treatments stay AI-only, as today.

### 3. Mail (`inbox.ts`, `ui/mail.tsx`)

Two new subjects, each keyed so nothing doubles up, with `needsYou` read off the league as it stands (nothing stored):

- **`irReady`** (season, week, player): a player on the user's IR is healed and eligible to return, and the 53 is
  full. Needs you while that's still true. From the head team doctor. Links to the player and the roster.
- **`shortHanded`** (season, week, position): the user's team has fewer healthy players at a position than it needs
  (`NEED` in `injuries.ts`). Needs you while it's still short. From the head coach, naming who'll fill in on game day.
  Links to **free agency filtered to that position**.

Both are sent whether or not the toggle is on (with it off, the user also handles IR).

### 4. Depth chart shows the fill-in (`ui/screens/Roster.tsx`)

For a position the game-day lineup fills from elsewhere (`buildLineup` in `match/lineup.ts`), the depth chart shows
the fill-in under it, e.g. "S Raheem Perry covering". It's read from `buildLineup`, so it disappears once the
injured player is back; the chart itself is never changed.

### 5. Free-agency link (`ui/routes.ts`, `ui/screens/FrontOffice.tsx`)

The `office` route gains an optional `pos`. The free-agency tab starts its position filter from it.

### 6. Copy

The toggle's tooltip (`Roster.tsx`) and the Medical screen's line (`Medical.tsx`) say what the staff now does: reserve
and returns, never signings or cuts.

## Testing

Unit tests (each run first against the code without the change, where it must fail):

- An AI team short at a position with a free agent there whose walk-away fits its room signs him above the minimum.
- An AI team whose room fits no real free agent still covers the hole with a minimum deal.
- The user's team with the toggle on, a position short and a full roster: no player added or released.
- A healed IR player on the user's full roster stays on IR, and `irReady` needs you; after a cut he can come back.
- `shortHanded` needs you while the position is short and not after it's filled.
- The `office` route round-trips `pos` through the hash.

Audits (`offseason -- 6`, `trades`): nothing outside range.

## Risks

- **In-season trades** sit near their floor (main reads about 15.3 a season against 15–25). Teams that sign for a hole
  may trade for one less. If the number leaves its band, report it with the numbers; never widen the band.
- **Cap**: in-season signings spend the reserve AI teams keep. The offseason audit's in-season cap numbers judge it.

## Out of scope

Upgrade signings in season, a waiver wire, AI bidding wars in season, changing who the game-day lineup picks.
