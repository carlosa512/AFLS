import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import type { FieldUnits, Game, GameResult, PlayLogEntry } from '../../engine/types';
import { Rng } from '../../engine/rng';
import { FIELD_W, pointAt, snapYFor } from './ballPath';
import { castFor, unitsAt } from './cast';
import { lineUp } from './formations';
import { sample, script, stagedPath } from './scripts';
import { stagePlay, type StagedPlay } from './stage';

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

  it('keeps every lineman, end and corner on his own side, play after play', () => {
    // Which side of the ball (from the offense's view) each fixed position takes; never both in a game.
    const sides = new Map<string, Set<number>>();
    let checked = 0;
    for (const { e, cast, dir, ballY, spots } of lineUps(10, SCRIMMAGE)) {
      void e;
      for (const m of [...cast.offense, ...cast.defense]) {
        if (!['OL', 'EDGE', 'CB'].includes(m.role) || (m.role === 'CB' && m.slot > 1)) continue;
        const across = (spots.get(m.id)!.y - ballY) * dir;
        if (Math.abs(across) < 1) continue; // the center
        const key = `${m.id}:${m.role}`;
        if (!sides.has(key)) sides.set(key, new Set());
        sides.get(key)!.add(Math.sign(across));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5000);
    const flipped = [...sides].filter(([, set]) => set.size > 1).map(([k]) => k);
    expect(flipped).toEqual([]);
  });

  it('lines the cover man up across from the receiver he covers', () => {
    let n = 0;
    for (const { e, spots } of lineUps(20, ['pass', 'incomplete', 'int'])) {
      const who = actorsIn(e);
      if (who.cover === undefined || who.ball === undefined || !spots.has(who.cover) || !spots.has(who.ball)) continue;
      expect(Math.abs(spots.get(who.cover)!.y - spots.get(who.ball)!.y), e.text).toBeLessThan(6);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });

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
    const segs = stagedPath(x.e, g.homeId, x.ballY);
    const { keys } = script(x.e, x.cast, x.spots, segs, x.dir);
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
      if ((e.kind !== 'pass' && e.kind !== 'incomplete') || who.ball === undefined || segs.length < 3) continue;
      const land = pointAt(segs[2], 1);
      const p = sample(keys.get(who.ball)!, segs[0].dur + segs[1].dur + segs[2].dur);
      expect(Math.hypot(p.x - land.x, p.y - land.y)).toBeLessThan(e.kind === 'incomplete' ? 1.5 : 0.5);
      n++;
    }
    expect(n).toBeGreaterThan(300);
  });
});

