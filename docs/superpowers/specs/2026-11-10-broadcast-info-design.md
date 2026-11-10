# The broadcast, with more to read

Date: 2026-11-10 · Builds on the game viewer (`GameViewer.tsx`, `LiveGame.tsx`) · Leaves the field itself as it is
(a later pass paints it)

Mockup (second draft, agreed in direction): https://claude.ai/artifact/SHGGaKaxTtRqu6Fb2kbiwx. Its words are
placeholders; the words in this spec are the ones to build.

## Why

The broadcast view looks right but tells you little. Around the field there is a team, a score and a clock. It does
not say how many timeouts are left, how the drive is going, who is having a day, who got hurt, or what the weather
is, and the only way through a replay is a plain slider with no marks on it. On a wide screen the viewer sits in a
760px column with nothing either side.

This pass adds what a broadcast tells you, around the field you already have:

1. **A fuller scorebug:** records, timeouts, and the down and distance where your eye already is.
2. **A game timeline** in place of the slider: each team's drives on the game clock, with scores, missed kicks and
   turnovers marked.
3. **Two panels:** the game (score by quarter, weather, team stats, injuries) and the players (leaders, and each
   team's lines so far).

## Decisions

Agreed with the owner unless marked *(proposed)*.

1. **The field is untouched.** Field paint, big-play graphics and a network look are a later pass (see Out of scope).
2. **Both screens, both views.** The live game and *Watch replay* get the same scorebug, timeline and panels, around
   Broadcast or All-22.
3. **Nothing ahead of the picture.** The scorebug, the panels and the play log read through the play on screen, as
   the play log does today (`told` in both screens). The one exception is the replay's timeline: it draws the whole
   game, later drives dimmed, because finding the big moments is what it is for. A live game's timeline fills in as
   the game is played. *(proposed)*
4. **Fewer strips, not more.** Between the scorebug and the play log there are three: the field, one bar (down and
   distance left, the last result right), and the timeline with the buttons on it. No separate drive strip: the
   timeline's caption is the drive summary.
5. **Quieter buttons.** Play, previous and next sit on the timeline. *Broadcast | All-22* moves up beside *Box
   score*. Speed and highlights are small and grey.
6. **Yellow means now.** `--marker` is used for the down pill, the last result, the playhead and Play, and for
   nothing else on this screen.
7. **Panels beside the field on a wide window, tabs under it otherwise.** The field is never narrower than today's
   760px: this screen may grow to 1320px wide (the rest of the game stays at 1180px), and the panels sit beside the
   field only when the window has room for both (about 1280px). Below that they are tabs under the viewer: *Plays*,
   *Game*, *Players*. *(proposed: the owner has not yet said whether this screen may go wider than the others. If
   not, the panels shrink the field to 688px at 1180px.)*
8. **The box score's words.** Stat rows, the injuries list and the score by quarter use the labels and helpers
   `BoxScore.tsx` already has, so the two screens never say one thing two ways.
9. **No starters list and no other scores, for now.** A starters list would be 44 names with nothing beside them:
   this screen may not show ratings (fog of war). Each team's lines so far say who is playing and what he has done.
   Other games' scores can't be shown live: the rest of the week is played after your game ends (`live.finish`).

## 1. Reading a game from its log

A pure module, `src/ui/gameRead.ts`, beside `highlights.ts`. Everything is read off the play log (`PlayLogEntry[]`),
so it works the same for a live game (`LiveSession.plays`) and a replay (`GameResult.plays`), and for old saves.
A live game must not read `sim.result()`: the engine runs a few plays ahead of the screen.

```ts
/** Score by quarter through play `index`: quarters not yet reached are absent. */
quartersAt(plays, index, homeId): { home: number[]; away: number[] }

/** Timeouts left for each side: 3 a half and 2 in overtime, less each "Timeout X (n left)." since. */
timeoutsAt(plays, index, home, away): { home: number; away: number }

/** Every drive in the log, in order. */
drivesOf(plays, homeId): Drive[]
interface Drive {
  teamId: number;
  first: number;            // index of its first snap
  last: number;             // index of its last play (its kick included)
  start: number;            // game seconds at its first snap (0 = kickoff, 900 a quarter)
  end: number;
  from: number;             // yards from its own goal line at the first snap
  snaps: number;            // runs, passes and sacks, as `TeamGameStats.plays` counts them
  yards: number;
  how: 'td' | 'fg' | 'missed' | 'punt' | 'int' | 'fumble' | 'downs' | 'safety' | 'half' | 'end' | 'on';
}

/** Team numbers through play `index`: the rows the Game panel shows, named as `TeamGameStats` names them. */
teamStatsAt(plays, index, homeId): { home: RunningTeam; away: RunningTeam }

/** Each player's line through play `index`, by player id. */
linesAt(plays, index, homeId, names): Map<number, RunningLine>
```

`RunningTeam` is the part of `TeamGameStats` the panel shows: `totalYds`, `passYds`, `rushYds`, `firstDowns`,
`thirdDownAtt`, `thirdDownConv`, `turnovers`, `top`. `RunningLine` is the part of `StatLine` the Players panel
shows: passing (`passCmp`, `passAtt`, `passYds`, `passTd`, interceptions), rushing (`rushAtt`, `rushYds`, rushing
touchdowns), receiving (catches, yards, touchdowns), tackles and sacks.

**One rule decides what makes the panel: a number is shown only if the reader gets it exactly right.** At a game's
last play, `teamStatsAt` and `linesAt` must equal the recorded box score (`GameResult.home`, `.away`,
`.playerStats`). A test plays a few hundred games over several seeds and holds every shown number to that.

A first probe over one week's 16 games, with a throwaway reader, found:

| Number | Exact from the log |
| --- | --- |
| Passing and rushing attempts, completions, yards, sacks, total yards | 32 of 32 team-games |
| Turnovers, third downs converted | 32 of 32 |
| Catches and receiving yards, by player | every player |
| Score by quarter | 31 of 32 (an overtime game's empty fifth quarter) |
| Third downs tried | 25 of 32 |
| First downs | 8 of 32 (first downs by penalty are not counted yet) |
| Rushes by player | 76 of 107 (scrambles and kneels were not given to the quarterback) |

So the shape works and the rest is care. Where the log really cannot say something (the passer on a game kept
before v71, perhaps a first down by penalty), the choices in order are: read it from what the game already keeps
(`GameResult.field`, the play's text through `usePlayNames`); add one small optional fact to `PlayLogEntry` (no save
migration: old games lack it and that row is hidden for them); drop the row. Never show a number that can end the
game different from the box score.

Possession is the engine's own count (`top`); the reader adds each play's time to the side that had the ball, and
the test holds it to the box score like the rest.

**Injuries** come from the log's own line (`Injury: BUF RB D.Grimes (back) is out for the game.`), which carries
the quarter and clock. A finished game also has `GameResult.injuries` with the doctor's estimate; the panel shows
those at or before the play on screen, exactly as `GameInjuries` in `BoxScore.tsx` words them. A live game shows
what the log line said until the game is recorded.

**Records** in the scorebug are each club's record going into the game, counted from results before this game's
week (a replay of week 3 opened in week 9 still says 2–0).

## 2. The scorebug and the bar under the field

One component, `Scorebug`, used by both screens (today each writes its own copy of the markup).

- Each team's cell: abbreviation, the possession dot, the score; under the name, in small type, the record and three
  pips for timeouts (a used one dimmed). The pips have a text label for screen readers (`2 timeouts left`).
- The clock cell is unchanged: `Q2 · 2:45` over `Week 1`, the live dot in a live game, `Final` at the end.
- The possession dot and the pips are white. The team's own colours fill the cell as today.

The bar under the field keeps its two ends. The left end becomes a pill, `2ND & 10`, followed by `Ball on NO 17`
(`situation()` split in two). The right end is the last result, as today (`playLabel`).

## 3. The timeline

`GameTimeline`, in place of `<input class="vc-scrub">`.

**The picture.** Left to right is the game clock: four quarters of equal width, and a fifth, narrower section when
there is overtime. Two lanes: the away team's drives above the line, the home team's below. A drive is a bar from
its first snap to its last play, in that club's colour (its primary, or its secondary when the primary is too dark
to read on the scene: `readableOn` in `color.ts`). At a drive's end, a mark when it ended in something: a filled
diamond for a score, a hollow one for a missed kick or a turnover. A playhead stands at the play on screen.

**Live.** Only what has been shown is drawn. The drive on the field ends at the playhead. The rest of the track is
empty. Read-only, as a live game has no way back today.

**Replay.** The whole game is drawn. Drives the playhead has not reached are dimmed. A click or a drag on the track
jumps to the nearest play at that clock. A click on a drive jumps to its first snap.

**The caption.** One line under the track. By default it describes the drive on the field:
`Buffalo drive · 12 plays · 71 yds · 6:24`. In a replay, pointing at or focusing another drive shows that one:
`New Orleans drive · Q1 12:13 · 3 plays · Punt`. A drive that scored says who and how, from its last scoring
play's text.

**The buttons.** Previous, Play and Next sit left of the track on a wide viewer, under it on a phone (thumb reach).
Speed and the highlight level sit at the right of the caption line, in the grey `seg` style.

**Keyboard and tools.** A range input stays in the page (`id="viewer-scrub"`, visually hidden but focusable): arrow
keys step plays as today, its label reads the play's quarter and clock, and `scripts/screens.ts`, which drives
replays through that id, keeps working.

The legend (`Score`, `Missed kick or turnover`) is a single small line under the caption.

## 4. The panels

Two components, `GamePanel` and `PlayersPanel`. Beside the field when there is room (Decision 7), otherwise behind
three tabs under the viewer: *Plays* (the play log, the default), *Game*, *Players*. The tabs are a filter inside a
screen, not a place to link to, so they are a `seg` group (`docs/UI.md`: tabs that change what a screen is about are
routes, filters are `seg`). The tab picked and the Players toggle are remembered on the device (`viewerPrefs.ts`).

**Game** (left):

- The weather in one line, from `weatherAt` for the quarter on screen: `Night · 64°F · Wind 7 mph`, or `Indoors`.
- The score by quarter (`quartersAt`), quarters not yet played shown as a dot.
- Team stats, away on the left and home on the right, each row a label between two numbers over a thin split bar:
  Total yards, Passing, Rushing, First downs, 3rd down, Possession, Turnovers. The labels are the box score's.
- **Injuries:** the players hurt so far in this game, each a `PlayerLink` with what the doctor said. With none,
  the section is left out, as in the box score.

**Players** (right), with a toggle: *Leaders* · *BUF* · *NO* (the two abbreviations, yours marked the way the rest
of the game marks your club).

- *Leaders:* Passing, Rushing, Receiving and Tackles, the leading man of each team in each, with his line.
- *A team:* that team's lines so far, grouped as the box score groups them: passing, rushing, receiving, defense.
  Only players with something to show.
- Every name is a `PlayerLink` (`short`), so it opens his card.

Nothing in either panel is a rating, a range or a hidden trait: it is all box-score fact, which is public.

## 5. Layout and tidying

- `.viewer` loses its fixed 760px cap in favour of the stage grid: `232px minmax(760px, 1fr) 232px` when the window
  fits it, one column otherwise. The stage may be 1320px wide; nothing else on the page moves.
- The play log stays under the stage at full width on a wide window; on a narrow one it is the *Plays* tab.
- `GameViewer.tsx` is 800 lines and holds the broadcast field, the labels, the name linking and the replay screen.
  This pass moves what both screens share into their own files, because it has to touch all of it anyway:
  `BroadcastField.tsx` (today's `Field` and its projection, unchanged), `Scorebug.tsx`, `GameTimeline.tsx`,
  `GamePanels.tsx`, `PlayLog.tsx` (the list both screens now write out twice). `GameViewer.tsx` and `LiveGame.tsx`
  keep their own state and controls. No behaviour changes in the move.

## 6. Three pull requests

Each is usable on its own. None finishes an MVP item, so each bumps the last number of the version and adds a
changelog line (`docs/VERSIONING.md`).

1. **The reader and the scorebug.** `gameRead.ts` with its tests (the box-score equality test included, for every
   number later PRs show), the shared `Scorebug` with records and timeouts, the down pill, and the file moves of §5.
2. **The timeline.** `GameTimeline` in both screens, the buttons on it, *Broadcast | All-22* beside *Box score*.
3. **The panels.** `GamePanel`, `PlayersPanel`, the tabs, the wider stage.

## 7. Testing

This is UI and a reader of the log: nothing the sim reads changes, so no sims are run (`CLAUDE.md`, case 1).

- `gameRead.test.ts`: the equality test of §1 over several seeds; drives (a touchdown drive, a missed kick, a pick,
  a fumble lost, a turnover on downs, a safety, the half and the game running out, a drive across a quarter);
  timeouts across the half and into overtime; an overtime game's quarters; a two-point try (not a rush or a pass in
  the count); a snap wiped out by a flag.
- Component tests in the style of the existing `ui/*.test.tsx`: nothing past the play on screen in the scorebug or
  the panels; the live timeline draws nothing ahead of the playhead; the replay timeline draws the whole game.
- The screen contract (`ui/ui.test.ts`): names through `PlayerLink`, no rating on the screen.
- `npm run typecheck`, `npm run format`, then CI on the pull request.
- A look at the real screen at desktop and phone widths, light and dark, before each PR is called ready.

## Out of scope, for later passes

- **The field:** All-22's paint on the broadcast field, where the drive started, the red zone, names on the play.
- **Moments:** banners for touchdowns and turnovers, a player's line after a big play, cards at the half and the
  final.
- **A network look** (SNN, the game's own outlet) for the whole package.
- **Other games' scores** during a live game: it needs the week's other games played first, which is the engine's
  order of play, not a screen change.
- **Players out coming in** (inactive before kickoff) beside the game's injuries.
- **Going back in a live game.**
