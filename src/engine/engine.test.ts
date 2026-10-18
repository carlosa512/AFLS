import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague, SALARY_CAP } from './generate';
import { playWeek, simToEndOfSeason, startNextSeason } from './league';
import * as coach from './match/coach';
import { simulateGame, startGame } from './match/gameSim';
import { ROSTER_TEMPLATE } from './positions';
import { Rng } from './rng';
import { capSheet } from './finance/cap';
import { isExpired } from './finance/contract';
import { activeRoster, teamPlayers } from './roster';
import { playoffGames } from './season/playoffs';
import { computeRecords, conferenceSeeds, divisionStandings, sortTeams } from './season/standings';
import { ATTRIBUTES, POSITIONS, type GameResult } from './types';

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
      expect(capSheet(league, team.id).used).toBeLessThanOrEqual(SALARY_CAP);
      for (const p of roster) expect(isExpired(p.contract!, league.season)).toBe(false);
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

  it('plays the identical game when advanced one play at a time', () => {
    for (let i = 0; i < 5; i++) {
      const g = league.games[i];
      const whole = simulateGame(league, g, { keepPlays: true });
      const live = startGame(league, g);
      const seen = [];
      while (!live.over) {
        const batch = live.next();
        if (!live.over) expect(batch.length).toBeGreaterThan(0);
        seen.push(...batch);
      }
      const stepped = live.result();
      expect([stepped.homeScore, stepped.awayScore]).toEqual([whole.homeScore, whole.awayScore]);
      expect(seen).toEqual(whole.plays);
      expect(stepped.playerStats).toEqual(whole.playerStats);
    }
  });

  it('never ends a playoff game in a tie', () => {
    for (let i = 0; i < 60; i++) {
      const r = simulateGame(league, league.games[i], { playoff: true, seed: `po-${i}` });
      expect(r.homeScore).not.toBe(r.awayScore);
    }
  });
});

