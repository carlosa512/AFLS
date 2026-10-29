# Fewer, fuller letters: the locker room report, waivers, position moves and staff notes

Date: 2026-10-29 · Branch: `claude/clever-bell-3tr3fx` · Chunk A of the owner's mail notes (Oct 28, 2026)

## Why

A season's inbox fills with one-line letters about the same kind of thing: six "X loses his mentor" letters on one
day, three "claimed by the Fog" letters in a row, a feud letter per pair, a mentor letter per player. Each says one
fact and opens a player card. The position-change letter is a stack of mini-letters you click open. And the staff's
coaching notes ride inside letters about something else: "Foster has focused coaching attention on Booker's Peeks in
the Backfield habit" is spliced into the first sentence of a 36–24 loss recap, and the depth-chart call ("Nichols
recommends Snyder ahead of McKinney") sits at the foot of an opposition report.

The goal is fewer letters that each say more, in a voice that feels like a real staff writing to its GM: Football
Manager's inbox, with an NFL locker room behind it.

This is chunk A of six from the owner's notes. The others (sender identity, contract letters you can act on, the
Locker Room screen and captains, the director's upgrades, SNN press) get their own designs.

## Decisions (agreed in the brainstorm)

1. **The locker room report arrives at set check-ins, four a year.** No one-off locker room letters at all: feuds,
   mentor changes and friendships wait for the next report.
2. **Waivers: one letter a day**, with what happened (results) and who to look at (on the wire now).
3. **"On the wire now" is about depth and upside, not starters.** Players at positions where we're thin, whom our
   scouts read as having a high ceiling.
4. **Position changes: one full letter**, not a fold.
5. **Staff notes leave the recap and the opposition report** for their own weekly letter, sent only in weeks with a
   note. Recaps are about the game again.
6. **Lively, FM-style prose.** Each sentence chosen by a condition on what the staff can see, the most specific line
   winning, varied but reproducible.
7. **Old saves keep the letters they have.** Only new mail follows these rules.

## What changes

| Today | After |
| --- | --- |
| "X loses his mentor", one per player (`lockerMail.ts` `gone`) | Mentoring section of the next report |
| "Dunn and Mack don't see eye to eye", one per pair (`feudMail`) | Friction section of the next report |
| "Carter is learning from Tate", one per player (`took`) | Mentoring section of the end-of-season report |
| "X has grown up" (`grownUp`) | Grew-up section of the end-of-season report |
| "X takes Y's release hard" (`friendGoneMail`) | Getting-along section of the next report |
| "Our captains" (`captains`) | Captains section of the camp report |
| One letter per waiver result (`waiverMail` in `inbox.ts`) | One waiver letter per day: results plus on the wire now |
| "2 players change position", folded (`positionMovedMail`, `FOLDED`) | One full letter with a table |
| Coaching note inside the recap's opening (`userCoachGameObservation`, `teachingObservation`) | Weekly staff-notes letter |
| Coaching note at the foot of the opposition report (`coachAdviceObservation`) | Weekly staff-notes letter |

