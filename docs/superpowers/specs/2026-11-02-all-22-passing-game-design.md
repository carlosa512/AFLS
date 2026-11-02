# All-22, Pass A: the passing game and the loose ball

Date: 2026-11-02 · Builds on the All-22 view (`2026-10-31-all-22-view-design.md`) · Pass A of two: Pass B (the run
game and the open field) gets its own spec once this ships.

## Why

All-22 shows who did what, but not yet how. A target runs two straight legs to the catch while the other receivers
each pick one of four routes on their own; the quarterback stands still in the pocket until he throws; a sack is a
frozen quarterback slid to the spot; and a lost fumble is staged as the ball carrier running on to where the defense's
return ended, sometimes twenty yards backwards. The owner's bar: **it should read like real All-22 film**, the look of
NFL Next Gen Stats' play animations, where you can watch the route break, the pocket move and the ball come loose.

## Decisions (agreed with the owner)

1. **Staged, not simulated, as before** (approach 1 of three). The players a play is about get richer scripted paths;
   everyone else keeps steering, with smarter goals. Every play still ends exactly where the engine says, with the
   engine's passer, target, cover man, rusher, tackler and recoverer, and the same play always stages the same way.
   Rejected: physics for every dot (can't guarantee the engine's spots; a rewrite) and real tracking clips warped onto
   plays (the NFL's tracking data can't ship in a game; it sets our numbers instead).
