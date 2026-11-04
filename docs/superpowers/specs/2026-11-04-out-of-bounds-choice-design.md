# Out of bounds as the carrier's choice

**Status:** designed (2026-11-04), not built. Follows 0.4.2 (#148: `escortFor`, the audit of flat rolls).

## Why

Today `pOut` in `match/gameSim.ts` is a flat roll by tempo alone: 18% of catches (35% hurrying, 5% protecting a lead),
18% of outside runs and 4% of inside ones (a quarter of that protecting a lead), 20% of scrambles (55% hurrying, 5%
protecting a lead). Nobody chooses it and nothing about the play reads into it, so a lone receiver in open field can be
sent out, and a man at the sideline goes out no more often than a man in the middle. The field chases a man credited out
of bounds out (`escortFor`, 0.4.2), but over 60 games 11 of 564 out-of-bounds catches still had nobody within 5 yards in
the last second: nobody could get there, because nobody decided he should go.

This is the first item of the audit's goal (`docs/MVP.md`, "choices and situations, not flat odds"): games that play
like the NFL's because the people in them choose, with the odds coming out of those choices and the situation,
calibrated against public data.

## Decisions (the owner's)

1. **Both parts.** Out of bounds is mostly *forced* (pushed out by a defender), and partly *chosen* (he steps out). The
   NFL's play text records which. The model has both: pushed out from where he is and who's chasing; stepped out as his
   choice.
2. **One decision, made by the engine, the same in every game.** It is drawn from the play's own facts before the field
   runs; the field plays it out. The owner's call H stands (today's rolls decide, the field plays out how).
3. **The yards stay today's roll.** The choice decides how the play ends (the clock, the tackle credit, the hit), not
   how far he got. The men who step out are mostly the ones with little room left, so stepped-out catches come out short
   on their own.
