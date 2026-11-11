# SNN's Column and your club's storylines

Spec 2 of three. Spec 1 (`2026-11-11-snn-weekly-edition-design.md`) built the weekly edition. This adds opinion to it
and makes your own club a subject of it. Spec 3 (chains) follows.

## Why

The edition reports. It never says what a result means over a month, and it never says who is doing well or badly at
their job. A reader of a real sports page gets both, and the owner asked for both, with two worries:

- **Fairness.** No calls for a coach's or GM's job after one bad week. The press follows the same clock the owners
  do.
- **Wear.** Nothing here may become a thing the player clicks through. Every part is rare by rule, and the rules are
  set from counts.

## Decisions (agreed in the brainstorm)

1. **One labelled Column an edition at most**, in one of the three tile slots. No Column when nothing earns one.
2. **The Column gives credit as well as blame**, on one evidence ladder that runs both ways.
3. **The Column shows its evidence**: headline numbers in the band and one small table. The prose argues.
4. **Your club's public storylines are stories in the edition**: a starter losing his job, a trade request that
   leaks, a coordinator relieved. One tile a week at most, from what the league could see.
5. **Coverage reaches you through the head coach's letter.** Normally one line and nothing to answer. A conversation
   with answers only in the extreme case.
6. **An article causes nothing.** The Column and a player's visit each fire from the same public facts about his
   play. The sim never reads mail. Mail may read mail (the coach's line may check what SNN printed).
7. **Every bar is set from counts.** Before the numbers are fixed, a tool plays several seasons and reports how often
   each part fires, and the owner decides.

## 1. The Column

### What it is

A claim and its evidence, about one subject: a unit, a head coach or a general manager, at any club. It is written in
a columnist's voice, which means it draws a conclusion, and it keeps every writing rule of spec 1 (no semicolons, no
colon inside a sentence, it stops on a fact, no line written to sound good).

Closed, it is a tile whose kicker reads COLUMN. Open, it has:

- **The band**: the headline (the claim) and up to three numbers.
- **The evidence table**: two to four rows and two columns of values. Either before and after ("Weeks 1–8" against
  "Since") or the club against the league ("Las Vegas" against "League average"). The second column is the one the
  claim rests on and is set in bold.
- **Two paragraphs.** The first states the claim and its strongest fact. The second argues it.

### The argument reads as one thought

The owner's note on the first mock-up: the second paragraph read as disjointed thoughts (four short sentences side
by side). A Column's sentences are built to lean on each other: a cause and its effect in one sentence, joined by
"until", "since", "when", "because" or "and". Rules a test can hold:

- At most one sentence of fewer than eight words in a paragraph.
- At most one number a sentence. The other numbers are in the table.
- The second paragraph has two or three sentences, never four.

The mock-up's text, rewritten to this:

> **Las Vegas's problem is its pass protection**
>
> The Mirage have lost four in a row, and the pass protection is why. No club has allowed more sacks in that span.
>
> The quarterback is not the cause. Rahul Khan was completing two passes in three until Las Vegas replaced two
> starters on the line in Week 8, and his numbers fell only once the hits started. The Mirage have not won since
> that change, and they take the same line into Sunday's game at home.

### The ladder

| Rung | Blame | Credit |
| --- | --- | --- |
| 1 | "This unit is a problem": four games of it | "This unit is carrying them": four games of it |
| 2 | "It's fair to ask about him": a head coach at .300 or worse through six or more games; a GM after two losing seasons under him | "He deserves the credit": a head coach who has turned a losing club around; a GM whose trade or draft class is paying off |
| 3 | "It's time": only where the owner could act (after Week 11 on a club at .300 or worse, or a second straight losing season); a GM after three losing seasons | None. Credit stops at rung 2 |

A GM may also be named at rung 1 for one move at any time (a trade, a draft class), in either direction.

The blame rungs mirror `leadershipWeek` and `ownerBag.ts` on purpose: the press never asks for something the game's
owners could not do. They read only public facts: records, this season's box scores, transactions and the draft. A
"unit" is one of the units the Key matchups card already names (`opposition.ts`: the passing game, the run game, the
offensive line, the pass rush, the run defense, the coverage), judged by the same public stats and league places.

### It knows where the season is

The owner's note on the plan: the Column must take into account how clubs are doing as the season goes on. The same
four bad games mean different things at 9–2 and at 2–9, in Week 6 and in Week 15. Every claim carries its context,
from the public table only:

- **Where the club stands:** its record, its place in the division, and whether it is in the playoff race (holding
  a place or within two games of one), on the edge of it, or out of it.
