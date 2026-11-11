import { describe, expect, it } from 'vitest';
import { CUT, gameFacts, recordsBefore, type ClubRecord, type GameAngle } from './snnStory';
import type { Game, GameInjury, GameResult, League, Player, StatLine, TeamGameStats } from './types';

const HOME = 1;
const AWAY = 2;
const rec = (w: number, l: number, t = 0, streak = 0): ClubRecord => ({ w, l, t, streak });
const side = (totalYds: number): TeamGameStats => ({ totalYds, turnovers: 0 }) as TeamGameStats;

interface Over {
  week?: number;
  /** The winner is the home club unless `tie`. */
  winner?: ClubRecord;
  loser?: ClubRecord;
  winnerQ?: number[];
  loserQ?: number[];
  winnerYds?: number;
  loserYds?: number;
  overtime?: boolean;
  stats?: Record<number, StatLine>;
  teams?: Record<number, number>;
  injuries?: GameInjury[];
  players?: Record<number, Partial<Player>>;
}
function build(o: Over) {
  const wq = o.winnerQ ?? [7, 7, 3, 3];
  const lq = o.loserQ ?? [3, 3, 7, 0];
  const sum = (q: number[]) => q.reduce((a, b) => a + b, 0);
  const result: GameResult = {
    homeScore: sum(wq),
    awayScore: sum(lq),
    overtime: o.overtime ?? false,
    quarters: { home: wq, away: lq },
    home: side(o.winnerYds ?? 330),
    away: side(o.loserYds ?? 310),
    playerStats: o.stats ?? {},
    playerTeams: o.teams ?? {},
    injuries: o.injuries,
  };
  const game: Game = { id: 9, season: 2026, week: o.week ?? 8, homeId: HOME, awayId: AWAY, result };
  const league = { season: 2026, players: o.players ?? {} } as unknown as League;
  const before = new Map<number, ClubRecord>([
    [HOME, o.winner ?? rec(3, 3)],
    [AWAY, o.loser ?? rec(3, 3)],
  ]);
  return gameFacts(league, game, before);
}
const angleOf = (o: Over): GameAngle => build(o).angle;
const line = (s: Partial<StatLine>): StatLine => s as StatLine;

