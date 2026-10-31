# All-22: a top-down match view, and highlight levels

Date: 2026-10-31 · Builds on the replay viewer (`GameViewer.tsx`, `LiveGame.tsx`) · Leaves the broadcast view as it
is (a later pass tweaks it)

## Why

You watch your games through the broadcast view: a 2.5D field, the ball's flight, its trail, the down lines. It reads
well, but it shows one object. A GM wants to see the people: who got open, who got beaten, who made the tackle. And a
full game is about 170 snaps; FM lets you watch only the moments that matter, and so should we.

This adds two things:

1. **All-22**, a second view you can switch to: top-down, all 22 players as numbered dots, plus the ball.
2. **Highlight levels** for both views: Key, Extended or the full game.

## Decisions (agreed with the owner)

1. **Staged, not simulated.** The match engine is untouched. The view stages each play so it ends exactly where the
   engine said, with the right passer, target, ball carrier and tackler. AFLS is GM-only: you never call plays, so a
   spatial engine would add no decision for you, and it would mean re-tuning every stat check. Revisit this only if a
   coach mode (play calling) is ever added.
2. **Hybrid staging.** The players in the play follow a script and hit the engine's spots exactly. Everyone else
   steers toward a goal set by his role. Steering is worked out once when a play loads, at a fixed step with a seeded
   wobble, then played back: 1× and 2× look the same, and a play always stages the same way.
3. **Every dot numbered.** Tap one for the player's name and position.
4. **Phone held upright:** the field runs up the screen, about 45 yards visible, and the camera follows the ball. The
   offense always attacks up the screen; on a change of possession the field turns between plays. **Wide** (desktop,
   phone held sideways): the whole field sideways, away end zone on the left, matching the scorebug.
5. **The ball is the read.** It leaves a trail, as in the broadcast view. Players leave no trails.
6. **All-22 plays at 1× and 2× only.** Faster is unreadable.
7. **Highlight levels, no instant replays.** Levels work in both views.
8. **Both screens:** the live game and *Watch replay*.
9. **Older games** (played before the data ships) offer the broadcast view only.
10. **Four PRs**, each usable on its own (§6).

**Out of scope, for later passes:** flash for flags and big plays (a flag flying to the spot, a big-play camera),
instant replays, changes to the broadcast view, and a coach mode.

## 1. Highlight levels (PR 1)

A pure module, `src/ui/highlights.ts`. `highlightLevel(plays, index)` returns the lowest level a play shows at:
`'key'`, `'extended'` or `'full'`.

**Key** (about 25–40 plays a game):

- touchdowns, field goals made or missed, safeties;
- turnovers: interceptions, lost fumbles, turnovers on downs, blocked kicks;
- plays of 20+ yards;
- fourth-down tries (not punts or field goals) and two-point tries;
- every snap in the last two minutes of the fourth quarter or overtime with the score within eight.

**Extended** (about 60–80 plays), Key plus:

- third downs;
- snaps inside the opponent's 10 (calibrated: inside the 20 put Extended at 80 plays a game, on its ceiling);
- sacks;
- plays of 15+ yards (calibrated: 10+ put Extended at 84 plays a game, over its range);
- every snap in the last two minutes of the first half.

**Full game:** every play. It's the default, so nothing changes until you pick a level.

Everything is read off the log entry: its kind, spots (`from`, `to`, signed by the offense's direction), down,
distance, yard line, quarter, clock and scores. Fumbles and turnovers on downs are read from the text, the way
`playLabel` already reads touchdowns. Announcements (timeouts, the two-minute warning, injuries) never animate, so they
always drop straight into the log.

**Behaviour:**

- **Skipped plays still happen on screen.** The plays between two highlights drop into the log together and the
  scoreboard updates. After a short pause (about 400 ms at 1×, scaled by speed), the field re-spots and the next
  highlight plays. One beat per skipped play would mean 20 seconds of flicker per game at Key.
- **Live game:** as above. *Sim to final* is unchanged.
- **Watch replay:** ◀◀ and ▶▶ step between plays at or above the level, and autoplay skips the same way as live. The
  scrubber and the play cards still reach every play, and picking a play below the level plays it.
- **The control:** a three-way switch beside the speed button, **Key · Ext · Full**. Each device remembers the pick in
  `localStorage`, wrapped in try/catch, the way `theme.tsx` keeps the theme. It's never stored in the save.

## 2. Data (PR 2)

The engine already knows who did what on every snap and who is on the field. This PR writes it down, for games that
keep their plays.

**Per play:** `PlayLogEntry.who?: PlayActors`, player ids.

| Field    | Who                                                    | Where the engine has it                         |
| -------- | ------------------------------------------------------ | ----------------------------------------------- |
| `qb`     | the passer on a dropback                               | the lineup's `qb`                               |
| `ball`   | the target, the ball carrier, the kicker or punter     | the play's `targets` / `rushAtt` stat entries   |
| `cover`  | the man in coverage on a pass                          | `PlayResult.defender`                           |
| `tackle` | the first tackler                                      | the play's first `tackles` stat entry           |
| `rush`   | who got home: the sack, or the pressure without one    | `PlayResult.rusher`, `pressureBy`               |
| `beat`   | the blocker he beat                                    | `blockerFor`, where the engine already calls it |
| `take`   | the interceptor or fumble recoverer                    | `PlayResult.turnover.by`                        |
| `ret`    | the returner on a kick                                 | the kick's returner                             |

**The rule:** record only what the engine already computes, and never add a draw on any stream. Where the engine
didn't pick someone (say, the beaten blocker on a pressure that didn't become a sack), the field stays empty and the
stager picks one deterministically.

