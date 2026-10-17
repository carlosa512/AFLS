# Match Engine v2: Layered Spec

Oct 16, 2026 · @Carlos Ancira · Draft

## Purpose and locked decisions

The match engine gets rebuilt in layers toward Football Manager's loop. What a team calls changes which matchups happen, the engine resolves those matchups through contests, and the game shows the user why things happened. User play calling is the long-term goal. Each layer ships on its own and leaves a seam the next one plugs into, so play calling arrives at the end as mostly UI work.

| Decision | Choice |
| --- | --- |
| Approach | One layer at a time. Each merges to main and passes every check before the next one starts. |
| First layer | The call seam: every pre-snap decision becomes a value the resolver reads. The resolver never decides what play is run. |
| Playbook | Data from day one. Version 1 holds generic concepts that reproduce today's engine; real concepts are added as entries later. |
| Callers | One per team. The AI caller wraps `coach.ts`. Coach tendencies (coaching staff feature) plug in through the AI caller. The user caller arrives in Layer 7. |
| Determinism | Same seed, same game, at every layer. Pure refactors must replay bit-exact. Behavior changes must stay inside the `npm run sim` targets. |
| Randomness | Per-snap RNG streams from Layer 1b, so one changed call doesn't reshuffle the dice for the rest of the game. |
| Resolution model | Per-snap, matchup-driven, with time as the shared currency in the passing game (Layer 4). No agent-based simulation of player positions every tick. This matches the play chain in `market-and-blueprint.md`. |
| Saves | Old play logs must keep rendering. Any change to `GameResult` or `PlayLogEntry` follows the `SAVE_VERSION` rule in CLAUDE.md. |

**How Claude Code should use this spec**

- Run Phase 0 first and report findings before changing engine code.
- One step per branch (1a, 1b, 2a…). Don't start a step until the previous one has merged and passed its checks.
- Field names and types here are intent. Adapt them to the real types in `types.ts` and `rng.ts`.
- **Refactor steps must not change a single game.** If the golden replay test fails on a refactor step, the refactor has a bug: fix it, never re-baseline.
- **Behavior steps** regenerate the golden fixture in the same PR, with a one-line note on what changed and why. Run `npm run sim -- 10`, `npm run endings` and `npm run audit`, and report every metric that moved against the Phase 0 baseline.
- If a target can't be met, flag it in the PR instead of tuning blindly.
- Keep the engine conventions in CLAUDE.md: no `Math.random`, contests through `skill()`, never read `player.ratings`, small pure functions, comments that explain why.

**Build order**

- **Phase 0:** audit and the golden replay test, add coaches.
- **Layer 1a → 1b:** the call seam, then calls that decide and per-snap randomness.
- **Layer 2a → 2b:** structured events, then storing them and the stats they unlock.
- **Layer 3:** individual matchups. **Layer 4:** coverage and the passing game.
- **Layer 5:** in-game state (form, fatigue, injuries).
- **Layer 6 (party done by PR 7):** coach tendencies and game plans. It only touches the AI caller, so it can run in parallel with Layers 3-5 once Layers 1 and 2 have merged (the halftime adjustment reads Layer 2 events). It lands with the coaching staff feature.
- **Layer 7:** user play calling.

Effort key (same as the roadmap doc): **Low** = days. **Medium** = a new subsystem with modest balancing. **High** = a new simulation loop plus heavy tuning.

## Where the engine stands

**Keep (these are working and later layers depend on them)**

- One seeded engine behind both `simulateGame` and `startGame`, so a watched game and an instant game are the same game.
- Effects measured from league-typical reference values (`OL_DISCIPLINE`, `EDGE_CONTAIN`, `DEEP_HELP`, the 12-centered contest offsets), so a new effect doesn't shift league totals.
- `StatBuffer`, which discards stats from a play wiped out by a penalty.
- Heavy-tailed big plays (exponential breakaways and YAC).
- Contests with specific jobs (`pocketPresence` decides sack conversion, `deepHelp` closes deep windows, `setEdge` taxes outside runs).
- `coach.ts` as pure functions of `Situation`, and its clock management.

