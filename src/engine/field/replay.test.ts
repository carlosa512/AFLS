import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { startLiveGame } from '../league';
import { simulateGame, type FieldTap } from '../match/gameSim';
import type { GameResult, PlayLogEntry } from '../types';
import { bodyOf } from './body';
import { MID } from './geometry';
import { stageField } from './replay';
import { stagePlay } from './stage';
import { STEP } from './tuning';

const league = createLeague({ seed: 'field-replay' });
const week1 = league.games.filter((g) => g.week === 1);
const played = [0, 1, 2].map((i) => {
  const taps: FieldTap[] = [];
  const r = simulateGame(league, week1[i], { field: true, fieldTap: (t) => taps.push(t) });
  return { r, taps, homeId: week1[i].homeId };
});
const stage = (r: GameResult, index: number, homeId: number) =>
  stagePlay({ plays: r.plays!, index, record: r.field!, homeId, seed: `replay:${index}`, snapY: MID });

describe('the spatial replay', () => {
  it('replays a spatial play exactly as it was played', () => {
    let n = 0;
    for (const { r, taps, homeId } of played)
      for (const t of taps) {
        if (!t.result || r.plays![t.moment.index].loose !== undefined) continue;
        const s = stage(r, t.moment.index, homeId);
        expect(s.spatial, `play ${t.moment.index}`).toBeDefined();
        const k0 = s.spatial!.k0;
        const men = s.ids.length;
        const field = s.pos.slice(k0 * men * 2, k0 * men * 2 + t.result.frames.length);
        expect(Array.from(field)).toEqual(Array.from(t.result.frames));
        n++;
      }
    expect(n).toBeGreaterThan(100);
  });

  it('replays the same after a save round trip, and after the switch is turned off', () => {
    const { r, taps, homeId } = played[0];
    const saved: GameResult = JSON.parse(JSON.stringify(r));
    const off = createLeague({ seed: 'field-replay' });
    off.settings = { spatialField: false };
    for (const t of taps.filter((x) => x.result).slice(0, 25)) {
      const a = stage(r, t.moment.index, homeId);
      const b = stage(saved, t.moment.index, homeId);
      expect(Array.from(b.pos)).toEqual(Array.from(a.pos));
    }
  });

  it('joins the approach to the open field without a jump', () => {
    for (const { r, taps, homeId } of played)
      for (const t of taps) {
        if (!t.result) continue;
        const s = stage(r, t.moment.index, homeId);
        if (!s.spatial) continue;
        const k0 = s.spatial.k0;
        const men = s.ids.length;
        t.start.players.forEach((p, k) => {
          const top = bodyOf(p, t.start.tired).top;
          const d = Math.hypot(
            s.pos[((k0 + 1) * men + k) * 2] - s.pos[(k0 * men + k) * 2],
            s.pos[((k0 + 1) * men + k) * 2 + 1] - s.pos[(k0 * men + k) * 2 + 1],
          );
          expect(d, `play ${t.moment.index} man ${p.id}`).toBeLessThanOrEqual(top * STEP + 0.05);
        });
      }
  });

  it('stages a flagged spatial snap from its ran, and a lost fumble drawn', () => {
    let flagged = 0;
    let fumbles = 0;
    for (let i = 0; i < 12 && (flagged === 0 || fumbles === 0); i++) {
      const g = week1[i % week1.length];
      const r = i < 3 ? played[i].r : simulateGame(league, g, { field: true });
      r.plays!.forEach((e: PlayLogEntry, index) => {
        if (e.kind === 'penalty' && e.ran?.field) {
          flagged++;
          expect(stage(r, index, g.homeId).spatial).toBeDefined();
        }
        if (e.field && e.loose !== undefined) {
          fumbles++;
          const args = { plays: r.plays!, index, record: r.field!, homeId: g.homeId, seed: 'f', snapY: MID };
          expect(stageField(args)).toBeNull();
          expect(stagePlay(args).spatial).toBeUndefined();
        }
      });
    }
    expect(flagged).toBeGreaterThan(0);
  });

  it('stages games played with the switch off, or before v83, as drawn', () => {
    const r = simulateGame(league, week1[3], { keepPlays: true });
    r.plays!.forEach((e, index) => {
      expect(e.field).toBeUndefined();
      if (index < 40) expect(stage(r, index, week1[3].homeId).spatial).toBeUndefined();
    });
  });

  it("stages a live game's spatial plays as they come", () => {
    const l = createLeague({ seed: 'field-live' });
    l.settings = { spatialField: true };
    const g = l.games.find((x) => x.week === 1 && (x.homeId === l.userTeamId || x.awayId === l.userTeamId))!;
    const live = startLiveGame(l, g);
    const plays: PlayLogEntry[] = [];
    let spatial = 0;
    for (let k = 0; k < 60 && !live.over; k++) {
      plays.push(...live.next());
      const record = live.field()!;
      const index = plays.length - 1;
      const e = plays[index];
      if (!e.field) continue;
      spatial++;
      const s = stagePlay({ plays, index, record, homeId: g.homeId, seed: 'live', snapY: MID });
      expect(s.spatial, `play ${index}`).toBeDefined();
    }
    expect(spatial).toBeGreaterThan(5);
  });
});
