/**
 * A fumble on contact (spec: docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md): the chance a carrier
 * tackled in bounds puts the ball on the ground, from the hit (the tackler's tackling, size and habits), the carrier
 * (ball security, fatigue, habits), the fight for extra yards (the down and distance, trailing late) and a defense going
 * for the ball, and the weather. Then, when it comes out, whether a defender forced it and why.
 *
 * Odds are the play's base times exp(the sum of named terms), each zero for a typical tackle (`TYPICAL`, 1st and 10, no
 * habits, the two men's builds even), times the weather. This module draws nothing and reads no league.
 *
 * Every number cited is nflverse play-by-play, regular seasons 2021–25 (`scripts/research-fumbles.py`): fumbles per 100
 * runs, catches and scrambles that end in bounds without a touchdown, by what's known before the snap.
 */
import type { QuirkId } from '../quirks';
import type { Position } from '../types';
import { clamp } from '../rng';

export type ContactKind = 'run' | 'catch' | 'scramble';
/** Why the ball came out: stripped, jarred loose by the hit, fighting for the extra yard, or his own (unforced). */
export type FumbleWhy = 'strip' | 'hit' | 'fight' | 'own';

export interface ContactFacts {
  kind: ContactKind;
  down: number;
  toGo: number;
  /** The last 5:00, the offense behind (by any) / ahead. */
  trailingLate: boolean;
  leadingLate: boolean;
  /** The weather's fumble multiplier (`wx.fumble`). */
  weather: number;
  carrier: { position: Position; ballSecurity: number; energy: number; has(q: QuirkId): boolean };
  /** `sizeEdge(tackler, 'contact', carrier)`: the tackler's weight edge, in rating points. */
  size: number;
  tackler: { tackling: number; has(q: QuirkId): boolean };
}

/** The tackle every term is centred on: the engine's rating middle and a game's typical energy. */
export const TYPICAL = { ballSecurity: 12, tackling: 12, energy: 85 } as const;
/**
 * A carrier's ball security is read against his position's typical man (the median a league is built with), so a
 * quarterback's sneak or a receiver's reverse is no riskier for his position's lower ratings: the lean tells men of a
 * position apart, and the play's base sets the level (the NFL's buckets mix every position).
 */
export const PEER_SECURITY: Partial<Record<Position, number>> = { QB: 8, RB: 11, WR: 8, TE: 7 };

type ByKind = Record<ContactKind, number>;

/** A typical tackle on 1st and 2nd down, fitted on weeks 1 and 10 of played seasons (as `npm run sim` reads them:
 * injuries in, backups carrying) so the league's 1st and 2nd downs land on the NFL's runs 1.34 a hundred, catches
 * 1.35, scrambles 1.51 (its carriers, tacklers and legs aren't all typical). */
const BASE: ByKind = { run: 0.0155, catch: 0.015, scramble: 0.0187 };
/** Per point of ball security against his position's typical man: catches and scrambles as the engine had it; a
 * back's carries lean hard, so backs truly differ as the NFL's do (the sd of their rates over 150+ carries less what
 * luck gives, 0.0117: a back a point under his peers fumbles half again as often). */
const SECURITY: ByKind = { run: -0.44, catch: -0.12, scramble: -0.13 };
/** Carrying it loose (the old LOOSE_CARRIAGE), the knees high, and a man who goes down easy (runs). */
const LOOSE = Math.log(1.6);
const HIGH_KNEE = Math.log(1.3);
const CONTACT_AVERSE = Math.log(0.7);
/** Per point of energy under `TYPICAL.energy`: a worn man holds it looser (a small lean: the NFL's buckets can't tell
 * it from the late game's). */
const TIRED = 0.0055;
/** Per point of the tackler's tackling and of his weight edge: a square, heavy hit jars it loose. */
const TACKLING = 0.03;
const SIZE = 0.05;
/** A stripper rips at it, a thumper jars it, an arm tackler barely touches it. */
const STRIPPER = Math.log(1.5);
const THUMPER = Math.log(1.3);
const ARM = Math.log(0.8);
/** He fights for the sticks: 3rd and 1–3 (runs 1.70, catches 0.75: a short catch is a sure one), 3rd and 4+ (runs
 * 2.93–3.21, catches 1.19–1.55), 4th (runs 3.80, catches 0.76). */
const THIRD_SHORT: ByKind = { run: 0.31, catch: -0.57, scramble: 0 };
const THIRD_LONG: ByKind = { run: 1.07, catch: 0, scramble: 0.62 };
const FOURTH: ByKind = { run: 1.36, catch: -0.72, scramble: 0.4 };
/** Trailing late he fights for every yard (runs 2.16, catches 1.73, scrambles 2.70; on top of the late game's downs). */
const TRAILING: ByKind = { run: 0.18, catch: 0.32, scramble: 0.3 };
/** A man who finishes forward fights for the extra yard every time. */
const FINISHES = 0.2;
/** Ahead late the defense needs the ball back and goes for it, and a back covers it up: runs 1.15 against 1.34 (the
 * cover wins), catches 1.69 against 1.35 (it doesn't). */
const DEFENSE_NEEDS_IT = 0.28;
const COVER = -0.69;

/** A defender forced it: half of run fumbles (the rest he puts down himself, botched exchanges among them), 95% of
 * catches' and scrambles'. */
const FORCED: ByKind = { run: 0.5, catch: 0.95, scramble: 0.95 };
/** How a typical forced fumble divides before its leans: stripped, the hit, fighting forward. */
const WHY_BASE = { strip: 0.4, hit: 0.4, fight: 0.2 } as const;

