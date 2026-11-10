import { afterEach, describe, expect, it } from 'vitest';
import { BENCH, benchKickoff, countStarts, EARN, holdsJob, setJobs } from './benching';
import { createLeague } from './generate';
import { gameTime } from './personnel/calendar';
import { playWeek, startLiveGame } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { setTeam } from './roster';
import type { Injury, League, Player, Team } from './types';

afterEach(() => {
  BENCH.on = true;
});

const hurt = (l: League): Injury => ({
  type: 'hamstring',
  severity: 'moderate',
  weeksRemaining: 6,
  estimate: [4, 8],
  season: l.season,
  week: l.week,
  where: 'game',
});

/** A club with a QB room of three and a league parked in week 1, jobs set from the chart. */
function setup(seed: string): { l: League; team: Team; q: Player[] } {
  const l = createLeague({ seed });
  const team = l.teams[l.userTeamId];
  setJobs(l);
  const q = team.depthChart.QB.map((id) => l.players[id]);
  return { l, team, q };
}

/** One week as the calendar runs it, without playing the games: kickoff noted, then counted, then the next week. */
function week(l: League, team: Team) {
  benchKickoff(l);
  const sat = countStarts(l, team, l.week);
  l.week++;
  return sat;
}

describe('jobs', () => {
  it('come from the chart at the start of the season, a hurt starter keeping his', () => {
    const { l, team, q } = setup('bench-jobs');
    expect(holdsJob(team, q[0].id)).toBe(true);
    expect(holdsJob(team, q[1].id)).toBe(false);
    expect(team.jobs!.held[q[0].id].pos).toBe('QB');
    q[0].injury = hurt(l);
    setJobs(l);
    expect(holdsJob(team, q[0].id)).toBe(true);
    expect(holdsJob(team, q[1].id)).toBe(false);
  });

  it('are cleared at the new league year and set again when the season starts', () => {
    const l = createLeague({ seed: 'bench-year' });
    setJobs(l);
    while (l.phase !== 'complete') playWeek(l);
    expect(l.teams.every((t) => t.jobs)).toBe(true);
    beginOffseason(l);
    expect(l.teams.some((t) => t.jobs || t.kickoff)).toBe(false);
    while ((l.phase as string) !== 'regular') advanceOffseason(l, { autoUser: true });
    expect(l.teams.every((t) => Object.keys(t.jobs?.held ?? {}).length > 0)).toBe(true);
  }, 120_000);

  it('are set the first time a club is noted when the league began in week 1', () => {
    const l = createLeague({ seed: 'bench-lazy' });
    expect(l.teams[0].jobs).toBeUndefined();
    benchKickoff(l);
    expect(Object.keys(l.teams[0].jobs!.held).length).toBeGreaterThan(0);
  });
});

describe('earning a job', () => {
  it('goes to a man on his third straight start, and the longest-sitting holder loses his', () => {
    const { l, team, q } = setup('bench-earn');
    team.depthChart.QB = [q[1].id, q[0].id, ...team.depthChart.QB.slice(2)];
    for (let i = 1; i < EARN; i++) {
      const sat = week(l, team);
      expect(sat.map((s) => s.holder.id)).toEqual([q[0].id]);
      expect(sat[0].other?.id).toBe(q[1].id);
      expect(holdsJob(team, q[1].id)).toBe(false);
      expect(team.jobs!.runs![q[1].id]).toBe(i);
    }
    week(l, team);
    expect(holdsJob(team, q[1].id)).toBe(true);
    expect(holdsJob(team, q[0].id)).toBe(false);
    expect(team.jobs!.runs![q[1].id]).toBeUndefined();
  });

  it('starts over when he sits a game', () => {
    const { l, team, q } = setup('bench-reset');
    team.depthChart.QB = [q[1].id, q[0].id, ...team.depthChart.QB.slice(2)];
    week(l, team);
    week(l, team);
    team.depthChart.QB = [q[0].id, q[1].id, ...team.depthChart.QB.slice(2)];
    week(l, team);
    expect(team.jobs!.runs![q[1].id]).toBeUndefined();
    expect(holdsJob(team, q[0].id)).toBe(true);
  });

  it('never goes to the fill-in for a hurt holder, over six games', () => {
    const { l, team, q } = setup('bench-fill');
    q[0].injury = hurt(l);
    team.depthChart.QB = [q[0].id, q[1].id, ...team.depthChart.QB.slice(2)];
    for (let i = 0; i < 6; i++) expect(week(l, team).map((s) => s.holder.id)).not.toContain(q[0].id);
    expect(holdsJob(team, q[1].id)).toBe(false);
    expect(holdsJob(team, q[0].id)).toBe(true);
    expect(team.jobs!.runs![q[1].id]).toBeUndefined();
  });

  it('reads the holder as he was at kickoff: healing before the count does not make him a sitter', () => {
    const { l, team, q } = setup('bench-heal');
    q[0].injury = hurt(l);
    benchKickoff(l);
    delete q[0].injury;
    expect(countStarts(l, team, l.week)).toEqual([]);
  });
});

