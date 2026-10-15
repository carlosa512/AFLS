import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague, SALARY_CAP } from './generate';
import { playWeek, simToEndOfSeason, startNextSeason } from './league';
import * as coach from './match/coach';
import { simulateGame } from './match/gameSim';
import { ROSTER_TEMPLATE } from './positions';
import { Rng } from './rng';
import { payroll, teamPlayers } from './roster';
import { playoffGames } from './season/playoffs';
import { computeRecords, conferenceSeeds, divisionStandings } from './season/standings';
import { ATTRIBUTES, POSITIONS } from './types';

describe('Rng', () => {
  it('is deterministic for a seed and resumable from state', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    const resumed = new Rng(a.getState());
    expect(resumed.next()).toBe(a.next());
    expect(new Rng('abd').next()).not.toBe(new Rng('abc').next());
  });

  it('respects integer bounds', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });
});

describe('league generation', () => {
  const league = createLeague({ seed: 'test-gen' });

  it('creates 32 teams with full, valid 53-man rosters under the cap', () => {
    expect(league.teams).toHaveLength(32);
    for (const team of league.teams) {
      const roster = teamPlayers(league, team.id);
      expect(roster).toHaveLength(53);
      for (const pos of POSITIONS) {
        expect(roster.filter((p) => p.position === pos)).toHaveLength(ROSTER_TEMPLATE[pos]);
        expect(team.depthChart[pos]).toHaveLength(ROSTER_TEMPLATE[pos]);
      }
      expect(payroll(league, team.id)).toBeLessThanOrEqual(SALARY_CAP);
      expect(new Set(roster.map((p) => p.jersey)).size).toBe(53);
    }
  });

  it('uses unique abbreviations and no licensed nicknames', () => {
    expect(new Set(league.teams.map((t) => t.abbrev)).size).toBe(32);
    for (const t of league.teams) expect(RESERVED_NICKNAMES).not.toContain(t.name);
  });

  it('keeps every attribute on the 1–20 scale', () => {
    for (const p of Object.values(league.players)) {
      for (const attr of ATTRIBUTES) {
        expect(p.ratings[attr]).toBeGreaterThanOrEqual(1);
        expect(p.ratings[attr]).toBeLessThanOrEqual(20);
      }
    }
  });

  it('is reproducible from its seed', () => {
    const again = createLeague({ seed: 'test-gen' });
    expect(again.players[100]).toEqual(league.players[100]);
    expect(again.games.map((g) => [g.week, g.homeId, g.awayId])).toEqual(league.games.map((g) => [g.week, g.homeId, g.awayId]));
  });

  it('builds a 17-game, 18-week schedule with one bye per team', () => {
    expect(league.games).toHaveLength(272);
    for (const team of league.teams) {
      const games = league.games.filter((g) => g.homeId === team.id || g.awayId === team.id);
      expect(games).toHaveLength(17);
      const weeks = new Set(games.map((g) => g.week));
      expect(weeks.size).toBe(17);
      const home = games.filter((g) => g.homeId === team.id).length;
      expect(home === 8 || home === 9).toBe(true);
      const rivals = league.teams.filter((t) => t.division === team.division && t.id !== team.id);
      for (const rival of rivals) {
        expect(games.filter((g) => g.homeId === rival.id || g.awayId === rival.id)).toHaveLength(2);
      }
    }
  });
});

