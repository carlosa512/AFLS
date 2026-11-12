import { afterEach, describe, expect, it } from 'vitest';
import {
  answerBench,
  benchCard,
  benchFact,
  BENCH,
  BENCH_SIZE,
  benchKickoff,
  benchWeek,
  clearedNotStarting,
  confirmLineup,
  countStarts,
  dismissReminder,
  EARN,
  endJobs,
  holdsJob,
  lineupProblem,
  movedBy,
  putBack,
  restoreCard,
  questionOf,
  setJobs,
} from './benching';
import { releaseCoach, hireCoach, teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { talkCard } from './talkMail';
import { PER_CLUB } from './talkBasics';
import { roomCoach, headCoach } from './senders';
import { openStory, untold, COACH } from './stories';
import { gameTime } from './personnel/calendar';
import { benchCloseFact } from './benching';
import { BENCH_CLOSE } from './benchVoice';
import { say } from './voice';
import { beat } from './stories';
import { releasePlayer } from './finance/cap';
import { playWeek, startLiveGame } from './league';
import { ensureWaivers, setWaiverClaim } from './personnel/waivers';
import { initialService } from './personnel/service';
import { STARTERS } from './positions';
import { addJolt, heardWeight, moraleAdvance, moraleClock, moraleContext } from './morale';
import { advanceOffseason, beginOffseason } from './offseason';
import { answerRoomTalk, answerTalk } from './playerTalks';
import { addPlayer, setTeam } from './roster';
import { perceive } from './scouting';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { conferenceSeeds } from './season/standings';
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
    // The talks' own answers never reach a benched ask: it has its own row and its own four.
    expect(answerTalk(broke.l, broke.q[0].id, 'promise')).toBe(false);
    expect(broke.q[0].morale!.talk!.ask?.cause).toBe('benched');
    expect(answerBench(broke.l, broke.q[0].id, 'backIn')).toBe(true);
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

describe('fix round 1', () => {
  it('a rival traded away after a swap-back leaves no benched ask on the man who stays', () => {
    const { l, team, q } = setup('bench-gone');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    order(team, [q[0].id, q[1].id]);
    moodWeek(l);
    expect(q[1].morale!.talk!.ask?.cause).toBe('benched');
    setTeam(l, q[0], (team.id + 1) % l.teams.length);
    moodWeek(l);
    expect(questionOf(team, q[1].id)).toBeUndefined();
    expect(q[1].morale!.talk?.ask?.cause).not.toBe('benched');
  });

  it('a benched answer eases nothing but its own jolts', () => {
    const { l, q } = setup('bench-heard');
    const at = l.moraleAt!;
    q[0].morale!.talk = { club: q[0].teamId!, answered: { reply: 'reassure', at, ask: at, cause: 'benched' } };
    expect(heardWeight(q[0], 'role', at)).toBe(1);
    q[0].morale!.talk.answered!.cause = 'snaps';
    expect(heardWeight(q[0], 'role', at)).toBeLessThan(1);
  });

  it('a broken word files his ask again, and the row can be answered again', () => {
    const { l, team, q } = setup('bench-reask');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    answerBench(l, q[0].id, 'thisWeek');
    const when = moodWeek(l);
    expect(questionOf(team, q[0].id)!.answered).toBeUndefined();
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at: when });
    expect(answerBench(l, q[0].id, 'earn')).toBe(true);
  });

  it('an AI club answers again at once when its word breaks', () => {
    const { l } = setup('bench-ai-reask');
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    team.gm = { ...team.gm, loyalty: 1, stubbornness: 0 };
    const q = team.depthChart.QB.map((id) => l.players[id]);
    q[0].experience = 8;
    for (const k of Object.keys(q[0].ratings) as (keyof Player['ratings'])[]) q[0].ratings[k] = 20;
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    expect(questionOf(team, q[0].id)!.answered?.reply).toBe('backIn');
    const when = moodWeek(l);
    expect(jolts(q[0], 'broken', when)).toHaveLength(1);
    expect(questionOf(team, q[0].id)!.answered).toMatchObject({ reply: 'backIn', at: when });
  });

  it('the holder winning it back by the chart costs the other man nothing', () => {
    const { l, team, q } = setup('bench-back');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    order(team, [q[0].id, q[1].id]);
    let at = 0;
    for (let i = 0; i < EARN; i++) at = moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(holdsJob(team, q[0].id)).toBe(true);
    expect(jolts(q[1], 'benched', at)).toEqual([]);
    expect(q[1].morale!.talk?.sour).toBeUndefined();
    expect(unsure(q[1])).toBe(0);
    expect(unsure(q[0])).toBe(0);
    expect(q[1].morale!.talk?.ask?.cause).not.toBe('benched');
  });

  it('a benching never resets an escalation already running', () => {
    const { l, team, q } = setup('bench-run');
    order(team, [q[1].id, q[0].id]);
    for (let i = 1; i < EARN; i++) moodWeek(l);
    // The third start settles it by the chart; read straight after the benching, before the disputes' own step.
    q[0].morale!.talk = { club: team.id, sour: { cause: 'deal', at: 0, run: 3, after: 'holdIn' } };
    benchKickoff(l);
    benchWeek(l, moraleContext(l), moraleClock(l, true));
    expect(holdsJob(team, q[1].id)).toBe(true);
    expect(q[0].morale!.talk!.sour).toMatchObject({ cause: 'snaps', run: 3, after: 'holdIn' });
  });

  it('a holder held back by the two asks a step asks the next step, sitting or not', () => {
    const { l, team, q } = setup('bench-held');
    const clock = moraleClock(l, true);
    const others = Object.values(l.players).filter((p) => p.teamId === team.id && p.position !== 'QB' && p.morale);
    for (const p of others.slice(0, 2)) p.morale!.talk = { club: team.id, ask: { cause: 'deal', at: clock } };
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    expect(q[0].morale!.talk?.ask).toBeUndefined();
    expect(questionOf(team, q[0].id)).toBeDefined();
    order(team, [q[0].id, q[1].id]);
    const at = moodWeek(l);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at });
  });

  it('"his" from the other man\'s row leaves the holder\'s job as he held it', () => {
    const { l, team, q } = setup('bench-his-other');
    const since = team.jobs!.held[q[0].id].since;
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    order(team, [q[0].id, q[1].id]);
    moodWeek(l);
    expect(answerBench(l, q[1].id, 'his')).toBe(true);
    expect(team.jobs!.held[q[0].id].since).toBe(since);
    expect(holdsJob(team, q[1].id)).toBe(false);
  });

  it('benchWeek draws nothing, week after week', () => {
    const { l, team, q } = setup('bench-rng');
    for (let i = 0; i < 4; i++) {
      order(team, i % 2 ? [q[0].id, q[1].id] : [q[1].id, q[0].id]);
      benchKickoff(l);
      const clock = moraleClock(l, true);
      const ctx = moraleContext(l);
      const before = JSON.stringify(l.rngState);
      benchWeek(l, ctx, clock);
      expect(JSON.stringify(l.rngState)).toBe(before);
      l.moraleAt = clock;
      l.week++;
    }
    expect(questionOf(team, q[0].id)).toBeDefined();
  });

  it('pauses while either man is hurt: nobody unsure, no start counted', () => {
    const { l, team, q } = setup('bench-pause');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    expect(team.jobs!.runs![q[1].id]).toBe(1);
    // The holder hurt: the other man’s start counts for nothing.
    q[0].injury = hurt(l);
    moodWeek(l);
    expect(questionOf(team, q[0].id)!.paused).toBe(true);
    expect(team.jobs!.runs![q[1].id]).toBe(1);
    delete q[0].injury;
    // The other man hurt and a third man starting: the holder sat, but isn't unsure, and the run waits.
    q[1].injury = hurt(l);
    order(team, [q[2].id, q[0].id, q[1].id]);
    moodWeek(l);
    expect(questionOf(team, q[0].id)!.paused).toBe(true);
    expect(unsure(q[0])).toBe(0);
    expect(team.jobs!.runs![q[1].id]).toBe(1);
  });

  it('a bye and a club whose season is over do nothing', () => {
    const { l, team, q } = setup('bench-idle');
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    const was = JSON.stringify(team.jobs);
    const bye = Array.from({ length: 17 }, (_, i) => i + 2).find(
      (w) =>
        !l.games.some((g) => g.season === l.season && g.week === w && (g.homeId === team.id || g.awayId === team.id)),
    )!;
    l.week = bye;
    l.moraleAt = moraleClock(l);
    moodWeek(l);
    expect(JSON.stringify(team.jobs)).toBe(was);
    expect(unsure(q[0])).toBe(0);
    // The playoffs without them: no game, nothing counts.
    l.phase = 'playoffs';
    l.week = 19;
    moodWeek(l);
    expect(JSON.stringify(team.jobs)).toBe(was);
    expect(unsure(q[0])).toBe(0);
  });

  it("a benched ask is never answered by the losing's answers", () => {
    const { l, team, q } = setup('bench-losing');
    order(team, [q[1].id, q[0].id]);
    const asked = moodWeek(l);
    expect(answerRoomTalk(l, 'team', 'firm')).toBe(0);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at: asked });
    team.losingAnswer = { team: { reply: 'firm', at: asked } };
    moodWeek(l);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at: asked });
  });
});