describe('the staged play', () => {
  const staged: { e: PlayLogEntry; p: StagedPlay; homeId: number; snapY: number }[] = [];
  for (const { g, r } of games)
    r.plays!.forEach((e, i) => {
      const snapY = snapYFor(e, 20 + (i % 14));
      staged.push({
        e,
        p: stagePlay({ plays: r.plays!, index: i, record: r.field!, homeId: g.homeId, seed: `${g.id}:${i}`, snapY }),
        homeId: g.homeId,
        snapY,
      });
    });
  const pos = (p: StagedPlay, step: number, k: number) => ({
    x: p.pos[(step * p.ids.length + k) * 2],
    y: p.pos[(step * p.ids.length + k) * 2 + 1],
  });

  it('stages every entry of 40 games without throwing, 22 ids each', () => {
    expect(staged.length).toBeGreaterThan(5000);
    for (const { p } of staged) {
      expect(p.ids).toHaveLength(22);
      expect(p.pos.length).toBe(p.steps * 22 * 2);
      expect(p.ball.length).toBe(p.steps * 3);
    }
  });

  it('ends the ball where the ball path ends', () => {
    for (const { e, p, homeId, snapY } of staged) {
      const segs = stagedPath(e, homeId, snapY);
      if (!segs.length) continue;
      const end = pointAt(segs[segs.length - 1], 1);
      const last = (p.steps - 1) * 3;
      expect(Math.hypot(p.ball[last] - end.x, p.ball[last + 1] - end.y)).toBeLessThan(0.5);
    }
  });

  it('keeps everyone on the field, give or take a step out of bounds', () => {
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const { p } of staged)
      for (let i = 0; i < p.pos.length; i += 2) {
        minX = Math.min(minX, p.pos[i]);
        maxX = Math.max(maxX, p.pos[i]);
        minY = Math.min(minY, p.pos[i + 1]);
        maxY = Math.max(maxY, p.pos[i + 1]);
      }
    expect(minY).toBeGreaterThanOrEqual(-2.5);
    expect(maxY).toBeLessThanOrEqual(FIELD_W + 2.5);
    expect(minX).toBeGreaterThanOrEqual(-12);
    expect(maxX).toBeLessThanOrEqual(112);
  });

  it('no steered defender reaches the carrier before the tackler', () => {
    let n = 0;
    for (const { p } of staged) {
      if (p.carrier === null) continue;
      const c = p.ids.indexOf(p.carrier);
      for (let k = 0; k < 22; k++) {
        // Chasers: the other side from the man with the ball (the offense, after an interception).
        if (p.offense[k] === p.offense[c] || p.keys.includes(p.ids[k])) continue;
        let closest = Infinity;
        for (let st = 0; st < p.steps - 1; st++) {
          const a = pos(p, st, k);
          const b = pos(p, st, c);
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
        }
        expect(closest).toBeGreaterThanOrEqual(1);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10_000);
  });

  it('stages the same play the same way every time', () => {
    const { g, r } = games[3];
    const a = stagePlay({ plays: r.plays!, index: 40, record: r.field!, homeId: g.homeId, seed: 'same', snapY: 26 });
    const b = stagePlay({ plays: r.plays!, index: 40, record: r.field!, homeId: g.homeId, seed: 'same', snapY: 26 });
    expect([...a.pos]).toEqual([...b.pos]);
  });

  it('stages a play in well under 50 ms', () => {
    const { g, r } = games[5];
    const times: number[] = [];
    for (let i = 0; i < Math.min(200, r.plays!.length); i++) {
      const t0 = performance.now();
      stagePlay({ plays: r.plays!, index: i, record: r.field!, homeId: g.homeId, seed: `t${i}`, snapY: 26 });
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(50);
  });
});

describe('off the ball', () => {
  const picks = (kind: string) =>
    games.slice(0, 15).flatMap(({ g, r }) =>
      r.plays!.flatMap((e, i) =>
        e.kind === kind && e.down > 0
          ? [
              {
                e,
                p: stagePlay({
                  plays: r.plays!,
                  index: i,
                  record: r.field!,
                  homeId: g.homeId,
                  seed: `o${i}`,
                  snapY: 26,
                }),
              },
            ]
          : [],
      ),
    );
  const moved = (p: StagedPlay, k: number) => {
    const last = p.steps - 1;
    const x0 = p.pos[k * 2];
    const x1 = p.pos[(last * 22 + k) * 2];
    return { downfield: x1 - x0, dist: Math.hypot(x1 - x0, p.pos[(last * 22 + k) * 2 + 1] - p.pos[k * 2 + 1]) };
  };

  it('gives a sack time: the quarterback holds the ball at least two seconds', () => {
    const sacks = picks('sack');
    expect(sacks.length).toBeGreaterThan(20);
    for (const { p } of sacks) expect((p.steps - 1) * p.dt).toBeGreaterThanOrEqual(2);
  });

  it('runs routes while the rush gets home: receivers on a sack end well downfield', () => {
    let routes = 0;
    for (const { e, p } of picks('sack')) {
      const dir = p.home[0] ? 1 : -1; // the offense attacks toward 100 when it is the home side
      p.ids.forEach((id, k) => {
        if (!p.offense[k] || p.keys.includes(id) || p.roles[k] !== 'WR') return;
        expect(moved(p, k).downfield * dir, `${e.text}`).toBeGreaterThan(5);
        routes++;
      });
    }
    expect(routes).toBeGreaterThan(40);
  });

  it('holds the pocket: blocked rushers stay off the quarterback for the first second and a half', () => {
    let rushers = 0;
    for (const kind of ['pass', 'incomplete', 'sack'])
      for (const { p } of picks(kind)) {
        const qb = p.roles.indexOf('QB');
        const early = Math.min(p.steps - 1, Math.round(1.5 / p.dt));
        p.ids.forEach((id, k) => {
          if (p.offense[k] || p.keys.includes(id) || (p.roles[k] !== 'DT' && p.roles[k] !== 'EDGE')) return;
          for (let st = 0; st <= early; st++) {
            const d = Math.hypot(
              p.pos[(st * 22 + k) * 2] - p.pos[(st * 22 + qb) * 2],
              p.pos[(st * 22 + k) * 2 + 1] - p.pos[(st * 22 + qb) * 2 + 1],
            );
            expect(d).toBeGreaterThan(2.5);
          }
          rushers++;
        });
      }
    expect(rushers).toBeGreaterThan(300);
  });

  it('sets the line: linemen are on a man (a rusher, or a linebacker on a run) a second in', () => {
    let linemen = 0;
    let engaged = 0;
    for (const kind of ['pass', 'incomplete', 'sack', 'run'])
      for (const { p } of picks(kind)) {
        const st = Math.min(p.steps - 1, Math.round(1 / p.dt));
        const front = kind === 'run' ? ['DT', 'EDGE', 'LB'] : ['DT', 'EDGE'];
        const rushers = p.ids.map((_, k) => k).filter((k) => !p.offense[k] && front.includes(p.roles[k]));
        p.ids.forEach((id, k) => {
          if (p.roles[k] !== 'OL' || p.keys.includes(id)) return;
          const near = Math.min(
            ...rushers.map((j) =>
              Math.hypot(
                p.pos[(st * 22 + k) * 2] - p.pos[(st * 22 + j) * 2],
                p.pos[(st * 22 + k) * 2 + 1] - p.pos[(st * 22 + j) * 2 + 1],
              ),
            ),
          );
          expect(near).toBeLessThan(4);
          if (near < 2) engaged++;
          linemen++;
        });
      }
    expect(linemen).toBeGreaterThan(2000);
    // Nearly all on a man; now and then one loses a moving defender for a moment, as real linemen do.
    expect(engaged / linemen).toBeGreaterThan(0.98);
  });

  it('gives a run time to develop: a handoff, the press to the line, then the burst', () => {
    for (const { e, p } of picks('run')) {
      const yards = Math.abs((e.to ?? 0) - (e.from ?? 0));
      expect((p.steps - 1) * p.dt, e.text).toBeGreaterThanOrEqual(1.8 + Math.min(yards, 20) * 0.05);
    }
  });

  it('reads the run: unblocked linebackers close on the carrier in the second after the handoff', () => {
    let backers = 0;
    let closing = 0;
    for (const { p } of picks('run')) {
      const c = p.carrier === null ? -1 : p.ids.indexOf(p.carrier);
      if (c < 0) continue;
      const handoff = Math.round(0.7 / p.dt);
      const later = Math.min(p.steps - 1, handoff + Math.round(1 / p.dt));
      const at = (st: number, k: number) =>
        Math.hypot(
          p.pos[(st * 22 + k) * 2] - p.pos[(st * 22 + c) * 2],
          p.pos[(st * 22 + k) * 2 + 1] - p.pos[(st * 22 + c) * 2 + 1],
        );
      p.ids.forEach((id, k) => {
        if (p.offense[k] || p.roles[k] !== 'LB' || p.keys.includes(id)) return;
        backers++;
        if (at(later, k) < at(handoff, k) - 1.5) closing++;
      });
    }
    expect(backers).toBeGreaterThan(200);
    expect(closing / backers).toBeGreaterThan(0.8);
  });

  it('moves the line on a run: nearly every lineman leaves his stance by a yard or more', () => {
    let linemen = 0;
    let moved = 0;
    for (const { p } of picks('run')) {
      const st = Math.min(p.steps - 1, Math.round(1.6 / p.dt));
      p.ids.forEach((id, k) => {
        if (p.roles[k] !== 'OL' || p.keys.includes(id)) return;
        const d = Math.hypot(p.pos[(st * 22 + k) * 2] - p.pos[k * 2], p.pos[(st * 22 + k) * 2 + 1] - p.pos[k * 2 + 1]);
        // Now and then one is stood up at the line: not every block wins.
        if (d > 1) moved++;
        linemen++;
      });
    }
    expect(linemen).toBeGreaterThan(1000);
    expect(moved / linemen).toBeGreaterThan(0.98);
  });

  it('moves the back on a dropback: he blocks or runs a checkdown, never stands still', () => {
    let backs = 0;
    for (const kind of ['pass', 'incomplete', 'sack'])
      for (const { p } of picks(kind))
        p.ids.forEach((id, k) => {
          if (p.roles[k] !== 'RB' || p.keys.includes(id)) return;
          // The farthest he gets from his spot: a blocker may follow the quarterback back on a sack and end near it.
          let farthest = 0;
          for (let st = 0; st < p.steps; st++)
            farthest = Math.max(
              farthest,
              Math.hypot(p.pos[(st * 22 + k) * 2] - p.pos[k * 2], p.pos[(st * 22 + k) * 2 + 1] - p.pos[k * 2 + 1]),
            );
          expect(farthest).toBeGreaterThan(1.5);
          backs++;
        });
    expect(backs).toBeGreaterThan(100);
  });
});

describe('special teams', () => {
  const kicks = (kind: string) =>
    games.slice(0, 20).flatMap(({ g, r }) =>
      r.plays!.flatMap((e, i) =>
        e.kind === kind
          ? [
              {
                e,
                segs: stagedPath(e, g.homeId, 26),
                p: stagePlay({
                  plays: r.plays!,
                  index: i,
                  record: r.field!,
                  homeId: g.homeId,
                  seed: `k${i}`,
                  snapY: 26,
                }),
              },
            ]
          : [],
      ),
    );
  const at = (p: StagedPlay, st: number, k: number) => ({
    x: p.pos[(st * 22 + k) * 2],
    y: p.pos[(st * 22 + k) * 2 + 1],
  });
  const returned = (e: PlayLogEntry) => e.air !== undefined && e.to !== undefined && Math.abs(e.to - e.air) > 0.5;
  const kickoffs = kicks('kickoff');
  const punts = kicks('punt');

  it('gives a kick its hang time', () => {
    for (const { e, p } of kickoffs)
      if (!/onside/i.test(e.text)) expect((p.steps - 1) * p.dt).toBeGreaterThanOrEqual(4);
    for (const { e, p } of punts) if (!/BLOCKED/.test(e.text)) expect((p.steps - 1) * p.dt).toBeGreaterThanOrEqual(4.5);
  });

  it('puts the returner under the ball when it comes down, and the tackler on him at the whistle', () => {
    let n = 0;
    for (const { e, segs, p } of [...kickoffs, ...punts]) {
      if (!returned(e) || /TOUCHDOWN|BLOCKED|onside/i.test(e.text)) continue;
      const ret = p.roles.indexOf('RET');
      const air = segs.findIndex((s) => s.peak > 0);
      const land = segs.slice(0, air + 1).reduce((t, s) => t + s.dur, 0);
      const st = Math.min(p.steps - 1, Math.round(land / p.dt));
      const r = at(p, st, ret);
      expect(Math.hypot(r.x - segs[air].x1, r.y - segs[air].y1)).toBeLessThan(1.5);
      const last = p.steps - 1;
      const end = at(p, last, ret);
      const tackled = p.ids.some(
        (_, k) => p.offense[k] && Math.hypot(at(p, last, k).x - end.x, at(p, last, k).y - end.y) <= 1.2,
      );
      expect(tackled).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(30);
  });

  it("lines a kickoff up by today's rules, and nobody but the kicker and returners moves until the ball comes down", () => {
    let n = 0;
    for (const { e, segs, p } of kickoffs) {
      if (/onside|out of bounds/i.test(e.text)) continue;
      const dir = p.home[0] ? 1 : -1;
      const ballX = p.ball[0];
      const depth = (k: number) => (at(p, 0, k).x - ballX) * dir;
      const cover = p.ids.map((_, k) => k).filter((k) => p.offense[k] && p.roles[k] !== 'K');
      // The kicking ten a yard short of the receiving 40 (25 yards off the ball at the 35).
      for (const k of cover) expect(depth(k)).toBeGreaterThanOrEqual(23.5);
      for (const k of cover) expect(depth(k)).toBeLessThanOrEqual(25);
      // Nine or more in the setup zone, the receiving 35 to the 30.
      const receiving = p.ids.map((_, k) => k).filter((k) => !p.offense[k]);
      expect(receiving.filter((k) => depth(k) >= 29.5 && depth(k) <= 35.5).length).toBeGreaterThanOrEqual(9);
      const air = segs.findIndex((s) => s.peak > 0);
      const land = Math.floor(segs.slice(0, air + 1).reduce((t, s) => t + s.dur, 0) / p.dt);
      for (const k of [...cover, ...receiving]) {
        if (p.roles[k] === 'RET' || depth(k) > 40) continue; // the returners
        for (let st = 0; st < land; st += 5) {
          const a = at(p, st, k);
          expect(Math.hypot(a.x - at(p, 0, k).x, a.y - at(p, 0, k).y), e.text).toBeLessThan(0.5);
        }
      }
      n++;
    }
    expect(n).toBeGreaterThan(30);
  });

  it('releases the punt gunners at the snap', () => {
    let n = 0;
    for (const { e, p } of punts) {
      if (/BLOCKED/.test(e.text)) continue;
      const dir = p.home[0] ? 1 : -1;
      const ballY = p.ball[1];
      const gunners = p.ids.map((_, k) => k).filter((k) => p.offense[k] && Math.abs(at(p, 0, k).y - ballY) > 12);
      expect(gunners.length).toBeGreaterThanOrEqual(2);
      const st = Math.min(p.steps - 1, Math.round(3 / p.dt));
      for (const k of gunners) expect((at(p, st, k).x - at(p, 0, k).x) * dir).toBeGreaterThan(15);
      n++;
    }
    expect(n).toBeGreaterThan(30);
  });

  it('snaps a field goal and an extra point back to the holder, seven yards behind the line', () => {
    let n = 0;
    for (const kind of ['fg', 'xp'])
      for (const { p } of kicks(kind)) {
        const holder = p.roles.indexOf('P');
        const line = p.ids.map((_, k) => k).filter((k) => p.offense[k] && p.roles[k] === 'OL');
        const losX = p.ball[0];
        // The ball starts at the line, among the linemen, and reaches the holder, seven yards back.
        for (const k of line) expect(Math.abs(at(p, 0, k).x - losX)).toBeLessThan(1.5);
        const h = at(p, 0, holder);
        expect(Math.abs(h.x - losX)).toBeGreaterThan(6);
        const snapped = Math.round(0.4 / p.dt);
        expect(Math.hypot(p.ball[snapped * 3] - h.x, p.ball[snapped * 3 + 1] - h.y)).toBeLessThan(1);
        n++;
      }
    expect(n).toBeGreaterThan(30);
  });

  it('sends the punt jammers down the field with the gunners, not after the punter', () => {
    let n = 0;
    for (const { e, p } of punts) {
      if (/BLOCKED/.test(e.text)) continue;
      const dir = p.home[0] ? 1 : -1;
      const ballY = p.ball[1];
      const jammers = p.ids.map((_, k) => k).filter((k) => !p.offense[k] && Math.abs(at(p, 0, k).y - ballY) > 12);
      const st = Math.min(p.steps - 1, Math.round(3 / p.dt));
      for (const k of jammers) expect((at(p, st, k).x - at(p, 0, k).x) * dir, e.text).toBeGreaterThan(8);
      n += jammers.length;
    }
    expect(n).toBeGreaterThan(60);
  });

  it('protects the holder on a field goal: the rush is held up until the kick', () => {
    let n = 0;
    for (const kind of ['fg', 'xp'])
      for (const { p } of kicks(kind)) {
        const holder = p.roles.indexOf('P');
        const kickAt = Math.round(0.8 / p.dt);
        p.ids.forEach((id, k) => {
          if (p.offense[k] || p.keys.includes(id)) return;
          for (let st = 0; st <= kickAt; st++) {
            const a = at(p, st, k);
            const h = at(p, st, holder);
            expect(Math.hypot(a.x - h.x, a.y - h.y)).toBeGreaterThan(1.5);
          }
          n++;
        });
      }
    expect(n).toBeGreaterThan(300);
  });
});
