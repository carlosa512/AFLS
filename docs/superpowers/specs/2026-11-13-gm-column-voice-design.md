# SNN's Column on a general manager: written from what he did, and late in the season

A follow-up to spec 2 of the news work (`2026-11-11-snn-column-and-storylines-design.md`), which built the Column. This
one rewrites the five Columns about a general manager and moves them later in the season. Columns about a head coach
and about a unit are not touched.

## Why

The Column is the one piece of SNN that is meant to be read as writing: a hit piece or a hype piece about a man's work.
The owner read the GM Columns in a render and found them robotic: "too exchange and puzzle fitted", with not enough
variety. Three things cause it.

- **Every GM Column is four slotted sentences** (claim, fact, reason, stakes), each chosen on its own, with one line
  written per slot. Every "fair to ask" Column is the same text with the names swapped, and no sentence leans on the
  one before it.
- **It argues from the record alone.** "Three losing seasons in a row point at the roster" is true of every bad team.
  A columnist names the quarterback he drafted first overall and the one he drafted a year later.
- **A stock clause closes it.** "Nine games left, the next of them at home against New Orleans" is bolted to nearly
  every closing line.

A throwaway trial rewrote three Columns the editor had filed in a played league as whole paragraphs built on the GM's
own draft picks, trades and signings. The owner's verdict on the side-by-side render: "Much better." He also asked for
the GM pieces to come late in the season, "when things are solidifying": in the trial league both "fair to ask" pieces
ran in week 8, with nine games left, and a GM's work is judged in seasons.

## Goals, and what would make it a failure

- A GM Column tells what this general manager did, in facts no other GM shares, and reads as one argument.
- Two GM Columns in a season do not read alike, and the same GM's second Column does not repeat his first.
- GM Columns run when the season's verdict on the team is in.
- **A failure even if it works:** a piece that says something untrue or mistimed about a real move ("in between" for a
  signing that came first), a piece that falls back to the record-only text, or pieces so alike in shape that the
  reader sees the template again by the third one.

## Decisions (agreed in the brainstorm)

1. **Whole paragraphs, not slots.** A GM Column is written as a piece: paragraphs composed together around findings
   about his work. The trial's three pieces are the reference for how it should read.
2. **Specifics from the public record.** Draft picks, trades and their price, signings and their terms, who started at
   quarterback, the head coaches he has had, honors, where a player he let go plays now.
3. **Two writing rules are relaxed for these pieces**, as the trial did: a sentence may carry two numbers, and the
   piece may close on a judgment instead of a fact.
4. **GM pieces come late.** Blame once the team is out of the race late in the season, credit once it holds a playoff
   place in the run-in, and the week 18 edition as the last chance.
5. **Head coach Columns keep today's timing** ("the HC ones hit about right"). Unit Columns are unchanged.

## Approaches considered

**For the voice.**

- *More lines in today's four slots.* Cheapest, and it fixes the repetition. It leaves the seams: four independent
  sentences in a fixed order, arguing from the record. Rejected: the owner's complaint was the fitted feel, not only
  the repeats.
- *Whole paragraphs built on specifics.* **Chosen**, from the trial's render. More hand-writing (a set of findings on
  each side, each with its own paragraphs), fewer joints.
- *Relaxing the house rules across the edition.* Not needed and not asked for. Only the two rules in decision 3 move,
  and only for GM pieces.

**For the timing.**

- *A fixed week for everyone.* Simple, but a 1–9 team's verdict is in before a 5–6 team's.
- *Tied to the race, with a floor.* **Chosen.** The Column already knows where a team stands (`clubContext`).
- *Only after the season.* The final's edition and the offseason editions carry no Column, and a verdict two months
  late is not news. Week 18's edition is the season's last word instead.

## 1. Timing

Only claims whose subject is a GM change. `LADDER` in `snnColumn.ts` gains the bars.

