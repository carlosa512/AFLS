# The spatial engine, slice two: the pocket (and the clock and ends in the viewer)

**Status:** written for the owner's review, 2026-11-04. Next: the implementation plan (superpowers:writing-plans).

## Why

Slice one (`docs/superpowers/specs/2026-11-03-spatial-open-field-design.md`, shipped in #144 and #145) put the open
field on a real field: a run past the line, a catch, a return or a turnover plays out with bodies, reads, angles and
contests, and today's roll still decides the result (the owner's call H). The pocket is still drawn backwards. Today's
engine rolls pressure, a sack, a scramble or a throwaway in the abstract, and the stager scripts one rusher to arrive
while the other linemen mostly stand where they lined up. This slice puts the line, the rush and the quarterback's
movement on the field, the same way.

It also fixes two things the owner saw in the viewer: the game clock shows each play's starting time and never
moves, and teams never switch ends.

## Decisions (the owner's)

1. **Today's rolls decide; the field plays out how (call H, as slice one).** Clean pocket, pressure, sack, scramble
   or throwaway, the sack's yards and the throw are today's. The field decides who got home, which blocker lost, when,
   and how the quarterback moved.
2. **Every dropback** in your games with the switch on, play action and bootlegs included. Screens, spikes, kneels and
   designed runs are not dropbacks.
3. **Matchups anchored to today's result** (of three approaches: this one, a physical film of today's script that
   decides nothing new, or free matchups re-rolled until they match today's, which is slow and unbounded).
4. **The game clock ticks in the playback**, stopping where the game's clock stops. No separate play clock.
5. **Teams switch ends every quarter** in the viewer.
6. **Timeouts stop the clock in the playback and show on the scorebug.**

## 1. The seam: who decides what

**Today's engine, unchanged.** Every dropback rolls what it rolls today, in today's order: pressure or not
(`passPlay`), a sack, a scramble, a throwaway, the throw. Today's sacker pick (`sack`, the game's stream) and blocker
blame (`creditPressure`, the credit stream) are still drawn, so the game's dice never shift. With the switch on, the
game credits the field's sacker and beaten blocker instead.

**The field decides** (its own stream per play, `${seed}:field:${index}:pocket`, told today's outcome):

- which rusher got home: sacks, pressures and hits are credited to him;
- which blocker lost him: sacks and pressures allowed;
- when: a sack's play time follows the film (§4);
- how the quarterback moved, and on a scramble, where he broke out.

**Today's, as rolled:** whether it was clean, pressure, a sack, a scramble (or an escape, when nothing came open) or a
throwaway; the sack's yards and fumble; the scramble's yards, touchdown, slide or out of bounds; the throw and everything
after it. Whether a pressure is a hit, and whether a sack or pressure is charged to nobody (the coverage held or he held
the ball), are rolled at today's odds (`QB_HIT_SHARE`, `UNBLAMED_SACK`, `UNBLAMED_PRESSURE`) on the play's own streams
before the pocket runs; today's credit-stream draws are still taken in their place, so the game's dice never shift.

**Where it starts and stops.** At the snap. It ends when the ball is out, the sack lands, or the quarterback crosses
the line on a scramble. A catch's open field (slice one) then starts from where the pocket left everyone. A
scramble's open field plays it as a run from where he crosses the line, to today's yards. Out of bounds or a slide
credits no tackle (out of bounds is out of bounds, #145; a slide is a man giving himself up).

**Who it moves.** The five linemen, any back or tight end kept in to block, every rusher and the quarterback.
Receivers and coverage keep the stager's routes until the routes slice.

**AI games, the switch off and the tap alone** keep today's game exactly (the same rule and tests as slice one).

## 2. The trenches

**Matchups at the snap.** Protection follows the scheme's spots, the same assignments that today charge a blocker
(`blockerFor`): the right end takes the left tackle, the inside rushers take the guards and the center. A lineman with
nobody across from him helps the nearest inside man (a double team). On a blitz a back or tight end kept in picks up
the free man; when nobody can, the rusher comes free.

**A rep.** Each step, a rusher has a small chance to beat his man: edge or interior rush (`edgeRush`,
`interiorRush`) against pass protection (`passPro`), plus today's size edges (`rushSizeEdge`, `massEdge`). A double
team cuts it sharply. Habits shape it:

- `bullRush` drives his man back: the pocket shrinks instead of the rep being won;
- `anchor` gives ground slower against it;
- `heavyPunch` delays the first win;
- `bendsArc` wins the corner sooner;
- `twoTapSet` loses to speed sooner;
- `losesContainment` leaves a lane outside him for a scramble.

**Today's outcome steers who wins and when** (the anchor, as slice one's credited spot):

- **Clean pocket:** a rep that would be won is held off until the ball is out. The pocket can still be pushed back.
- **Pressure:** the first rep won in time reaches him as he throws: on him for a hit, a step short for a hurry. If none
  has been won by `PRESSURE_REACT` (0.9 s) before the throw, the rep with the highest win chance wins then.
- **Sack:** a sack time is drawn from the NFL's spread (`sackTime` in `pocket.ts`: median 2.9 s, a tenth past 5.3,
  a blitz quicker). The sacker is the first rusher whose rep is won early enough for him to reach the quarterback by
  then. If none is, the rep with the highest win chance is won just in time for its rusher to get there. The
  quarterback tries to get away and is caught. An unblamed sack (the coverage held, or he held the ball) charges no
  blocker; its time is the NFL's spread like any sack's, which already holds the coverage sacks.
