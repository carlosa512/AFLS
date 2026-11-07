import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { aiGm, habitsForce } from './gmHabits';
import { habitsNewYear, noteYoungQbSeasons, resolveMoves } from './gmHabitsYear';
import { playerOvr } from './positions';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import type { HabitMove, League, Player } from './types';

const ai = (l: League) => Object.values(l.gms).filter((g) => g.id !== l.userGmId);

afterEach(() => {
  habitsForce.all = null;
  habitsForce.off = false;
});

describe('habits at the new league year', () => {
  it('a new league’s AI GMs start on one active habit; yours never', () => {
    const l = createLeague({ seed: 'hy-start' });
    for (const g of ai(l)) expect(Object.keys(g.habits ?? {})).toHaveLength(1);
    expect(l.gms[l.userGmId].habits).toBeUndefined();
  });

  it('fades an unused habit and draws only for employed GMs; a GM between jobs keeps his marbles', () => {
    const l = createLeague({ seed: 'hy-fade' });
    const [a, b] = l.teams.filter((t) => t.id !== l.userTeamId).map((t) => aiGm(l, t)!);
    a.habitMarbles = { gunShy: 2 };
    b.habitMarbles = { gunShy: 2 };
    const grip = JSON.stringify(b.habits);
    b.teamId = null;
    b.traits = l.teams[l.userTeamId].gm;
    habitsNewYear(l);
    expect(b.habitMarbles.gunShy).toBe(2);
    expect(b.habitMarbles['fade:' + Object.keys(b.habits!)[0]]).toBe(1);
    expect(JSON.stringify(b.habits)).toBe(grip);
    expect(a.habitMarbles).toBeUndefined();
  });

  it('draws at the new league year through beginOffseason and replays identically', () => {
    const run = () => {
      const l = createLeague({ seed: 'hy-replay' });
      for (const g of ai(l)) g.habitMarbles = { gunShy: 1 };
      simToEndOfSeason(l);
      beginOffseason(l);
      return l;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.gms)).toBe(JSON.stringify(b.gms));
    expect(
      ai(a)
        .filter((g) => g.teamId !== null)
        .every((g) => !g.habitMarbles?.gunShy),
    ).toBe(true);
  }, 300_000);

  it('draws nothing while habitsForce is set', () => {
    const l = createLeague({ seed: 'hy-force' });
    const g = aiGm(l, l.teams.find((t) => t.id !== l.userTeamId)!)!;
    g.habitMarbles = { gunShy: 2 };
    habitsForce.off = true;
    habitsNewYear(l);
    expect(g.habitMarbles.gunShy).toBe(2);
  });
});

// ───────── outcomes into marbles ─────────

/** A world where every QB has a full season in each given year; `bench` then sit (a backup's snaps) in the year. */
function stage(l: League, years: Record<number, Player[]>) {
  const qbs = Object.values(l.players).filter((p) => p.position === 'QB');
  for (const [y, bench] of Object.entries(years)) {
    for (const p of qbs) {
      const sit = bench.includes(p);
      p.stats[+y] = {
        gp: 16,
        snaps: sit ? 20 : 1000,
        passAtt: 480,
        passCmp: 300,
        passYds: 3500,
        passTd: 22,
        passInt: 10,
      };
    }
  }
}

function setup(seed: string) {
  const l = createLeague({ seed });
  l.season = 2040; // the year just ticked: 2039 was played
  const team = l.teams.find(
    (t) => t.id !== l.userTeamId && Object.values(l.players).some((p) => p.teamId === t.id && p.position === 'QB'),
  )!;
  const gm = aiGm(l, team)!;
  gm.habitMarbles = {};
  gm.habitLog = [];
  const qb = Object.values(l.players).find((p) => p.teamId === team.id && p.position === 'QB')!;
  const log = (m: Partial<HabitMove> & { habit: string; season: number }) => {
    gm.habitLog!.push({ teamId: team.id, playerId: qb.id, ...m });
    return gm.habitLog!.at(-1)!;
  };
  return { l, team, gm, qb, log };
}

