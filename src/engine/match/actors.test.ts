import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import type { FieldUnits, GameResult, PlayLogEntry } from '../types';
import { simulateGame } from './gameSim';

const league = createLeague({ seed: 'actors' });
const games = Array.from({ length: 20 }, (_, i) => {
  const g = league.games[i];
  return { g, r: simulateGame(league, g, { keepPlays: true, seed: `a-${i}` }) };
});
const scrimmage = (e: PlayLogEntry) =>
  e.down > 0 && !!e.kind && ['run', 'pass', 'incomplete', 'int', 'sack', 'scramble'].includes(e.kind);
const each = (fn: (e: PlayLogEntry, r: GameResult, offense: number) => void) => {
  for (const { r } of games) for (const e of r.plays ?? []) fn(e, r, e.offense);
};

describe('who each play was about', () => {
  it('names the passer and target on every pass, the taker on every pick, the rusher on every sack', () => {
    let passes = 0;
    each((e) => {
      if (!scrimmage(e)) return;
      if (e.kind === 'pass' || e.kind === 'int') {
        passes++;
        expect(e.who?.qb).toBeDefined();
        expect(e.who?.ball).toBeDefined();
      }
      if (e.kind === 'int') expect(e.who?.take).toBeDefined();
      if (e.kind === 'sack') expect(e.who?.rush).toBeDefined();
      if (e.kind === 'run') expect(e.who?.ball).toBeDefined();
    });
    expect(passes).toBeGreaterThan(200);
  });

  it('puts the passer, target and carrier on the offense, and the tackler, cover man and taker on the defense', () => {
    each((e, r, offense) => {
      if (!scrimmage(e) || !e.who) return;
      const team = (id: number | undefined) => (id === undefined ? undefined : r.playerTeams[id]);
      for (const id of [e.who.qb, e.who.ball, e.who.beat]) if (id !== undefined) expect(team(id)).toBe(offense);
      for (const id of [e.who.tackle, e.who.cover, e.who.take, e.who.rush])
        if (id !== undefined) expect(team(id)).not.toBe(offense);
    });
  });

  it('matches the box score: targets on logged passes equal each receiver’s targets', () => {
    for (const { r } of games) {
      const targets = new Map<number, number>();
      for (const e of r.plays ?? [])
        if (
          e.down > 0 &&
          (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') &&
          e.who?.ball !== undefined
        )
          targets.set(e.who.ball, (targets.get(e.who.ball) ?? 0) + 1);
      for (const [id, line] of Object.entries(r.playerStats))
        expect(targets.get(Number(id)) ?? 0, `player ${id}`).toBe(line.targets ?? 0);
    }
  });

  it('never credits more first tackles than a player has tackles', () => {
    for (const { r } of games) {
      const first = new Map<number, number>();
      for (const e of r.plays ?? [])
        if (e.who?.tackle !== undefined) first.set(e.who.tackle, (first.get(e.who.tackle) ?? 0) + 1);
      for (const [id, n] of first) expect(n).toBeLessThanOrEqual(r.playerStats[id]?.tackles ?? 0);
    }
  });

  it('plays the same game with the log kept or not', () => {
    for (let i = 0; i < 5; i++) {
      const g = league.games[i];
      const kept = simulateGame(league, g, { keepPlays: true, seed: `same-${i}` });
      const bare = simulateGame(league, g, { seed: `same-${i}` });
      expect([kept.homeScore, kept.awayScore]).toEqual([bare.homeScore, bare.awayScore]);
      expect(kept.playerStats).toEqual(bare.playerStats);
    }
  });
});

describe('who was on the field', () => {
  const offense = (u: FieldUnits) => [u.qb, ...u.ol, u.rb, ...u.wr, ...u.te];
  const defense = (u: FieldUnits) => [...u.dt, ...u.edge, ...u.lb, ...u.cb, ...u.s];

  it('records 11 a side at kickoff, with unique ids and a jersey for each', () => {
    for (const { r } of games) {
      const f = r.field!;
      expect(f).toBeDefined();
      for (const u of f.units) {
        for (const eleven of [offense(u), defense(u)]) {
          expect(eleven).toHaveLength(11);
          expect(new Set(eleven).size).toBe(11);
          for (const id of eleven) expect(f.jerseys[id]).toBeTypeOf('number');
        }
        expect(u.st.length).toBeGreaterThanOrEqual(10);
        for (const id of [u.k, u.p, u.kr, u.pr, ...u.st, ...u.fg]) expect(f.jerseys[id]).toBeTypeOf('number');
      }
    }
  });

  it('records a change at the play after each injury, and the injured man is in no later units', () => {
    let checked = 0;
    for (const { r } of games) {
      const f = r.field!;
      for (const hurt of r.injuries ?? []) {
        const side = f.units[0].qb && r.playerTeams[f.units[0].qb] === hurt.teamId ? 0 : 1;
        const later = f.changes.filter(([, s]) => s === side);
        expect(later.length).toBeGreaterThan(0);
        const last = later[later.length - 1][2];
        expect([...offense(last), ...defense(last)]).not.toContain(hurt.playerId);
        checked++;
      }
      for (const [index] of f.changes) expect(index).toBeLessThanOrEqual((r.plays ?? []).length);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps a game’s added data small', () => {
    for (const { r } of games) {
      const who = (r.plays ?? []).reduce((n, e) => n + JSON.stringify(e.who ?? {}).length, 0);
      expect(JSON.stringify(r.field).length + who).toBeLessThan(16_000);
    }
  });

  it('records nothing when the plays are not kept', () => {
    expect(simulateGame(league, league.games[0], { seed: 'bare' }).field).toBeUndefined();
  });
});

describe('pruning', () => {
  it('drops the field record with the plays when an old game is pruned, and keeps your own', () => {
    const l = createLeague({ seed: 'prune-field' });
    for (let w = 0; w < 3; w++) playWeek(l);
    const week1 = l.games.filter((g) => g.week === 1 && g.result);
    const yours = week1.find((g) => g.homeId === l.userTeamId || g.awayId === l.userTeamId)!;
    const theirs = week1.find((g) => g !== yours)!;
    expect(theirs.result!.field).toBeUndefined();
    expect(yours.result!.field).toBeDefined();
  }, 120_000);
});