- **Scramble:** pressure arrives as the stager times it (`pocket.ts`: 2.4–3.2 s under pressure, 3.2–4.4 s when nothing
  comes open), and he breaks out away from it, through the lane the rush left, then across the line.
- **Throwaway:** pressure arrives, and he rolls out and throws it away.

**The quarterback.** He sets at the stager's drop depth (`pocketPlan`: the drop by the throw, play action, the
bootleg), steps up into a clean pocket, slides away from an edge rusher and climbs when the rush goes around him.
Pocket presence (`pocketPresence`) sets how early he feels it and how cleanly he moves. `muddyPockets` drifts;
`bailsEarly` breaks out sooner.

**Bodies.** Slice one's: top speed, acceleration and turning (`body.ts`). An engaged blocker gives ground at the
rusher's pace, and nobody passes through anyone.

**Where it lives.** A new pure module, `src/engine/field/pocketField.ts` (`runPocket`), beside the open field.
`pocket.ts` stays the stager's plan (drops, times) that both the drawn film and the field read. Knobs go in
`tuning.ts`, fitted by `npm run parity-fit`.

## 3. The film, the replay and saves

**One film per play.** Before the snap, today's staging. From the snap, the pocket's frames for the men it moves;
receivers and coverage on their drawn routes; the ball's flight drawn as today. At a catch or a scramble the open
field starts from the pocket's last frame: the approach (`approach.ts`) reads the pocket's frames for those men
instead of its own staging, so nobody jumps when the film hands over.

**What the log keeps.**

- The play's field facts (`FieldFacts`) gain the pocket outcome today rolled (`clean`, `pressure`, `hit`, `sack`,
  `scramble`, `escape`, `away`) and whether it was unblamed.
- The field's sacker and beaten blocker go where the log already keeps them (`who.rush`, `who.beat`).
- The snapshot's skills (`FieldSkills`) gain pass rush, pass protection, pocket presence and scrambling.
- A replay re-runs the pocket from these and gets the same frames. A replay whose sacker would differ from the box
  score falls back to the drawn film (`FIELD_VERSION`, as after a refit).

**Saves.** `SAVE_VERSION` 87: the facts and skills gain optional fields, with nothing to rewrite. `FIELD_VERSION` 7.
Games played earlier keep their drawn pocket.

**The clock.** A sack's whistle comes at the field's sack time plus a fitted pad (`padSack`, as `padCatch`). A
scramble's clock runs on into its open field's. Throws are unchanged.

**Speed.** About three seconds and a dozen bodies, cheaper than an open field. It counts in the same budget (a median
of 5 ms a play).

