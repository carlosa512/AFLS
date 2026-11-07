import { describe, expect, it } from 'vitest';
import { buildPath, pointAt } from '../../engine/field/ballPath';
import { stagePlay } from '../../engine/field/stage';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import type { GameResult, PlayLogEntry } from '../../engine/types';

const BATTED = /, batted down at the line by /;

/** The first play in a league's games that `want` picks, with its game. */
function findPlay(want: (e: PlayLogEntry) => boolean, games = 40) {
  const league = createLeague({ seed: 'batted-film' });
  for (const g of league.games.filter((x) => !x.playoffRound).slice(0, games)) {
    const r: GameResult = simulateGame(league, g, { keepPlays: true });
    const i = r.plays!.findIndex(want);
    if (i >= 0) return { r, i, homeId: g.homeId };
  }
  return null;
}

const stage = (r: GameResult, plays: PlayLogEntry[], i: number, homeId: number) =>
  stagePlay({ plays, index: i, record: r.field!, homeId, seed: 'film', snapY: 26.65 });
const at = (p: ReturnType<typeof stage>, step: number, k: number) => ({
  x: p.pos[(step * p.ids.length + k) * 2],
  y: p.pos[(step * p.ids.length + k) * 2 + 1],
});
/** The first step the ball is at `end`. */
const arrival = (p: ReturnType<typeof stage>, end: { x: number; y: number }) => {
  for (let s = 0; s < p.steps; s++) if (Math.hypot(p.ball[s * 3] - end.x, p.ball[s * 3 + 1] - end.y) < 0.15) return s;
  return p.steps - 1;
};

describe('a ball batted down at the line', () => {
  const found = findPlay((e) => e.kind === 'incomplete' && BATTED.test(e.text) && e.air !== undefined);

  it('dies a yard past the line, low; the same play without the words flies to where it was thrown', () => {
    expect(found).not.toBeNull();
    const e = found!.r.plays![found!.i];
    const segs = buildPath(e, found!.homeId, 26.65);
    const flight = segs.find((s) => s.peak > 0)!;
    // A yard past the line, or the target if a screen's comes first (0.4.10).
    expect(Math.abs(flight.x1 - e.from!) <= 1.5 || flight.x1 === e.air).toBe(true);
    expect(flight.peak).toBeLessThanOrEqual(3);
    const plain = buildPath(
      { ...e, text: e.text.replace(/, batted down at the line by .*$/, '') },
      found!.homeId,
      26.65,
    );
    expect(plain.find((s) => s.peak > 0)!.x1).toBe(e.air);
  });

  it('stages the batter on the ball at the line, squared up to the passer', () => {
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    const p = stage(r, r.plays!, i, homeId);
    const end = { x: p.ball[(p.steps - 1) * 3], y: p.ball[(p.steps - 1) * 3 + 1] };
    expect(Math.abs(end.x - e.from!) <= 1.5 || Math.abs(end.x - e.air!) < 1e-6).toBe(true);
    const step = arrival(p, end);
    const k = p.ids.indexOf(actorsIn(e).take!);
    expect(k, 'the batter is on the field').toBeGreaterThanOrEqual(0);
    const b = at(p, step, k);
    expect(Math.hypot(b.x - end.x, b.y - end.y)).toBeLessThanOrEqual(1.5);
    const qb = p.ids.findIndex((_, j) => p.offense[j] && p.roles[j] === 'QB');
    const q = at(p, step, qb);
    expect((b.x - end.x) * (q.x - end.x)).toBeGreaterThanOrEqual(0);
  });
});

describe('a pass tipped at the line and picked off', () => {
  const found = findPlay((e) => e.kind === 'int' && actorsIn(e).take !== undefined && e.air !== undefined);

  it('has the lineman holding the ball at the line', () => {
    expect(found).not.toBeNull();
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    const dir = e.air! > e.from! ? 1 : -1;
    const tipped = {
      ...e,
      air: e.from! + dir,
      text: e.text.replace(' INTERCEPTED by', ', tipped at the line, INTERCEPTED by'),
    };
    const plays = r.plays!.map((x, k) => (k === i ? tipped : x));
    const p = stage(r, plays, i, homeId);
    const flight = buildPath(tipped, homeId, 26.65).find((s) => s.peak > 0)!;
    const land = pointAt(flight, 1);
    expect(Math.abs(land.x - e.from!)).toBeLessThanOrEqual(1.5);
    const step = arrival(p, { x: land.x, y: p.ball[arrival(p, land) * 3 + 1] });
    const k = p.ids.indexOf(actorsIn(e).take!);
    const c = at(p, step, k);
    expect(Math.hypot(c.x - p.ball[step * 3], c.y - p.ball[step * 3 + 1])).toBeLessThanOrEqual(1.5);
  });
});

describe('a ball batted down on a throw behind the line', () => {
  it('ends at the nearer of the line and the target, never past the target', () => {
    const e = {
      quarter: 1,
      clock: 600,
      offense: 0,
      down: 1,
      distance: 10,
      yardLine: 30,
      text: 'A.Passer pass short left to B.Back incomplete, batted down at the line by C.Tackle',
      homeScore: 0,
      awayScore: 0,
      kind: 'incomplete',
      from: 30,
      air: 27,
      to: 30,
      lane: -1,
    } as PlayLogEntry;
    // Offense 0 is home: it drives toward higher x, so the target at 27 is behind the line at 30.
    const flight = buildPath(e, 0, 26.65).find((s) => s.peak > 0)!;
    expect(flight.x1).toBeLessThanOrEqual(27 + 1e-9);
  });
});
