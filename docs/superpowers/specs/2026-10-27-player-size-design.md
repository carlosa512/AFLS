# Player size: bell curves, matchups, spot fit and the rare gem

Date: 2026-10-27 · Branch: `claude/vibrant-pascal-ntlfhz`

## Why

Height and weight are rolled flat inside `BODY` (`positions.ts`) and the match engine barely reads them: one quirk
checks a receiver's weight, and the combine derives arms and hands from height. Size should matter the way it does in
the NFL: a 6'4" X wins jump balls, a short-armed tackle loses to speed, a 6'1" tackle (Aaron Donald) wins on leverage.
And the undersized player who beats the odds (Budda Baker, Kyler Murray, Mike Sainristil) must stay possible. Size is
**informative, never deterministic**: a modifier, never a gate.

## Decisions (agreed in the brainstorm)

1. **Both under the hood and as decisions:** size shapes play in the engine and shows up as real choices (outside or
   nickel, tackle or guard, who to draft).
2. **Matchup-aware:** an edge depends on who is across from him. A 5'9" corner against a 5'10" slot loses nothing.
3. **Noticeable:** at most ±2 rating points, reached only at the extremes (about 2 sd apart). The penalty is the same
   for everyone; elite ratings are what overcome it. A rare hidden trait halves it.
4. **Approach A:** an overlay at the engine's matchup points (`sizeEdge`), not new attributes and not inside
   `skill()`. OVR, screens and valuations of ratings are unchanged.
