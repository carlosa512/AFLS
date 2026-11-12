# News cycle

The inbox remains a manager's desk: personal letters carry management decisions, and occasional public
reporting explains the league. Delivery still happens after `store.mutate`; the simulation never sends mail.

## Editorial rules

- SNN — Sports News Network files one mail a week in season: the weekly edition (below). Its division story uses
  the same standings and tiebreakers as the standings screen and never turns provisional first place into a clinch.
- The Arena Gazette is the numbers desk (`gazette.ts`): SNN reports what happened, the Gazette explains it with the
  open measures in `analytics.ts`: EPA per play and per dropback (the stand-ins for DVOA and QBR, which are
  proprietary), success rate (40% of the distance on first down, 60% on second, all of it on third and fourth) and
  explosive plays (runs of 10+, completions of 20+). The match engine counts them as each play resolves
  (`TeamGameStats.adv`; `dropbacks`, `epa`, `successes`, `rushSnaps` on players) and they never move play. Expected
  points come from a fixed table fitted to the engine's own games, with fourth down valued as what follows it (a punt,
  a field-goal try or going for it, the best of the three: punts and kicks never pass the counting point); `npm run
  sim` prints the league's numbers against the NFL's as warnings.
- A column runs after weeks 4, 7, 10, 13 and 16, with a playoff preview and a season wrap: filed only at its moment
  (no backfill), with or without a job, never Needs you. Each has one story, chosen by the first condition that
  holds (a club leading a measure by a quarter of the spread to tenth; our club top or bottom three; the biggest
  offensive mover since the last column actually filed, ten places or more; a top-five offense with a bottom-five defense or the
  reverse; a turnaround from last season (.750 after six wins or fewer, .375 after ten or more); otherwise the
  league's state), a paragraph on the tables and a line locating our club, then two or three tables on rotating
  themes (top five, bottom three and our row; players top ten). Samples: every club needs three counted games; a
  passer 12 dropbacks, a rusher 6 carries and a pass rusher 15 rush snaps per team game. Tables are saved with the
  column. The turnaround replaced the Gazette's old trajectory stories.
- A division lead changing hands (the reader's division, from week 10) is a story of the edition, ranked just under
  a head coach out or a star traded. `divisionLeadChange` in `news.ts` decides it.
- Completed trades and public rumors are stories of the edition, by the rules that always decided them
  (`reportableTrades`, `reportableRumors` in `tradeNews.ts`): a modeled star deal, an early-round pick or a strong
  scouted player, with complete asset records. Rumors use recorded shopping or interest only, and completed moves and
  closed windows suppress stale ones. The user's own deals keep their personal confirmation instead.
- SNN tells the league's trade stories. The director of scouting doesn't retell them: four times a year he
  recommends two to four moves for us (`directorAdvice.ts`): three weeks before the deadline (week 6), in deadline
  week, when the league year opens (other clubs' players whose deals have run out, and a trade target) and on free
  agency's first day (the free agents our cap can carry). In season he leans from the playoff race: holding a seed or
  within a game, add; two or three games out, one in and one out; further, sell (players clubs asked about first,
  then veteran starters on expiring deals). Each pick is read through our scouts (knowledge 0.35 or more), comes from
  what is public (a club the market shows selling, a shopping rumor; never a private trade block), and carries one
  line on why, a ballpark ("likely a 4th", "asking about $6.2M a year") and a button that loads the trade table or
  opens free agency. With nothing worth it, the in-season mail says "we hold" and the offseason one isn't filed.
  The league office's only deadline notice is deadline day's.
- Other clubs' in-season coaching and front-office changes (a head coach, a GM or a coordinator out) are stories of
  the edition, one a club. Our own club's come from the owner. A save from before editions keeps the weekly roundups
  it filed, and nothing they told is told again.
- Other clubs' offseason front-office changes (GMs let go, retired, hired or extended, hot-seat reporting, interim
  head-coach calls) arrive as one SNN digest per offseason step: "Front-office carousel: 4 GMs out, 3 hired, 6 on
  the hot seat", a short lead and a grouped table (Out, Hired, Extended, Hot seat, Interim head coaches) saved with
  the mail. The id names the events it carried (`leadership-phase:season:phase:first-last`), so a later change starts
  a new digest and a save that filed single stories gets nothing twice. A lone change stays its own story. The
  coaching carousel is SNN's too; the league office keeps official notices about our club.
- The owner sends one letter per league year: his verdict when it isn't plain "back", the user's contract when it's
  up, then the budgets. Our own offseason warning, coach-change and extension events send no other mail. When the
  user's deal has run out and the owner keeps him, it is an offer, not a silent extension: two years, one on a
  warning. It is Needs you and blocks the staffing window; declining ends the job and opens the GM job market, with
  the guaranteed way back and never the old club.
- Outlets carry fixed badges in the inbox (SNN, GAZ, LO, OWN) rather than initials of their names.
- The scouting director revisits the user's actual drafted class after its eighth game and when its
  regular season is finished. A long advance to the end gets the season review, not a late midpoint report.
  Only work for the drafting club is counted, using box-score team IDs. Scrimmage snaps keep offensive
  linemen visible; kicking and punting have their own production. A short lead introduces a sortable table
  of every selection: pick, player, scrimmage snaps, production and role context. Generic snap averages are
  replaced by best-game highlights, spot-work notes or the teammate carrying the load. Notes can show a workload
  rise after a documented teammate injury, the teammate carrying the work, or an unusually strong/weak
  production rate relative to at least three qualifying rookies at the same position. No unrecorded preseason
  expectations or private depth-chart motives are invented. No old snap history is reconstructed.
- Opposition reports select at most two contests for the Key matchups card. Each names our unit first and theirs in
  full ("our offensive line against their pass rush"), says what our scouts grade and what "the stats this season"
  show (sack rates, yards per carry or passing efficiency, as places in the league), and draws one two-ended bar of
  who has had the better year. A stat never contradicts the scouts: a unit is "performing above expectations" or
  "below". The tag is Split when film and stats disagree by four places or more. At least three games and 30 relevant
  attempts are needed, and league places need every club to have a comparable sample. No semicolon and no colon inside
  a sentence. Faces identify unit leaders rather than promised one-on-one assignments.
- Opposition reports can explain an upcoming win that guarantees sole first by winning percentage in a
  late division matchup. Strong wins belong in the existing recap; its subject uses the opponent's record
  before that game. Injury reports point out a genuinely short position, and clearance subjects identify
  a full roster when it prevents a staff-managed return. Medical letters name the remaining available
  players, explain a shortage, identify supported cover/free-agent options, and explain IR when eligible.
  The availability card includes linked cover options marked with their natural position and "out of position".
  Old diagnosis cards explicitly distinguish the original report from the player's current health.

No hidden ratings, invented morale, rumors without simulation support, or claims of causation from
records alone. The existing categories, links and threading remain. Publications have no
private scouting knowledge and are never marked Needs you.

## SNN's weekly edition

Spec: `docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md`. One SNN mail after each completed
regular-season week and each playoff round (`editionMail` in `snnWeek.ts`, id `snn:{season}:w{week}`), laid out as a
front page (`ui/edition.tsx`). After a long advance only the latest week files. It is never Needs you, and a GM
between jobs still gets it, without a Your club slot.

**The page.** A strip of every score, the lead story, Your club, up to three tiles (four when your game leads), your
division's race (the next round's pairings in the playoffs) and next week's game of the week
(`season/gameOfWeek.ts`). Tiles start closed and open into the story in place.

**The editor** (`snnWeek.ts`) works like the head coach's letter: gather, rank, cut, word.

| Tier | What |
| --- | --- |
| 1 | A head coach or GM out at another club, a star traded |
| 2 | A division lead changing hands, an unbeaten club at 5–0 or better losing, a winless one at 0–5 or worse winning |
| 3 | An upset, a tie, a streak of six ending, a first-round pick traded, a star out for the season |
| 4 | A comeback, a win against the yardage, one player's day, a quarterback lost, another reportable trade, a coordinator relieved, a player speaking out, a coach losing his room |
| 5 | A rout, overtime, a plain result, a run reaching six, a rumor, a coach facing his mentor, your bye |

Inside a tier the clubs' records decide, then a stable hash. The cut: one story a club, one angle twice at most, one
trade tile unless a second is tier 1. Your game leads only at tier 3 or better; otherwise it is the Your club tile. A star
of yours lost for the season is told inside that story. The biggest other news about your club (first place taken, a
man speaking out, a run reaching six) has one tile by right, as a brief: one paragraph, its news alone, since the
standing and the next game are in your club's story. A coach or GM out at another club stays a candidate until it is
told, so one from a week you skipped, or one an edition had no room for, runs in the next (below the lead once it is
old news). Deadline day's deals ride in the week 9 edition, so
SNN files one mail at that step.

**Angles** (`snnStory.ts`, `CUT`): a game's angle is the first that fits, read from its box score and the standings
before it. Each cutoff was set from how often it happens in the NFL (nflverse 2021–25, `scripts/research-edition.py`)
and in our league: an upset is a winner .400 or more below the loser after week 5, a comeback a deficit of 10 or more
at the end of a quarter, the yardage a winner outgained by 100, a rout 28 points ahead after every quarter, a day
three touchdowns, 200 scrimmage yards, 400 passing yards, five passing touchdowns, three sacks or three interceptions.
Tune them there, from a season of editions.

**The writing rules** (`snnVoice.ts` writes, `storyRules.ts` checks, `refer.ts` names):

- One angle a story. Two paragraphs of prose: what happened and why, then what it means and what comes next.
- Sentences join facts. A man's full name first, then his surname.
- One callback at most, from the public record (the first meeting, an earlier sale, last week).
- It stops on a fact (a name, a number, a fixture). No sign-off and no line written to sound good.
- No semicolon, no colon inside a sentence, two numbers a sentence at most (the story's own final score aside).
- No sentence twice in a season (`seasonSaid`).
- One quote a story at most, plain, from the head coach of the story's club: a judgment on a fact, never a new event.
- Public facts only: box scores, standings, transactions, injuries, what a man said in public. No rating, mood or
  hidden trait.

`snnWeek.season.test.ts` plays a season and its playoffs and holds every edition to them, and checks the season plays
the same with mail filed or never filed. `npm run editions [-- seed] [--weeks n]` writes a season of editions to
`.check/editions.md` for reading, rule breaks at the top. `npm run screens -- --edition` shoots them.

**What it replaced.** In season SNN no longer files a separate division headline, trade story, deadline-day story,
weekly roundup of changes, rumor about a coach, player speaking out or coaching-tree meeting: each is a story of the
edition, told once (`covered` keeps its key and the id of the mail it replaces). **What still files alone:** a player speaking out and
coaching-tree stories out of season, the Arena Gazette's column, and everything from the people who work for you. The
three offseason digests (the front-office carousel, the coaching carousel, off the market) are now told by the
big-day editions below.

### The Column

Spec: `docs/superpowers/specs/2026-11-11-snn-column-and-storylines-design.md`. An edition may carry one labelled
opinion piece (`snnColumn.ts` finds the claims and picks one, `columnStory` in `snnVoice.ts` writes it): a claim about
a unit, a head coach or a GM, the table of public numbers it rests on, and an argument of two or three sentences. It
takes the place of the lowest tile that is not your club's.

**The evidence ladder.** A claim sits on a rung, and a rung needs its evidence.

| Rung | A unit | A head coach | A GM |
| --- | --- | --- | --- |
| 1 | In the league's bottom or top quarter over its last four games (`FORM` in `slump.ts`) | | |
| 2 "fair to ask" | | .300 or worse through six games | Two losing seasons finished and a third going the same way |
| 3 "it's time" | | The same after week 11 | Three losing seasons finished and a fourth going the same way |

Credit runs up the same ladder: a unit in the top quarter, a coach whose club won six or fewer and is at .750 through
eight games, a GM for a deep playoff run in a good season, for a club in its third winning season, or for a first-year
coach's turnaround (his hire). A first-year coach is never above rung 1 and an interim is never named. A claim that
stops being true is taken back once, in a Column of its own (`:fix`). A Column names a player only when the box
scores single him out (`unitMan`, `MAN`: the sacks one lineman gave up, a passer's turnovers).

**How often.** Never two weeks running (`LADDER.rest`). Blame and credit take turns. A man's job is the subject of one
Column in three at most (`LADDER.jobIn`), and a GM is asked about before his coach when both sit on a rung. Your club
gets three a season at most (`LADDER.yoursASeason`), and a club out of the race one unit Column. That comes to about
eight Columns a season. Over 18 played seasons 65% of the coaches SNN called "fair to ask" about were out by the next
kickoff, against 23% of the rest.

**Its writing rules** (`storyRules.ts`, on top of the edition's): a table of two to four rows, one number a sentence,
one short sentence a paragraph at most, an argument that follows from the table. What an edition printed is kept in
its `covered` keys (`column:{season}:{subject}:{rung}{+|-}`), so SNN never argues the same thing twice.

`npm run editions -- --seasons n` plays seasons and counts how often the Column and your club's coverage fire, by
rung, with what happened next to the men it named (`scripts/editionCounts.ts`). `FORM` and `LADDER` are set from those
counts.

### Your club's storylines in the edition

SNN reads the story store as a second outlet (`SNN_OUTLET` in `stories.ts`) and sees only your club's public beats: a
starter left off the lineup (a quarterback's benching ranks a tier higher), his return or the job changing hands, a
trade request once it has leaked and how it ended (traded, withdrawn, signed, released), and a coordinator you
relieved. Each is a tile about your club, told once (`storyline:{storyId}:{clock}:{beat}`), regular season only. An
ending nobody outside could read (a job settled by an injury, a holdout drifting back) is not a story.

### What coverage does

**An article causes nothing.** No mood, no rating and no draw moves because SNN printed something, and the sim never
reads mail (`simReadsNoMail.test.ts`, `snnWeek.season.test.ts`). Two things at your club read the same public facts
the Column read:

- **The note.** After a Column blames one of your units, the head coach's next letter may carry one line on how the
  unit's senior player has taken it (`coverageItem` in `coachWeek.ts`, `COVERAGE` in `coachWeekVoice.ts`), in words
  from his character. It asks nothing and never files a letter alone.
- **The conversation.** A quarterback or a leader who holds his job while his unit is in the bottom quarter may come
  to ask where he stands (`formCase` in `playerTalks.ts`, cause `form`): once a season, your club only, with two
  answers (back him, or tell him to play his way out of it). It never sours into a dispute. Under one a season.

Not yet: one thread a story with the head coach, the owner, players and agents.

### The playoffs and the final

In the playoffs a game story's headline says what the game decided: who goes on and to which round, who is out, and a
low seed that beat one of the top two. A player's day still leads its own story short of the final. The final's edition
(`snnTitle.ts`) tells the lead as a championship: the game as it was written, the game's most valuable player (SNN's
reading of the box score, with his playoff totals when the game story already gave his line), the champions' regular
season and who they beat to get there, and how many titles that makes when the record holds an earlier one. A tile
tells the league's most valuable player and the other awards, and two lists stand where the race sits in season: the
season's awards and the champions' road.

**Only fresh news.** A storyline about your team (a benching, a return, a trade request that leaked) is told the week
it happens or the week after (`STORY_FRESH`). One that no edition had room for is not told late.

## SNN on the big days

Spec: `docs/superpowers/specs/2026-11-12-snn-big-days-design.md`. Five special editions a league year, on the weekly
edition's page (a lead, Your team, up to three tiles, a list where the division race sits in season). `snnDays.ts` is
the editor, `snnDayVoice.ts` the words, `publicStanding.ts` who counts as a name. Mail-side only, public record only,
no draws, and the sim never reads it (`snnDays.season.test.ts` plays an offseason with the mail filed and never filed).

| Edition | Files when | Tells | List |
| --- | --- | --- | --- |
| The new league year | free agency opens | changes at the top, tags, a star released, kept or reaching the market, who starts the year under pressure, a star traded | Changes at the top |
| Free agency | the draft opens | the richest deal, stars who moved, the team that signed or lost the most starters, a star still unsigned, a star traded | The biggest contracts |
| Draft day | camp opens | the first pick, trades up, the first quarterback, the furthest fall, the widest reach, the biggest haul | Round one |
| Cut-down day | the cuts are in | a star, a veteran starter or a high pick released, a starter still holding out, a star who changed position, the undrafted who made a roster | Notable cuts |
| Kickoff | week 1, before a game | the champion's opener, a rookie or a new quarterback, a new head coach's first game, the team with the most new starters, a first game against a mentor | Opening week |

- **One mail a step.** An edition is named for the moment that just ended and files once (`snn:{season}:d:{day}`). A
  simmed offseason files Kickoff alone, with cut-down day's stories on its page. A league that has not played a
  season files none.
- **Public standing.** A star is last season's award winner, an All-League pick, a top-five finisher in a counted
  stat, or the quarterback of a winning team. A starter played `STANDING.snaps`. Nothing reads your scouts.
- **The most worthwhile story first.** Candidates rank by tier, then by public worth (`stakes`), then a stable hash.
  One story a team on a page. Your team has its own slot, composed whole (`yourDayStory`), and is never a tile.
- **Both ends of a change.** A new head coach's story says where he comes from (his last team's record, when it won)
  and what he takes over (a playoff team, or a run of losing seasons). The page keeps one tile for who starts the
  year needing results: a head coach kept after `DAY.seatRun` losing seasons with his team, or a GM the owners'
  review put on notice, told as reporting ("league sources say"). No story says "hot seat" or predicts anything.
- **Trades.** Only a trade with a star in it is a story, with what went back. A move up on draft day is told inside
  the top ten, or anywhere in round one at a heavy price (a future first-round pick, or three picks). The price is
  the headline once a day.
- **Kept a tile, never the lead:** a head coach's first game against the coach he worked under.
- **The bars** live in `DAY` (`snnDays.ts`) and `STANDING` (`publicStanding.ts`), set from counts
  (`npm run editions -- --offseasons n`). `npm run editions -- --days` writes a played offseason's five editions to
  `.check/day-editions.md` for reading the words.

## The head coach's weekly letter and the story store

The head coach writes to you once a step or not at all (`coachWeek.ts`, id `coach:{season}:{clock}`). It replaced the
separate letters for a player's ask, the meeting request, a meeting's result and the staff notes; those ids still
parse, answer and render in an old save, and nothing new files under them. One letter holds up to five sections,
each a list of people with a face, their words and their own buttons: "Since last week" (a story closing, last
step's meeting told one step on, a promise's or deal's clock), "Who came to see me" (the asks, and an ask still
waiting on you), "The rooms" (the position coaches' turns, chemistry and warnings), "What I want to do" (his meeting
request and its choices) and "From the staff room" (his word with the players, a depth-chart call, habit work).

What goes in is ranked in five tiers. Asks and the request are always told; a meeting's result is told too, riding in the next letter filed for another
reason and filing one alone only when it owes something or has waited two steps (`RESULT_WAIT`); a story closing the
same way (it needs no answer, so it rides, and files alone only after two steps); a clock coming due is told too; a room or the staff room only while fresh (`STALE` steps) and only as many as fit under `MAX_ROWS`
rows a letter. Notes alone never file a letter: they ride along with something to answer, a clock, or a result or closing that has waited.
The losing is the club's: one story, one row, with the man asking who counts most quoted and the others named in a
sentence, and one answer for them all; a man who asks about it again inside `LOSING_GAP` steps (four, for the whole club)
is answered as you answered it. A meeting makes no story of its own: it only adds beats to a room already open because it
turned, and the letters tell meetings from the meetings log. A room has one story a league year: when it turns again
after recovering, the same story re-opens and only the new beats are told.
A benched job-holder's question (`benching.ts`) is told in the same letter: his ask in "Who came to see me" the step he
sits (his words by what he knows: who started, what you told him before; the other man asks about the job rather than
a benching), a note a week while it waits ("still waiting on you", a tier-4 note that rides along and never files a
letter), how he took your answer in "Since last week", and one closing row when it ends (your word, three straight
starts, the question settled by an injury or a trade), told like a meeting's result. A cleared starter left off the
lineup is a row of its own, with "Put him back". The benching's lines are in `benchVoice.ts` and obey the same rule:
no sentence twice in a league year, a before-line left out when it has nothing new.
The coach writes at most every other step (`LETTER_GAP`): the step after a letter files none, and what it gathered waits for the next with its own clock, so nothing is lost (your club's ask is ignored after three steps, and a meeting request waits a step longer). A story has one telling a league year per subject: a deal that went quiet (eight steps with nothing pending) closes without a closing row, and re-opens with its history if he raises it again, so the coach can say it is the second time; staff stories close with the season.
A room is told about once in three steps (`NOTE_GAP`): a turn, its chemistry and its coach's belief count together,
and what waits is told when the gap has passed.

**It reads as a letter** (`MailSection.layout: 'letter'`, `LetterSection` in `ui/mail.tsx`): what needs your answer
first, each person introduced in a sentence ("came to see me about his contract"), his words, your answers under
them, then "The rest needs nothing from you." and the notes, signed with the coach's first name. It opens on a fact of
the week (a streak, the deadline, the bye, camp, the season's end, a meeting held, a room and the player feeding it)
when it has one it has not said this year, and otherwise on its first item: no line only announces the letter. The
subject is the top item in a few words and a count of the rest ("Tucker's job, and 2 more"). The coach says players,
never "men". Nothing in it is labelled: a row's kind ("What I told them", "Where that leaves us", "The clock") is
the editor's, kept in the row for the cut and the tests and never drawn. A person's paragraph opens on his face and
name; a matter with no one person (a meeting's result, the lineup, a room) is a paragraph whose sentence names what it
is about ("I told the quarterbacks, …"). A leader's words at a meeting are the coach's report, so only the coach's
own are quoted.

Every sentence is chosen by a condition on the cast sheet (`castSheet.ts`: one man, the coach writing, the moment), by
the rule in `voice.ts`: the most specific line that fits, and none the sender has said this league year. A sentence of
a player's quote counts, a two-sentence line is said when either half was, an optional part (his history, a colour
line, a closing, the coach's read) is left out when it has nothing new to say, and a letter series is one voice
whoever signs it. `coachWeek.season.test.ts` plays a season as a GM who answers everything and holds the letters
to it.

The letters read from a story store (`stories.ts`, `League.stories`), not from the sim. A story is one subject of your
club (a man's deal, snaps, benching or losing, a feud, a room, a coach) with its beats in order; `storiesStep.ts` writes
the beats that are read rather than done, after every morale step. Nothing in the sim reads the store and writing a
beat draws nothing, so play is the same with it on or off. Each story keeps how many beats each outlet has told, and
an outlet is a reader with a rule for what it may see (`Outlet.sees`): the coach sees your own club's beats. A beat
marked public (a starter benched, a request leaked, a coordinator relieved) is what an SNN story or a season arc
could read later, as another outlet over the same store, without telling a beat twice. That is the seam the "full
news and media outlets" item in `docs/MVP.md` builds on; no public outlet reads it yet.

## Words in a letter

Every letter in the inbox is written to these, whoever signs it. `letterRules.ts` checks what a rule can check
(`letterRules.test.ts` reads every line in the files that word letters, `LETTER_FILES`), and `npm run letters` lists
every line for reading, breaks first.

1. **Plain, complete sentences.** No fragment standing as a sentence ("Good room.", "Pads on.", "Not trouble yet.").
2. **A letter starts with its news.** No line announces the letter or the writer's view of it ("Here is where things
   stand", "as I see it"). When there is nothing to open on, the letter opens on its first item.
3. **Players are players.** A name, a position, "the players", "the team", "veterans", "the younger players". Never
   "men", "a man", "the guys", "the kids", "the vets". The team is "the team", never "the building". A position group
   may be called a room ("the receivers' room"): it is football's word and the Locker Room screen's.
4. **Say the thing itself.** No figure of speech where a plain word does the job ("closed the book on it" is "it is
   closed", "what is eating him" is "what is bothering him", "in a good place" is "happy").
5. **Stop on a fact.** No moral and no line written to sound good ("It usually does.", "That's a football team.").
6. **No semicolon, and no colon or dash inside a sentence.**
7. **A sender is known by what they notice**, not by slang: the head coach by the people, the director by value and
   by a hedge where the scouts are unsure, the doctor by time and risk, an agent by his client's case.
8. **A person speaking is plain too.** A player, an agent or another club's GM may answer in two words and put a thing
   his own way (`quotes` in `LETTER_FILES`), and he still never says "men" or "the building".

9. **American football English.** A team, never a club. A game, never a fixture or a match. A loss, never a defeat.
   "At home against" and "on the road against", never "at home to" or "away to". American spelling (color, honors,
   defense). This one holds for every word a reader sees: letters, SNN, the version history and every screen
   (`WORD_FILES` and the screens' own text, in the same test).
10. **A letter never names a screen of the game.** The writer tells you what he knows, as his own read ("These are
    the players I worry about", "I count nine players who are down"). The letter's buttons take you where the rest
    is. `letterRules.ts` flags a screen by name.

SNN's stories follow these and their own rules on top (above).

## Attention and history

`needsYou` means a present management task. Opponent briefings, ordinary injury notices and deadline
reminders do not qualify merely because they are current. `briefingCurrent` separately controls whether
matchup and deadline cards still show live information. Shortages, eligible IR activations, offers, draft
picks, scouting opportunities and existing contract/staff decisions keep their live checks.

**A letter is filed under the week it is read in.** A recap, the injuries from a game and SNN's edition are about
week 16, and they arrive once the desk has moved on to week 17's build-up, so the inbox files them under Week 17
with that week's opposition report (`InboxMessage.filed`, read through `mailDate`; `week` stays the week the letter
is about, which ids and the mail's own logic use). After a long advance each week's mail is filed the week after its
own, never all under today. The last regular-season week's is filed as the playoffs open and the final's under the
finished season. Mail filed before save format 94 keeps the week it was dated.

The inbox still retains 300 entries, counting archived and deleted messages. Save format 36 adds the
optional `mailFloor`: an eviction date plus IDs removed on that date. Dates before the boundary cannot
return; unseen IDs on the same date can arrive. Only the boundary date's tombstones are retained, so the
ledger does not grow across seasons. A very busy single date can require more than 300 tombstones.

Save format 37 adds an optional rookie-report table snapshot to new letters. Rows retain their public
production and assessments when later games are played, players move, or box scores are pruned. Existing
narrative-only letters remain as originally filed; they are not silently regenerated.

Save format 38 adds optional SNN division and team-stat snapshots. Missing old statistics show a dash;
new games cannot rewrite a filed table.

Save format 39 adds optional trade-news snapshots so later pick pruning cannot change the reported price.

Save format 40 saves the optional supporting-table choice and trade-edition labels.

An older full inbox has already lost the identities of discarded entries. Its first delivery preserves
that date's conservative suppression, then records subsequent evictions precisely. This cannot recover
news already suppressed in the old save; it avoids resurrecting old deleted mail during upgrade.

## Review and validation

`src/engine/news.test.ts` covers public evidence, thresholds, ties, missing histories, incomplete weeks,
checkpoint delivery, traded rookies, snaps, long advances and save migration. The inbox tests cover
same-date arrivals after rollover, deleted-mail suppression and JSON reload. UI tests verify live
briefing cards independently of the attention badge.

Review an ordinary week, a busy medical week, the trade deadline, a division lead change, a rookie
checkpoint and a simulated finish. Check whether each subject is useful without opening it, its links
substantiate the story, and a second delivery produces no extra mail. A standalone feed, protected
unread retention, persistent narrative arcs and additional outlets remain outside this release.