// ───────── when things change mid-story (spec section 5) ─────────

/** A club's benched story for a man, open or closed. */
const storyOf = (l: League, id: number) =>
  [...l.stories!.open, ...l.stories!.closed].find((s) => s.kind === 'benched' && s.playerId === id);
/** Out for the rest of the season, however far into it we are. */
const lost = (l: League): Injury => ({ ...hurt(l), weeksRemaining: 40, estimate: [30, 50] });
/** Opens the question: the holder sits, the other man starts, and the holder has asked. */
function sitHolder(seed: string) {
  const s = setup(seed);
  order(s.team, [s.q[1].id, s.q[0].id]);
  moodWeek(s.l);
  return s;
}
const exits: [string, (l: League, p: Player) => void][] = [
  ['is cut', (l, p) => setTeam(l, p, null)],
  ['is traded or claimed', (l, p) => setTeam(l, p, (l.userTeamId + 1) % l.teams.length)],
  ['retires', (_l, p) => void (p.retired = true)],
];

describe("the club's last game of the year", () => {
  /** A user's club that misses the playoffs on the standings as they are, parked at the regular season's last week. */
  function lastWeek(seed: string) {
    const probe = createLeague({ seed });
    const seeded = new Set(probe.conferences.flatMap((_, c) => conferenceSeeds(probe, c)));
    const out = probe.teams.find((t) => !seeded.has(t.id))!.id;
    const l = createLeague({ seed, userTeamId: out });
    const team = l.teams[out];
    expect(l.conferences.flatMap((_, c) => conferenceSeeds(l, c))).not.toContain(out);
    setJobs(l);
    l.week = REGULAR_SEASON_WEEKS;
    return { l, team, q: team.depthChart.QB.map((id) => l.players[id]) };
  }

  it('opens no question and files no ask when a holder sits it out with no game left', () => {
    const { l, team, q } = lastWeek('last-game');
    order(team, [q[1].id, q[0].id]);
    const clock = moodWeek(l);
    expect(team.jobs?.questions ?? []).toHaveLength(0);
    expect(q[0].morale?.talk?.ask).toBeUndefined();
    expect(jolts(q[0], 'benched', clock)).toHaveLength(0);
  });

  it('closes an open question with nothing said, and still asks a week earlier', () => {
    const { l, team, q } = lastWeek('last-game-open');
    l.week = REGULAR_SEASON_WEEKS - 1;
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    expect(team.jobs!.questions).toHaveLength(1);
    expect(q[0].morale?.talk?.ask?.cause).toBe('benched');
    moodWeek(l);
    expect(team.jobs?.questions ?? []).toHaveLength(0);
    expect(q[0].morale?.talk?.ask).toBeUndefined();
    expect(unsure(q[0])).toBe(0);
  });
});

