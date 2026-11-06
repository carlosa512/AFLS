# Fumbles on contact

**Status:** built (0.4.6). Follows 0.4.5 (#152, the passer under pressure; #153, the two bands).

## Why

A contact fumble today in `match/gameSim.ts` is a base rate for the play (`RUN_FUMBLE` 0.0146 a tackled run in bounds,
`CATCH_FUMBLE` 0.0086 a tackled catch) times the carrier's ball security (`exp(−0.13 × (ballSecurity − 12))`, −0.12 on
a catch), four habits (`fumbleOdds`: Loose Carriage, High Knee and Contact Averse on runs, Ball Stripper) and the
weather. It reads nothing about the man who made the tackle beyond one habit, nothing about the situation (a back
fighting for the sticks, a defense that needs the ball), nor fatigue. A tackled scrambler never fumbles. Every fumble
credits the tackler with a forced fumble.

This is the audit's last High item (`docs/MVP.md`, "choices and situations, not flat odds").

## Decisions (the owner's)

1. **Scope B:** the hit (the tackler himself), and two choices as leans: the defense going for the ball, the carrier
   fighting for extra yards. Fatigue counts. Botched exchanges and who recovers the ball are out (they're other items).
2. **Yards stay today's roll.** The choices move only the fumble odds; the text and the film show them.
3. **No gang tackles in the engine.** One tackler in the box score, as today. The goal is how a fumble looks on film and
   in the play-by-play, not a model of every man in on it: the film may show a second defender closing in.
4. **One fumble chance from named factors** (of three approaches: this one; the strip try and the fight as separate
   draws, whose attempt rates public data can't identify, so they'd be invented; the field deciding in your games,
   which breaks "the engine decides, the field shows it"). When a fumble comes, a second draw names its reason.

## 1. The NFL target

nflverse play-by-play, regular seasons 2021–25. Runs (no scrambles or kneels), completions and scrambles that end in
bounds without a touchdown; no two-point tries. A fumble is the carrier's own (`fumbled_1_player_id`). Buckets read only
what's known before the snap, because a fumble ends the play where it happens: "a short gain" or "short of the sticks"
would be fumble-heavy *because* of the fumble. `scripts/research-fumbles.py` (§5) settles the final targets.

| Fumbles per 100 | Runs (n 60,151) | Catches (n 42,229) | Scrambles (n 3,307) |
| --- | --- | --- | --- |
| All | 1.46 | 1.31 | 1.75 |
| 1st and 2nd down | 1.34 | 1.35 | 1.51 |
| 3rd and 1–3 | 1.70 | 0.75 | — |
| 3rd and 4–9 | 2.93 | 1.19 | 2.77 |
| 3rd and 10+ | 3.21 | 1.55 | 1.94 |
| 4th down | 3.80 | 0.76 | — |
| Last 5:00, offense trailing | 2.16 | 1.73 | — |
| Last 5:00, offense leading | 1.15 | 1.69 | — |

**Forced:** a defender is credited with half of run fumbles (0.50; the rest he puts on the ground himself, botched
exchanges among them) and nearly all catch and scramble fumbles (0.95). **Lost:** 0.65 a hundred runs, 0.67 a hundred
catches.

**Between carriers:** backs with 150+ carries fumble 0.7 a hundred at the median, 1.4 at the 90th percentile; the
spread between them (sd 1.3 points) is 2.5 times what luck alone gives (0.5): ball security is real.

## 2. What decides a fumble

A new pure module, `match/fumbleOdds.ts`, like `sideline.ts` and `pocketChoice.ts`: it draws nothing and reads no
league. It gives one chance per tackle in bounds on a run, a catch, or a scramble (new). Each factor is a named
constant with a comment citing its bucket, and zero for a typical tackle (`TYPICAL`: ratings 12, energy 85, 1st and 10,
no habits, the two men at their medians).

```ts
export type ContactKind = 'run' | 'catch' | 'scramble';
export type FumbleWhy = 'strip' | 'hit' | 'fight' | 'own';
export interface ContactFacts {
  kind: ContactKind;
  down: number;
  toGo: number;
  /** The last 5:00, offense behind (by any) / ahead. */
  trailingLate: boolean;
  leadingLate: boolean;
  /** The weather's fumble multiplier (`wx.fumble`). */
  weather: number;
  carrier: { ballSecurity: number; energy: number; has(q: QuirkId): boolean };
  /** `sizeEdge(tackler, 'contact', carrier)`: the tackler's weight edge, in rating points. */
  size: number;
  tackler: { tackling: number; has(q: QuirkId): boolean };
}
export function fumbleOdds(f: ContactFacts): number;
/** Whether a defender forced it, then which reason: weighted by the leans that pushed the odds up. */
export function forcedOdds(kind: ContactKind): number;
export function fumbleWhy(f: ContactFacts, u: number): Exclude<FumbleWhy, 'own'>;
```

- **The play:** a base for each kind, fitted so a typical tackle sits on the "1st and 2nd down" row.
- **The carrier:** ball security (as today); Loose Carriage and High Knee raise it; Contact Averse lowers it (he goes
  down easy); fatigue below `TYPICAL.energy` raises it. (Gassed is a defensive lineman's habit, so it never carries
  the ball: no term.)
- **The tackler:** his tackling (`skill(tackler, 'tackling')`) and his size against the carrier's raise it; Ball
  Stripper and Thumper raise it; Arm Tackler lowers it.
- **He fights for extra yards** (the 'fight' lean): 3rd and 4th down with yards to go, and trailing late; Finishes
  Forward raises it.
- **The defense goes for the ball** (the 'strip' lean): the offense ahead late (the defense needs it back), and Ball
  Stripper. Protecting a lead late, the carrier covers it up: the run's 1.15 against 1.34.
- **Weather:** as today, a multiplier.
- **Out of bounds:** no fumble, as today.

The odds are clamped to [0.001, 0.08].

**Forced or not:** `forcedOdds` is 0.50 on a run and 0.95 on a catch or scramble (§1). Unforced ('own'): no defender
credited. Forced: `fumbleWhy` names the reason. A man fighting forward is 'fight'; a Thumper, or the tackler's size, is
'hit'; the defense going for it, or Ball Stripper, is 'strip'. Each is weighted by how far its leans raised the odds,
with a base split for a typical tackle.

## 3. What you see

- **Play text:** "…, stripped by B.Weber. FUMBLE, recovered by …"; "…, jarred loose by the hit (D.Pressley)"; "…,
  fighting for the extra yard, the ball comes out"; "…, puts it on the ground" ('own').
- **Stats:** `fumbles` and `fumblesLost` as today. `forcedFum` goes to the tackler only when it was forced.
- **Who recovers:** today's 52% to the defense, unchanged ("Fumble recoveries" is its own item).
- **Scrambles:** a fumble lost on a scramble is a turnover at the spot, as on a run.
- **Film (your games):** `FieldFacts.fw` carries the reason, and the stager shows it:
  - 'strip': the tackler at the carrier's side or back, the ball out at his hands;
  - 'hit': head-on, the ball out at contact;
  - 'fight': the carrier driving forward with a second defender closing in (film only, one tackler in the box score);
  - 'own': nobody at the ball.

  `FIELD_VERSION` bumps.

## 4. Engine wiring

The run's and the catch's fumble rolls (`gameSim.ts`, today's `RUN_FUMBLE`/`CATCH_FUMBLE` lines) build `ContactFacts`
and draw `fumbleOdds` on the game's stream. A fumble then draws `forcedOdds`, and `fumbleWhy` when forced. `scramble()`
gains the same roll after its tackle (in bounds, no slide). `fumbleOdds` in `gameSim.ts` and the two constants go.
`SimOptions.contactTap?: (t: ContactTap) => void` reports each tackle in bounds (kind, the situation, fumbled, forced,
why) for the check; nothing stored.

## 5. Checks and targets

- **`scripts/research-fumbles.py`:** the NFL measurement in §1. Cached under `work/nflverse`. Prints the tables
  `fumbles-core.ts` copies.
- **`npm run fumbles [-- games]`** (`scripts/fumbles.ts`, `scripts/fumbles-core.ts`, the shape of `npm run passer`):
  AI games tallied through `contactTap` by §1's buckets, with the NFL beside each line. A bucket is judged only when
  its tolerance is at least 3.5 standard errors; small ones are reported. Also judged: the forced share by kind, lost
  per 100, and the spread between carriers. Nothing may be ✗. `npm run sim` judges the buckets (`calibrate.ts`), so CI
  covers them.
- **Must hold:**
  - `sim`: turnovers, scoring, the leaders;
  - `quirks --effects`: Loose Carriage, High Knee, Contact Averse, Ball Stripper, Thumper, Arm Tackler, Finishes
    Forward each move fumbles the right way; their effect lines are reworded where they now do more;
  - `audit`: ball security and tackling still move play;
  - `parity` and `film`: the new shapes;
  - `endings`.

  No range is loosened.
- **Unit tests:**
  - `fumbleOdds.test.ts`: each factor leans its way; a typical tackle sits on the base; odds stay in bounds;
    `fumbleWhy` follows the leans; forced shares by kind.
  - Engine tests: a scramble fumble turns the ball over; no fumble out of bounds; `forcedFum` only on forced fumbles;
    `contactTap` reconciles with the log.
  - Film tests: each reason's shape.

## 6. Delivery

Version **0.4.6** (a follow-up item, the last number). `docs/MVP.md`'s "fumbles on contact" line ticked; `CLAUDE.md`
gets `npm run fumbles` and `match/fumbleOdds.ts`; the changelog.

## 7. Out of scope

- Botched exchanges (snaps, handoffs) as their own event: the run's base still carries the NFL's unforced fumbles.
- Who recovers the ball ("fumble recoveries"), a sack's strip ("a sack's yards and strip"), muffed kicks and return
  fumbles.
- Gang tackles in the engine, and any change to yards.

## Risks

- **The run's base carries exchange fumbles.** Half of NFL run fumbles are unforced, many of them in the backfield.
  The film shows those as 'own' at the tackle, not at the mesh.
- **Late-game and 3rd-and-long runs mix in QB runs and draws.** The buckets are fitted as measured, and the check
  reports the small ones.
- **League totals:** the engine's fumbles a game today are fitted to the sim's turnover range. Fitting per-touch rates
  must keep them there; if the two disagree, the sim's totals win, and the check says by how much.