**Per game:** `GameResult.field?: FieldRecord`.

- `units`: for each side at kickoff, the offense's eleven in role order (QB; LT, LG, C, RG, RT; RB; receivers by
  spot), the defense's eleven (DT, EDGE, LB, CB, S), the rush rotation, and the kick units (`st`, `k`, `p`, `kr`,
  `pr`, `fg`).
- `scheme`: each side's personnel, front and coverage, as `schemes.ts` names them.
- `jerseys`: player id → jersey number at kickoff, so a later trade or a new number can't change an old game.
- `changes`: `[playIndex, side, units]` each time a side's units change mid-game. An injury rebuilds the whole lineup
  (`injuryStoppage` calls `buildLineup`), so the side's full units are stored again.

A running back's breather and a rush-rotation man getting home don't need records: the stager sees a player in the
play who isn't among the eleven and swaps him in for the man at his position for that snap.

**Retention:** written only when `keepPlays` is on. `prunePlayLogs` drops `field` along with the plays. That's about
1,200 numbers per kept game.

**Save:** bump `SAVE_VERSION` and add a `migrate.ts` step. The step changes nothing, because both fields are optional
and older games simply lack them.

## 3. The stager (PR 3, finished in PR 4)

Pure TypeScript in `src/ui/stage/`: no React, no DOM, no `Math.random`. It takes one play and the game's
`FieldRecord`, and returns a `StagedPlay`: each of the 22 dots' positions and the ball's (x, y, height) at 20 steps a
second, which players are in the play, and the duration. Positions are in field yards, the same coordinates as the
broadcast view.

**Randomness:** the engine's `Rng` class on its own seed, `${seed}:${season}:${gameId}:stage:${index}`. It touches
none of the sim's streams.

**One ball path for both views.** `buildPath` and its helpers move out of `GameViewer.tsx` into a shared module, with
no change in behaviour. The stager times its scripts off the same segments, so both views throw the same ball.

### Formations (`formations.ts`)

Spots by role, relative to the ball, for each personnel grouping (11, 12, 10) and each front and coverage:

- The line splits; receivers split out by spot (X, Z, slot, TE); the back sits behind the quarterback.
- Defensive techniques along the front; linebacker depth.
- Corners pressed or off; one-high or two-high safeties by the coverage shell.
- The strength side is a seeded choice, leaning toward the play's `lane`.

### Scripts (`scripts.ts`): the players in the play

- **Run:** the handoff about 3 yards deep, then the carrier follows the lane to `to`. The tackler meets him there at
  the end; on a touchdown no one does.
- **Pass, incomplete, interception:** the quarterback's 6-yard drop, as today. The target runs a route that reaches
  `air` as the ball does, with the cover man a yard or two behind (closer on an incompletion, under it on an
  interception). After a catch the target runs to `to` and the tackler meets him. On an interception the man who took
  it catches it and returns it to `to`.
- **Sack:** the drop; the rusher gets past the blocker he beat and meets the quarterback at `to`.
- **Scramble:** the drop, then the quarterback breaks out along the lane to `to`.
- **Kneel, spike:** the quarterback alone; everyone else eases off.
- **Pre-snap penalty:** the units hold their stances and the ball walks to the new spot.
- **Kicks:** in PR 3, the real kick units line up and the ball flies; the players hold their spots. PR 4 stages them
  fully:
  - Kickoff: the kicker's run-up, coverage lanes, the returner fielding at `air` and returning to `to`, the tackler.
  - Punt: the snap 13 yards back, the gunners releasing, the return.
  - Field goal and extra point: the line blocks, the hold, the kick.

### Steering (`steer.ts`): everyone else

Each step, every unscripted player gets a goal from his role:

- **Linemen:** engage the nearest rusher and hold.
- **Defensive line:** push, then pursue once the ball is out.
- **Other receivers:** a decoy route from a small tree for their spot (seeded).
- **Zone defenders:** sink to a landmark, then break on the ball once it's thrown.
- **Man defenders:** mirror their man.
- **After the catch or handoff:** defenders pursue where the ball is heading; offensive players turn upfield to block.

