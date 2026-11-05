import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame, type PocketTap } from '../match/gameSim';
import { activeQuirks } from '../quirks';
import type { GameResult } from '../types';
import { pocketFrom, pocketMomentOf, pocketStage } from './pocketMoment';
import { fieldSkills } from './skills';
import { FIELD_VERSION, STEP } from './tuning';
import { MID } from './geometry';
import { bodyOf } from './body';
import { stagePlay } from './stage';
import { skillsAt } from './snapshot';

const league = createLeague({ seed: 'field-engine' });
const week1 = league.games.filter((g) => g.week === 1).slice(0, 4);
const played: { r: GameResult; taps: PocketTap[]; homeId: number; id: number }[] = [];
// Played before the tests, a game at a time with a yield between (a long synchronous block starves vitest's worker).
beforeAll(async () => {
  for (const g of week1) {
    const taps: PocketTap[] = [];
    const r = simulateGame(league, g, { field: true, pocketTap: (t) => taps.push(t) });
    played.push({ r, taps, homeId: g.homeId, id: g.id });
    await new Promise((done) => setTimeout(done, 0));
  }
}, 300_000);

describe('the engine plays the pocket', () => {
  it('plays every dropback it can, each outcome among them', () => {
    const outcomes = new Set(played.flatMap(({ taps }) => taps.filter((t) => t.result).map((t) => t.today.outcome)));
    for (const o of ['clean', 'sack', 'scramble'] as const) expect(outcomes, o).toContain(o);
    expect(played.flatMap(({ taps }) => taps.filter((t) => t.result)).length).toBeGreaterThan(80);
  });

  it('credits a sack to the rusher who got home, and the blocker he beat', () => {
    let n = 0;
    for (const { r, taps } of played)
      for (const t of taps) {
        if (!t.result || t.today.outcome !== 'sack') continue;
        const e = r.plays![t.moment.index];
        if (e.kind !== 'sack') continue;
        n++;
        const rusher = t.result.rusher!;
        expect(t.start.players.find((p) => p.id === rusher)?.side, `play ${t.moment.index}`).toBe(1);
        expect(r.playerStats[rusher]?.sacks ?? 0, `play ${t.moment.index}`).toBeGreaterThanOrEqual(1);
        if (t.result.beat !== null) expect(r.playerStats[t.result.beat]?.sacksAllowed ?? 0).toBeGreaterThanOrEqual(1);
      }
    expect(n).toBeGreaterThan(0);
  });

  it('reads a logged dropback back into the moment it was played from', () => {
    for (const { r, taps } of played)
      for (const t of taps) {
        if (!t.result) continue;
        const back = pocketMomentOf(r.plays![t.moment.index], r.field!, t.moment.index);
        expect(back, `play ${t.moment.index}`).not.toBeNull();
        const { facts: f1, ...m1 } = back!;
        const { facts: f0, ...m0 } = t.moment;
        expect(m1, `play ${t.moment.index}`).toEqual(m0);
        expect([f1.y, f1.pk, f1.nb]).toEqual([f0.y, f0.pk, f0.nb]);
      }
  });

  it('changes nothing with the switch off or the tap alone', () => {
    const g = league.games.filter((x) => x.week === 1)[5];
    const plain = simulateGame(league, g, { keepPlays: true });
    const tapped = simulateGame(league, g, { keepPlays: true, pocketTap: () => {} });
    expect(tapped.plays).toEqual(plain.plays);
    expect(tapped.playerStats).toEqual(plain.playerStats);
  });

  it("ends a scramble at today's yards, with no tackle on a slide, the man who forced him credited out of bounds", () => {
    let n = 0;
    for (const { r, taps } of played)
      for (const t of taps) {
        if (!t.result || (t.today.outcome !== 'scramble' && t.today.outcome !== 'escape')) continue;
        const e = r.plays![t.moment.index];
        if (e.kind !== 'scramble') continue;
        n++;
        if (/slides/.test(e.text))
          expect(e.text.split('. ')[0], `play ${t.moment.index}`).not.toMatch(/\([A-Z]\.[^)]*\)/);
        // The scorer credits whoever forced a scrambler out (NFL: every one).
        if (/out of bounds/.test(e.text))
          expect(e.text.split('. ')[0], `play ${t.moment.index}`).toMatch(/\([A-Z]\.[^)]*\)/);
      }
    expect(n).toBeGreaterThan(0);
  });

  it('takes a sack at his own 2 down on the goal line, never in front of it', () => {
    const { r, taps, homeId, id } = played[0];
    const t = taps.find((x) => x.result && x.moment.kind === 'pass')!;
    const g = league.games.find((x) => x.id === id)!;
    const seed = `${league.seed}:${g.season}:${g.id}`;
    const dir = t.start.dir;
    const goal = dir === 1 ? 0 : 100;
    const m = {
      ...t.moment,
      kind: 'sack' as const,
      yardLine: 2,
      from: goal + dir * 2,
      to: goal,
      air: undefined,
      ball: undefined,
      cover: undefined,
      facts: { ...t.moment.facts, pk: 'sack' as const },
    };
    delete m.air;
    delete m.ball;
    delete m.cover;
    const staged = pocketStage(m, r.field!, homeId, seed)!;
    const pocket = pocketFrom(m, staged, (pid) => fieldSkills(league.players[pid], activeQuirks), seed)!;
    const n = pocket.start.players.length;
    const steps = pocket.result.frames.length / (n * 2);
    const qk = pocket.start.players.findIndex((p) => p.id === pocket.start.qb);
    const qx = pocket.result.frames[((steps - 1) * n + qk) * 2];
    expect(Math.abs(qx - goal)).toBeLessThanOrEqual(1);
    expect((qx - goal) * dir).toBeLessThanOrEqual(0.5);
    void STEP;
  });
});