5. **Four phases, one PR each**, in order: generation, engine, spot fit, screens and AI.
6. **The research tables as written**, though wider than raw combine spreads: they give the "rare but real" outlier
   rate (about 1 corner in 10 at 5'9" or under). Tunable later.

## Adapted from the research spec

The research brief (`Positional Height/Weight Distributions & "Rare Gem" Mechanics`) is the source for the tables.
Three of its mechanics change to fit the project's rules:

| Brief | Here | Why |
| --- | --- | --- |
| Size "boosts agility" in play | Size nudges ratings at generation only; in play it acts only where size itself decides | Agility is already a rating; a second boost double-counts |
| Multiply draft grade by a Size Fit Score | Each GM has a hidden size bias, applied to his own read | Size is public; teams differ in how they weigh it; no global multiplier |
| Store `heightPercentile`, `rareGem` | The percentile is derived from height, weight and position when needed; the gem is `Player.playsBig` | No stored copy of a measurement that can disagree with it |

## The module: `src/engine/size.ts`

One pure module owns everything about size. Nothing else computes a size z-score.

- `SIZE: Record<Position, { h: [mean, sd]; w: [mean, sd] }>` — the tables below (inches, pounds).
- `sizeZ(p): { h: number; w: number }` — z-scores against his own position's curve.
- `isOutlier(p): boolean` — `|h| > 1.3` or `|w| > 1.3`.
- `sizeEdge(p, lever, opp?): number` — rating points in [−2, 2] for one lever (below). Zero when both are median.
- `SPOT_SIZE` — the typical opponent each depth-chart spot faces (phase 3).

## Phase 1: Generation

### Tables

Built from the brief's 10th/50th/90th percentiles (sd = (p90 − p10) / 2.563):

| Pos | Height mean ± sd (in) | Weight mean ± sd (lb) |
| --- | --- | --- |
| QB | 74.5 ± 2.0 | 223 ± 17 |
| RB | 70.5 ± 2.3 | 214 ± 17 |
| WR | 72.5 ± 2.7 | 200 ± 19 |
| TE | 76.5 ± 2.0 | 255 ± 16 |
| OL | 76.75 ± 2.2 | 313 ± 18 |
| DT | 75.5 ± 2.3 | 310 ± 19 |
| EDGE | 76.5 ± 2.0 | 277 ± 21 |
| LB | 74.5 ± 2.0 | 245 ± 16 |
| CB | 72.0 ± 2.3 | 195 ± 14 |
| S | 72.5 ± 2.3 | 210 ± 16 |
| K | 72.0 ± 1.8 | 200 ± 12 |
| P | 74.5 ± 1.8 | 212 ± 11 |

OL is one curve covering tackles and interior linemen (the brief's OT 77.5 and IOL 76.0); spot fit (phase 3) sends
the long ones outside. K and P are centred on today's `BODY` ranges.

### The roll

- Height and weight come from **one Box–Muller pair** (`cos` and `sin` of the same two draws), so a player costs the
  stream exactly the two draws `rng.int` × 2 cost today. Names, jerseys and everything after them keep their draws.
- Weight is correlated with height within a position: `zw = 0.5·zh + 0.866·z2`.
- Both clamp at ±2.5 sd and round to whole inches and pounds.
- `BODY` is replaced by `SIZE`; `training.ts`'s weight clamp on a position move uses mean ± 2.5 sd of the new position.

### Existing saves

`SAVE_VERSION` 55 moves every player of an older save from his flat roll onto his position's curve at the same
standing (`toCurve`: how far up the old range he sat becomes as many sd from the median), so each keeps his rank and
the league is centred on the medians phase 2's edges are measured from. Hidden traits and the combine are stored, so
nothing else about him moves. (Found in phase 2's review: left on the flat rolls, an older save's EDGEs sat 14 lb
under the new median and every offence would have gained on the run.)

## Phase 2: Engine

`sizeEdge` is added at the call sites in `match/gameSim.ts` where both players are known. It is **not** inside
`skill()`, so OVR, auto-sort by overall, valuations and screens are unchanged by it.

| Lever | Who vs who | Measure | Feeds |
| --- | --- | --- | --- |
| `contested` | receiver vs his defender (X–CB1, Z–CB2, SLOT–NB as paired today) | height gap, plus combine arm length | catch vs breakup/pick on deep, contested and red-zone throws |
| `press` | receiver vs corner in man | weight gap | short-route separation (half weight) |
| `edgeLength` | edge rusher vs the tackle charged | tackle's arm length against the rusher's speed | pressure off the edge |
| `leverage` | DT vs guard or centre | height gap, **shorter wins** | interior pressure |
| `mass` | line vs front, averaged per unit | weight gap | yards at the line on runs |
| `contact` | ball carrier vs tackler | weight gap | broken tackles, yards after contact |
| `lanes` | QB vs the defensive line | QB height | middle and deep accuracy; batted passes |

Rules:

- Each edge measures each player from his own position's median (a median WR on a median CB is level, though WRs run
  half an inch taller), scales linearly with the gap in the lever's units and caps at ±2.
- Length is height: the combine's arm length is not read (it follows height closely; one measure keeps the edges
  centred and simple).
- The gem protects whichever side holds it: a loss for the holder is halved, and so is the other side's gain over him.
- Edges are antisymmetric where both sides are players (`edge(a, b) = −edge(b, a)`), so league totals hold.
- `lanes` has no opponent player: it reads the QB's height z alone, centred on the QB median.

### Size and ratings (dropped)

The spec had size nudge speed, agility and strength at creation. Built with phase 2 and measured, it moved the overall
of about a third of new players, and with it the league's contracts, rosters and cap room (six seeded tests moved,
the 10-season sim leaned to offence) while the centred edges below held the league where it was. Dropped: size acts
on the field, through the edges, and on the depth chart (phase 3). Restoring it is one call in `generatePlayer`.

### The rare gem

A new hidden flag, `Player.playsBig` (optional, on the player rather than in `Traits`, which every reader treats as numbers): rolled once at generation, only for outliers (`isOutlier`), at about
1 in 4 of them, on the player's own seeded stream (`gem:${id}:…`, so the league stream is untouched). It halves a
negative edge and never adds a positive one. `SAVE_VERSION` bumps by one; the upgrade rolls it from the same stream, so an older save gets the gems a new league
would.

### Check: `npm run size`

