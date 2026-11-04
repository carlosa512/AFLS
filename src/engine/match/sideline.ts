/**
 * Out of bounds as the carrier's choice (spec: docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md).
 *
 * Most men who go out of bounds are put there: in the NFL three catches in four that end out of bounds are "pushed ob",
 * a defender running him out. The rest step out ("ran ob"), and that part is his choice: the clock, the first-down
 * marker, the hit coming, the room ahead, his habits, build and health. So two odds, both logistic in a sum of named
 * terms, each term zero for a typical starter (`TYPICAL`) so a league of typical men keeps its totals. The engine draws
 * one number against them (`sidelineCall`); this module draws nothing and reads no league.
 *
 * Every number cited is nflverse play-by-play, regular seasons 2021–25 (`scripts/research-sideline.py`): touchdowns,
 * lost fumbles, two-point tries and laterals left out. "Stepped" odds are given he wasn't pushed.
 */
import type { QuirkId } from '../quirks';
import { clamp } from '../rng';
import type { Position } from '../types';

export type SidelineKind = 'run' | 'catch' | 'scramble';
/** What the clock asks of him, only when going out stops it (`oobStopsClock`): out (hurrying), in (milking), none. */
export type ClockAsk = 'out' | 'in' | 'none';

export interface SidelineCarrier {
  /** His position: tight ends and backs stay in and fight on catches where receivers step out. */
  position: Position;
  /** `skill(p, 'longSpeed')`: a fast man reaches the edge. */
  speed: number;
  /** `sizeZ(p).w`: his weight in sd from his position's median. */
  build: number;
  /** In-game energy, 0–100. */
  energy: number;
  /** Injuries this season and last, capped at 3. */
  hurt: number;
  /** `poiseOf(p)`, 1–20: how well he reads what the clock wants. */
  poise: number;
  has(q: QuirkId): boolean;
}

export interface SidelineChaser {
  /** `skill(p, 'pursuit')`: he takes the angle that runs a man to the sideline. */
  pursuit: number;
  /** `skill(p, 'tackling')`: he brings him down in bounds first. */
  tackling: number;
  has(q: QuirkId): boolean;
}

export interface SidelineFacts {
  kind: SidelineKind;
  /** How wide he is: |lane|, 0 the middle, 1 the sideline. */
  wide: number;
  /** Yards he ran with it: a run's or scramble's gain, a catch's yards after the catch. */
  run: number;
  /** He broke a tackle or got past the safety: room ahead and nobody on him. */
  free: boolean;
  clock: ClockAsk;
  /** 3rd or 4th down, the gain short of the line to gain. */
  shortOfSticks: boolean;
  /** Runs: the edge setter's `skill(p, 'setEdge')`; `TYPICAL.edge` otherwise. */
  edge: number;
  carrier: SidelineCarrier;
  chaser: SidelineChaser;
}

/** `stepped` is given he wasn't pushed. */
export interface SidelineOdds {
  pushed: number;
  stepped: number;
}
export type SidelineCall = 'in' | 'pushed' | 'stepped';

/** The starter every term is centred on (the engine's rating middle; poise's trait middle; a game's typical energy). */
export const TYPICAL = { speed: 12, pursuit: 12, tackling: 12, edge: 12, poise: 10, energy: 85 } as const;

type ByKind = Record<SidelineKind, number>;

// ── Pushed out ──
/** In the middle: catches 2.9%; inside runs 0.6%. Scrambles always head wide: 14.6% of them are pushed out. */
const PUSH_BASE: ByKind = { catch: -4.1, run: -6.1, scramble: -1.77 };
/** At the sideline (`wide` 1): catches to the sideline 20.6%; outside runs 9.2%. */
const PUSH_WIDE: ByKind = { catch: 3.9, run: 3.8, scramble: 0 };
/** Per yard past four, to twenty: long gains drift to the sideline as the pursuit angles close (outside runs 4.3% with
 * no gain, 26.0% at 10+, 38.0% at 20+; catches 11.9% / 17.8% / 26.6% by yards after the catch). */
const PUSH_RUN: ByKind = { catch: 0.07, run: 0.1, scramble: 0 };
/** Protecting a lead late he cuts back inside: catches in the last 5:00 leading, 11.4% against 16.8%. */
const PUSH_IN: ByKind = { catch: -0.45, run: -0.45, scramble: -0.2 };
/** Per rating point: the chaser's angle runs him out, his tackle brings him down first; the carrier's speed gets him
 * to the edge; a good edge setter turns a run back inside before it reaches the sideline. */
const PUSH_PURSUIT = 0.05;
const PUSH_TACKLING = -0.05;
const PUSH_SPEED = 0.05;
const PUSH_EDGE = -0.04;
/** Habits that run a man out (or bring him down in bounds), and carriers who drift to the sideline. */
const PUSH_HABIT = 0.3;

// ── Stepped out (given not pushed) ──
/** In the middle: catches 0.9%; inside runs 0.1%; scrambles 24.9% (21.3% of all, 14.6% pushed). */
const STEP_BASE: ByKind = { catch: -4.6, run: -7.0, scramble: -1.1 };
/** At the sideline: catches 8.8%; outside runs 2.1%. */
const STEP_WIDE: ByKind = { catch: 2.3, run: 3.0, scramble: 0 };
/** Per yard past four, to twenty, on the ground: a long run ends at the sideline with the pursuit there (outside runs:
 * 0.6% stepped with no gain, 5.8% at 10+). */