describe('mid-story: injuries', () => {
  it('a job-holder on injured reserve keeps his job and his cover never earns it', () => {
    const { l, team, q } = setup('mid-ir');
    q[0].injury = hurt(l);
    q[0].ir = { season: l.season, week: l.week, weeks: 0 };
    setJobs(l);
    for (let i = 0; i < EARN + 1; i++) moodWeek(l);
    expect(holdsJob(team, q[0].id)).toBe(true);
    expect(holdsJob(team, q[1].id)).toBe(false);
    expect(questionOf(team, q[0].id)).toBeUndefined();
  });

  it('a man waiting on your answer gets hurt: his ask stays open and he is not unsure', () => {
    const { l, team, q } = sitHolder('mid-ask-hurt');
    const ask = q[0].morale!.talk!.ask;
    expect(ask?.cause).toBe('benched');
    q[0].injury = hurt(l);
    moodWeek(l);
    moodWeek(l);
    expect(q[0].morale!.talk!.ask).toEqual(ask);
    expect(questionOf(team, q[0].id)!.paused).toBe(true);
    expect(unsure(q[0])).toBe(0);
    expect(unsure(q[1])).toBe(0);
  });

  it('a paused question resumes when both can play: the run goes on from where it was', () => {
    const { l, team, q } = sitHolder('mid-resume');
    expect(team.jobs!.runs![q[1].id]).toBe(1);
    q[0].injury = hurt(l);
    moodWeek(l);
    expect(team.jobs!.runs![q[1].id]).toBe(1);
    delete q[0].injury;
    moodWeek(l);
    expect(questionOf(team, q[0].id)!.paused).toBeUndefined();
    expect(team.jobs!.runs![q[1].id]).toBe(2);
    expect(unsure(q[0])).toBe(1);
  });

  it('one of them out for the rest of the season closes the question with no hit: the job is the other man’s', () => {
    // The other man out: the holder keeps it.
    const a = sitHolder('mid-out-other');
    a.q[1].injury = lost(a.l);
    const before = jolts(a.q[0], 'benched').reduce((t, j) => t + j.size, 0);
    moodWeek(a.l);
    expect(questionOf(a.team, a.q[0].id)).toBeUndefined();
    expect(holdsJob(a.team, a.q[0].id)).toBe(true);
    expect(holdsJob(a.team, a.q[1].id)).toBe(false);
    expect(jolts(a.q[0], 'benched').reduce((t, j) => t + j.size, 0)).toBe(before);
    expect(unsure(a.q[0])).toBe(0);
    expect(lift(a.q[0])).toBe(0);
    expect(a.q[0].morale!.talk?.ask?.cause).not.toBe('benched');
    expect(storyOf(a.l, a.q[0].id)!.beats.at(-1)).toMatchObject({ kind: 'settled', how: 'outOther' });
    expect(storyOf(a.l, a.q[0].id)!.closed).toBeDefined();
    // The holder out: the job is the other man’s until the new league year.
    const b = sitHolder('mid-out-holder');
    b.q[0].injury = lost(b.l);
    moodWeek(b.l);
    expect(questionOf(b.team, b.q[0].id)).toBeUndefined();
    expect(holdsJob(b.team, b.q[1].id)).toBe(true);
    expect(holdsJob(b.team, b.q[0].id)).toBe(false);
    expect(unsure(b.q[1])).toBe(0);
    expect(lift(b.q[1])).toBe(0);
    expect(storyOf(b.l, b.q[0].id)!.beats.at(-1)).toMatchObject({ kind: 'settled', how: 'outHolder' });
  });

  it('a one-week injury in the last regular week does not close the question of a club still alive', () => {
    const { l, team, q } = sitHolder('mid-late-alive');
    l.week = 17;
    q[1].injury = { ...hurt(l), weeksRemaining: 2, estimate: [1, 3] };
    // Nobody in the league has played: every club is still in the race.
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeDefined();
    expect(questionOf(team, q[0].id)!.paused).toBe(true);
    expect(storyOf(l, q[0].id)!.closed).toBeUndefined();
  });

  it('the same injury closes it in the playoffs when no game is left to play', () => {
    const { l, team, q } = sitHolder('mid-late-playoffs');
    l.phase = 'playoffs';
    l.week = 21;
    q[1].injury = { ...hurt(l), weeksRemaining: 6, estimate: [4, 8] };
    // A game on the books keeps the club playing; the injury outlasts the playoffs' last week.
    const g = l.games.find((x) => x.season === l.season && (x.homeId === team.id || x.awayId === team.id))!;
    l.games.push({ ...g, week: 21, result: undefined });
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(storyOf(l, q[0].id)!.beats.at(-1)).toMatchObject({ kind: 'settled', how: 'outOther' });
  });

  it('a long layoff that ends before the season does is only a pause', () => {
    const { l, team, q } = sitHolder('mid-pause-only');
    q[1].injury = { ...hurt(l), weeksRemaining: 3 };
    moodWeek(l);
    expect(questionOf(team, q[0].id)!.paused).toBe(true);
    expect(storyOf(l, q[0].id)!.closed).toBeUndefined();
  });

  it('"back in next week" and the other man gets hurt: he starts as promised, and it is kept', () => {
    const { l, team, q } = sitHolder('mid-promise-other');
    expect(answerBench(l, q[0].id, 'backIn')).toBe(true);
    q[1].injury = hurt(l);
    const at = moodWeek(l);
    expect(jolts(q[0], 'kept', at)).toHaveLength(1);
    expect(jolts(q[0], 'broken')).toEqual([]);
    expect(questionOf(team, q[0].id)).toBeUndefined();
  });

  it('the doctor’s sit is not a benching and the week counts for nobody', () => {
    const { l, team, q } = setup('mid-doctor');
    q[0].injuries = [
      { type: 'concussion', season: l.season, week: l.week - 1, weeks: 1, held: true },
    ] as unknown as Player['injuries'];
    q[0].injury = { ...hurt(l), type: 'concussion', weeksRemaining: 1, estimate: [1, 1], week: l.week - 1 };
    order(team, [q[0].id, q[1].id]);
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(jolts(q[0], 'benched')).toEqual([]);
    expect(team.jobs!.runs?.[q[1].id]).toBeUndefined();
  });
});

