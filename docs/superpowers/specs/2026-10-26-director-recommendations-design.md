# The director's recommendations

Piece C of the mail pass (A + B: `2026-10-26-offseason-mail-diet-design.md`). Owner feedback: the market report shows
too much (a list of every trade, rumors, who's buying and selling) when SNN now covers the league's moves. The
director of scouting should instead recommend a few moves for us: before the deadline, a few picks weighted by where
we stand (sell at 0–8, add at 8–0 for the playoff push); in the offseason, players about to reach free agency, free
agents to sign, and trade targets.

Decided with the owner: four mails a year; buy or sell from the playoff race; each pick says who, why and a rough
price, with a button.

## What goes

- `marketMail` (`inbox.ts`): the weekly market report (weeks 5–9) and "Market report: the league year opens". Its
  helpers that other code or tests still use (`marketTrades`, `marketRumors`, `tradeAngle`, `snnRan`,
  `tradeRecordFor`) stay as they are; the ones only `marketMail` used go with it.
- The "Who's buying, who's selling" and trade-list cards in `ui/mail.tsx` stay for messages already filed (old saves
  keep their mail), but nothing new uses them.
- `deadlineMail`'s "Trade deadline: one week to go" and "Trade deadline: this week"; "Deadline day" stays.
- SNN's trade stories and rumors are unchanged: they are the league's record of who moved.

## The four moments

One mail each, id `advice:{season}:{moment}`, from the director (`director(league)`), category `trades`. Filed only
when the league is at that moment (no backfill after a long advance, like SNN). Never Needs you.

| Moment | When it files | `moment` |
|---|---|---|
| Three weeks out | `phase === 'regular' && week === TRADE_DEADLINE_WEEK - 3` (week 6) | `w6` |
| Deadline week | `phase === 'regular' && week === TRADE_DEADLINE_WEEK` (week 9) | `w9` |
| League year opens | `phase === 'resign'` | `resign` |
| Free agency opens | `phase === 'freeAgency' && faDay === 1` (the first day) | `fa` |

## The lean (in season)

From the playoff race in our conference, with the standings screen's records and seeds (`computeRecords`,
`conferenceSeeds`): `gamesBack` = games behind the last playoff seed (0 when we hold a seed), half a game per tie.

- `buy`: holding a seed, or `gamesBack <= 1`.
- `targeted`: `1 < gamesBack <= 3`.
- `sell`: `gamesBack > 3`.

The mail opens with one sentence saying so, chosen by the lean and our place, e.g. "We're 7–1 and hold the top seed:
time to add." / "At 4–4 we're two games out of the last spot: one upgrade, and one player we can spare." / "At 1–7
we're five games out. I'd sell." Then "The deadline is the day after week 9." in the week-6 mail.

## The picks