describe('the replay plays the pocket', () => {
  const stage = (r: GameResult, index: number, homeId: number) =>
    stagePlay({ plays: r.plays!, index, record: r.field!, homeId, seed: 'x', snapY: MID });

  it('replays a pocket exactly as it was played', () => {
    let n = 0;
    for (const { r, taps, homeId } of played)
      for (const t of taps) {
        // A lost fumble after a catch is drawn, never replayed (`replay.ts`).
        if (!t.result || (r.plays![t.moment.index].loose !== undefined && t.today.outcome !== 'sack')) continue;
        const s = stage(r, t.moment.index, homeId);
        expect(s.spatial, `play ${t.moment.index}`).toBeDefined();
        const men = s.ids.length;
        const pn = t.start.players.length;
        // The pocket's own frames, up to its hand-over (a catch's or a scramble's open field takes it from there).
        const handOver = s.spatial!.k0 > 0 ? s.spatial!.k0 + 1 : Infinity;
        const steps = Math.min(s.steps, t.result.frames.length / (pn * 2), handOver);
        t.start.players.forEach((p, j) => {
          const k = s.ids.indexOf(p.id);
          for (let st = 0; st < steps; st += 5) {
            expect(s.pos[(st * men + k) * 2], `play ${t.moment.index} man ${p.id} step ${st}`).toBe(
              t.result!.frames[(st * pn + j) * 2],
            );
          }
        });
        n++;
      }
    expect(n).toBeGreaterThan(80);
  });

  it('replays a catch after a pocket with no jump at the hand-over', () => {
    let n = 0;
    for (const { r, taps, homeId } of played)
      for (const t of taps) {
        const e = r.plays![t.moment.index];
        if (!t.result || e.kind !== 'pass' || e.field?.to === undefined || e.loose !== undefined) continue;
        const s = stage(r, t.moment.index, homeId);
        const k0 = s.spatial!.k0;
        if (k0 < 1) continue;
        n++;
        const men = s.ids.length;
        s.ids.forEach((id, k) => {
          const sk = skillsAt(r.field!.snap!, id, t.moment.index);
          if (!sk) return;
          const top = bodyOf({ id, side: 0, role: s.roles[k], x: 0, y: 0, vx: 0, vy: 0, s: sk }, false).top;
          for (const st of [k0, k0 + 1]) {
            const d = Math.hypot(
              s.pos[(st * men + k) * 2] - s.pos[((st - 1) * men + k) * 2],
              s.pos[(st * men + k) * 2 + 1] - s.pos[((st - 1) * men + k) * 2 + 1],
            );
            expect(d, `play ${t.moment.index} man ${id} step ${st}`).toBeLessThanOrEqual(top * STEP + 0.05);
          }
        });
      }
    expect(n).toBeGreaterThan(10);
  });

  it('stages a pocket played on an older field version as drawn, and the same after a save round trip', () => {
    const { r, taps, homeId } = played[0];
    const t = taps.find((x) => x.result)!;
    const saved: GameResult = JSON.parse(JSON.stringify(r));
    expect(Array.from(stage(saved, t.moment.index, homeId).pos)).toEqual(
      Array.from(stage(r, t.moment.index, homeId).pos),
    );
    saved.field!.snap!.v = FIELD_VERSION - 1;
    expect(stage(saved, t.moment.index, homeId).spatial).toBeUndefined();
    expect(r.field!.snap!.v).toBe(FIELD_VERSION);
  });
});