## 4. The clock and the ends in the viewer

These are viewer changes (`src/ui/screens/GameViewer.tsx`, `TopDownField.tsx`). The sim and the saves don't change.

**The game clock ticks.** From the snap the scorebug counts down with the film: one game second per second at 1×,
faster at 2× and 4×. At the whistle:

- **The clock stopped** (an incompletion, out of bounds, a score, a change of possession, a timeout): it holds.
- **The clock kept running:** it keeps counting through the break down to the next snap's time, so you see the huddle
  burn clock instead of a jump.

Which one is read from the log: if the next snap's clock is within two seconds of where the whistle left it, the clock
stopped; otherwise it ran. It never counts below the next snap's time, nor below 0:00 at a quarter's end. There is no
separate play clock.

**Timeouts.** A timeout entry stops a running clock at the timeout's time, held until the next snap. The scorebug
shows each team's timeouts left as three marks, one dimming as it's used, read from the log's "(n left)". Back to
three at halftime; overtime's count is whatever the log records (the engine gives two each in a regular-season
overtime).

**Teams switch ends.** Q1 and Q3 are drawn as now; Q2 and Q4 are drawn turned end to end (x → 100 − x, y → width − y,
so each team's left and right stay its own). A drive across a quarter break shows the ball at the same yard line at
the other end. Overtime is drawn as Q1. Both views turn: the field, the end zones and their names, every player and
the ball. The play log's coordinates don't change; only how they're drawn.

## 5. Parity and checks

**`npm run parity`** gains pocket rows, each the field against today's engine on the same dropbacks:

- sacks by group (edge, interior line, linebackers, secondary): the field's shares against today's credit;
- sacks and pressures allowed by spot (tackles, guards, center, backs and tight ends): against today's blame;
- a rusher's share of his team's sacks against his rush skill: the field's slope against today's (0.6–1.5);
- a blocker's sacks allowed against his pass protection: the same;
- seconds from the snap to a sack: median and 90th percentile against the NFL's (2.9 s and 5.3 s);
- seconds from the snap to the whistle on sacks: against today's;
- the season rows (your team on each engine) and the speed budget, as now.

Rows that today's roll decides (sacks a game, pressure rate, scrambles, throwaways) match by construction and are
reported, not judged.

**`npm run film`** adds the pocket to its spatial rules: nobody faster than his legs; no man through another (an
engaged pair never closer than half a yard); the quarterback never past the line before a scramble crosses it; no
jump where the pocket hands over to the open field.

**The gate:** parity, film and speed green; the viewer's tests green.

## 6. Testing

- **The pocket (`pocketField.test.ts`):** matchups by the scheme's spots, a double team and a free blitzer; a better
  rusher wins sooner; each outcome lands as told (a clean pocket holds to the throw; a pressure arrives at the throw; a
  sack lands at its time with a rusher on him; a scramble breaks out away from the pressure); each habit moves its rep
  the right way; the same start and seed give the same frames.
- **The engine:** with the switch on, a dropback's credits are valid (the sacker is a defender on the field, the
  blocker one of the five or a back or tight end kept in); downs, clock and box score add up; the switch off and the
  tap alone leave the game as today's; a scramble's open field ends at today's yards with no tackle on a slide or out of
  bounds.
- **The replay:** a pocket replays exactly as it was played; the catch's open field starts where the pocket ended
  (no jump); a save round trip replays the same; an older field version falls back to the drawn film.
- **The viewer:** the scorebug's clock at a few moments of a running play, a stopped play and a timeout; timeouts left
  before and after one, and across halftime; a Q2 play drawn turned, its end zones swapped.

## Out of scope (later slices)

- Routes and coverage before the catch, the throw and the ball's flight (the next slice).
- Kicks themselves: the flight and the coverage on punts, kickoffs and field goals.
- A lost fumble after a carry.
- Stunts, twists and designed pressures beyond today's blitz.
- Spatial AI-vs-AI games and the "watch an AI game live" screen.
- A play clock.
