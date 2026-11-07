import { describe, expect, it } from 'vitest';
import { FIELD_W, snapYFor } from '../../engine/field/ballPath';
import { bodyOf } from '../../engine/field/body';
import { skillsAt } from '../../engine/field/snapshot';
import { STEP } from '../../engine/field/tuning';
import { asRan, stagePlay } from '../../engine/field/stage';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { outOfBoundsIn } from '../../engine/match/sideline';
import type { GameResult, PlayLogEntry } from '../../engine/types';

/** Your games with the field on: every play kept, with what the engine decided (`e.field`). */
const league = createLeague({ seed: 'endings-film' });
const games: { r: GameResult; homeId: number }[] = league.games
  .filter((g) => !g.playoffRound)
  .slice(0, 16)
  .map((g) => ({
    r: simulateGame(league, g, { keepPlays: true, field: true, seed: `end-${g.id}` }),
    homeId: g.homeId,
  }));
const stage = (r: GameResult, homeId: number, i: number, plays: PlayLogEntry[] = r.plays!) =>
  stagePlay({ plays, index: i, record: r.field!, homeId, seed: `${i}`, snapY: snapYFor(asRan(plays[i]), 26) });
type Staged = ReturnType<typeof stage>;
const at = (p: Staged, st: number, k: number) => ({
  x: p.pos[(st * p.ids.length + k) * 2],
  y: p.pos[(st * p.ids.length + k) * 2 + 1],
});
/** The nearest defender to the carrier at step `st`. */
const nearest = (p: Staged, st: number, c: number) =>
  Math.min(
    ...p.ids.map((_, k) =>
      p.offense[k] === p.offense[c]
        ? Infinity
        : Math.hypot(at(p, st, k).x - at(p, st, c).x, at(p, st, k).y - at(p, st, c).y),
    ),
  );
const each = (want: (e: PlayLogEntry) => boolean) =>
  games.flatMap(({ r, homeId }) =>
    r.plays!.flatMap((raw, i) => (want(asRan(raw)) && raw.down > 0 ? [{ r, homeId, i, e: asRan(raw) }] : [])),
  );

describe('why he went out, on film', () => {
  const crossNear = (ow: 1 | 2) => {
    const cases = each(
      (e) => (e.kind === 'run' || e.kind === 'pass') && outOfBoundsIn(e.text) === 'stepped' && e.field?.ow === ow,
    );
    let near = 0;
    let n = 0;
    for (const { r, homeId, i } of cases) {
      const p = stage(r, homeId, i);
      if (!p.spatial || p.carrier === null) continue;
      const c = p.ids.indexOf(p.carrier);
      let cross = p.steps - 1;
      for (let st = 0; st < p.steps; st++)
        if (at(p, st, c).y <= 0 || at(p, st, c).y >= FIELD_W) {
          cross = st;
          break;
        }
      n++;
      // Closing: a stride and a reach from him as he crosses.
      if (nearest(p, cross, c) <= 3.5) near++;
    }
    return { near, n };
  };

  it('gets out before the hit with a man closing', () => {
    const hit = crossNear(2);
    expect(hit.n).toBeGreaterThan(5);
    expect(hit.near / hit.n).toBeGreaterThanOrEqual(0.9);
  });

  it('stages an old save’s step-out (no reason kept) as it did', () => {
    const [one] = each((e) => (e.kind === 'run' || e.kind === 'pass') && outOfBoundsIn(e.text) === 'stepped');
    const plays = one.r.plays!.map((x, k): PlayLogEntry => {
      if (k !== one.i) return x;
      const field = x.field ? { ...x.field } : undefined;
      if (field) delete field.ow;
      return {
        ...x,
        text: x.text.replace(/, (steps|gets) out of bounds.*$/, ', steps out of bounds'),
        ...(field ? { field } : {}),
      };
    });
    expect(() => stage(one.r, one.homeId, one.i, plays)).not.toThrow();
  });
});

describe('the slide, on film', () => {
  it('brings the man who touched him down to him, and leaves an untouched slider alone', () => {
    const touched = each((e) => e.kind === 'scramble' && !!e.field?.tc);
    const untouched = each((e) => e.kind === 'scramble' && !!e.field?.sl && !e.field?.tc);
    let close = 0;
    let n = 0;
    for (const { r, homeId, i } of touched) {
      const p = stage(r, homeId, i);
      if (!p.spatial || p.carrier === null) continue;
      n++;
      if (nearest(p, p.steps - 1, p.ids.indexOf(p.carrier)) <= 2.5) close++;
    }
    expect(n).toBeGreaterThan(3);
    expect(close / n).toBeGreaterThanOrEqual(0.8);
    for (const { e } of untouched) expect(e.text).not.toMatch(/\([A-Z][^)]*\), slides/);
  });
});

describe('an escaped sack, on film', () => {
  it('rolls him out and runs him down on the move', () => {
    const sacks = each((e) => e.kind === 'sack' && !!e.field?.ex);
    let wide = 0;
    let n = 0;
    for (const { r, homeId, i, e } of sacks) {
      const p = stage(r, homeId, i);
      if (!p.spatial) continue;
      const qb = p.ids.findIndex((_, k) => p.offense[k] && p.roles[k] === 'QB');
      n++;
      if (Math.abs(at(p, p.steps - 1, qb).y - snapYFor(e, 26)) > 4) wide++;
    }
    expect(n).toBeGreaterThan(2);
    expect(wide / n).toBeGreaterThanOrEqual(0.8);
  });

  it('never has him faster than his legs with the ball, a sack for no loss included', () => {
    const sacks = each((e) => e.kind === 'sack' && !!e.field?.ex);
    let n = 0;
    for (const { r, homeId, i } of sacks) {
      const p = stage(r, homeId, i);
      if (!p.spatial) continue;
      const qb = p.ids.findIndex((_, k) => p.offense[k] && p.roles[k] === 'QB');
      const s = skillsAt(r.field!.snap!, p.ids[qb], i);
      if (!s) continue;
      const top = bodyOf({ id: p.ids[qb], side: 0, role: 'QB', x: 0, y: 0, vx: 0, vy: 0, s }, false, true).top;
      n++;
      for (let st = 1; st < p.steps; st++) {
        const a = at(p, st - 1, qb);
        const b = at(p, st, qb);
        expect(Math.hypot(b.x - a.x, b.y - a.y) / STEP).toBeLessThanOrEqual(top + 0.05);
      }
    }
    expect(n).toBeGreaterThan(2);
  });
});
