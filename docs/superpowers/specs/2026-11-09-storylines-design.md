# Storylines: a thin story engine, the head coach's weekly letter and the benching chain

Date: 2026-11-09 · Branch: `claude/blissful-hamilton-0bf2ct` · Piece one of four from the owner's inbox notes
(Nov 9, 2026). The other three (the week's order for all mail, decisions as a conversation, faces and layout for
every letter) get their own designs.

## Why

The inbox reads like separate systems each sending their own letters, not one world unfolding week by week. A
two-season replay of a losing club whose GM answers everything (`Reassure him`, every meeting held) shows it. In one
18-week season:

| Problem | What the replay showed |
| --- | --- |
| The same letter again and again | "Two players want a word" filed 9 times with the same subject and near-identical opening |
| Players forget they asked | One man asked about his contract at camp, in week 8 and in week 16; no letter mentions the earlier ones or the answer |
| Players share one script | "I hate losing, and we're doing a lot of it. Where is this going?" 6 times, twice inside one letter |
| Rooms flip weekly | The receivers: out of sync (week 6), gelling (7), out of sync (10), gelling (12) |
| One room twice in one letter | The position coach's "my room's split", then the head coach's "out of sync" for the same room |
| Results repeat and arrive at once | "I let Emmanuel do the talking…" four times; pick "Before Wednesday's practice" and "How it went" lands the same moment |
| Pile-ups | A player's ask, a meeting request, staff notes and a meeting result in one week, all from the head coach |
| No cause and effect | A man's contract ask in week 8 and his room's meeting in week 9 (which offers "We're talking to his agent") don't know about each other |

The cause is structural. About 40 letter writers each read the league and file when their own condition holds. Each
keeps its own memory (talks remember talks, meetings remember meetings, rooms remember rooms). Nothing in the save
says a story exists: who it is about, what caused it, where it stands.

The GM memory build (`docs/superpowers/specs/2026-11-07-gm-memory-voice-design.md`) already has the right shape for
one relationship: the sim makes facts, a ledger keeps moments, words quote a moment when one is worth it. This design
gives the locker room the same shape.

## Decisions (agreed in the brainstorm)

1. **A thin story engine.** Stories, beats and a weekly editor, sized to what this pass needs and built to be added
   to: more story kinds, more flavor, and later more outlets (SNN, the Gazette).
2. **It never invents drama.** A story only tracks and tells what the sim did. Every sentence is chosen by a
   condition on facts, as `scouting.ts` and `voice.ts` already require.
3. **One letter a week from the head coach.** Player asks, the meeting request, the staff's notes and last week's
   meeting result are its sections, not separate letters. A quiet week sends nothing.
