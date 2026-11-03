import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn, defenseCallAt } from '../../engine/playActors';
import type { FieldUnits, Game, GameResult, PlayLogEntry } from '../../engine/types';
import { Rng } from '../../engine/rng';
import { COVERAGES, type CoverageId } from '../../engine/schemes';
import type { QuirkId } from '../../engine/quirks';
import { FIELD_W, pointAt, snapYFor } from './ballPath';
import { castFor, unitsAt } from './cast';
import { fumbleIn } from './fumble';
import { lineUp } from './formations';
import { BEAT_ACROSS, sample, script, stagedPath } from './scripts';
import { asRan, returned, SPRINT, stagePlay, type StagedPlay } from './stage';
import { SPEED } from './speed';

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
        // The play he was hurt on (a player can sit a stretch earlier, rotated or rested, and come back).
        const hurtAt = r.plays!.findIndex(
          (e) => e.quarter > hurt.quarter || (e.quarter === hurt.quarter && e.clock <= hurt.clock),
        );
        const change = r.field!.changes.find(
          ([at, , u]) => at >= hurtAt && !eleven(u).includes(hurt.playerId) && r.playerTeams[u.qb] === hurt.teamId,
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

  it('puts both backs on the field when the spelling back gets the ball and the starter is in the play too', () => {
    const { g, r } = games[0];
    const i = r.plays!.findIndex((e) => e.down && e.who);
    const [home, away] = unitsAt(r.field!, i);
    const off = r.playerTeams[home.qb] === r.plays![i].offense ? home : away;
    // The spelling back has the ball; the starter was the blocker who got beat.
    const plays = r.plays!.map((e, k) => (k === i ? { ...e, who: [off.rb2!, null, null, null, off.rb] } : e));
    const ids = castFor(r.field!, plays, i, g.homeId).offense.map((m) => m.id);
    expect(ids).toContain(off.rb2);
    expect(ids).toContain(off.rb);
    expect(new Set(ids).size).toBe(11);
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
      out.push({ e, cast, dir, ballX: e.from, ballY, spots, units: unitsAt(r.field!, i) });
    }
  return out;
}

describe('formations', () => {
  const SCRIMMAGE = ['run', 'pass', 'incomplete', 'int', 'sack', 'scramble', 'kneel', 'spike'];

  it('keeps every lineman, end and corner on his own side, play after play', () => {
    // Which side of the ball (from the offense's view) each fixed position takes; never both in a game.
    const sides = new Map<string, Set<number>>();
    let checked = 0;
    for (const { e, cast, dir, ballY, spots, units } of lineUps(10, SCRIMMAGE)) {
      void e;
      const defense = units[1 - cast.offSide];
      for (const m of [...cast.offense, ...cast.defense]) {
        if (!['OL', 'EDGE', 'CB'].includes(m.role) || (m.role === 'CB' && m.slot > 1)) continue;
        // The starters keep their sides; a rotation rusher in for a snap spells whichever end needs the breather.
        if (m.role === 'EDGE' && !defense.edge.includes(m.id)) continue;
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
      // A fumble ends with the man who recovered it: the engine's on a lost one, the man who fumbled on a kept one.
      const f = fumbleIn(e);
      const holder = f
        ? f.lost
          ? who.take
          : e.kind === 'sack'
            ? qb
            : (who.ball ?? qb)
        : e.kind === 'int'
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
        e.kind === 'spike' ||
        // A fumble's hit comes when the ball comes out, not at the whistle (the loose ball's own tests, below).
        fumbleIn(e)
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

  /** A man's quickest quarter-second on the play, yards a second, and when it ends. */
  const quickest = (p: StagedPlay, k: number) => {
    const w = Math.round(0.25 / p.dt);
    let best = 0;
    let when = 0;
    for (let st = w; st < p.steps; st++) {
      const a = pos(p, st, k);
      const b = pos(p, st - w, k);
      const v = Math.hypot(a.x - b.x, a.y - b.y) / (w * p.dt);
      if (v > best) [best, when] = [v, st * p.dt];
    }
    return { v: best, t: when };
  };
  /**
   * As quick as a man gets: his top speed and the pursuit edge, and a little for a shove (a carrier running into a man
   * moves him, `steer`'s floor) and for rounding.
   */
  const legs = (role: string) => SPEED[role as keyof typeof SPEED] + 0.6 + 0.5;

  it('never has anyone faster than his legs, on any play: nobody teleports, the tackler included', () => {
    const fast: string[] = [];
    for (const { e, p } of staged) {
      const end = p.steps - 1;
      const c = p.carrier === null ? -1 : p.ids.indexOf(p.carrier);
      p.ids.forEach((_, k) => {
        const q = quickest(p, k);
        // Running a carrier down, the man who brings him down may sprint his last stretch: on him at the whistle,
        // within the last two seconds, and never past the NFL's fastest.
        const onHim =
          c >= 0 &&
          k !== c &&
          Math.hypot(pos(p, end, k).x - pos(p, end, c).x, pos(p, end, k).y - pos(p, end, c).y) < 1.5;
        const closing = onHim && q.t >= end * p.dt - 2;
        const most = closing
          ? Math.max(legs(p.roles[k]), Math.min(SPRINT, legs(p.roles[k]) + 1) + 0.4)
          : legs(p.roles[k]);
        if (q.v > most) fast.push(`${p.roles[k]} ${q.v.toFixed(1)} at ${q.t.toFixed(2)}: ${e.text}`);
      });
    }
    expect(fast.slice(0, 5)).toEqual([]);
  });

  it('stages every entry of 40 games without throwing, 22 ids each', () => {
    expect(staged.length).toBeGreaterThan(5000);
    for (const { p } of staged) {
      expect(p.ids).toHaveLength(22);
      expect(p.pos.length).toBe(p.steps * 22 * 2);
      expect(p.ball.length).toBe(p.steps * 3);
    }
  });

  it('rings the quarterback only while the play is his: not on a handoff, and off once his pass arrives', () => {
    let runs = 0;
    let passes = 0;
    for (const { e, p } of staged) {
      const qb = p.ids[p.roles.indexOf('QB')];
      // A handoff: someone else ran it (who ends with the ball can be a man who recovered a fumble).
      if (e.kind === 'run' && actorsIn(e).ball !== qb && p.carrier !== qb) {
        expect(p.keys).not.toContain(qb);
        expect(p.keys).toContain(p.carrier);
        runs++;
      }
      if (e.kind === 'pass') {
        const i = p.keys.indexOf(qb);
        expect(i).toBeGreaterThanOrEqual(0);
        // Gone before the whistle; the receiver's stays.
        expect(p.until[i]).toBeLessThanOrEqual((p.steps - 1) * p.dt);
        expect(p.until[p.keys.indexOf(p.carrier!)]).toBe(Infinity);
        passes++;
      }
    }
    expect(runs).toBeGreaterThan(500);
    expect(passes).toBeGreaterThan(500);
  });

  it('stages a snap a flag wiped out as it ran: the run or the pass, not just the walk-off', () => {
    let n = 0;
    for (const { e, p } of staged) {
      if (e.kind !== 'penalty' || !e.ran?.kind) continue;
      // Its keys are the men the snap was about, and the ball travels (unless it was an incomplete pass's).
      expect(p.keys.length, e.text).toBeGreaterThan(0);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });

  it('ends the ball where the ball path ends (a snap a flag wiped out, where it ran)', () => {
    for (const { e, p, homeId, snapY } of staged) {
      const segs = stagedPath(returned(asRan(e)), homeId, snapY);
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
      // From when he has it: the throw or the handoff, a pick as he makes it, or a fumble's recovery (before, the man who
      // ends up with it may have been in coverage).
      // (The first step he has it: until then a receiver is on his route, and his man may be as close as he can get.)
      const from = Math.ceil(
        (p.loose ? p.loose.t : p.kind === 'int' && p.arrive !== null ? p.arrive : p.release) / p.dt - 1e-9,
      );
      for (let k = 0; k < 22; k++) {
        // Chasers: the other side from the man with the ball (the offense, after an interception).
        // (Nor the man the engine says missed him: he's on the carrier as the move starts.)
        if (p.offense[k] === p.offense[c] || p.keys.includes(p.ids[k]) || p.ids[k] === p.move?.by) continue;
        let closest = Infinity;
        for (let st = from; st < p.steps - 1; st++) {
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

  it('lets a long gain break clear: no pack escorting the carrier through the second half of the run', () => {
    let n = 0;
    const crowds: number[] = [];
    for (const { e, p } of staged) {
      if ((e.kind !== 'run' && e.kind !== 'pass') || p.carrier === null) continue;
      if (e.from === undefined || e.to === undefined || Math.abs(e.to - e.from) < 30) continue;
      const c = p.ids.indexOf(p.carrier);
      const last = p.steps - 1;
      let crowd = 0;
      let samples = 0;
      // The second half of the play, short of the tackle itself.
      for (let st = Math.round(last / 2); st < last - Math.round(0.6 / p.dt); st += 5) {
        const b = pos(p, st, c);
        crowd += p.ids.filter((_, k) => k !== c && Math.hypot(pos(p, st, k).x - b.x, pos(p, st, k).y - b.y) < 4).length;
        samples++;
      }
      if (samples) crowds.push(crowd / samples);
      n++;
    }
    crowds.sort((a, b) => a - b);
    // Most break clear; the worst still have the pursuit closing in for the tackle, never a pack around him.
    expect(crowds[Math.floor(crowds.length / 2)]).toBeLessThan(1.5);
    expect(crowds[crowds.length - 1]).toBeLessThan(6);
    expect(n).toBeGreaterThan(10);
  });

  it('runs a long gain down: nobody rides along at the carrier side, the tackler included, until the hit', () => {
    let n = 0;
    let worst = 0;
    for (const { e, p } of staged) {
      if ((e.kind !== 'run' && e.kind !== 'pass') || p.carrier === null) continue;
      if (e.from === undefined || e.to === undefined || Math.abs(e.to - e.from) < 20) continue;
      const c = p.ids.indexOf(p.carrier);
      const last = p.steps - 1 - Math.round(0.6 / p.dt);
      for (let k = 0; k < 22; k++) {
        if (p.offense[k] === p.offense[c]) continue;
        // Within two yards of him while he's running with the ball (on the ground, a step quicker than a jog).
        let glued = 0;
        for (let st = 4; st < last; st++) {
          const b = pos(p, st, c);
          const b0 = pos(p, st - 4, c);
          const ball = { x: p.ball[st * 3], y: p.ball[st * 3 + 1], h: p.ball[st * 3 + 2] };
          const running = Math.hypot(b.x - b0.x, b.y - b0.y) / (4 * p.dt) > 6;
          const carrying = ball.h < 0.5 && Math.hypot(ball.x - b.x, ball.y - b.y) < 1;
          const d = pos(p, st, k);
          glued = running && carrying && Math.hypot(d.x - b.x, d.y - b.y) < 2 ? glued + p.dt : 0;
          worst = Math.max(worst, glued);
        }
      }
      n++;
    }
    expect(n).toBeGreaterThan(30);
    // The last stretch of a chase (closing into the hit) only; it was six seconds and more at the receiver's back.
    expect(worst).toBeLessThan(2);
  });

  it('never has the tackler run past the carrier, or away in front of him, on his way to the tackle', () => {
    let n = 0;
    const bad: string[] = [];
    for (const { e, p } of staged) {
      if (p.carrier === null || p.loose || /TOUCHDOWN/.test(e.text)) continue;
      const c = p.ids.indexOf(p.carrier);
      const last = p.steps - 1;
      // The tackler: the engine's on a run or a catch; on a return, the cover man on the returner at the whistle.
      const named = actorsIn(e).tackle;
      const t =
        named !== undefined && (e.kind === 'run' || e.kind === 'pass')
          ? p.ids.indexOf(named)
          : (e.kind === 'kickoff' || e.kind === 'punt') && p.arrive !== null
            ? p.ids.findIndex(
                (_, k) =>
                  p.offense[k] &&
                  Math.hypot(pos(p, last, k).x - pos(p, last, c).x, pos(p, last, k).y - pos(p, last, c).y) <= 1.2,
              )
            : -1;
      if (t < 0) continue;
      n++;
      // From when the carrier has the ball (before, a cover man running with a receiver on his route is covering him)
      // to the last half second (the hit itself).
      // (A few steps after he has it, so his heading is his run with the ball, not his route.)
      const has = Math.max(4, Math.ceil((p.arrive ?? p.release) / p.dt) + 4);
      let side = 0;
      let nearest = Infinity;
      const spot = pos(p, last, c);
      for (let st = has; st < last - Math.round(0.5 / p.dt); st++) {
        const b = pos(p, st, c);
        // Which side of him the tackler is on, along the line from the carrier to where the tackle comes (his heading
        // swings on a curving run; where he's going doesn't): between him and that spot, or behind him.
        const tl = Math.hypot(spot.x - b.x, spot.y - b.y);
        if (tl < 3) break;
        const h = { x: (spot.x - b.x) / tl, y: (spot.y - b.y) / tl };
        const d = pos(p, st, t);
        const ahead = (d.x - b.x) * h.x + (d.y - b.y) * h.y;
        const gap = Math.hypot(d.x - b.x, d.y - b.y);
        // Clearly behind the carrier, or clearly in front of him (two yards either way of level is neither), on his line:
        // a man wide of it coming across the field to meet him is neither (he isn't going by him).
        const wide = Math.abs((d.x - b.x) * h.y - (d.y - b.y) * h.x) > 4;
        const now = wide ? 0 : ahead < -2 ? -1 : ahead > 2 ? 1 : 0;
        // (Beaten, a man in front ends up behind and chases: that happens. Behind him and then out in front is a man
        // who ran past the carrier, which never does.)
        if (now === 1 && side === -1) bad.push(`passes him at ${(st * p.dt).toFixed(2)}: ${e.text}`);
        if (now) side = now;
        // In front of him and close, he's coming to meet him or giving ground: he never opens the gap back up himself
        // (the carrier pressing away from him across the field is the carrier's doing, not his).
        const d0 = pos(p, st - 4, t);
        const away = gap > 0 ? ((d.x - d0.x) * (d.x - b.x) + (d.y - d0.y) * (d.y - b.y)) / gap / (4 * p.dt) : 0;
        if (now === 1 && gap < 8) {
          if (gap > nearest + 1.5 && away > 1) bad.push(`runs away in front at ${(st * p.dt).toFixed(2)}: ${e.text}`);
          nearest = Math.min(nearest, gap);
        } else if (now !== 1) nearest = Infinity;
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect([...new Set(bad)].slice(0, 6)).toEqual([]);
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
  /** How far a man got by the end of the play (or by `until`, a step). */
  const moved = (p: StagedPlay, k: number, until = p.steps - 1) => {
    const last = until;
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
        // As far as his route took him before the rush got home (a strip-sack: before the ball came out, when
        // everyone goes for it), not where he drifted to while the quarterback went down.
        const until = p.loose ? Math.round(p.loose.t / p.dt) : p.steps - 1;
        let furthest = 0;
        for (let st = 1; st <= until; st++) furthest = Math.max(furthest, moved(p, k, st).downfield * dir);
        expect(furthest, `${e.text}`).toBeGreaterThan(5);
        routes++;
      });
    }
    expect(routes).toBeGreaterThan(40);
  });

  it('holds the pocket: blocked rushers stay off the quarterback for the first second and a half he has it', () => {
    let rushers = 0;
    for (const kind of ['pass', 'incomplete', 'sack'])
      for (const { p } of picks(kind)) {
        const qb = p.roles.indexOf('QB');
        // While he has the ball: a quick throw is gone before the first second and a half is up.
        const early = Math.min(p.steps - 1, Math.round(Math.min(1.5, p.release) / p.dt));
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
          // (A pulling guard is crossing behind the line a second in, by design.)
          // (Nor is a man climbing to a linebacker: he's on his way to his man.)
          if (p.roles[k] !== 'OL' || p.keys.includes(id) || id === p.run?.puller) return;
          if (p.run?.climb.some(([b]) => b === id)) return;
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
      // Longer the more ground it gains; a run stuffed behind the line still has its handoff and press, then ends.
      const lost = /for -\d+ yards?|for no gain/.test(e.text);
      const yards = lost ? 0 : Math.abs((e.to ?? 0) - (e.from ?? 0));
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
        // The furthest he's got from his stance by then: a zone lineman's reach step can take him a yard across before
        // he fits on a man who's slanted back over him.
        let d = 0;
        for (let s = 1; s <= st; s++)
          d = Math.max(
            d,
            Math.hypot(p.pos[(s * 22 + k) * 2] - p.pos[k * 2], p.pos[(s * 22 + k) * 2 + 1] - p.pos[k * 2 + 1]),
          );
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

describe('the call', () => {
  const plays: { e: PlayLogEntry; p: StagedPlay; call: string; coverage: string | null }[] = [];
  for (const { g, r } of games.slice(0, 20))
    r.plays!.forEach((e, i) => {
      if (e.kind !== 'run' && e.kind !== 'pass' && e.kind !== 'incomplete') return;
      const p = stagePlay({
        plays: r.plays!,
        index: i,
        record: r.field!,
        homeId: g.homeId,
        seed: `${g.id}:${i}`,
        snapY: 26,
      });
      const def = r.field!.scheme[p.home[p.ids.length - 1] ? 0 : 1];
      plays.push({ e, p, call: defenseCallAt(r.field!, i), coverage: def.coverage });
    });
  const at = (p: StagedPlay, st: number, k: number) => ({
    x: p.pos[(st * p.ids.length + k) * 2],
    y: p.pos[(st * p.ids.length + k) * 2 + 1],
  });
  /** How far past the line (toward the defense's goal) a man is. */
  const depth = (p: StagedPlay, st: number, k: number) => (at(p, st, k).x - p.ball[0]) * p.dir;

  it("reads the engine's call on every snap: blitzes, run and pass defense all come up", () => {
    const calls = new Set(plays.map((x) => x.call));
    for (const c of ['base', 'blitz', 'runD', 'passD']) expect(calls).toContain(c);
  });

  it('a blitz: a linebacker or a back walked up to the line, and after the quarterback at the snap', () => {
    let n = 0;
    let home = 0;
    for (const { p, call, e } of plays) {
      // Out in the field (at the goal line the whole defense is up on it anyway).
      if (call !== 'blitz' || e.kind === 'run' || e.yardLine > 80) continue;
      const sent = p.ids
        .map((_, k) => k)
        .filter((k) => !p.offense[k] && ['LB', 'S', 'CB'].includes(p.roles[k]) && depth(p, 0, k) < 5);
      expect(sent.length, e.text).toBeGreaterThan(0);
      // Into the backfield a second and a quarter in (the quarterback's dropping away from him meanwhile).
      const st = Math.min(p.steps - 1, Math.round(1.25 / p.dt));
      const closer = sent.some((k) => depth(p, st, k) < depth(p, 0, k) - 2.5);
      if (closer) home++;
      n++;
    }
    expect(n).toBeGreaterThan(30);
    // Most get after him; the rest are picked up by a blocker.
    expect(home / n).toBeGreaterThan(0.7);
  });

  it('against the run, eight in the box; against the pass, the safeties deeper', () => {
    const box = (p: StagedPlay) =>
      p.ids.filter((_, k) => !p.offense[k] && depth(p, 0, k) < 8 && Math.abs(at(p, 0, k).y - p.ball[1]) < 8).length;
    const deep = (p: StagedPlay) =>
      Math.max(...p.ids.map((_, k) => (!p.offense[k] && p.roles[k] === 'S' ? depth(p, 0, k) : 0)));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const of = (c: string) => plays.filter((x) => x.call === c).map((x) => x.p);
    // The second safety comes down against the run where he plays deep: in a two-high shell (a single-high's second
    // safety already sits in the box on every call, so a league's mix of shells decides the gap there).
    const twoHigh = (c: string) =>
      plays
        .filter((x) => x.call === c && (x.coverage ? COVERAGES[x.coverage as CoverageId].twoHigh : true))
        .map((x) => x.p);
    expect(mean(twoHigh('runD').map(box))).toBeGreaterThan(mean(twoHigh('passD').map(box)) + 0.5);
    expect(mean(of('passD').map(deep))).toBeGreaterThan(mean(of('base').map(deep)) + 1);
  });

  it("drops the zone to its coverage's landmarks: Cover 3 corners bail deep, Tampa 2 corners sit in the flat", () => {
    const corners = (cov: string) =>
      plays
        .filter((x) => x.coverage === cov && x.call !== 'blitz' && x.e.kind !== 'run')
        .flatMap(({ p }) =>
          p.ids
            .map((_, k) => k)
            .filter((k) => !p.offense[k] && p.roles[k] === 'CB')
            .slice(0, 2)
            .map((k) => depth(p, Math.min(p.steps - 1, Math.round(1.8 / p.dt)), k)),
        );
    const three = corners('cover3');
    const two = corners('cover2');
    if (three.length && two.length) {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(three)).toBeGreaterThan(mean(two) + 3);
    } else expect(three.length + two.length).toBeGreaterThan(0);
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
  /** A kick run back, as the stage draws it: to where the return ended, not where a flag's walk-off put the ball. */
  const ranBack = (x: PlayLogEntry) => {
    const e = returned(x);
    return e.air !== undefined && e.to !== undefined && Math.abs(e.to - e.air) > 0.5;
  };
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
      if (!ranBack(e) || /TOUCHDOWN|BLOCKED|onside/i.test(e.text)) continue;
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

  it('runs the returner down: the tackler arrives at speed, not waiting for him', () => {
    let n = 0;
    let moving = 0;
    for (const { e, p } of [...kickoffs, ...punts]) {
      if (!ranBack(e) || /TOUCHDOWN|BLOCKED|onside/i.test(e.text) || p.carrier === null) continue;
      const last = p.steps - 1;
      const c = p.ids.indexOf(p.carrier);
      const end = at(p, last, c);
      const k = p.ids.findIndex(
        (_, j) => p.offense[j] && Math.hypot(at(p, last, j).x - end.x, at(p, last, j).y - end.y) <= 1.2,
      );
      if (k < 0) continue;
      // His speed over the last half second.
      const back = Math.round(0.5 / p.dt);
      const a = at(p, last - back, k);
      const b = at(p, last, k);
      if (Math.hypot(b.x - a.x, b.y - a.y) / 0.5 > 4) moving++;
      n++;
    }
    expect(n).toBeGreaterThan(30);
    expect(moving / n).toBeGreaterThan(0.9);
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

  /** How far a kick was run back (yards), as the stage draws it. */
  const returnLength = (x: PlayLogEntry) => {
    const e = returned(x);
    return Math.abs((e.to ?? 0) - (e.air ?? 0));
  };
  const allKicks = [...kickoffs, ...punts];

  it('ends most tackled returns in a pile: two or more cover men within 2 yards at the whistle', () => {
    let n = 0;
    let piles = 0;
    for (const { e, p } of allKicks) {
      if (!ranBack(e) || /TOUCHDOWN|BLOCKED|onside|fumble/i.test(e.text) || p.carrier === null) continue;
      const last = p.steps - 1;
      const end = at(p, last, p.ids.indexOf(p.carrier));
      const near = p.ids.filter(
        (_, k) => p.offense[k] && Math.hypot(at(p, last, k).x - end.x, at(p, last, k).y - end.y) <= 2,
      ).length;
      if (near >= 2) piles++;
      n++;
    }
    expect(n).toBeGreaterThan(30);
    expect(piles / n).toBeGreaterThanOrEqual(0.7);
  });

  it('never stages a miss on a return under 30 yards, and at most one on a long one', () => {
    let long = 0;
    for (const { e, segs, p } of allKicks) {
      if (!ranBack(e) || /BLOCKED|onside/i.test(e.text)) continue;
      const big = returnLength(e) >= 30 || /TOUCHDOWN/.test(e.text);
      if (!big) expect(p.move, e.text).toBeUndefined();
      // Distinct moves on the path: a move's legs run back to back.
      const starts = segs.filter((s, i) => s.move && !segs[i - 1]?.move).length;
      expect(starts).toBeLessThanOrEqual(1);
      if (big) long++;
    }
    expect(long).toBeGreaterThan(3);
  });

  it('keeps the last man a step behind on a return touchdown', () => {
    // Return touchdowns are rare in a sample this size: real returns, taken to the house.
    let n = 0;
    let angled = 0;
    for (const { g, r } of games.slice(0, 10))
      r.plays!.forEach((raw, i) => {
        if (
          (raw.kind !== 'kickoff' && raw.kind !== 'punt') ||
          !ranBack(raw) ||
          /PENALTY|BLOCKED|onside|TOUCHDOWN|fumble/i.test(raw.text)
        )
          return;
        const back = Math.sign((raw.from ?? 0) - (raw.air ?? 0));
        const e = { ...raw, to: back > 0 ? 101 : -1, text: `${raw.text}, TOUCHDOWN` };
        const p = stagePlay({
          plays: Object.assign(r.plays!.slice(), { [i]: e }),
          index: i,
          record: r.field!,
          homeId: g.homeId,
          seed: `k${i}`,
          snapY: 26,
        });
        if (p.carrier === null) return;
        const c = p.ids.indexOf(p.carrier);
        const kicker = p.roles.findIndex((role, k) => p.offense[k] && (role === 'K' || role === 'P'));
        let closest = Infinity;
        for (let st = 0; st < p.steps - 1; st++) {
          const a = at(p, st, kicker);
          const b = at(p, st, c);
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          expect(d, `${e.text} at ${(st * p.dt).toFixed(2)}`).toBeGreaterThan(1);
          closest = Math.min(closest, d);
        }
        // He has the last angle: a step short, under 2.1 yards off the returner as he goes by (left to his own
        // pursuit, the kicker passes him about 2.2 yards off).
        if (closest < 2.1) angled++;
        n++;
      });
    expect(n).toBeGreaterThan(10);
    expect(angled / n).toBeGreaterThan(0.8);
  });
});

describe('the loose ball', () => {
  const stage = (g: Game, plays: PlayLogEntry[], i: number) =>
    stagePlay({
      plays,
      index: i,
      record: games.find((x) => x.g === g)!.r.field!,
      homeId: g.homeId,
      seed: `f${i}`,
      snapY: 26,
    });
  const fumbles = games.flatMap(({ g, r }) =>
    r.plays!.flatMap((raw, i) => {
      const e = asRan(raw);
      const f = fumbleIn(e);
      return f && raw.down > 0 ? [{ e, f, g, i, plays: r.plays!, p: stage(g, r.plays!, i) }] : [];
    }),
  );
  /** The man who had the ball when it came out. */
  const fumbler = (e: PlayLogEntry, p: StagedPlay) => {
    const qb = p.ids[p.roles.findIndex((r, k) => r === 'QB' && p.offense[k])];
    return e.kind === 'sack' ? qb : (actorsIn(e).ball ?? qb);
  };
  const ballAt = (p: StagedPlay, step: number) => ({ x: p.ball[step * 3], y: p.ball[step * 3 + 1] });
  const at = (p: StagedPlay, id: number, step: number) => {
    const k = p.ids.indexOf(id);
    return { x: p.pos[(step * p.ids.length + k) * 2], y: p.pos[(step * p.ids.length + k) * 2 + 1] };
  };
  const last = (p: StagedPlay) => p.steps - 1;

  it('finds fumbles of both kinds in 40 games', () => {
    expect(fumbles.filter((x) => x.f.lost).length).toBeGreaterThan(10);
    expect(fumbles.filter((x) => !x.f.lost).length).toBeGreaterThan(5);
  });

  it('has the ball loose where the engine says, at the hit, and settled where it was recovered', () => {
    for (const { e, f, p } of fumbles) {
      expect(p.loose, e.text).toBeDefined();
      const hit = Math.round(p.loose!.t / p.dt);
      const b = ballAt(p, hit);
      expect(Math.hypot(b.x - p.loose!.x, b.y - p.loose!.y), e.text).toBeLessThan(0.5);
      expect(Math.abs(p.loose!.x - f.x)).toBeLessThanOrEqual(1.51);
      // Lost and not returned, or kept: the ball's last spot is where the play ended.
      if (!f.lost || Math.abs(e.to! - f.x) <= 0.5)
        expect(Math.abs(ballAt(p, last(p)).x - e.to!), e.text).toBeLessThan(0.5);
    }
  });

  it("gives the ball to the man who recovered it: the engine's on a lost one, the man who fumbled on a kept one", () => {
    for (const { e, f, p } of fumbles) {
      expect(p.carrier, e.text).toBe(f.lost ? actorsIn(e).take : fumbler(e, p));
      expect(p.loose!.by).toBe(p.carrier);
      const b = ballAt(p, last(p));
      const c = at(p, p.carrier!, last(p));
      expect(Math.hypot(b.x - c.x, b.y - c.y), e.text).toBeLessThan(1);
    }
  });

  it('puts the man who fumbled down where it came out: no running on', () => {
    let n = 0;
    for (const { e, f, p } of fumbles) {
      if (!f.lost) continue;
      const id = fumbler(e, p);
      for (let st = Math.round(p.loose!.t / p.dt) + 1; st <= last(p); st++) {
        const q = at(p, id, st);
        expect(Math.hypot(q.x - p.loose!.x, q.y - p.loose!.y), e.text).toBeLessThan(1.5);
      }
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  it("returns a lost one to the play's end, run down by the offense unless he scores", () => {
    let n = 0;
    for (const { e, f, p } of fumbles) {
      if (!f.lost || Math.abs(e.to! - f.x) <= 0.5) continue;
      const end = ballAt(p, last(p));
      expect(Math.abs(end.x - e.to!), e.text).toBeLessThan(0.5);
      const c = at(p, p.carrier!, last(p));
      const near = p.ids.some(
        (id, k) => p.offense[k] && Math.hypot(at(p, id, last(p)).x - c.x, at(p, id, last(p)).y - c.y) < 1.5,
      );
      expect(near, e.text).toBe(e.to! > 0 && e.to! < 100);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  it("stages a wiped snap's fumble from ran.loose", () => {
    const { e, g, i, plays } = fumbles.find((x) => x.f.lost && x.e.loose !== undefined && x.e.kind !== 'penalty')!;
    const wiped: PlayLogEntry = {
      ...plays[i],
      kind: 'penalty',
      to: e.from,
      loose: undefined,
      ran: { kind: e.kind, to: e.to, air: e.air, who: e.who, loose: e.loose },
    };
    const p = stage(g, Object.assign(plays.slice(), { [i]: wiped }), i);
    expect(p.loose).toBeDefined();
    expect(Math.abs(p.loose!.x - e.loose!)).toBeLessThanOrEqual(1.51);
  });

  it('ends a fumble returned for a touchdown in the end zone, untackled', () => {
    const { e, g, i, plays } = fumbles.find((x) => x.f.lost && x.e.kind === 'run')!;
    const p0 = stage(g, plays, i);
    // The fumbling offense's own end zone: behind it, the way it was driving.
    const td: PlayLogEntry = { ...plays[i], to: p0.dir === 1 ? -3 : 103 };
    const p = stage(g, Object.assign(plays.slice(), { [i]: td }), i);
    const end = ballAt(p, last(p));
    expect(Math.abs(end.x - td.to!)).toBeLessThan(0.5);
    const c = at(p, p.carrier!, last(p));
    expect(
      p.ids.some((id, k) => p.offense[k] && Math.hypot(at(p, id, last(p)).x - c.x, at(p, id, last(p)).y - c.y) < 1.2),
    ).toBe(false);
    expect(e.kind).toBe('run');
  });

  it('stages a fumble from a game before the spot was kept (v78): the ball ends where the play did', () => {
    const { g, i, plays } = fumbles.find((x) => x.f.lost && x.e.loose !== undefined && x.e.kind !== 'penalty')!;
    const old: PlayLogEntry = { ...plays[i], loose: undefined };
    const p = stage(g, Object.assign(plays.slice(), { [i]: old }), i);
    expect(Math.abs(ballAt(p, last(p)).x - old.to!)).toBeLessThan(0.5);
    expect(p.carrier).toBe(actorsIn(old).take);
  });
});

describe('the pocket', () => {
  const drops = games.slice(0, 20).flatMap(({ g, r }) =>
    r.plays!.flatMap((raw, i) => {
      const e = asRan(raw);
      if (raw.down <= 0 || !['pass', 'incomplete', 'int', 'sack', 'scramble'].includes(e.kind ?? '')) return [];
      return [
        {
          e,
          p: stagePlay({ plays: r.plays!, index: i, record: r.field!, homeId: g.homeId, seed: `pk${i}`, snapY: 26 }),
        },
      ];
    }),
  );
  const P = (p: StagedPlay, k: number, st: number) => ({
    x: p.pos[(st * 22 + k) * 2],
    y: p.pos[(st * 22 + k) * 2 + 1],
  });
  const qbOf = (p: StagedPlay) => p.roles.findIndex((r, k) => r === 'QB' && p.offense[k]);
  const stepAt = (p: StagedPlay, t: number) => Math.min(p.steps - 1, Math.max(0, Math.round(t / p.dt)));
  const throws = drops.filter(({ e }) => e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int');

  it('plans every dropback, and never has the quarterback past the line before he throws', () => {
    expect(throws.length).toBeGreaterThan(1000);
    for (const { e, p } of drops) {
      expect(p.pocket, e.text).not.toBeNull();
      const qb = qbOf(p);
      const until = stepAt(p, e.kind === 'scramble' ? p.release : p.release);
      for (let st = 0; st <= until; st++) expect((P(p, qb, st).x - p.ball[0]) * p.dir, e.text).toBeLessThan(0);
    }
  });

  it('steps up into the throw from a deep drop in a clean pocket', () => {
    let n = 0;
    let up = 0;
    for (const { p } of throws) {
      const plan = p.pocket!;
      if (plan.pressure !== 'none' || plan.bootleg || plan.drop < 5) continue;
      const qb = qbOf(p);
      const deepest = Math.min(
        ...Array.from({ length: stepAt(p, p.release) + 1 }, (_, st) => (P(p, qb, st).x - p.ball[0]) * p.dir),
      );
      const atThrow = (P(p, qb, stepAt(p, p.release)).x - p.ball[0]) * p.dir;
      if (atThrow > deepest + 0.7) up++;
      n++;
    }
    expect(n).toBeGreaterThan(50);
    expect(up / n).toBeGreaterThan(0.9);
  });

  it('moves away from the rush that gets there, as the ball comes out', () => {
    let n = 0;
    let away = 0;
    for (const { e, p } of throws) {
      const rush = actorsIn(e).rush;
      if (rush === undefined || p.pocket!.pressure === 'none') continue;
      const qb = qbOf(p);
      const r = p.ids.indexOf(rush);
      const a = stepAt(p, p.release - 0.7);
      const b = stepAt(p, p.release);
      // His move takes him away from where the rusher was as he started it (the rusher still gets to him: the hit).
      const d = (q: { x: number; y: number }) => Math.hypot(q.x - P(p, r, a).x, q.y - P(p, r, a).y);
      if (d(P(p, qb, b)) > d(P(p, qb, a))) away++;
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(away / n).toBeGreaterThan(0.85);
  });

  it('forms a cup: in a clean pocket the quarterback is between his tackles and behind his line as he throws', () => {
    let n = 0;
    let inside = 0;
    for (const { p } of throws) {
      const plan = p.pocket!;
      if (plan.pressure !== 'none' || plan.bootleg || plan.roll) continue;
      const qb = qbOf(p);
      const st = stepAt(p, p.release);
      const line = p.ids.map((_, k) => k).filter((k) => p.offense[k] && p.roles[k] === 'OL');
      const ys = line.map((k) => P(p, k, st).y);
      const q = P(p, qb, st);
      const behind = line.every((k) => (q.x - P(p, k, st).x) * p.dir < 0);
      if (q.y > Math.min(...ys) - 0.5 && q.y < Math.max(...ys) + 0.5 && behind) inside++;
      n++;
    }
    expect(n).toBeGreaterThan(500);
    expect(inside / n).toBeGreaterThan(0.9);
  });

  it('brings the sacker past the blocker the engine names, and down with the quarterback on the sack spot', () => {
    let n = 0;
    for (const { e, p } of drops) {
      if (e.kind !== 'sack' || p.loose) continue;
      const who = actorsIn(e);
      if (who.rush === undefined) continue;
      const r = p.ids.indexOf(who.rush);
      const qb = qbOf(p);
      const last = p.steps - 1;
      const end = { x: p.ball[last * 3], y: p.ball[last * 3 + 1] };
      expect(Math.hypot(P(p, qb, last).x - end.x, P(p, qb, last).y - end.y), e.text).toBeLessThan(0.5);
      expect(Math.hypot(P(p, r, last).x - end.x, P(p, r, last).y - end.y), e.text).toBeLessThan(1.2);
      // The engine's beaten block, when the formation lined the two up near enough to act it out (`BEAT_ACROSS`).
      const lined = (k: number) => P(p, k, 0).y;
      if (who.beat !== undefined && Math.abs(lined(p.ids.indexOf(who.beat)) - lined(r)) <= BEAT_ACROSS) {
        const b = p.ids.indexOf(who.beat);
        let passed = false;
        for (let st = 0; st <= last; st++)
          if (Math.hypot(P(p, r, st).x - P(p, b, st).x, P(p, r, st).y - P(p, b, st).y) < 2) passed = true;
        expect(passed, e.text).toBe(true);
        const dq = (k: number) => Math.hypot(P(p, k, last).x - P(p, qb, last).x, P(p, k, last).y - P(p, qb, last).y);
        expect(dq(r)).toBeLessThan(dq(b));
      }
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe('the pattern', () => {
  it('gives every throw to a receiver a concept and the route that fits his catch', () => {
    let n = 0;
    for (const { g, r } of games.slice(0, 10))
      r.plays!.forEach((raw, i) => {
        const e = asRan(raw);
        if (raw.down <= 0 || (e.kind !== 'pass' && e.kind !== 'incomplete' && e.kind !== 'int')) return;
        if (actorsIn(e).ball === undefined || /throws it away/.test(e.text)) return;
        const p = stagePlay({
          plays: r.plays!,
          index: i,
          record: r.field!,
          homeId: g.homeId,
          seed: `pt${i}`,
          snapY: 26,
        });
        expect(p.pattern, e.text).toBeDefined();
        n++;
      });
    expect(n).toBeGreaterThan(300);
  });

  it('stages a game without actors (before v71): every play ends where the engine says', () => {
    const { g, r } = games[3];
    const bare = r.plays!.map((e) => {
      const c: PlayLogEntry = { ...e };
      delete c.who;
      if (c.ran) c.ran = { ...c.ran, who: undefined };
      return c;
    });
    bare.forEach((e, i) => {
      const p = stagePlay({ plays: bare, index: i, record: r.field!, homeId: g.homeId, seed: `bare${i}`, snapY: 26 });
      const segs = stagedPath(returned(asRan(e)), g.homeId, 26);
      if (!segs.length) return;
      const end = pointAt(segs[segs.length - 1], 1);
      const last = (p.steps - 1) * 3;
      expect(Math.abs(p.ball[last] - end.x), e.text).toBeLessThan(0.5);
    });
  });
});

describe('screens and throwaways', () => {
  const all = games.flatMap(({ g, r }) =>
    r.plays!.flatMap((raw, i) => {
      const e = asRan(raw);
      if (raw.down <= 0 || (e.kind !== 'pass' && e.kind !== 'incomplete')) return [];
      return [
        {
          e,
          p: stagePlay({ plays: r.plays!, index: i, record: r.field!, homeId: g.homeId, seed: `sc${i}`, snapY: 26 }),
        },
      ];
    }),
  );
  const P = (p: StagedPlay, k: number, st: number) => ({
    x: p.pos[(st * 22 + k) * 2],
    y: p.pos[(st * 22 + k) * 2 + 1],
  });

  it('leads a screen to the back with the line: two or more linemen past the line, on its side, by the catch', () => {
    let n = 0;
    for (const { e, p } of all) {
      const target = actorsIn(e).ball;
      if (p.pattern?.route !== 'screen' || target === undefined || p.arrive === null) continue;
      const t = p.ids.indexOf(target);
      if (p.roles[t] !== 'RB' && p.roles[t] !== 'TE') continue;
      // Out in front as he gets going: just after the catch.
      const st = Math.min(p.steps - 1, Math.round((p.arrive + 0.6) / p.dt));
      const catchAt = P(p, t, Math.min(p.steps - 1, Math.round(p.arrive / p.dt)));
      // Its side, for a screen out to one: up the middle the lead blockers fan out both ways.
      const side = Math.abs(catchAt.y - p.ball[1]) > 3 ? Math.sign(catchAt.y - p.ball[1]) : 0;
      const leading = p.ids
        .map((_, k) => k)
        .filter((k) => p.offense[k] && p.roles[k] === 'OL')
        .filter(
          (k) => (P(p, k, st).x - p.ball[0]) * p.dir > 0 && (side === 0 || (P(p, k, st).y - p.ball[1]) * side > -1),
        );
      expect(leading.length, e.text).toBeGreaterThanOrEqual(2);
      n++;
    }
    expect(n).toBeGreaterThan(3);
  });

  it('throws a throwaway out of bounds, downfield on the side he rolled to', () => {
    let n = 0;
    for (const { e, p } of all) {
      if (!/throws it away/.test(e.text) || !p.pocket) continue;
      const last = p.steps - 1;
      const y = p.ball[last * 3 + 1];
      expect(y < 0 || y > FIELD_W, e.text).toBe(true);
      expect((p.ball[last * 3] - p.ball[0]) * p.dir).toBeGreaterThan(5);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe('the run game', () => {
  const runs = games.flatMap(({ g, r }) =>
    r.plays!.flatMap((e, index) =>
      e.kind === 'run' && e.down > 0 && e.from !== undefined
        ? [{ g, r, e, index, snapY: snapYFor(e, 20 + (index % 14)) }]
        : [],
    ),
  );
  type Run = (typeof runs)[number];
  const stage = (x: Run, e: PlayLogEntry = x.e) =>
    stagePlay({
      plays: Object.assign(x.r.plays!.slice(), { [x.index]: e }),
      index: x.index,
      record: x.r.field!,
      homeId: x.g.homeId,
      seed: `${x.g.id}:${x.index}`,
      snapY: x.snapY,
    });
  /** The same run with one habit on one man (and nothing else noted). */
  const withHabit = (x: Run, id: number, q: QuirkId): PlayLogEntry => ({
    ...x.e,
    open: { ...x.e.open, habits: [[id, q]] },
  });
  const without = (x: Run): PlayLogEntry => ({ ...x.e, open: { ...x.e.open, habits: [] } });
  const at = (p: StagedPlay, t: number, id: number) => {
    const k = p.ids.indexOf(id);
    const st = Math.max(0, Math.min(p.steps - 1, Math.round(t / p.dt)));
    return { x: p.pos[(st * p.ids.length + k) * 2], y: p.pos[(st * p.ids.length + k) * 2 + 1] };
  };
  /** A linebacker who's neither the tackler nor the man who misses. */
  const freeBacker = (x: Run, p: StagedPlay) => {
    const who = actorsIn(x.e);
    return p.ids.find(
      (id, k) => !p.offense[k] && p.roles[k] === 'LB' && id !== who.tackle && id !== x.e.open?.broke?.by,
    );
  };

  it('leaves almost no unblocked defender standing within 5 yards of the hole as the back goes through', () => {
    let n = 0;
    const standing = new Set<string>();
    // Six hundred runs: over three hundred, a world's rate swung across the line with nothing in the staging changed.
    // (Held by any lineman passing, the real-heights world's free men stood here in 6.6% of them; held only by their
    // own blocker, 3.4%.)
    for (const x of runs.slice(0, 600)) {
      const p = stage(x);
      // (A fumble's carrier at the end may be the man who picked it up.)
      if (!p.run || p.carrier === null || p.loose) continue;
      const c = p.ids.indexOf(p.carrier);
      const who = actorsIn(x.e);
      let cross = -1;
      for (let st = 0; st < p.steps; st++)
        if ((p.pos[(st * p.ids.length + c) * 2] - p.run.hole.x) * p.dir > 0) {
          cross = st;
          break;
        }
      if (cross < 0) continue;
      n++;
      // (Not the last half second: that is the tackle, the chase converging.)
      for (let st = Math.max(1, cross - 10); st < Math.min(p.steps - 10, cross + 10); st++)
        p.ids.forEach((id, k) => {
          if (p.offense[k] || id === who.tackle || id === x.e.open?.broke?.by) return;
          const d = at(p, st * p.dt, id);
          if (Math.hypot(d.x - p.run!.hole.x, d.y - p.run!.hole.y) > 5) return;
          const was = at(p, (st - 1) * p.dt, id);
          const moving = Math.hypot(d.x - was.x, d.y - was.y) / p.dt > 2;
          // (At the carrier, in the pile as the tackle's made, is where a man should be; one who was at him in the last
          // second has missed him and is going down.)
          for (let back = 0; back <= 1; back += 0.1) {
            const ball = at(p, st * p.dt - back, p.carrier!);
            const was = at(p, st * p.dt - back, id);
            if (Math.hypot(was.x - ball.x, was.y - ball.y) < (back ? 2.5 : 2)) return;
          }
          const blocked = p.ids.some(
            (o, j) =>
              p.offense[j] && j !== c && Math.hypot(at(p, st * p.dt, o).x - d.x, at(p, st * p.dt, o).y - d.y) < 2.2,
          );
          if (!moving && !blocked) standing.add(`${x.g.id}:${x.index}`);
        });
    }
    expect(n).toBeGreaterThan(100);
    // Now and then a linebacker reads the back from the second level a beat before he gets there, as they do; never
    // more than about one run in seventeen.
    expect(standing.size / n).toBeLessThan(0.06);
  });

  it("lets the run's free men go: a lineman blocking someone else never holds a man the blocking left free", () => {
    let men = 0;
    let held = 0;
    for (const x of runs) {
      const p = stage(x);
      if (!p.run || p.carrier === null || p.loose) continue;
      const c = p.ids.indexOf(p.carrier);
      const pos = (st: number, k: number) => ({
        x: p.pos[(st * p.ids.length + k) * 2],
        y: p.pos[(st * p.ids.length + k) * 2 + 1],
      });
      for (const id of p.run.free) {
        const k = p.ids.indexOf(id);
        men++;
        // From the handoff until the back is two and a half yards past the line: a block's pace (1 yd/s on a run)
        // beside a lineman for a fifth of a second is a hold.
        let streak = 0;
        for (let st = Math.round(p.release / p.dt) + 1; st < p.steps; st++) {
          if ((pos(st, c).x - p.ball[0]) * p.dir >= 2.5) break;
          const v = Math.hypot(pos(st, k).x - pos(st - 1, k).x, pos(st, k).y - pos(st - 1, k).y) / p.dt;
          const lineman = p.ids.some(
            (_, j) =>
              p.offense[j] &&
              p.roles[j] === 'OL' &&
              Math.hypot(pos(st, j).x - pos(st, k).x, pos(st, j).y - pos(st, k).y) < 1.6,
          );
          streak = v <= 1.05 && lineman ? streak + 1 : 0;
          if (streak === 4) {
            held++;
            break;
          }
        }
      }
    }
    expect(men).toBeGreaterThan(2000);
    // (A man pushed off a lineman for a moment, or reaching his spot beside one, is the odd exception.)
    expect(held / men).toBeLessThan(0.01);
  });

  it('runs a pulling guard behind the line, never through it', () => {
    let pulls = 0;
    for (const x of runs) {
      const p = stage(x);
      if (!p.run?.puller) continue;
      pulls++;
      const id = p.run.puller;
      const ballX = p.ball[0];
      for (let t = 0; t < 1.6; t += 0.05) {
        const q = at(p, t, id);
        if (Math.abs(q.y - p.run.hole.y) < 1) break;
        expect((q.x - ballX) * p.dir).toBeLessThanOrEqual(0.2);
      }
    }
    expect(pulls).toBeGreaterThan(20);
  });

  it('shows each linebacker habit: a gap-shooter shoots, a scraper flows, slow flow waits, a misread goes wrong', () => {
    const seen = { gapShooter: 0, scraper: 0, slowFlow: 0, misreadsKeys: 0 };
    // Runs with a side to them (straight up the middle the play side is the back's to choose: Task 4's press).
    for (const x of runs.filter((r) => Math.abs(r.e.lane ?? 0) > 0.2).slice(0, 150)) {
      const base = stage(x, without(x));
      const lb = base.run && freeBacker(x, base);
      if (lb === undefined || !base.run) continue;
      const r = base.release;
      const ballX = base.ball[0];
      const fieldSide = base.dir * base.run.side;
      const depth = (p: StagedPlay, t: number) => (at(p, t, lb).x - ballX) * p.dir;
      const lateral = (p: StagedPlay, t: number) => (at(p, t, lb).y - at(p, 0, lb).y) * fieldSide;
      const shoot = stage(x, withHabit(x, lb, 'gapShooter'));
      const minDepth = (p: StagedPlay) => Math.min(...[0.2, 0.4, 0.6, 0.8].map((d) => depth(p, r + d)));
      // (Where he'd have been in the backfield anyway, on a run stopped for a loss, there's nothing to tell apart.)
      if (minDepth(base) > 0.5) {
        expect(minDepth(shoot)).toBeLessThan(minDepth(base) - 1);
        seen.gapShooter++;
      }
      // A scraper flows across over the top: at least as far across as he would have, without coming downhill.
      const scrape = stage(x, withHabit(x, lb, 'scraper'));
      expect(lateral(scrape, r + 0.6)).toBeGreaterThanOrEqual(lateral(base, r + 0.6) - 0.5);
      expect(depth(scrape, r + 0.6)).toBeGreaterThan(depth(scrape, 0) - 1);
      seen.scraper++;
      const slow = stage(x, withHabit(x, lb, 'slowFlow'));
      const moved = (p: StagedPlay) =>
        Math.hypot(at(p, r + 0.4, lb).x - at(p, r, lb).x, at(p, r + 0.4, lb).y - at(p, r, lb).y);
      expect(moved(slow)).toBeLessThan(0.5);
      seen.slowFlow++;
      const misread = stage(x, withHabit(x, lb, 'misreadsKeys'));
      // His first steps go against the flow (the play side), a yard and more.
      expect(lateral(misread, r + 0.4)).toBeLessThan(-0.8);
      seen.misreadsKeys++;
    }
    for (const n of Object.values(seen)) expect(n).toBeGreaterThan(40);
  });

  it('keeps a linebacker stuck on blocks blocked, and sends a second-level blocker up early', () => {
    let stuck = 0;
    let climbs = 0;
    const gained: number[] = [];
    const held: number[] = [];
    for (const x of runs.slice(0, 200)) {
      const base = stage(x, without(x));
      if (!base.run) continue;
      const lb = freeBacker(x, base);
      if (lb !== undefined) {
        const p = stage(x, withHabit(x, lb, 'stuckOnBlocks'));
        const near = (t: number) => {
          const d = at(p, t, lb);
          return p.ids.some(
            (o, j) => p.offense[j] && o !== p.carrier && Math.hypot(at(p, t, o).x - d.x, at(p, t, o).y - d.y) < 2.2,
          );
        };
        // Engaged: a blocker (a lineman, a tight end, a back who isn't carrying it) gets within 1.6 yards of him.
        const hands = (t: number) => {
          const d = at(p, t, lb);
          return p.ids.some(
            (o, j) =>
              p.offense[j] &&
              o !== p.carrier &&
              ['OL', 'TE', 'RB'].includes(p.roles[j]) &&
              Math.hypot(at(p, t, o).x - d.x, at(p, t, o).y - d.y) < 1.6,
          );
        };
        let engaged = -1;
        for (let t = p.release; t < p.steps * p.dt; t += 0.05)
          if (hands(t)) {
            engaged = t + 0.1;
            break;
          }
        if (engaged >= 0) {
          stuck++;
          let on = 0;
          let all = 0;
          for (let t = engaged; t < (p.steps - 1) * p.dt; t += 0.1) {
            all++;
            if (near(t)) on++;
          }
          if (all) held.push(on / all);
        }
      }
      const [climber, target] = base.run.climb[0] ?? [];
      if (climber === undefined) continue;
      const up = stage(x, withHabit(x, climber, 'secondLevel'));
      // Sealed: a second later he's on his linebacker (hands on him), between him and the hole. (A lineman still at the
      // line is nearer the hole than any linebacker: being on him is what climbing early buys.)
      const sealed = (p: StagedPlay) => {
        const h = p.run!.hole;
        const c = at(p, p.release + 1.2, climber);
        const l = at(p, p.release + 1.2, target);
        const on = Math.hypot(l.x - c.x, l.y - c.y) < 1.6;
        return on && Math.hypot(l.x - h.x, l.y - h.y) > Math.hypot(c.x - h.x, c.y - h.y) ? 1 : 0;
      };
      gained.push(sealed(up) - sealed(base));
      climbs++;
    }
    expect(stuck).toBeGreaterThan(10);
    // Once a blocker has him, he stays on blocks: nearly all the rest of the play.
    expect(held.reduce((t, h) => t + h, 0) / held.length).toBeGreaterThan(0.85);
    expect(climbs).toBeGreaterThan(20);
    // A second-level blocker leaves the double early and seals his man off the hole more often.
    expect(gained.reduce((t, g) => t + g, 0) / gained.length).toBeGreaterThan(0.1);
  });

  /** When the carrier first crosses the line of scrimmage (seconds), or -1. */
  const crossAt = (p: StagedPlay, x: Run, past = 0) => {
    if (p.carrier === null) return -1;
    const c = p.ids.indexOf(p.carrier);
    for (let st = 0; st < p.steps; st++)
      if ((p.pos[(st * p.ids.length + c) * 2] - x.e.from!) * p.dir > past) return st * p.dt;
    return -1;
  };
  const role = (p: StagedPlay, id: number | null) => (id === null ? undefined : p.roles[p.ids.indexOf(id)]);
  /** A handed-off run: a back or a receiver carries it, and it gets past the line. */
  const handed = (p: StagedPlay) =>
    role(p, p.carrier) === 'RB' || role(p, p.carrier) === 'WR' || role(p, p.carrier) === 'TE';
  const opened = (x: Run, open: PlayLogEntry['open']): PlayLogEntry => ({ ...x.e, open: { ...x.e.open, ...open } });
  /** A defender on the field who's neither the tackler nor the man who misses, nearest the line. */
  const someone = (x: Run, p: StagedPlay) => {
    const who = actorsIn(x.e);
    return (
      p.ids.find((id, k) => !p.offense[k] && p.roles[k] === 'LB' && id !== who.tackle) ??
      p.ids.find((id, k) => !p.offense[k] && id !== who.tackle)!
    );
  };

  it('keeps everyone off the back in the hole without pushing anyone faster than his legs, step by step', () => {
    let n = 0;
    const fast: string[] = [];
    for (const x of runs) {
      const p = stage(x);
      if (p.carrier === null) continue;
      const c = p.ids.indexOf(p.carrier);
      n++;
      // While the back is short of the crease's end (2.5 yards past the line), every step.
      for (let st = 1; st < p.steps; st++) {
        if ((at(p, st * p.dt, p.carrier).x - x.e.from!) * p.dir >= 2.5) break;
        p.ids.forEach((id, k) => {
          if (p.offense[k] || k === c || p.keys.includes(id) || id === p.move?.by) return;
          const a = at(p, (st - 1) * p.dt, id);
          const b = at(p, st * p.dt, id);
          const v = Math.hypot(b.x - a.x, b.y - a.y) / p.dt;
          if (v > SPEED[p.roles[k] as keyof typeof SPEED] + 0.8)
            fast.push(`${p.roles[k]} ${v.toFixed(1)}: ${x.e.text}`);
        });
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(fast.slice(0, 5)).toEqual([]);
  });

  it('crosses the line between 2.3 and 3.5 s on every handed-off run', () => {
    let n = 0;
    for (const x of runs.slice(0, 300)) {
      const p = stage(x);
      if (!handed(p) || role(p, p.carrier) !== 'RB') continue;
      const t = crossAt(p, x);
      if (t < 0) continue;
      expect(t, x.e.text).toBeGreaterThanOrEqual(2.3);
      expect(t, x.e.text).toBeLessThanOrEqual(3.5);
      n++;
    }
    expect(n).toBeGreaterThan(150);
  });

  it('stages one move per broken tackle, against the man who missed, and none without one', () => {
    let broke = 0;
    for (const x of runs.slice(0, 300)) {
      const p = stage(x);
      if (!handed(p)) continue;
      const by = x.e.open?.broke?.by;
      expect(!!p.move, x.e.text).toBe(!!x.e.open?.broke);
      if (!p.move || by === undefined || !p.ids.includes(by)) continue;
      const d = at(p, p.move.t, by);
      const c = at(p, p.move.t, p.carrier!);
      expect(Math.hypot(d.x - c.x, d.y - c.y), x.e.text).toBeLessThan(1.5);
      broke++;
    }
    expect(broke).toBeGreaterThan(10);
  });

  it('drives the man back on a size break and sends him past on a move', () => {
    const seen = { size: 0, move: 0 };
    for (const x of runs.slice(0, 200)) {
      const base = stage(x);
      if (!handed(base) || base.carrier === null) continue;
      for (const how of ['size', 'move'] as const) {
        const by = someone(x, base);
        const p = stage(x, opened(x, { broke: { by, how }, habits: [] }));
        if (!p.move) continue;
        const t = p.move.t;
        const c0 = at(p, t - 0.1, p.carrier!);
        const c1 = at(p, t, p.carrier!);
        const hl = Math.hypot(c1.x - c0.x, c1.y - c0.y) || 1;
        const d0 = at(p, t, by);
        if (how === 'size') {
          // Driven back along the carrier's heading.
          const d1 = at(p, t + 0.4, by);
          expect(((d1.x - d0.x) * (c1.x - c0.x) + (d1.y - d0.y) * (c1.y - c0.y)) / hl, x.e.text).toBeGreaterThan(1);
        } else {
          const d1 = at(p, t + 0.5, by);
          expect(Math.hypot(d1.x - d0.x, d1.y - d0.y), x.e.text).toBeGreaterThan(1.2);
        }
        seen[how]++;
      }
    }
    expect(seen.size).toBeGreaterThan(30);
    expect(seen.move).toBeGreaterThan(30);
  });

  it('stages a run with no open (an old game) without a move', () => {
    for (const x of runs.slice(0, 100)) {
      const { open: _, ...old } = x.e;
      expect(stage(x, old).move).toBeUndefined();
      expect(stagedPath(old, x.g.homeId, x.snapY).some((s) => s.move)).toBe(false);
    }
  });

  it('stages a broken tackle that ends in a fumble: the move first, then the ball out', () => {
    let n = 0;
    for (const x of runs) {
      if (!fumbleIn(x.e)) continue;
      const base = stage(x);
      const p = stage(x, opened(x, { broke: { by: someone(x, base), how: 'move' } }));
      if (!p.loose) continue;
      expect(p.move, x.e.text).toBeDefined();
      expect(p.move!.t + p.move!.dur).toBeLessThanOrEqual(p.loose.t + 1e-6);
      n++;
    }
    expect(n).toBeGreaterThan(3);
  });

  it('keeps a jet sweep at speed through the handoff', () => {
    let n = 0;
    for (const x of runs) {
      const p = stage(x);
      if (role(p, p.carrier) !== 'WR') continue;
      for (let st = 2; st <= Math.round((p.release + 0.3) / p.dt); st++) {
        const a = at(p, (st - 1) * p.dt, p.carrier!);
        const b = at(p, st * p.dt, p.carrier!);
        expect(Math.hypot(b.x - a.x, b.y - a.y) / p.dt, `${x.e.text} at ${(st * p.dt).toFixed(2)}`).toBeGreaterThan(
          4.8,
        );
      }
      n++;
    }
    expect(n).toBeGreaterThan(3);
  });

  it('shows each back and tackler habit', () => {
    const mean = (xs: number[]) => xs.reduce((t, v) => t + v, 0) / Math.max(1, xs.length);
    const late: number[] = [];
    const dwell: number[] = [];
    const cut: number[] = [];
    const wide: number[] = [];
    const lunge: { base: number[]; thumper: number[]; averse: number[] } = { base: [], thumper: [], averse: [] };
    const averseSlide: number[] = [];
    /** How far off the straight line from the hole to where he ends he gets in the second after the hole. */
    const offLine = (p: StagedPlay, x: Run) => {
      const t0 = crossAt(p, x);
      const end = at(p, (p.steps - 1) * p.dt, p.carrier!);
      const h = at(p, t0, p.carrier!);
      const l = Math.hypot(end.x - h.x, end.y - h.y) || 1;
      let most = 0;
      for (let t = t0; t < Math.min(t0 + 1, (p.steps - 1) * p.dt); t += p.dt) {
        const q = at(p, t, p.carrier!);
        most = Math.max(most, Math.abs((q.x - h.x) * (end.y - h.y) - (q.y - h.y) * (end.x - h.x)) / l);
      }
      return most;
    };
    /** The first time the tackler is within 1.2 yards of the carrier, before the whistle. */
    const contact = (p: StagedPlay, tackler: number) => {
      for (let t = 0; t < p.steps * p.dt; t += p.dt) {
        const a = at(p, t, tackler);
        const b = at(p, t, p.carrier!);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1.2) return (p.steps - 1) * p.dt - t;
      }
      return 0;
    };
    for (const x of runs.slice(0, 160)) {
      const base = stage(x, without(x));
      if (!handed(base) || role(base, base.carrier) !== 'RB' || crossAt(base, x) < 0 || x.e.open?.broke) continue;
      const back = base.carrier!;
      const tackler = actorsIn(x.e).tackle;
      const gain = (x.e.to! - x.e.from!) * base.dir;
      late.push(crossAt(stage(x, withHabit(x, back, 'patientPresser')), x) - crossAt(base, x));
      if (gain > 5) {
        const d = stage(x, withHabit(x, back, 'dwellsInHole'));
        dwell.push(crossAt(d, x, 3) - crossAt(d, x) - (crossAt(base, x, 3) - crossAt(base, x)));
        cut.push(offLine(stage(x, withHabit(x, back, 'jumpCutter')), x) - offLine(base, x));
      }
      const bounce = opened(x, { bounce: 1, habits: [] });
      const b0 = stage(x, bounce);
      const b1 = stage(x, opened(x, { bounce: 1, habits: [[back, 'bouncesExternal']] }));
      const across = (p: StagedPlay) => {
        let most = 0;
        const t0 = crossAt(p, x);
        if (t0 < 0) return 0;
        for (let t = t0 - 0.5; t < t0 + 0.5; t += p.dt) most = Math.max(most, Math.abs(at(p, t, back).y - x.snapY));
        return most;
      };
      if (crossAt(b0, x) > 0) wide.push(across(b1) - across(b0));
      if (tackler !== undefined && gain > 2 && !/TOUCHDOWN/.test(x.e.text) && !fumbleIn(x.e)) {
        lunge.base.push(contact(stage(x, opened(x, { forward: 1, habits: [] })), tackler));
        lunge.thumper.push(contact(stage(x, opened(x, { forward: 1, habits: [[tackler, 'thumper']] })), tackler));
        const a = stage(x, opened(x, { forward: 1, habits: [[back, 'contactAverse']] }));
        lunge.averse.push(contact(a, tackler));
        const e0 = at(a, (a.steps - 1) * a.dt - 0.45, back);
        const e1 = at(a, (a.steps - 1) * a.dt, back);
        averseSlide.push(Math.hypot(e1.x - e0.x, e1.y - e0.y));
      }
    }
    expect(late.length).toBeGreaterThan(40);
    // A patient back crosses the line later.
    expect(mean(late)).toBeGreaterThan(0.2);
    expect(mean(late)).toBeLessThan(0.4);
    // One who dwells in the hole takes longer from the line to three yards past it.
    expect(dwell.length).toBeGreaterThan(15);
    expect(mean(dwell)).toBeGreaterThan(0.2);
    // A jump-cutter's cut at the hole takes him well off the straight line.
    expect(mean(cut)).toBeGreaterThan(0.8);
    // A bounce goes wider for a back who bounces outside.
    expect(wide.length).toBeGreaterThan(40);
    expect(mean(wide)).toBeGreaterThan(1.2);
    // Falling forward: the hit comes before the end (a lunge); a thumper stops him where he hits him; a back who
    // shies from contact is hit a yard short and slides into it.
    expect(lunge.base.length).toBeGreaterThan(30);
    // (Measured against the same play with a thumper: how long before the whistle contact comes includes each
    // tackler's own run-in.)
    expect(mean(lunge.base) - mean(lunge.thumper)).toBeGreaterThan(0.15);
    expect(mean(lunge.averse) - mean(lunge.thumper)).toBeGreaterThan(0.35);
    expect(mean(averseSlide)).toBeLessThan(1.1);
  });

  it('keeps the safety a step behind on a breakaway', () => {
    let n = 0;
    for (const x of runs) {
      const gain = Math.abs(x.e.to! - x.e.from!);
      if (gain < 20) continue;
      const p = stage(x, opened(x, { gone: 1 }));
      if (p.carrier === null || !handed(p)) continue;
      const who = actorsIn(x.e);
      // The deepest safety at the snap.
      const s = p.ids
        .filter((_, k) => !p.offense[k] && p.roles[k] === 'S')
        .sort((a, b) => (at(p, 0, b).x - at(p, 0, a).x) * p.dir)[0];
      if (s === undefined || s === who.tackle || s === x.e.open?.broke?.by) continue;
      for (let t = 0; t < (p.steps - 1) * p.dt - 0.3; t += p.dt) {
        const a = at(p, t, s);
        const b = at(p, t, p.carrier);
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${x.e.text} at ${t.toFixed(2)}`).toBeGreaterThan(1);
      }
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });

  /** Completed passes with room after the catch. */
  const catches = games
    .slice(0, 20)
    .flatMap(({ g, r }) =>
      r.plays!.flatMap((e, index) =>
        e.kind === 'pass' && e.down > 0 && e.air !== undefined && e.to !== undefined && !fumbleIn(e)
          ? [{ g, r, e, index, snapY: snapYFor(e, 20 + (index % 14)) }]
          : [],
      ),
    );
  /** Yards after the catch. */
  const yac = (x: (typeof catches)[number]) => (x.e.to! - x.e.air!) * (x.e.offense === x.g.homeId ? 1 : -1);
  const stageCatch = (x: (typeof catches)[number], e: PlayLogEntry = x.e) =>
    stagePlay({
      plays: Object.assign(x.r.plays!.slice(), { [x.index]: e }),
      index: x.index,
      record: x.r.field!,
      homeId: x.g.homeId,
      seed: `${x.g.id}:${x.index}`,
      snapY: x.snapY,
    });
  /** How long after the catch he's going upfield at 2 yd/s or more (seconds), or Infinity. */
  const upfieldAfter = (p: StagedPlay) => {
    const c = p.ids.indexOf(p.carrier!);
    const t0 = p.arrive!;
    for (let t = t0 + p.dt; t < (p.steps - 1) * p.dt; t += p.dt) {
      const a = at(p, t - p.dt, p.carrier!);
      const b = at(p, t, p.carrier!);
      if (((b.x - a.x) * p.dir) / p.dt >= 2) return t - t0;
    }
    return c < 0 ? Infinity : Infinity;
  };

  it('turns a catch upfield and stages its broken tackle as a move', () => {
    let n = 0;
    let moves = 0;
    for (const x of catches) {
      if (yac(x) < 4) continue;
      const p = stageCatch(x, { ...x.e, open: { habits: [] } });
      if (p.carrier === null || p.arrive === null) continue;
      expect(upfieldAfter(p), x.e.text).toBeLessThanOrEqual(0.4 + 1e-6);
      n++;
      const by = p.ids.find((id, k) => !p.offense[k] && id !== actorsIn(x.e).tackle && p.roles[k] === 'S');
      if (by === undefined) continue;
      const b = stageCatch(x, { ...x.e, open: { broke: { by, how: 'move' }, habits: [] } });
      expect(b.move, x.e.text).toBeDefined();
      const d = at(b, b.move!.t, by);
      const c = at(b, b.move!.t, b.carrier!);
      if (Math.hypot(d.x - c.x, d.y - c.y) < 1.5) moves++;
    }
    expect(n).toBeGreaterThan(40);
    // (A safety a long way off can't always get there: the move comes where he can, on most catches.)
    expect(moves / n).toBeGreaterThan(0.6);
  });

  it("shows the receiver's habits: a slasher turns at once, an east-west runner goes sideways first", () => {
    let n = 0;
    for (const x of catches) {
      if (yac(x) < 5) continue;
      const base = stageCatch(x, { ...x.e, open: { habits: [] } });
      if (base.carrier === null || base.arrive === null) continue;
      const id = base.carrier;
      const slash = stageCatch(x, { ...x.e, open: { habits: [[id, 'yacSlasher']] } });
      expect(upfieldAfter(slash), x.e.text).toBeLessThanOrEqual(0.2 + 1e-6);
      const ew = stageCatch(x, { ...x.e, open: { habits: [[id, 'runsEastWest']] } });
      const a = at(ew, ew.arrive!, id);
      const b = at(ew, ew.arrive! + 0.6, id);
      expect(Math.abs(b.y - a.y), x.e.text).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(Math.abs((b.x - a.x) * ew.dir), x.e.text).toBeLessThan(1);
      n++;
    }
    expect(n).toBeGreaterThan(30);
  });
});