describe("a game's angle", () => {
  it('calls an upset only after week 5 and at .400 or more', () => {
    expect(angleOf({ week: 6, winner: rec(1, 4), loser: rec(4, 1) })).toBe('upset'); // .200 against .800
    expect(angleOf({ week: 5, winner: rec(1, 3), loser: rec(4, 0) })).not.toBe('upset'); // too early
    expect(angleOf({ week: 9, winner: rec(3, 5), loser: rec(6, 2) })).not.toBe('upset'); // .375 against .750
    expect(angleOf({ week: 9, winner: rec(3, 5), loser: rec(7, 1) })).toBe('upset'); // .375 against .875
  });

  it('ends an unbeaten run at 5-0 and a winless one at 0-5, and neither a game sooner', () => {
    expect(angleOf({ loser: rec(5, 0, 0, 5) })).toBe('unbeatenFalls');
    expect(angleOf({ week: 5, loser: rec(4, 0, 0, 4) })).not.toBe('unbeatenFalls');
    expect(angleOf({ loser: rec(5, 0, 1, 0) })).not.toBe('unbeatenFalls'); // a tie is not unbeaten here
    expect(angleOf({ winner: rec(0, 5, 0, -5) })).toBe('winlessWins');
    expect(angleOf({ week: 5, winner: rec(0, 4, 0, -4) })).not.toBe('winlessWins');
    expect(build({ loser: rec(7, 0, 0, 7) }).streak).toEqual({ teamId: AWAY, length: 7 });
  });

  it('calls a tie before a streak, and a streak at six and not five', () => {
    const tie = build({ winnerQ: [7, 7, 7, 9], loserQ: [10, 10, 10, 0], loser: rec(6, 2, 0, 6), overtime: true });
    expect(tie.angle).toBe('tie');
    expect(tie.winnerId).toBeNull();
    expect(tie.fits).toContain('overtime');
    expect(angleOf({ loser: rec(6, 2, 0, 6) })).toBe('streakEnds');
    expect(angleOf({ loser: rec(5, 3, 0, 5) })).not.toBe('streakEnds');
    const snapped = build({ winner: rec(2, 6, 0, -6) });
    expect(snapped.angle).toBe('streakEnds');
    expect(snapped.streak).toEqual({ teamId: HOME, length: -6 });
  });

  it('reads a comeback at the end of any quarter', () => {
    const down = build({ winnerQ: [0, 7, 7, 14], loserQ: [10, 7, 0, 3] }); // ten down after one
    expect(down.fits).toContain('comeback');
    expect(down.deficit).toBe(10);
    expect(build({ winnerQ: [7, 7, 7, 7], loserQ: [10, 10, 0, 0] }).fits).not.toContain('comeback'); // six down
    expect(build({ winnerQ: [0, 0, 7, 21], loserQ: [7, 7, 3, 0] }).deficit).toBe(14); // ten after two, then fourteen
  });

  it('calls a win against the yardage at a hundred yards and not ninety-nine', () => {
    expect(angleOf({ winnerYds: 279, loserYds: 379 })).toBe('yardage');
    expect(angleOf({ winnerYds: 280, loserYds: 379 })).not.toBe('yardage');
    expect(build({ winnerYds: 279, loserYds: 419 }).yards).toBe(-140);
  });

  it('finds a day at each mark and not one below it', () => {
    const day = (s: Partial<StatLine>) => build({ stats: { 7: line(s) }, teams: { 7: HOME } });
    const marks: [Partial<StatLine>, Partial<StatLine>, keyof typeof CUT.day][] = [
      [{ rushTd: 2, recTd: 1 }, { rushTd: 2 }, 'td'],
      [{ rushYds: 120, recYds: 80 }, { rushYds: 120, recYds: 79 }, 'scrimmage'],
      [{ passYds: 400 }, { passYds: 399 }, 'passYds'],
      [{ passTd: 5 }, { passTd: 4 }, 'passTd'],
      [{ sacks: 3 }, { sacks: 2.5 }, 'sacks'],
      [{ defInt: 3 }, { defInt: 2 }, 'int'],
    ];
    for (const [hit, miss, mark] of marks) {
      expect(day(hit).angle).toBe('day');
      expect(day(hit).day).toMatchObject({ playerId: 7, teamId: HOME, mark });
      expect(day(miss).fits).not.toContain('day');
    }
    // A return or a defensive score counts as a touchdown scored.
    expect(day({ rushTd: 1, krTd: 1, defTd: 1 }).day).toMatchObject({ mark: 'td', value: 3 });
  });

  it('keeps the day furthest past its mark', () => {
    const f = build({
      stats: { 7: line({ rushTd: 3, rushYds: 90 }), 8: line({ passYds: 520 }) },
      teams: { 7: HOME, 8: AWAY },
    });
    expect(f.day).toMatchObject({ playerId: 8, mark: 'passYds', value: 520 }); // 1.30 of its mark against 1.00
  });

  it('calls a quarterback lost only with the injury and a backup of ten dropbacks', () => {
    const hurt: GameInjury = {
      playerId: 11,
      teamId: AWAY,
      quarter: 2,
      clock: 300,
      type: 'concussion',
      estimate: [0, 1],
    };
    const players = { 11: { position: 'QB' }, 12: { position: 'QB' } } as Record<number, Partial<Player>>;
    const teams = { 11: AWAY, 12: AWAY };
    const lost = build({
      injuries: [hurt],
      players,
      teams,
      stats: { 11: line({ dropbacks: 14 }), 12: line({ dropbacks: 21 }) },
    });
    expect(lost.angle).toBe('qbLost');
    expect(lost.qbLost).toEqual({ teamId: AWAY, starterId: 11, backupId: 12 });
    const brief = { 11: line({ dropbacks: 30 }), 12: line({ dropbacks: 9 }) };
    expect(build({ injuries: [hurt], players, teams, stats: brief }).fits).not.toContain('qbLost');
    const benched = { 11: line({ dropbacks: 14 }), 12: line({ dropbacks: 21 }) };
    expect(build({ players, teams, stats: benched }).fits).not.toContain('qbLost'); // nobody was hurt
  });

  it('calls a rout at 28 by a club ahead after every quarter', () => {
    expect(angleOf({ winnerQ: [7, 14, 7, 7], loserQ: [0, 0, 7, 0] })).toBe('rout'); // 35-7
    expect(angleOf({ winnerQ: [7, 14, 7, 6], loserQ: [0, 0, 7, 0] })).not.toBe('rout'); // 34-7, 27 points
    expect(angleOf({ winnerQ: [0, 14, 14, 14], loserQ: [3, 0, 7, 0] })).not.toBe('rout'); // trailed after one
  });

  it('falls back to overtime, then to the result', () => {
    expect(angleOf({ winnerQ: [7, 7, 3, 3, 3], loserQ: [3, 3, 7, 7, 0], overtime: true })).toBe('overtime');
    const plain = build({});
    expect(plain.angle).toBe('result');
    expect(plain.fits).toEqual(['result']);
    expect(plain).toMatchObject({ gameId: 9, week: 8, winnerId: HOME, loserId: AWAY });
  });

  it('orders the angles and keeps the rest as support', () => {
    const f = build({ week: 8, loser: rec(7, 0, 0, 7), winnerQ: [0, 0, 7, 21], loserQ: [14, 3, 0, 0] });
    expect(f.angle).toBe('unbeatenFalls');
    // A 7-0 club losing to a 3-3 one is also an upset and a streak ending: all of it is support for the one angle.
    expect(f.fits).toEqual(['unbeatenFalls', 'upset', 'streakEnds', 'comeback']);
  });

  it('has no record to go on in week 1', () => {
    const f = build({ week: 1, winner: rec(0, 0), loser: rec(0, 0) });
    expect(f.fits).not.toContain('upset');
    expect(f.fits).not.toContain('unbeatenFalls');
    expect(f.fits).not.toContain('winlessWins');
  });
});

