# Fast-forward between highlights

A short "fast-forwarding" beat in the game viewer, live and replay, for the plays the highlight level (Key or Ext)
skips. Today those plays land in one blink and the next highlight starts; at 4× and 8× the game seems to teleport.

## Why

The owner watches at Key or Ext and fast speeds. The jump between highlights is jarring: the ball, the score and the
clock change with nothing on screen to say time passed. The fix is not a pause screen. It is a beat that shows the
game moving on: the field glides, the clock runs and one line says what changed.

## How it works today

- `highlights.ts` decides which plays animate. `playOn` (replay) and `live.skipTo` (live) move past the plays a level
  skips and land on the last one before the next highlight, marked `still`.
- A still landing doesn't animate. `BroadcastField` places the ball and lines at once and calls `onDone` after
  `450 / speed` ms. `TopDownField` places the last frame at once. `GameViewer.onDone` and `LiveGame.onDone` then go
  straight to the next highlight. At 8× the whole gap is about 55 ms.
- `playMoments` gives a still landing no banner, line or quarter card. Only the half and the final still come up.
- The scorebug reads the play on screen (`plays[index].clock`), so the clock jumps over the gap.
- The original highlights spec (`2026-10-31-all-22-view-design.md` §1) set the short pause and turned down one beat per
  skipped play ("20 seconds of flicker per game at Key").

What a gap covers (60 simulated games, measured for this design):

| | Key | Ext |
|---|---|---|
| Gaps a game | about 20 | about 37 |
| Plays skipped, typical and long (median, 90th percentile) | 5, 15 | 2, 5 |
| Game clock skipped, typical and long | 1:34, 6:00 | 0:45, 2:07 |
| The ball changes teams in the gap | about half | about half |
| The gap crosses a quarter | 13% | 6% |

Interceptions, fumbles, touchdowns, field goals and fourth-down tries all show at Key, so a change of possession inside
a gap is almost always a punt, or the kickoff after a score that was shown.

## Goals

- Every still landing (every gap, however small) becomes a fast-forward beat: the field glides to where the next
  highlight starts, the game clock counts down, and a centred card shows the ticking clock and one line about what
  changed.
- Both views (Broadcast and All-22), both screens (`LiveGame`, `GameViewer`).
- The beat's length depends on speed, with a minimum (the owner's pick, option B):

  | Speed | Beat |
  |---|---|
  | 1× | 2 s |
  | 2× | about 1.4 s |
  | 4× | 1 s |
  | 8× | 0.8 s |

  That is `max(800, 2000 / √speed)` ms. 800 ms is `BANNER_FLOOR`, the score banner's minimum. One constant for the
  base, one for the floor, both easy to tune once the owner has watched it. All-22 plays at 1×, 2× or 4× only
  (`allSpeed`), so it never reaches 0.8 s.

## Not this

- Not a pause screen. Nothing waits for a press, and the game carries on by itself.
- Not a replay of the skipped plays at high speed: a 15-play gap becomes a blur, and All-22 already caps at 4×
  because faster can't be read.
- No change to which plays each level shows (`highlightLevel`), to Full (it never skips), or to *Sim to final*.

## The beat, as seen

```
 ┌───────────────── field, dimmed and greyed ─────────────────┐
 │                                                            │
 │                 ┌──────────────────────────┐               │
 │                 │  ⏩   Q2  6:41            │  ← ticking    │
 │                 │  7 plays · Hawks punt      │               │
 │                 │  Wolves ball on WOL 22     │               │
 │                 └──────────────────────────┘               │
 │        ●━━━━━━━━━━━━━━━━━━━━▶●   ball and lines glide       │
 └────────────────────────────────────────────────────────────┘
```

- **The card.** A compact box centred on the field, not a full-width banner. It uses the moment cards' look (`.mc-in`
  on `--scene-panel`), much smaller. Top row: the fast-forward icon and the game clock, large, ticking. Under it, one
  or two short lines (below). It fades in and out quickly (about 150 ms).
- **The dim.** The whole field (stadium, crowd, play) dims and loses most of its colour behind the card, a lighter
  wash than the quarter card's (`.moment-card.small` is the starting point) plus a greyscale. One strength value. The
  glide stays visible through it.
