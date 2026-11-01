import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import type { PlayLogEntry } from '../../engine/types';
import { snapYFor } from './ballPath';
import { preMoveAt, presnapPlan, type Presnap } from './presnap';
import { stagePlay, type StagedPlay } from './stage';

const league = createLeague({ seed: 'presnap' });
const snaps: { e: PlayLogEntry; s: StagedPlay; plan: Presnap; offense?: string }[] = [];
for (let i = 0; i < 24; i++) {
  const g = league.games[i];
  const r = simulateGame(league, g, { keepPlays: true, seed: `ps-${i}` });
  r.plays!.forEach((e, idx) => {
    if (!['run', 'pass', 'incomplete', 'sack', 'scramble', 'int'].includes(e.kind ?? '')) return;
    const s = stagePlay({
      plays: r.plays!,
      index: idx,
      record: r.field!,
      homeId: g.homeId,
      seed: `${g.id}:${idx}`,
      snapY: snapYFor(e, 26),
    });
    const plan = presnapPlan({ staged: s, e, hurry: false, seed: `${g.id}:${idx}` });
    snaps.push({ e, s, plan, offense: s.schemes.offense.offense });
  });
}
const share = (f: (x: (typeof snaps)[number]) => boolean, of = snaps) => of.filter(f).length / of.length;
const moved = (x: (typeof snaps)[number]) => x.plan.shows.some((w) => ['jet', 'orbit', 'shift', 'cross'].includes(w));

describe('the moments before the snap', () => {
  it('moves before the snap about as often as the NFL does, the motion offenses most', () => {
    const all = share(moved);
    expect(all).toBeGreaterThan(0.4);
    expect(all).toBeLessThan(0.75);
    const heavy = snaps.filter((x) => x.offense === 'wideZone' || x.offense === 'westCoast');
    const light = snaps.filter((x) => x.offense === 'airRaid' || x.offense === 'vertical');
    if (heavy.length > 50 && light.length > 50) expect(share(moved, heavy)).toBeGreaterThan(share(moved, light) + 0.1);
  });

  it('a receiver carrying the ball on a run comes in jet motion', () => {
    let n = 0;
    for (const { s, plan } of snaps) {
      const c = s.carrier === null ? -1 : s.ids.indexOf(s.carrier);
      if (s.kind !== 'run' || c < 0 || s.roles[c] !== 'WR') continue;
      expect(plan.moves.some((m) => m.id === s.carrier)).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  it('the defense answers by its coverage: man travels with the motion, zone bumps; about a third of shells disguised', () => {
    const shows = (w: string) => snaps.filter((x) => x.plan.shows.includes(w)).length;
    expect(shows('man travels') + shows('zone bumps')).toBeGreaterThan(snaps.length * 0.3);
    for (const { s, plan } of snaps) {
      if (!plan.shows.includes('man travels')) continue;
      expect(s.schemes.defense.coverage === 'cover1' || s.call === 'blitz').toBe(true);
    }
    const disguised = (shows('rotates to one high') + shows('rotates to two high')) / snaps.length;
    expect(disguised).toBeGreaterThan(0.15);
    expect(disguised).toBeLessThan(0.45);
    expect(shows('creeper')).toBeGreaterThan(0);
    expect(shows('shows blitz')).toBeGreaterThan(0);
    // A blitz shown and not sent is only ever on a snap the defense didn't blitz; a creeper only on one it did.
    for (const { s, plan } of snaps) {
      if (plan.shows.includes('shows blitz')) expect(s.call).not.toBe('blitz');
      if (plan.shows.includes('creeper')) expect(s.call).toBe('blitz');
    }
  });

  it('ends every move where the play begins, with nobody set on top of anyone, and never faster than a man runs', () => {
    for (const { s, plan } of snaps) {
      const n = s.ids.length;
      for (const m of plan.moves) {
        const k = s.ids.indexOf(m.id);
        const end = preMoveAt(m, 0, s.dir);
        expect(Math.hypot(end.x - s.pos[k * 2], end.y - s.pos[k * 2 + 1])).toBeLessThan(0.01);
        // Clear of where everyone else stands meanwhile: his own set spot if he moves too, else his spot at the snap.
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const other = plan.moves.find((x) => x.id === s.ids[j])?.set ?? { x: s.pos[j * 2], y: s.pos[j * 2 + 1] };
          expect(Math.hypot(m.set.x - other.x, m.set.y - other.y)).toBeGreaterThan(1);
        }
        let prev = preMoveAt(m, plan.line, s.dir);
        for (let b = plan.line - 0.05; b >= 0; b -= 0.05) {
          const p = preMoveAt(m, b, s.dir);
          expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.62);
          prev = p;
        }
      }
      expect(plan.line).toBeLessThanOrEqual(4.2);
      // The quarterback barks for every ball, once to send any motion, twice more on a hard count; all at the line.
      expect(plan.barks).toContain(0.12);
      for (const b of plan.barks) expect(b).toBeLessThanOrEqual(plan.line);
      const motion = plan.shows.some((w) => ['jet', 'orbit', 'shift', 'cross'].includes(w));
      const hard = plan.shows.includes('hard count');
      // A motion sent before the line's moment begins (a long jet, still coming as the rest set) goes unbarked.
      const sent = plan.barks.length - 1 - (hard ? 2 : 0);
      expect(sent).toBe(
        motion && plan.moves.some((m) => m.legs.some((l) => l.at <= plan.line && plan.barks.includes(l.at))) ? 1 : sent,
      );
      expect(sent).toBeLessThanOrEqual(motion ? 1 : 0);
      expect(sent).toBeGreaterThanOrEqual(0);
    }
  });

  it('the same snap, the same look; a no-huddle snap is quick and rarely moves', () => {
    const { e, s } = snaps[10];
    expect(presnapPlan({ staged: s, e, hurry: false, seed: 'x' })).toEqual(
      presnapPlan({ staged: s, e, hurry: false, seed: 'x' }),
    );
    const quick = snaps.slice(0, 400).map(({ e, s }, i) => presnapPlan({ staged: s, e, hurry: true, seed: `q${i}` }));
    expect(Math.max(...quick.map((p) => p.line))).toBeLessThanOrEqual(2);
    expect(
      quick.filter((p) => p.shows.some((w) => ['jet', 'orbit', 'shift', 'cross'].includes(w))).length / quick.length,
    ).toBeLessThan(0.3);
  });
});