4. **Letters mention each other.** Across weeks, letters stay separate and say what came before ("Second time on his
   deal. You reassured him in week 8."). No folded email chains.
5. **A meeting's result comes in next week's letter**, told from what changed in the room, not sorted into "took it
   well", "bristled" and "shrugged".
6. **The benching chain.** Jobs are set on cut-down day, from the lineup you set. A healthy starter you sit asks "Am
   I benched?"; you answer one of four ways; later letters follow up. A man who is hurt never asks. A man just back
   from injury gets the coach's reminder first and asks after one game sat. Left unanswered, he isn't told it's over:
   he is left not knowing where he stands, and so is the other man if you swap them back. A clear word to either
   settles it for both.
7. **Flavor from the sim.** Lines read one shared sheet of what your staff can see about a man (his personality
   read, habits, standing in the room, ties, history with you), so two men with the same grievance don't say the same
   thing.
8. **No sentence twice in a season** from the same sender, and a room's turn is told only once it has held two
   weeks.
9. **Old saves keep the letters they have.** Only new mail follows these rules.

## 1. Stories

### The record

```ts
type StoryKind = 'deal' | 'snaps' | 'benched' | 'losing' | 'feud' | 'room' | 'staff';

interface Story {
  id: number;
  kind: StoryKind;
  teamId: number;
  /** Who it is about: a player, a room, or a coach (a `staff` story). */
  playerId?: number;
  unit?: Unit;
  coachId?: number;
  /** The other man: a feud's second side, the player who took a benched man's job. */
  other?: number;
  /** Morale's clock when it opened, and when it closed. */
  opened: number;
  closed?: number;
  /** An open clock (a promise, a commitment): the editor reminds at halfway and when it is due. */
  due?: number;
  /** Stories this one feeds: a leader's deal behind his room's mood. */
  feeds?: number[];
  beats: Beat[];
  /** How many of its beats each outlet has told. */
  told?: Partial<Record<OutletId, number>>;
}

interface Beat {
  at: number;
  kind: BeatKind;
  /** The league would know (a starter sat, a request leaked): what a public outlet may read later. */
  pub?: true;
  /** What happened, in a word: your reply, the backing chosen, the room's read, how it ended. */
  how?: string;
}

/** A beat's kinds are the words in the table below ('asked', 'answered', 'promised', 'kept', 'sat'…), one union. */
type OutletId = 'coach';
```

`League.stories?: { next: number; open: Story[]; closed: Story[] }`. Plain JSON. A story holds twelve beats at most
(the oldest middle beat goes first; the opening and the last three stay). Closed stories are kept through the next
season's-end report, then dropped.

### How beats get in

Two ways, both in a new module `stories.ts`, both record-keeping only: nothing in the sim reads a story, and nothing
here draws from any stream.

- **At the event** (`beat(league, …)`, one line at each site, as `logMove` does for GM habits): an ask filed, your
  answer, a promise made, kept or broken, a meeting suggested, held or passed, a commitment kept or broken, a dispute
  starting or ending, a contract signed, a man sat, a man leaving the club.
- **At each morale step** (`storiesStep(league)`, after `meetingsStep`): what is read rather than done. A room turning
  Down or Split and coming back, chemistry turning, a room's belief in its coach falling, a head coach's word wearing
  thin. This is where the two-week rule lives: a turn opens or adds a beat when it happens and becomes tellable once
  it has held two steps (a meeting request for that room tells it at once: the ask can't wait).

Stories are written for your club only in this pass. The shape carries `teamId` and `pub`, so recording other clubs'
public beats later is a question of how much to keep, not a new shape.

### Links

`storiesStep` links a player's open story to his room's when the sim already says so: he is a leader or voice in that
room (`tierOf`), his mood is Poor or worse and his top reason is the story's cause. The link carries his share of the
room's weight in words: "part of it", "most of it". No link, no "why" sentence.

### Kinds in this pass

| Kind | Opens | Beats | Closes |
| --- | --- | --- | --- |
| `deal` | He asks about his contract | answered, promised, commitment made (from a meeting), talks opened, asked again, held in or out, leaked | signed, promise broken and soured, he leaves |
| `snaps` | He asks for snaps | answered, promised, playing more | kept, broken, he leaves |
| `benched` | He sits a game healthy (section 4) | asked, answered, back in, sat again, still sitting | back in the job, the job is another man's, he leaves |
| `losing` | He asks about the losing | answered, asked again | his mood lifts, he leaves |
| `feud` | A feud starts (`ties`) | met about, picking sides | it ends, one of them leaves |
| `room` | A unit reads Down or Split | meeting suggested, held (the choices), result, commitment kept or broken | back to Settled or Tight, held two steps |
| `staff` | A room's belief in its coach falls past the warning line, or the head coach's word wears thin | in doubt, stood behind, on notice, relieved | belief back, the coach gone |

Holdouts, hold-ins and trade requests keep their own letters (`disputeMail.ts`); they add beats to the man's `deal` or
`snaps` story, so those letters and the coach's can say what came before.

## 2. The cast sheet: flavor

Today a player's letter reads eight facts about him (`LetterFact`: cause, loud, calm, veteran, young, final year, the
record, starter). The sim knows far more. One module, `castSheet.ts`, builds what a line may say about someone, and
every bank in this pass reads it. Words and booleans only, never a number, and only through the readers screens
already use, so the fog of war holds.

**A player** (`manSheet`, your club only):

- Who he is: position word, years in the league, role (starter, rotation, depth), captain.
- His makeup as your staff read it: the personality name (`personalityRead`, hedged when the read is loose), loud or
  calm, and his agent's lean in words (wants the money, wants to win, loyal).
- In the room: leader or voice (`tierOf`), a Spark or an Anchor (`soundOf`), his friends, his feud and what started
  it, his mentor or the man he mentors.
- On the field: one habit our staff have seen (`quirkNotes`: its label and clause), last season in a sentence when it
  decides something (`seasonNote`), back from an injury this month.
- His contract in words: final year, rookie deal, paid under his market.
- His history with you: asks this league year, your last answer and when, promises kept and broken, a dispute this
  year.
- His past: drafted here, a homecoming, a grudge against Sunday's opponent (`relationships.ts`).

**The teller** (`coachSheet`): his style from discipline (`styleOf`), his motto, new this year, his word with the
players (`credibilityRead`), and for a position coach, his room.

**The moment** (`momentSheet`): the record and the streak, last game's story (`gameStory`: a comeback, a lead let
go), next opponent (a division rival, a man's former club), the week (deadline, the push, the bye).

### How lines use it

- Banks stay rule lists through `say`: the most specific line that fits wins. A line that reads the man ("Mercenary",
  final year, second ask) beats one that reads only the cause.
- A paragraph is composed of slots, each its own bank: **history** (what came before, from the story), **core**
  (what he wants), **color** (the man), **close**. Slots multiply: a few lines each give far more letters than one
  bank of whole paragraphs.
- Color is optional and capped: at most one color sentence a row, and silence over filler.
- **No repeat in a season:** `say` is given every sentence the sender filed this league year (bodies and row notes,
  read off the inbox), not just his last five letters. When a bank runs dry it falls back to the plainest line that
  states the fact, never to a duplicate inside the same letter.

Adding flavor later is adding lines and sheet fields: no engine change.

## 3. The weekly letter

### The editor

`coachWeek.ts`, called from `deliverMail`. Each morale step it gathers what could be told from your club's open
stories and the staff's notes, ranks it, and files one letter or none.

Ranking, highest first:

1. What needs your answer (an ask, a meeting request, a man cleared and not back in his spot).
2. A story closing (he signed, the promise broke, the room is back).
3. A result owed (last step's meeting) and a clock (a promise or commitment at halfway, or due).
4. A room's turn that has held two steps, or a staff story's beat.
5. Notes with no story: a depth-chart call, habit work.

Budget: everything in tiers 1 to 3, then up to four more rows. What doesn't fit waits a week; a tier 4 or 5 item that
has waited three weeks is dropped, not told stale. The letter records what it told in `covered` and on each story's
`told.coach`.

### The letter

From the head coach (`headCoach`; "Coaching staff" when the chair is empty), category `staff`, id
`coach:{season}:{clock}`. It needs you while any of its asks is open.

- **Subject:** the headline of its top one or two items, not a fixed title: "Stokes's deal, and the D-line", "Stokes
  signed", "Am I benched? Gibson wants to know". Never the same subject twice in a season: when it would repeat, it
  takes the week's second item or the beat ("Stokes's deal: two weeks left").
- **Opening:** one or two sentences in his voice that tie the week together. When stories are linked he says so:
  "The D-line is down, and part of it is Stokes."

Sections, each only when it has rows, in this order:

1. **Since last week.** How last step's meeting went (below), a promise or commitment at halfway or due, a story that
   closed.
2. **Who came to see me.** A row per man: his face, his words (from the cast sheet), the coach's line on what came
   before, and your answers. Two men never share a sentence in one letter.
3. **The rooms.** One row a room at most, signed by its position coach when it has one. It names who is down and why
   (`roomReasons`), and the man setting the tone. Chemistry is a clause in the room's row, not a second row.
4. **What I want to do.** The meeting request and its choices, worded from the rows above ("I can talk to them, but
   what fixes it is his deal").
5. **From the staff room.** The depth-chart call and habit work, as the staff notes carry them today. The letter keeps
   `coachNoteKey` and `coachNote`, which `coachDecisions.ts` reads.

### A meeting's result, a week on

Pressing Go ahead answers in the letter at once: "Set for Wednesday. I'll tell you how it went." The result is the
first row of the next letter, and a letter is always filed when a result is owed.

It is told from what the league shows a step later, not from three stock verbs:

- Each named man by how he is now and why: his outcome at the meeting (`outcomes`), his mood this step and his top
  reason. "Nelson heard it and he's in a better place." "Tate is still down. It's his deal, not the losing, and a
  speech doesn't fix that."
- The rest of the room by its read now against its read then (`MeetingRecord.word`, new: the room's word when the
  meeting was held): "The room's steadier than it was a week ago", "Nothing moved."
- What we owe and by when, with the Negotiate button, as today.

`TOLD`, `WENT` and `restLine` in `meetings/voice.ts` are rewritten on these facts; "shrugged" goes.

### What it replaces

| Today | After |
| --- | --- |
| `talk:{season}:{clock}[:{player}]` (one man, or "Two players want a word") | "Who came to see me" |
| `meeting:{season}:{clock}:{scope}` (the suggestion) | "What I want to do" |
| `meeting-result:{season}:{clock}:{scope}` (the same moment) | "Since last week", a step later |
| `staffNotes:{season}:{week}` | "The rooms" and "From the staff room" |

Unchanged: the four locker room reports a year (on a report's day the weekly letter leaves the rooms to it, as
`reportTellsRooms` does now), dispute letters, the captain's word after your address, the season's-end promises
reminder, SNN's rumors. The Locker Room screen keeps its meeting choices.

The old ids keep working for letters already filed: `mailSubject`, `needsYou` and their cards stay.

## 4. The benching chain

A new sim event with its letters. It replaces the in-season `benched` jolt, which today lands silently three games in
from a man's snap count.

### Who holds a job

`Team.jobs?: Record<number, { pos: Position; since: number }>`, kept by `benching.ts` for every club at each
in-season morale week, after the games:

- **Jobs are set on cut-down day.** The men listed in the starting spots of each club's depth chart when the season
  starts hold the jobs, hurt or not (a hurt starter keeps his spot on the chart; the man covering for him has no
  job).
- **Started:** he was in a starting spot of the lineup his club took into the game, read at kickoff (`benching.ts`
  notes each club's lineup before the week's games). A man hurt or pulled during the game still started; snap counts
  don't decide it.
- **In season a man earns a job** by starting three games in a row while no job-holder at his position is out hurt. A
  fill-in covering for a hurt starter never earns it, so he doesn't ask when the starter returns.
- **He loses it** when he leaves the club, when your word gives it to another man, when another man earns it, or at
  the new league year.

### Setting the lineup

Because the chart on cut-down day decides who holds a job, the game asks for it, the way it sends you to the draft
room while picks are left:

- On the last step of camp, while you sort your depth chart by hand (`autoDepth` off) and haven't confirmed it this
  year, the advance button reads **Set your lineup** and opens the depth chart (`offseasonStep` in `App.tsx`).
- The depth chart shows a banner there: "These men start the season holding their jobs. Sit one of them healthy and
  he'll ask you why.", and a **Lineup set** button (`Team.lineupSet`, the season). The advance button then starts the
  season as it does today.
- With your staff sorting the chart, nothing blocks: it is their lineup.
- Either way the head coach's camp letter carries a row: who holds each job, and any camp battle he sees as close, on
  our scouts' read.

### What counts as sitting

A job-holder who was available for his club's game and didn't start it. Available means he could have played: not
hurt, not on injured reserve, not sat on the doctor's advice (*Sit him this week*), not holding out or still off the
53 after one (`onDidNotReport`). Moving him down the chart and back before kickoff is nothing: only the game counts.
Starting at another position counts as starting (below).

### Back from injury

The week a job-holder is cleared and isn't listed in a starting spot, the coach's letter says so in tier 1: "Stokes is
cleared and still listed third. Put him back?", with a **Put him back** button (the depth chart move the roster screen
makes, to the spot auto-sort would give him) and **Leave it**. If he then sits one game healthy, he asks, like anyone
else.

### The ask and your answers

He asks the step he sits: a new talk cause, `benched`, in the talks that exist (the two-step wait, two asks a club a
step, the quiet after an answer). His words come from the cast sheet: a ten-year captain and a second-year man don't
ask the same way, and the man who took his job is named.

| Answer | What it is | Then |
| --- | --- | --- |
| **You're back in next week** | A promise | Kept when he starts the next game he's available for; broken when he doesn't |
| **It was just this week** | A reassurance | Fine if he starts again; if he sits again it sours, as a soft word broken |
| **Earn it back** | Honest | The job is open and both men know it. Starting three in a row wins it and closes the story |
| **It's his job now** | Final | He loses the job. The full hit lands, and a veteran may want out by the rules disputes already have |

### Left unanswered: not knowing where he stands

A sitting job-holder opens a **job question** between two men: him and the man who started in his place. No answer
doesn't close it. His row stays answerable in the letters that follow, and:

- **Each week the question is open, whichever of the two sat feels it** (a small `unsure` jolt that fades, the reason
  on his card "Doesn't know where he stands"). It is smaller than a benching but it keeps coming.
- **Swap them back without a word and it passes to the other man.** He sat after starting, nobody has told him
  anything, and he asks the same question the week he sits. His answers mirror the first man's: **The job's yours**,
  **Keep competing**, **It's his job**.
- **A clear word to either man settles it for both.** Any answer on either row closes the question: both men's
  `unsure` jolts are cleared and each gets the same small lift for knowing where he stands. The answer's own
  meaning still lands on top (the man who lost the job takes that hit; a promise has to be kept).
- **Nobody says anything, and the chart answers.** When one of them starts three in a row he earns the job by the
  rule above. The other finds out from the depth chart: the full hit, and it sours as an ignored talk does today.

So swapping two men week to week with no word unsettles both, and one honest sentence fixes both. Other clubs'
GMs answer at once, so this only ever happens at your club.

### How he takes it

The `benched` jolt stays one kind, so the meeting trouble for a benched leader, the talks' cause map and the words on
his card keep working. Its size now comes from the answer and the man:

- The hit lands the step he sits. A promise or a reassurance softens it; "It's his job now" is today's full size.
- An honest answer costs half when the man ahead of him is plainly better on his own read (`expectedRole`: a depth man
  knows who is ahead of him).
- A calm, professional man takes any answer better; a volatile one takes "earn it" badly (`temperamentOf`).
- Kept, the promise lifts him. Broken, it costs more than the benching did, and he remembers it (`broken`).

The sizes are starting values, tuned until `npm run morale` holds with no range moved: the benching lines (a drop of
1.5 or more the week it lands, within 1.5 of his target six steps on), band shares and asks per club per season.

The new-league-year benching (a room that passed him over the winter) stays as it is: there is no game to sit.

### Other clubs

Their players ask the same way, so the league stays even. An AI GM answers at once (`aiBenchReply`, beside
`aiReply`): "It's his job now" when the new man is better on its own read, a promise from a loyal GM for a veteran,
"earn it back" otherwise. Nothing is filed for them.

### The story

`benched`: sat, asked, answered or left open, then back in, sat again, swapped back or still sitting, and its
close. One story holds both men of a job question (`playerId` and `other`). When he is a leader, his story feeds his
room's (the meeting trouble that exists). The letters:

- The week he sits: his ask in "Who came to see me".
- The next week: how he took your answer, from his mood and reason now.
- While it stays open: a row a week in "Who came to see me", worded from the story, not repeated: "Gibson still
  hasn't heard from you. Now Reyes is asking too."
- When it resolves: one closing row. "Gibson's back in and it's behind us." / "I told Gibson it's Reyes's job. He
  took it like a pro. He won't love it." / "Neither of them was told. Reyes has started three straight, so that's
  that, and Gibson heard it from the depth chart."

## 5. When things change mid-story

Stories, jobs and letters all meet players who get hurt, traded or cut partway through. One rule covers most of it: a
story is about men at a club, so when the facts under it change, it pauses or closes with one sentence saying why,
and never leaves a letter asking about someone who is gone.

### Injuries

| Situation | What happens |
| --- | --- |
| A job-holder is hurt | He keeps his job, on injured reserve too. The man covering him starts but can't earn it, and doesn't ask when the starter returns |
| A job-holder is hurt during the game | He started. No benching |
| A man waiting on your answer gets hurt | His ask stays open; he isn't unsure while he can't play |
| Either man of an open job question gets hurt | The question pauses: nobody is unsure and no start counts toward three in a row. It resumes when both can play |
| One of them is out for the rest of the season | The question closes with no hit: the job is the other man's until the new league year. One closing row says so |
| "You're back in next week", and he gets hurt first | The promise waits for the next game he can play |
| "You're back in next week", and the other man gets hurt | He starts as promised: kept |
| Back from injury, a holdout or a suspension of any kind | The coach's reminder the week he's available and not listed in a starting spot, then the one-game rule |
| The doctor sits him (*Sit him this week*) | Not a benching, and the week doesn't count for or against anyone |
| A bye | No game: nothing counts, and "next week" means the next game |

### Trades, cuts and retirements

| Situation | What happens |
| --- | --- |
| A man with an open story leaves the club (traded, cut, claimed, retired) | His stories close with the beat "left". Any link to his room's story goes; the room's story stays if the room is still down |
| He leaves with an ask unanswered | The row closes as talk letters do today ("This talk is closed") |
| He leaves with a promise open | As promises work today: his talk record goes with the club he left, and how he left is remembered (`Player.left`) |
| One man of an open job question leaves | The question closes: the job is the other man's by fact. His uncertainty clears with no lift (nobody told him), and one row says it: "Reyes is gone, so it's Gibson's job again" |
| A job-holder leaves | His job is empty. Whoever starts three in a row earns it |
| A new man arrives (trade, signing, waiver claim) and starts over a job-holder | An ordinary benching: the holder asks, and the new man is the `other` the letter names |
| A man the meeting's commitment named leaves | The commitment is kept or broken by the rules commitments have today; the room's story takes that beat |
| A feud's man leaves | The feud's story closes; the room's row says the room is quieter for it only if its read moved |

### Positions

| Situation | What happens |
| --- | --- |
| A position change on cut-down day | Jobs are read after the flips, from the chart at kickoff |
| A job-holder lines up at another position and starts there ("Play at…", yours or the staff's cover) | He started. His job stays at his own position, and the man in his old spot is covering: he can't earn it |
| A room with several starters (three receivers, five linemen) | A job is a place among the starters at his position, not a named spot: moving from left tackle to right is nothing |
| Who "took his job" | The man who started at his position without holding a job there. With two, the one listed higher on the chart. With none, no man is named |
| Two job-holders sit the same week | Each opens his own question. Talks still hear two asks a club a step, so a third waits a week |
| Kickers and punters | The same rules: one job each |

### The calendar

| Situation | What happens |
| --- | --- |
| The club's season ends (eliminated, or out of the playoffs) | No more games, so no new benching and nobody is unsure. Open job questions rest until the new league year |
| The new league year | Jobs clear and are set again on cut-down day. An open job question closes quietly. Other stories carry over while their cause does (a contract ask in the re-sign window is the same story) |
| Letters after your season is over | The moment sheet knows the season is done, so no line talks about Sunday |
| A playoff game | A game like any other |

### The people writing

| Situation | What happens |
| --- | --- |
| A new head coach mid-story | The letters come from him. A callback to his predecessor's meeting names the man who held it ("Vo told the D-line…"), from the coach the commitment already records |
| The chair is empty | "Coaching staff" signs, as today, in a plain voice with no motto |
| A position coach leaves | His room's row is the head coach's until the chair is filled |
| A coordinator is relieved | His `staff` story closes with that beat |
| You lose or leave your job | Open rows close, as talk letters do today. Stories belong to the club you left and are dropped; at a new club they start empty from the step you arrive, like meetings held before you came. Jobs are kept for every club, so the new club's are already set |
| A save upgraded mid-season | Section 8 |

## 6. Outlets: the seam for news

The head coach's letter is the first reader of the story store, not the only one it is built for.

```ts
interface Outlet {
  id: OutletId; // 'coach' in this pass
  /** Which beats it may tell: the coach sees his own club's; a public outlet only `pub` beats. */
  sees: (league: League, s: Story, b: Beat) => boolean;
}
```

Each story keeps what each outlet has told (`told`), so two outlets never step on each other and neither repeats
itself. After alpha, the "Full news and media outlets" item (`docs/MVP.md`, `docs/NEWS.md`) can add SNN features and
season arcs as outlets that read `pub` beats (a starter benched, a request leaked, a coordinator relieved), with
other clubs' public beats recorded then. Nothing in this pass files news from stories; SNN and the Gazette are
untouched.

## 7. The screen

`MailSections` gains a layout for these rows (`ui/mail.tsx`), following `docs/UI.md`:

- Each row opens with a face: the player's (`PlayerAvatar`) or the position coach's (`StaffAvatar`), then his name
  through `PlayerLink` and one line of facts.
- A player's words are a quote under his name; the coach's line on what came before sits above it, muted.
- Answers sit in the row: `TalkCards` as today, the four benching answers, **Put him back** and **Leave it**,
  `MeetingChoices` in "What I want to do", `NegotiateButton` where a deal is owed.
- An answered row shows what you said and how it stands now, read live from the league.

Faces and this layout for every other letter kind are a later piece.

## 8. Saves

`SAVE_VERSION` goes up by one (the GM memory branch does too; whichever merges second takes the next number). All
new fields are optional: `League.stories`, `Team.jobs` (with a job's open question), `Team.lineupSet`,
`MeetingRecord.word`, the `benched` talk cause, the `unsure` and `settled` jolts.

The upgrade seeds `Team.jobs` for a save loaded in season (a depth-chart starter with three games played holds his
job), so nobody asks about a benching that happened before the upgrade, and marks this year's lineup as set, so a
save in camp isn't stopped at the door. Stories start empty and fill from that step
on. Letters already filed stay and still open their cards.

## 9. Testing

- **Season replay** (`coachWeek.test.ts`): play a season as a GM who answers everything. At most one coach letter a
  step; none of the replaced ids filed; no sentence from the head coach twice in the season; no room told twice
  inside three steps; no two men in one letter with the same sentence; every meeting held gets its result in the next
  letter.
- **Stories** (`stories.test.ts`): each kind opens, takes its beats and closes from the sim's events; twelve beats at
  most; a link only for a leader or voice whose reason matches; recording stories moves nothing (the same seed plays
  the same games with your club's stories recorded or, by a test switch, not).
- **Cast sheet** (`castSheet.test.ts`): no number in any field; another club's player gives nothing; a loose read is
  hedged.
- **Benching** (`benching.test.ts`): a hurt man never asks; a man sat on the doctor's advice never asks; a mid-week
  shuffle undone by kickoff is nothing; a fill-in stepping back doesn't ask; a man back from injury gets the reminder
  and asks after one game sat; each answer's promise is kept or broken by the next game; an AI club answers at once;
  jobs come from the chart at kickoff, a hurt starter keeping his; an unanswered ask leaves him unsure each week he
  sits, a swap passes it to the other man, an answer to either clears both with the same lift, and three straight
  starts settles it by the chart; the advance button asks for the lineup only when you sort the chart by hand and
  haven't confirmed it.
- **Mid-story changes** (`stories.test.ts`, `benching.test.ts`): one test per row of section 5's tables, so a hurt,
  traded, cut or retired man never leaves an open row, a paused question draws no jolt, and a closing row is filed
  once.
- **Checks:** `npm run morale` in CI with no range moved. Nothing in `src/engine/match/` changes, so no other sim
  check is called for.
- **Letters to read:** `npm run mail-preview` gains moments for a room going down, a benching and a result week;
  `npm run screens -- --mail coach` shoots them for the owner before merge.

## 10. Build order

Two steps on this branch, each leaving the game working:

1. **Stories, the cast sheet, the editor and the weekly letter** (kinds `deal`, `snaps`, `losing`, `feud`, `room`,
   `staff`). Mail and record-keeping only: no number moves.
2. **The benching chain** (`benching.ts`, the `benched` cause and story, its rows). Changes the sim; judged by
   `npm run morale`.

Each step bumps the last version number and adds a changelog entry; `docs/NEWS.md` and the architecture notes in
`CLAUDE.md` are updated with the modules.

## Not in this pass

- The order of the rest of a week's mail (recaps, injuries, reports) and a cap on it.
- The meeting request as a back-and-forth with the coach: its three rows of choices stay, inside the weekly letter.
- Faces and the new row layout for every other letter kind.
- SNN or Gazette stories from the story store, and stories for other clubs.
- The offseason benching (a room that passed him over the winter) as a conversation.
