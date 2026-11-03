import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame } from '../match/gameSim';
import { actorsIn } from '../playActors';
import { Rng } from '../rng';
import type { QuirkId } from '../quirks';
import { snapYFor } from './geometry';
import { castFor } from './cast';
import { lineUp } from './formations';
import { holeAt, planRunBlocks, runCall, type RunCall } from './runBlocks';
import { SPEED } from './speed';

const league = createLeague({ seed: 'stage' });
const runs = Array.from({ length: 12 }, (_, i) => {
  const g = league.games[i];
  const r = simulateGame(league, g, { keepPlays: true, seed: `st-${i}` });
  return r.plays!.flatMap((e, index) => {
    if (e.kind !== 'run' || e.from === undefined || e.down <= 0) return [];
    const cast = castFor(r.field!, r.plays!, index, g.homeId);
    const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
    const ballY = snapYFor(e, 20 + (index % 14));
    const off = r.field!.scheme[cast.offSide];
    const start = lineUp(e, cast, off, r.field!.scheme[1 - cast.offSide], e.from, ballY, dir, new Rng(`f:${index}`));
    return [{ e, cast, dir, ball: { x: e.from, y: ballY }, start, scheme: off.offense }];
  });
}).flat();

type Run = (typeof runs)[number];

/** The plan for a run as the stager makes it, the back running at the hole from the handoff. */
function plan(x: Run, call?: RunCall, habits = new Map<number, Set<QuirkId>>()) {
  const read = runCall(x.e, x.scheme, new Rng(`call:${x.e.text}`));
  const c = call ?? read.call;
  const hole = holeAt(c, read.side, x.ball, x.dir, !!x.e.open?.bounce);
  const who = actorsIn(x.e);
  const back = x.start.get(who.ball ?? -1) ?? x.ball;
  const exclude = new Set([who.tackle, x.e.open?.broke?.by].filter((id): id is number => id !== undefined));
  const handoff = 0.8;
  const backAt = (t: number) => {
    const g = Math.max(0, Math.min(1, (t - handoff) / 1.6));
    return { x: back.x + (hole.x - back.x) * g, y: back.y + (hole.y - back.y) * g };
  };
  const blocks = planRunBlocks({
    call: c,
    side: read.side,
    hole,
    start: x.start,
    cast: x.cast,
    dir: x.dir,
    exclude,
    backAt,
    handoff,
    habits,
    rng: new Rng(`blocks:${x.e.text}`),
  });
  return { blocks, hole, exclude, side: read.side };
}

const linemen = (x: Run) => x.cast.offense.filter((m) => m.role === 'OL').map((m) => m.id);

describe('blocking by the call', () => {
  it('reads the call off the run: ends are outside zone, tackles power, a bounce stays an inside call', () => {
    expect(runs.length).toBeGreaterThan(150);
    for (const x of runs) {
      const { call } = runCall(x.e, x.scheme, new Rng('c'));
      if (x.e.open?.bounce) expect(call).toBe('insideZone');
      else if (/ end /.test(x.e.text)) expect(call).toBe('outsideZone');
      else if (/ tackle /.test(x.e.text)) expect(call).toBe(x.scheme === 'wideZone' ? 'insideZone' : 'power');
      else expect(['insideZone', 'power']).toContain(call);
      if (x.scheme === 'wideZone') expect(call).not.toBe('power');
    }
  });

  it('steps the whole line toward the play side on a zone run', () => {
    for (const x of runs.slice(0, 60)) {
      const { blocks, side } = plan(x, 'insideZone');
      for (const id of linemen(x)) {
        const s = x.start.get(id)!;
        const step = blocks.steps.get(id)!;
        expect((step.y - s.y) * side * x.dir).toBeGreaterThan(0.8);
      }
    }
  });

  it('pulls the backside guard behind the line on power', () => {
    let pulls = 0;
    for (const x of runs.slice(0, 60)) {
      const { blocks, hole } = plan(x, 'power');
      if (!blocks.puller) continue;
      pulls++;
      for (const p of blocks.puller.path) {
        const atHole = Math.abs(p.y - hole.y) < 0.5 && Math.abs(p.x - hole.x) < 0.5;
        if (atHole) break;
        expect((x.ball.x - p.x) * x.dir).toBeGreaterThanOrEqual(1);
      }
    }
    expect(pulls).toBeGreaterThan(30);
  });

  it('never blocks the tackler or the man who misses', () => {
    for (const x of runs) {
      const { blocks, exclude } = plan(x);
      for (const d of [...blocks.on.values(), ...blocks.climb.values()]) expect(exclude.has(d)).toBe(false);
    }
  });

  it('gives every free man a blocker who can get there first, or lists him free', () => {
    for (const x of runs) {
      const { blocks, hole, exclude } = plan(x);
      const blocked = new Set([...blocks.on.values(), ...blocks.climb.values()]);
      for (const m of x.cast.defense) {
        if (exclude.has(m.id) || blocked.has(m.id)) continue;
        const s = x.start.get(m.id)!;
        // Anyone who could beat the back (at the hole at 2.4 s) there is either picked up or listed free.
        if (Math.hypot(s.x - hole.x, s.y - hole.y) / SPEED[m.role] < 2.4) expect(blocks.free).toContain(m.id);
      }
      for (const id of blocks.free) expect(blocked.has(id)).toBe(false);
    }
  });

  it('drives a pancake hunter further and stops a soft puller short of the hole', () => {
    let pancakes = 0;
    let soft = 0;
    for (const x of runs.slice(0, 80)) {
      const ol = linemen(x)[2];
      const base = plan(x, 'insideZone');
      const hunt = plan(x, 'insideZone', new Map([[ol, new Set<QuirkId>(['pancakePreacher'])]]));
      const up = (p: { x: number }) => (p.x - x.start.get(ol)!.x) * x.dir;
      expect(up(hunt.blocks.steps.get(ol)!) - up(base.blocks.steps.get(ol)!)).toBeCloseTo(1.5, 5);
      pancakes++;
      const power = plan(x, 'power');
      if (!power.blocks.puller) continue;
      const id = power.blocks.puller.id;
      const softer = plan(x, 'power', new Map([[id, new Set<QuirkId>(['pullsSoft'])]]));
      const end = softer.blocks.puller!.path[softer.blocks.puller!.path.length - 1];
      expect(Math.hypot(end.x - power.hole.x, end.y - power.hole.y)).toBeGreaterThanOrEqual(0.9);
      expect(softer.blocks.on.has(id)).toBe(true);
      soft++;
    }
    expect(pancakes).toBeGreaterThan(50);
    expect(soft).toBeGreaterThan(20);
  });
});