describe('game simulation', () => {
  const league = createLeague({ seed: 'test-sim' });
  const game = league.games[0];

  it('is deterministic per game', () => {
    const a = simulateGame(league, game);
    const b = simulateGame(league, game);
    expect(a.homeScore).toBe(b.homeScore);
    expect(a.awayScore).toBe(b.awayScore);
    expect(a.playerStats).toEqual(b.playerStats);
  });

  it('produces internally consistent box scores', () => {
    for (let i = 0; i < 40; i++) {
      const g = league.games[i];
      const r = simulateGame(league, g, { seed: `consistency-${i}` });
      for (const [side, teamId, score] of [
        [r.home, g.homeId, r.homeScore],
        [r.away, g.awayId, r.awayScore],
      ] as const) {
        const lines = Object.entries(r.playerStats)
          .filter(([id]) => league.players[Number(id)].teamId === teamId)
          .map(([, l]) => l);
        const total = (k: keyof (typeof lines)[number]) => lines.reduce((s, l) => s + (l[k] ?? 0), 0);
        expect(total('passCmp')).toBe(side.passCmp);
        expect(total('passAtt')).toBe(side.passAtt);
        expect(total('rec')).toBe(side.passCmp);
        expect(total('passYds')).toBe(total('recYds'));
        expect(total('passYds') - total('sackYds')).toBe(side.passYds);
        expect(total('rushYds')).toBe(side.rushYds);
        expect(side.totalYds).toBe(side.passYds + side.rushYds);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).not.toBe(1);
      }
      const quarterSum = (q: number[]) => q.reduce((a, b) => a + b, 0);
      expect(quarterSum(r.quarters.home)).toBe(r.homeScore);
      expect(quarterSum(r.quarters.away)).toBe(r.awayScore);
    }
  });

  it('never ends a playoff game in a tie', () => {
    for (let i = 0; i < 60; i++) {
      const r = simulateGame(league, league.games[i], { playoff: true, seed: `po-${i}` });
      expect(r.homeScore).not.toBe(r.awayScore);
    }
  });
});

describe('season flow', () => {
  it('plays a full season through the championship and into the next season', () => {
    const league = createLeague({ seed: 'test-season' });
    playWeek(league);
    expect(league.week).toBe(2);
    expect(league.games.filter((g) => g.week === 1).every((g) => g.result)).toBe(true);

    simToEndOfSeason(league);
    expect(league.phase).toBe('complete');
    expect(playoffGames(league)).toHaveLength(13);
    expect(league.history).toHaveLength(1);

    const records = computeRecords(league);
    let wins = 0;
    let losses = 0;
    for (const r of records.values()) {
      expect(r.w + r.l + r.t).toBe(17);
      wins += r.w;
      losses += r.l;
    }
    expect(wins).toBe(losses);

    for (let c = 0; c < 2; c++) {
      const seeds = conferenceSeeds(league, c, records);
      expect(new Set(seeds).size).toBe(7);
      const winners = divisionStandings(league, records)
        .filter((d) => d.division.conference === c)
        .map((d) => d.teams[0].teamId);
      expect(new Set(seeds.slice(0, 4))).toEqual(new Set(winners));
    }

    const champ = league.history[0].championId;
    const final = playoffGames(league, 'FINAL')[0];
    expect([final.homeId, final.awayId]).toContain(champ);
    const starterQb = league.players[league.teams[0].depthChart.QB[0]];
    expect(starterQb.stats[league.season]?.gp).toBeGreaterThan(10);

    startNextSeason(league);
    expect(league.season).toBe(2027);
    expect(league.phase).toBe('regular');
    expect(league.games.filter((g) => g.season === 2027)).toHaveLength(272);
    for (const team of league.teams) expect(teamPlayers(league, team.id).length).toBeGreaterThanOrEqual(53);
  });
});

describe('coach decisions', () => {
  const base: coach.Situation = {
    quarter: 4,
    clock: 100,
    down: 1,
    distance: 10,
    yardLine: 40,
    scoreDiff: 7,
    offTimeouts: 3,
    defTimeouts: 0,
    overtime: false,
    fgMakeProb: 0.2,
  };

  it('kneels out the clock only when the defense cannot stop it', () => {
    expect(coach.shouldKneel(base)).toBe(true);
    expect(coach.shouldKneel({ ...base, defTimeouts: 3 })).toBe(false);
    expect(coach.shouldKneel({ ...base, scoreDiff: -3 })).toBe(false);
    expect(coach.shouldKneel({ ...base, down: 4, clock: 20 })).toBe(false);
  });

  it('chases points when trailing late', () => {
    const rng = new Rng('coach');
    expect(coach.fourthDown({ ...base, scoreDiff: -10, clock: 200, down: 4, distance: 8 }, rng)).toBe('go');
    expect(coach.passProbability({ ...base, scoreDiff: -10, clock: 120 })).toBeGreaterThan(0.8);
  });
});