4. **A player's differences come from what he already has:** build, habits, traits and health. No new trait.
5. **Two named formulas fitted to nflverse** (of three approaches: this one; a value-of-clock choice in win-probability
   terms, which needs a clock-value model the engine doesn't have; a lookup table by bucket, which is flat odds again).
6. **The clock follows the NFL's rule.** Outside the late windows, going out stops the clock until the officials spot
   the ball; then it runs.

## 1. The NFL target

nflverse play-by-play, regular seasons 2021–25. Catches are completions; runs exclude scrambles and kneels; all three
exclude touchdowns, lost fumbles, two-point tries, plays a flag wiped out and laterals. "Stepped out" is the play text's
`ran ob`, "pushed out" its `pushed ob` (nflfastR's `out_of_bounds` counts both). Tempo buckets use the engine's own rule
(`coach.tempo`), so the two sides compare directly. The engine's outside runs (`left end`, `right end`: 44% of its runs)
are mapped to the NFL's runs at the end or the tackle (48%), its inside runs to the guard and the middle.

**Catches** (54,024):

| Bucket | Out | Pushed | Stepped |
|---|---|---|---|
| All | 22.4% | 16.8% | 5.7% |
| Normal tempo | 21.8% | 16.8% | 5.0% |
| Hurrying | 25.9% | 16.7% | 9.2% |
| Protecting a lead | 20.2% | 15.7% | 4.5% |
| Q4 last 5:00, leading | 16.2% | 11.4% | 4.9% |
| To the sideline (left/right) | 27.6% | 20.6% | 7.0% |
| To the middle | 3.7% | 2.9% | 0.9% |
| Yards after the catch 0–2 | 19.8% | 11.9% | 7.9% |
| Yards after the catch 3–9 | 21.2% | 17.8% | 3.4% |
| Yards after the catch 10+ | 31.9% | 26.6% | 5.4% |
| 3rd/4th down, short of the sticks | 10.3% | 8.9% | 1.4% |
| 3rd/4th down, past the sticks | 25.3% | 18.2% | 7.1% |

**Runs** (62,949):

| Bucket | Out | Pushed | Stepped |
|---|---|---|---|
| All | 5.6% | 4.7% | 1.0% |
| Outside (end or tackle) | 11.1% | 9.2% | 1.9% |
| Inside (guard or middle) | 0.7% | 0.6% | 0.1% |
| Outside, normal tempo | 11.7% | 9.7% | 2.0% |
| Outside, hurrying | 10.2% | 7.8% | 2.4% |
| Outside, protecting a lead | 7.1% | 6.2% | 0.9% |
| Outside, no gain or a loss | 4.9% | 4.3% | 0.6% |
| Outside, 1–9 yards | 9.1% | 7.5% | 1.5% |
| Outside, 10+ yards | 31.8% | 26.0% | 5.8% |
| Outside, 20+ yards | 43.7% | 38.0% | 5.7% |
| Inside, 10+ yards | 7.3% | 6.0% | 1.3% |

**Scrambles** (4,791):

| Bucket | Out | Pushed | Stepped |
|---|---|---|---|
| All | 35.9% | 14.6% | 21.3% |
| Normal tempo | 35.5% | 14.7% | 20.8% |
| Hurrying | 40.9% | 14.8% | 26.1% |
| Protecting a lead | 25.1% | 12.3% | 12.8% |
| 1–9 yards | 34.5% | 14.8% | 19.8% |
| 10+ yards | 40.0% | 14.2% | 25.7% |

**Per team-game:** 4.46 catches out of bounds, 1.31 runs, 0.63 scrambles.

**Between players** (normal tempo; each man's stepped-out share, its spread net of what luck alone gives):

| | Men | Average | Real spread (sd) | Most / least |
|---|---|---|---|---|
| Sideline catches (150+) | 53 | 7.9% | 3.9 points (half the average) | Lockett 21%, Hill 15% / Kittle 2%, Kelce 1% |
| Runs to the end (100+) | 41 | 3.3% | 3.1 points | Fields 18%, Cook 10% / Mixon 0%, Montgomery 0% |
| Scrambles (60+) | 22 | 22.0% | 8.6 points (40% of the average) | Murray 51%, Nix 36% / Jackson 10%, Wilson 10% |

Big tight ends and power runners stay in and fight; smaller speed receivers step out.

**How each ending is scored** (normal tempo):

| | Yards after the catch, median (sideline catches) | Tackle credited: catches / runs / scrambles |
|---|---|---|
| Tackled in bounds | 3 | 100% / 100% / 100% |
| Pushed out | 6 | 100% / 100% / 100% |
| Stepped out | 1 | 50% / 100% / 100% |

On runs and scrambles a man who steps out gains as much as one pushed out (no yards given up).

**The clock** (game clock from one snap to the next, no timeout or flag between):

| | Tackled in bounds | Pushed out | Stepped out |
|---|---|---|---|
| Sideline catches, Q1–Q3 | 38.5 s | 34.5 s | 33.2 s |
| Runs at the end or tackle, Q1–Q3 | 38.3 s | 35.9 s | 35.3 s |
| Inside the late windows (catches) | 23 s | 6 s | 6 s |
| Overtime, last 5:00 | 38 s | 6 s | 6 s |

First downs don't stop the clock (39 s with one, 40 s without).

**Today's engine** (200 AI games, the same buckets): catches 19.8% (normal 17.6%, hurrying 33.1%, protecting a lead
4.8%; sideline 19.9%, middle 19.7%; flat across gains); runs 9.0% (outside 15.8%, inside 3.5%; no gain 8.5%, 20+ yards
9.6%); scrambles 27.6% (hurrying 59.2%, protecting a lead 3.4%). Per team-game: 3.97, 1.99, 0.58. The total for catches
is close; where it lands is not.

## 2. The seam: who decides what

**`src/engine/match/sideline.ts`**, a pure module: no `Rng`, no `League`. It takes a play's facts and returns two odds,
*pushed out* and *stepped out (if not pushed)*. The engine draws. Its facts:

- **The play:** run, catch or scramble; where he is across the field (`lane`, read as a continuous distance from the
  sideline, not a left/middle/right label); the gain, air yards and yards after the catch; whether he broke a tackle
  (`open.broke`) or got past the safety (`open.gone`).
- **The chaser:** today's would-be tackler (his `pursuit`, `tackling`, habits); on runs, the edge setter (`setEdge`).
- **The situation:** whether stopping the clock helps his side and actually stops it (`coach.tempo` with
  `oobStopsClock`); protecting a lead late; down and distance (3rd or 4th, short of the sticks or past them).
- **The carrier:** his habits, build (`sizeZ`), condition, injury history and `poise`.

**One draw decides it, for every game.** At each of the three spots (`runPlay`, `passPlay`'s catch, `scramble`) one
`rng.next()` on the game's stream comes out in bounds, pushed out or stepped out. It is taken once today's yards,
tackler and breaks are known and before the field runs. It replaces `pOut`, `outFirst` (the field's own out stream) and
the late `oobRoll`. AI games and yours decide it the same way from the same facts.

**The field plays it out.** `FieldFacts.oob` widens from `1` to `1 | 2`:

- `1`, pushed out: as today. `escortFor` sends the free defender who can reach the exit soonest to drive him out.
- `2`, stepped out: no escort. He heads out on his own read; the carrier read already leans to the sideline in the
  hurry-up (`read.ts`, `HURRY_OUT`, `OUT_BONUS`).

Old saves' film carries only `1` and plays as it does now. Widening the value needs no save upgrade.

**The scramble's slide stays as it is** (40% of the scrambles that stay in bounds): the NFL's play text doesn't record
slides, and the slide is its own audit item.

## 3. The two formulas

Both are logistic in shape, each term named, centred on a typical starter (so a league of typical starters keeps its
totals) and commented with the NFL number it is fitted to.

**Pushed out:**

| Term | Raises it | Lowers it | Fitted to |
|---|---|---|---|
| Where he is | near the sideline | the middle | catches: sideline 20.6%, middle 2.9%; runs: outside 9.2%, inside 0.6% |
| How far he got | long gains drift to the sideline | a short gain | outside runs: no gain 4.3%, 10+ 26.0%, 20+ 38.0%; catches by yards after the catch |
| The chaser | `pursuit`; `alleyCrusher`, `scraper`, `businessDecision` | `tackling`; `thumper`; on runs `setEdge` | centred; moved within the spread between players |
| The carrier | `longSpeed`; `runsEastWest`, `bouncesExternal` | | the spread between players |
| Protecting a lead late | | he cuts back inside | catches in the last 5:00 leading: 11.4% against 16.8% |

**Stepped out** (if not pushed):

| Term | Raises it | Lowers it | Fitted to |
|---|---|---|---|
| Where he is and the room ahead | near the sideline with little room (the chaser close, few yards after the catch) | room ahead (a broken tackle, past the safety) | stepped-out catches: median 1 yard after the catch; yards-after-catch 0–2 7.9% |
| The clock | stopping it helps his side and it stops | | catches 5.0% → 9.2% hurrying; scrambles 20.8% → 26.1% |
| The first-down marker | | short of the sticks on 3rd or 4th | 1.4% short against 7.1% past |
| Habits | `contactAverse`, `hearsFootsteps`, `runsEastWest`, `bailsEarly` (scrambles) | `finishesForward`, `yacSlasher`, `highKnee` | the spread between players |
| Build | a small frame | a big frame (`sizeZ`) | tight ends and power backs near 1–2% |
| Health | a worn condition, an injury history | | kept inside the spread between players |
| Reading the clock | `poise` and `noHuddle` read the clock right (out when it helps, in when it doesn't) | a low `poise` gets it wrong more often | the hurrying and protecting-a-lead rows |

Each odd is clamped, with bounds wide enough for the NFL's most extreme men (Murray steps out on 51% of his scrambles,
Lockett on 21% of his sideline catches) and no wider.

## 4. What each ending does

| | Tackle credited | The hit | Contact fumble | Play text |
|---|---|---|---|---|
| Pushed out | the chaser, always | a tackle's, as today (`collide(…, 'carrier')`) | as a tackle's | ", pushed out of bounds" |
| Stepped out | runs and scrambles: the man who forced him, always; catches: only when someone was closing (about half) | none: a free runner's risk (`collide(…, 'free')`), as a scorer's | none | ", steps out of bounds" |

- **Credit and hit are decoupled.** `wear` treats any credited tackle as the carrier being hit; a stepped-out play needs
  a marker for "credited, no hit". The league's injury rate stays inside `docs/INJURIES.md`'s range.
- **Your games:** pushed out credits `escortFor`'s man (today your games credit nobody on out of bounds); stepped out
  credits the nearest chaser in the last second, when a tackle is credited.
- **Text:** both endings still contain "out of bounds", so what reads that phrase (the film's calls, `ui/stage/calls.ts`)
  keeps working. Old saves' play text is untouched.

## 5. The clock

- **Inside the windows** (the last 2:00 of the first half, the last 5:00 of the fourth quarter and of overtime): stopped
  until the snap, as today (`oobStopsClock`).
- **Outside them** (new): today the engine runs the full pre-snap runoff (28–38 s normally) as if he'd been tackled in
  bounds. Instead the clock stops for a spotting pause and then runs to the snap: the runoff after a play out of bounds
  is the tempo's runoff less the pause. The pause is fitted so the gap between snaps matches the NFL's (about 4–5 s
  shorter than a tackle in bounds on a catch, 2–3 s on a run).
- **Unchanged:** a tackle in bounds keeps the clock running while the ball is spotted (why a hurrying team spikes); first
  downs don't stop it.
- **Plays per game:** the pause frees about a minute of clock a game, about one more play. If plays per game leave the
  NFL's 61–65 a team, the normal runoff is re-centred, not the pause.

## 6. Checks and targets

**Targets.** Each bucket in §1 within 3 points of the NFL's or 20% of its value, whichever is wider; each kind's total
within 1.5 points; the real spread between players within ±30% of the NFL's; the clock gap within 1.5 s of the NFL's.

- **Unit tests** (`sideline.test.ts`): each input moves its odds the right way; the terms add to zero at a typical
  starter; the odds stay in bounds.
- **Engine tests:** a lone carrier (broke a tackle, past the safety) in normal tempo rarely goes out; a stepped-out play
  credits the tackle but carries no hit and no fumble roll; the spotting pause applies outside the windows and not inside.
- **`npm run sim`** gains the bucket table, the totals, the spread between players and the clock gap, and fails when one
  leaves its range. It already runs for every `match/` change, so no new CI job.
- **`npm run parity`** gains the film check (the handoff's measurement): stepped-out plays in normal tempo almost never
  alone (nobody within 5 yards in the last second); in the hurry-up, alone is expected.
- **The NFL measurement** is committed as `scripts/research-sideline.py` (like `research-squads.py`); the numbers it
  prints are the constants' sources.
- **The checks this change calls for:** `sim` (plays, leaders, injuries), `endings` (clock management), `audit`
  (`pursuit`, `tackling` and `setEdge` gain reads), `quirks --effects` (each habit with a new hook moves its stat the
  right way; its `effect` line is reworded), `parity`, `size` (build is a new lever).

## 7. Delivery

- Built on top of #148 (0.4.2), as **0.4.3** (a follow-up: the last number, `docs/VERSIONING.md`).
- `docs/MVP.md`: the "Out of bounds as the player's choice" item ticked with what was measured; the audit list's line
  numbers refreshed. A changelog entry (`ui/changelog.ts`).
- No save upgrade: `FieldFacts.oob` only widens, and old play text stays as it is.

## 8. Out of scope

- The scramble's slide (no NFL data in the play text; its own audit item).
- Out of bounds on returns (kicks, punts, interceptions, fumbles).
- Late hits out of bounds as a foul (a `sportsmanship` hook; the penalty rolls are their own system).
- The ten-second runoff and the other late-game clock rules.
- A value-of-clock model (approach 2). If the passer-under-pressure item builds one, the clock term here can switch to
  reading it.

## Risks

- **Catch lanes.** The engine puts 67% of catches at `|lane| ≥ 0.34`; the NFL charts 78% left or right. The formula
  reads `lane` continuously and is fitted to the total and the sideline/middle split, not to a label.
- **The spread between players** may not reach the NFL's from build, habits and health alone. If the check comes up
  short, it is shown to the owner; no new trait goes in without asking (decision 4).
- **Every game moves.** Clock stops, plays per game and the leaders all shift; `sim` over 60 seasons in CI is the judge,
  and no range is loosened to get green.
