# GM memory and voice (Build B)

Date: 2026-11-07 · Branch: `claude/amazing-dirac-sa4npe` · Part two of two from the owner's AI-GM brainstorm. Build A
(archetypes, habits and the clues that show them) shipped in 0.4.9 (`docs/superpowers/specs/2026-11-05-gm-habits-design.md`).

## Why

Build A made the AI GMs different people to watch. Build B makes them different people to deal with. Today every GM
talks to you the same way: offer letters are signed "<Team> front office" with one fixed line per kind of offer, and the
trade table answers with four fixed lines ("Close. Add a little more and they'll do it."). And no GM knows you: trust
lives on the club, not the person, and fades back to neutral within a few weeks.

This is the game layer on top of the simulation. The wording is the point of the build, not its polish.

## Decisions (agreed in the brainstorm)

1. **Words plus a few real consequences.** Memory changes how a GM talks to you and leans three decisions the trade
   code already makes (his price, his patience, who calls you first). Like habits, nothing is scripted and no
   consequence is a new decision.
2. **He remembers trades and how you negotiate.** Trades between your club and his, judged again a season later, and
   being led on. Hiring his staff, claiming his waived players and outbidding him for a free agent are just business:
   not remembered.
3. **A straight no costs nothing.** Declining his offer, or him declining yours, is not a moment. What cools him is
   being led on (you counter, then turn down what he comes back with, or your counter is so far off he walks) and
   turning down his final offer.
4. **A ledger, with a standing worked out from it.** Each AI GM keeps a short list of moments with you; his standing
   toward you is read from it, recent moments weighing most. His words quote specific moments; the consequences read
   the standing. It draws no dice.
5. **It follows the people.** Memory is between the AI GM and your GM. It goes with him to a new club, and with you
   if you change jobs.
6. **His own voice, where you deal with him.** His letters to you and the live line on the trade table, worded by his
   makeup, his memory of you and the moment. Letters he sends unprompted are a later build.
7. **Varied, neutral, worth reading.** Every line goes through `voice.ts` (`say`), at least six variants for each
   common slot, a memory mentioned only when there's one worth mentioning, silence over filler. Businesslike to warm;
   a sour GM is curt, never rude. No numbers, labels, habit names or standing score anywhere.
8. **League totals hold.** Memory only touches your dealings, and a GM you've never dealt with sits at neutral, so
   AI-only leagues play exactly as today. `npm run trades` stays green with no range loosened.

## 1. Memory

### Whose memory

Each AI GM (`GeneralManager`) keeps `withYou?: YouMoment[]`: what happened between him and your GM
(`league.userGmId`). It lives on his record, so it follows him through `appointGm` to any club, and it names your GM,
so it follows you through a firing and a new job. Your own GM keeps none. Absent means nothing has happened.

### Moments

```ts
type YouMomentKind =
  | 'trade' // a deal closed between your club and his
  | 'tookOffer' // you took his offer at his price
  | 'ledOn' // you countered, then turned down what he came back with, or your counter made him walk
  | 'finalNo'; // you turned down his final offer

interface YouMoment {
  kind: YouMomentKind;
  season: number;
  phase: Phase;
  /** A trade's players and picks, each side as it moved: what he got and what he gave. */
  got?: { players: number[]; picks: number[] };
  gave?: { players: number[]; picks: number[] };
  /** How a trade looked to him when it closed. */
  atClose?: 'paidUp' | 'fair' | 'squeezed';
  /** How it looked a season later (absent until judged). */
  verdict?: 'heWon' | 'both' | 'youWon' | 'brokeDown' | 'even';
  /** A trade with a starter or a first-round pick in it counts more. */
  big?: boolean;
}
```

- **Trade.** Noted when any deal between your club and his closes: offers you accepted, proposals from the trade
  table, counters, draft-day deals. `atClose` is his own judgment of the deal at the time, from `judge`'s get against
  need for his side: comfortably clear is `paidUp` (you gave more than he needed), just clear is `squeezed`, between is
  `fair`.
- **Took his offer.** You accepted an offer he filed, at his price (no counter in between).
- **Led on.** You countered and then turned down what he came back with, or your counter was so far off he walked.
  One moment per offer thread, however many rounds it took.
- **Final no.** You turned down an offer marked final.
- **Not moments:** declining his first offer, letting it lapse, a proposal of yours he turns down, a league rule
  blocking a deal.

### Judged a season later