Movement limits:

- Top speeds by position, roughly the NFL's tracking data in yards per second: DB and WR 9, LB and RB 8.5, TE 8,
  DL 7.5, OL 6.5.
- An acceleration limit.
- Soft separation of about a yard.
- A small seeded wobble.
- **No steered defender may come within a yard of the ball carrier before the scripted tackler does.** They ease off
  instead, so the engine's tackler always makes the tackle.

**Between plays:** each dot slides from where the play ended to its spot in the next formation, in the time the
broadcast view takes to re-spot the ball. On a change of possession, each unit runs to the other side's formation.

## 4. The All-22 view (PR 3)

A component, `TopDownField`, with the same props as `Field` (entry, resting spot, animation key, speed, `onDone`), plus
the game's `FieldRecord`. `GameViewer` and `LiveGame` show one or the other.

- **The toggle:** a two-way switch, **Broadcast | All-22**, with the viewer's controls. It's hidden when the game has
  no `FieldRecord`. Each device remembers the pick, like the highlight level.
- **The shape follows the space.** The field box's aspect ratio (read with a `ResizeObserver`) picks the layout:
  - **Wide** (1.6:1 or wider): the whole field sideways, away end zone on the left.
  - **Otherwise, upright:** about 45 yards visible. The camera eases along with the ball, leading about 5 yards in the
    direction of play. On a long kick it pulls back to fit the flight (up to about 70 yards), then settles. The
    offense attacks up the screen, and the field turns during the re-spot on a change of possession.
- **Dots:** each team in its kit (`kitFor` in `color.ts`, home and away), so two teams with similar colours still read
  apart. The jersey number sits in the kit's ink colour. Players in the play get a bright ring and are drawn on top.
- **The ball:** a small brown oval. In the air it grows with height and its shadow drifts off it.
- **Markings:** the broadcast view's night palette. Yard lines, numbers, hashes, end zones in team colours with their
  abbreviations, the line of scrimmage and the first-down line, and the ball's trail.
- **Tapping:**
  - Each dot has an invisible hit circle of about 2.5 yards, and the nearest dot wins when they overlap.
  - A tap opens a small card: number, name (through `PlayerLink`) and position.
  - Tapping elsewhere closes it, and play doesn't pause.
  - Names resolve the way the play text does (`usePlayNames`).
- **Speed:** 1× and 2×. Switching to All-22 at 4× or 8× sets 2×.
- **Reduced motion:** honoured as today, so each play jumps to its end.
- **Drawing:** SVG. Each frame writes the dots' transforms straight to refs, as `Field` does, with no React state per
  frame.
- **Accessibility:** the field has an `aria-label`, and the play text below stays the readable account.

## 5. Testing

**Highlights (PR 1)**

- Unit tests for each rule: a touchdown is Key, a 12-yard gain is Extended, a 3-yard run on first down is Full, and so
  on.
- Across many simulated games, Key averages 25–40 plays and Extended 60–80.

**Data (PR 2)**

- The players saved on a play match that play's box-score credits: the passer has the attempt, the target the target,
  the tackler the tackle, the man who took it the interception.
- A game plays out identically with recording on and off: same score, same box score.
- An old save migrates and loads, and its games have no `field`.
- `npm run sim -- 10` locally, because `gameSim.ts` changes. Nothing should move.

**Stager (PR 3 and PR 4)**, over every play kind across many simulated games:

- 22 different real players on the field, with unique jersey numbers on each side.
- The ball ends at the engine's spot (`to`, or `from` on an incompletion).
- On a tackled play, the tackler is within a yard of the carrier at the whistle.
- Nobody leaves the field unless the play went out of bounds.
- The same play always stages the same way.
- Staging one play takes a few milliseconds. The test bound is loose, so it can't flake.

**Screens (PR 1, PR 3)**

- The screen-contract tests in `ui/ui.test.ts`: the tap card's name goes through `PlayerLink`.
- The toggle is hidden for a game without a `FieldRecord`.
- Switching to All-22 clamps the speed to 2×.
- Screenshots at phone (390 px) and desktop widths, upright and wide.

## 6. Build order

| PR  | Delivers                                                                                                     | Local checks (CI runs the rest)               |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | Highlight levels in both views                                                                               | typecheck, highlight tests                    |
| 2   | `who` on each play, `FieldRecord` per game, the save bump                                                    | gameSim and migrate tests, `npm run sim -- 10` |
| 3   | The stager for scrimmage plays, with steering; the All-22 view and toggle; kicks lined up with the ball flying | typecheck, stage tests, screenshots           |
| 4   | Kicks fully staged (kickoffs, punts, returns, field goals, extra points); steering polish                    | typecheck, stage tests, screenshots           |

None of these finishes an MVP item, so each bumps the last number of the version (`docs/VERSIONING.md`), with a
changelog entry in `src/ui/changelog.ts`.
