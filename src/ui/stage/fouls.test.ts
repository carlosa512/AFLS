import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W, snapYFor } from './ballPath';
import { foulersOn, foulsIn, type FoulPhase } from './calls';
import { stageFouls, type FouledPlay } from './fouls';
import { stagePlay, type StagedPlay } from './stage';

const league = createLeague({ seed: 'fouls' });
const team = (id: number) => league.teams.find((t) => t.id === id)!;
const flagged: { e: PlayLogEntry; p: FouledPlay; phases: FoulPhase[]; base: ReturnType<typeof stagePlay> }[] = [];
for (let i = 0; i < 60; i++) {
  const g = league.games[i];
  const r = simulateGame(league, g, { keepPlays: true, seed: `fl-${i}` });
  r.plays!.forEach((e, idx) => {
    if (!/PENALTY|declined|Offsetting/.test(e.text)) return;
    const base = stagePlay({
      plays: r.plays!,
      index: idx,
      record: r.field!,
      homeId: g.homeId,
      seed: `${g.id}:${idx}`,
      snapY: snapYFor(e, 26),
    });
    const calls = foulsIn(e);
    const who = foulersOn(league, base.ids, base.home, calls, {
      home: team(g.homeId).abbrev,
      away: team(g.awayId).abbrev,
    });
    flagged.push({ e, p: stageFouls(base, who), phases: calls.map((c) => c.phase), base });
  });
}
const at = (p: StagedPlay, st: number, k: number) => ({
  x: p.pos[(st * p.ids.length + k) * 2],
  y: p.pos[(st * p.ids.length + k) * 2 + 1],
});
const stepOf = (p: FouledPlay, t: number) => Math.min(p.steps - 1, Math.round(t / p.dt));
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('the fouls in the log', () => {
  it('names the man and the moment of every foul in 60 games, two when they offset', () => {
    let named = 0;
    let all = 0;
    for (const { e, p } of flagged) {
      expect(p.fouls.length, e.text).toBeGreaterThan(0);
      if (/Offsetting/.test(e.text)) expect(p.fouls.length, e.text).toBe(2);
      for (const f of p.fouls) {
        all++;
        if (f.id !== null) named++;
      }
    }
    expect(all).toBeGreaterThan(300);
    // Found on the field nearly every time (a man the field record can't place is the rare exception).
    expect(named / all).toBeGreaterThan(0.95);
    expect(foulsIn({ text: 'J.Largo rush right end for 9 yards (N.Gaoa).' } as PlayLogEntry)).toEqual([]);
  });
});