Unchanged in `lockerMail.ts`: SNN's speaking-out letters (chunk F reworks them), coaching trees on SNN, and the free
agency letters (a player who'd like to come home, a player who asked about us). `recapAside` stays: it's about the
game.

## The locker room report

Signed by the head coach (`headCoach` in `lockerMail.ts`; "Coaching staff" when the chair is empty), category
`staff`. Never asks anything of you.

### When

| Check-in | Phase and moment | Id |
| --- | --- | --- |
| Camp opens | `preseason`, once captains are named | `locker:{season}:camp` |
| Cut-down day | the day the roster goes to 53 | `locker:{season}:cutdown` |
| Deadline week | `regular`, the trade deadline's week | `locker:{season}:deadline` |
| Season's end | `resign`, after mentoring's year end lands | `locker:{season}:end` |

Each report covers what changed since the one before it, read from what the league already stores (`p.lostMentor`,
`p.ties` with their `since`, `p.mentoredBy`, `p.shiftedLast`, `p.left`, `team.captains`). A pair or event the report
has told is told once: a report notes the ids it covered (`covered` below), and the next one skips them. If a
check-in has nothing to say beyond the verdict, it still files (a quiet room is news too), at most a few lines long.

### Sections

Each section shows only when it has rows. Order:

1. **Captains and leaders.** The three captains and up to five more leaders (`leadersOf`), each with our read of his
   personality (`personalityRead`, hedged when the read is loose). The camp report says why each captain has the C,
   from what our staff can see: years in the league, his read as a leader, whether he starts. (Who *should* be captain
   is chunk D; this section reports whoever `nameCaptains` picked.)
2. **Mentoring.** Each pair and how it's going, in the Locker Room screen's words (learning well, slow, not taking).
   Changes since the last report: a mentor cut, traded or retired, and who the staff paired the player with instead
   (or that he's waiting for one, when you run mentoring yourself). Where a pairing isn't taking, the staff's
   suggestion, from the same planner AI teams use (`planMentors` logic, read-only): another veteran in the room who'd
   suit him better, and why, in words.
3. **Friction.** New feuds (`ties` of kind `feud` since the last report) and how they started (`why`: a benching, a
   contract). One line on whether the coach thinks it's reaching the field; nothing the engine doesn't do.
4. **Getting along.** New friendships, and anyone taking a friend's release or trade hard.
5. **Grew up** (season's end only). Who changed for the better and who learned from his mentor, in words, never
   numbers. The old `grownUp` and `took` conditions decide who's listed.

The report opens with a one-line verdict on the room (see "Voice") and closes with a **Locker Room** button.
Player names are `PlayerLink`s; each row's player opens his card.

## The waiver letter

From the director of scouting (`director` in `inbox.ts`), category `contracts`, id `waivers:{season}:{phase}:{week}`
(one a day; a day with nothing to say files nothing).

### Results

One table, a row per waiver result that concerns us (the same results `waiverMail` reads today):

- **Our releases:** position, name, age, our read (`Ovr` on our view), years left on his deal, and what happened:
  claimed by a club (his contract went with him, nothing on our cap) or cleared (a free agent; what his release
  leaves on our cap).
- **Our claims:** won (he's ours on his current deal) or lost (the reason we already give: a club with higher priority
  won).

### On the wire now

While players sit on waivers and a claim is still open to us, up to three rows:

- **Who qualifies:** a position where we're thin (bodies under contract and available against the depth a club
  normally carries at that spot, from the roster rules in `roster.ts`), and a ceiling our scouts read as high (the
  top of our perceived ceiling range, via `perceive`, at least a starter's level), with our scouts knowing him well
  enough to name him (the director's existing `MIN_KNOWLEDGE` bar). A player we released ourselves never appears.
- **The row:** position, name, age, our read now, his contract, the reason in one sentence ("Two safeties behind
  the starters. Raw, but our scouts see a starter in him by 25."), and our chance: our place in the claim order
  (`waiverOrder`) and a word for it (good chance, maybe, long shot) from how many clubs with priority over us are
  thin at that position too, on the public file (rosters are public).
- **A Claim button** per row (the claim the waiver screen already makes, via `claimMove`), disabled with the reason
  (`claimProblem`) when we can't.
- **Needs you:** the letter needs you while one of its listed players is still claimable by us. `needsYou` works it
  out from the league as it is; nothing stored.

Ordering: the thinnest position first, then the higher ceiling. Three at most.

## The position-change letter

From the head coach, category `staff` (as today; the inbox already badges it Training), id `positionMoved:{season}:{phase}:{week}` (one letter for the day's moves).
`positionMoved` leaves `FOLDED`. The letter opens with a sentence on the day ("Two moves at cut-down: both
corners going inside."), then a table: name, from → to, the coaches' reason (`reasonLine` and
`positionTeachingNote`, as today), and how far along he is learning the new spot, in words. Each name opens his
card; a **Depth chart** button at the bottom.

## The staff-notes letter

From the head coach, category `staff`, id `staffNotes:{season}:{week}`. Filed once a week, only when there is a note.
It collects what the recap and opposition report carry today:

- the depth-chart recommendation and its follow-ups (`coachAdviceObservation`: recommendation, followup, revisit),
- habit work on a player (`userCoachGameObservation`),
- teaching notes (`teachingObservation`).

Each note is a line signed by the coach who made it (his name and chair), with a button to the player and one to
the depth chart. The letter keeps `coachNoteKey` and `coachNote`, which `coachDecisions.ts` reads to know what the
staff has already told you; that must keep working, so the key moves with the note and nothing is told twice.

Recaps and opposition reports stop calling these functions. The recap's opening goes back to the result and the
story (`gameStory`); the opposition report ends with its read and the height mismatch.

## Voice

### The method

Three ideas from writing procedural text, used together:

1. **Most specific line wins.** Valve's dynamic dialogue system (Elan Ruskin, GDC 2012) keeps lines as rules with
   conditions and picks the one whose conditions match the most facts, falling back to plainer lines. We do the
   same per sentence: each candidate line has a condition (`when`) and a weight of how many facts it reads; the
   most specific match wins. "Dunn and Mack still aren't talking" (a feud from an earlier report that's still on)
   beats "Dunn and Mack don't see eye to eye" (any feud).
2. **Salience before variety.** Emily Short's measure for generated text: how much of the world a line reflects
   matters more than how many synonyms fill a slot. A line that names the benching that started a feud beats three
   ways of saying "they don't get along". So the banks are wide in conditions and only modestly wide in wording.
3. **Vary the parts that repeat.** The verdict line and the section openers are the parts a player reads every
   report, so those get the most variants; the rows stay plain and scannable.

When several lines tie, the pick is a stable hash of the letter's id and the sentence's slot (no `Math.random`, no
RNG stream: mail never touches the sim's randomness), so a letter reads the same every time it's rebuilt. A line
the same coach used in his last five letters is skipped when another candidate fits, read off the inbox itself.

### The register

Real NFL coaches at the podium talk in short, flat sentences, repeat their mottos, and keep the room's business in
the room. Notes from real press conferences that set the tone (paraphrased; we write our own lines in the same
register and never put real people's words in the game):

- **Turning the page.** Belichick answered question after question after the 41–14 loss in Kansas City with
  "we're on to Cincinnati", and later said he could have said it a hundred times because the team had to move on.
  Our coach after a bad stretch: "We looked at it, we fixed what we could. On to Denver."
- **A motto, repeated.** Tomlin's "the standard is the standard", used when a starter is out, and "we are not in the
  excuse-making business." Each head coach gets one signature line, picked once from his id, used at most once a
  report: "Next man up", "We don't make excuses in this building", "It's a long season", "Ball's in our hands."
- **The room's business stays in the room.** Coaches on practice fights: "we'll handle it internally", "it was
  squashed pretty quickly." Our friction lines: "It's handled. If it ever gets onto the field, you'll hear it from
  me before you hear it from SNN."
- **Captains are the room's call.** Many clubs vote for captains; coaches talk about it as the players' choice:
  "Gave Roberts the C. Second year, I know, but the room already goes to him."

Each sender keeps the voice `inbox.ts` gives it: the head coach direct and a bit dry, position coaches plain and
about their own room, the director analytical and hedged.

Sample lines (illustrative; the banks are written in the implementation):

- Verdict, nothing new: "Quiet room. The kind I like heading into October."
- Verdict, a feud and a lost mentor: "Mostly good. One thing on the line to watch, and Jefferson needs a new voice."
- Mentor not taking: "Porter isn't hearing Lewis. Wrong voice for him. Roberts has the patience; I'd pair them."
- Mentor cut: "With Bynum gone, Jefferson's lost the guy bringing him along. We've put him with Simmons for now."
- Friend traded: "Arnold took the Vincent trade hard. They came in together. Give him a week."
- Grew up: "A year ago I'd have told you Carter was a project off the field. Not any more."

### Rules the lines follow

- Every sentence is chosen by a condition on what our staff can see, so a letter is reproducible (`CLAUDE.md`,
  prose rules). Personality and ceilings come from our read (`personalityRead`, `perceive`), never true values.
- No numbers for hidden traits; no game jargon (no "marbles", no "shift", no trait names as stats).
- No promise of something the engine doesn't do (a feud doesn't hurt play unless the engine says so; the coach
  doesn't claim it does).
- Never NFL nicknames, real people's names or their quotes.

## Data

`InboxMessage` gets one optional field for the new letters' tables, filed as they read that day (like `advice` and
`carousel`):

```ts
sections?: {
  title: string;
  /** Prose above the rows, if any. */
  lead?: string;
  rows: {
    playerId?: number;
    /** Cells in column order: plain text, already in the staff's words. */
    cells: string[];
    /** A one-sentence note under the row. */
    note?: string;
  }[];
  columns?: string[];
}[];
/** For the locker room report: the event ids it told, so the next one doesn't repeat them. */
covered?: string[];
```

`body` keeps the whole letter as text too, so search finds it. `League` stays plain JSON; `SAVE_VERSION` goes 64 →
65 with a no-op step in `migrate.ts` (the fields are optional; old messages are left as they are).

`mailSubject` learns the new ids (`locker:{season}:{checkin}`, `waivers:…`, `staffNotes:…`); the old ids it reads
today stay, so old saves' letters keep their cards and kinds.

## UI

- One component in `ui/mail.tsx` draws `sections`: a title, the lead, a table (`SortTh` headers when it has
  `columns`, names through `PlayerLink`, your rows plain since every row is ours), the row notes muted beneath. The
  same component serves all four letters. Narrow screens stack the cells under the name, as other mail tables do.
- The waiver letter's Claim button lives in the row, using the action the waiver screen already has.
- Nothing new on `Inbox.tsx` except dropping `positionMoved` from what folds.
- Screens follow `docs/UI.md`; the screen-contract tests in `ui/ui.test.ts` cover the new component.

## Files

| File | Change |
| --- | --- |
| `src/engine/lockerReport.ts` | new: the four check-ins, sections, verdict |
| `src/engine/waiverMail.ts` | new: the day's waiver letter, moved out of `inbox.ts` and extended |
| `src/engine/staffNotes.ts` | new: the weekly staff-notes letter |
| `src/engine/mailVoice.ts` | new: the line picker (conditions, specificity, stable tie-break, recent-line skip) and each head coach's motto |
| `src/engine/lockerMail.ts` | drop `took`, `grownUp`, `gone`, `captains`, `feudMail`, `friendGoneMail` from delivery (their conditions move to the report) |
| `src/engine/inbox.ts` | call the new letters; `positionMovedMail` becomes one letter; recap and matchup stop carrying coaching notes; `mailSubject`, `needsYou`, `FOLDED` |
| `src/engine/types.ts` | `sections`, `covered` on `InboxMessage` |
| `src/engine/generate.ts`, `migrate.ts` | `SAVE_VERSION` 65 and its step |
| `src/ui/mail.tsx` | the sections component, the Claim row |

## Testing

Mail never changes the sim, so no sims: `npm run typecheck` and the touched tests.

- **One letter, not many:** a day with six lost mentors files no mentor letter, and the next report lists all six;
  three waiver results on one day file one waiver letter; two position moves file one letter.
- **Check-ins:** each of the four files once a season at its moment; redelivering files nothing new; a pair told in
  one report isn't told in the next.
- **Empty sections hidden;** a quiet check-in still files with its verdict.
- **On the wire:** lists only thin positions and high ceilings on our read; never our own release; at most three;
  needs you only while a listed player is claimable; the Claim button makes the same claim the waiver screen does.
- **Staff notes:** recaps and opposition reports no longer contain the coaching sentences; the staff-notes letter
  carries `coachNoteKey`, and `coachDecisions` still finds what was told (its existing tests pass unchanged).
- **Voice:** the same league builds the same letter twice; the most specific line wins over a general one; no line
  repeats within a coach's last five letters when another fits.
- **Fog of war:** no hidden trait or true rating reaches a letter (the existing leak tests extended to the new
  letters).
- **Old saves:** a v64 save loads, its old letters still read and open their cards.

## Out of scope (later chunks)

- Who should be captain, and the Locker Room screen's table (chunk D).
- Staff faces and club colours on our own mail (chunk B).
- Contract letters you act on in place (chunk C).
- The director's upgrade advice (chunk E).
- SNN's speaking-out stories (chunk F).

## Sources for the voice

- Elan Ruskin, "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012:
  https://www.gdcvault.com/play/1015528/ · write-up: https://www.blog.radiator.debacle.us/2012/07/rule-databases-for-contextual-narrative.html
- Emily Short, "Visualizing Procgen Text" (salience, variety, distribution): https://emshort.blog/2016/06/13/visualizing-procgen-text/
- Belichick on "on to Cincinnati": https://www.nbcsportsboston.com/nfl/new-england-patriots/belichick-couldve-said-on-to-cincinnati-103-times/344227
- Tomlin's sayings: https://www.espn.com/nfl/story/_/id/30618415/wait-did-mike-tomlin-say-deciphering-steelers-coach-many-slogans ·
  https://www.nfl.com/news/mike-tomlin-s-simple-axiom-still-drives-pittsburgh-steelers-0ap3000000568273
- Handling practice fights internally: https://sportsnaut.com/nfl/kyle-long-booted-bears-practice-fighting ·
  https://www.espn.com/nfl/story/_/id/17764220/new-york-giants-offensive-tackle-ereck-flowers-apologizes-locker-room-incident
- How captains are chosen: https://en.wikipedia.org/wiki/NFL_team_captains ·
  https://www.packers.com/news/packers-elect-six-team-captains-for-2022-season
