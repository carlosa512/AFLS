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

| Throw (air yards)                  | Under center                    | Shotgun (lined up about 5 yards deep) |
| ---------------------------------- | ------------------------------- | ------------------------------------- |
| Quick (under about 5)              | 1 step, or 3 (set 4–6 yards)    | catch and throw, a step at most       |
| Short to intermediate (about 5–12) | 3 or 5 steps, set 5–8 yards     | 1–3 steps                             |
| Intermediate (about 10–18)         | 5 steps, set 7–8 yards          | 3 steps                               |
| Deep (about 16+), a designed shot  | 7 steps (9+ yards), or 5 and a hitch | 5 steps, or 3 and a hitch        |

The bands overlap on purpose (a seeded pick within them): NFL quarterbacks throw 8 air yards on average off a 3-step
drop and 13 off a 7-step one, not one depth per drop (§6). Under center or shotgun stays as `formations.ts` sets it today.

**In the pocket:**

- **Clean** (no rusher named): drop, a hitch, then a step up of a yard or two into the throw. The hold before the throw
  stays sized to the target's route (`stagedPath`), now with the drop's own length.
- **Pressured** (a rusher named, no sack): the pressure comes from that rusher's side. Against an edge rusher (or a
  man who beat a tackle) the quarterback **climbs**, two or three yards up into the pocket; against an interior
  rusher he **slides** or rolls away from him. He throws from where he ends up, and the rusher arrives as the ball leaves (a hit
  on the throw, never a sack the engine didn't call).
- **Throwaway:** pressured, rolling toward the sideline, the ball sails past the nearest receiver and out of bounds
  (the broadcast view already throws an air-less incompletion at the sideline).
- **Scramble, pressured:** one escape move away from the named rusher (a step up and out, or a spin away from an edge
  rush), then he breaks out to the engine's `to`.
- **Scramble, nothing open** (no rusher named): he holds longer than a throw would, with a hitch or two, then runs
  through the lane the play went (`lane`).
- **Play action:** a fake to the back before the drop on about three early-down dropbacks in ten and almost never on
  third down (§6), more often for the offenses built on it (`OffenseScheme.playAction`) and never in a hurry-up; the
  back carries the fake into the line, then blocks or leaks out. Some play-action throws are **bootlegs**: the
  quarterback rolls out of the pocket the other way. With pressured rolls and scrambles, about one dropback in five
  leaves the pocket, as in the NFL. Cosmetic and seeded.
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

| Catch (air yards; side relative to his alignment) | Routes (the NFL's average air yards at the target, §6)                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Behind the line                                   | bubble or tunnel screen (−3), flat or swing for a back (about 0)         |
| 0–4 yards                                         | flat or quick out (outside), drag or shallow (across), hitch             |
| 3–9 yards, inside                                 | slant (6)                                                                |
| 4–14 yards                                        | hitch or curl (7), out (7, outside), stick, a crosser underneath (7)     |
| 10–18 yards                                       | dig or in (11, inside), comeback (outside), a deep crosser, wheel (14)   |
| 14 yards and more                                 | corner (21, outside), post (21, inside), go or fade (23, on his line)    |

Where bands overlap the pick is seeded, leaning on the route whose average is nearest the catch.

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
  jumping the route (leaving his spot as the ball is thrown) on an interception. Today's staging puts him 1.5 yards off a
  catch and 0.7 off an incompletion, well inside the NFL's 3.1 yards of separation at the target (§6): a completion
  gets about three and a half, an incompletion about two, an interception under one.

**Screens:** the line sets for a beat, then two or three linemen release downfield toward the screen's side to lead
the catch while the rush runs past; a bubble's other receivers stalk the nearest defensive backs.

## 4. Who runs where, and how fast

- **Top speeds and acceleration by position:** `SPEED` and `ACCEL` in `steer.ts` already sit inside the tracking
  data's ranges (§6) and stay.
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
- **Kept by the offense:** the same bounce, and the nearest offensive man (often the one who fumbled) falls on it at
  `to` (the engine names no one, so the view picks him the same way every time).
- **The man who fumbled** goes down at the hit with his tackler: no running on.
- **The broadcast view** shares the fix through `buildPath`: carried to the fumble spot, the bounce, then the return.

## 6. The numbers (from the NFL's tracking data)

What the staging aims at, and the range `npm run film` holds it to. Where no public number exists, the target is ours
and says so. Sources are the bracketed keys below the tables; "computed" means worked out from nflverse's public files
(Next Gen Stats, play-by-play with participation, FTN charting).

**The quarterback**

| Measure                                   | NFL                                                                  | Film range                 |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Time to throw, snap to release            | 2.82 s (NGS, 2024); per play 2.63 mean, 2.5 median, 1.6–3.9 p10–p90 [N][P] | mean 2.45–2.95 s      |
| Shotgun against under center              | 2.55 against 3.05 s (2024) [P]                                       | under center 0.25 s+ longer |
| Clean against pressured                   | 2.42 against 3.27 s (2024) [P]                                       | pressured 0.5 s+ longer    |
| By air yards: behind, 0–4, 5–9, 10–19, 20+ | 2.19, 2.62, 2.58, 3.12, 3.37 s (2022) [P]                           | each within 0.35 s         |
| Time to pressure                          | 2.9 s average (NGS, 2023) [PP]                                       | 2.4–3.3 s                  |
| Time to sack                              | mean 3.35, median 2.9, p10 2.1, p90 5.3 s (2023–25, computed) [P]    | mean 3.0–3.7; p10 ≤ 2.4; p90 ≥ 4.5 |
| A scramble with nothing open              | leaves the pocket about 4.4 s after the snap (2023–25; the field's definition is uncertain) [P] | 3.5–5.0 s |
| Dropbacks leaving the pocket              | 17–21% (FTN, 2023–25, computed) [F]                                  | 14–24%                     |
| Play action                               | 22% of dropbacks; 30% on first and second down, 4–5% on third and fourth (FTN, 2023–25, computed) [F] | 17–27%; early downs 24–35% |
| Set depth by drop                         | 3 steps 4–6 yd, 5 steps 7–8, 7 steps 9+ (PFF) [D]                    | each within its band       |
| Air yards by drop, under center / gun     | 1 step 3.2 / 4.9; 3 steps 8.3 / 9.4; 5 steps 11.5 / 12.3; 7 steps 13.3 / 15.1 (2018–19) [SFA] | each within 2.5 yd |

**Receivers and coverage**

| Measure                                   | NFL                                                                  | Film range                 |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Separation at the target (catch or miss)  | 3.10 yd (WR 2.97, TE 3.53; NGS 2024, computed) [N]                   | mean 2.6–3.6; catches wider than misses; picks ≤ 1 |
| Cushion at the snap                       | 6.1 yd (p10–p90 5.3–6.9; NGS 2024) [N]                               | corners' mean 5–7 yd       |
| Air yards at the target, by route         | screen −2.8, flat −0.5, slant 6.1, curl 7.4, out 7.3, cross 6.9, dig 10.6, wheel 13.8, post 21.0, corner 21.3, go 23.4 (2022) [P] | each within 3 yd (5 for post, corner, go) |
| Time to throw, by route                   | screen 1.91, slant 2.14, curl 2.68, out 2.73, go 2.84, post 3.05, dig 3.12, corner 3.25 s (2022) [P] | screen < slant < curl, out < dig, post, corner |
| The break                                 | no public number                                                     | ours: a plant at 50–70% of stem speed for 0.15–0.25 s, about 0.4–0.7 s before the throw on a timing route |

**Speed and the rush**

| Measure                                   | NFL                                                                  | Film range                 |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Top speeds                                | fastest ball carriers 21–22.4 mph, 10.2–10.9 yd/s (NGS lists, 2022–24) [NBC][FOX]; all-star GPS: OL 12.6 mph, DL 15–19, LB 20, CB 19.5–21, RB 21 [SB] | position caps as `steer.ts` (OL 6.5 yd/s … DB, WR 9); nobody past 10.5 |
| Acceleration                              | skill players about 5 yd/s² at most (all-star GPS; a weak source) [SH] | ≤ 6 yd/s² (`ACCEL`); a plant may stop harder |
| Rushers                                   | 4 on 64–69% of dropbacks, 5 on about 20%, 6+ on 5–6% (2022, 2024, computed) [P] | reported (the engine's blitz call decides) |
| Pressure, sacks, scrambles, screens, throwaways | pressured 26–31%, sacks 6.4–6.8%, scrambles 4.5–5.5%, screens 8–10%, throwaways 3.5% of dropbacks [P][B][F] | reported only: the engine decides these |

**The loose ball**

| Measure                                   | NFL                                                                  | Film range                 |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Who recovers, returns                     | offense 51% (runs 56%, catches 46%, sacks 48%); 29% of defensive recoveries returned, 14.8 yd average (2022–25, computed) [B] | reported only: the engine decides |
| How far it bounces                        | no public number                                                     | ours: 2–6 yards over about a second |

**Sources:** [N] nflverse Next Gen Stats (github.com/nflverse/nflverse-data, release `nextgen_stats`); [P] nflverse
play-by-play with participation (release `pbp_participation`); [B] nflverse play-by-play (release `pbp`); [F] FTN
charting via nflverse (release `ftn_charting`); [PP] NFL.com, "Next Gen Stats: introduction to pressure probability";
[D] PFF, "QBs in focus: drop-back depth"; [SFA] Sharp Football Analysis, "How drop depth affects our view of
quarterbacks"; [NBC] NBC Sports Bay Area, fastest players of 2022 by Next Gen Stats; [FOX] FOX Sports, fastest NFL
players of 2023; [SB] Seahawks Draft Blog, Senior Bowl GPS speeds; [SH] a Shrine Game GPS note (weak; the acceleration
cap is ours to keep).

## 7. Testing

**Rules every staged play follows** (unit tests across thousands of plays from simulated games, as `stage.test.ts`
does today):

- It ends where the engine says: the ball at `to` (or `from` on an incompletion), the tackler on the carrier, a sack on
  its spot.
- **Routes:** the target's route ends at the catch; its family fits the catch (§3's table, so a 25-yard catch is never a
  curl); routes in one concept don't finish within two yards of each other.
- **The quarterback:** under pressure his distance from the named rusher grows until the throw; in a clean pocket
  (not a bootleg) he steps up before it; he never crosses the line before a pass.
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
