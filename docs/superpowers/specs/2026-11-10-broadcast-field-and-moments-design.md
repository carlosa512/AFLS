# The broadcast, part two: the field and the big moments

Date: 2026-11-10 · Builds on part one (`2026-11-10-broadcast-info-design.md`: the scorebug, the drive timeline, the
panels), on the same branch · The owner's asks 2 and 3

Mockup (agreed Nov 10): https://claude.ai/artifact/DW3HPuYArYMt1qcRzGb8YG. Its words are placeholders; the words in
this spec are the ones to build.

## Why

Part one put the game's numbers around the field. The field itself is still a bare green shape with a ball on it
under a band of grey dots, and nothing on screen marks a touchdown, a turnover, a flag or the half. All-22 has the
paint (team names in the end zones, a midfield mark, goalposts, benches) and announces flags and injuries; the
broadcast view has none of it. And in both views the home team defends the same end zone for sixty minutes.

This pass does three things:

1. **Paints the broadcast field** and gives it a stadium: stands, a crowd, the sky and the game's own weather.
2. **Marks the big moments** with graphics, in both views: a score, a turnover, a flag, an injury, a player's line
   after a big play, and cards at the quarter, the half and the final.
3. **Switches ends each quarter**, in both views.

## Decisions

Agreed with the owner (Nov 10).

0. **Screens only**, as in part one. Nothing in `src/engine/` changes, nothing is added to the save, no tuning
   number moves. Weather is read through the functions that already exist.
1. **Teams switch ends each quarter.** Because the paint must then stay put, **both end zones are the home
   club's**: its city in one, its nickname in the other, as real stadiums do. A neutral-site game keeps one end zone
   a team.
2. **No player names on the play.** The mockup's chips on the ball's path ("McKinney", "Morris +16") are dropped:
   they crowd a phone. The bar under the field and the play log already say who.
3. **One look for every moment, in both views.** Broadcast shows nothing for a flag or an injury today and All-22
   shows them in its own strip. Both use the same banner now.
4. **A live game waits at the half.** The halftime card stays up until *Continue*. A replay shows it for a few
   seconds and carries on.
5. **The bench and the crowd react** to a score or a takeaway, and to nothing else.
6. **The SNN look.** The game's own network (the Sports News Network of the inbox) signs the scorebug and the
   cards. It is drawn in white, never yellow: yellow still means "now" (part one, Decision 6).
7. **The final card shows numbers, not a sentence.** The game's recap line (`gameStory`) is written in your club's
   voice ("We controlled it…"), which is wrong for a broadcast, and a neutral one would be engine text.
8. **Still out:** other games' scores, a starters list, instant replays, going back in a live game.

## 1. Switching ends

The log's field coordinates never change: the home side attacks toward 100 all game. Switching ends is a matter of
where a view draws things, so it lives in one pure helper both views use.

```ts
// src/ui/stage/ends.ts
/** Whether the teams have switched from where they started: the second and fourth quarters, and every other
 *  overtime period after them (5 as 1, 6 as 2…). */
export function endsSwitched(quarter: number): boolean; // quarter % 2 === 0
/** A spot in the log's coordinates as the stadium has it this quarter: itself, or turned half way round
 *  midfield (100 − x, the field's width − y), so a team's left is still its left. */
export function stadiumSpot(x: number, y: number, quarter: number): { x: number; y: number };
```

**The stadium stays put; the men and the ball move.** The paint (lines, numbers, end zones, the midfield mark,
goalposts, benches) is drawn the same in every quarter. Everything that comes from a play goes through
`stadiumSpot` first: the ball's path, the line of scrimmage and the line to gain, the drive's band, and in All-22 every dot.
Mirroring a group would mirror its text, so nothing is mirrored by a transform.

- **Broadcast:** `project(x, y, h)` takes the quarter and maps `stadiumSpot(x, y)`.
- **All-22, wide:** `toScreen` maps `stadiumSpot` for the men and the ball; the field group keeps its transform.
- **All-22, upright** (a phone): the offense still attacks up the screen and the field still turns with the ball.
  The only visible change is which painted end zone is ahead of them.
- **The cut.** The first play of a new quarter starts with the ball on the other side of the picture. Both views
  cover it with the quarter card of §3 and the quick dip to dark All-22 already uses when the field turns (`DIP`).
  The broadcast field's memory of where the ball lay (`FieldMemory`) is cleared at the switch, so nothing sweeps
  across the field.
- The scorebug keeps away on the left and home on the right. The benches do not move: home near, away far. A man
  coming on, the trainers and a celebrating sideline still come from their own bench.

**End zones.** `FieldPaint` and the broadcast paint take the same rule: at a home game the end zone at x < 0 reads
the home club's nickname and the one at x > 100 its city, both in its colours. At a neutral site (`game.neutral`)
each team has one, as today.

## 2. The painted field

