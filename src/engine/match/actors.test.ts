import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import type { FieldUnits, GameResult, PlayLogEntry } from '../types';
import { actorsIn, packActors } from '../playActors';
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
        expect(actorsIn(e).ball).toBeDefined();
      }
      if (e.kind === 'int') expect(actorsIn(e).take).toBeDefined();
      if (e.kind === 'sack') expect(actorsIn(e).rush).toBeDefined();
      if (e.kind === 'run') expect(actorsIn(e).ball).toBeDefined();
    });
    expect(passes).toBeGreaterThan(200);
  });

  it('names no rusher or beaten blocker on a kneel or a spike', () => {
    let n = 0;
    each((e) => {
      if (e.kind !== 'kneel' && e.kind !== 'spike') return;
      n++;
      expect(actorsIn(e).beat).toBeUndefined();
      expect(actorsIn(e).rush).toBeUndefined();
    });
    expect(n).toBeGreaterThan(0);
  });

  it('names the rusher whenever it names a beaten blocker', () => {
    each((e) => {
      if (actorsIn(e).beat !== undefined) expect(actorsIn(e).rush).toBeDefined();
    });
  });

  it('puts the passer, target and carrier on the offense, and the tackler, cover man and taker on the defense', () => {
    each((e, r, offense) => {
      if (!scrimmage(e) || !e.who) return;
      const team = (id: number | undefined) => (id === undefined ? undefined : r.playerTeams[id]);
      for (const id of [actorsIn(e).ball, actorsIn(e).beat]) if (id !== undefined) expect(team(id)).toBe(offense);
      for (const id of [actorsIn(e).tackle, actorsIn(e).cover, actorsIn(e).take, actorsIn(e).rush])
        if (id !== undefined) expect(team(id)).not.toBe(offense);
    });
  });

  it('matches the box score: targets on logged passes equal each receiver’s targets', () => {
    for (const { r } of games) {
      const targets = new Map<number, number>();
      for (const e of r.plays ?? []) {
        const ball = actorsIn(e).ball;
        if (e.down > 0 && (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') && ball !== undefined)
          targets.set(ball, (targets.get(ball) ?? 0) + 1);
      }
      for (const [id, line] of Object.entries(r.playerStats))
        expect(targets.get(Number(id)) ?? 0, `player ${id}`).toBe(line.targets ?? 0);
    }
  });

  it('never credits more first tackles than a player has tackles', () => {
    for (const { r } of games) {
      const first = new Map<number, number>();
      for (const e of r.plays ?? []) {
        const tackle = actorsIn(e).tackle;
        if (tackle !== undefined) first.set(tackle, (first.get(tackle) ?? 0) + 1);
      }
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

describe('packing', () => {
  it('packs a play into a short list in a fixed order, trimmed at the end, and reads it back', () => {
    expect(packActors({ ball: 7, tackle: 9 })).toEqual([7, 9]);
    expect(packActors({ ball: 7, rush: 3 })).toEqual([7, null, null, 3]);
    expect(packActors({})).toBeUndefined();
    for (const a of [{ ball: 7, tackle: 9, cover: 4, rush: 3, beat: 2, take: 1 }, { ball: 7, rush: 3 }, { take: 5 }])
      expect(actorsIn({ who: packActors(a) })).toEqual(a);
    expect(actorsIn({})).toEqual({});
  });

  it('records nothing on kicks: the kick units already name the kicker and returner', () => {
    each((e) => {
      if (e.kind === 'kickoff' || e.kind === 'punt' || e.kind === 'fg' || e.kind === 'xp')
        expect(e.who).toBeUndefined();
    });
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
      const who = (r.plays ?? []).reduce((n, e) => n + (e.who ? JSON.stringify(e.who).length + 7 : 0), 0);
      expect(JSON.stringify(r.field).length + who).toBeLessThan(7_000); // about 4.7 KB a game; a game with several injuries saves more lineups
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