describe('a foul, acted out', () => {
  it('a false start: one man moves early, everyone else holds, and the ball stays put', () => {
    let n = 0;
    for (const { e, p, phases } of flagged) {
      if (p.kind !== 'penalty' || phases[0] !== 'early' || p.fouls[0].id === null) continue;
      const k = p.ids.indexOf(p.fouls[0].id);
      let moved = 0;
      for (let st = 0; st < p.steps; st++) moved = Math.max(moved, near(at(p, st, k), at(p, 0, k)));
      expect(moved, e.text).toBeGreaterThan(0.7);
      for (let j = 0; j < p.ids.length; j++)
        if (j !== k) expect(near(at(p, p.steps - 1, j), at(p, 0, j)), e.text).toBeLessThan(0.01);
      expect(
        near({ x: p.ball[0], y: p.ball[1] }, { x: p.ball[(p.steps - 1) * 3], y: p.ball[(p.steps - 1) * 3 + 1] }),
      ).toBe(0);
      // The flag's out as he moves, and on him; he's ringed.
      expect(p.fouls[0].at).toBeLessThan(0.6);
      expect(near(p.fouls[0].spot, at(p, stepOf(p, p.fouls[0].at), k))).toBeLessThan(1.5);
      expect(p.keys).toContain(p.fouls[0].id);
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });

  it('offside: he is across the line at the snap, and the flag is out at once', () => {
    let n = 0;
    for (const { e, p, base, phases } of flagged) {
      const i = phases.indexOf('snap');
      if (i < 0 || p.fouls[i].id === null || p.kind === 'kickoff') continue;
      const k = p.ids.indexOf(p.fouls[i].id!);
      // Closer to the offense's side than he lined up (the line is the ball's spot at the snap).
      expect((at(p, 0, k).x - base.ball[0]) * p.dir, e.text).toBeLessThan((at(base, 0, k).x - base.ball[0]) * p.dir);
      expect(p.fouls[i].at).toBeLessThan(0.3);
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  it('a hit on the passer or the kicker, or at the whistle: the man who did it is on him when the flag flies', () => {
    let n = 0;
    for (const { e, p, phases } of flagged)
      phases.forEach((phase, i) => {
        const f = p.fouls[i];
        if (f.id === null || !['afterThrow', 'afterKick', 'whistle'].includes(phase)) return;
        const k = p.ids.indexOf(f.id);
        const st = stepOf(p, f.at);
        const role = phase === 'afterThrow' ? 'QB' : phase === 'afterKick' ? (p.kind === 'punt' ? 'P' : 'K') : null;
        const j = role
          ? p.roles.findIndex((r, x) => r === role && p.offense[x])
          : p.carrier === null
            ? -1
            : p.ids.indexOf(p.carrier);
        if (j < 0) return;
        expect(near(at(p, st, k), at(p, st, j)), `${phase}: ${e.text}`).toBeLessThan(1.8);
        n++;
      });
    expect(n).toBeGreaterThan(30);
  });

  it('every flag lands by the man it is on, and acting a foul out never makes a man jump a frame', () => {
    for (const { e, p, base, phases } of flagged)
      for (const [i, f] of p.fouls.entries()) {
        // A kick out of bounds is flagged where it went out, not on the kicker.
        if (f.id === null || phases[i] === 'out') continue;
        const k = p.ids.indexOf(f.id);
        expect(near(f.spot, at(p, stepOf(p, f.at), k)), e.text).toBeLessThan(1.5);
        let was = 0;
        for (let st = 1; st < base.steps; st++) was = Math.max(was, near(at(base, st, k), at(base, st - 1, k)));
        // No quicker than a man runs flat out (11 yards a second, `steer`'s step cap), or than the play already had him.
        for (let st = 1; st < p.steps; st++)
          expect(near(at(p, st, k), at(p, st - 1, k)), e.text).toBeLessThanOrEqual(Math.max(0.551, was + 0.01));
      }
  });
  it('leaves no flag hanging: every foul is acted out by its man when the flag flies', () => {
    const hanging: string[] = [];
    const acted: Record<string, number> = {};
    for (const { e, p, phases, base } of flagged)
      phases.forEach((phase, i) => {
        const f = p.fouls[i];
        if (phase === 'out') {
          // The kick out of bounds: the flag goes down where it went out.
          if (f.spot.y > 0 && f.spot.y < FIELD_W) hanging.push(`out: ${e.text}`);
          else acted[phase] = (acted[phase] ?? 0) + 1;
          return;
        }
        if (f.id === null) return;
        const k = p.ids.indexOf(f.id);
        const st = stepOf(p, f.at);
        const me = at(p, st, k);
        const onSomeone = p.ids.some((_, j) => p.offense[j] !== p.offense[k] && near(at(p, st, j), me) < 1.9);
        const ok =
          phase === 'early'
            ? p.kind !== 'penalty' || p.ids.some((_, j) => j === k && near(at(p, 12, k), at(p, 0, k)) > 0.5)
            : phase === 'snap'
              ? near(at(p, 0, k), at(base, 0, k)) > 0.5
              : onSomeone;
        if (ok) acted[phase] = (acted[phase] ?? 0) + 1;
        else hanging.push(`${phase}: ${e.text}`);
      });
    expect(hanging, hanging.slice(0, 5).join('\n')).toEqual([]);
    for (const phase of ['early', 'snap', 'during', 'ball', 'afterThrow', 'whistle'] as const)
      expect(acted[phase], phase).toBeGreaterThan(5);
  });
});