describe('mid-story: trades, cuts and retirements', () => {
  it.each(exits)(
    'the other man of a question %s: it closes "left", the holder keeps the job with no lift',
    (_n, go) => {
      const { l, team, q } = sitHolder(`mid-other-${_n}`);
      moodWeek(l);
      expect(unsure(q[0])).toBe(1);
      go(l, q[1]);
      moodWeek(l);
      expect(questionOf(team, q[0].id)).toBeUndefined();
      expect(holdsJob(team, q[0].id)).toBe(true);
      expect(unsure(q[0])).toBe(0);
      expect(lift(q[0])).toBe(0);
      expect(q[0].morale!.talk?.ask?.cause).not.toBe('benched');
      const s = storyOf(l, q[0].id)!;
      expect(s.beats.at(-1)).toMatchObject({ kind: 'left' });
      expect(s.closed).toBeDefined();
      expect(s.beats.filter((b) => b.kind === 'left')).toHaveLength(1);
    },
  );

  it.each(exits)('the holder %s with the question open: the job is the other man’s at once', (_n, go) => {
    const { l, team, q } = sitHolder(`mid-holder-${_n}`);
    moodWeek(l);
    order(team, [q[0].id, q[1].id]);
    moodWeek(l);
    expect(unsure(q[1])).toBe(1);
    go(l, q[0]);
    moodWeek(l);
    expect(holdsJob(team, q[0].id)).toBe(false);
    expect(holdsJob(team, q[1].id)).toBe(true);
    expect(questionOf(team, q[1].id)).toBeUndefined();
    expect(unsure(q[1])).toBe(0);
    expect(lift(q[1])).toBe(0);
    expect(storyOf(l, q[0].id)!.beats.at(-1)).toMatchObject({ kind: 'left' });
  });

  it.each(exits)('the holder %s with no question open: his job is empty, and three starts earn it', (_n, go) => {
    const { l, team, q } = setup(`mid-empty-${_n}`);
    go(l, q[0]);
    moodWeek(l);
    expect(holdsJob(team, q[0].id)).toBe(false);
    expect(holdsJob(team, q[1].id)).toBe(false);
    expect(team.jobs!.questions).toBeUndefined();
    for (let i = 0; i < EARN; i++) moodWeek(l);
    expect(holdsJob(team, q[1].id)).toBe(true);
  });

  it('he leaves with an ask unanswered: his row closes, and nobody else is left asking about him', () => {
    const { l, team, q } = sitHolder('mid-ask-leaves');
    const at = q[0].morale!.talk!.ask!.at;
    expect(talkCard(l, { clock: at, playerId: q[0].id }).state).toBe('open');
    setTeam(l, q[0], (team.id + 1) % l.teams.length);
    moodWeek(l);
    expect(talkCard(l, { clock: at, playerId: q[0].id }).state).toBe('closed');
    expect(q[1].morale!.talk?.ask).toBeUndefined();
  });

  it('he leaves in a bye week: the question closes then, not a game later', () => {
    const { l, team, q } = sitHolder('mid-bye-leave');
    const bye = Array.from({ length: 17 }, (_, i) => i + 2).find(
      (w) =>
        !l.games.some((g) => g.season === l.season && g.week === w && (g.homeId === team.id || g.awayId === team.id)),
    )!;
    l.week = bye;
    setTeam(l, q[1], (team.id + 1) % l.teams.length);
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(storyOf(l, q[0].id)!.beats.at(-1)).toMatchObject({ kind: 'left' });
  });

  it('a new man arriving and starting over a holder is an ordinary benching, and he is the other', () => {
    const { l, team, q } = setup('mid-arrives');
    const away = l.teams.find((t) => t.id !== team.id)!;
    const newcomer = l.players[away.depthChart.QB[0]];
    setTeam(l, newcomer, team.id);
    order(team, [newcomer.id, q[0].id]);
    const at = moodWeek(l);
    expect(questionOf(team, q[0].id)!.other).toBe(newcomer.id);
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at });
    expect(jolts(q[0], 'benched', at).map((j) => j.size)).toEqual([BENCH_SIZE.sit]);
    expect(storyOf(l, q[0].id)!.other).toBe(newcomer.id);
    expect(holdsJob(team, newcomer.id)).toBe(false);
  });
});

describe('mid-story: positions', () => {
  it('jobs are read from the chart after cut-down day’s flips', () => {
    const { l, team } = setup('mid-flip');
    const wr = l.players[team.depthChart.WR[0]];
    team.depthChart.WR = team.depthChart.WR.filter((id) => id !== wr.id);
    team.depthChart.TE = [wr.id, ...team.depthChart.TE];
    setJobs(l);
    expect(team.jobs!.held[wr.id].pos).toBe('TE');
  });

  it('a left-to-right tackle move is nothing: a job is a place among the starters', () => {
    const { l, team } = setup('mid-line');
    const [a, b, ...rest] = team.depthChart.OL;
    team.depthChart.OL = [b, a, ...rest];
    moodWeek(l);
    expect(team.jobs!.questions).toBeUndefined();
    expect(Object.values(l.players).filter((p) => p.teamId === team.id && p.morale?.talk?.ask)).toEqual([]);
  });

  it('two holders sitting the same week each open a question naming the one who started highest; a third ask waits', () => {
    const { l, team } = setup('mid-two-sit');
    const wr = team.depthChart.WR.map((id) => l.players[id]);
    team.depthChart.WR = [wr[3].id, wr[4].id, wr[5].id, wr[0].id, wr[1].id, wr[2].id];
    const at = moodWeek(l);
    const qs = team.jobs!.questions!;
    expect(qs.map((q) => q.holder).sort()).toEqual([wr[0].id, wr[1].id, wr[2].id].sort());
    expect(qs.every((q) => q.other === wr[3].id)).toBe(true);
    const asking = () => wr.slice(0, 3).filter((p) => p.morale?.talk?.ask?.cause === 'benched');
    expect(asking()).toHaveLength(PER_CLUB);
    expect(wr.slice(0, 3).every((p) => holdsJob(team, p.id))).toBe(true);
    const hits = wr.slice(0, 3).flatMap((p) => jolts(p, 'benched', at));
    expect(hits).toHaveLength(3);
    moodWeek(l);
    expect(asking()).toHaveLength(3);
  });

  it('no man is named when every man who started already holds a job', () => {
    const { l, team, q } = setup('mid-none');
    team.jobs!.held[q[1].id] = { pos: 'QB', since: 0 };
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    const question = questionOf(team, q[0].id)!;
    expect(question.other).toBeUndefined();
    expect(storyOf(l, q[0].id)!.other).toBeUndefined();
  });

  it('a kicker is one job like any other', () => {
    const { l, team } = setup('mid-kicker');
    const k = l.players[team.depthChart.K[0]];
    expect(team.jobs!.held[k.id].pos).toBe('K');
    // A second kicker, signed for the test when the league has no spare one.
    const spare: Player = structuredClone(k);
    spare.id = Math.max(...Object.keys(l.players).map(Number)) + 1;
    spare.firstName = 'Spare';
    spare.lastName = 'Kicker';
    spare.teamId = null;
    delete spare.morale;
    addPlayer(l, spare);
    setTeam(l, spare, team.id);
    team.depthChart.K = [spare.id, k.id, ...team.depthChart.K.slice(1)];
    moodWeek(l);
    expect(questionOf(team, k.id)).toMatchObject({ pos: 'K', other: spare.id });
  });
});

