# SNN on the calendar's big days

Spec 3 of the news work. Spec 1 (`2026-11-11-snn-weekly-edition-design.md`) built the weekly edition and spec 2
(`2026-11-11-snn-column-and-storylines-design.md`) added the Column and your club's storylines. This one takes the
edition out of the season. Chains (one thread a matter with the head coach, the owner, players and agents) follow as
spec 4.

## Why

In season SNN files one front page a week. Out of season it files three plain digests (the front-office carousel,
the coaching carousel, "off the market") and says nothing about the draft, free agency's close or cut-down day,
which are the days a real sports page is busiest. The owner asked for SNN to cover those days, with the same two
worries as before:

- **Wear.** Nothing here may become a thing the player clicks through. Five mails across an offseason, one a step at
  most, each built from what happened that day.
- **Fairness and the fog.** Public record only. No rating, no mood, no prediction.

## Decisions (agreed in the brainstorm)

1. **Five special editions a year**: the new league year, free agency, draft day, cut-down day, kickoff.
2. **The same front page** as the weekly edition: a lead story, Your club, up to three tiles that open in place. No
   score strip. One list box where the division race sits in season.
3. **They absorb the three offseason SNN digests.** All three belong to the same window, so they land in the first
   edition. An offseason goes from three SNN digests to five editions.
4. **Public record only**: picks and the consensus board, contracts, transactions, depth charts, last season's box
   scores and honors.
5. **What counts as notable is set from counts.** A tool plays several offseasons and reports how often each story
   type would fire, and the owner sets the bars.
6. **An article causes nothing**, as in specs 1 and 2. The sim never reads mail.
7. **Your staff's letters stay.** The director's free agency wrap-up and draft class report are your scouts' private
   view and are not folded in. The owner's letters stay too.
8. **Cut-down day and Kickoff file as one mail when they land on the same step** (a save with practice squads off):
   the preview leads and the cuts are tiles.

## 1. The five editions

Each edition is filed once, at its moment, under `snn:{season}:d:{day}`. Each has a set of story types (its
candidates), ranked in the edition's five tiers and cut to the page by the weekly editor's rules: one story a club,
the reader's club in its own slot, the best of what is left as tiles. Tiers below are the starting point; the bars
inside them (how big a contract, how far a fall) are fixed at check-in 1.

### The new league year (`year`)

**Files** when free agency opens (the step the re-sign window closes).

| Tier | Story |
| --- | --- |
| 1 | A head coach or GM out and his replacement, at another club. A star tagged. A star released. |
| 2 | A star re-signed before the market. A star reaching the market. |
| 3 | A club keeping or losing three or more of its starters in the window. A trade in the window that the trade rules call reportable. |
| 4 | A GM starting the year under pressure (what the front-office digest called the hot seat). An interim head coach kept or let go. |

**List box:** "Changes at the top": each club with a new head coach or GM, who left and who came in.
**Your club:** what the league could see of your window: who you tagged, re-signed and let reach the market, in
counts and the biggest name. Your own firing or hiring stays the owner's letter.
**Absorbs** the front-office carousel, the coaching carousel and "off the market".