The broadcast field moves out of `GameViewer.tsx` into `screens/BroadcastField.tsx` (it is being rewritten, and
`GameViewer.tsx` is 800 lines). Its projection, its ball and trail, the two lines and its timing are unchanged.
What it draws under and around them is new, in `screens/BroadcastPaint.tsx`:

**The field**, in the broadcast's own projection, from the same facts All-22 paints with (`FieldPaint.tsx` exports
its greens, `surfaceFor`, the goalpost width and the team areas so the two never differ):

- grass mowed in five-yard stripes or turf, by the home stadium;
- the two end zones (§1), each letter laid flat on the grass with its feet toward the field of play;
- yard lines, hash marks and yard numbers, the numbers laid flat;
- the home mark at midfield;
- goalposts standing over each end line;
- the two benches along the sidelines, home near and away far, with the men on them as dots.

**The drive on the grass**, from `drivesOf` (part one), through the play on screen:

- a band in the offense's colour from where the drive began to the line of scrimmage, and a dashed line with the
  label `Drive began` where it started;
- a faint red tint from the 20 to the goal line while the offense snaps the ball inside it.

**The stadium**, behind the far sideline, in place of today's dotted band:

- a stand with a crowd in the home club's colours (both clubs' at a neutral site) and a wall along the field;
- the sky by the game's weather (`game.result.weather`, or `gameWeather(league, game)` while it is live, through
  `weatherAt` for the quarter on screen): a night sky with the lights on for a night game, a day sky, an overcast one
  for rain or snow, and a roof's trusses for `dome` and `closed`;
- rain as falling streaks, snow as drifting flakes, `mixed` as both, heavier when `heavy`; snow pales the grass;
- two flags on the stand's rim that lean further the harder the wind blows, and hang still indoors.

Everything that moves (rain, snow, the reactions of §3) stops under `prefers-reduced-motion`. The crowd is drawn
once per game from a fixed pattern, not from `Math.random`.

All-22 keeps its own top-down paint. It gains the end-zone rule of §1 and nothing else from this section.

## 3. The moments

A pure module, `src/ui/moments.ts`, says what moment a play makes. A component, `screens/GameMoments.tsx`, draws
it over the field in either view. Nothing here reads past the play on screen.

```ts
export type Moment =
  | { kind: 'banner'; tone: 'score' | 'turnover' | 'flag' | 'injury'; teamId: number | null; head: string; line: string; side?: string }
  | { kind: 'player'; playerId: number; line: string }
  | { kind: 'quarter'; head: string }
  | { kind: 'half' }
  | { kind: 'final' };

/** The moments the play at `index` makes once its result has been shown, in the order they appear. */
export function momentsFor(plays, index, homeId, names, record?): Moment[];
```

**Banners.** A block in the team's colours with its abbreviation, a headline, a line under it, and on a wide viewer
a short note at the right.

| When | Headline | Line under it | Note at the right |
| --- | --- | --- | --- |
| A touchdown | `Touchdown` | the play that scored it, from its log line | the drive: plays, yards, time |
| A field goal made | `Field goal` | the kicker and the distance | the drive |
| A field goal missed | `No good` | the kicker and the distance | |
| A safety | `Safety` | the play | |
| An interception | `Interception` | who picked off whom | whose ball |
| A fumble lost | `Fumble` | who recovered | whose ball |
| A fourth down stopped | `Turnover on downs` | | whose ball |
| A flag | the foul | the team and the man | the yards, and `First down`, `No play`, `Declined` or `Offsetting` |
| An injury | `Injury` | the man, his position, what it is | `Out for the game` |

A score or a takeaway is in the colours of the side it went to. A flag's block reads `FLAG` on yellow (a flag is
yellow, and it is the thing happening now). The facts come from readers that exist: `drivesOf`, `flagCall`,
`injuryCall`, `handoverFor`, `fumbleIn`, the play's own text.

**A player's line**, bottom left: his number in his club's colours, his name (a `PlayerLink`, so it opens his card),
his position and club, and his line so far from `linesAt`, worded as the Players panel words a leader.

- **Only on a big play:** a gain of 20 yards or more from scrimmage, for the man who gained it. (Owner, Nov 10. No
  milestone lines.)
- **No spoilers:** it appears when the play's result is shown, never while the play is running, and its numbers
  count that play.
- **All at once, and a beat longer:** the whole line appears together, and the hold before the next play is 1.2
  seconds longer at 1× than a big play's usual hold, so it can be read.

Never together with a banner: a touchdown's banner wins.

**Cards**, over the whole field:

- **The quarter** (after the first and the third): a small card, `End of the first quarter`, held through the cut
  of §1.
- **The half:** the score, four rows from the Game panel (Total yards, First downs, 3rd down, Turnovers), and the
  leading passer, rusher and receiver of the game so far. In a live game it stays until *Continue*, with *Sim to
  final* beside it. In a replay it shows for five seconds at 1× and the replay carries on; stepping or scrubbing dismisses it.
- **The final:** the same card with the final score, and the buttons the live game's result panel has today (*Box
  score*, *Watch replay*, *Continue*). In the live game it replaces that panel, so the result is said once.