At each new league year (`beginOffseason`, beside `habitsNewYear`), every trade moment not yet judged is read from
public facts:

- Each player on each side is read by his role last season with his new club (`seasonRole` in `scouting.ts`: starter,
  rotation, barely played), or as gone (cut, retired, on no roster). A pick counts as the player taken with it, once he
  has played a season.
- A trade is judged at the first new league year when every piece has a season on record, or three league years on,
  whichever comes first. A piece still unknown then counts as even.
- What he got against what he gave becomes the verdict: `heWon`, `both` (each side got a starter or better), `youWon`,
  `brokeDown` (a man he got barely played through injury), or `even`. One verdict, final.

### Standing

`standingWith(league, gm)`: −1 … 1, worked out each time it's read from his moments (never stored):

| Moment | Weight |
| --- | --- |
| Trade closed (doing business) | +0.05 |
| Verdict `heWon` | +0.25 |
| Verdict `both` | +0.20 |
| Verdict `even` | 0 |
| Verdict `youWon` | −0.30 |
| Verdict `brokeDown` | −0.25 |
| Took his offer | +0.05 |
| Led on | −0.10 |
| Final no | −0.15 |

Taking his offer also closes a trade, so it earns both of those lines. A big trade's verdict counts 1.5 times. Each moment fades with the seasons since it happened, at a half-life from
his stubbornness: one season for the most flexible GM, three for the most stubborn. The sum is clamped to −1 … 1.
These weights are starting values; the unit tests pin their order and bounds, not their decimals.

### Kept

Six seasons and twelve moments a GM. Past twelve, the oldest small moment goes first; a big trade is the last to go.

### Today's trust

`TradeTalks.trust` and `nudgeTrust` go: standing takes their job. The short-term rules in `talks.ts` stay as they are
(proposals a moment, cooled-off players, talks off after a final offer). The save upgrade drops `trust` from stored
talks and starts every GM with no moments.

## 2. Consequences

Each leans one decision the trade code already makes. A GM at neutral standing behaves exactly as today.

1. **His price with you** (`marginFor` in `judge.ts`). Today trust moves his margin with you by up to
   `TRUST_MARGIN` (6%). Standing takes that slot with the same limit: a sour GM asks up to 6% more, a friendly one up
   to 6% less.
