/**
 * The passer's choice once he has made his read (spec: docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md):
 * throw it, throw it away, or take off. Under pressure and from a clean pocket alike, when his read is covered.
 *
 * One choice among three: throw is the reference (utility zero), throwing it away and taking off each have a utility
 * from named terms, and the odds are their softmax. Every term is zero for a typical starter in a typical spot
 * (`TYPICAL`, 1st and 10 between the 20s, his read just open), so a league of typical men keeps the base odds. The
 * engine draws one number against them (`pocketCall`); this module draws nothing and reads no league.
 *
 * Every number cited is FTN charting joined to NGS pressure and nflverse play-by-play, regular seasons 2023–25
 * (`scripts/research-passer.py`), shares of dropbacks given pressure or a clean pocket.
 */
import type { QuirkId } from '../quirks';
import { clamp } from '../rng';
import type { PassDepth } from './coach';

export type PocketKind = 'throw' | 'away' | 'run';

export interface PocketPasser {
  /** `decisionMaking`, with the hurry-up and rattled terms passPlay already adds. */
  decisions: number;
  /** `skill(qb, 'scrambling')`. */
  scrambling: number;
  /** `skill(qb, 'pocketPresence')` (a muddy-pocket man's lift included). */
  pocket: number;
  /** `poiseOf(qb)`, 1–20. */
  poise: number;
  /** In-game energy, 0–100. */
  energy: number;
  /** Injuries this season and last, capped at 3. */
  hurt: number;
  /** How rattled he is this game (`GameSim.rattled`): 0, a half, or 1. */
  rattled: number;
  has(q: QuirkId): boolean;
}

export interface PocketFacts {
  pressured: boolean;
  /** His read's separation (`sep` in passPlay): below `OPEN` he's covered. */
  sep: number;
  depth: PassDepth;
  down: number;
  toGo: number;
  /** Yards to the goal line: the red zone at 20 or fewer, backed up at 90 or more. */
  toGoal: number;
  /** Behind by 1–16 in the last five minutes: a run that stays in bounds costs him the clock. */
  trailingLate: boolean;
  passer: PocketPasser;
}

export type PocketOdds = Record<PocketKind, number>;

/** The starter every term is centred on (the engine's rating middle; poise's trait middle; a game's typical energy). */
export const TYPICAL = { decisions: 12, scrambling: 12, pocket: 12, poise: 10, energy: 85 } as const;

/** The separation (the engine's own scale) at which his read counts as open: below it he's covered. */
export const OPEN = 0.34;

type ByPressure = { pressured: number; clean: number };

/** Log odds against throwing it. Pressured, past the sack: 9.1% thrown away, 7.6% scrambles of all pressured dropbacks
 * (22% sacked); clean: 1.23% and 4.25%. */
const AWAY: ByPressure = { pressured: -2.12, clean: -4.7 };
const RUN: ByPressure = { pressured: -2.06, clean: -3.03 };
/** Per point his read is covered (below `OPEN`), and per point it's open (above). */
const COVERED_AWAY = 0.19;
const COVERED_RUN = 0.18;
const OPEN_AWAY = -0.05;
const OPEN_RUN = -0.05;
/** 3rd down: he holds it for the sticks (pressured, thrown away 6.3–7.7% against 10.5% on early downs) and runs for
 * them (clean 5.1–5.5% against 3.9%), however far he has to go. */
const THIRD_AWAY = -0.38;
const THIRD_RUN = 0.18;
/** 3rd and 1–3: the sticks are right there (scrambles 9.2% pressured, 5.5% clean, the most of any down). */
const SHORT_RUN = 0.2;
/** 4th down under pressure: the drive ends either way (thrown away 3.1%). From a clean pocket he still throws it away
 * when nothing's there (1.5%, as on early downs). */
const FOURTH_AWAY = -1.31;
const FOURTH_RUN = 0.25;
/** The red zone: the field is tight and a sack costs the kick (thrown away 13.5% pressured, 2.1% clean). */
const RED_ZONE_AWAY: ByPressure = { pressured: 0.47, clean: 0.77 };
/** Backed up in his own end: clean, he doesn't leave the pocket toward his own end zone (2.9% against 3.9%); pressured,
 * he gets rid of it rather than take a sack there (thrown away 11.3%). */
const BACKED_UP_RUN = -0.39;
const BACKED_UP_AWAY = 0.25;
/** Trailing late: a run that stays in bounds runs the clock (pressured, 6.6% against 7.4%). */
const TRAILING_RUN = -0.25;
/** Per rating point: legs take him out; pocket presence keeps him in it under pressure; a good decision-maker throws it
 * away rather than force it; a cool head throws on time. */