describe('mid-story: the calendar', () => {
  it('the club’s season over: no new benching and nobody is unsure', () => {
    const { l, team, q } = setup('mid-over');
    l.phase = 'playoffs';
    l.week = 19;
    // A man already unsure when the season ends: nothing more lands on him and nothing is cleared either.
    addJolt(q[2], 'unsure', BENCH_SIZE.unsure, moraleClock(l));
    order(team, [q[1].id, q[0].id]);
    moodWeek(l);
    moodWeek(l);
    expect(team.jobs!.questions).toBeUndefined();
    expect(jolts(q[0], 'benched')).toEqual([]);
    expect(unsure(q[0])).toBe(0);
    expect(unsure(q[2])).toBe(1);
    expect(q[0].morale!.talk?.ask).toBeUndefined();
  });

  it('a playoff game is a game like any other', () => {
    const { l, team, q } = setup('mid-playoff');
    const g = l.games.find((x) => x.season === l.season && (x.homeId === team.id || x.awayId === team.id))!;
    l.phase = 'playoffs';
    l.week = 19;
    l.games.push({ ...g, week: 19, result: undefined });
    order(team, [q[1].id, q[0].id]);
    const at = moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeDefined();
    expect(q[0].morale!.talk!.ask).toEqual({ cause: 'benched', at });
  });

  it('the new league year closes an open question quietly, its ask with it, and clears jobs', () => {
    const { l, team, q } = sitHolder('mid-year');
    const s = storyOf(l, q[0].id)!;
    expect(untold(l, s, COACH).length).toBeGreaterThan(0);
    l.phase = 'complete';
    beginOffseason(l);
    expect(team.jobs).toBeUndefined();
    expect(team.kickoff).toBeUndefined();
    expect(s.closed).toBeDefined();
    expect(s.beats.at(-1)!.kind).toBe('ended');
    expect(untold(l, s, COACH)).toEqual([]);
    expect(openStory(l, { kind: 'benched', teamId: team.id, playerId: q[0].id })).toBeUndefined();
    expect(q[0].morale!.talk?.ask?.cause).not.toBe('benched');
  }, 120_000);

  it('endJobs on a league with no jobs does nothing', () => {
    const l = createLeague({ seed: 'mid-nojobs' });
    expect(() => endJobs(l)).not.toThrow();
  });
});

describe('mid-story: the people writing', () => {
  it('the chair is empty: "Coaching staff" signs the letter that carries the ask', () => {
    const { l } = sitHolder('mid-chair');
    const hc = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, hc.id);
    l.phase = 'regular';
    expect(headCoach(l).from).toBe('Coaching staff');
    deliverMail(l);
    const letter = (l.inbox ?? []).filter((m) => m.id.startsWith('coach:')).at(-1)!;
    expect(letter.from).toBe('Coaching staff');
  });

  it('a new head coach mid-story: the letters come from him', () => {
    const { l } = sitHolder('mid-new-hc');
    const old = teamCoaches(l, l.userTeamId).find((c) => c.role === 'headCoach')!;
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, old.id);
    // The market's head coaches, the first the budget lets us sign.
    const next = Object.values(l.coaches)
      .filter((c) => c.role === 'headCoach' && c.teamId === null && c.id !== old.id)
      .find((c) => {
        try {
          hireCoach(l, l.userTeamId, c.id);
          return true;
        } catch {
          return false;
        }
      })!;
    expect(next).toBeDefined();
    l.phase = 'regular';
    deliverMail(l);
    const letter = (l.inbox ?? []).filter((m) => m.id.startsWith('coach:')).at(-1)!;
    expect(letter.from).toContain(next.lastName);
    expect(letter.from).not.toContain(old.lastName);
  });

  it('a position coach leaves: his room’s row is the head coach’s until the chair is filled', () => {
    const { l, q } = setup('mid-poscoach');
    const pc = teamCoaches(l, l.userTeamId).find(
      (c) => c.role === 'positionCoach' && roomCoach(l, q[0]).from.includes(c.lastName),
    )!;
    expect(pc).toBeDefined();
    l.phase = 'resign';
    releaseCoach(l, l.userTeamId, pc.id);
    expect(roomCoach(l, q[0]).from).toBe(headCoach(l).from);
  });
});

// ───────── the lineup step, the reminder and the card ─────────

