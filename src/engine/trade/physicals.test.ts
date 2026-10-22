import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League, Player } from '../types';
import { evaluateTrade, examine, proposeTrade, resolveExam, tradeContext } from '.';
import { lowerPrice } from './physicals';
import type { TradeProposal } from './rules';

const base = JSON.stringify(createLeague({ seed: 'physicals' }));
const fresh = (): League => JSON.parse(base);

/** Three severe injuries in two years and a bad knee now: no doctor should pass him. */
function breakDown(l: League, p: Player): void {
  p.injuries = [0, 1, 2].map((i) => ({
    type: 'acl',
    severity: 'severe' as const,
    season: l.season - (i % 2),
    week: 3 + i,
    weeks: 30,
    scar: { speed: -1 },
  }));
  p.injury = {
    type: 'acl',
    severity: 'severe',
    weeksRemaining: 12,
    estimate: [10, 14],
    season: l.season,
    week: l.week,
    where: 'game',
  };
}

describe('physicals', () => {
  it('passes sound players almost always', () => {
    const l = fresh();
    let failed = 0;
    let n = 0;
    for (const p of Object.values(l.players)
      .filter((x) => x.teamId !== null && !x.injury)
      .slice(0, 400)) {
      for (const t of [3, 17, 28]) {
        if (t === p.teamId) continue;
        n++;
        if (examine(l, t, p).result === 'failed') failed++;
      }
    }
    expect(failed / n).toBeLessThan(0.02);
  });

  it('fails a broken player in season, and clears a merely hurt one to rehab in the offseason', () => {
    const l = fresh();
    const p = activeRoster(l, 5)[0];
    breakDown(l, p);
    const exam = examine(l, 9, p);
    expect(exam.result).toBe('failed');
    expect(exam.note).not.toMatch(/\d\.\d/);
    const off = fresh();
    off.phase = 'freeAgency';
    const q = activeRoster(off, 5)[0];
    q.injuries = [];
    q.injury = {
      type: 'hamstring',
      severity: 'moderate',
      weeksRemaining: 8,
      estimate: [6, 9],
      season: off.season,
      week: 0,
      where: 'game',
    };
    expect(['rehab', 'passed']).toContain(examine(off, 9, q).result);
  });

  it('examines the same way every time from the same seed', () => {
    const l = fresh();
    const p = activeRoster(l, 5)[0];
    breakDown(l, p);
    p.injury = undefined;
    expect(examine(l, 9, p)).toEqual(examine(l, 9, p));
  });

  it('puts the call to you when your doctor fails a player you are buying', () => {
    const l = fresh();
    const ai = 9;
    // A depth player of his for the best of yours that he takes: a deal the league allows and he agrees to, so it
    // reaches the physicals. (Your very best may not be one: a payroll near the cap can't absorb a star's whole hit.)
    const target = activeRoster(l, ai).sort((a, b) => playerOvr(b) - playerOvr(a))[30];
    breakDown(l, target);
    target.injury = undefined; // in season a hurt player can't be traded at all
    const mine = activeRoster(l, l.userTeamId).sort((a, b) => playerOvr(b) - playerOvr(a));
    const dealFor = (give: Player): TradeProposal => ({
      sides: [
        { teamId: l.userTeamId, players: [give.id], picks: [] },
        { teamId: ai, players: [target.id], picks: [] },
      ],
    });
    const proposal = dealFor(mine.find((p) => evaluateTrade(l, dealFor(p)).accepts)!);
    const r = proposeTrade(l, proposal);
    expect(r.accepted).toBe(false);
    expect(l.market!.exam!.by).toBe('yours');
    expect(target.teamId).toBe(ai);
    const walked = JSON.parse(JSON.stringify(l)) as League;
    resolveExam(walked, 'walk');
    expect(walked.players[target.id].teamId).toBe(ai);
    expect(walked.market!.exam).toBeUndefined();
    expect(resolveExam(l, 'anyway').ok).toBe(true);
    expect(l.players[target.id].teamId).toBe(l.userTeamId);
  });

  it('asks a lower price by dropping one of the buyer’s picks, or adding one of the seller’s back', () => {
    const l = fresh();
    const ctx = tradeContext(l);
    const picks = (t: number) => l.draftPicks.filter((p) => p.ownerId === t).map((p) => p.id);
    const p = activeRoster(l, 9)[0];
    const two: TradeProposal = {
      sides: [
        { teamId: 4, players: [], picks: picks(4).slice(0, 2) },
        { teamId: 9, players: [p.id], picks: [] },
      ],
    };
    expect(lowerPrice(ctx, two, 4)!.sides[0].picks).toHaveLength(1);
    const one: TradeProposal = {
      sides: [
        { teamId: 4, players: [], picks: picks(4).slice(0, 1) },
        { teamId: 9, players: [p.id], picks: [] },
      ],
    };
    expect(lowerPrice(ctx, one, 4)!.sides[1].picks).toHaveLength(1);
  });
});