/** Each term, by the reason it speaks for (`fumbleWhy`); the carrier's own terms speak for none. */
function terms(f: ContactFacts): { strip: number; hit: number; fight: number; carrier: number } {
  const { kind, carrier: c, tackler: t } = f;
  let carrier = SECURITY[kind] * (c.ballSecurity - (PEER_SECURITY[c.position] ?? TYPICAL.ballSecurity));
  if (c.has('looseCarriage')) carrier += LOOSE;
  if (kind === 'run' && c.has('highKnee')) carrier += HIGH_KNEE;
  if (kind === 'run' && c.has('contactAverse')) carrier += CONTACT_AVERSE;
  carrier += TIRED * Math.max(0, TYPICAL.energy - c.energy);
  if (f.leadingLate && kind === 'run') carrier += COVER;

  let hit = TACKLING * (t.tackling - TYPICAL.tackling) + SIZE * f.size;
  if (t.has('thumper')) hit += THUMPER;
  if (t.has('armTackler')) hit += ARM;

  let strip = t.has('ballStripper') ? STRIPPER : 0;
  if (f.leadingLate) strip += DEFENSE_NEEDS_IT;

  let fight = 0;
  if (f.down === 3) fight += f.toGo <= 3 ? THIRD_SHORT[kind] : THIRD_LONG[kind];
  else if (f.down === 4) fight += FOURTH[kind];
  if (f.trailingLate) fight += TRAILING[kind];
  if (c.has('finishesForward')) fight += FINISHES;
  return { strip, hit, fight, carrier };
}

export function fumbleOdds(f: ContactFacts): number {
  const t = terms(f);
  return clamp(BASE[f.kind] * Math.exp(t.strip + t.hit + t.fight + t.carrier) * f.weather, 0.001, 0.08);
}

export function forcedOdds(kind: ContactKind | 'sack'): number {
  return kind === 'sack' ? SACK_FORCED : FORCED[kind];
}

/** Why a forced fumble came out: each reason weighted by its base share plus how far its leans raised the odds. */
export function fumbleWhy(f: ContactFacts, u: number): Exclude<FumbleWhy, 'own'> {
  const t = terms(f);
  const w = {
    strip: WHY_BASE.strip + Math.max(0, t.strip),
    hit: WHY_BASE.hit + Math.max(0, t.hit),
    fight: WHY_BASE.fight + Math.max(0, t.fight),
  };
  const total = w.strip + w.hit + w.fight;
  if (u * total < w.strip) return 'strip';
  if (u * total < w.strip + w.hit) return 'hit';
  return 'fight';
}

// ───────── the strip-sack (spec: docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md) ─────────

/** Where the rusher got home from: off the edge (an edge rusher, a DB blitzing) or up the middle (a tackle, a
 * linebacker). NFL sack fumbles: edge 14.0% (n 3,960), a DB 13.1% (519), a linebacker 8.6% (637), interior 8.0% (1,416). */
export type RushSpot = 'edge' | 'interior';

export function rushSpot(position: Position): RushSpot {
  return position === 'DT' || position === 'LB' ? 'interior' : 'edge';
}

export interface SackFacts {
  down: number;
  toGo: number;
  trailingLate: boolean;
  leadingLate: boolean;
  /** The weather's fumble multiplier (`wx.fumble`). */
  weather: number;
  qb: { ballSecurity: number; energy: number; has(q: QuirkId): boolean };
  rusher: { spot: RushSpot; tackling: number; has(q: QuirkId): boolean };
  /** `sizeEdge(rusher, 'contact', qb)`: the rusher's weight edge, in rating points. */
  size: number;
}

/** A typical sack on 1st and 2nd down by an edge rusher: 13.8 a hundred (NFL early downs, n 3,718). */
const STRIP_BASE = 0.138;
/** Up the middle: a tackle collapses the pocket face on, he doesn't reach the arm (8.0 against 14.0). */
const STRIP_INTERIOR = Math.log(8.0 / 14.0);
/** Per point of ball security against a typical quarterback's. */
const QB_SECURITY = -0.08;
/** He pats the ball before he throws (the old flat 18% against 10%). */
const PATS = Math.log(1.8);
/** 3rd down he's braced for the hit and gets rid of it (10.2 against 13.8); trailing late he holds on for the big play
 * (15.9). 4th down (n 193) and leading late (n 121) are too few to set a lean. */
const STRIP_THIRD = Math.log(10.2 / 13.8);
const STRIP_TRAILING = Math.log(15.9 / 13.8);
/** Forced: 747 of 810 NFL sack fumbles. */
const SACK_FORCED = 0.92;

export function sackStripOdds(f: SackFacts): number {
  const { qb, rusher } = f;
  let x = rusher.spot === 'interior' ? STRIP_INTERIOR : 0;
  x += QB_SECURITY * (qb.ballSecurity - (PEER_SECURITY.QB ?? TYPICAL.ballSecurity));
  if (qb.has('patsTheBall')) x += PATS;
  x += TIRED * Math.max(0, TYPICAL.energy - qb.energy);
  x += TACKLING * (rusher.tackling - TYPICAL.tackling) + SIZE * f.size;
  if (rusher.has('thumper')) x += THUMPER;
  if (rusher.has('armTackler')) x += ARM;
  if (rusher.has('ballStripper')) x += STRIPPER;
  if (f.down === 3) x += STRIP_THIRD;
  if (f.trailingLate) x += STRIP_TRAILING;
  return clamp(STRIP_BASE * Math.exp(x) * f.weather, 0.02, 0.3);
}
