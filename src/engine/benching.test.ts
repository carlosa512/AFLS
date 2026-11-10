import { afterEach, describe, expect, it } from 'vitest';
import {
  answerBench,
  BENCH,
  BENCH_SIZE,
  benchKickoff,
  countStarts,
  EARN,
  holdsJob,
  movedBy,
  questionOf,
  setJobs,
} from './benching';
import { createLeague } from './generate';
import { gameTime } from './personnel/calendar';
import { playWeek, startLiveGame } from './league';
import { moraleAdvance, moraleClock } from './morale';
import { advanceOffseason, beginOffseason } from './offseason';
import { answerTalk } from './playerTalks';
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

describe('draws nothing', () => {
  it("leaves the first week's results and the league's stream as they were; only moods move", () => {
    const run = (on: boolean) => {
      BENCH.on = on;
      const l = createLeague({ seed: 'bench-inert' });
      playWeek(l);
      return l;
    };
    const a = run(true);
    const b = run(false);
    expect(a.teams[0].jobs).toBeDefined();
    expect(b.teams[0].jobs).toBeUndefined();
    expect(JSON.stringify(a.games.map((g) => g.result))).toBe(JSON.stringify(b.games.map((g) => g.result)));
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

// ───────── the ask, the answers and how he takes them ─────────

/** One week as the calendar runs it, games aside: kickoff noted, the morale step (benchings, talks), the next week. */
function moodWeek(l: League): number {
  benchKickoff(l);
  const clock = moraleClock(l, true);
  moraleAdvance(l, clock);
  l.week++;
  return clock;
}
const jolts = (p: Player, kind: string, at?: number) =>
  (p.morale?.jolts ?? []).filter((j) => j.kind === kind && (at === undefined || j.at === at));
const unsure = (p: Player) => jolts(p, 'unsure').length;
const lift = (p: Player) => jolts(p, 'settled').reduce((t, j) => t + j.size, 0);
const order = (team: Team, ids: number[]) => {
  team.depthChart.QB = [...ids, ...team.depthChart.QB.filter((id) => !ids.includes(id))];
};

describe('the ask', () => {
  it('a healthy job-holder who sits asks the same step, naming who started', () => {
    const { l, team, q } = setup('bench-ask');
    order(team, [q[1].id, q[0].id]);
    const clock = moodWeek(l);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at: clock });
    expect(questionOf(team, q[0].id)!.other).toBe(q[1].id);
    expect(jolts(q[0], 'benched', clock).map((j) => j.size)).toEqual([BENCH_SIZE.sit]);
  });

  it('a hurt man never asks; a fill-in stepping back never asks', () => {
    const { l, team, q } = setup('bench-hurt-ask');
    q[0].injury = hurt(l);
    moodWeek(l);
    expect(q[0].morale!.talk?.ask).toBeUndefined();
    expect(questionOf(team, q[0].id)).toBeUndefined();
    delete q[0].injury;
    order(team, [q[0].id, q[1].id]);
    moodWeek(l);
    expect(q[1].morale!.talk?.ask).toBeUndefined();
    expect(questionOf(team, q[1].id)).toBeUndefined();
  });

  it('two holders sitting the same step: the talks still hear two asks a club', () => {
    const { l, team, q } = setup('bench-two');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    const asks = Object.values(l.players).filter((p) => p.teamId === team.id && p.morale?.talk?.ask);
    expect(asks.length).toBeLessThanOrEqual(2);
  });
});

describe('your answers', () => {
  it('"back in next week" is kept by his next start and broken by his next healthy sit', () => {
    const kept = setup('bench-kept');
    order(kept.team, [kept.q[1].id, kept.q[0].id]);
    moodWeek(kept.l);
    expect(answerBench(kept.l, kept.q[0].id, 'backIn')).toBe(true);
    expect(questionOf(kept.team, kept.q[0].id)!.promise?.to).toBe(kept.q[0].id);
    order(kept.team, [kept.q[0].id, kept.q[1].id]);
    const at = moodWeek(kept.l);
    expect(jolts(kept.q[0], 'kept', at).map((j) => j.size)).toEqual([BENCH_SIZE.kept]);
    expect(questionOf(kept.team, kept.q[0].id)).toBeUndefined();

    const broke = setup('bench-broke');
    order(broke.team, [broke.q[1].id, broke.q[0].id]);
    moodWeek(broke.l);
    // The talks' own answer reaches the same place until the letter has its own row.
    expect(answerTalk(broke.l, broke.q[0].id, 'promise')).toBe(true);
    const when = moodWeek(broke.l);
    expect(jolts(broke.q[0], 'broken', when).map((j) => j.size)).toEqual([BENCH_SIZE.broken]);
    expect(broke.q[0].morale!.talk!.broken).toBe(1);
    expect(broke.q[0].morale!.talk!.sour).toBeDefined();
    expect(questionOf(broke.team, broke.q[0].id)!.answered).toBeUndefined();
  });

  it('a promise waits while he is hurt', () => {
    const { l, team, q } = setup('bench-wait');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    answerBench(l, q[0].id, 'backIn');
    q[0].injury = hurt(l);
    moodWeek(l);
    moodWeek(l);
    expect(jolts(q[0], 'broken')).toEqual([]);
    expect(questionOf(team, q[0].id)!.promise).toBeDefined();
    delete q[0].injury;
    order(team, [q[0].id, q[1].id]);
    const at = moodWeek(l);
    expect(jolts(q[0], 'kept', at)).toHaveLength(1);
  });

  it('unanswered, he is unsure each week he sits, and no "ignored" lands', () => {
    const { l, team, q } = setup('bench-unsure');
    order(team, [q[1].id, q[0].id]);
    const asked = moodWeek(l);
    expect(unsure(q[0])).toBe(0);
    moodWeek(l);
    expect(unsure(q[0])).toBe(1);
    // A third man starts: both of them sat, and the question is still open.
    order(team, [q[2].id, q[0].id, q[1].id]);
    moodWeek(l);
    expect(unsure(q[0])).toBe(2);
    expect(jolts(q[0], 'ignored')).toEqual([]);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at: asked });
  });

  it('swap them back and the other man is unsure and asks', () => {
    const { l, team, q } = setup('bench-swap');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    order(team, [q[0].id, q[1].id]);
    const at = moodWeek(l);
    expect(unsure(q[1])).toBe(1);
    expect(unsure(q[0])).toBe(0);
    expect(q[1].morale!.talk!.ask).toEqual({ cause: 'benched', at });
    expect(questionOf(team, q[1].id)!.asked).toEqual([q[0].id, q[1].id]);
  });

  it('one answer to either man clears both and lifts both the same', () => {
    const { l, team, q } = setup('bench-both');
    const [a, b] = q;
    order(team, [b.id, a.id]);
    moodWeek(l);
    moodWeek(l);
    order(team, [a.id, b.id]);
    moodWeek(l);
    expect(unsure(a)).toBe(1);
    expect(unsure(b)).toBe(1);
    expect(answerBench(l, b.id, 'backIn')).toBe(false); // not one of his answers
    expect(answerBench(l, b.id, 'compete')).toBe(true);
    expect(unsure(a)).toBe(0);
    expect(unsure(b)).toBe(0);
    expect(lift(a)).toBe(lift(b));
    expect(lift(a)).toBe(BENCH_SIZE.settled);
    expect(a.morale!.talk!.ask).toBeUndefined();
    expect(b.morale!.talk!.ask).toBeUndefined();
    // Answered once is answered: neither row takes a second.
    expect(answerBench(l, a.id, 'earn')).toBe(false);
  });

  it('three straight starts with no word settles it by the chart', () => {
    const { l, team, q } = setup('bench-chart');
    order(team, [q[1].id, q[0].id]);
    let at = 0;
    for (let i = 0; i < EARN; i++) at = moodWeek(l);
    expect(holdsJob(team, q[1].id)).toBe(true);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(jolts(q[0], 'benched', at).map((j) => j.size)).toEqual([BENCH_SIZE.chart]);
    expect(unsure(q[0])).toBe(0);
    expect(q[0].morale!.talk!.sour).toBeDefined();
    expect(q[0].morale!.talk!.ask?.cause).not.toBe('benched');
  });

  it('an AI club answers at once and nobody there is ever unsure', () => {
    const { l } = setup('bench-ai');
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const q = team.depthChart.QB.map((id) => l.players[id]);
    order(team, [q[1].id, q[0].id]);
    const at = moodWeek(l);
    expect(q[0].morale!.talk?.ask).toBeUndefined();
    expect(q[0].morale!.talk!.answered).toMatchObject({ at, ask: at, cause: 'benched' });
    for (let i = 0; i < 4; i++) moodWeek(l);
    for (const p of Object.values(l.players)) if (p.teamId === team.id) expect(unsure(p)).toBe(0);
  });

  it('"his job now" costs half when the new man is plainly better, more for a volatile man', () => {
    const cost = (seed: string, better: boolean, temper: number) => {
      const { l, team, q } = setup(seed);
      q[0].traits.temperament = temper;
      delete q[0].shifts;
      q[0].experience = 4;
      // The better man of the two by every rating: he knows who is ahead of him, or knows nobody is.
      for (const k of Object.keys(q[1].ratings) as (keyof Player['ratings'])[]) q[better ? 1 : 0].ratings[k] = 20;
      order(team, [q[1].id, q[0].id]);
      const at = moodWeek(l);
      answerBench(l, q[0].id, 'his');
      expect(holdsJob(team, q[1].id)).toBe(true);
      expect(holdsJob(team, q[0].id)).toBe(false);
      return jolts(q[0], 'benched', at).reduce((t, j) => t + j.size, 0) - BENCH_SIZE.sit;
    };
    const even = cost('bench-his', false, 10.5);
    expect(even).toBeCloseTo(BENCH_SIZE.his);
    expect(cost('bench-his', true, 10.5)).toBeCloseTo(BENCH_SIZE.his / 2);
    expect(cost('bench-his', false, 20)).toBeCloseTo(BENCH_SIZE.his * 1.5);
    expect(cost('bench-his', false, 1)).toBeCloseTo(BENCH_SIZE.his * 0.5);
  });

  it('with your staff sorting the chart he still asks, and the move is the staff’s', () => {
    const { l, team, q } = setup('bench-staff');
    team.autoDepth = true;
    order(team, [q[1].id, q[0].id]);
    const at = moodWeek(l);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at });
    expect(movedBy(team)).toBe('staff');
    team.autoDepth = false;
    expect(movedBy(team)).toBe('you');
  });
});
