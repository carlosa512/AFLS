/**
 * The skills the open field reads, each from a contest (`skill`): the attribute registry's rule holds, every rating that
 * counts has a job and the audit proves it. Size comes from `size.ts`.
 */
import { CONTESTS, skill, type ContestName } from '../attributes';
import { FILM_HABITS, type QuirkId } from '../quirks';
import type { Attribute, Player, Position } from '../types';
import { FIELD_HABITS } from './habits';
import type { FieldSkills } from './types';

/** Every contest the open field reads. */
export const FIELD_CONTESTS: readonly ContestName[] = [
  'longSpeed',
  'burst',
  'reads',
  'pursuit',
  'tackling',
  'runDefense',
  'runFit',
  'runBlocking',
  'afterCatch',
  'returns',
  'breakTackles',
];

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The contest a man sheds a block with: the front's run defense, the second level's run fit, tackling for the rest. */
const shedContest = (pos: Position): ContestName =>
  pos === 'DT' || pos === 'EDGE' ? 'runDefense' : pos === 'LB' || pos === 'S' ? 'runFit' : 'tackling';

/**
 * One man as the open field reads him; `habits` gives his active quirks (the engine's `activeQuirks`). He keeps the
 * ones the field plays and the ones the film shows before possession (the approach stages them).
 */
export function fieldSkills(p: Player, habits: (p: Player) => readonly QuirkId[]): FieldSkills {
  const s: FieldSkills = {
    pos: p.position,
    h: p.heightIn,
    w: p.weightLb,
    speed: r2(skill(p, 'longSpeed')),
    burst: r2(skill(p, 'burst')),
    reads: r2(skill(p, 'reads')),
    pursuit: r2(skill(p, 'pursuit')),
    tackle: r2(skill(p, 'tackling')),
    shed: r2(skill(p, shedContest(p.position))),
    block: r2(skill(p, 'runBlocking')),
    move: r2(skill(p, 'afterCatch')),
    ret: r2(skill(p, 'returns')),
    power: r2(skill(p, 'breakTackles')),
  };
  if (p.playsBig) s.big = 1;
  const field = habits(p)
    .filter((q) => FIELD_HABITS.has(q) || FILM_HABITS.has(q))
    .sort();
  if (field.length) s.habits = field;
  return s;
}

/** The field's main jobs at a position: top speed, and what he does with the ball, a block or a tackle. */
const MAIN_JOBS: Record<Position, readonly ContestName[]> = {
  QB: ['longSpeed', 'breakTackles'],
  RB: ['longSpeed', 'breakTackles'],
  WR: ['longSpeed', 'breakTackles'],
  TE: ['longSpeed', 'breakTackles', 'runBlocking'],
  OL: ['runBlocking'],
  DT: ['longSpeed', 'runDefense', 'tackling'],
  EDGE: ['longSpeed', 'runDefense', 'tackling'],
  LB: ['longSpeed', 'tackling'],
  CB: ['longSpeed', 'tackling'],
  S: ['longSpeed', 'tackling'],
  K: [],
  P: [],
};

/** Attributes that weigh at least half of a main field job at `pos`: the audit expects each to move spatial play. */
export function fieldJobs(pos: Position): Attribute[] {
  const out = new Set<Attribute>();
  for (const c of MAIN_JOBS[pos])
    for (const [a, w] of Object.entries(CONTESTS[c].weights) as [Attribute, number][]) if (w >= 0.5) out.add(a);
  return [...out];
}
