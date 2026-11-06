import { describe, expect, it } from 'vitest';
import type { PlayLogEntry } from '../../engine/types';
import { buildPath, pointAt } from '../../engine/field/ballPath';
import { bounce, fumbleIn } from '../../engine/field/fumble';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import { stagePlay } from '../../engine/field/stage';
import type { GameResult } from '../../engine/types';

const play = (over: Partial<PlayLogEntry>): PlayLogEntry => ({
  quarter: 2,
  clock: 400,
  offense: 1,
  down: 1,
  distance: 10,
  yardLine: 30,
  text: 'A. Back rush up the middle for 6 yards (B. Backer)',
  homeScore: 0,
  awayScore: 0,
  kind: 'run',
  from: 30,
  to: 36,
  lane: 0,
  ...over,
});
const lostRun = play({
  text: 'A. Back rush up the middle for 10 yards (B. Backer). FUMBLE, recovered by C. Corner',
  to: 28,
  loose: 40,
});
const length = (segs: ReturnType<typeof bounce>) => segs.reduce((d, s) => d + Math.hypot(s.x1 - s.x0, s.y1 - s.y0), 0);

describe('the loose ball', () => {
  it('reads a fumble off the play: lost (where it came out, or its end before v78), kept, or none', () => {
    expect(fumbleIn(lostRun)).toEqual({ lost: true, x: 40, why: 'hit' });
    expect(fumbleIn({ ...lostRun, loose: undefined })).toEqual({ lost: true, x: 28, why: 'hit' });
    expect(
      fumbleIn(play({ text: 'A. Back rush left for 3 yards (B. Backer). Fumble, recovered by the offense' })),
    ).toEqual({ lost: false, x: 36, why: 'hit' });
    expect(fumbleIn(play({}))).toBeNull();
    // An interception is a turnover, not a fumble.
    expect(fumbleIn(play({ kind: 'int', text: 'Pass intercepted by C. Corner', to: 50 }))).toBeNull();
  });

  it('bounces a few short, low hops and settles where it is recovered', () => {
    for (let clock = 0; clock < 900; clock += 7) {
      const e = { ...lostRun, clock };
      const at = { x: 40, y: 20 };
      const hops = bounce(e, at);
      expect(hops.length).toBeGreaterThanOrEqual(2);
      expect(hops.length).toBeLessThanOrEqual(4);
      expect(length(hops)).toBeGreaterThanOrEqual(2);
      expect(length(hops)).toBeLessThanOrEqual(6.01);
      for (const h of hops) expect(h.peak).toBeLessThanOrEqual(0.6);
      const dur = hops.reduce((t, h) => t + h.dur, 0);
      expect(dur).toBeGreaterThanOrEqual(0.8);
      expect(dur).toBeLessThanOrEqual(1.3);
      // It squirts mostly sideways: where it came out is within a step and a half of where it's recovered, upfield.
      expect(Math.abs(hops[0].x0 - at.x)).toBeLessThanOrEqual(1.5);
      const end = pointAt(hops[hops.length - 1], 1);
      expect(Math.hypot(end.x - at.x, end.y - at.y)).toBeLessThan(1e-6);
      for (let i = 1; i < hops.length; i++) expect([hops[i].x0, hops[i].y0]).toEqual([hops[i - 1].x1, hops[i - 1].y1]);
    }
    expect(bounce(lostRun, { x: 40, y: 20 })).toEqual(bounce(lostRun, { x: 40, y: 20 }));
  });

  it('never bounces out of bounds from a carrier at the sideline', () => {
    for (let clock = 0; clock < 900; clock += 11)
      for (const y of [1, 52.3]) {
        const hops = bounce({ ...lostRun, clock }, { x: 40, y });
        for (const h of hops) {
          expect(h.y0).toBeGreaterThanOrEqual(0.5);
          expect(h.y0).toBeLessThanOrEqual(52.8);
        }
      }
  });

  it("reads a fumble's reason off the play (an old one with none reads as the hit)", () => {
    const said = (reason: string) =>
      fumbleIn(
        play({
          ...lostRun,
          text: `A. Back rush up the middle for 10 yards (B. Backer)${reason}. FUMBLE, recovered by C. Corner`,
        }),
      )?.why;
    expect(said(', stripped by B. Backer')).toBe('strip');
    expect(said(', jarred loose by the hit')).toBe('hit');
    expect(said(', fighting for the extra yard, the ball comes out')).toBe('fight');
    expect(said(', puts it on the ground')).toBe('own');
    expect(said('')).toBe('hit');
  });

  it('draws a lost fumble in both views: the carry, the ball loose where it came out, the return to its end', () => {
    // The away side (offense 1; home is 0) drives toward 0: a 10-yard run from 50 comes loose at 40, and the
    // return runs back up the field to 52.
    const away = { ...lostRun, from: 50, to: 52, loose: 40 };
    const segs = buildPath(away, 0, 26.65);
    const loose = segs.findIndex((s) => s.peak > 0);
    expect(loose).toBeGreaterThan(0);
    // The carry ends where the ball comes out, a step or so from where it's recovered.
    expect(Math.abs(segs[loose - 1].x1 - 40)).toBeLessThanOrEqual(1.5);
    const settled = segs.length - 1 - [...segs].reverse().findIndex((s) => s.peak > 0);
    expect(segs[settled].x1).toBeCloseTo(40, 6);
    // Then the return, to where the engine says it ended.
    expect(segs[segs.length - 1].x1).toBeCloseTo(52, 6);
    expect(segs[segs.length - 1].peak).toBe(0);
  });

  it('draws a fumble the offense kept ending where the play did', () => {
    const kept = play({
      text: 'A. Back rush left for 6 yards (B. Backer). Fumble, recovered by the offense',
      from: 70,
      to: 64,
    });
    const segs = buildPath(kept, 0, 26.65);
    expect(segs.some((s) => s.peak > 0)).toBe(true);
    expect(segs[segs.length - 1].x1).toBeCloseTo(64, 6);
    const plain = buildPath({ ...kept, text: 'A. Back rush left for 6 yards (B. Backer)' }, 0, 26.65);
    expect(segs[segs.length - 1].y1).toBeCloseTo(plain[plain.length - 1].y1, 6);
  });

  it('draws a strip-sack and a catch that came loose the same way', () => {
    const sack = play({
      kind: 'sack',
      text: 'A. Passer sacked by E. Rusher for 7 yards. FUMBLE, recovered by E. Rusher',
      from: 50,
      to: 57,
      loose: 57,
    });
    const s = buildPath(sack, 0, 26.65);
    expect(s.some((x) => x.peak > 0)).toBe(true);
    expect(s[s.length - 1].x1).toBeCloseTo(57, 6);
    const catchLost = play({
      kind: 'pass',
      text: 'A. Passer pass complete to W. Out for 12 yards (C. Corner). FUMBLE, recovered by C. Corner',
      from: 50,
      air: 42,
      to: 41,
      loose: 38,
    });
    const c = buildPath(catchLost, 0, 26.65);
    // The throw is still the throw: the drop, then the flight to the catch.
    expect(c[1].x1).toBe(42);
    expect(c[c.length - 1].x1).toBeCloseTo(41, 6);
  });
});

