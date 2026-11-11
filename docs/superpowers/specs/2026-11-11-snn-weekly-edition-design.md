# SNN's weekly edition: one newsletter a week, with stories that read as written

Date: 2026-11-11 · Branch: `claude/loving-cerf-wkwav9` · Spec 1 of 3 from the owner's news and mail brainstorm
(Nov 11, 2026)

## Why

The sim tracks a whole league and SNN tells almost none of it. In a test league played to week 10, the inbox held 29
letters from the doctor, 28 from the head coach and five from SNN. All five were trades, and four of the five used
one skeleton:

> The New England Admirals have acquired offensive lineman Alexander Sanders from the New Orleans Krewe, with draft
> capital heading the other way. A 2027 second-round pick is part of the return to the Krewe. The Admirals are 5–3,
> with the trade deadline coming after Week 9. The Krewe, 2–6, are selling.

Each sentence holds one fact and nothing joins them. "Draft capital heading the other way" says nothing, and the next
sentence says it properly. The story stops without ending. Meanwhile that week a 32-year-old back scored three times
against a 7–1 club, a winless club fell to 0–8, and an unbeaten club lost for the second time in three weeks. None of
it reached the desk. An SNN story, the owner's letter and a coach's note also share one layout: a subject, a short
body, a table.

The goal is one SNN mail a week that is worth reading: the league's season and your club's place in it, laid out
like a publication and written like a beat writer who has followed the season.

### What we took from elsewhere

- **Football Manager 26** splits messages (people who work for you, may carry a task) from news (the world, never a
  task) and builds a news item like an article: a headline, the subject's picture and three numbers, three short
  paragraphs. Reviews of earlier versions say its reactions and press answers "begin to repeat very, very swiftly"
  and that its media calls a job in jeopardy after one loss.
- **Valve's rule database** (the most specific matching line wins, with fallbacks) is what `voice.ts` already does.
- **Emily Short** on procedural text: a sentence should reflect several facts of the world, and variation that is not
  tied to state reads as random.
- **Kate Compton's "10,000 bowls of oatmeal"**: most output should be background and a few pieces memorable, and
  text that shows why something is so makes a world feel alive.
- **Story sifting** (Kreminski): find the patterns in what already happened and tell those.

Sources are listed at the end.

## Decisions (agreed in the brainstorm)

1. **News stays in the inbox.** No News tab.
2. **News is read, then acted on elsewhere.** A publication never asks for an answer and is never Needs you. Every
   story links to the man, the club or the screen where you would act.
3. **One edition a week in season**, regular season and playoffs. It replaces SNN's separate in-season mails.
4. **The edition is a front page**: a scores strip, a lead story, tiles, the race and the game of the week. A tile
   opens its story in place.
5. **Pictures are the game's own drawings.** No bylines and no journalists: the outlet signs.
6. **Stories are in a beat writer's voice**: plain, and they say what the facts mean. Opinion (the column) is spec 2.
7. **The writing rules in section 3** hold for every story, and tests enforce the ones a test can.
8. **Quotes are plain and rare**: at most one a story, from the head coach of the club it is about, a judgment on a
   fact in the story, never a new event.
9. **The sim never reads mail.** An article causes nothing. Where coverage and a reaction go together (spec 2), the
   play causes both.
10. **Two small fixes ride along**: the Gazette's table headings and the opposition report's Key matchups card.
11. **All three specs are built on the session's branch, one after the other**, with one pull request at the end
    when the owner asks for it.

## 1. The edition

### When, and what it is

| | |
| --- | --- |
| Filed | After every completed regular-season week and every playoff round, at its moment only |
| Id | `snn:{season}:w{week}`; a playoff round's is `snn:{season}:p{round}` |
| From | `SNN — Sports News Network`, category `league`, badge SNN |
| Subject | `Week 9 · {lead headline, shortened} · {your club's headline, shortened}` |
| Needs you | Never |