- **The clock.** It counts down from the clock the scorebug showed on the last highlight to the clock the next
  highlight snaps at, so the scorebug doesn't jump a second time when that play starts (with no next play, the game's
  last play's clock). It runs linearly through game seconds (`secondsOf`). Across a period it runs to 0:00, then shows
  the next period at its full length (15:00 a quarter, an overtime's own length, which `secondsOf` already knows) and
  carries on. The scorebug's clock ticks in step with the card's. A gap never crosses the half (`stopsAt` stops
  there). During the beat the screen's index is already the play landed on, so the beat keeps the index it started
  from (`live.skipTo` overwrites `current`).
- **The score.** The scorebug shows the score through the end of the gap from the moment the beat starts, so it never
  disagrees with the card ("Extra point good" with the point on the board). In practice only an extra point lands
  inside a gap.
- **Broadcast.** The ball and the chains glide from where they lay to the landed spot over the whole beat, using the
  re-spot slide that already exists (`respot` in `BroadcastField`), without its 40-yard jump (`teleport`): a gap may
  glide the length of the field.
- **All-22.** The players fade out, the ball glides to the landed spot, and the players fade in where the landed play
  ended (the frame a still landing shows today). All three fit inside the one beat.

### The line under the clock

Read from the plays in the gap (after the last highlight, through the play landed on) and the next highlight's snap.

- **Plays:** the snaps in the gap, as the drive summary counts them (`booked`): "7 plays", "1 play". Kickoffs, extra
  points and notes (timeouts, the two-minute warning, injuries) don't count.
- **Same team has the ball:** the plays, then its yards: "5 plays · 38 yds". Second line: where the next snap is, in
  the scorebug's words (`downParts(...).spot`): "Ball on WOL 30".
- **The ball changed teams:** the plays, then how it changed: "7 plays · Hawks punt", or after a shown score, "Extra
  point good" (or "Extra point missed"). Second line: the team with the ball and where: "Wolves ball on WOL 22".
- **No snap in the gap** (say only an extra point and a kickoff): no play count, just how it changed and where.
- **The next highlight is not a snap** (a kickoff, a punt with a big return, the second half's kickoff): no "Ball on"
  line; one line is enough.
- **The gap ends the game** (no next play): the plays and, if the ball changed teams, how; no "Ball on" line.
- Words follow `docs/UI.md` "Words on a screen" and the house words in CLAUDE.md (a team, never a club). Run
  `npm run copy` and read the new lines.

The builder writes the exact cases from these rules, as a pure function beside `playMoments` (for example
`skipSummary(plays, from, to, home, away)`), held by tests.

## Behaviour around it

- **The half and the final.** A gap that lands on the half's last play or the game's last play plays its beat first,
  then the card comes up as today. In All-22 the final whistle (`finaleFrame`, which a still landing on the last play
  already runs) follows the beat, then the final card.
- **Stepping by hand.** ▶▶ and ◀◀ in a replay, the scrubber and picking a play card stay instant: that is the viewer
  choosing to jump. Only playing on (`advanceFrom` in a replay, `next` in a live game) gets the beat.
- **Pausing during the beat.** The beat ends at once: the ball, the lines and the clock land where they're going, the
  card and the dim go, and nothing more plays. Play again goes on to the next highlight; the beat isn't replayed.
- **▶▶ or ◀◀ during the beat** (a replay): the beat ends at once, as with pause, and the step happens.
- **Reduced motion** (`prefers-reduced-motion`): no glide and no ticking. The card shows the landed clock and the line
  for the same length of time, over the dim, so it can still be read.
- **Switching view mid-beat** (Broadcast and All-22): the new view lands still, as switching does today.

## Approaches considered

1. **The beat inside the field being watched (picked).** The field glides, the scorebug clock ticks, and the card sits
   over the field in the moments layer. One pure function times it and one words it; live and replay share both.
2. **A separate fast-forward screen over the field.** Easier, but it is the pause-screen feel the owner doesn't want,
   and the glide is lost.
3. **The skipped plays at very high speed.** The most literal fast-forward, but a long gap is unreadable flicker, the
   reason the first highlights design turned it down.

## Decided

- Option C from the conversation: motion and a one-line catch-up, with the game clock ticking.
- Timing B: shorter at faster speeds with a minimum. The owner wondered about dropping it at 8×. The 0.8 s floor keeps
  8× from sliding back to today's blink, and it is one number to tune.
- A centred, compact card, with the field dimmed and greyed behind it.
- Every gap gets the beat. Stepping by hand stays instant. Pausing ends the beat at once.

Settled while writing this up (calls made for the owner to check):

- The clock counts to the next highlight's snap, not the landed play's, so it never jumps twice.
- The score is up to date from the start of the beat, so the card and the scorebug agree.
- A gap that ends the game or the half drops the "Ball on" line; the beat then the card, as before.
- After a pause mid-beat, Play goes on to the next highlight. ▶▶ or ◀◀ mid-beat ends it like a pause.

## Left to the builder

- Where the beat's timer lives (the fields already own the still landing's delay and call `onDone`, so stretching that
  delay to the beat's length is the obvious seat) and how the card learns the beat started and ended (a new prop on
  `GameMoments`, or a moment kind).
- How the scorebug gets the ticking clock (a prop override while the beat runs, for example).
- The exact dim, the card's size on a phone and desktop, and the fade length. The icon is `forward` in `ui/icons.tsx`
  (already there, the replay's ▶▶).
- The test list. At least: the beat's length at each speed, the summary line for each case above, the clock across a
  quarter and into overtime, and the screen contract in `ui/ui.test.ts`.

## Shipping

- One pull request. Screens only: nothing in the engine or the save.
- Per CLAUDE.md, UI work runs `npm run typecheck` and the tests it touches, `npm run copy` for the new text, then CI.
- Screenshots of the card in both views at 1× and 8×, light and dark, on a phone and desktop, for the owner to judge the
  dim (`npm run screens`).
- Not an MVP item: bump the patch number in `package.json` and add a `src/ui/changelog.ts` entry, per
  `docs/VERSIONING.md`.
