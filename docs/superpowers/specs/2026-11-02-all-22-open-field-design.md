# All-22, Pass B: the run game and the open field

Date: 2026-11-02 · Builds on Pass A (`2026-11-02-all-22-passing-game-design.md`) and the no-teleport work (0.3.1) ·
The second and last of the two passes.

## Why

Pass A made the passing game read like film. The run game and the open field still don't:

- **The line blocks the same way on every run.** There are no zone steps, no pulling guard and no second level, so a
  free defender is often left standing in plain sight.
- **The back runs a smooth curve** from the mesh to the tackle. There's no press, no cut and no read.
- **A missed tackle has no shape.** The engine decides who missed and why, but All-22 can't show it, so a defender
  with a good angle just doesn't make the play.

The owner's bar is the same as before: it should read like All-22 film, and like Football Manager's dots, where you
can tell a man made a move from the way he moves.

## Decisions (agreed with the owner)

1. **Staged, not simulated** (approach 1, as in Pass A). The engine decides; the film tells what it decided. Rejected:
   inferring moves from yardage alone (they'd be guesses, sometimes the wrong kind), and simulating (can't hold the
   engine's spots, and a GM game doesn't need it).
2. **The engine writes down what it already decides**, never a new draw (§1). Results don't change.
3. **Everything at once:** designed runs, catches-and-runs and returns, in one PR built in internal phases (§8).
4. **Paths only.** No shrinking dots or markers for a man on the ground: a move, a miss and a run-over are told by how
   the dots move, subtle, the FM way.
5. **Still holds from 0.3.1:**
   - nobody moves faster than his legs, apart from the tackler's capped closing sprint;
   - a man who misses carries on past and goes down, never freezing;
   - most tackles come at an angle and run-downs stay the exception;
   - rings show at the moment.

**Out of scope:**
- route lines (until there's a settings screen);
- any change to the engine's outcomes, play calling or the broadcast view;
- tracking every defender's missed tackle (the engine decides one broken tackle on a run, §1, and the view shows that
  one).

## 1. Data: what the engine decides on a run and after a catch

What the log already has:

| What the view needs               | Where it comes from                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| The carrier, the tackler          | `who.ball` (the runner on a run), `who.tackle`                                      |
| The run's direction, inside or out | the text (`up the middle`, `left guard`, `right tackle`; `left end`, `right end` are the outside calls) and `lane` |
| The gain, a touchdown             | `from`, `to`, the text                                                              |
| A return's length, a return TD    | the kick's `to` and the text (the engine rolls only the yardage and the rare TD)    |

**New:** `PlayLogEntry.open?: OpenField`, written only when it says something:

```ts
interface OpenField {
  /** An inside call the back took to the edge (`bouncesExternal`). */
  bounce?: 1;
  /** The tackle he broke: who missed, and how the engine broke it. */
  broke?: { by: number; how: 'size' | 'move' };
  /** He got past the deep safety (the engine's breakaway roll). */
  gone?: 1;
  /** He fell forward for the extra yard (`finishesForward`). */
  forward?: 1;
}
```

**On a run** (`runPlay`):
- `bounce` is the `bounce` roll.
- `broke` is the `pBreak` roll against the best linebacker, `by` being that linebacker. `how` is `size` when the size
  edge (`contact`) was in the back's favour, and `move` otherwise.
- `gone` is the second breakaway roll (past the safety).
- `forward` is the `finishesForward` yard.

**After a catch:**
- `broke` is the yards-after-catch breakaway roll (`yac += exponential(22)`). `by` is the man who'd have made the tackle
  (`tackler` there), with `how` from the sign of `sizeEdge(receiver, 'contact', tackler)`.

**Returns** decide only the yardage, so they get no `open`. A long return is staged as a lane and a race (§5), never
an invented broken tackle.

**Save and compatibility:**
- **Save:** `SAVE_VERSION` 81, with a `migrate.ts` step that changes nothing (the field is optional). `ran`, the play a
  flag wiped out, carries it too.
- **Older games:** with no `open`, a run is staged with the blocking and the back's press and cut (§2, §3) but no
  moves.
- **The engine stays untouched:** a game plays out the same with recording on and off (same score and box score,
  unit-tested), and `npm run sim -- 10` locally shows nothing moved.

## 2. Blocking by the call (`steer.ts`, a new `runBlocks.ts`)

The call comes from the direction (§1): an end run is outside, a tackle, guard or middle run is inside, and a bounce
is an inside call that ends outside. The offense's scheme leans the inside calls (power and gap teams pull more).

- **Outside zone (end runs):**
  - The line steps together toward the play side, each man taking the defender in his play-side gap.
  - Backside men cut off.
  - The tight end or slot seals the edge, and a receiver stalks his corner.