**Fix (what each layer addresses)**

| Finding today | Fix | Layer |
| --- | --- | --- |
| Pre-snap decisions (carrier, inside or outside, pass depth) are made inside `runPlay` and `passPlay` | Move them into the call | 1 |
| Run direction and pass lane are picked after the outcome, so text and animation describe things the math never saw | The call picks them; the resolver reads them | 1b, 3 |
| One RNG stream per game: any changed decision shifts every later draw | Per-snap streams | 1b |
| Play text is built inline as strings | Text generated from structured events | 2 |
| Tacklers and sackers are drawn by weighted lottery after the result | Credit whoever won the matchup | 2, 3 |
| Line play uses unit averages (`passBlock`, `runBlock`, `passRush`, `runStop`), which hide a weak link | Alignment, then per-gap and per-lineman resolution | 3 |
| The target is chosen before separation, so the QB doesn't find the open man | Read progression | 4 |
| Pressure is rolled before depth, so a deep shot faces the same rush as a quick slant | Pocket time vs. route timing | 4 |
| No fatigue, game-day form or in-game injuries; RB1 gets the same share of carries (about two-thirds) all game | In-game state | 5 |
| Every AI team calls the same game, regardless of roster or opponent | Coach tendencies through the AI caller | 6 |
| `LiveGame` is watch-only | User caller and touchline controls | 7 |

## Phase 0: confirm in code before building

**Already known (from CLAUDE.md and the files reviewed)**

| Area | What the game does | Impact |
| --- | --- | --- |
| Randomness | Seeded `Rng`; each game seeded from `${seed}:${season}:${gameId}`; one stream per game inside `GameSim` | Per-snap streams (1b) need cheap construction of an `Rng` from a derived string seed |
| Live vs. instant | `startGame` and `simulateGame` share `GameSim` | Keep it that way; user calls (Layer 7) must not fork the engine |
| Contests | The engine reads `skill(player, contest)`, never ratings | New matchups go through contests and the `npm run audit` rule |
| Stat targets | `npm run sim -- 10` compares league stats to NFL averages | This is the distribution check; extend it, don't duplicate it |
| Endings | `npm run endings` audits game endings | Run it after any change to call order or `coach.ts` |
| Attribute audit | `npm run audit` replays the same games with one attribute raised | Per-snap streams should make it less noisy (1b) |
| Saves | `GameResult.plays` lives in the League JSON; pruned games keep only scoring plays | Event storage (2b) must respect pruning and save size |
| Viewer | `GameViewer` and `LiveGame` animate from `kind`, `from`, `to`, `air`, `lane` on `PlayLogEntry` | 1b makes `lane` causal; 2a derives these fields from events |

**Confirm in code**

- `types.ts`: the exact shapes of `PlayLogEntry`, `PlayKind`, `GameResult`, `StatKey` and `MAX_STATS`.
- `rng.ts`: the full API (`next`, `chance`, `normal`, `int`, `pick`, `weighted`, `exponential`), what construction costs, whether `normal` caches a spare value, and whether a fork or derive helper exists.
- The play-log pruning policy: which games keep full logs and when the others get pruned.
- The script behind `npm run sim`: which metrics it reports and their target ranges.
- The script behind `npm run audit`: how it replays "the same games" and how it measures movement.
- `coach.ts` on main: whether anything reads per-team tendencies today (for example `Team.gm`).
- The depth chart: whether OL order means slots (LT, LG, C, RG, RT). Layer 3 needs this.
- Whether a determinism test already exists, and whether one checks that stepping `startGame` to the end equals `simulateGame`.

**The golden replay test (build in Phase 0)**

- Freeze the input: save the teams and players the games need as a fixture, so a change to `generate.ts` or development doesn't break the engine's test.
- Pick about 50 games that cover regular season, playoffs, overtime, neutral site, blowouts and one-score finishes.
- Sim each with `keepPlays`, and store a hash per play plus the final score. On a mismatch, the test names the game and the first play that changed.
- Run it as a Vitest test inside `npm test`, with an update script (for example `npm run golden:update`) that behavior steps use to regenerate the fixture.
- Add the live-vs-instant check if it doesn't exist: stepping `startGame` to the end must match `simulateGame` exactly.