**The bench and the crowd.** While a score or takeaway banner is up, the bench of the side it went to hops and,
when that side is at home, the crowd brightens.

**When they show.** A moment appears when its play's result has been shown and lasts through the hold before the
next play. Broadcast takes All-22's hold after a big play (`holdAfter`) so a banner can be read; an ordinary play's
hold does not change. At 4× and 8×, banners show for a shorter beat, never under 0.8 seconds, and the player's line and the
quarter card are skipped. Plays the highlight level skipped past make no moment: only the play that is
shown does.

**All-22.** Its flag, injury and change-of-possession strips are tied to its staging (the officials confer, the
trainers come out), so they keep their timing and take the banner's look. Score banners, the player's line and the
cards come from the shared overlay, as in Broadcast. All-22's last-play finale plays first; the final card follows.

**SNN.** A white `SNN` tab at the left of the scorebug, and on the corner of each card.

## 4. Files

- New: `ui/stage/ends.ts`, `ui/moments.ts`, `screens/BroadcastField.tsx`, `screens/BroadcastPaint.tsx`,
  `screens/GameMoments.tsx`, and their tests.
- Changed: `screens/GameViewer.tsx` and `screens/LiveGame.tsx` (the overlay, the halftime wait, the final card, the
  hold), `screens/TopDownField.tsx` (`stadiumSpot`, the banner's look), the bench
  and sideline helpers in `ui/stage/`, `screens/FieldPaint.tsx` (end zones, exports),
  `screens/Scorebug.tsx` (the SNN tab), `src/styles.css`.

## 5. Testing

Screens only, so no sims (`CLAUDE.md`, case 1).

- `ends.test.ts`: quarters 1 to 4 and overtime; `stadiumSpot` is its own inverse and leaves midfield where it is;
  with the ends switched, the offense's goal line is drawn at the far end from where it was and its left is still
  its left.
- `moments.test.ts`, on hand-built logs and on real games: each row of the banner table; a wiped-out snap makes a
  flag and nothing else; a touchdown never also makes a player's line; a 25-yard gain makes one and a 19-yard gain
  does not; the last play of the second quarter makes the half
  card and the last play of the game the final; nothing is made for a play not yet told. Over a week of real games:
  every scoring play makes exactly one score banner for the side whose score went up.
- Component tests (`renderToStaticMarkup`): at a home game both end zones carry the home club's words and at a
  neutral site one each, in Broadcast and in All-22; the paint is identical in the first and second quarter while the
  ball's position is mirrored; each weather (`night`, a `dome`, `rain`, `snow`, `mixed`) draws its layers and no
  other; no player's name is drawn on the field; the live halftime card has *Continue* and the replay's has none;
  the live final shows the result once.
- The screen contract (`ui/ui.test.ts`), `npm run copy` for the new words, `npm run typecheck`, `npm run format`.
- A look at the real screen before it is called ready: both views, a phone and a wide window, both themes; the cut
  at each quarter; rain and snow moving and, with reduced motion on, still; a live game waiting at the half; the 8×
  speed.

## 6. Order of work

On the part-one branch, no pull request until the owner asks for one. It finishes no MVP item: the last number of
the version goes up once, with one changelog line.

1. Switching ends, in both views, with the end-zone rule.
2. The painted field and the stadium.
3. The moments: the reader and its tests, then the banners and the player's line, then the cards and the halftime
   wait.

## Part three: the pregame card

Added after parts one and two were reviewed, on the same branch. Screens only, like the rest.

- **What.** A card over the field before the first play, in the look of the halftime and final cards
  (`PregameCard.tsx`): the week and the kickoff slot, both clubs with their records coming in, the home city and the
  conditions at kickoff, and who is out for each side (three names a side, then "and n more"; each name a
  `PlayerLink`). On a phone the names give way to a count, and the Game panel under the field has the list ("Out").
- **Where.** In the viewer the game already opens in. No new screen and no mail.
- **A live game waits** on it for *Kick off* (the owner's call: the same rule as the half), with *Sim to final*
  beside it. Play on the transport is the kickoff too. Leaving and coming back finds the card still up.
- **A replay** shows it for about four seconds as it opens, or until anything is pressed, then shows the first play
  as it did before.
- **Nothing is on the field under it:** the stadium is drawn idle (no ball, no lines) and nothing of the first play
  is told, so the card spoils nothing.
- **Who is out** is read once, as the live game starts (`live.start` keeps it in the session): hurt men who cannot
  play, longest layoff first by the doctor's estimate, the injury report's order. A man playing through it is not
  out. It never says who would have started (that would lean on ratings a screen may not show). A finished game's
  save does not keep who sat out and nothing is added to the save, so a replay's card has no list (exact or absent).

## Out of scope, for later

- Other games' scores, a starters list.
- A neutral broadcast voice for the final (it would be engine text).
- Sound.
- Going back in a live game, and instant replays.