A long advance files the latest completed week's edition only, as SNN does today (no backfill). A GM between jobs
still gets the edition, without the Your club slot. Delivering twice files nothing.

### What it holds

| Slot | Content |
| --- | --- |
| Scores strip | Every final of the week, yours marked |
| Lead story | The week's top-ranked story |
| Your club | Always there while you run a club: your game's angle and the biggest public thing that happened to you. On a bye, where you stand and who is next |
| Tiles | Up to three more stories |
| Column | Empty in this spec. The grid keeps its place for spec 2 |
| The race | Your division's table with last result and next opponent |
| Game of the week | Next week's best matchup, the pick Home already shows |

In the playoffs the last two slots are the bracket: the round's results and the next round's games.

When your own game is the week's top story it takes the lead slot, marked Your club, and the tiles get a fourth
story.

### What it replaces

| Today | After |
| --- | --- |
| The weekly public headline (`press:{season}:{week}:division:…`, `…:trade:…`, `…:rumor:…` from `leagueNews`) | A candidate story in that week's edition |
| Other clubs' in-season coaching and front-office roundups (`leadership-week:…`) | A candidate story in that week's edition |
| The deadline-day trade edition | Stays its own mail (deadline day is its own moment on the calendar), drawn with the story block |
| Offseason SNN digests (front-office carousel, coaching carousel), the Gazette, league-office notices, the owner | Unchanged |

Old ids still parse, open and render in an old save, and nothing new files under them. The selection rules in
`docs/NEWS.md` for division stories, trades and rumors (public evidence only, no provisional clinch, the user's own
deals excluded from trade news, completed deals suppress rumors) decide which of them are candidates, exactly as they
decide today which is filed.

## 2. The editor

`src/engine/snnWeek.ts` has the shape of the head coach's weekly letter (`coachWeek.ts`): gather, rank, cut, word.

**Gather.** One candidate for each game of the week (its angle, section 3), each division lead change, each trade and
rumor the current rules would report, each star lost for the season, each coach or GM out at another club, and each
club's run.

**Rank.** Five tiers, the top one first:

| Tier | Candidates |
| --- | --- |
| 1 | A head coach or GM out. A star traded (a deal today's trade-news rule calls a star deal) |
| 2 | A run ends (an unbeaten club loses, a winless club wins, a streak of five or more ends). A division lead changes hands in week 10 or later |
| 3 | An upset. A star out for the season |
| 4 | One player's big day. A comeback. A result against the yardage. A quarterback lost mid-game |
| 5 | A blowout. Overtime or a tie. A run that continues. Another trade. A rumor. Any other game |

Inside a tier the higher stakes win (the two clubs' combined record, a division game ahead of one that is not), then a
stable hash of the edition's id. No randomness from the sim's streams.

**Cut.** The lead is the top candidate. The tiles are the next three with at most one story a club across the whole
edition and at most one trade tile unless it is tier 1. A story's club is the one its angle is about: the club
whose run ended, the winner of an upset, the club of the man who had the day, the seller or the buyer of a trade. A thin week runs fewer tiles. What is cut is dropped, not
listed: fewer, better stories.

**Word.** Each story is written by `snnVoice.ts` through `say` in `voice.ts`, around everything SNN has said this
league year.

**Memory.** The editor keeps no state of its own and the sim keeps none for it. A callback is computed from the
league's public record. What SNN has already told is in the mail's `covered` keys and `League.mailTold`, the ledger
digests already use, so a run is told once (`run:{teamId}:{season}:{startWeek}`) and a trade carried by an edition is
not carried again.

## 3. Stories

### The shape

An `EditionStory` is saved with the mail as it read when filed:

| Field | |
| --- | --- |
| `kind`, `angle` | What it is and the one thing it says |
| `kicker`, `headline` | "Lead story · Frontier", "Reed, 32, scores three as the Voyageurs run over Seattle" |
| `summary` | The tile's one or two sentences |
| `picture` | The man it is about, or the two clubs' chips |
| `numbers` | Up to three, each a value and a label |
| `paragraphs` | Two to four |
| `quote` | Optional: who, his role, his words |
| `links` | The box score, a player card, a club, the standings |
| `yours` | It is about your club |

### A game's angle

Every game gets exactly one, the first that fits:

| Angle | When |
| --- | --- |
| A run ends | The loser was 5–0 or better, or the winner was 0–5 or worse, or a winning or losing streak of five or more ended |
| An upset | After week 4, the winner's winning percentage before the game was at least .350 below the loser's |
| A comeback | The winner trailed by ten or more at halftime |
| Against the yardage | The winner was outgained by 100 yards or more, or the loser outgained the winner by 100 or more with three or more turnovers |
| One player's day | Three touchdowns, 150 scrimmage yards, 400 passing yards or four passing touchdowns, three sacks, or two interceptions |
| A quarterback lost | The starter left hurt and his backup had ten or more dropbacks |
| A blowout | A margin of 21 or more by a club ahead at the end of every quarter |
| Overtime or a tie | |
| The result | Otherwise: the score and the two numbers that decided it (`gameStory.ts`'s reading, in the third person) |

A game that fits several keeps the facts of the others as support: the lead in the reference picture is "one
player's day" and uses the lost quarterback as its why. `src/engine/snnStory.ts` holds the angles as pure functions
of a result and the standings before it.

### The other kinds

| Kind | Angle | From |
| --- | --- | --- |
| Division lead | The result that changed it, the streak behind it, the next fixture | `divisionArticle`'s facts |
| Trade | A seller's second sale of the season. A club at .600 or better adding. A swap. A rental | `league.market.history`, `keyTradeNews`'s selection |
| Star out | Who, how long, what he had done | The game's public injuries and the doctor's public estimate |
| Coach or GM out | Who, the record he leaves, who steps in | `leadership.events` (another club's; ours stay with the owner) |
| A run | Won or lost five straight, or started 5–0 or better and has lost two of its last three | Results |

A star is judged from public production only: a weekly award this season, a top-five place in the league in a major
stat, or a club's starting quarterback. Trade stories keep today's rule for the headline player.

### How a story is built

A story does four jobs in order: **what happened, why, what it means, what is next.** The angle decides which facts
fill them, so two trade stories do not share a skeleton. Facts that do not serve the angle stay in the numbers, the
table or the box score.

The reference lead, from a real week of the test league:

> Jamison Reed, 32 and in his eleventh season, ran for two touchdowns and caught a third as the Voyageurs beat the
> 7–1 Squall 35–14.
>
> Seattle lost quarterback Jordan Patterson to a concussion in the second quarter. Rookie Cameron Cox threw for 110
> yards in relief, the Squall gave the ball away three times, and Minnesota closed with 21 points in the fourth.
>
> In Week 4 the Gazette had Minnesota third on offense and 31st on defense. This time the defense had three sacks and
> three takeaways. The Voyageurs are 5–4 and half a game behind Green Bay, who lost by 31 in Las Vegas.
>
> Minnesota go to San Francisco next. Seattle, still a game clear in the Frontier West, host Green Bay.

And the trade from the top of this document, with only facts the league holds:

> The Krewe are 2–6 and selling. Alexander Sanders, 31, who started every game on their offensive line, went to the
> Admirals for a 2027 second-round pick.
>
> He is the second starter out the door. Edge rusher Patrick Myers left for Minnesota in Week 3, and that deal brought
> back a first.
>
> New England, 5–3 and third in the Liberty East, get a tenth-year lineman for the run-in. The window shuts after
> Week 10.

### The writing rules

| Rule | Held by |
| --- | --- |
| One angle a story | The story's shape: one `angle` |
| Sentences join facts ("because", "but", "and") instead of listing them | Review in `npm run editions` |
| A person's first mention is his full name, then his surname, then "he" or a role ("the rookie"). A club is "the Voyageurs", then "Minnesota" or "they" | `refer.ts`, and the season test |
| At most one callback a story, from the public record | The story's builder |
| No sentence without a fact or a judgment. No filler ("with draft capital heading the other way") | Review |
| **A story stops on a fact.** No sign-off, no short punchy closer, no aphorism. The last sentence carries a name, a number or a fixture | The season test |
| No semicolons, and no colon in the middle of a sentence | The season test |
| At most two numbers in a sentence. The rest go in the three number chips | The season test |
| No sentence twice in a league year | `say` with `around`, as the letters do |
| Words match the stakes: a verb for a margin is chosen by the margin | The line's condition |
| No job talk in this spec. A coach who is out is reported, nothing more | No such lines in the bank |

The callbacks a story may use: a club's record some weeks ago, an earlier meeting this season, an earlier trade by
the same club this season, a weekly award in the last four weeks, a top-three or bottom-three league rank in a stat,
and a Gazette column's finding.

### Quotes

At most one a story, and only in an opened story, never a tile. The speaker is the head coach of the club the story
is about. His line is chosen like any other: by a condition on a fact that is in the story, so it can only be a
judgment on that fact. "He's 32 and he was our best player in the fourth quarter." fits a back with three
touchdowns in a game his club closed with 21 points in the fourth. A line that needs an event the sim did not make
("he asked for the ball") cannot be written. A coach's motto (`mottoOf`) may appear once a season. Player quotes
wait for spec 2.

## 4. On screen

Reference pictures, at the inbox reading pane's real width (about 660px on a desktop):

- `2026-11-11-snn-weekly-edition-closed.png`: the edition as it opens
- `2026-11-11-snn-weekly-edition-open.png`: the lead story opened in place

Behaviour:

- **Tiles start closed**, so the week fits one screen. A tap opens the story in place at full width: a band in the
  club's colours with the score and the man's picture, the headline, the number chips, the paragraphs, the quote, the
  buttons, and Close. One story is open at a time. Nothing about it is saved.
- **On a phone** the tiles stack in one column and the scores strip scrolls sideways.
- **The inbox row** is one row from SNN with the League tag.
- **Pictures**: `PlayerAvatar` with the game, so he wears what he wore that day. `StaffAvatar` for a coach. `TeamChip`
  for clubs.
- **Names** go through `PlayerLink` and `TeamLink`, found in a paragraph the way the inbox already finds them
  (`nameAt.ts`). No rating, star or overall appears anywhere in an edition.
- **Both themes** through the existing colour tokens.

The edition's components live in a new `src/ui/edition.tsx` (`EditionCards`, `StoryBlock`, `ScoreStrip`, `RaceTable`)
and `MailCards` in `mail.tsx` hands a message with an `edition` to them. `mail.tsx` is already 3,500 lines and takes
nothing more than that hand-off. The deadline-day mail's trades are written by the same trade-story builder and drawn with `StoryBlock`.

The game-of-the-week pick moves from `ui/strip.tsx` into the engine (`season/`), and the strip reads it there, so the
edition and Home cannot disagree.

Screen text follows `docs/UI.md`'s "Words on a screen": no paragraph that describes the panel or explains a control.

## 5. Saves

`InboxMessage` gains an optional `edition`: the week's label, the scores, the stories, the race rows and the game of
the week, all as filed, so a later game, a trade or a pruned box score cannot rewrite a delivered edition. It is plain
JSON. `SAVE_VERSION` goes from 93 to 94 with an upgrade step that changes nothing in an old save. The inbox's cap of
300 is untouched: an edition is one entry a week, where a week could file a headline and a roundup.

## 6. The two small fixes

### The Gazette's table headings

`.gazette-table h4` is set in Georgia, the only serif in the interface, and reads as a wrong font. It takes the
display font every other card heading uses (`.mail-card h4`). One rule in `src/styles.css`, and its comment.

### Key matchups in the opposition report

Reference picture: `2026-11-11-key-matchups-card.png`.

Today the tag ("Edge: us") comes from our scouts' grades and the bars come from the season's stats, with nothing
saying which is which, so a green "Edge: us" can sit over a long green bar for them. "Line" and "front" do not say
which side of the ball they mean.

| | Today | After |
| --- | --- | --- |
| Units | "line", "front", "linebackers", "secondary" | "offensive line" and "pass rush", "run game" and "run defense", "passing game" and "coverage" |
| Heading | "Their line vs our front" | Ours first, always: "Our pass rush vs their offensive line" |
| Tag | From the film, else the stats | "Edge: us", "Edge: them" or "Even" from the film. **"Split"** when the stats point the other way by four places or more |
| Words | "Our line should win this one against their front. The numbers so far say otherwise." | Two or three plain sentences: what our scouts grade, then what the stats this season show |
| Bars | Two rows, each coloured by its own league rank | One two-ended bar a matchup: ours grows left, theirs grows right, the longer side has had the better season. Green when the stats favour us, red when they favour them, grey inside four places |
| Captions | "sacks allowed 5.1% of dropbacks" | "allows a sack on 5.1% of dropbacks", "gets a sack on 10.5% of dropbacks" |

The words never make our scouts wrong. Scouts grade the players and the stats measure what they have done, so the
stats are always "the stats this season" and a unit performs above or below expectations:

| Case | Line |
| --- | --- |
| Scouts favour us, their unit ranks in the top third | "Our scouts grade our offensive line ahead of their pass rush. Their rush is performing above expectations this season. It gets a sack on 10.5% of dropbacks, 2nd in the league, and our line is 15th at preventing them." |
| Scouts favour us, the stats agree | "Our scouts grade our pass rush ahead of their offensive line, and the stats this season agree. We are 4th at getting sacks and their line is 25th at preventing them." |
| Scouts favour us, our unit ranks in the bottom third | "Our scouts grade our pass rush well ahead of their offensive line. Our rush is performing below expectations this season at 29th in sacks. Their line is 27th at preventing them." |
| Scouts favour them, their unit ranks in the bottom third | "Our scouts grade their pass rush ahead of our offensive line. Their rush is performing below expectations this season at 24th in sacks. Our line is 6th at preventing them." |

The mirrors (scouts favour them and the stats agree, scouts favour them and our unit is above expectations, even on
film) follow the same pattern. Each case has two or three wordings so a report does not repeat week to week, and the
lines obey the writing rules above. The change is in `focusMatchups` (`src/engine/opposition.ts`) and `MatchupsCard`
(`src/ui/mail.tsx`). Which matchups the report picks does not change.

## 7. Testing

- **Angles** (`snnStory.test.ts`): each angle from a built result, the order when several fit, and the fallback.
- **The editor** (`snnWeek.test.ts`): ranks and ties, the cut (one story a club, the trade limit, a thin week), your
  game as the lead, a bye, a GM between jobs, a long advance, a second delivery.
- **A season** (`snnWeek.season.test.ts`, after `coachWeek.season.test.ts`): plays a season and holds every edition
  to the rules: one a completed week, no sentence twice, every story's last sentence carries a name, a number or a
  fixture, no semicolon and no mid-sentence colon, a first mention is a full name, at most one quote and it is in an
  opened story, two to four paragraphs.
- **News rules** (`news.test.ts`): the division, trade and rumor rules still decide what an edition may carry.
- **The sim reads no mail** (`simReadsNoMail.test.ts`): unchanged. The editor is mail-side and no sim module imports
  it.
- **Saves**: an old save upgrades, its old SNN mail renders, and a filed edition survives a reload unchanged.
- **Screens** (`ui.test.ts`, `mail.test.tsx`): the screen contract for the edition, a tile opening and closing, the
  phone layout, the matchup card's four cases and its tag.
- **A reading tool**: `npm run editions [-- seed]` plays a season and writes every edition to `.check/editions.md`,
  with any rule a story breaks listed at the top. A preview, not a check, like `npm run gm-letters`. This is where
  the wording gets workshopped with the owner.

Nothing here can move play, so no sims: `npm run typecheck`, the tests touched, then CI on the pull request.

## 8. Build order

1. The Gazette's headings.
2. The Key matchups card.
3. Game angles and their tests (`snnStory.ts`).
4. `refer.ts`, the line banks (`snnVoice.ts`) and the writing-rule checks.
5. The editor (`snnWeek.ts`), the saved shape, the upgrade step, and the old mails folding in.
6. The screen (`ui/edition.tsx`), the inbox hand-off, the phone layout, the game-of-the-week pick in the engine.
7. The season test, `npm run editions`, a read-through with the owner, then `docs/NEWS.md`, `CLAUDE.md`, the line in
   `docs/MVP.md` and the version in `package.json`.

## Not in this pass

**Spec 2, opinion and your club** (its rules were agreed in the brainstorm and are recorded here so they are not
lost):

- At most one labelled Column an edition, in a columnist's voice. A column is a claim and its evidence.
- The press follows the sim's own clock. An owner's heat comes from losing seasons (`ownerBag.ts`). In season he acts
  only after week 11 on a club at .300 or worse through six or more games, and never on a GM in his first two years
  (`leadershipWeek`). So the column may say:

  | The column says | About a head coach | About a GM |
  | --- | --- | --- |
  | "This unit is a problem" | Four games of it | Any time, about one move (a trade, a draft class) |
  | "It's fair to ask about him" | Six or more games at .300 or worse | Two losing seasons under him |
  | "It's time" | Only where the owner could act: after week 11, or a second straight losing season | Three losing seasons |

- One rung at a time: "it's time" only follows an earlier "fair to ask" about the same man. No column when nothing
  earns one. A column that turns out wrong says so.
- When the column goes after your head coach, the decision is yours.
- Your club's public storylines from the story store (a starter benched, a request leaked, a coordinator relieved).
- A player who comes to see you when the coverage has been on him. His play causes the story and the visit.
- Player quotes, season arcs, previews and wraps, GM columns across seasons.

**Spec 3, chains**: one thread a story with the head coach, the owner and players.

**Later or never**: journalists and bylines, a News tab, answering the press, offseason editions, a redesign of the
Gazette.

## Sources

- [FM26's Reimagined User Interface](https://www.footballmanager.com/features/total-football-total-control-fm26s-reimagined-user-interface) (Sports Interactive)
- [FM26 reimagined UI](https://www.fmscout.com/a-fm26-reimagined-ui.html) (FM Scout, with screenshots of the Portal and a news item)
- [Football Manager 2017 review](https://www.pcgamer.com/au/football-manager-2017-review) (PC Gamer, on the social feed repeating)
- [Beyond Branching: quality-based and salience-based narrative structures](https://emshort.blog/2016/04/12/beyond-branching-quality-based-and-salience-based-narrative-structures/) (Emily Short)
- [Visualizing Procgen Text](https://emshort.blog/2016/06/13/visualizing-procgen-text/) and [part two](https://emshort.blog/2016/09/12/visualizing-procgen-text-part-two/) (Emily Short)
- [GDC 2012 talk on dynamic dialogue](https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/) (Emily Short on Valve's rule database)
- [So you want to build a generator](https://galaxykate0.tumblr.com/post/139774965871/so-you-want-to-build-a-generator) (Kate Compton)
- [Felt: A Simple Story Sifter](https://mkremins.github.io/publications/Felt_SimpleStorySifter) (Max Kreminski)
