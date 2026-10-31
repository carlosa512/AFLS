import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import { actorsIn } from '../../engine/playActors';
import type { FieldUnits, Game, GameResult } from '../../engine/types';
import { castFor, unitsAt } from './cast';

const league = createLeague({ seed: 'stage' });
const games: { g: Game; r: GameResult }[] = Array.from({ length: 40 }, (_, i) => {
  const g = league.games[i];
  return { g, r: simulateGame(league, g, { keepPlays: true, seed: `st-${i}` }) };
});
const eleven = (u: FieldUnits) => [u.qb, ...u.ol, u.rb, ...u.wr, ...u.te, ...u.dt, ...u.edge, ...u.lb, ...u.cb, ...u.s];

describe('who is on the field for a play', () => {
  it('puts 11 different players a side on every entry of 40 games, with unique jerseys a side', () => {
    for (const { g, r } of games)
      r.plays!.forEach((_, i) => {
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        for (const side of [cast.offense, cast.defense]) {
          expect(side).toHaveLength(11);
          expect(new Set(side.map((m) => m.id)).size).toBe(11);
          expect(new Set(side.map((m) => r.field!.jerseys[m.id])).size).toBe(11);
        }
        const ids = new Set([...cast.offense, ...cast.defense].map((m) => m.id));
        expect(ids.size).toBe(22);
      });
  });

  it('never puts a player on the field after the change that took him out', () => {
    let checked = 0;
    for (const { r } of games)
      for (const hurt of r.injuries ?? []) {
        const change = r.field!.changes.find(
          ([, , u]) => !eleven(u).includes(hurt.playerId) && r.playerTeams[u.qb] === hurt.teamId,
        );
        if (!change) continue;
        for (let i = change[0]; i < r.plays!.length; i++) {
          const [home, away] = unitsAt(r.field!, i);
          const side = r.playerTeams[home.qb] === hurt.teamId ? home : away;
          if (eleven(side).includes(hurt.playerId)) {
            // Only allowed if a later change put him back, which injuries never do.
            throw new Error(`player ${hurt.playerId} back on the field at play ${i}`);
          }
        }
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
  });

  it('puts every player a scrimmage play was about on the field, swapping in a spelling back or a rotation rusher', () => {
    let swaps = 0;
    for (const { g, r } of games)
      r.plays!.forEach((e, i) => {
        if (!e.who || !e.down) return;
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        const on = new Set([...cast.offense, ...cast.defense].map((m) => m.id));
        const [home, away] = unitsAt(r.field!, i);
        const units = r.playerTeams[home.qb] === e.offense ? [home, away] : [away, home];
        for (const id of Object.values(actorsIn(e))) {
          expect(on.has(id), `play ${i}: ${id}`).toBe(true);
          if (!eleven(units[0]).includes(id) && !eleven(units[1]).includes(id)) swaps++;
        }
      });
    expect(swaps).toBeGreaterThan(0);
  });

  it('lines up the kick units on kicks: the kicker and the returner are on the field', () => {
    for (const { g, r } of games.slice(0, 10))
      r.plays!.forEach((e, i) => {
        if (e.kind !== 'kickoff' && e.kind !== 'punt') return;
        const cast = castFor(r.field!, r.plays!, i, g.homeId);
        expect(cast.offense.some((m) => m.role === 'K' || m.role === 'P')).toBe(true);
        expect(cast.defense.filter((m) => m.role === 'RET')).toHaveLength(1);
      });
  });
});