Two to four rows, each `AdviceRow` (saved with the mail, so later moves don't rewrite it):

```ts
interface AdviceRow {
  kind: 'buy' | 'sell' | 'sign';
  playerId: number;
  teamId: number | null; // his club; null for a free agent
  name: string;
  position: Position;
  why: string;           // one line
  price: string;         // the director's ballpark
}
```

Everything is read through our scouts: our view of our own roster for needs, our view of targets (`perceive` for
the user's team, `viewCache` in loops), and a target needs at least 0.35 knowledge. True ratings, `playerOvr` and
`potential` are never read.

**Our needs** (`adviceNeeds(league)`): per position, our starters' perceived overall against the league's starter line
for that position (`starterLine`: a league-wide line, so no single player's rating is revealed), plus holes (fewer healthy players under contract than starters) and starters whose
deals end this year (from week 6 on). Same shape and weights as `teamNeeds`, which stays the AI's exact read; this is
our view of our own roster.

**Buy** (lean `buy`, or the targeted one): for our top needs, players on other clubs that are public: named in an
SNN/market `shopping` rumor this season, or on a club whose stance (`stanceOf`) is `seller` (the stance the old
market card showed publicly). Never another club's private trade block. A target must be an upgrade on our read
(at least 0.5 over our current starter at that spot), affordable this season (salary within our cap space, as
`canAfford`), and not a division rival unless nothing else clears the bar. Score: need urgency × gain × years of
control. At most one per position.

- Why: "A starter at our weakest spot (LT), signed through 2028." / "Rental: his deal ends this season." (rentals
  only in the `buy` lean, where this season is what counts).
- Price: `marketValue` on our read, turned into a round: "likely a 4th-rounder", "a 1st and more", "a late-round
  pick". `pickRoundFor(league, value)` compares the value with a mid-round pick's going rate in each round (the same
  curve as `goingRate`, at slot 16 of each round, this year's draft).

**Sell** (lean `sell`, or the targeted one): our players with real interest or an obvious market:

- clubs have made an offer or enquiry for him this season (`league.market.offers`, ours), or he's named in an
  `interest` rumor: "Two clubs have asked about him."
- otherwise a veteran (29+) on a deal that ends this season who starts for us on our read: "29 and out of contract
  after the season: worth more to a contender now."
- targeted lean: our surplus instead: a player beyond our starters at a position where we're two deep on our read.
- Price: `marketValue` to a typical buyer, the same round words.

**League year opens:** players on other clubs whose deals have run out (`isExpired`) and who would upgrade a need on
our read, best two ("Free agency opens soon: he'd start for us at CB. Expect about $8.5M a year."), plus at most one
public trade target as above. Price: `marketApy` in millions a year.

**Free agency opens:** the best two to four free agents at our needs on our read whose `marketApy` fits our cap space
(`capSheet` space this season). Why: "Our best option at S; four years younger than our starter." Price: "asking
about $6.2M a year".

**None:** when nothing clears the bar, the in-season mail still files with one line ("Nothing worth chasing; we
hold.") so the deadline isn't silent; the offseason ones are not filed.

## Buttons

Each row carries its own button inside the advice card (`ui/mail.tsx`), not a mail-level `InboxAction`:

- A buy row: "Open talks" puts a `tradeDesk` draft (`partnerId` = his club, `theirs.players` = [him]) and opens the
  trades tab.
- A sell row: "Open talks" puts a draft with him in `mine.players`, partner the club that made an offer or enquiry
  for him, else the club named in the interest rumor, else the first buyer-stance club.
- A free-agent row: "Free agency" opens the FA tab at his position.
- Every name is a `PlayerLink`; clubs are `TeamLink`s. The mail itself keeps one action: `{ kind: 'trades' }` in
  season, `{ kind: 'fa' }` in the offseason.

## Save

`InboxMessage.advice?: { lean?: 'buy' | 'targeted' | 'sell'; rows: AdviceRow[] }`, with `AdviceRow` in `types.ts`
(plus an optional `partnerId` for a sell row's talks). Bump `SAVE_VERSION` to 51 with a no-op `migrate.ts` step.

## Where it lives

`src/engine/directorAdvice.ts` (new): `adviceLean`, `adviceNeeds`, `pickRoundFor`, `buyTargets`, `sellCandidates`,
`faTargets`, and `directorAdviceMail(league, have)` which `deliverMail` calls in place of `marketMail`. Pure
functions over the league; no randomness. (`trade/advice.ts` is the staff's word on a deal in the trade room: a
different job.)

## Testing

- `directorAdvice.test.ts` (new, engine): lean from standings (holding a seed → buy, 2 back → targeted, 5 back → sell);
  buy targets come only from rumors or seller clubs, never a private block; every pick uses our view (a target whose
  true rating is far above our read is ranked by our read); sell picks a player with an offer first; nothing clears
  the bar → one-line mail in season, no mail in the offseason; one mail per moment; a long advance past week 6 files
  no week-6 mail; free-agent picks fit the cap.
- `inbox.test.ts`: no market report is filed any more; deadline notices are only "Deadline day".
- `mail.test.tsx`: the advice card renders rows with links, the ballpark and the right button; the buy row's button
  puts the right draft on the trade desk.
- `npm run typecheck`; no sims (nothing changes play). `npm run trades` is not affected (no change to `trade/`
  beyond reading it), but CI's planner decides.

## Release

Polish on the done inbox item: `package.json` 0.1.18 → 0.1.19, a changelog entry, `docs/NEWS.md` (the director's
moments replace the market report's rule).

## Out of scope

The Gazette (piece D). AI front offices' trading. Any change to how offers reach us.