**Report deliverables**

- **Decision inventory:** every decision made per snap, in order, with where it's made and which RNG draws it uses. Step 1a must preserve this order exactly, so this list is its checklist.
- The golden replay test, passing on main.
- A baseline file of the current `npm run sim -- 10` output, plus metrics worth adding as layers land (explosive-play rate, pressure rate, completion % by depth, yards per carry by direction).
- Anything in this spec the code can't support, with an alternative.

## Layer 1: the call seam (Medium)

**Goal:** every decision made before the snap becomes a value. Calls come from one place per snap, from one caller per team. That is the seam that coach tendencies (Layer 6) and the user (Layer 7) plug into.

**Interfaces** (intent; a new `match/calls.ts`)

```ts
export type Tempo = 'hurry' | 'normal' | 'milk';

/** Clock decisions before the snap. Offense: timeout, spike, tempo. Defense: timeout only. */
export interface PreSnapCall {
  timeout?: boolean;
  spike?: boolean;
  tempo?: Tempo;
  /** Play-for-the-field-goal case: run the clock down to this many seconds, then stop it. */
  bleedTo?: number;
}

export type OffenseCall =
  | { kind: 'play'; concept: ConceptId; carrier?: number; gap?: Gap; lane?: Lane }
  | { kind: 'punt' }
  | { kind: 'fg' }
  | { kind: 'kneel' };

export interface DefenseCall {
  concept: DefConceptId; // v1: 'base' | 'runD' | 'passD' | 'blitz'
}

export interface Caller {
  preSnap(s: Situation, ctx: CallContext, rng: Rng): PreSnapCall;
  offense(s: Situation, ctx: CallContext, rng: Rng): OffenseCall;
  defense(s: Situation, ctx: CallContext, rng: Rng): DefenseCall;
  kickoff(s: Situation, ctx: CallContext): 'deep' | 'onside';
  conversion(s: Situation, ctx: CallContext): 'xp' | 'two';
}
```

- Player references in calls are ids, not `Player` objects, so a call can be stored on the play log as plain JSON.
- `CallContext` is read-only: both lineups to start, plus in-game state from Layer 5.
- The sim holds `callers: [Caller, Caller]`, one per side.

**Playbook** (a new `match/playbook.ts`)

```ts
export interface OffenseConcept {
  id: ConceptId;
  label: string;                  // what the play-calling UI will show
  kind: 'run' | 'pass';
  run?: { outside: boolean };
  pass?: { depth: PassDepth };    // v1: one depth; Layer 4 replaces it with a route per receiver
}
```

Defensive concepts get the same treatment: v1 is the four existing calls as data, and Layer 4 adds fronts and coverages.

**The snap pipeline after Layer 1**

