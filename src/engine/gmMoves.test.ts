/**
 * The durable record of a GM's notable moves: a trade with a first-round pick in it and a big signing are kept on the
 * GM, with what a Column needs seasons later (the rounds of the picks, the years and the total), and keeping it never
 * changes play.
 */
import { describe, expect, it } from 'vitest';
import { capFor } from './finance/cap';
import { createLeague } from './generate';
import { MOVES, movesAt, noteSigning } from './gmMoves';
import { playWeek } from './league';
import { signPlayer } from './offseason/negotiation';
import { setTeam, teamPlayers } from './roster';
import { executeTrade } from './trade/execute';
import type { GmMove, League } from './types';

const [A, B] = [3, 7];
const gmOf = (l: League, teamId: number) => l.gms[l.teams[teamId].gmId!];
/** A team's own pick in the next draft, by round. */
const pick = (l: League, teamId: number, round: number) =>
  l.draftPicks.find((p) => p.ownerId === teamId && p.originalTeamId === teamId && p.round === round)!;
const offer = (years: number, apy: number) => ({ years, apy, bonusPct: 0, gtdPct: 0, voidYears: 0 });

describe('a GM’s notable moves', () => {
  it('keeps a trade with a first-round pick for both GMs, each from his side, with the rounds', () => {
    const l = createLeague({ seed: 'moves-trade' });
    const [first, second] = [pick(l, A, 1), pick(l, A, 2)];
    const p = teamPlayers(l, B)[0];
    executeTrade(l, {
      sides: [
        { teamId: A, players: [], picks: [first.id, second.id] },
        { teamId: B, players: [p.id], picks: [] },
      ],
    });
    const picks = [
      { season: first.season, round: 1 },
      { season: second.season, round: 2 },
    ];
    expect(movesAt(gmOf(l, A), A)).toEqual([
      {
        kind: 'trade',
        season: l.season,
        phase: l.phase,
        week: l.week,
        teamId: A,
        otherId: B,
        gave: { players: [], picks },
        got: { players: [p.id], picks: [] },
      },
    ]);
    expect(movesAt(gmOf(l, B), B)[0]).toMatchObject({
      otherId: A,
      gave: { players: [p.id], picks: [] },
      got: { players: [], picks },
    });
    // The rounds are still there once the league has pruned the picks.
    l.draftPicks = [];
    const kept = movesAt(gmOf(l, A), A)[0];
    expect(kept.kind === 'trade' && kept.gave.picks[0].round).toBe(1);
  });

  it('keeps no trade without a first-round pick', () => {
    const l = createLeague({ seed: 'moves-second' });
    const p = teamPlayers(l, B)[0];
    executeTrade(l, {
      sides: [
        { teamId: A, players: [], picks: [pick(l, A, 2).id] },
        { teamId: B, players: [p.id], picks: [] },
      ],
    });
    expect(movesAt(gmOf(l, A), A)).toEqual([]);
    expect(movesAt(gmOf(l, B), B)).toEqual([]);
  });

  it('keeps a signing worth 8% of the cap or more, and not a smaller one, a re-signing or a tag', () => {
    const l = createLeague({ seed: 'moves-sign' });
    const cap = capFor(l, l.season);
    // Three players on the market: a fresh league has none.
    const [big, small, tagged] = teamPlayers(l, B).slice(0, 3);
    for (const p of [big, small, tagged]) {
      setTeam(l, p, null);
      p.contract = null;
    }
    const apy = Math.ceil((MOVES.signShare * cap) / 2);
    signPlayer(l, big, A, offer(2, apy));
    signPlayer(l, small, A, offer(2, Math.floor((0.079 * cap) / 2)));
    signPlayer(l, tagged, A, offer(1, 2 * apy), 'tag');
    const own = teamPlayers(l, A).find((p) => p.id !== big.id && p.id !== small.id && p.id !== tagged.id)!;
    signPlayer(l, own, A, offer(4, 2 * apy));
    expect(movesAt(gmOf(l, A), A)).toEqual([
      {
        kind: 'sign',
        season: l.season,
        phase: l.phase,
        week: l.week,
        teamId: A,
        playerId: big.id,
        years: 2,
        total: 2 * apy,
      },
    ]);
  });

  it('reads only the moves made at the team asked about', () => {
    const l = createLeague({ seed: 'moves-read' });
    const gm = gmOf(l, A);
    const at = (teamId: number): GmMove => ({
      kind: 'sign',
      season: l.season,
      phase: l.phase,
      week: 1,
      teamId,
      playerId: 1,
      years: 2,
      total: 50_000,
    });
    gm.deals = [at(3), at(7)];
    expect(movesAt(gm, 7)).toEqual([at(7)]);
    expect(movesAt(gmOf(l, B), B)).toEqual([]);
  });

  it('drops the oldest past MOVES.keep', () => {
    const l = createLeague({ seed: 'moves-keep' });
    const players = teamPlayers(l, B);
    const total = capFor(l, l.season);
    for (let i = 0; i <= MOVES.keep; i++) noteSigning(l, players[i % players.length], A, 1 + (i % 3), total + i);
    const kept = movesAt(gmOf(l, A), A);
    expect(kept).toHaveLength(MOVES.keep);
    expect(kept[0]).toMatchObject({ total: total + 1 });
    expect(kept.at(-1)).toMatchObject({ total: total + MOVES.keep });
  });

  it('plays the same with the record off', () => {
    const play = (on: boolean) => {
      MOVES.on = on;
      try {
        const l = createLeague({ seed: 'moves-off' });
        while (l.week <= 10) playWeek(l);
        return l;
      } finally {
        MOVES.on = true;
      }
    };
    const strip = (x: League) => {
      const copy = JSON.parse(JSON.stringify(x)) as League;
      for (const g of Object.values(copy.gms)) delete g.deals;
      return JSON.stringify(copy);
    };
    const [on, off] = [play(true), play(false)];
    expect(Object.values(off.gms).some((g) => g.deals)).toBe(false);
    expect(Object.values(on.gms).some((g) => g.deals?.length)).toBe(true);
    expect(strip(on)).toBe(strip(off));
  });
});