2. **The engine writes down what it already decides** (owner's answer A), never a new draw. Pass A needs one new fact:
   where a lost fumble came out (§1).
3. **Routes show by movement alone.** No route lines on the field for now; route lines become a toggle once there's a
   settings screen to hold it (out of scope).
4. **Routes run as concepts:** the target's route fits his catch, and the rest of the pattern fits around it (§3).
5. **Numbers from the NFL's tracking data** (Next Gen Stats and public tracking studies, §6), held by a new check,
   `npm run film` (§7).
6. **The pre-snap look is done** (0.2.42: the line holds still before the snap; shifts set a full second; a jet runs
   flat into the snap). A jet sweep's handoff belongs to Pass B.

**Out of scope, for Pass B:** blocking by run type (zone steps, pulling guards, power), ball carriers' cuts, jukes and
spins, missed tackles and run-overs (the engine records its broken tackles and whether size won the hit), a jet
sweep's handoff carrying the motion's speed. **Not planned:** route lines (until settings exist), any change to the
engine's outcomes, play calling.

## 1. Data: where the ball came out

The engine already records almost everything the passing game needs (`PlayLogEntry.who`, `actorsIn`):

| What the view needs                  | Where it comes from                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Pressure without a sack, and by whom | `who.rush` on a pass, incompletion or interception                               |
| A scramble under pressure, or not    | `who.rush` present (pressured) or absent (nothing open) on a scramble            |
| The sacker and the blocker he beat   | `who.rush`, `who.beat` on a sack                                                 |
| The target, cover man, interceptor   | `who.ball`, `who.cover`, `who.take`                                              |
| Throw depth and side                 | `air`, `lane`; `air` behind the line of scrimmage is a screen                    |
| A throwaway, a designed shot         | the text (`throws it away`, `Designed shot:`), read the way `playLabel` reads it |
| A fumble the offense kept            | the text (`Fumble, recovered by the offense`); it ends where it came out (`to`)  |

**New:** `PlayLogEntry.loose?: number`, the field x where the ball came out on a **lost** fumble (a run, a catch, or a
strip-sack). Today the log keeps only the return's end (`to = spot − returnYds`), so the fumble spot is gone.
`ranAnim` writes it from `result.turnover.spot` (through `fieldX`, like `from` and `to`); `ran` (a snap a flag wiped
out) carries it too. Nothing is drawn: the engine already has the spot.

- **Save:** bump `SAVE_VERSION` to 78 with a `migrate.ts` step that changes nothing (the field is optional).
- **Older games:** a lost fumble without `loose` is staged with the ball coming out at `to` and no return, which is
  still right about where the ball ended and who has it.
- **The engine stays untouched:** a game plays out identically with recording on and off (same score, same box
  score), and `npm run sim -- 10` locally shows nothing moved.

## 2. The quarterback and his protection (`pocket.ts`, `steer.ts`)

**The drop, by the throw's depth** (air yards past the line; numbers in §6):

| Throw                     | Under center                  | Shotgun (starts 5 yards deep)        |
| ------------------------- | ----------------------------- | ------------------------------------ |
| Quick (under ~6 air yards) | 3 steps, about 5 yards deep   | catch and throw, a step at most      |
| Intermediate (6–19)        | 5 steps, about 7 yards        | 2–3 steps back                       |
| Deep (20+), designed shot  | 7 steps or 5 and a hitch      | 3 steps and a hitch                  |

Under center or shotgun stays as `formations.ts` sets it today.

**In the pocket:**

- **Clean** (no rusher named): drop, a hitch, then a step up of a yard or two into the throw. The hold before the throw
  stays sized to the target's route (`stagedPath`), now with the drop's own length.
- **Pressured** (a rusher named, no sack): the pressure comes from that rusher's side. An edge rusher (or a man who
  beat a tackle) and the quarterback **climbs**, two or three yards up into the pocket; an interior rusher and he
  **slides** or rolls away from him. He throws from where he ends up, and the rusher arrives as the ball leaves (a hit
  on the throw, never a sack the engine didn't call).
- **Throwaway:** pressured, rolling toward the sideline, the ball sails past the nearest receiver and out of bounds
  (the broadcast view already throws an air-less incompletion at the sideline).
- **Scramble, pressured:** one escape move away from the named rusher (a step up and out, or a spin away from an edge
  rush), then he breaks out to the engine's `to`.
- **Scramble, nothing open** (no rusher named): he holds longer than a throw would, with a hitch or two, then runs
  through the lane the play went (`lane`).
- **Play action:** on first and second down, a fake to the back before the drop, more often for the offenses built
  on it (`OffenseScheme.playAction`) and never in a hurry-up; the back carries the fake into the line, then blocks or
  leaks out. Cosmetic and seeded.
- **Never past the line before a pass:** an illegal forward pass is a foul the engine didn't call.

**Protection** (steered):

- The line **sets a cup**: tackles kick back at an angle, two or three yards and a yard out; guards and center set a
  yard or so. Rushers engage at the cup's edge and push it toward the quarterback over the hold.
- **The beaten blocker** (`who.beat`) is beaten the way his man rushes: an edge rusher goes around his outside
  shoulder on an arc; an interior rusher drives him back into the pocket (a bull rush) or slips his shoulder.
- **The back** picks up a blitzer when the defense sent one, checks down by the concept (§3), or chips and releases.
  On a designed shot the tight end and back stay in (max protect).

**Sacks:**

- **Time to sack varies** by play, seeded within the NFL's spread (§6): quicker against a blitz or a man beaten off the
  snap, longer when nobody came open (the quarterback pumps, hitches, steps up and tries to slip out).
- The sacker comes past the man he beat, wraps the quarterback, and **both go down together at the engine's spot**
  (`to`). No frozen hold, no slide.
- **Strip-sack:** the ball comes out on the hit (§5).

## 3. Routes as concepts (`routes.ts`, `concepts.ts`)

**The target's route fits his catch.** From where he lined up, where the ball is caught (`air`, its side from `lane`)
and how deep, the view picks his route:

| Catch (past the line, relative to his alignment) | Routes                                                     |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Behind the line                                  | bubble or tunnel screen (receivers), swing or screen (back) |
| 0–4 yards                                        | flat, quick out (outside), drag or shallow (across), hitch  |
| 5–12 yards                                       | out or comeback (outside), curl or hitch (on his line), slant (inside, short), stick |
| 10–19 yards                                      | dig or in (inside), corner (outside), seam                  |
| 20+ yards                                        | go or fade (on his line), post (inside), corner (outside), wheel (back or slot) |

**The rest of the pattern fits around it.** A small book of concepts, each a route for every receiving spot (X, Z,
slot, tight end, back), seeded per play and leaned by the offense's scheme. The pick must contain the target's route
at his spot:

| Concept              | Routes                                                     | Leaned on by                 |
| -------------------- | ---------------------------------------------------------- | ---------------------------- |
| Smash                | outside hitch, inside corner                               | proStyle, westCoast          |
| Flood                | outside go, intermediate out, flat underneath              | proStyle, vertical           |
| Mesh                 | two shallow drags crossing, a sit over the ball, an outside go | airRaid                  |
| Four verticals       | every receiver deep (seams inside), the back checks down   | airRaid, vertical            |
| Curl-flat            | outside curl, flat                                         | westCoast, power             |
| Slant-flat           | outside slant, flat                                        | westCoast, spreadOption      |
| Stick                | stick (a 5–6 yard sit), flat, outside go                   | westCoast, spreadOption      |
| Dagger / Y-cross     | a seam to clear, a dig behind it, or the tight end's deep cross | vertical, proStyle      |
| Screen               | the screen with two blockers leading                       | spreadOption, westCoast      |
| Shot (designed)      | post and go, max protect                                   | vertical                     |

**Route shape.** A route is a stem, a break and a finish, worked out so the receiver reaches the catch spot as the
ball does:

- The **stem** runs upfield, leaning a little to set up the break (an out leans in first).
- The **break** is a plant: he drops to about 60% of his speed for a beat (numbers in §6), then comes out on the new
  angle. An out or an in is a hard 90°; a slant about 45° from the line; a post or corner about 45° upfield; a curl or
  comeback rounds back toward the ball; a go has no break, only a release and a lean.
- **Timing:** the pocket's hold already waits for the route (`stagedPath`); a route that can't make the catch time at
  a receiver's pace gets a shorter stem, never a dot faster than his position's top speed.
- **After the catch:** as today, he turns upfield to the engine's `to`.

**Coverage reacts to the routes:**

- **Man:** the defender mirrors his receiver from his alignment and is a beat late out of each break, then closes.
- **Zone:** defenders sit at their landmarks (`steer.ts` today) and drive on the ball from the throw.
- **At the catch,** the cover man's distance follows the play: trailing on a completion, contested on an incompletion,
  jumping the route (leaving his spot as the ball is thrown) on an interception. Distances in §6.

**Screens:** the line sets for a beat, then two or three linemen release downfield toward the screen's side to lead
the catch while the rush runs past; a bubble's other receivers stalk the nearest defensive backs.

## 4. Who runs where, and how fast

- **Top speeds and acceleration by position** come from the tracking data (§6), replacing `SPEED` and `ACCEL` in
  `steer.ts` where they differ.
- **Scripted paths obey them too.** Keyframes stay straight lines between points (`sample`); a route's stem, plant
  and break are separate keyframes, so the slowdown at the break and the turn read without curves in the sampler.
- **No dot ever exceeds his position's top speed**, scripted or steered, outside a ball in the air.

## 5. The loose ball (`fumble.ts`, `ballPath.ts`), both views

- **The hit:** at the tackle (a run or a catch) or the sacker's contact (a strip-sack), the ball comes out at `loose`
  (the ball carrier's spot across the field at that moment).
- **The bounce:** a few short, low hops, seeded in direction, a few yards in all (§6), while the nearest men from both
  sides converge on it.
- **The recovery:** the engine's recoverer (`who.take`) falls on it or scoops it. If the play ends somewhere else
  (`to ≠ loose`), he returns it to `to`; the nearest offensive player brings him down unless it's a touchdown.
- **Kept by the offense:** the same bounce, and the nearest offensive man falls on it at `to` (the engine names
  no one, so the view picks him the same way every time).
- **The man who fumbled** goes down at the hit with his tackler: no running on.
- **The broadcast view** shares the fix through `buildPath`: carried to the fumble spot, the bounce, then the return.

## 6. The numbers (from the NFL's tracking data)

Filled from the research (sources listed at the end of this section): time to throw, time to pressure, time to sack,
drop depths, separation at the target, route break timing and speed, top speeds and acceleration by position, play
action and pressure rates, fumble bounce distance.

## 7. Testing

**Rules every staged play follows** (unit tests across thousands of plays from simulated games, as `stage.test.ts`
does today):

- It ends where the engine says: the ball at `to` (or `from` on an incompletion), the tackler on the carrier, a sack on
  its spot.
- **Routes:** the target's route ends at the catch; its family fits the catch (§3's table, so a 25-yard catch is never a
  curl); routes in one concept don't finish within two yards of each other.
- **The quarterback:** under pressure his distance from the named rusher grows until the throw; in a clean pocket he
  steps up before it; he never crosses the line before a pass.
- **Protection:** the line forms a cup around the quarterback by the time of the throw; on a sack the sacker comes
  past the blocker the engine named.
- **Fumbles:** the ball is at `loose` at the hit; the recoverer has it at the end; the man who fumbled never goes past
  where he lost it; a return ends at `to`.
- **Movement:** no dot faster than his position's top speed, acceleration within the tracking data's range, a
  receiver slower through his break than in his stem.
- **The same play stages the same way;** staging a play still takes a few milliseconds.

**The engine:** recording `loose` changes no game (same score and box score with recording on and off); an old save
migrates and loads.

**`npm run film`** (`scripts/film.ts`, a new check in `scripts/check.ts` and CI, run when `src/ui/stage/`,
`src/engine/match/` or `src/engine/playActors.ts` changes): stages every pass play from a couple of hundred games and
holds them to the ranges in §6 (average time to throw, time to pressure, time to sack, separation at the target for
completions and incompletions, top speeds by position, drop depths, pocket movement under pressure, the mix of
concepts and routes). It exits non-zero when a number leaves its range; a range is never loosened to get green.

**Eyes on it:** short screen recordings of each play type at phone and desktop widths (a clean deep shot, a pressured
pass, a throwaway, a sack, a strip-sack, a lost fumble with a return, a screen, an interception), attached to each
pull request for the owner to watch before it merges.

## 8. Build order

| PR  | Delivers                                                                                   | Local checks (CI runs the rest)                       |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| A1  | `loose` (save v78) and the loose ball in both views: the fumble bug fixed                  | engine record test, stage tests, `npm run sim -- 10`  |
| A2  | The pocket, protection and sacks (drops, climb and slide, escapes, play action, cup, strip-sacks); `npm run film` with its pocket numbers | stage tests, `npm run film` |
| A3  | Routes and concepts, coverage reacting to them, screens and throwaways; `film` adds routes, separation and speeds | stage tests, `npm run film` |

Each PR is usable on its own, bumps the last version number (`docs/VERSIONING.md`) with its changelog entry, and comes
with its screen recordings.