1. **Pre-snap:** the offense's `preSnap`, then the defense's, in today's order (offense timeout, defense timeout, spike). Apply the runoff from tempo or `bleedTo`.
2. **Calls:** `offense()` and `defense()`.
3. **Pre-snap penalty check** (false start, offside).
4. **`resolveSnap(state, offCall, defCall, rng)`** returns an outcome and mutates nothing. It includes the during-play penalty roll, which is resolution.
5. **`apply(outcome)`**: clock, stats, field position, possession and logging (today's `resolve()`).

Suggested file split: `calls.ts` (types), `playbook.ts` (concepts), `callers.ts` (`AICaller`, `ScriptedCaller`), `snap.ts` (`resolveSnap`, `runPlay`, `passPlay`, `sack`, `scramble`), with `gameSim.ts` keeping game state, special teams and `apply`. `coach.ts` stays unchanged under `AICaller`.

### 1a: structural refactor (no behavior change, Low-Medium)

Move every decision behind the interfaces above **without changing the order of any RNG draw.** The golden replay test is the referee.

| Decision | Today | After 1a |
| --- | --- | --- |
| Timeouts, spike, tempo runoff, play-for-the-field-goal bleed | Clock block at the top of `scrimmageDown` | `AICaller.preSnap` (offense, then defense) |
| Kneel, kick now, fourth down | `scrimmageDown` via `shouldKneel`, `kickNow`, `fourthDown` | `AICaller.offense` |
| Defense call | `scrimmageDown` via `defenseCall` | `AICaller.defense` |
| Pass or run | `scrimmageDown` via `passProbability` | `AICaller.offense` (placeholder concepts `anyRun` and `anyPass`) |
| Carrier, inside or outside, pass depth, gap, lane | Inside `runPlay` and `passPlay` | **Stay put in 1a** (moving them changes draw order; that's 1b) |
| Onside or deep kickoff | `kickoff` via `shouldOnside` | `AICaller.kickoff` |
| Extra point or two | `conversion` via `goForTwo` | `AICaller.conversion` |

Today the pre-snap penalty check sits between the fourth-down decision and the defense call. To keep the draw order, 1a may call the AI caller in two steps (the situational decision, then pass or run). The two merge into one `offense()` call in 1b.

**Acceptance**

- Golden replay identical. `npm test` and `npm run typecheck` pass.
- `gameSim.ts` and `snap.ts` call no `coach.ts` decision function directly; every decision goes through a caller (a grep check is enough; constants like `MILK_RUNOFF_MIN` are fine).
- The resolver reads tempo from the call. Today `runPlay`, `passPlay` and `scramble` call `coach.tempo()` for their out-of-bounds odds, so `preSnap` must return a tempo on every snap, not only when the clock is running.
- `runPlay` and `passPlay` take the call as an argument.

### 1b: calls decide, per-snap randomness (behavior change, Low-Medium)

- **Concepts replace the placeholders.** v1 playbook: inside run, outside run, quick pass, intermediate pass, deep shot. The AI caller picks the concept with today's logic (`passProbability`, the 40% outside share, `passDepth`).
- **The call picks the carrier** with today's weights (RB1 0.68, RB2 0.24, QB by scrambling, WR1 0.015).
- **The call picks the gap and the pass lane.** Keep today's five run labels and three pass lanes, so the text mix doesn't shift; Layer 3 replaces them with real gaps. The resolver still ignores gap and lane in its math, but the play text and the animation now come from the call, so what the user sees matches what was called.
- **Pass depth is called before the pressure roll,** so a sacked play still had a called depth. Pressure doesn't depend on depth yet (that's Layer 4), so probabilities don't change.
- **Per-snap RNG streams.** Each event (scrimmage snap, kickoff, punt, field goal, try) gets a counter `n`. Streams are seeded from `${gameSeed}:${n}:pre`, `:off`, `:def` and `:play`, plus one `:pregame` stream for the coin toss. The offense and defense draw from separate streams, so replacing one side's caller (a user, a coach profile) leaves the other side's dice alone. Same seed, same game, still holds.
- **The pre-snap penalty check moves after the calls** (plays are called in the huddle).
- **The call is stored on the log entry:** an optional `call?: { off: ConceptId; def: DefConceptId }` on `PlayLogEntry`. Follow the `SAVE_VERSION` rule; the upgrade step is a no-op, because old entries simply lack the field.
- **`ScriptedCaller`** (test utility): returns fixed calls from a list. It lets tests force plays ("deep shot every snap") and is the first sketch of the Layer 7 user caller.

**Acceptance**

- `npm run sim -- 10` inside every target range, with deltas reported against the Phase 0 baseline. Expect noise-level changes only, since no probability changed.
- `npm run endings` clean. `npm run audit` has nothing under "Needs attention" (expect it to read cleaner thanks to per-snap streams).
- Golden fixture regenerated in this PR, with a note.
- New tests:
  - The run text's direction always matches the called gap, and the logged `lane` equals the called lane.
  - Changing the offense's call on one snap doesn't change the defense stream's draws on that snap.
  - A `ScriptedCaller` game is reproducible from its seed and its call list.

## Layer 2: structured events (Medium)

**Goal:** the resolver reports what happened as data. Play text, the animation path and new stats are all derived from that data, so they can never disagree with the math.

**Event shape** (intent)

```ts
export type PlayEvent =
  | { t: 'handoff'; carrier: number; gap: Gap }
  | { t: 'pressure'; by?: number }                 // `by` arrives in Layer 3
  | { t: 'sack'; by: number; yards: number }
  | { t: 'scramble'; yards: number }
  | { t: 'throwaway' }
  | { t: 'target'; receiver: number; defender: number; depth: PassDepth; air: number; sep: number }
  | { t: 'catch'; yac: number }
  | { t: 'incomplete'; breakup?: number }
  | { t: 'interception'; by: number; returnYds: number }
  | { t: 'brokenTackle'; by: number }              // the carrier broke this defender's tackle
  | { t: 'tackle'; by: number; at: number }
  | { t: 'fumble'; by: number; forcedBy?: number; recoveredBy: number; lost: boolean }
  | { t: 'outOfBounds' }
  | { t: 'penalty'; kind: PenaltyKind; on: 'off' | 'def'; yards: number; player?: number };
```

In Layer 2 the events record today's draws exactly as they happen. For example, the tackler is still whoever `pickTackler` chose. Layer 3 makes the events causal.

### 2a: events and text from events (refactor)

- `resolveSnap` returns `events` alongside today's `PlayResult` fields.
- `describe(events, ctx)` produces the play text and must reproduce today's wording character for character.
- The animation fields (`kind`, `from`, `to`, `air`, `lane`) come from events too.
- Events aren't stored yet, so the golden replay must stay **identical**.

### 2b: store events and add the stats they unlock (data change)

- Store events on `PlayLogEntry` as an optional field (`SAVE_VERSION` rule, no-op upgrade). Pruned games drop them along with the non-scoring plays.
- Old games without events must still render in `BoxScore`, `GameViewer` and `LiveGame`.
- Add stats that today's math already computes but throws away. Possible `StatLine` keys:
  - air yards and YAC per catch
  - targets, completions and yards allowed per coverage defender
  - broken tackles forced (carrier) and missed tackles (defender)
  - team pressure rate (pressure is still a unit roll until Layer 3)
- `BoxScore` can add a coverage table and YAC column. Keep it small.

**Acceptance**

- 2a: golden replay identical.
- 2b: golden replay identical (the hash ignores the new `events` field), and a round-trip test that `describe()` covers every `PlayKind`.

## Layer 3: individual matchups (High)

**Goal:** replace the unit composites with who lines up over whom. A weak right tackle gets exposed on runs to the right and by the edge rusher across from him.

- **Alignment.**
  - OL slots: LT, LG, C, RG, RT. Decide the source: a depth-chart order convention, or explicit slot tags. The Real-World Start File spec already keeps OL slot tags, so explicit tags line up with it.
  - Base front: EDGE left and right, DTs over the guards, LBs at the second level, safeties deep.
  - Defensive concepts shift alignment. `runD` brings a safety into the box; `blitz` sends a linebacker through a gap.
- **Real gaps.** A, B and C on each side plus the edge replace the five text labels. The playbook's run concepts declare which gaps they attack.
- **Runs resolve by level:**
  1. **At the line:** the blockers at the point of attack vs. the defenders at it decide the hole. A losing block means penetration, and the winning defender gets the TFL.
  2. **Second level:** the linebacker fitting that gap vs. the carrier.
  3. **Third level:** the breakaway and pursuit logic as today.

  The tackler is whoever wins at the level where the run ends.
- **Pass protection per rusher.** Each rusher faces his blocker. Five linemen against four rushers leaves one free to help the best rusher. A blitz adds a rusher for the back to pick up, or a free rusher if he doesn't. The first rusher to win sets the pressure and is the sacker. Layer 3 still outputs "pressured" for compatibility, plus who and when; Layer 4 consumes the time.
- **Causal penalties.** Holding gets likelier when the blocker is losing his rep. Keep totals NFL-like with the existing reference values.
- **Calibration note.** Per-matchup resolution makes the weakest link count for more than an average does. Retune so league averages stay inside the `npm run sim` targets.
- **Attributes.** New contests that the roadmap's expanded attributes need (block shedding, pursuit, vision) land here as hooks, under the "no attribute without an engine hook" rule.

**Acceptance**

- `npm run sim -- 10` in range. `npm run audit` clean. `npm run endings` clean.
- New test: swapping a weak LT for a strong one lowers pressures allowed on the left and raises yards per carry to the left more than to the right.
- Sack and tackle credit now come from the winning matchup, checked by a test that the sacker was an unblocked or winning rusher.

## Layer 4: coverage and the passing game (High)

**Goal:** the QB finds the open man, and protection time decides which routes have time to open.

- **Defensive concepts gain a coverage:** man or zone, the shell (one-high or two-high), and assignments (who covers whom). Shadowing a receiver and bracketing are instructions on the concept, for the AI now and for the user later.
- **Pass concepts gain routes:** each receiver gets a route with a depth and the time it needs to come open. The v1 concepts (quick, intermediate, deep shot) become route sets.
- **Time-based resolution:**
  - Pocket time comes from the Layer 3 protection.
  - Each route opens at its own time, with separation from the receiver vs. his coverage (today's separation math, per receiver).
  - The QB works his reads in the order the play is drawn. `decisionMaking` controls how well he spots separation and how long he holds the ball.
  - When the pocket collapses before a route opens, the outcome is a sack, scramble, throwaway or forced throw.
- **The target comes from the read,** not from fixed weights. Weight each receiver by the play design and by his separation, and let `decisionMaking` set how much separation counts. Under pressure, the QB sticks closer to the design.
- **Retune completion rates.** QBs will throw into better windows on average, so the base rates by depth have to come down.
- **Attributes:** man coverage, zone coverage, press and release get their hooks here.

**Acceptance**

- `npm run sim -- 10` in range, including completion % by depth, sack rate and interception rate. `npm run audit` shows `decisionMaking` moving target quality.
- New tests:
  - Shadowing WR1 with the best corner lowers WR1's target share.
  - A better pass-blocking line raises the deep-pass completion rate.

## Layer 5: in-game state (Medium)

**Goal:** players have good days and bad days, tire, rotate and get hurt during games.

- **Game-day form:** a per-player roll at kickoff from its own stream, scaled by the planned Consistency hidden trait. Until that trait exists, use a small flat spread. Hidden traits stay words in the UI, never numbers (CLAUDE.md).
- **Fatigue:** energy drops per snap by position and play type and recovers on the sideline. Low energy drags effective skill. The planned Stamina attribute sets the rate.
- **Rotation:** depth-chart rules (DL rotation, RB1/RB2 split by fatigue) replace the fixed carry weights.
- **In-game injuries:** an injury event plus next-man-up substitution. Injury length and recovery belong to the injury model on the roadmap, not to the engine.
- **Snap counts:** the engine can now count real snaps per player. That is a better input for development v2's reps-based growth than games played (see Open questions).

**Acceptance**

- `npm run sim -- 10` in range. If snap counts feed development, `npm run careers` stays clean.
- New test: a team with DL depth holds up better in the fourth quarter than one without.

## Layer 6: coach tendencies and game plans (Medium)

**Goal:** AI teams call different games, shaped by their coaches and their roster.

- **Tendency profile** read by the AI caller: run/pass lean, fourth-down aggression, tempo preference, deep-shot appetite, blitz rate and coverage preference. Center each knob on a neutral value, like the engine's reference values.
- **Profiles live on the coaches** from the coaching staff feature. Likely mapping: OC for offense, DC for defense, HC for fourth down and clock (see Open questions). This spec defines what the AI caller reads, not how the coaching feature works.
- **Kickoff game-plan bias:** a lean from the matchup (their pass rush vs. our line, our receivers vs. their corners), not a script.
- **Halftime adjustment:** re-weight concepts by what worked in the first half (yards per play by concept, from the Layer 2 events).

**Acceptance**

- A neutral profile reproduces the previous layer's games bit-exact (golden replay identical with every team neutral).
- `npm run sim -- 10` in range with the real spread of profiles. `npm run endings` clean (this changes coaching).
- New test: an aggressive profile goes for it on fourth down measurably more often than a conservative one.

## Layer 7: user play calling (Medium, mostly UI)

**Goal:** the user coaches from the touchline.

- **`UserCaller`** implements `Caller` by waiting for input. The live game pauses at a decision point: `next()` returns with a pending decision (`preSnap`, `offense`, `defense`, `kickoff` or `conversion`), and a new `submitCall(call)` resumes play.
- **Modes:**
  - Call every snap.
  - Call key downs only (third and fourth down, red zone, two-minute drill), with the AI coordinator calling the rest.
  - Game plan only (the Layer 6 tendency knobs as sliders).
- **`LiveGame` UI:** a playbook picker filtered by situation, a defensive call picker, and timeout and tempo buttons.
- **Sim to final** hands both sides to AI callers. If the user doesn't watch the game, the AI caller uses the user's game plan.
- **Replays:** a game with user calls is reproducible from its seed plus its stored call list, so "Watch replay" keeps working.

**Acceptance**

- Games with no user involvement are identical to Layer 6 (golden replay).
- A user-called game replays exactly from seed plus calls.
- `npm run endings` clean with AI callers.

## Validation summary

| Step | Kind | Golden replay | Also run |
| --- | --- | --- | --- |
| Phase 0 | Tooling | Built, passing on main | `npm run sim -- 10` baseline saved |
| 1a | Refactor | Identical | `npm test`, typecheck, no `coach.ts` decision calls in the resolver |
| 1b | Behavior | Regenerated with note | sim, endings, audit |
| 2a | Refactor | Identical | `npm test` |
| 2b | Data | Identical (ignoring events) | old saves render |
| 3 | Behavior | Regenerated with note | sim, endings, audit |
| 4 | Behavior | Regenerated with note | sim, endings, audit |
| 5 | Behavior | Regenerated with note | sim, audit; careers if snaps feed development |
| 6 | Behavior | Identical with neutral profiles, then regenerated with real ones | sim, endings |
| 7 | UI and engine | Identical for AI-only games | endings, replay-from-calls test |

## Open questions

**For Carlos**

- ☐ Golden fixture: freeze a league fixture in the repo (larger file, stable test), or regenerate from a seed and accept that generator changes break the test?
- ☐ Event storage: keep events for every unpruned game, only for the user's games, or fold them into stats at game end?
- ☐ Two user decision points per snap (clock and tempo, then the play): is that the right Layer 7 model?
- ☐ Personnel and formations (two-tight-end sets, nickel vs. base): fold into Layer 3, or add as their own layer after Layer 4? Today every snap uses the same eleven.
- ☐(yes) Coaching staff feature: confirm OC holds offensive tendencies, DC defensive, HC fourth down and clock.
- ☐ Should engine snap counts feed development v2's reps once Layer 5 exists?
- ☐ Two-point tries: keep the single roll, or make them a real snap from the 2 once concepts exist?
- ☐ Default play-calling mode in Layer 7: every snap, key downs, or game plan only?

**Later extensions**

- Play action, screens and RPOs as concepts.
- Audibles and hot routes at the line.
- Special teams calls: fake punts, squib and pooch kicks.
- Weather and wind on kicks and deep passes.
- Opponent scouting: defenses that learn a team's tendencies across a season.

## Sources

- Uploaded repo files (not public links): `gameSim.ts`, `coach.ts`, `lineup.ts`, `GameViewer.tsx`, `LiveGame.tsx`, `BoxScore.tsx`, CLAUDE.md, README.md.
- `docs/research/attributes-development-scouting-roadmap.md` (expanded attributes, hidden traits, injuries, coaching staff).
- `market-and-blueprint.md` (the per-play probability chain this engine follows).
- Real-World Start File: Pipeline Spec (OL slot tags, coaching staff scope).