describe('sitting', () => {
  it('is not a holder who started and was hurt in the game', () => {
    const { l, team, q } = setup('bench-hurt-in-game');
    benchKickoff(l);
    q[0].injury = hurt(l);
    expect(countStarts(l, team, l.week)).toEqual([]);
  });

  it('is not a holder lined up and starting at another position, and his cover earns nothing', () => {
    const { l, team, q } = setup('bench-elsewhere');
    team.depthChart.QB = [q[1].id, ...team.depthChart.QB.filter((id) => id !== q[1].id && id !== q[0].id)];
    team.depthChart.TE = [q[0].id, ...team.depthChart.TE];
    team.playingAt = { [q[0].id]: { pos: 'TE', by: 'user' } };
    for (let i = 0; i < EARN + 1; i++) {
      const sat = week(l, team);
      expect(sat.map((s) => s.holder.id)).not.toContain(q[0].id);
    }
    expect(team.jobs!.held[q[0].id].pos).toBe('QB');
    expect(holdsJob(team, q[1].id)).toBe(false);
  });

  it('is not a holder who could not play (sat by the doctor, or held out)', () => {
    const { l, team, q } = setup('bench-sat');
    // Sat after an all-clear: a concussion held a week, the doctor's sit.
    q[0].injuries = [
      { type: 'concussion', season: l.season, week: l.week - 1, weeks: 1, held: true },
    ] as unknown as Player['injuries'];
    q[0].injury = { ...hurt(l), type: 'concussion', weeksRemaining: 1, estimate: [1, 1], week: l.week - 1 };
    benchKickoff(l);
    expect(countStarts(l, team, l.week)).toEqual([]);
    l.week++;
    delete q[0].injury;
    q[0].morale = { level: 0, reported: true } as unknown as Player['morale'];
    expect(week(l, team)).toEqual([]);
  });

  it('is a healthy holder left off the lineup, and a bye counts nothing', () => {
    const { l, team, q } = setup('bench-bye');
    team.depthChart.QB = [q[1].id, q[0].id, ...team.depthChart.QB.slice(2)];
    const bye = Array.from({ length: 18 }, (_, i) => i + 1).find(
      (w) =>
        !l.games.some((g) => g.season === l.season && g.week === w && (g.homeId === team.id || g.awayId === team.id)),
    )!;
    l.week = bye;
    benchKickoff(l);
    expect(team.kickoff?.week).not.toBe(bye);
    expect(countStarts(l, team, l.week)).toEqual([]);
    expect(team.jobs!.runs?.[q[1].id]).toBeUndefined();
    l.week = bye === 1 ? 2 : 1;
    expect(week(l, team).map((s) => s.holder.id)).toEqual([q[0].id]);
  });

  it('is nothing for a holder traded away: he holds nothing', () => {
    const { l, team, q } = setup('bench-trade');
    setTeam(l, q[0], (team.id + 1) % l.teams.length);
    benchKickoff(l);
    expect(countStarts(l, team, l.week)).toEqual([]);
    expect(holdsJob(team, q[0].id)).toBe(false);
  });
});

describe('record-keeping only', () => {
  it('leaves every result and every mood as it was over three weeks', () => {
    const run = (on: boolean) => {
      BENCH.on = on;
      const l = createLeague({ seed: 'bench-inert' });
      for (let i = 0; i < 3; i++) playWeek(l);
      return l;
    };
    const a = run(true);
    const b = run(false);
    expect(a.teams[0].jobs).toBeDefined();
    expect(b.teams[0].jobs).toBeUndefined();
    expect(JSON.stringify(a.games.map((g) => g.result))).toBe(JSON.stringify(b.games.map((g) => g.result)));
    const moods = (l: League) => JSON.stringify(Object.values(l.players).map((p) => [p.id, p.morale]));
    expect(moods(a)).toBe(moods(b));
    expect(JSON.stringify(a.rngState)).toBe(JSON.stringify(b.rngState));
  }, 120_000);
});

describe('a live game', () => {
  it("notes the clubs of the week's earlier games before it plays them", () => {
    const l = createLeague({ seed: 'bench-live', personnel: true });
    const games = l.games.filter((g) => g.season === l.season && g.week === l.week);
    const last = Math.max(...games.map(gameTime));
    const live = games.find((g) => gameTime(g) === last)!;
    const early = games.find((g) => gameTime(g) < last)!;
    startLiveGame(l, live);
    expect(early.result).toBeDefined();
    expect(l.teams[early.homeId].kickoff?.week).toBe(l.week);
    expect(l.teams[early.awayId].kickoff?.week).toBe(l.week);
  }, 120_000);
});