A firing at the season's end is told here, a step after it happens and with the replacement named, so the change is
official going into the new year (the owner's call at the spec review). Today's front-office digest tells it the
step it happens, without the replacement.

### Free agency (`market`)

**Files** when the market's first week closes (the step the draft opens).

| Tier | Story |
| --- | --- |
| 1 | A star changing clubs. |
| 2 | The richest contract of the week, when it is not the tier 1 story. A reportable trade. |
| 3 | A club's haul (three or more starters signed). A club that lost three or more starters. |
| 4 | The best player still unsigned. A veteran returning to a former club. |

**List box:** "The biggest contracts": ten rows of player, old club, new club, years and total.
**Your club:** your signings and departures in public terms (how many, the biggest deal, who left for where).

### Draft day (`draft`)

**Files** when the draft ends.

| Tier | Story |
| --- | --- |
| 1 | The first pick. |
| 2 | A trade up into the top ten. A quarterback taken in the first round. A star traded on draft day. |
| 3 | The wait: the furthest fall below the consensus in the first two rounds. Ahead of the board: the widest gap above it in the first round. |
| 4 | A club with three or more picks in the first two rounds, or none. |

**List box:** "Round one": the first ten picks with club, player and consensus rank.
**Your club:** your class: how many picks, the first against the consensus, a table of the first four.

### Cut-down day (`cuts`)

**Files** when rosters go to 53.

| Tier | Story |
| --- | --- |
| 1 | A star released. |
| 2 | A notable veteran released (last season's starter, by the bar). A reportable camp trade. A holdout still out. |
| 3 | A first- or second-round pick of the last three drafts released. |
| 4 | An undrafted rookie on a 53. A starter who changed position in camp. |

**List box:** "Notable cuts": ten rows of player, club and last season's games started.
**Your club:** your cuts in public terms: the most notable release and how many rookies made the roster.

### Kickoff (`kickoff`)

**Files** in week 1 before any game is played.

| Tier | Story |
| --- | --- |
| 2 | The champion's opener. A rookie quarterback starting in week 1. |
| 3 | A new head coach's first game. A club with a new starting quarterback. |
| 4 | The club with the most new starters. A coach meeting his mentor in week 1. |

**List box:** "Opening week": every week 1 game with its kickoff window.
**Your club:** your opener: the opponent, both clubs' records last season, what changed at each since.
**Game of the week:** the existing pick (`season/gameOfWeek.ts`), as in season.

No prediction, no ranking of clubs and no Column. The preview says what is new and who plays whom.

When cut-down day and Kickoff land on the same step they are one mail labelled Kickoff: the kickoff stories and the
cut-down stories compete for the lead and the tiles by tier, and the page carries both list boxes.

## 2. The page

`ui/edition.tsx` draws it. An edition with no scores draws no strip (the mock-up in the brainstorm ran on today's
page unchanged). The division race gives way to the edition's list box, drawn in the style of the Column's evidence
table, each row linked to its player or club. The label in the masthead and the subject is the edition's name
("Draft day · Corsairs open the draft with LB Zachary Harvey"), under the same 60-character rule.

It is never Needs you. A GM between jobs gets it without a Your club slot.

## 3. Who is a star, in public

In season a star is read from this season's box scores (`starOutCandidates`: a weekly award, a top-five place in a
major stat, his club's passer). Out of season there is no this season, so one reader, `publicStanding`, answers from
last season's record:

- **Star**: a season award or all-league honor last season, a top-five place in a major stat, or his club's passer
  with a winning record.
- **Starter**: games started last season at or over the bar (read from box scores as `startsOf` does).
- **Young and drafted high**: a first- or second-round pick of the last three drafts.

It returns words (star, starter, depth), never a number, and reads nothing a rival fan could not. The old "off the
market" digest ranked players by your scouts' read; the editions rank by contract size and public standing, so SNN
no longer orders anything by a private view.

## 4. What it replaces and what stays

**Stops filing** once an edition is on file for the moment: the front-office carousel digest
(`leadership-phase:…`), the coaching carousel (`league:{season}:carousel`) and "off the market"
(`offMarket:{season}`). The edition's `covered` keeps their ids, so nothing is told twice and an old save's digests
still open and render.

A coach or GM change the new-league-year edition had no room for, or one that happens later in the offseason, stays a
candidate for the next special edition, as it does week to week in season.

**Still files alone:** everything from the people who work for you (the director's free agency wrap-up and draft
class report, the contracts letter, the waiver letter, the locker room report), the owner's letters, the league
office's awards, a player speaking out, the coaching-tree stories and the Arena Gazette.

**A simmed offseason** passes every moment in one step, so only Kickoff files. Its stories are chosen from the whole
offseason's record (new coaches and new quarterbacks are its own story types), so the reader still learns who is new.

## 5. How it is built

- **`publicStanding.ts`**: the reader in §3. Pure, public facts only, no draws.
- **`snnDays.ts`**: the editor. One function per edition gathers its candidates from the transaction log, the draft
  record, leadership events and the schedule; they share the weekly editor's ranking and cut (`cutEdition` in
  `snnWeek.ts`). `dayMail(league)` decides which moment the league is at and files at most one mail. Mail-side only:
  nothing in the sim imports it.
- **`snnDayVoice.ts`**: the words. `snnVoice.ts` is already 2,700 lines, so the day stories get their own file. Two
  paragraphs a story to the edition's writing rules and the house rules for letters; `storyRules.ts` checks them.
  The second paragraph ends on the next fact on the calendar (the club's next pick, its first game) where the weekly
  story ends on the next fixture.
- **Types**: `Edition` gains an optional `day` and `lists` (a title, a head and rows of cells with an optional
  player or club). Both optional and additive; `SAVE_VERSION` moves with a no-op upgrade step, as specs 1 and 2 did.
- **`inbox.ts`**: `deliverMail` calls `dayMail`; the three digests step aside when the moment's edition is on file
  or filing. `mailSubject` reads the new id.
- **`ui/edition.tsx`**: the list box, and no strip without scores.
- **`scripts/editions.ts`**: `--offseasons n` (below), and the season preview gains the five editions so
  `.check/editions.md` shows a whole year.

## 6. Counting before fixing

`npm run editions -- --offseasons n` plays n offseasons and reports, per edition and story type, how many
candidates each offseason produces at a few settings of its bar (for example: players released on cut-down day who
started 8, 12 or 16 games last season; falls of 10, 15 or 20 places below the consensus), and how often an edition
would have fewer than three stories. The owner sets every bar from that table at check-in 1. No bar is fixed before.

From two offseasons already on file, as a first look: 6 to 8 tags, 145 to 181 signings and 8 to 11 trades in free
agency, 224 picks and 25 to 36 draft-day trades, 109 to 133 releases and 4 to 7 trades in camp. There is no shortage
of material; the bars exist to keep each page to its best four or five stories.

## 7. Testing

- **Unit** (`snnDays.test.ts`, `publicStanding.test.ts`): each story type from a built scene; the cut; the merge of
  cut-down day and Kickoff; a simmed offseason files Kickoff alone; a GM between jobs gets no Your club slot.
- **An offseason played** (`snnDays.season.test.ts`): from the title game to week 1, stepping as the app does. It
  holds every edition to `ruleBreaks`, one SNN mail a step, no key told twice, none of the three digests filed beside
  an edition, and the league identical with mail filed and never filed.
- **The sim reads no mail**: `simReadsNoMail.test.ts` gains the new modules.
- **The page** (`ui/edition.test.tsx`): the list box, no strip, names linked, no rating on screen.
- **Old saves**: a save with the old digests on file loads, shows them, and files the next moment's edition.

## 8. Build order and check-ins

1. `publicStanding.ts` and the counting tool. **Check-in 1:** the counts table; the owner sets the bars.
2. Draft day end to end (editor, words, list box on the page). **Check-in 2:** a render of a real Draft day edition.
3. The new league year (with the three digests folded in) and Free agency.
4. Cut-down day and Kickoff, the merge, the simmed offseason. **Check-in 3:** renders of all five from one played
   offseason.
5. Docs (`docs/NEWS.md`, `CLAUDE.md`, `docs/MVP.md`), version, sign-off.

One review of the whole branch comes before the pull request, as agreed, and not per spec.

## Not in this pass

- **An end-of-season edition** (awards, the season in review). The title game's edition and the league office's
  awards mail cover the season's end today.
- **A Column in a special edition**, and SNN judging a GM's draft or trade a year on (spec 2 left the GM's "one
  move" rung out for the same reason: it needs its own rules and counts).
- **A page per round of the draft or per day of free agency.** One edition when each ends.
- **Predictions and power rankings** in Kickoff.
- **Chains** (spec 4).
