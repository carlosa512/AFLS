# In-season holes: use what you have, then sign at a price; your staff never signs for you

Follow-up to the camp-minimum fix on this branch (`signMinimum` only signs a player who'd take the minimum).

## Why

- A 2030 save had 31 players rated 14+ on one-year minimums, nine of them on a 17–0 Miami. The camp fix stops that,
  but in season an AI team still fills every hole with a minimum deal, then a generated street free agent. It never
  slides over a spare player it already has, and never pays a real free agent who'd sign for less than his market.
- The owner wants a "use what you have" mentality: a team short at a position first lines up a spare player from
  another position ("Play at…", as the user can on the roster page) if he's good enough, and only then signs someone
  who fits, at what he'll take.
- "Staff handles injuries" signs and cuts on the user's own team. Signings should be the user's call.

## Decisions (agreed in chat)

- A hole is a position short of healthy players or an open roster spot. AI teams sign for **holes only**, never to
  upgrade.
- Before signing, the team (AI, or the user's staff with the toggle on) **covers from the roster**: the best-fitting
  spare player at another position moves over if he's **a decent backup there**: `COVER_BAR` = 9.5, his overall at
  that position with the out-of-position knock (`slotOvr`).
- A cover is an ordinary **"Play at…"** move, the one the user makes on the roster page: staff and AI teams make the
  same move, and the user undoes it the same way. To work for AI teams (always auto-sorted), "Play at…" now survives
  auto-sort, and no longer turns it off.
- Staff tidies only its own moves: once the position has enough healthy players again, a player staff lined up there
  goes back. A move the user made, or has since touched, stays.
- With the toggle on, the user's staff covers, moves long injuries to IR and brings healed players back; it **never
  signs or cuts**. A healed player on IR with no roster spot stays there and the inbox asks the user to make room.
- The inbox tells the user who's covering a short position, or that it's short with nobody good enough, with a link
  to free agency filtered to that position.
- Street free agents stay the last resort (today: about 80 in a new league's first season, 0–3 a season after).

## Design

### 1. "Play at…" survives auto-sort (`types.ts`, `roster.ts`, `ui/training.ts`)

Today "Play at…" (`playAt` → `placeAt`) only lives in a hand-sorted chart's lists, and it turns auto-sort off; an
auto-sorted chart (every AI team) is rebuilt from positions, which would wipe it. So the move is remembered on the
team:

- `Team.playingAt?: Record<number, { pos: Position; by: 'staff' | 'user' }>`: player id → the position he's lined up
  at away from his own, and who put him there. Plain JSON; bump `SAVE_VERSION` with a `migrate.ts` step that records
  each player an old hand-sorted chart already lists outside his own position as `by: 'user'`.
- `syncDepthChart` files a player in `playingAt` under that position on both kinds of chart. An auto-sorted group
  ranks him with its own players by `slotOvr` (his worth there, knock included), as it ranks everyone; a hand-sorted
  chart keeps him where he's listed. Entries for players no longer on the team, or now at that position for good
  (cut-down day's `changePosition`), are dropped.
- "Play at…" (`playAt`) writes `by: 'user'` and no longer turns auto-sort off; "Play at…" his own position deletes the
  entry. A drag still hand-sorts the chart (it picks an exact spot) and records the move as the user's. Any user move
  of a player staff placed makes it the user's.
- `chooseCover(league, team, pos)` (pure, in `roster.ts`): the best healthy player by `slotOvr(p, pos)` among those
  not in `playingAt`, not a starter at his own position, and spare there (it keeps at least `NEED` healthy players
  there, as `cutForRoom` reads spare), if his `slotOvr` reaches `COVER_BAR`; else none. Staff lines him up with
  `by: 'staff'`.
- The game-day lineup (`match/lineup.ts`) needs no change: it reads the depth chart.

### 2. A hole, step by step (`injuries.ts` `coverPositions`, `offseason/ai.ts`)

Each week, for each short position:

1. **Send staff's covers back**: a `by: 'staff'` entry whose position has enough healthy players of its own again (or
   who is hurt himself) is deleted, and he goes back to his own group.
2. **Cover from the roster** (AI teams, and the user's team with the toggle on): `chooseCover`.
3. **Sign at a price** (AI teams only): new `signForNeed(league, team, rng, position, budget)` in `offseason/ai.ts`.
   Candidates are healthy free agents at the position; each one's price is a one-year deal at what he'll take now: the
   APY whose `offerValue` meets his `demand(...).walkAway` (in season, `marketPressure` puts that near 55% of his
   market). The team takes the best by its own read (`perceive` + `quirkWorth`, as `signMinimum` ranks) whose price
   fits `budget`: its cap room in full-season terms (`roomForMinimum`'s proration), up to its in-season reserve
   (`reserve()` in `offseason/ai.ts`, 3% of the cap × (1.5 − the GM's cap style)), the room kept for exactly this.
   `contractFromOffer` prorates year one by the weeks left.
4. **Sign at the minimum** (AI teams only): `signMinimum` as today (a minimum-taker, then a street free agent), with
   all the room.

An open roster spot with no short position fills as today (step 3 or 4 at the thinnest position). `coverPositions`
still checks a signing fits before it cuts to make room, for both signing steps.

### 3. Your staff (`injuries.ts` `manageInjuries`)

For the user's team with the toggle on: IR and returns as today, except a return onto a full 53 doesn't run
`aiCutdown` (he stays on IR, healed, until the user makes room); covers per §2 steps 1–2; no signing, no cut. With
the toggle off, nothing moves (the user also handles IR); the mail in §4 still comes.

### 4. Mail (`inbox.ts`, `ui/mail.tsx`)

New subjects, keyed so nothing doubles up; `needsYou` reads the league as it stands (nothing stored):

- **`covering`** (season, week, player, position): staff lined a player up at a short position. From the head coach:
  who's covering, at what level, and that he goes back when the position's healthy. Informational.
- **`shortHanded`** (season, week, position): the user's team is short at a position and nobody on the roster is good
  enough to cover. From the head coach, with a link to **free agency filtered to that position**. Needs you while it's
  still short.
- **`irReady`** (season, week, player): a healed player on the user's IR can return and the 53 is full. From the head
  team doctor, linking to the player and the roster. Needs you while that's still true.

### 5. Free-agency link (`ui/routes.ts`, `ui/screens/FrontOffice.tsx`)

The `office` route gains an optional `pos`; the free-agency tab starts its position filter from it.

### 6. Roster page and copy (`ui/screens/Roster.tsx`, `ui/screens/Medical.tsx`)

A player staff lined up shows as any "Play at…" player does (in that group, out of position), tagged "staff" so the
user can tell. The roster-page help no longer says "Play at…" turns auto-sort off. The toggle's tooltip and the Medical screen's line say what the staff does: reserve, returns and covers, never signings or
cuts.

## Testing

Unit tests (each run first against the code without the change, where it must fail):

- `chooseCover` picks the best-fitting spare player at or above `COVER_BAR`, never a starter or a man his own
  position can't spare, and none when nobody reaches the bar.
- A "Play at…" move survives `syncDepthChart` on an auto-sorted chart and leaves auto-sort on; "Play at…" his own
  position undoes it.
- A staff move goes back once the position is healthy again; a user's move, or a staff move the user touched, stays.
- An AI team short at a position with no cover and a free agent whose walk-away fits its reserve signs him above the
  minimum; with no room for any real free agent it still covers the hole at the minimum.
- The user's team with the toggle on, short with a full roster: a cover is made when one reaches the bar; no player
  is ever added or released.
- A healed IR player on the user's full roster stays on IR, and `irReady` needs you; after a cut he can come back.
- `shortHanded` needs you while the position is short and not after it's filled; `covering` names the cover.
- The `office` route round-trips `pos` through the hash.
- `migrate.ts`: an old hand-sorted chart's out-of-position players load as the user's `playingAt` moves.

Audits: `offseason -- 6`, `trades`, and `sim -- 10` (covers change who plays): nothing outside range.

## Risks

- **In-season trades** sit near their floor (main reads about 15.3 a season against 15–25). Teams that cover or sign
  for a hole may trade for one less. If the number leaves its band, report it with the numbers; never widen the band.
- **Play**: more out-of-position backups on the field. The sim audit judges it.
- **Cap**: in-season signings spend the reserve AI teams keep. The offseason audit's in-season cap numbers judge it.

## Out of scope

Upgrade signings in season, a waiver wire, AI bidding wars in season, permanent position changes (cut-down day's
`changePosition` is untouched), changing how the game-day lineup picks fill-ins.