const SCRAMBLING_RUN = 0.16;
const POCKET_RUN = -0.05;
const DECISIONS_AWAY = 0.04;
const POISE_AWAY = -0.04;
/** Per point of energy under `TYPICAL.energy`, and per injury this season and last: a worn or hurt man stays in. */
const TIRED_RUN = -0.02;
const HURT_RUN = -0.15;
/** A gunslinger throws it away a third as often: he forces the rest. */
const GUNSLINGER_AWAY = -Math.log(3);
/** He leaves before the route comes open: more on a clean deep read (the old 15% roll). */
const BAILS_RUN = 0.5;
const BAILS_DEEP_RUN = 0.6;
/** He throws from a muddy pocket rather than leave or give up on it. */
const MUDDY: { away: number; run: number } = { away: -0.3, run: -0.3 };
/** Rattled, he sees the rush before it comes: per point of rattled. */
const GHOSTS: { away: number; run: number } = { away: 0.6, run: 0.4 };

/** Outside the pocket: 60% of throwaways (68% pressured, 38% clean); a scrambler or a man who bails gets there. */
const OUTSIDE_BASE = -0.49;
const OUTSIDE_PRESSURED = 1.4;
const OUTSIDE_SCRAMBLING = 0.08;
const OUTSIDE_BAILS = 0.5;

/** Intentional grounding on a throwaway, before the crew's flag volume (0.19 a game, 88% under pressure). */
const GROUNDING = { inside: 0.13, outside: 0.05, clean: 0.035 } as const;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/** The two utilities against throwing it (zero). */
function utilities(f: PocketFacts): { away: number; run: number } {
  const c = f.passer;
  const side = f.pressured ? 'pressured' : 'clean';
  // How hard he reads the situation: decisions 12 reads it as the league does, a poor decision-maker barely.
  const sharp = 0.5 + c.decisions / 24;
  let away = AWAY[side];
  let run = RUN[side];

  const covered = Math.max(0, OPEN - f.sep);
  const open = Math.max(0, f.sep - OPEN);
  away += COVERED_AWAY * covered + OPEN_AWAY * open;
  run += COVERED_RUN * covered + OPEN_RUN * open;

  let sitAway = 0;
  let sitRun = 0;
  if (f.down === 3) {
    sitAway += THIRD_AWAY;
    sitRun += THIRD_RUN + (f.toGo <= 3 ? SHORT_RUN : 0);
  } else if (f.down === 4) {
    if (f.pressured) sitAway += FOURTH_AWAY;
    sitRun += FOURTH_RUN;
  }
  if (f.toGoal <= 20) sitAway += RED_ZONE_AWAY[side];
  if (f.toGoal >= 90) {
    if (f.pressured) sitAway += BACKED_UP_AWAY;
    else sitRun += BACKED_UP_RUN;
  }
  if (f.trailingLate) sitRun += TRAILING_RUN;
  away += sharp * sitAway;
  run += sharp * sitRun;

  run += SCRAMBLING_RUN * (c.scrambling - TYPICAL.scrambling);
  run += TIRED_RUN * Math.max(0, TYPICAL.energy - c.energy) + HURT_RUN * Math.min(3, c.hurt);
  if (f.pressured) {
    run += POCKET_RUN * (c.pocket - TYPICAL.pocket);
    away += DECISIONS_AWAY * (c.decisions - TYPICAL.decisions) + POISE_AWAY * (c.poise - TYPICAL.poise);
  }

  if (c.has('gunslinger')) away += GUNSLINGER_AWAY;
  if (c.has('bailsEarly')) run += BAILS_RUN + (!f.pressured && f.depth === 'deep' ? BAILS_DEEP_RUN : 0);
  if (f.pressured && c.has('muddyPockets')) {
    away += MUDDY.away;
    run += MUDDY.run;
  }
  if (c.rattled > 0 && c.has('seesGhosts')) {
    away += GHOSTS.away * c.rattled;
    run += GHOSTS.run * c.rattled;
  }
  return { away, run };
}

export function pocketOdds(f: PocketFacts): PocketOdds {
  const u = utilities(f);
  const ea = Math.exp(u.away);
  const er = Math.exp(u.run);
  // Bounds wide enough for the NFL's most extreme men and no wider; throw takes the rest.
  const away = clamp(ea / (1 + ea + er), 0.002, 0.45);
  const run = clamp(er / (1 + ea + er), 0.002, 0.5);
  return { throw: 1 - away - run, away, run };
}

/** One uniform draw makes the call: thrown away, else a run, else the throw. */
export function pocketCall(o: PocketOdds, u: number): PocketKind {
  if (u < o.away) return 'away';
  if (u < o.away + o.run) return 'run';
  return 'throw';
}

/** The chance a throwaway comes from outside the pocket (rolled out past the tackle first). */
export function outsideOdds(f: PocketFacts): number {
  const c = f.passer;
  return logistic(
    OUTSIDE_BASE +
      (f.pressured ? OUTSIDE_PRESSURED : 0) +
      OUTSIDE_SCRAMBLING * (c.scrambling - TYPICAL.scrambling) +
      (c.has('bailsEarly') ? OUTSIDE_BAILS : 0),
  );
}

/** The chance a throwaway is flagged as intentional grounding, before the crew's flag volume. */
export function groundingOdds(pressured: boolean, outside: boolean): number {
  if (!pressured) return GROUNDING.clean;
  return outside ? GROUNDING.outside : GROUNDING.inside;
}