describe('the lineup step', () => {
  it('asks only with the chart yours and the season unconfirmed, and confirming answers it', () => {
    const l = createLeague({ seed: 'lineup-step' });
    const team = l.teams[l.userTeamId];
    expect(lineupProblem(l)).toBe(false);
    l.phase = 'preseason';
    team.autoDepth = true;
    expect(lineupProblem(l)).toBe(false);
    team.autoDepth = false;
    expect(lineupProblem(l)).toBe(true);
    confirmLineup(l);
    expect(team.lineupSet).toBe(l.season);
    expect(lineupProblem(l)).toBe(false);
    // A year on it asks again.
    l.season++;
    expect(lineupProblem(l)).toBe(true);
  });

  it('with the 53 still to submit, the lineup is the next step’s', () => {
    const l = createLeague({ seed: 'lineup-53', personnel: true });
    l.phase = 'preseason';
    l.teams[l.userTeamId].autoDepth = false;
    l.personnel!.clock = { season: l.season, cutdown: false };
    expect(lineupProblem(l)).toBe(false);
    l.personnel!.clock = { season: l.season, cutdown: true };
    expect(lineupProblem(l)).toBe(true);
  });
});

describe('the cleared starter', () => {
  /** The QB1 was out at the last kickoff, is healthy now, and the chart lists him third. */
  function cleared(seed: string) {
    const { l, team, q } = setup(seed);
    team.autoDepth = false;
    q[0].injury = hurt(l);
    order(team, [q[1].id, q[2].id, q[0].id]);
    benchKickoff(l);
    delete q[0].injury;
    return { l, team, q };
  }

  it('lists a job-holder back from injury listed third, and nobody else', () => {
    const { l, q } = cleared('cleared-list');
    expect(clearedNotStarting(l).map((p) => p.id)).toEqual([q[0].id]);
  });

  it('is nobody when the staff sorts the chart, when he is still hurt, or when he starts', () => {
    const a = cleared('cleared-auto');
    a.team.autoDepth = true;
    expect(clearedNotStarting(a.l)).toEqual([]);
    const b = cleared('cleared-hurt');
    b.q[0].injury = hurt(b.l);
    expect(clearedNotStarting(b.l)).toEqual([]);
    const c = cleared('cleared-starts');
    order(c.team, [c.q[0].id, c.q[1].id, c.q[2].id]);
    expect(clearedNotStarting(c.l)).toEqual([]);
    // A man who was never out is not reminded: sitting him is the question's business.
    const d = setup('cleared-never');
    d.team.autoDepth = false;
    order(d.team, [d.q[1].id, d.q[2].id, d.q[0].id]);
    benchKickoff(d.l);
    expect(clearedNotStarting(d.l)).toEqual([]);
  });

  it('putBack puts him among the starters, and a hand-sorted chart stays hand-sorted', () => {
    const { l, team, q } = cleared('cleared-putback');
    putBack(l, q[0].id);
    expect(team.depthChart.QB.indexOf(q[0].id)).toBeLessThan(1);
    expect(team.autoDepth).toBe(false);
    expect(clearedNotStarting(l)).toEqual([]);
    expect(restoreCard(l, q[0].id)).toEqual({ state: 'closed', line: 'He is back in the starting spots.' });
  });

  it('Leave it ends the reminder, and being out again starts it over', () => {
    const { l, team, q } = cleared('cleared-leave');
    expect(restoreCard(l, q[0].id).state).toBe('open');
    dismissReminder(l, q[0].id);
    expect(clearedNotStarting(l)).toEqual([]);
    expect(restoreCard(l, q[0].id)).toEqual({ state: 'closed', line: 'You left him where he is.' });
    q[0].injury = hurt(l);
    l.week++;
    benchKickoff(l);
    expect(team.jobs!.held[q[0].id].reminded).toBeUndefined();
  });
});

describe('the cleared starter’s grace', () => {
  /** Step c: the QB1 was out at kickoff and can play after it, listed third; your club's chart is hand-sorted. */
  function back(seed: string) {
    const { l, team, q } = setup(seed);
    team.autoDepth = false;
    q[0].injury = hurt(l);
    order(team, [q[1].id, q[2].id, q[0].id]);
    benchKickoff(l);
    delete q[0].injury;
    const c = moraleClock(l, true);
    moraleAdvance(l, c);
    l.week++;
    return { l, team, q, c };
  }

  it('runs from the step he could play again: a game sat inside it opens nothing, the next one does', () => {
    const { l, team, q, c } = back('grace-clock');
    expect(team.jobs!.held[q[0].id].cleared).toBe(c);
    expect(clearedNotStarting(l).map((p) => p.id)).toEqual([q[0].id]);
    // Sat at c+1: still inside the reminder's longest way to you.
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeUndefined();
    expect(q[0].morale?.talk?.ask).toBeUndefined();
    expect(clearedNotStarting(l).map((p) => p.id)).toEqual([q[0].id]);
    // Sat again at c+2: the one-game rule, he asks.
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeDefined();
    expect(q[0].morale?.talk?.ask?.cause).toBe('benched');
  });

  it('Leave it ends the grace at once', () => {
    const { l, team, q } = back('grace-leave');
    dismissReminder(l, q[0].id);
    moodWeek(l);
    expect(questionOf(team, q[0].id)).toBeDefined();
  });

  it('a holder who starts again is owed nothing', () => {
    const { l, team, q } = back('grace-starts');
    order(team, [q[0].id, q[1].id, q[2].id]);
    moodWeek(l);
    expect(team.jobs!.held[q[0].id].out).toBeUndefined();
    expect(team.jobs!.held[q[0].id].cleared).toBeUndefined();
  });
});