| Piece | Runs when |
| --- | --- |
| Blame | The week 12 edition or later (`LADDER.timeAfterWeek`, which the coach's "it's time" already uses), and the team is out of the race (`race === 'out'`) |
| Credit | The run-in (`stage === 'runIn'`, the week 14 edition or later), and the team is in the race (`race === 'in'`) |

- The other conditions for each claim stand as they are (losing or winning seasons under him, the record this season,
  a deep run last season, a first-year coach's turnaround).
- **One blame piece a GM a season.** "Fair to ask" runs in the first season he qualifies. "It is time" runs a season
  later at the earliest, when the losing has gone on a season longer and SNN asked about him the season before (the
  existing `ever(subject, '2-')` test, which already looks back one season). The builder's call, flagged for the
  owner: today both could run in one season.
- Week 18 needs no rule of its own: it is the last edition in which the conditions can hold.
- "A GM a season" means this GM at this team: the claim's subject, as its key already says.
- The editor's rotation is unchanged (never two weeks running, blame and credit in turn, a man's job in one Column of
  three, a GM asked about before his coach on a shared rung). **It may squeeze GM pieces out of a seven-week window.**
  The build does not loosen it: section 5 counts the squeeze first, and whether to loosen it is the owner's decision
  at that check-in.

## 2. What a piece is made of

**Findings.** A finding is one thing the public record shows about this GM's work at this team, with the facts a
paragraph needs to tell it. Each belongs to a family, and a family is blame, credit or either by how it turned out.

| Family | It is found when | Side |
| --- | --- | --- |
| Quarterback picks | He has used two or more first-round picks on quarterbacks | Blame |
| Quarterbacks | A different quarterback led the team in attempts in three or more of his seasons | Blame, or credit when the team won through it |
| First-round picks | Two or more first-round picks under him: how many start, how many are gone | Either |
| A draft class | Two or more picks from his drafts honored here (an award or All-League) | Credit |
| A late find | A pick from round four or later honored here | Credit |
| The trade for a star | He paid a first-round pick or more for a player: what the player has done here | Either |
| The big contract | A signing in the top of that year's market: still here and playing, or gone inside two seasons | Either |
| The one who left | A player who left under him (cut, traded or walked) and has been honored elsewhere since | Blame |
| Head coaches | He is on his third head coach, or the coach he hired in his first season is still here and winning | Either |

These nine are the starting set, taken from what the trial league's records held. The builder may add a family the
record supports and should drop one that the counts (section 5) show almost never fires.

**The piece.** Two to four paragraphs:

1. **The lead**: the strongest finding, told as what happened, with names, the pick or the price, and the year.
2. **The turn**: either a second finding from a different family, or the record said once in a sentence. The table
   beside the story carries the season-by-season numbers, so the prose never recites them row by row.
3. **The close**: the judgment the rung allows. "Fair to ask" asks. "It is time" says so. Credit says what the work
   bought. It may be a line with some edge to it ("nobody in Indianapolis is asking for the picks back").

The headline comes from the lead finding ("Sutton has drafted two quarterbacks and Jacksonville are 2–6"), within the
edition's headline length. The table and the numbers band stay as they are.

**Variety.**

- Each family has at least two written shapes for each side it can take. A shape is a whole paragraph (or the lead and
  turn together), not a sentence with a slot.
- Each rung has at least three closes, and a close may be tied to a family (the trial's "one try at a quarterback"
  close belongs to the quarterback families).
- SNN does not use the same shape, or the same close, twice in a league year, and the existing rule holds: no sentence
  twice in a season (`seasonSaid`).
- A GM's second piece (his "it is time" a season after "fair to ask", or credit two seasons running) does not lead
  with the family his last one led with unless that family has a new fact since.

**Choosing.** Findings are ranked by a fixed order of how much they say (set by the builder, reviewed in the renders),
then by recency, then a stable hash. Every sentence is still chosen by a condition on facts, as everywhere in the
game: a piece is reproducible from the league.

**No finding, no piece.** A GM with no finding on record is not written about: his claim is not a candidate that
week, and the editor picks among the others (a coach, a unit, another GM) as it does today. There is no record-only
fallback: that is the text this spec replaces. (The builder's call, flagged for the owner. The counts in section 5
say how often it happens.)

Every family reads his seasons at this team only (`GeneralManager.career` entries for this team), never the team's
seasons before him or his own seasons elsewhere.

**Getting the facts right.** A time word is chosen by a condition, never assumed: "a year later", "this spring",
"before either pick", "that year". "Last season's most valuable player" is not "the league's most valuable player"
once a new season is under way. A player is "gone" only when he is on another team or unsigned. Each family's test
builds its scene and checks these.

## 3. The writing rules for a GM piece

On top of the edition's rules (`docs/NEWS.md`), and in place of the Column's "one number a sentence":

- Two numbers a sentence at most, as in the rest of the edition.
- The last sentence may be a judgment. It names the man or the team.
- A figure of speech is allowed in the close and nowhere else in the piece.
- Unchanged: no semicolon, no colon or dash inside a sentence, American football English, full name first and the
  surname after, public facts only, no rating, mood or hidden trait, nothing predicted.
- Still held: the evidence table of two to four rows, and one sentence under eight words a paragraph at most (the
  trial's pieces kept to it). Two to four paragraphs replaces the Column's "two or three sentences of argument".
- `storyRules.ts` learns the difference: a Column whose subject is a GM is held to these, every other Column to
  today's rules.

## 4. Where the facts come from

Everything a piece says must be readable from structured data seasons later. **No piece parses a transaction's display
text** (the trial did, for speed).

What already lasts:

- A draft pick: `Player.draft` (season, round, pick, team).
- Who started at quarterback: season stat lines and `Player.statTeams`.
- Head coaches: coaches' careers, retired coaches included.
- Honors and titles: `League.awards`, `League.history`.
- How a player left: `Player.left`.
- His seasons here: `GeneralManager.career`.

What does not last today:

- **A trade's price.** `TradeRecord` keeps pick ids, and `League.draftPicks` drops picks two seasons on.
- **A signing's terms.** They live in the transaction log's text, and the log holds about two seasons (3,000 entries).

So the build adds a small durable record of a GM's notable moves, written when they happen: a trade with the rounds
and years of the picks on each side, and a signing with its years and total. The builder chooses its shape and home
(on the GM, as `gmMemory.ts` keeps moments, is the suggestion). What is notable enough to keep is two named constants
the owner can tune: a trade is kept when either side gives a first-round pick, and a signing when its total value is a
set share of that year's cap or more (start at 8%, which a signing can be tested against the day it is made, unlike a
rank in the market). It is record-keeping only: nothing in the sim reads it and writing it draws nothing. `League`
changes shape, so `SAVE_VERSION` goes up. `migrate.ts` fills in only the trades in `market.history` whose picks
`League.draftPicks` still holds, and no signings: an older save's GMs start with a thin record, and the pieces lean on
draft picks, quarterbacks, coaches and honors until it fills. A move the record does not hold is not told.

Only moves made in seasons the save has played under this GM at this team count. An opening GM's generated tenure
before the league began has no moves on record.

## 5. Counting before fixing

Before the pieces are written, extend `npm run editions -- --seasons n` (`scripts/editionCounts.ts`) to report, over
several played seasons with the new timing:

- GM claims that qualified a season, by rung and side, and how many the editor ran.
- How many were squeezed out by the rotation inside the late window.
- For each family, how often it was found, and how often a GM claim had no finding at all.

The owner sets `LADDER`'s new bars from those counts, as he did the first time, and decides whether the rotation needs
loosening for the late weeks.

## 6. Testing

- A unit test per family: a built scene, the finding it yields, and the time words its paragraph may use.
- `snnWeek.season.test.ts` (or a sibling) plays seasons and holds every GM piece to the rules in section 3, to "no
  shape twice a league year", and to the timing in section 1.
- The existing proof that the sim plays the same with mail filed or never filed must still pass with the new record
  being written.
- A save test: an older save loads, and its GMs' records hold what could be filled in.
- `npm run editions` lists the pieces for reading. `npm run screens -- --edition --column` shoots them.

## 7. Build order and check-ins

1. The durable record of moves, the save step and the findings reader, with tests. Nothing on screen changes.
2. The timing and the counts report. **Check-in:** the counts, for the owner to set the bars.
3. The blame pieces. **Check-in:** renders of several, from played leagues, for the owner to read.
4. The credit pieces. **Check-in:** renders.
5. `storyRules.ts`, `docs/NEWS.md`, `CLAUDE.md`, the changelog and a patch version bump.

## Not in this pass

- **A Column about the reader's own team.** Today the editor never runs one (it passes over any team the page already
  covers, and the reader's team has its own story every week). Whether it should, and whether the reader's own GM may
  be blamed, is a separate decision the owner has parked.
- The voice of head coach and unit Columns.
- Chains (one thread a matter in the inbox).