const STEP_GAIN: ByKind = { catch: 0, run: 0.08, scramble: 0.03 };
/** The clock wants it stopped and it stops: catches 5.0% → 9.2% hurrying, scrambles 20.8% → 26.1%. */
const STEP_OUT: ByKind = { catch: 0.66, run: 0.3, scramble: 0.31 };
/** The clock wants to run: protecting a lead, catches 4.5% (against 5.0%), outside runs 0.9% (2.0%), scrambles 12.8%. */
const STEP_IN: ByKind = { catch: -0.1, run: -0.8, scramble: -0.6 };
/** Catches: tight ends and backs stay in and fight (Kelce 1%, Kittle 2%, Ekeler 1% against receivers' 7.9%). */
const STEP_POS: Partial<Record<Position, number>> = { TE: -1.2, RB: -0.8 };
/** A catch with the hit right there (two yards after it or fewer): stepped-out catches gain a median of one. */
const STEP_ROOM_SHORT = 0.8;
/** Room ahead and nobody on him: he keeps going. */
const STEP_FREE = -2.0;
/** Short of the sticks on 3rd or 4th he fights for the marker: 1.4% stepped against 7.1% past them. */
const STEP_STICKS = -1.4;
const STEP_HABITS: Partial<Record<QuirkId, number>> = {
  contactAverse: 0.6,
  hearsFootsteps: 0.5,
  runsEastWest: 0.4,
  finishesForward: -0.6,
  yacSlasher: -0.4,
  highKnee: -0.4,
};
/** A scrambler who bails early heads for the sideline, not the hit. */
const STEP_BAILS = 0.4;
/** Per sd of weight for his position: big men stay in and fight. */
const STEP_BUILD = -0.35;
/** Per point of energy under `TYPICAL.energy`: a worn man takes the sideline over the hit. */
const STEP_TIRED = 0.03;
/** Per injury this season and last: a man who's been hurt protects himself. */
const STEP_HURT = 0.2;
/** A no-huddle quarterback's feel for the clock. */
const NO_HUDDLE = 1.3;

/** The chance a tackle is credited on a stepped-out catch (NFL 50%); runs and scrambles credit one always. */
const CREDIT_STEPPED_CATCH = 0.55;
const CREDIT_STEPPED_FREE = 0.15;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
/** Yards past four, to twenty: the room term's reach. */
const past4 = (run: number) => clamp(run, 0, 20) - 4;

export function sidelineOdds(f: SidelineFacts): SidelineOdds {
  const { kind, carrier: c, chaser: d } = f;
  // How hard he reads the clock: poise 10 reads it as the league does, a rattled man barely, a cool one sharper.
  const clockRead = (0.5 + c.poise / 20) * (c.has('noHuddle') ? NO_HUDDLE : 1);

  let push = PUSH_BASE[kind] + PUSH_WIDE[kind] * f.wide + PUSH_RUN[kind] * past4(f.run);
  if (f.clock === 'in') push += PUSH_IN[kind];
  push += PUSH_PURSUIT * (d.pursuit - TYPICAL.pursuit) + PUSH_TACKLING * (d.tackling - TYPICAL.tackling);
  push += PUSH_SPEED * (c.speed - TYPICAL.speed);
  if (kind === 'run') push += PUSH_EDGE * (f.edge - TYPICAL.edge) * f.wide;
  for (const q of ['alleyCrusher', 'scraper', 'businessDecision'] as const) if (d.has(q)) push += PUSH_HABIT;
  if (d.has('thumper')) push -= PUSH_HABIT;
  if (c.has('runsEastWest')) push += PUSH_HABIT;
  if (kind === 'run' && c.has('bouncesExternal')) push += PUSH_HABIT;

  let step = STEP_BASE[kind] + STEP_WIDE[kind] * f.wide + STEP_GAIN[kind] * past4(f.run);
  if (f.clock === 'out') step += STEP_OUT[kind] * clockRead;
  if (f.clock === 'in') step += STEP_IN[kind] * clockRead;
  if (kind === 'catch') {
    step += STEP_POS[c.position] ?? 0;
    if (f.run <= 2) step += STEP_ROOM_SHORT;
  }
  if (f.free) step += STEP_FREE;
  if (f.shortOfSticks) step += STEP_STICKS;
  for (const [q, v] of Object.entries(STEP_HABITS) as [QuirkId, number][]) if (c.has(q)) step += v;
  if (kind === 'scramble' && c.has('bailsEarly')) step += STEP_BAILS;
  step += STEP_BUILD * c.build;
  step += STEP_TIRED * Math.max(0, TYPICAL.energy - c.energy);
  step += STEP_HURT * Math.min(3, c.hurt);

  // Bounds wide enough for the NFL's most extreme men (Murray steps out on 51% of his scrambles) and no wider.
  return { pushed: clamp(logistic(push), 0.002, 0.6), stepped: clamp(logistic(step), 0.001, 0.65) };
}

/** One uniform draw makes the call: pushed out, else stepped out, else in bounds. */
export function sidelineCall(o: SidelineOdds, u: number): SidelineCall {
  if (u < o.pushed) return 'pushed';
  if (u < o.pushed + (1 - o.pushed) * o.stepped) return 'stepped';
  return 'in';
}

/** The chance a tackle is credited when he stepped out: the scorer credits whoever forced him (runs and scrambles
 * always); on a catch, about half (a man stepping out with nobody near gets none). */
export function steppedCredit(f: SidelineFacts): number {
  if (f.kind !== 'catch') return 1;
  return f.free ? CREDIT_STEPPED_FREE : CREDIT_STEPPED_CATCH;
}