describe('the benching card', () => {
  it('his row has four answers with the other man named last, the other man’s row has three', () => {
    const { l, team, q } = sitHolder('card-options');
    const holder = benchCard(l, { playerId: q[0].id, clock: 0 });
    expect(holder.state).toBe('open');
    expect(holder.options!.map((o) => o.value)).toEqual(['backIn', 'thisWeek', 'earn', 'his']);
    expect(holder.options!.at(-1)!.label).toBe(`It's ${q[1].lastName}'s job now`);
    const other = benchCard(l, { playerId: q[1].id, clock: 0 });
    expect(other.role).toBe('other');
    expect(other.options!.map((o) => o.label)).toEqual([
      "The job's yours",
      'Keep competing',
      `It's ${q[0].lastName}'s job`,
    ]);
    expect(team.jobs!.questions).toHaveLength(1);
  });

  it('stays answerable while the question is open, with no ask on file', () => {
    const { l, q } = sitHolder('card-noask');
    delete q[0].morale!.talk!.ask;
    expect(benchCard(l, { playerId: q[0].id, clock: 0 }).state).toBe('open');
    expect(answerBench(l, q[0].id, 'earn')).toBe(true);
    const done = benchCard(l, { playerId: q[0].id, clock: 0 });
    expect(done.state).toBe('answered');
    expect(done.said).toBe('You told him to earn it back.');
    expect(done.line).toBeTruthy();
    expect(benchCard(l, { playerId: q[1].id, clock: 0 }).said).toContain(q[0].lastName);
  });

  it('closes with a line for every way a benching ends, none of them the generic one', () => {
    const lines: string[] = [];
    const closing = (seed: string, end: (s: ReturnType<typeof sitHolder>) => void, who = 0) => {
      const s = sitHolder(seed);
      end(s);
      const card = benchCard(s.l, { playerId: s.q[who].id, clock: 0 });
      expect(card.state).toBe('closed');
      lines.push(card.line!);
    };
    closing('close-his', (s) => answerBench(s.l, s.q[0].id, 'his'));
    closing('close-keeps', (s) => answerBench(s.l, s.q[1].id, 'his'));
    closing('close-back', (s) => {
      answerBench(s.l, s.q[0].id, 'backIn');
      order(s.team, [s.q[0].id, s.q[1].id]);
      moodWeek(s.l);
    });
    closing('close-left', (s) => {
      setTeam(s.l, s.q[1], null);
      moodWeek(s.l);
    });
    // The holder gone: the man who stays has the card.
    closing(
      'close-left-holder',
      (s) => {
        setTeam(s.l, s.q[0], null);
        moodWeek(s.l);
      },
      1,
    );
    closing('close-out', (s) => {
      s.q[1].injury = lost(s.l);
      moodWeek(s.l);
    });
    closing('close-chart', (s) => {
      for (let i = 0; i < EARN; i++) moodWeek(s.l);
    });
    closing('close-earned-back', (s) => {
      answerBench(s.l, s.q[0].id, 'earn');
      order(s.team, [s.q[0].id, s.q[1].id]);
      for (let i = 0; i < EARN; i++) moodWeek(s.l);
    });
    expect(lines.every((x) => x && !/That one is closed/.test(x))).toBe(true);
    expect(new Set(lines).size).toBe(lines.length);
  }, 60_000);
});

describe('his words', () => {
  it('a ten-year captain and a second-year man ask differently, and the staff is never named as the GM', () => {
    const { l, team, q } = sitHolder('words-ask');
    const ctx = moraleContext(l);
    q[0].experience = 10;
    const vet = benchFact(l, q[0], ctx)!;
    expect(vet.role).toBe('holder');
    expect(vet.other!.last).toBe(q[1].lastName);
    team.autoDepth = true;
    expect(benchFact(l, q[0], ctx)!.by).toBe('staff');
  });
});