describe('moves resolved into marbles', () => {
  it('bridgeQb: +1 when the young QB starts in s+1 for the club, else -1', () => {
    const a = setup('hr-bridge-a');
    stage(a.l, { 2039: [] });
    a.log({ habit: 'bridgeQb', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ bridgeQb: 1 });
    const b = setup('hr-bridge-b');
    stage(b.l, { 2039: [b.qb] });
    b.log({ habit: 'bridgeQb', season: 2038 });
    resolveMoves(b.l, b.gm);
    expect(b.gm.habitMarbles).toEqual({ 'fade:bridgeQb': 1 });
  });

  it('tradeUpQb: +1 when he starts, -1 when gone, waits when benched on the club', () => {
    const a = setup('hr-tuq');
    stage(a.l, { 2038: [], 2039: [a.qb] });
    const e = a.log({ habit: 'tradeUpQb', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBe(1);
    expect(a.gm.habitMarbles).toEqual({ tradeUpQb: 1 });
    const b = setup('hr-tuq-b');
    stage(b.l, { 2038: [b.qb], 2039: [b.qb] });
    const e2 = b.log({ habit: 'tradeUpQb', season: 2039 });
    resolveMoves(b.l, b.gm);
    expect(e2.resolved).toBeUndefined();
    const e3 = b.log({ habit: 'tradeUpQb', season: 2038 });
    resolveMoves(b.l, b.gm);
    expect(e3.resolved).toBe(-1);
    expect(b.gm.habitMarbles).toEqual({ 'fade:tradeUpQb': 1 });
    b.qb.teamId = -5;
    const e4 = b.log({ habit: 'tradeUpQb', season: 2039 });
    resolveMoves(b.l, b.gm);
    expect(e4.resolved).toBe(-1);
  });

  it('extendEarly: +1 on the club and starting two years on, else -1', () => {
    const a = setup('hr-ext');
    stage(a.l, { 2039: [] });
    a.log({ habit: 'extendEarly', season: 2037 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ extendEarly: 1 });
    const b = setup('hr-ext-b');
    stage(b.l, { 2039: [b.qb] });
    b.log({ habit: 'extendEarly', season: 2037 });
    resolveMoves(b.l, b.gm);
    expect(b.gm.habitMarbles).toEqual({ 'fade:extendEarly': 1 });
  });

  it('sellsEarly: +1 for a good sale with no All-League season, -1 when he made it for another club', () => {
    const a = setup('hr-sell');
    a.l.awards = [];
    a.log({ habit: 'sellsEarly', season: 2038, good: true });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ sellsEarly: 1 });
    const b = setup('hr-sell-b');
    b.l.awards = [{ season: 2039, winners: {}, allLeague: [[{ playerId: b.qb.id, teamId: b.team.id + 1 }], []] }];
    b.log({ habit: 'sellsEarly', season: 2038, good: true });
    resolveMoves(b.l, b.gm);
    expect(b.gm.habitMarbles).toEqual({ 'fade:sellsEarly': 1 });
  });

  it('hisGuys: +1 on the club and starting, -1 gone', () => {
    const a = setup('hr-guys');
    stage(a.l, { 2039: [] });
    a.log({ habit: 'hisGuys', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ hisGuys: 1 });
    a.qb.teamId = -5;
    a.log({ habit: 'hisGuys', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ hisGuys: 1, 'fade:hisGuys': 1 });
  });

  it('firstsForStars: +1 when the club made the playoffs that season, else -1', () => {
    const a = setup('hr-firsts');
    a.l.history = [
      {
        season: 2039,
        championId: 0,
        runnerUpId: 1,
        records: {},
        playoffs: { [a.team.id]: { w: 1, l: 1, round: 'divisional' as never } },
      },
    ];
    a.log({ habit: 'firstsForStars', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ firstsForStars: 1 });
    a.l.history = [];
    a.log({ habit: 'firstsForStars', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ firstsForStars: 1, 'fade:firstsForStars': 1 });
  });

  it('swaps: always +1', () => {
    const a = setup('hr-swaps');
    a.log({ habit: 'swaps', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ swaps: 1 });
  });

  it('bpa: +1 once a starter in s or s+1; -1 at due 3 if not a starter in s+2', () => {
    const a = setup('hr-bpa');
    stage(a.l, { 2038: [], 2039: [a.qb] });
    const e = a.log({ habit: 'bpa', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBe(1);
    const b = setup('hr-bpa-b');
    stage(b.l, { 2038: [b.qb], 2039: [b.qb] });
    const e2 = b.log({ habit: 'bpa', season: 2038 });
    resolveMoves(b.l, b.gm);
    expect(e2.resolved).toBeUndefined();
    const e3 = b.log({ habit: 'bpa', season: 2037 });
    stage(b.l, { 2038: [b.qb] });
    resolveMoves(b.l, b.gm);
    expect(e3.resolved).toBe(-1);
    expect(b.gm.habitMarbles).toEqual({ 'fade:bpa': 1 });
  });

  it('tagsFirst: +1 still on the club, -1 gone', () => {
    const a = setup('hr-tag');
    a.log({ habit: 'tagsFirst', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ tagsFirst: 1 });
    a.qb.teamId = -5;
    a.log({ habit: 'tagsFirst', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ tagsFirst: 1, 'fade:tagsFirst': 1 });
  });

  it('youngQb: +1 when he grew half a point, -1 gone, and -1 on a third flat year in a row', () => {
    const a = setup('hr-yqb');
    const ovr = playerOvr(a.qb);
    const e = a.log({ habit: 'youngQb', season: 2038, ovr: ovr - 1 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBe(1);
    expect(a.gm.habitMarbles).toEqual({ youngQb: 1 });
    const b = setup('hr-yqb-b');
    const flat = () => b.log({ habit: 'youngQb', season: 2038, ovr: playerOvr(b.qb) });
    b.gm.habitLog!.push(
      { habit: 'youngQb', season: 2036, teamId: b.team.id, playerId: b.qb.id, ovr: 99, resolved: 0 },
      { habit: 'youngQb', season: 2037, teamId: b.team.id, playerId: b.qb.id, ovr: 99, resolved: 0 },
    );
    const third = flat();
    resolveMoves(b.l, b.gm);
    expect(third.resolved).toBe(-1);
    expect(b.gm.habitMarbles).toEqual({ 'fade:youngQb': 1 });
    const d = setup('hr-yqb-d');
    const fresh = d.log({ habit: 'youngQb', season: 2039, ovr: 0 });
    resolveMoves(d.l, d.gm);
    expect(fresh.resolved).toBeUndefined();
    const c = setup('hr-yqb-c');
    const second = c.log({ habit: 'youngQb', season: 2038, ovr: playerOvr(c.qb) });
    resolveMoves(c.l, c.gm);
    expect(second.resolved).toBe(0);
    expect(c.gm.habitMarbles).toEqual({});
  });

  it('gunShy: never a marble here', () => {
    const a = setup('hr-gun');
    const e = a.log({ habit: 'gunShy', season: 2039 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBe(0);
    expect(a.gm.habitMarbles).toEqual({});
  });

  it('leaves an entry alone before it is due, and resolves each once', () => {
    const a = setup('hr-due');
    const e = a.log({ habit: 'extendEarly', season: 2038 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBeUndefined();
    a.log({ habit: 'swaps', season: 2039 });
    resolveMoves(a.l, a.gm);
    resolveMoves(a.l, a.gm);
    expect(a.gm.habitMarbles).toEqual({ swaps: 1 });
  });

  it('resolves 0 when the player is gone from the league', () => {
    const a = setup('hr-gone');
    const e = a.log({ habit: 'hisGuys', season: 2039, playerId: -999 });
    resolveMoves(a.l, a.gm);
    expect(e.resolved).toBe(0);
    expect(a.gm.habitMarbles).toEqual({});
  });
});

describe('young QB seasons', () => {
  it('logs a drafted young starter on a losing club, against the season just played', () => {
    const a = setup('hr-note');
    stage(a.l, { 2039: [] });
    a.qb.age = 24;
    a.qb.draft = { teamId: a.team.id, season: 2037, round: 1, pick: 3 } as never;
    a.gm.appointments = [{ teamId: a.team.id, start: { season: 2030 } } as never];
    a.l.history = [{ season: 2039, championId: 0, runnerUpId: 1, records: { [a.team.id]: { w: 4, l: 13, t: 0 } } }];
    for (const p of Object.values(a.l.players))
      if (p !== a.qb && p.teamId === a.team.id && p.position === 'QB') p.age = 35;
    noteYoungQbSeasons(a.l);
    const m = a.gm.habitLog!.filter((x) => x.habit === 'youngQb' && x.playerId === a.qb.id);
    expect(m).toHaveLength(1);
    expect(m[0].season).toBe(2039);
    expect(m[0].ovr).toBe(playerOvr(a.qb));
    a.gm.habitLog = [];
    a.l.history[0].records[a.team.id] = { w: 12, l: 5, t: 0 };
    noteYoungQbSeasons(a.l);
    expect(a.gm.habitLog.filter((x) => x.habit === 'youngQb' && x.playerId === a.qb.id)).toHaveLength(0);
  });
});
