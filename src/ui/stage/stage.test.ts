import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import type { FieldUnits, Game, GameResult } from '../../engine/types';
import { Rng } from '../../engine/rng';
import { buildPath, FIELD_W, pointAt, snapYFor } from './ballPath';
import { castFor, unitsAt } from './cast';
import { lineUp } from './formations';
import { sample, script } from './scripts';

const league = createLeague({ seed: 'stage' });
const games: { g: Game; r: GameResult }[] = Array.from({ length: 40 }, (_, i) => {
  const g = league.games[i];
  return { g, r: simulateGame(league, g, { keepPlays: true, seed: `st-${i}` }) };
});
const eleven = (u: FieldUnits) => [u.qb, ...u.ol, u.rb, ...u.wr, ...u.te, ...u.dt, ...u.edge, ...u.lb, ...u.cb, ...u.s];

describe('who is on the field for a play', () => {
  it('puts 11 different players a side on every entry of 40 games, with unique jerseys a side', () => {
    for (const { g, r } of games)
      r.plays!.forEach((_, i) => {
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        for (const side of [cast.offense, cast.defense]) {
          expect(side).toHaveLength(11);
          expect(new Set(side.map((m) => m.id)).size).toBe(11);
          expect(new Set(side.map((m) => r.field!.jerseys[m.id])).size).toBe(11);
        }
        const ids = new Set([...cast.offense, ...cast.defense].map((m) => m.id));
        expect(ids.size).toBe(22);
      });
  });

  it('never puts a player on the field after the change that took him out', () => {
    let checked = 0;
    for (const { r } of games)
      for (const hurt of r.injuries ?? []) {
        const change = r.field!.changes.find(
          ([, , u]) => !eleven(u).includes(hurt.playerId) && r.playerTeams[u.qb] === hurt.teamId,
        );
        if (!change) continue;
        for (let i = change[0]; i < r.plays!.length; i++) {
          const [home, away] = unitsAt(r.field!, i);
          const side = r.playerTeams[home.qb] === hurt.teamId ? home : away;
          if (eleven(side).includes(hurt.playerId)) {
            // Only allowed if a later change put him back, which injuries never do.
            throw new Error(`player ${hurt.playerId} back on the field at play ${i}`);
          }
        }
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });

  it('puts every player a scrimmage play was about on the field, swapping in a spelling back or a rotation rusher', () => {
    let swaps = 0;
    for (const { g, r } of games)
      r.plays!.forEach((e, i) => {
        if (!e.who || !e.down) return;
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        const on = new Set([...cast.offense, ...cast.defense].map((m) => m.id));
        const [home, away] = unitsAt(r.field!, i);
        const units = r.playerTeams[home.qb] === e.offense ? [home, away] : [away, home];
        for (const id of Object.values(actorsIn(e))) {
          expect(on.has(id), `play ${i}: ${id}`).toBe(true);
          if (!eleven(units[0]).includes(id) && !eleven(units[1]).includes(id)) swaps++;
        }
      });
    expect(swaps).toBeGreaterThan(0);
  });

  it('lines up the kick units on kicks: the kicker and the returner are on the field', () => {
    for (const { g, r } of games.slice(0, 10))
      r.plays!.forEach((e, i) => {
        if (e.kind !== 'kickoff' && e.kind !== 'punt') return;
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        expect(cast.offense.some((m) => m.role === 'K' || m.role === 'P')).toBe(true);
        expect(cast.defense.filter((m) => m.role === 'RET')).toHaveLength(1);
      });
  });
});

/** Line up every entry of the first `n` games: the cast, the formation and what it was built from. */
function lineUps(n: number, kinds?: readonly string[]) {
  const out = [];
  for (const { g, r } of games.slice(0, n))
    for (let i = 0; i < r.plays!.length; i++) {
      const e = r.plays![i];
      if (!e.kind || e.from === undefined || (kinds && !kinds.includes(e.kind))) continue;
      const cast = castFor(r.field!, r.plays!, i, g.homeId);
      const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
      const ballY = snapYFor(e, 20 + (i % 14));
      const spots = lineUp(
        e,
        cast,
        r.field!.scheme[cast.offSide],
        r.field!.scheme[1 - cast.offSide],
        e.from,
        ballY,
        dir,
        new Rng(`f:${g.id}:${i}`),
      );
      out.push({ e, cast, dir, ballX: e.from, ballY, spots });
    }
  return out;
}

describe('formations', () => {
  const SCRIMMAGE = ['run', 'pass', 'incomplete', 'int', 'sack', 'scramble', 'kneel', 'spike'];

  it('lines up 22 players on their own sides of the ball, inside the field', () => {
    for (const { cast, dir, ballX, spots } of lineUps(10, SCRIMMAGE)) {
      expect(spots.size).toBe(22);
      for (const m of cast.offense) expect((spots.get(m.id)!.x - ballX) * dir).toBeLessThanOrEqual(0.1);
      for (const m of cast.defense) expect((spots.get(m.id)!.x - ballX) * dir).toBeGreaterThan(0);
      for (const p of spots.values()) {
        expect(p.y).toBeGreaterThanOrEqual(3);
        expect(p.y).toBeLessThanOrEqual(FIELD_W - 3);
      }
    }
  });

  it('puts no two players within 0.8 yards of each other, kicks included', () => {
    for (const { spots } of lineUps(10)) {
      const ps = [...spots.values()];
      for (let a = 0; a < ps.length; a++)
        for (let b = a + 1; b < ps.length; b++)
          expect(Math.hypot(ps[a].x - ps[b].x, ps[a].y - ps[b].y)).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('lines the same play up the same way every time', () => {
    const [a, b] = [lineUps(2), lineUps(2)];
    expect(a.map((x) => [...x.spots])).toEqual(b.map((x) => [...x.spots]));
  });
});

/** Script every scrimmage play of the first `n` games. */
function scripted(n: number) {
  return lineUps(n, ['run', 'pass', 'incomplete', 'int', 'sack', 'scramble', 'kneel', 'spike']).map((x) => {
    const g = games.find(({ r }) => r.plays!.includes(x.e))!.g;
    const segs = buildPath(x.e, g.homeId, x.ballY);
    const keys = script(x.e, x.cast, x.spots, segs, x.dir);
    const end = segs.length ? pointAt(segs[segs.length - 1], 1) : null;
    const total = segs.reduce((t, sg) => t + sg.dur, 0);
    return { ...x, segs, keys, end, total, who: actorsIn(x.e) };
  });
}

describe('scripts', () => {
  const all = scripted(20);
  const touchdown = (t: string) => /TOUCHDOWN/.test(t);

  it('hands the ball to the right man: the carrier ends where the ball ends', () => {
    let n = 0;
    for (const { e, keys, end, total, who, cast } of all) {
      if (!end) continue;
      const qb = cast.offense.find((m) => m.role === 'QB')!.id;
      const holder =
        e.kind === 'int'
          ? who.take
          : e.kind === 'pass' || e.kind === 'run'
            ? who.ball
            : e.kind === 'incomplete'
              ? undefined
              : qb;
      if (holder === undefined) continue;
      const p = sample(keys.get(holder)!, total);
      expect(Math.hypot(p.x - end.x, p.y - end.y), `${e.kind} ${e.text}`).toBeLessThan(0.5);
      n++;
    }
    expect(n).toBeGreaterThan(500);
  });

  it('the tackler is within a yard of the carrier at the whistle', () => {
    let n = 0;
    for (const { e, keys, end, total, who } of all) {
      if (
        !end ||
        touchdown(e.text) ||
        e.kind === 'incomplete' ||
        e.kind === 'int' ||
        e.kind === 'kneel' ||
        e.kind === 'spike'
      )
        continue;
      const tackler = [...keys.keys()].find((id) => id === who.tackle) ?? (e.kind === 'sack' ? who.rush : undefined);
      if (tackler === undefined) continue;
      const p = sample(keys.get(tackler)!, total);
      expect(Math.hypot(p.x - end.x, p.y - end.y), `${e.kind}`).toBeLessThanOrEqual(1);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });

  it('the target reaches the landing point when the ball does', () => {
    let n = 0;
    for (const { e, keys, segs, who } of all) {
      if ((e.kind !== 'pass' && e.kind !== 'incomplete') || who.ball === undefined || segs.length < 2) continue;
      const land = pointAt(segs[1], 1);
      const p = sample(keys.get(who.ball)!, segs[0].dur + segs[1].dur);
      expect(Math.hypot(p.x - land.x, p.y - land.y)).toBeLessThan(e.kind === 'incomplete' ? 1.5 : 0.5);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });
});