describe('records before a week', () => {
  const game = (week: number, homeId: number, awayId: number, hs: number, as: number): Game => ({
    id: week * 100 + homeId,
    season: 2026,
    week,
    homeId,
    awayId,
    result: { homeScore: hs, awayScore: as } as GameResult,
  });
  const league = {
    season: 2026,
    teams: [{ id: 0 }, { id: 1 }, { id: 2 }],
    games: [
      game(1, 0, 1, 20, 10),
      game(2, 0, 2, 17, 17),
      game(3, 1, 0, 3, 24),
      game(4, 0, 2, 7, 9),
      { ...game(5, 0, 1, 0, 0), result: undefined },
      { ...game(2, 1, 2, 30, 0), season: 2025 },
      { ...game(3, 2, 1, 30, 0), playoffRound: 'WC' },
    ],
  } as unknown as League;

  it('counts only this season, games before the week, and no playoff games', () => {
    const r = recordsBefore(league, 4);
    expect(r.get(0)).toEqual({ w: 2, l: 0, t: 1, streak: 1 }); // won, tied (streak resets), won
    expect(r.get(1)).toEqual({ w: 0, l: 2, t: 0, streak: -2 });
    expect(recordsBefore(league, 5).get(0)).toEqual({ w: 2, l: 1, t: 1, streak: -1 });
    expect(recordsBefore(league, 1).get(2)).toEqual({ w: 0, l: 0, t: 0, streak: 0 });
  });
});