- **Inside zone (middle, guard):**
  - A shorter lateral step.
  - Double teams on the nose or 3-technique, one man climbing off to a linebacker about a second after the handoff
    (today's `climbs`, now aimed).
- **Gap / power (tackle runs, and inside runs for gap teams):**
  - Down blocks toward the hole.
  - The backside guard pulls behind the line and leads through it.
  - On some power calls the back or tight end kicks out the end.
- **The free man:** after the assignments, any defender left unblocked who could reach the hole before the back gets a
  blocker if one can get to him first: the puller, the climbing lineman, the lead back, a stalking receiver. If nobody
  can:
  - he's the engine's tackler (who makes the play);
  - or the man who missed (`open.broke.by`, who meets the back at his move);
  - or, if he's neither, he takes a pursuit angle that arrives a step late. He's never standing there unblocked and
    doing nothing.
- **Never blocked before his moment:** the tackler and the man who misses.

## 3. The ball carrier (`scripts.ts`, a new `carrier.ts`)

A run is staged in beats, each timed so the whole thing still ends at the engine's spot and time:

1. **Mesh:** as today. A jet sweep keeps the motion's speed through the handoff, with no pause at the mesh.
2. **Press:** he aims at the called hole for a few steps and reaches the line about 2.8 s after the snap (NGS, §6). A
   zone back's aiming point drifts with the line's flow.
3. **Plant and cut:** one sharp lateral step at the hole, a yard or two, his speed dipping and then building again.
   A bounce is a harder cut to the edge.
4. **The broken tackle** (`open.broke`), against the man who missed, where they meet:
   - **move:** a juke (one sharp side-step as the defender commits to where he was), a jump cut (a quick two-yard
     lateral hop at low speed, for a `jumpCutter`), or a spin (a tight half-loop through the contact point, his
     speed dipping to a jog). The stager picks among them by the back's habits, seeded.
   - **size:** a run-through or a stiff arm. The back slows for a beat at contact and the defender is driven back a
     yard or two, off his line, then goes down.
   - The defender carries on past and goes down, as in 0.3.1.
5. **The breakaway** (`open.gone`): the deep safety's angle arrives a step late, and the back runs away from it.
6. **The finish:**
   - **Tackled:** the tackler meets him at an angle, or runs him down when he's well behind (0.3.1).
   - **`forward`:** the last yard is a lunge forward through the hit.
   - **Out of bounds:** he angles to the sideline.

With no `broke`, nobody misses him visibly: the gain is the line's and his cut's, and the tackle comes at the end.

## 4. After the catch

- **The catch:** he turns upfield in a step (a hitch or curl turns back first; a crosser is already running).
- **`open.broke`:** the same moves as §3, against the man who'd have made the tackle.
- **No `broke`:** he runs to the tackle at an angle, as today.
- **A screen:** keeps its blockers in front of him (Pass A), now with the free-man rule (§2).

## 5. Returns

- **The return's shape:** the return team sets a wall or a lane on the side the return goes, blocking the cover men
  nearest it.
- **The returner:** he takes the ball, presses the lane, cuts upfield and runs.
- **A long return:** the coverage's angles arrive late (speed, no invented misses).
- **A return touchdown:** the kicker or the last man takes the last angle, a step short.
- **Kickoffs:** coverage still waits for the ball to come down (0.3.1).

## 6. Numbers

| Measure                                  | Target                                    | Source                                                 |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| A back's time to the line                | 2.78 s, range 2.5–3.1                     | NFL Next Gen Stats, RBs 2022–24 (`avg_time_to_los`)    |
| Where runs go                            | about a quarter each: middle, guard, tackle, end | nflverse play-by-play 2022–24 (`run_gap`)       |
| Yards before first contact on a run      | about half the gain, roughly 1.3–2.6 a carry | NFL leaders 2.5–3.5, worst team 0.9 (FantasyPoints, FanDuel Research, Steelers Depot; no clean league average found) |
| Broken tackles shown                     | exactly the engine's: one move per `broke` | the engine (`open`)                                   |
| Missed tackles per touch                 | reported, not judged: the engine sets it   | SIS about 0.18 per RB touch (FantasyPros, 2021)       |
| Nobody faster than his legs              | as 0.3.1                                   | the stage test                                        |
| A defender stopping dead in the open     | under 1 per 50 plays                       | the stop counter from 0.3.1's work: from 5+ yd/s to under 1.2 within 0.3 s, nobody within 2.2 yards |

## 7. Checks

- **`npm run film`** gains a run section with the rows above, each judged against its range:
  - a back's time to the line;
  - yards before contact;
  - the move mix (juke, jump cut, spin, run-through; reported);
  - dead stops in the open.
- **Stage tests:**
  - every `broke` is staged as a move against `broke.by`, and no move shows without one;
  - a `size` break moves the defender back off his line;
  - a run reaches the line between 2.3 and 3.5 s;
  - no unblocked defender stands still within 5 yards of the hole while the back goes through it;
  - a pulling guard crosses behind the line, never through it;
  - returns never stage a missed tackle;
  - a `gone` run's safety never gets within a yard before the tackle.
- **Engine test:** recording `open` changes nothing (the same game with and without it).

## 8. Delivery

One PR, version 0.3.2, built in internal phases, each with its tests green before the next:

1. **B1, the record:** `open` on runs and catches, save v81, the engine-unchanged test.
2. **B2, blocking:** the three calls, the puller, climbing, and the free-man rule (§2).
3. **B3, the carrier:** press, cut, moves, the breakaway and the finish (§3). A jet sweep at speed.
4. **B4, after the catch and returns:** §4, §5.
5. **B5, the film section:** clips (a run with each move, a long return), and the changelog entry.
