/**
 * Hand-built open fields for tests: a man with even skills at a spot, a start around them, and random starts. Pure,
 * seeded; nothing here is read by the sim.
 */
import { Rng } from '../rng';
import { SIZE } from '../size';
import type { Position } from '../types';
import type { Role } from './cast';
import { FIELD_W } from './geometry';
import { KNOBS } from './tuning';
import type { FieldPlayer, FieldSkills, FieldStart } from './types';

const POS_OF: Record<Role, Position> = {
  QB: 'QB',
  OL: 'OL',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  DT: 'DT',
  EDGE: 'EDGE',
  LB: 'LB',
  CB: 'CB',
  S: 'S',
  K: 'K',
  P: 'P',
  RET: 'WR',
  ST: 'LB',
};

/** Even skills (12) at a role's median build, with any overrides. */
export function skillsOf(role: Role, o: Partial<FieldSkills> = {}): FieldSkills {
  const pos = POS_OF[role];
  return {
    pos,
    h: SIZE[pos].h[0],
    w: SIZE[pos].w[0],
    speed: 12,
    burst: 12,
    reads: 12,
    pursuit: 12,
    tackle: 12,
    shed: 12,
    block: 12,
    move: 12,
    ret: 12,
    power: 12,
    ...o,
  };
}

export function man(
  id: number,
  side: 0 | 1,
  role: Role,
  x: number,
  y: number,
  o: { vx?: number; vy?: number; s?: Partial<FieldSkills> } = {},
): FieldPlayer {
  return { id, side, role, x, y, vx: o.vx ?? 0, vy: o.vy ?? 0, s: skillsOf(role, o.s) };
}

/** A start around `players`: the carrier is the first man on side 0 unless named; the yards count from his x. */
export function startOf(p: Partial<FieldStart> & { players: FieldPlayer[] }): FieldStart {
  const carrier = p.carrier ?? p.players.find((m) => m.side === 0)!.id;
  const c = p.players.find((m) => m.id === carrier)!;
  return {
    kind: 'run',
    t0: 0,
    dir: 1,
    yardLine: c.x,
    blocks: [],
    clock: { outOfBounds: false, stayIn: false },
    edge: 0,
    tired: false,
    ...p,
    carrier,
  };
}

const OFF: Role[] = ['QB', 'OL', 'OL', 'OL', 'OL', 'OL', 'TE', 'WR', 'WR', 'WR'];
const DEF: Role[] = ['DT', 'DT', 'EDGE', 'EDGE', 'LB', 'LB', 'LB', 'CB', 'CB', 'S', 'S'];

/** A random open field of 22 around a running back, its skills spread 6–18, a few blocks in place. */
export function randomStart(seed: string): FieldStart {
  const rng = new Rng(seed);
  const dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const cx = rng.float(5, 95);
  const cy = rng.float(2, FIELD_W - 2);
  const skills = () => ({
    speed: rng.float(6, 18),
    burst: rng.float(6, 18),
    reads: rng.float(6, 18),
    pursuit: rng.float(6, 18),
    tackle: rng.float(6, 18),
    shed: rng.float(6, 18),
    block: rng.float(6, 18),
    move: rng.float(6, 18),
    power: rng.float(6, 18),
  });
  const near = (spread: number, ahead: number) => ({
    x: Math.max(-9, Math.min(109, cx + dir * rng.float(-spread / 2, ahead))),
    y: Math.max(1, Math.min(FIELD_W - 1, cy + rng.float(-spread, spread))),
  });
  const heading = rng.float(-0.6, 0.6);
  const v = rng.float(2, 8);
  const players: FieldPlayer[] = [
    man(1, 0, 'RB', cx, cy, { vx: dir * v * Math.cos(heading), vy: v * Math.sin(heading), s: skills() }),
  ];
  OFF.forEach((role, i) => {
    const p = near(16, 12);
    players.push(man(10 + i, 0, role, p.x, p.y, { s: skills() }));
  });
  DEF.forEach((role, i) => {
    const p = near(20, 30);
    players.push(man(30 + i, 1, role, p.x, p.y, { s: skills() }));
  });
  const blocks: FieldStart['blocks'] = [];
  for (let i = 0; i < 3; i++) {
    const b = players[2 + i];
    const d = players[11 + i];
    d.x = b.x + dir * 0.9;
    d.y = b.y;
    blocks.push({ blocker: b.id, defender: d.id, holdFor: rng.float(0, 1.5) });
  }
  return startOf({ players, dir, blocks, carrier: 1 });
}

/**
 * The knobs the rule tests are written against (the starting values, before any fit): a rule test checks the rule, not
 * the fitted numbers, which parity and film judge.
 */
export const RULE_KNOBS: typeof KNOBS = {
  react: 1,
  angle: 1,
  tackle: 0.72,
  move: 0.25,
  afterContact: 1.2,
  shed: 0.9,
  hold: 0.6,
  line: 1,
  speed: 0.15,
  skill: 1,
  outLine: 4,
  outGain: 3,
  pad: 0,
  stretch: 3,
  retTackle: 0,
  retHold: 0.5,
  carrier: 1,
  diveReach: 2.5,
  dive: -0.2,
};

/** Set the rule knobs for a test file; returns what puts the shipped ones back. */
export function pinKnobs(): () => void {
  const was = { ...KNOBS };
  Object.assign(KNOBS, RULE_KNOBS);
  return () => Object.assign(KNOBS, was);
}
