import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { preparePersonnelGame } from '../personnel/flow';
import { actorsIn } from '../playActors';
import type { Game, GameResult, Player } from '../types';
import { EJECT } from './ejection';
import { GameSim, simulateGame } from './gameSim';

const league = createLeague({ seed: 'eject-t' });
const games = league.games.filter((g) => !g.playoffRound).slice(0, 24);
const play = (n = games.length) => games.slice(0, n).map((g) => simulateGame(league, g, { keepPlays: true }));
const start = { ...EJECT, flagrant: { ...EJECT.flagrant } };
afterEach(() => {
  Object.assign(EJECT, start, { flagrant: { ...start.flagrant } });
});
const ejected = (rs: GameResult[]) => rs.flatMap((r) => r.ejections ?? []);

/** The sim itself, for the scenes a seed won't hand over: the private moves a test needs are typed here. */
interface Inside {
  lineups: [Lineup, Lineup];
  quarter: number;
  clock: number;
  over: boolean;
  qbLeans: unknown;
  step(): void;
  run(): GameResult;
  result(): GameResult;
  eject(p: Player, why: 'fight' | 'twoUnsportsmanlike' | 'flagrant'): void;
  ejectStoppage(): void;
  ejectPending: { p: Player; why: string }[];
  ejectRng: { next(): number };
  out: Set<number>;
  flag(side: 0 | 1, foul: string, by: Player, outcome: string, yards?: number): void;
}
interface Lineup {
  team: { id: number; depthChart?: Record<string, number[]> };
  qb: Player;
  k: Player;
  dt: Player[];
}
const open = (game: Game = games[0]) => {
  preparePersonnelGame(league, game);
  return new GameSim(league, game, { keepPlays: true }) as unknown as Inside;
};
const onField = (l: Lineup) => [l.qb, l.k, ...Object.values(l).flatMap((v) => (Array.isArray(v) ? v : []))] as Player[];

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

  it('a fight is the sack’s after-the-whistle foul, never a new one, and the play’s yards are unchanged', () => {
    EJECT.fight = 1e6;
    EJECT.fightBack = 0;
    const rs = play();
    const out = ejected(rs);
    expect(out.length).toBeGreaterThan(2);
    for (const e of out) expect(e.why).toBe('fight');
    for (const r of rs) {
      const rolled = [r.home, r.away].reduce(
        (n, t) =>
          n + (t.flags?.unsportsmanlike ?? 0) + (t.declined?.unsportsmanlike ?? 0) + (t.offset?.unsportsmanlike ?? 0),
        0,
      );
      expect(r.ejections?.length ?? 0).toBeLessThanOrEqual(rolled);
    }
    // The same game with no ejection odds is the same up to and including the play he was thrown out after.
    const g = games.find((_, i) => rs[i].ejections?.length)!;
    const withIt = rs[games.indexOf(g)];
    EJECT.fight = 0;
    const without = simulateGame(league, g, { keepPlays: true });
    const at = withIt.plays!.findIndex((p) => /is ejected\./.test(p.text));
    expect(at).toBeGreaterThan(0);
    expect(withIt.plays!.slice(0, at).map((p) => p.text)).toEqual(without.plays!.slice(0, at).map((p) => p.text));
  });

  it('a man swung at who swings back goes too, and his foul offsets', () => {
    EJECT.fight = 1e6;
    EJECT.fightBack = 1e6;
    const rs = play(12);
    const offset = rs.reduce(
      (n, r) => n + (r.home.offset?.unsportsmanlike ?? 0) + (r.away.offset?.unsportsmanlike ?? 0),
      0,
    );
    expect(offset).toBeGreaterThan(0);
    expect(rs.some((r) => new Set((r.ejections ?? []).map((e) => e.teamId)).size === 2)).toBe(true);
  });

  it('a flagrant foul ejects only a man whose foul was accepted', () => {
    EJECT.fight = 0;
    EJECT.flagrant = { unnecessaryRoughness: 1e6 };
    const rs = play();
    const out = ejected(rs);
    expect(out.length).toBeGreaterThan(0);
    for (const r of rs)
      for (const e of r.ejections ?? []) {
        expect(e.why).toBe('flagrant');
        expect(r.playerStats[e.playerId]?.penalties ?? 0).toBeGreaterThanOrEqual(1);
      }
  });

  it('a second accepted unsportsmanlike conduct foul in one game ends his game, with no dice', () => {
    const sim = open();
    const man = sim.lineups[1].dt[0];
    const draws = sim.ejectRng.next;
    let used = 0;
    sim.ejectRng.next = () => (used++, draws.call(sim.ejectRng));
    sim.flag(1, 'unsportsmanlike', man, 'accepted', 15);
    expect(sim.ejectPending).toEqual([]);
    sim.flag(1, 'unsportsmanlike', man, 'accepted', 15);
    expect(sim.ejectPending).toEqual([{ p: man, why: 'twoUnsportsmanlike' }]);
    expect(used).toBe(0);
    const other = sim.lineups[1].dt[1];
    sim.flag(1, 'unsportsmanlike', other, 'declined');
    sim.flag(1, 'unsportsmanlike', other, 'offset');
    sim.flag(1, 'unsportsmanlike', other, 'accepted', 15);
    expect(sim.ejectPending.length).toBe(1);
  });

  it('an ejected man takes no later snap: not in any later play, not in the rebuilt lineup', () => {
    EJECT.fight = 1e6;
    EJECT.fightBack = 0;
    EJECT.flagrant = { unnecessaryRoughness: 1e6 };
    let seen = 0;
    for (const g of games) {
      const sim = open(g);
      const r = sim.run();
      const lineups = sim.lineups;
      const lines = r.plays!.flatMap((p, i) => (/is ejected\./.test(p.text) ? [i] : []));
      for (const [n, e] of (r.ejections ?? []).entries()) {
        seen++;
        const at = lines[n];
        for (const p of r.plays!.slice(at + 1))
          for (const w of [actorsIn(p), actorsIn(p.ran ?? {})]) expect(Object.values(w)).not.toContain(e.playerId);
        for (const l of lineups) expect(onField(l).map((p) => p.id)).not.toContain(e.playerId);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('an ejected kicker is covered as an injured one is, and the game goes on', () => {
    const sim = open();
    const kicker = sim.lineups[0].k;
    sim.eject(kicker, 'fight');
    sim.ejectStoppage();
    expect(sim.lineups[0].k).toBeDefined();
    expect(sim.lineups[0].k.id).not.toBe(kicker.id);
    const r = sim.run();
    expect(r.ejections).toEqual([expect.objectContaining({ playerId: kicker.id, why: 'fight' })]);
    expect(sim.lineups[0].k.id).not.toBe(kicker.id);
  });

  it('an ejected quarterback is replaced and the quarterback leans are read again', () => {
    const sim = open();
    const qb = sim.lineups[0].qb;
    const leans = sim.qbLeans;
    sim.eject(qb, 'fight');
    sim.ejectStoppage();
    expect(sim.lineups[0].qb.id).not.toBe(qb.id);
    expect(sim.qbLeans).not.toBe(leans);
  });

  it('a side with nobody to take the quarterback’s place keeps him in, and nothing is recorded', () => {
    const sim = open();
    const qb = sim.lineups[0].qb;
    for (const id of sim.lineups[0].team.depthChart?.QB ?? []) if (id !== qb.id) sim.out.add(id);
    sim.eject(qb, 'fight');
    sim.ejectStoppage();
    expect(sim.lineups[0].qb.id).toBe(qb.id);
    expect(sim.result().ejections).toBeUndefined();
  });

  it('an ejection pending as the half, the quarter or the game runs out still lands', () => {
    for (const [quarter, atEnd] of [
      [2, false],
      [4, false],
      [4, true],
    ] as const) {
      const sim = open();
      const target = (sim.lineups[1].dt[0] as Player) ?? sim.lineups[1].dt[0];
      let queued = false;
      while (!sim.over) {
        if (!atEnd && !queued && sim.quarter === quarter && sim.clock <= 0) {
          sim.eject(target, 'flagrant');
          queued = true;
        }
        sim.step();
      }
      if (atEnd) sim.eject(target, 'flagrant');
      else expect(queued).toBe(true);
      const r = sim.result();
      expect(r.ejections?.map((e) => e.playerId)).toEqual([target.id]);
      if (!atEnd) expect(r.ejections![0].quarter).toBe(quarter);
    }
  });
});