describe('a fumble on film', () => {
  // A real lost fumble after a carry, staged as each reason would say it.
  const league = createLeague({ seed: 'fumble-film' });
  // The first whose tackler gets to his hit (one who can't reach it in time keeps his chase: nothing to tell apart).
  let found: { r: GameResult; i: number; homeId: number } | null = null;
  for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 30)) {
    const r = simulateGame(league, g, { keepPlays: true });
    for (let i = 0; i < r.plays!.length && !found; i++) {
      const e = r.plays![i];
      if ((e.kind !== 'run' && e.kind !== 'pass') || !/FUMBLE, recovered by/.test(e.text)) continue;
      const who = actorsIn(e);
      if (who.tackle === undefined || who.ball === undefined) continue;
      const p = stagePlay({
        plays: r.plays!,
        index: i,
        record: r.field!,
        homeId: g.homeId,
        seed: 'film',
        snapY: 26.65,
      });
      if (!p.loose) continue;
      const step = Math.round(p.loose.t / p.dt);
      const h = p.ids.indexOf(who.tackle);
      const hx = p.pos[(step * p.ids.length + h) * 2] - p.ball[step * 3];
      const hy = p.pos[(step * p.ids.length + h) * 2 + 1] - p.ball[step * 3 + 1];
      if (Math.hypot(hx, hy) <= 1.2) found = { r, i, homeId: g.homeId };
    }
    if (found) break;
  }
  const REASONS = {
    strip: ', stripped by B.Weber',
    hit: ', jarred loose by the hit',
    fight: ', fighting for the extra yard, the ball comes out',
    own: ', puts it on the ground',
  } as const;
  const staged = (why: keyof typeof REASONS) => {
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    const text = e.text.replace(/(\([A-Z][^)]*\))(, .+?)?(\. FUMBLE, recovered by)/, `$1${REASONS[why]}$3`);
    const plays = r.plays!.map((x, k) => (k === i ? { ...x, text } : x));
    return { p: stagePlay({ plays, index: i, record: r.field!, homeId, seed: 'film', snapY: 26.65 }), e };
  };
  const at = (p: ReturnType<typeof stagePlay>, step: number, k: number) => ({
    x: p.pos[(step * p.ids.length + k) * 2],
    y: p.pos[(step * p.ids.length + k) * 2 + 1],
  });

  it('shows each reason: stripped from behind, the hit head-on, a second man on a fighter, nobody on his own', () => {
    expect(found).not.toBeNull();
    const look = (why: keyof typeof REASONS) => {
      const { p, e } = staged(why);
      const step = Math.round(p.loose!.t / p.dt);
      const c = p.ids.indexOf(actorsIn(e).ball!);
      const h = p.ids.indexOf(actorsIn(e).tackle!);
      const ball = { x: p.ball[step * 3], y: p.ball[step * 3 + 1] };
      const was = at(p, Math.max(0, step - 6), c);
      const now = at(p, step, c);
      const run = { x: now.x - was.x, y: now.y - was.y };
      const hit = at(p, step, h);
      const ahead = (hit.x - now.x) * run.x + (hit.y - now.y) * run.y;
      const near = (k: number) => Math.hypot(at(p, step, k).x - ball.x, at(p, step, k).y - ball.y);
      const others = p.ids.filter((_, k) => !p.offense[k] && k !== h && near(k) <= 2.5).length;
      return { ahead, dist: near(h), others };
    };
    const strip = look('strip');
    expect(strip.dist).toBeLessThanOrEqual(1.2);
    expect(strip.ahead).toBeLessThanOrEqual(0);
    const hit = look('hit');
    expect(hit.dist).toBeLessThanOrEqual(1.2);
    expect(hit.ahead).toBeGreaterThan(0);
    expect(look('fight').others).toBeGreaterThanOrEqual(1);
    expect(look('own').dist).toBeGreaterThan(1);
  });
});