describe('fix round 1', () => {
  it('"better" reads the man across from him on our scouts\' read, not the rest of the room', () => {
    const rate = (p: Player, v: number) => {
      for (const k of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[k] = v;
    };
    // The room's best is hurt; a lesser man started over the holder: nobody across from him is the better man.
    const a = setup('fix-better-a');
    rate(a.q[0], 12);
    rate(a.q[1], 8);
    rate(a.q[2], 18);
    a.q[2].injury = hurt(a.l);
    order(a.team, [a.q[1].id, a.q[0].id]);
    moodWeek(a.l);
    expect(questionOf(a.team, a.q[0].id)?.other).toBe(a.q[1].id);
    expect(benchFact(a.l, a.q[0], moraleContext(a.l))!.better).toBe(false);
    // The man who started over him reads plainly better: he knows it.
    const b = setup('fix-better-b');
    rate(b.q[0], 8);
    rate(b.q[1], 16);
    order(b.team, [b.q[1].id, b.q[0].id]);
    moodWeek(b.l);
    const ours = (p: Player) => perceive(b.l, b.team.id, p).ovr;
    expect(ours(b.q[1]) - ours(b.q[0])).toBeGreaterThan(1);
    expect(benchFact(b.l, b.q[0], moraleContext(b.l))!.better).toBe(true);
  });

  it('an answered row says how it stands now, and a broken word says so when it opens again', () => {
    const a = sitHolder('fix-stands-a');
    answerBench(a.l, a.q[0].id, 'backIn');
    expect(benchCard(a.l, { playerId: a.q[0].id, clock: 0 }).stands).toBe('He is waiting on his next game.');
    expect(benchCard(a.l, { playerId: a.q[1].id, clock: 0 }).stands).toBe(
      `${a.q[0].lastName} is waiting on his next game.`,
    );
    const b = sitHolder('fix-stands-b');
    answerBench(b.l, b.q[0].id, 'thisWeek');
    expect(benchCard(b.l, { playerId: b.q[0].id, clock: 0 }).stands).toBe('He is watching to see if he starts again.');
    const c = sitHolder('fix-stands-c');
    answerBench(c.l, c.q[0].id, 'earn');
    expect(benchCard(c.l, { playerId: c.q[0].id, clock: 0 }).stands).toBe('The job is still open.');
    // The word broken: he sat again, the card is open again and says why.
    moodWeek(a.l);
    const again = benchCard(a.l, { playerId: a.q[0].id, clock: 0 });
    expect(again.state).toBe('open');
    expect(again.stands).toBe('He sat again, so your word did not hold.');
    // His row's facts know a word was given and broken: no line says nobody told him.
    expect(benchFact(a.l, a.q[0], moraleContext(a.l))!.wordBroken).toBe('backIn');
    expect(benchFact(c.l, c.q[0], moraleContext(c.l))!.wordBroken).toBeNull();
  });

  it('a question re-opened in the same year reads only its own beats: an earlier broken word is not this one', () => {
    const { l, team, q } = sitHolder('fix-reopened-word');
    const s = openStory(l, { kind: 'benched', teamId: team.id, playerId: q[0].id })!;
    const now = s.beats.at(-1)!;
    s.beats = [
      { at: now.at - 6, kind: 'sat' },
      { at: now.at - 5, kind: 'answered', how: 'thisWeek' },
      { at: now.at - 4, kind: 'satAgain' },
      { at: now.at - 2, kind: 'settled', how: 'earnedBack' },
      now,
    ];
    expect(benchFact(l, q[0], moraleContext(l))!.wordBroken).toBeNull();
    expect(benchCard(l, { playerId: q[0].id, clock: 0 }).stands).toBeUndefined();
  });

  it('both men gone: the closing says nothing about who has the job', () => {
    const { l, team, q } = sitHolder('fix-both');
    setTeam(l, q[0], null);
    setTeam(l, q[1], null);
    moodWeek(l);
    expect(team.jobs!.questions).toBeUndefined();
    const story = [...l.stories!.closed].find((s) => s.kind === 'benched' && s.playerId === q[0].id)!;
    expect(story.beats.at(-1)).toMatchObject({ kind: 'left', how: 'both' });
  });

  it('claims resolved after the lineup is set leave a hand-sorted chart’s starters as confirmed', () => {
    const l = createLeague({ seed: 'fix-claims', personnel: true });
    const team = l.teams[l.userTeamId];
    l.phase = 'preseason';
    l.personnel!.clock = { season: l.season, cutdown: true };
    team.autoDepth = false;
    const starting = () =>
      Object.fromEntries(
        (Object.keys(team.depthChart) as (keyof typeof team.depthChart)[]).map((pos) => [
          pos,
          team.depthChart[pos].slice(0, STARTERS[pos]),
        ]),
      );
    // A better receiver than any of ours comes off another club's roster; our last receiver is the man we cut for him.
    const other = l.teams[(team.id + 3) % l.teams.length];
    const star = teamPlayersOf(l, other, 'WR').at(-1)!;
    for (const k of Object.keys(star.ratings) as (keyof Player['ratings'])[]) star.ratings[k] = 19;
    star.contract = {
      kind: 'rookie',
      signedSeason: l.season,
      signedWeek: -1,
      apy: 1500,
      length: 2,
      years: [
        { season: l.season, base: 1000, guaranteed: 800 },
        { season: l.season + 1, base: 1100, guaranteed: 600 },
      ],
      bonuses: [{ amount: 1200, start: l.season, years: 3, source: 'signing' }],
    };
    star.service = initialService(0, l.season - 1);
    ensureWaivers(l).originalOrder.teams = l.teams.map((t) => t.id);
    releasePlayer(l, star);
    const entry = l.personnel!.waivers!.pending.find((e) => e.playerId === star.id)!;
    const spare = teamPlayersOf(l, team, 'WR').at(-1)!;
    spare.contract!.bonuses = [];
    spare.contract!.years.forEach((y) => (y.guaranteed = 0));
    setWaiverClaim(l, { entryId: entry.id, teamId: team.id, cutIds: [spare.id], preference: 0 });
    confirmLineup(l);
    const before = starting();
    advanceOffseason(l);
    expect(l.phase).toBe('regular');
    expect(star.teamId).toBe(team.id);
    // Every starter we confirmed still starts; the claimed man is behind them on a hand-sorted chart.
    expect(starting()).toEqual(before);
    for (const id of Object.values(before).flat()) expect(holdsJob(team, id)).toBe(true);
    expect(holdsJob(team, star.id)).toBe(false);
  }, 120_000);
});

const teamPlayersOf = (l: League, team: Team, pos: Player['position']) =>
  team.depthChart[pos].map((id) => l.players[id]).filter((p) => p.teamId === team.id);

describe('fix round 2', () => {
  const closingOf = (l: League, id: number) => {
    const story = [...l.stories!.closed].find((x) => x.kind === 'benched' && x.playerId === id)!;
    return { beat: story.beats.at(-1)!, text: say(BENCH_CLOSE, benchCloseFact(l, story), { key: 'k', slot: 's' }) };
  };

  it('the holder leaves with no other man in the question: "holder", and a line that names him', () => {
    const { l, team, q } = setup('fix2-none');
    // He sits for nobody who holds no job: no man is named.
    order(team, [q[0].id]);
    const k = team.jobs!;
    k.questions = [{ pos: 'QB', holder: q[0].id, since: moraleClock(l) }];
    beat(l, { kind: 'benched', teamId: team.id, playerId: q[0].id }, 'sat', moraleClock(l), { pub: true });
    setTeam(l, q[0], null);
    moodWeek(l);
    const c = closingOf(l, q[0].id);
    expect(c.beat).toMatchObject({ kind: 'left', how: 'holder' });
    expect(c.text).toContain(q[0].lastName);
    expect(c.text).not.toMatch(/That one is closed|^The question over/);
  });

  it('the holder leaves and the other stays: the job is the other man’s; both gone: nothing about the job', () => {
    const a = sitHolder('fix2-holder');
    setTeam(a.l, a.q[0], null);
    moodWeek(a.l);
    const x = closingOf(a.l, a.q[0].id);
    expect(x.beat).toMatchObject({ how: 'holder' });
    expect(x.text).toBe(`${a.q[0].lastName} has left, so the job is ${a.q[1].lastName}'s now.`);
    const b = sitHolder('fix2-both');
    setTeam(b.l, b.q[0], null);
    setTeam(b.l, b.q[1], null);
    moodWeek(b.l);
    const y = closingOf(b.l, b.q[0].id);
    expect(y.beat).toMatchObject({ how: 'both' });
    expect(y.text).toContain('both gone');
    expect(y.text).not.toMatch(/job/);
  });

  it('on the other man’s card the promise names the man it went to', () => {
    const { l, q } = sitHolder('fix2-stands');
    answerBench(l, q[0].id, 'backIn');
    expect(benchCard(l, { playerId: q[0].id, clock: 0 }).stands).toBe('He is waiting on his next game.');
    expect(benchCard(l, { playerId: q[1].id, clock: 0 }).stands).toBe(`${q[0].lastName} is waiting on his next game.`);
  });
});