A new script (`scripts/size.ts`), built like `npm run weather`; fails non-zero on any miss:

1. Generated heights and weights match the tables (mean within 0.2 in / 2 lb, sd within 10%, clamps hold).
2. Each lever, replayed on the same games with one player made 2 sd bigger or smaller, moves its own stat the right
   way (a 5'9" corner outside gives up more contested catches; a short DT gets more interior pressure).
3. League totals with sizes on match totals with every edge forced to 0, within the sim's tolerances.
4. No edge outside [−2, 2]; `playsBig` rate within 20–30% of outliers.

`npm run sim`, `audit` and `careers` stay green. `scripts/check` runs `size` when `size.ts`, `generate.ts` or the
match engine changes.

## Phase 3: Spot fit

**Who starts stays the overall's call.** Size decides only *where* the starters line up: the spot where his size
costs least against `SPOT_SIZE`, the typical opponent there (league median of the position he faces at that spot).
The same `sizeEdge` the engine uses, so the chart and the games agree and nothing counts twice.

| Group | Today | With size |
| --- | --- | --- |
| OL (`lineOrder`) | best pass protectors at tackle, sharpest mind at centre | tackles also weigh `edgeLength` against a median edge rusher; short-armed linemen go inside |
| CB | by overall | CB1/CB2 go to the corners with the best `contested` edge against a median X and Z; the remaining starter is NB |
| WR | by overall | best `contested` edge at X; the shortest of the three in SLOT |
| DT | by overall | heaviest at NT; the shorter at the 3-technique, where `leverage` applies |

- A hand-sorted chart is never changed. The head coach adds a note when a starter's expected edge at his spot is
  −1 or worse: *"Moore is giving up five inches outside; he's a nickel."*
- `training.ts` gets a new `MoveReason`, `size` (a 230 lb safety to LB, a corner losing deep to S, a 255 lb LB to
  EDGE). The planner's rules are unchanged: flips on cut-down day, the cooldown, learning time. AI teams use the same
  planner.
- Tests: auto-sort puts tall corners outside and short-armed linemen inside; `npm run training` checks every size
  move carries its reason and never touches a rating.

## Phase 4: Screens and AI

**Screens.** Height and weight stay public measurements. New, always in words and never a percentile:

- **Scout report:** one sentence, only when size decides something about him (`scouting.ts`, chosen by a condition
  like every other report sentence): *"Undersized for an outside corner; his feet carry him in the slot."*
- **Size outlier tag** in the draft room and on the player card for `isOutlier`, with a tooltip saying which way.
- **`playsBig`** is never shown as a value. Scouts describe it through `characterNotes`, firmer the longer they have
  watched him; a weak department can miss it or see one that isn't there.
- **Opposition report** (`inbox.ts`): one line for next week's biggest real mismatch, as advice for your chart:
  *"Their X is 6'4"; Moore gives up five inches. Consider the safety over the top."* It never promises a tactic the
  engine doesn't run.

**AI front offices.** A new GM tendency, `GmTraits.sizeBias` in [−1, 1]: "measurables" GMs mark outliers down in the
draft, free agency and trades; "tape" GMs ignore size. Applied to the team's own read, never true ratings; it follows
the person between jobs like the other tendencies. `SAVE_VERSION` bumps; the upgrade seeds it per GM.

Checks: the `ui.test.ts` screen contract (no percentile, no trait value rendered); `npm run trades` and `offseason`
unflagged; a test that a measurables GM drafts outliers later than a tape GM.

## Out of scope

- Splitting OL into OT and IOL positions, or CB into outside and nickel.
- Weight changing over a career (bulking, cutting) beyond the existing position-move clamp.
- Size effects on injuries.
- Re-rolling sizes in existing saves.

## Docs

Each phase updates `CLAUDE.md` (architecture line for `size.ts`, the `npm run size` command), `docs/MVP.md` where a
line moves, and `package.json`'s version per `docs/VERSIONING.md`.