describe('a sack fumble the quarterback lost himself, on film', () => {
  const league = createLeague({ seed: 'fumble-film' });
  let found: { r: GameResult; i: number; homeId: number } | null = null;
  for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 60)) {
    const r = simulateGame(league, g, { keepPlays: true });
    const i = r.plays!.findIndex((e) => e.kind === 'sack' && /FUMBLE, recovered by/.test(e.text));
    if (i >= 0) {
      found = { r, i, homeId: g.homeId };
      break;
    }
  }

  it('reads it as his own, an old strip-sack as the hit, and ends with the recoverer on the ball', () => {
    expect(found).not.toBeNull();
    const { r, i, homeId } = found!;
    const e = r.plays![i];
    const own = e.text.replace(/(SACKED by .+? for -?\d+ yards?)(, [^.]+)?(\. FUMBLE)/, '$1, puts it on the ground$3');
    const old = e.text.replace(/(SACKED by .+? for -?\d+ yards?)(, [^.]+)?(\. FUMBLE)/, '$1$3');
    expect(fumbleIn({ ...e, text: own })!.why).toBe('own');
    expect(fumbleIn({ ...e, text: old })!.why).toBe('hit');
    for (const text of [own, old]) {
      const plays = r.plays!.map((x, k) => (k === i ? { ...x, text } : x));
      const p = stagePlay({ plays, index: i, record: r.field!, homeId, seed: 'film', snapY: 26.65 });
      expect(p.loose).toBeDefined();
      const last = p.steps - 1;
      const by = p.ids.indexOf(actorsIn(e).take ?? -1);
      expect(by, 'the recoverer is on the field').toBeGreaterThanOrEqual(0);
      const ball = { x: p.ball[last * 3], y: p.ball[last * 3 + 1] };
      const man = { x: p.pos[(last * 22 + by) * 2], y: p.pos[(last * 22 + by) * 2 + 1] };
      expect(Math.hypot(man.x - ball.x, man.y - ball.y), text).toBeLessThan(1.5);
    }
  });
});