describe('end-of-game rules (regressions)', () => {
  const league = createLeague({ seed: 'test-rules' });
  const results = Array.from({ length: 800 }, (_, i) => {
    const game = league.games[i % league.games.length];
    return { game, r: simulateGame(league, game, { keepPlays: true, seed: `rules-${i}` }) };
  });

  it('lets a trailing overtime scorer attempt the try, and never punts away the last OT possession', () => {
    const ot = results.filter(({ r }) => r.overtime);
    expect(ot.length).toBeGreaterThan(20);
    for (const { game, r } of ot) {
      const plays = r.plays!;
      const last = plays[plays.length - 1];
      const prev = plays[plays.length - 2];
      // A game may end on a touchdown only if the scorer is then ahead.
      if (last.homeScore - prev.homeScore === 6) expect(last.homeScore).toBeGreaterThan(last.awayScore);
      if (last.awayScore - prev.awayScore === 6) expect(last.awayScore).toBeGreaterThan(last.homeScore);
      // A trailing team never ends overtime by punting with time left.
      if (/punts/.test(last.text) && last.clock > 10) {
        const puntingIsHome = last.offense === game.homeId;
        const puntingScore = puntingIsHome ? last.homeScore : last.awayScore;
        const otherScore = puntingIsHome ? last.awayScore : last.homeScore;
        expect(puntingScore).toBeGreaterThanOrEqual(otherScore);
      }
    }
  });

  it('never gives up a safety or the ball on a kneel-down', () => {
    for (const { r } of results) {
      const plays = r.plays!;
      plays.forEach((p, i) => {
        if (!/kneels/.test(p.text)) return;
        const next = plays[i + 1];
        if (next) {
          expect(next.text).not.toMatch(/SAFETY/);
          expect(next.text).not.toMatch(/Turnover on downs/);
        }
      });
    }
  });

  it('never lets a trailing offense end regulation on an ordinary run', () => {
    for (const { game, r } of results) {
      const plays = r.plays!;
      const snaps = plays.filter((p) => p.down && p.quarter === 4);
      const last = snaps[snaps.length - 1];
      if (!last || plays.some((p) => p.quarter >= 5)) continue;
      const i = plays.indexOf(last);
      const before = plays[i - 1];
      const diff = last.offense === game.homeId ? before.homeScore - before.awayScore : before.awayScore - before.homeScore;
      if (diff < 0) expect(last.kind).not.toBe('run');
    }
  });

  it('only spikes on early downs and never kneels away the fourth quarter while trailing', () => {
    for (const { game, r } of results) {
      r.plays!.forEach((p, i) => {
        if (p.kind === 'spike') expect(p.down).toBeLessThan(4);
        if (p.kind !== 'kneel' || p.quarter < 4) return;
        const before = r.plays![i - 1];
        const diff = p.offense === game.homeId ? before.homeScore - before.awayScore : before.awayScore - before.homeScore;
        expect(diff).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('keeps red-zone touchdowns within red-zone trips and logs both two-minute warnings', () => {
    for (const { r } of results) {
      for (const t of [r.home, r.away]) expect(t.redZoneTd).toBeLessThanOrEqual(t.redZoneAtt);
      const warnings = r.plays!.filter((p) => p.text === 'Two-minute warning.');
      expect(warnings.map((w) => w.quarter)).toEqual([2, 4]);
    }
  });
});

describe('tiebreakers (regressions)', () => {
  it('skips head-to-head unless every tied team played every other one', () => {
    const league = createLeague({ seed: 'test-tiebreak' });
    const game = (id: number, homeId: number, awayId: number, hs: number, as: number) => ({
      id,
      season: league.season,
      week: id,
      homeId,
      awayId,
      result: { homeScore: hs, awayScore: as } as GameResult,
    });
    // A (0), B (4), C (8) are conference-0 teams in different divisions, all 1-1.
    // Only A and B met (A won). C has the best conference record (1-0).
    league.games = [game(1, 0, 4, 21, 14), game(2, 12, 0, 24, 10), game(3, 4, 16, 17, 3), game(4, 8, 13, 20, 13), game(5, 20, 8, 27, 20)];
    expect(sortTeams(league, [0, 4, 8], computeRecords(league))).toEqual([8, 0, 4]);
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
    for (const team of league.teams) {
      // Injured reserve doesn't count toward the 53.
      const roster = activeRoster(league, team.id);
      expect(roster.length).toBeLessThanOrEqual(53);
      for (const pos of POSITIONS) expect(roster.filter((p) => p.position === pos).length).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);
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

  it('kills the clock on fourth down instead of punting it back', () => {
    expect(coach.shouldKneel({ ...base, down: 4, clock: 7 })).toBe(true);
    expect(coach.shouldKneel({ ...base, down: 4, clock: 20 })).toBe(false);
    // Up three scores the defense won't burn timeouts, so the leader can kneel through them.
    expect(coach.shouldKneel({ ...base, defTimeouts: 3, scoreDiff: 21 })).toBe(true);
  });

  it('runs the end-of-game field-goal script', () => {
    const inRange = { ...base, scoreDiff: -2, yardLine: 75, fgMakeProb: 0.92, clock: 40 };
    expect(coach.playForFieldGoal(inRange)).toBe(true);
    expect(coach.tempo(inRange)).toBe('milk');
    expect(coach.offenseTimeout(inRange)).toBe(false);
    expect(coach.kickNow({ ...inRange, clock: 4 })).toBe(true);
    // Seven seconds and a timeout left from 52 yards: a deep shot can take all seven, so kick.
    expect(coach.kickNow({ ...inRange, fgMakeProb: 0.55, offTimeouts: 1, clock: 7 })).toBe(true);
    // Out of timeouts with the clock stopped: kick now rather than risk an in-bounds snap.
    expect(coach.kickNow({ ...inRange, fgMakeProb: 0.6, offTimeouts: 0, clock: 18 })).toBe(true);
    expect(coach.kickNow({ ...inRange, scoreDiff: -4, clock: 4 })).toBe(false);
  });

  it('spikes only in a two-minute drill without timeouts', () => {
    const drill = { ...base, scoreDiff: -4, yardLine: 60, offTimeouts: 0, clock: 25, down: 1 };
    expect(coach.shouldSpike(drill)).toBe(true);
    expect(coach.shouldSpike({ ...drill, offTimeouts: 1 })).toBe(false);
    expect(coach.shouldSpike({ ...drill, down: 4 })).toBe(false);
    expect(coach.shouldSpike({ ...drill, scoreDiff: 3 })).toBe(false);
    expect(coach.passProbability({ ...drill, down: 2, distance: 3 })).toBe(1);
  });

  it('kicks deep when the defense can still get the ball back', () => {
    expect(coach.shouldOnside(-2, 4, 124, 3)).toBe(false);
    expect(coach.shouldOnside(-2, 4, 100, 0)).toBe(true);
    expect(coach.shouldOnside(-10, 4, 200, 3)).toBe(true);
  });

  it('chases points when trailing late', () => {
    const rng = new Rng('coach');
    expect(coach.fourthDown({ ...base, scoreDiff: -10, clock: 200, down: 4, distance: 8 }, rng)).toBe('go');
    expect(coach.passProbability({ ...base, scoreDiff: -10, clock: 120 })).toBeGreaterThan(0.8);
  });
});