- **Where the season is:** early (through Week 8), the middle (Weeks 9 to 13) or the run-in (Week 14 on), and the
  games left.
- **What was expected:** last season's record, so a club is read against where it came from (a 6–5 club that won
  four games last year is not a 6–5 club that won thirteen).
- **The trend:** its record in the span against its record before it.

Context does two jobs:

- **It chooses.** A contender's one weakness, and a surprise in either direction, outrank a struggling club's
  latest problem. A club already out of the race gets at most one unit-blame Column a season: after that the Column
  about it is about the men in charge, on the ladder, or it is about someone else.
- **It shapes the words.** Early, the Column says how small the sample is. In the run-in it says what is at stake
  and how many games are left. For a contender the problem is "the one thing between them and the top seed". For a
  club that is out, it is about next year. A Column never tells a 2–9 club its season depends on its run defense.

### Its limits

- **One rung at a time.** "It's time" only follows an earlier "fair to ask" about the same man, this season or last.
- **No claim twice.** The Column comes back to a subject only a rung higher, a rung lower, or to correct itself.
- **It corrects itself.** When a claim's facts reverse (the club it wrote off wins four straight, the unit it praised
  falls to the bottom quarter), a later Column says so. A correction counts as that week's Column.
- **Your club:** at most three Columns a season, and never two weeks running.
- **A first-year head coach or GM** is never named above rung 1.
- **When it reaches "It's time" about your head coach**, nothing happens. The decision is yours, where it always was.
- **Frequency:** a target of eight to ten a season. The counting tool reports the real figure and the bars move to
  meet it.

### Choosing the week's Column

Every week the editor gathers each claim that is true, drops those already made, and keeps the strongest: the highest
rung, then the widest margin past its bar, then the clubs' records, then a stable hash. A correction that is due
outranks a new claim of the same rung. If the week's lead or a tile is already about that club, the Column moves to
its next candidate, so the page keeps one story a club.

## 2. Your club's storylines

Three things become SNN stories, each read from what the league could see:

| Storyline | Opens when | Closes when |
| --- | --- | --- |
| A starter loses his job | A man who held a starting job sits healthy and another starts (the lineup is public) | He starts again, he leaves the club, or three more starts settle it |
| A trade request | It leaks (the dispute's `leaked` beat) | He is traded, or the request is withdrawn or settled in public |
| A coordinator relieved | You relieve him | Told once. It has no second beat |

- They come from the story store's public beats (`pub` in `stories.ts`), through a new public outlet (`SNN`) that sees
  only those beats and keeps its own count of what it has told, as `COACH` does. Nothing private is used: no mood, no
  rating, nothing said in a talk.
- Each takes the "your club's other news" tile that spec 1's final review added, so at most one a week, as a brief.
- A closing is one more brief in a later edition ("Bryant started against Buffalo, his first start in three weeks").
  A storyline that ends quietly (the season ends, he retires) is not closed in print.
- A quarterback's benching ranks tier 2 inside your club's news. The rest rank tier 4.

## 3. The coverage visit

### The line (the normal case)

When SNN has printed a blame story or Column about one of your men or his unit in the last two editions, the head
coach's next letter may carry one note, with nothing to answer:

> "Rhodes has seen what's being written about the pass rush. It hasn't changed how he works."

It is a note in `coachWeek.ts`'s lowest tier, so it never files a letter alone. At most one a letter and one a man a
season. Its second sentence comes from his character in words (`castSheet.ts`), never from a number. This is mail
reading mail: the letter checks what the edition covered. Nothing in the sim moves.

### The conversation (the extreme case)

A new cause for the talks that exist (`TalkCause: 'form'` in `playerTalks.ts`). All three must hold:

1. **He matters:** your starting quarterback, a captain, or a leader of the room (`standing.ts`).
2. **A long public slump:** his own numbers or his unit's in the bottom quarter of the league over at least four
   straight games he started. This is a pure function of box scores, shared with the Column's rung 1 (`slump.ts`).
3. **He is already down:** the bar the other talks use (three steps down).

It arrives as a row in the head coach's letter, with three answers:

| Answer | What it does |
| --- | --- |
| "He's my quarterback" (or "He's my man") | Reassures. A small lift, like the other talks' reassurance |
| "Play your way out of it" | Firm. A proud, driven man takes it well. A fragile one drops a little |
| Say nothing | He is left unsure, as an unanswered ask is today |

- No promise is made and nothing is remembered beyond the mood step. Backing him as a promise the room remembers was
  considered and left out.
- Once a man a season, one a letter, and never in the same step as another ask from him.
- An AI club's man gets his answer from its GM's tendencies, as the other talks do (`aiReply`), so the league's moods
  stay centred.
- The row's words may mention the coverage only when SNN did print it. The trigger never looks at mail.

## 4. How it is built

- **`slump.ts`** (new, engine): `unitForm(l, teamId, unit, games)` and `manForm(l, playerId, games)`. Public stats
  only, from this season's box scores. Pure and drawn from no stream. The Column and the `form` talk both read it.
- **`snnColumn.ts`** (new, mail-side): the ladder. `columnCandidates(l, week, have)` returns the claims that hold,
  each with its subject, rung, direction, evidence rows and key. Keys are `column:{season}:{subject}:{rung}{+|-}`,
  kept in the edition's `covered`, so "no claim twice", "one rung at a time" and corrections are lookups in
  `toldKeys`.
- **`snnWeek.ts`**: a `column` candidate kind. The cut keeps one, in a tile slot. A `storyline` kind for your club,
  from the `SNN` outlet's untold public beats.
- **`snnVoice.ts`**: `columnStory` and `storylineStory`, and the Column's line banks, one bank a rung and direction.
- **`storyRules.ts`**: the Column's three extra rules, and "a Column carries an evidence table".
- **`types.ts`**: `EditionKind` gains `'column'` and `'storyline'`. `EditionStory` gains
  `table?: { head: string[]; rows: string[][] }`. `TalkCause` gains `'form'`. `OutletId` gains `'snn'`.
- **`ui/edition.tsx`**: the COLUMN kicker and the evidence table in an open story.
- **`playerTalks.ts`, `coachWeek.ts`, `coachWeekVoice.ts`, `playerVoice.ts`**: the `form` cause, its row and its
  words, and the note.
- **Saves:** `SAVE_VERSION` 95 with an upgrade step that changes nothing (the new fields are optional and a new
  cause is a new value of an existing field).

## 5. Counting before fixing

`npm run editions -- --seasons 5` gains a summary at the top of `.check/editions.md`:

- Columns a season, by rung and direction, and how many were about your club.
- Corrections.
- Storyline tiles a season, by kind.
- Coverage notes a season.
- `form` conversations a season, for your club and across the league.

The owner reads those counts at the first check-in and sets the bars. Targets to start from: eight to ten Columns a
season, at most three about your club, and about one conversation a season for your club with many seasons at none.

## 6. Testing

- **The ladder** (`snnColumn.test.ts`): each rung from a built league, the order of rungs, no claim twice, a
  correction when the facts reverse, a first-year coach never above rung 1, nothing above what an owner could do.
- **The words** (`snnVoice.test.ts`, `storyRules.test.ts`): every Column to the writing rules and its three extra
  ones, with a table.
- **A season** (`snnWeek.season.test.ts`): at most one Column an edition, at most three about your club and never two
  weeks running, one story a club still holds, no sentence twice.
- **Storylines** (`snnWeek.test.ts`): a public beat becomes a brief once, a private beat never does, a closing is
  told once.
- **The visit** (`playerTalks.test.ts`, `coachWeek.season.test.ts`): the three bars, once a man a season, the note
  never files a letter alone.
- **The sim reads no mail** (`simReadsNoMail.test.ts`): unchanged, and `slump.ts` imports nothing mail-side.
- **Moods:** the `form` talk moves moods, so `npm run morale` is run once while building, and CI runs it on the pull
  request.

## 7. Build order and check-ins

1. `slump.ts` and the counting tool, with the bars as first guesses. **Check-in 1: the counts.** The owner sets the
   bars.
2. The Column: ladder, words, table, tile. **Check-in 2: a season's Columns rendered in the inbox.**
3. Your club's storylines. **Check-in 3: renders of each kind and a closing.**
4. The coverage note and the `form` conversation. **Check-in 4: the letter rows rendered, and the counts again.**
5. Docs, version, sign-off.

One review of the whole branch comes at the very end, before the pull request, not after this spec.

## Not in this pass

- **SNN on the calendar's big days** (draft day, cut-down day and the like). The owner asked for it after this spec
  was approved. It gets its own spec, next after this one and before chains.
- **A GM's "one move" at rung 1** (a trade or a draft class named for paying off or not). The ladder allows it.
  Judging a trade from public production needs its own rules and counts, so the first build has the GM's rungs 2 and
  3 only.

- Benchings and requests at other clubs as storylines.
- Backing a player as a promise the room and the press remember.
- Season arcs, previews and wraps, GM columns across seasons, player quotes beyond the man who speaks out.
- Spec 3, chains: one thread a story with the head coach, the owner and players.
- Still later or never: journalists and bylines, a News tab, answering the press.