2. **His patience** (`ASKS` in `talks.ts`, an offer's `patience` in `offers.ts`). At a standing of 0.35 or more he
   hears five proposals a moment instead of four and his counters run one round longer. At −0.35 or less he hears
   three and walks one round sooner (his first counter may be his final offer). He always takes your call.
3. **Who calls you first** (`offersMoment` in `offers.ts`). A call's score gains his standing, so a friendly GM moves
   ahead of others in the line. At −0.35 or less he files half as many pitches for players he's shopping. The number
   of offers you get a moment (`BUDGET`) does not change.

## 3. His voice

### Where

- **His letters** (`offerWords` in `inbox.ts`): offers, pitches, dumps, enquiries, counters, his price when you ask.
  Each comes from him by name ("<Name>, <Team> GM") with his face at the top, using `GmWho` from Build A
  (`InboxMessage.gmNotes`).
- **The trade table's live line** (`evaluateTrade` in `judge.ts`, shown on the Trades screen): his first-person reply
  to the deal on the table, and his refusal when talks are off.
- **Your director on his card** (`gmStyleNotes` in `ui/gm.tsx`): one line on your history with him.

All the words live in a new module, `gmTalk.ts`, so `inbox.ts`, `judge.ts` and the screen only ask it for a line.

### How a letter is built

Three parts: an **opener**, the **offer**, a **sign-off**.

- **The offer** stays plain and exact, built as today (`packageWords`), so you always know what's on the table.
- **The opener** carries the moment and, now and then, a memory: "After the Jefferson deal, you're my first call." It
  is empty when nothing fits.
- **The sign-off** carries his manner: brief and firm for a stubborn GM, urgent for a win-now GM, easy for a patient
  one. A final offer says so in his words.

### What shapes the words

A line's conditions read a small fact sheet built for the letter, never the league directly:

- **His makeup in words**: his dials as Build A's reputation reads them (firm, urgent, patient, careful with money).
  Never a habit or archetype.
- **His standing toward you** as a band: warm, easy, neutral, cool, sour.
- **The moment worth mentioning**, if any: the most recent judged trade with a clear verdict, a final no or being led
  on in the last season, named by its main player ("the Jefferson deal").
- **The market moment**: deadline day, a week in season, the new league year, free agency, camp, the draft.

### Variety rules

- Every slot goes through `say`: the most specific line that fits, never one of his last five letters
  (`recentBodies`), picked by the letter's key.
- At least six variants for each common slot (opener at neutral, sign-off by manner, each table verdict band), so the
  same words rarely come twice in a season.
- A memory opener only when there's a moment worth mentioning, and at most every other letter from him.
- Silence over filler: an empty opener is better than a generic one.

### Tone

Businesslike to warm. A sour GM is short and cool ("Here's what it'd take. Don't make me chase it.") but never
insults you. Pronouns through `pron`, as Build A's GM words do.

### The trade table line

Today's four messages become his reply in the first person, by verdict band (accept, close, short, far), his standing
and his makeup: "Close. Put a late pick on it and I'll do it." The line is keyed on the deal and the market moment, so
it stays the same while the deal on the table doesn't change and never flickers as the screen redraws. A league rule
blocking the deal stays plain (it's the league talking, not him).

### Your director's line

On his GM card, one sentence on your history with him, only when there is one: "He hasn't forgotten the Jefferson
deal." / "He's been easy to deal with since the spring." Hedged, like the director's other notes, and silent with a GM
you've never dealt with.

## 4. Fog of war

- Screens read memory only through `gmTalk.ts`'s words. The screen-contract test (`ui/ui.test.ts`) bans `withYou`,
  `standingWith` and `YouMoment` in `src/ui`, as Build A banned `.habits`.
- No number, standing band name, archetype, habit or grip appears in any letter, table line or card.
- He only quotes what he lived through, and your director only what's public (the trades themselves and how the men
  played).

## 5. Testing

### Unit tests

- **Moments**: each kind noted once per thread; a straight no, a lapse and a blocked deal note nothing; a trade notes
  `atClose` from his side's judgment.
- **Judged later**: a starter he got against a man you got who barely played reads `heWon`; a pick waits for its
  player's first season; three league years on, an unknown piece counts as even; a verdict never changes once set.
- **Standing**: order of the weights (a won deal warms him more than taking his offer; a final no cools more than
  being led on); bounded to −1 … 1; a stubborn GM's moment outlasts a flexible GM's; neutral with no moments.
- **Follows the people**: a GM appointed to another club keeps his moments; your GM's moments are found after you
  change clubs.
- **Kept**: past twelve moments, a big trade outlasts small moments.
- **Consequences**: his margin moves at most 6% either way; proposals a moment stay within three to five and counters
  within one round of today's; offers to you a moment keep the same count, only their order and the pitch share move;
  at neutral standing every decision equals today's.
- **Voice**: every common slot has at least six variants; no line repeats inside a GM's last five letters; no opener,
  sign-off, table line or card line contains a digit, a habit name, an archetype or a standing band (the offer itself
  keeps its pick labels); the table line
  is the same for the same deal in the same moment; a memory opener appears at most every other letter.
- **Save**: an older save loads with no moments and no `trust` in its talks.

### Read-through before the PR

`scripts/gm-letters.ts` builds a league, plays a few dealings with several GMs (warm, neutral, sour; stubborn,
win-now, patient) and writes about thirty letters and table lines to `.check/gm-letters.md`. The owner reads it, and
the banks are tuned before the PR goes up. It is a preview, not a check, and is not committed output.

### League checks

Memory draws no dice and touches only your dealings. `npm run trades` must stay green with no range loosened (it reads
offers to you and probes pestering one GM all week). No other check should move; if one does, that's a bug in the
neutral-standing path.

## 6. Save, docs and version

- `SAVE_VERSION` 91, with a `migrate.ts` step: drop `trust` from each `TradeTalks`; GMs start with no `withYou`.
- `docs/TRADES.md` ("Offers to you" and talks), the architecture notes in `CLAUDE.md` (`gmTalk.ts`, memory on the GM),
  the in-game changelog (`src/ui/changelog.ts`) and `package.json`'s last number (0.4.21), per `docs/VERSIONING.md`.

## 7. Not in this build

- Letters a GM sends unprompted (a burned GM saying he won't call, a friendly one checking in before the deadline): a
  later build.
- Grudges over hiring his staff, waiver claims or free agents: just business.
- Memory between two AI GMs.
- Any visible relationship meter or standing on a screen.
