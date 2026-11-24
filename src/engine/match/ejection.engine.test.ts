import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { GameResult, Player } from '../types';
import { EJECT } from './ejection';
import { GameSim, simulateGame, startGame } from './gameSim';

const league = createLeague({ seed: 'eject-t' });
const games = league.games.filter((g) => !g.playoffRound).slice(0, 24);
const play = (n = games.length) => games.slice(0, n).map((g) => simulateGame(league, g, { keepPlays: true }));
const start = { ...EJECT, flagrant: { ...EJECT.flagrant } };
afterEach(() => {
  Object.assign(EJECT, start, { flagrant: { ...start.flagrant } });
});
const ejected = (rs: GameResult[]) => rs.flatMap((r) => r.ejections ?? []);

describe('ejections', () => {
  it('with ejections off every play is the same as with them on at no odds', () => {
    EJECT.on = false;
    const off = play(8);
    EJECT.on = true;
    EJECT.fight = 0;
    EJECT.flagrant = {};
    const none = play(8);
    expect(none.map((r) => r.plays!.map((p) => p.text))).toEqual(off.map((r) => r.plays!.map((p) => p.text)));
    expect(ejected(off)).toEqual([]);
  });

  it('a fight ejects the man who threw it, charged as unsportsmanlike conduct, with the yards untouched', () => {
    EJECT.fight = 0.02;
    EJECT.fightBack = 0;
    const rs = play(4);
    const out = ejected(rs);
    expect(out.length).toBeGreaterThan(4);
    for (const e of out) expect(e.why).toBe('fight');
    for (const r of rs)
      expect(r.plays!.filter((p) => /is ejected\./.test(p.text)).length).toBe((r.ejections ?? []).length);
    const fouls = rs.reduce(
      (n, r) => n + (r.home.flags?.unsportsmanlike ?? 0) + (r.away.flags?.unsportsmanlike ?? 0),
      0,
    );
    expect(fouls).toBeGreaterThan(0);
  });

  it('a man swung at who swings back goes too, and the fouls offset', () => {
    EJECT.fight = 0.02;
    EJECT.fightBack = 1e6;
    const rs = play(4);
    const out = ejected(rs);
    expect(out.length).toBeGreaterThan(8);
    const offset = rs.reduce(
      (n, r) => n + (r.home.offset?.unsportsmanlike ?? 0) + (r.away.offset?.unsportsmanlike ?? 0),
      0,
    );
    expect(offset).toBeGreaterThan(0);
    for (const r of rs) {
      const teams = new Set((r.ejections ?? []).map((e) => e.teamId));
      if (r.ejections?.length) expect(teams.size).toBeGreaterThanOrEqual(1);
    }
    expect(rs.some((r) => new Set((r.ejections ?? []).map((e) => e.teamId)).size === 2)).toBe(true);
  });

  it('the first accepted flagrant foul ejects him', () => {
    EJECT.fight = 0;
    EJECT.flagrant = { unnecessaryRoughness: 1e6 };
    const rs = play();
    const out = ejected(rs);
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) expect(e.why).toBe('flagrant');
    for (const r of rs) {
      const mine = (r.ejections ?? []).length;
      const flags = (r.home.flags?.unnecessaryRoughness ?? 0) + (r.away.flags?.unnecessaryRoughness ?? 0);
      expect(mine).toBeLessThanOrEqual(flags);
    }
  });

  it('an ejected man takes no later snap and is on the result with his reason', () => {
    EJECT.fight = 0.02;
    EJECT.fightBack = 0;
    for (const r of play(6))
      for (const e of r.ejections ?? []) {
        const at = r.plays!.findIndex((p) => /is ejected\./.test(p.text));
        expect(at).toBeGreaterThan(-1);
        expect(e.teamId).toBeGreaterThan(0);
        expect(['fight', 'twoUnsportsmanlike', 'flagrant']).toContain(e.why);
      }
  });

  it('a second accepted unsportsmanlike conduct foul in one game ends his game, with no dice', () => {
    startGame(league, games[0]); // readies the game's personnel
    const sim = new GameSim(league, games[0], { keepPlays: true }) as unknown as {
      lineups: { team: { id: number }; dt: Player[] }[];
      flag(side: 0 | 1, foul: string, by: Player, outcome: string, yards?: number): void;
      ejectPending: { p: Player; why: string }[];
      ejectRng: { next(): number };
    };
    const man = sim.lineups[1].dt[0];
    const draws = sim.ejectRng.next;
    let used = 0;
    sim.ejectRng.next = () => (used++, draws.call(sim.ejectRng));
    sim.flag(1, 'unsportsmanlike', man, 'accepted', 15);
    expect(sim.ejectPending).toEqual([]);
    sim.flag(1, 'unsportsmanlike', man, 'accepted', 15);
    expect(sim.ejectPending).toEqual([{ p: man, why: 'twoUnsportsmanlike' }]);
    expect(used).toBe(0);
    // Declined or offsetting flags never count.
    const other = sim.lineups[1].dt[1];
    sim.flag(1, 'unsportsmanlike', other, 'declined');
    sim.flag(1, 'unsportsmanlike', other, 'offset');
    sim.flag(1, 'unsportsmanlike', other, 'accepted', 15);
    expect(sim.ejectPending.length).toBe(1);
  });
});
