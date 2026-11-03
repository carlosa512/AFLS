# The spatial engine, slice one: the open field

**Status:** design, approved in conversation 2026-11-03; awaiting the owner's review of this document.

## Why

All-22 replays are drawn backwards: the match engine decides a play in the abstract (how many yards, who tackles,
who missed) and the stager invents movement that ends there. Every rule we add to that movement ("nobody faster
than his legs", "the tackler never runs past the carrier and back", "no dead stops") opens a seam somewhere else,
because nothing on the film *causes* anything. Football Manager's 2D view reads true because its match engine is
spatial: the dots move, and the result comes from the movement.

The goal is **simulation depth** (`GAME_DESIGN.md` pillar 1, "every snap is resolved from individual matchups"):
a spatial engine whose results come from players moving on a field, so speed, angles, blocks and leverage decide
plays, and what you watch is what happened. This document is its first slice.

## Decisions (the owner's)

1. **Two sims.** AI-vs-AI games keep today's engine (`match/gameSim.ts`): calibrated, about 18 ms a game, a
   272-game season in about 5 s. The spatial engine runs **your games** and, later, any game you watch live.
   Re-watching an AI game that has already been played stays today's drawn replay.
2. **Parity matchup by matchup.** The same matchup must give the same results in both sims, not just the same
   league averages; otherwise your team's seasons would be played under different odds than everyone else's.
3. **The first slice is the open field:** from the moment the carrier has the ball in space to the whistle.
4. **Approach: an agent sim at the film's own frame rate.** Every player steps 20 times a second (0.05 s, the
   replay's `STEP`); the replay of a spatial play *is* the simulation, frame for frame.
5. **Hidden until parity passes.** It runs in the checks and behind a switch; it turns on for your games only when
   parity, film, audit and speed all pass.

## 1. The seam: who decides what

Today's engine keeps deciding everything up to "the carrier has the ball in space":

- **Run.** The call, the ball carrier and the line battle, rolled as today (`runPlay`: the normal roll on the line
  delta, the back's skill, the call, the quirks). A roll that stops the run at or behind the line (under 1 yard) is
  today's result, unchanged: the line decided it, and losses, stuffs and tackles for loss keep today's numbers.
  Otherwise the roll is recast as **the state at the line**: which front men are blocked and how long each block
  holds (`holdFor`), from the roll's distance above or below its mean (a clean hole holds longer). The back's
  press to the hole is staged as today; the spatial sim takes over as he reaches the line.
- **Pass.** The throw, the catch spot and the cover man's separation, as today. The spatial sim takes over at the
  catch (a completion only: incompletions and picks are unchanged; a pick's return is a later slice).
- **Kicks.** Kickoffs and punts: the kick, the hang time, the catch, as today. The spatial sim takes over at the
  catch for a return (not a touchback, a fair catch or a muff).

The spatial sim decides everything after: **the yards, who tackles, broken and missed tackles, out of bounds and
touchdowns.** Today's engine rolls for yards after the catch, run breakaways and return yardage are what it
replaces in these games.

What stays the engine's, at the moment the spatial sim says it happens:

- **Fumbles:** today's formula (`fumbleOdds`, ball security, the hitter), rolled at the tackle with the tackler the
  sim produced; the loose ball and its recovery are today's.
- **Injuries:** today's collision and snap rolls (`injuries.ts`), with the players the sim put in contact.
- **Penalties:** today's foul rolls; the sim doesn't model fouls.

The output is the **same `PlayResult`** today's engine produces: yards, the tackler, the text, stat lines
(tackles, tackles for loss, forced fumbles, rushing and receiving yards), touchdowns, and the clock, with the play
time from the sim. Downs, the clock, play-calling, box scores and stats pages don't change.

**Determinism.** The sim draws from its own seeded stream per play (`${seed}:${season}:${gameId}:field:${play}`),
never the game's stream, so turning it on for a play moves nothing else in the game, and a play re-runs identically
from the same inputs.

**Where it lives.** A new pure module, `src/engine/field/`: no DOM, no React, no `Math.random`, no UI imports
(the engine's rules). The starting state is built in the engine from the staging rules that already exist for
everything before the catch or the line (formations, blocking by the call, routes, coverage). The engine never
imports UI code, so the pieces the start needs move from `src/ui/stage/` into `src/engine/field/` (pure as they
already are) and the stager imports them from there. They're made **blind to the outcome**: they may read the call,
the catch spot, the coverage and the line state, never the yards or the tackler.

```ts
/** Everything the open field starts from: positions and motion at the moment of possession. */
interface FieldStart {
  t0: number; // seconds from the snap
  dir: 1 | -1; // the offense's direction
  yardLine: number; // the ball's x (0-100, offense's own goal line at 0 when dir is 1)
  carrier: number; // player id
  players: FieldPlayer[]; // all 22: id, side, role, x, y, vx, vy, skills, habits
  blocks: { blocker: number; defender: number; holdFor: number }[];
  clock: { outOfBounds: boolean }; // the situation wants him out (the two-minute drill, `coach.ts`)
}
/** What the open field decided. */
interface FieldResult {
  yards: number; // from the line of scrimmage, as `PlayResult.yards`
  tackler: number | null; // null on a touchdown or out of bounds untouched
  touchdown: boolean;
  outOfBounds: boolean;
  misses: { by: number; how: 'size' | 'move' }[]; // broken or missed tackles, in order
  duration: number; // seconds from t0 to the whistle
  frames: Float32Array; // x, y for each of the 22 at each 0.05 s step from t0
}
function runField(start: FieldStart, rng: Rng): FieldResult;
```

## 2. The agents and the contests

**Physics.** Every player has a top speed, an acceleration and a turn limit (sharper cuts at lower speed), and a
reaction delay. Fatigue (`tired`, condition) and weather (`weather.ts`'s levers) scale them as they scale play
today. Positions advance 0.05 s at a time; no player ever exceeds his own top speed, by construction, and nobody
leaves the field but the carrier going out of bounds.

**The carrier** re-reads the field every 0.25 s. He scores a fan of headings, from straight upfield to hard to
either side, by the ground he can gain before a free defender can reach him along it (blockers in the way count,
the sideline counts against). Awareness sets the noise on that read: better runners pick better lanes. He goes out
of bounds when the situation wants it (`clock.outOfBounds`) or when he's cornered, otherwise he stays in.

**Blockers** start from `blocks`: a blocked defender can't pursue until he sheds the block, a per-step roll of his
skill against the blocker's, no earlier than `holdFor` on a run's line blocks. Downfield, receivers and tight ends
take the nearest defender in the carrier's way.

**Defenders** take intercept angles on where the carrier is heading. Awareness sets the angle's quality (a poor one
overruns and must come back) and the reaction delay to a cut. Deep defenders keep leverage: in front of the
carrier, inside-out, giving ground rather than lunging, so a tackler who's in front stays in front.

**Contests.** When a free defender gets within reach (about a yard):

- **The carrier may try a move first** (juke, jump cut, spin, stiff arm, run-through: the shapes in
  `ui/stage/carrier.ts`, moved to the engine), chosen by his skills, his room and his habits.
- **The tackle** is a roll: open-field tackling against breaking tackles, adjusted for size (`sizeEdge`), the
  angle (head-on, from the side, from behind), the carrier's speed and a second man arriving (a gang tackle).
- **Outcomes:** a tackle, with yards after contact from strength, size and momentum; a broken tackle (the carrier
  is slowed); or a miss (the defender's momentum carries him on past and down, as a falling man).

**Ratings only through contests.** The sim reads players through `skill(player, contest)` (and size through
`size.ts`), never `player.ratings`, so the attribute registry's rule holds: every rating that counts has a job, and
`npm run audit` proves each moves the spatial results the right way. The mapping, as a starting point the plan
makes exact:

| Contest (existing)        | Spatial job                                          |
| ------------------------- | ---------------------------------------------------- |
| `longSpeed`, speed        | top speed                                            |
| agility                   | acceleration, turn limit                             |
| `afterCatch`, elusiveness | move choice and success                              |
| `breakTackles`, size      | breaking a tackle, yards after contact               |
| `tackling`                | tackle odds                                          |
| `pursuit`, awareness      | angle quality, reaction delay, the carrier's read    |

**Habits** (`OpenField.habits`, the quirks the engine already notes) become behaviour, as in the Pass B spec §3a:
a jump-cutter cuts, a run-east-west receiver wastes ground, an arm tackler is easier to break, a thumper stops
forward lean, a back who finishes forward gains the extra yard, and so on.

## 3. Parity and calibration

**`npm run parity`** (new). It collects thousands of real moments of possession from today's engine (runs past
the line, catches, returns), then resolves each both ways: today's engine's roll, and the spatial sim several times
on its own seeds. It fails (non-zero exit) when a number leaves its range.

- **League level:** yards after the catch (mean, 10+ and 20+ shares), runs past the line (yards a carry overall,
  10+ and 20+ runs, rushing touchdowns), return yards and 20+ and 40+ returns, missed tackles per touch, out of
  bounds, and the share of tackles by position (so tackle leaders stay right). Each within a stated tolerance of
  today's engine and inside today's NFL ranges.
- **Matchup level:** the same means and shares in bins of the carrier's skill × the defense's tackling and pursuit
  × the line state; every bin within tolerance, and the **slopes** match: a point of a skill moves results about as
  much in both sims.
- **Season level (the fairness proof):** one league played twice, your team on today's engine and then on the
  spatial sim, everything else the same; your team's wins and stat lines must land within the noise of repeated
  runs.

**Tuning.** A small set of knobs, each documented: the reaction delay scale, angle quality, base contest odds, move
success, yards after contact and the block-shed rate. A calibration script fits them against parity once; they're
then constants. Nothing is tuned per player or per team.

**Existing checks.** `npm run film` adds spatial plays to its rules (nobody faster than his legs, no dead stops, the
tackler never runs past the carrier). `npm run audit` measures each attribute's effect on spatial plays. A speed
budget, a median of 5 ms a play from possession to the whistle, fails CI past it. Checks of AI-only leagues
(`sim`, `careers`, `trades`, `offseason`…) don't run the spatial sim and don't change.

**The gate:** parity, film, audit and speed all green.

## 4. Rollout, replay and saves

**The switch.** A league setting, `League.settings.spatialField` (off by default, shown only as a developer toggle
on the settings screen), until the gate passes; then on by default for your team's games. The engine can run any game spatially (`simulateGame(..., { field: true })`),
so a future "watch an AI game live" screen can use it; that screen is a later piece of work.

**The replay.** For a spatial play, the viewer plays the sim's frames from possession on; before it, the same
staging as today. AI games, your games played with the switch off, and old saves keep today's drawn replay.

**Re-watching.** Ratings change over a season, so re-running a game later from today's players would play it
differently. Each spatial game stores a compact **snapshot**: for each player who took part, the contest values,
size and habits the sim read (a handful of numbers each), with the game's `FieldRecord`. The replay rebuilds
`FieldStart` from the play log, the field record and the snapshot, re-runs `runField` on the play's seed, and gets
the same frames every time. Storing every frame instead would cost about half a million numbers a game. The
snapshot is a change to `League`'s shape: `SAVE_VERSION` 81 → 82 with a `migrate.ts` step (older games have no
snapshot and use the drawn replay).

## 5. Testing

- **Unit tests (`src/engine/field/*.test.ts`):** physics invariants (top speed, acceleration, the turn limit, the
  field's bounds); the carrier's read (takes the open lane, keeps off the sideline unless the clock wants it, goes
  out when cornered); contest odds by skill, angle and gang tackles; each habit's behaviour; determinism (the same
  start and seed give the same frames); the snapshot's round trip (a saved game's replay equals what was played).
- **Integration:** a spatial game produces valid `PlayResult`s; downs, clock and box score add up; turning the
  switch on for one game moves nothing in other games.
- **Checks:** parity, film, audit and speed, as in §3.

## Out of scope (later slices, each with its own spec)

- Line play, the pocket and the rush, routes and coverage before the catch: they stay today's engine and staging.
- Interception and fumble returns.
- Spatial AI-vs-AI games, and a coarse spatial pass to run them.
- The "watch an AI game live" screen.

The order of the next slices is decided by what parity teaches us here.
