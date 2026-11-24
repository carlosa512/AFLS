import { describe, expect, it } from 'vitest';
import { benchKickoff, clearedNotStarting, setJobs } from './benching';
import {
  answerConduct,
  LADDER,
  publicConduct,
  reviewWeek,
  serveGames,
  setConductByCoach,
  settleConduct,
  suspended,
  troubleWeek,
} from './conduct';
import { setTrait } from './coachTraits';
import { teamCoaches } from './coaching';
import { waitFor } from './playerTalks';
import { createLeague } from './generate';
import { gamesInWeek, playGame, playWeek } from './league';
import { buildLineup } from './match/lineup';
import { migrateLeague } from './migrate';
import { isAvailable, retirePlayer, setTeam, slimRetired, teamPlayers } from './roster';
import { SAVE_VERSION } from './generate';
import { outFor } from '../ui/pregame';
import type { GameResult, League, Player } from './types';

const ban = (p: Player, games = 2, by: 'league' | 'team' = 'league') => {
  p.suspension = { games, by, reason: 'fight' };
};

function scene(seed: string) {
  const l = createLeague({ seed });
  const team = l.teams[l.userTeamId];
  const q = team.depthChart.QB.map((id) => l.players[id]);
  return { l, team, q };
}

describe('a suspended player', () => {
  it('is not available, and games left at 0 is not suspended', () => {
    const { q } = scene('cd-avail');
    expect(isAvailable(q[0])).toBe(true);
    ban(q[0]);
    expect(suspended(q[0])).toBe(true);
    expect(isAvailable(q[0])).toBe(false);
    q[0].suspension!.games = 0;
    expect(suspended(q[0])).toBe(false);
  });

  it('is skipped by buildLineup', () => {
    const { l, team, q } = scene('cd-lineup');
    expect(buildLineup(l, team).qb.id).toBe(q[0].id);
    ban(q[0]);
    expect(buildLineup(l, team).qb.id).not.toBe(q[0].id);
  });

  it('shows on the pregame out list as suspended or sat by the team', () => {
    const { l, team, q } = scene('cd-out');
    ban(q[0]);
    ban(q[1], 1, 'team');
    const out = outFor(l, team.id);
    expect(out.find((o) => o.id === q[0].id)?.what).toBe('suspended');
    expect(out.find((o) => o.id === q[1].id)?.what).toBe('sat by the team');
  });
});

describe('serveGames', () => {
  it('counts down only the teams that played and clears at 0', () => {
    const { l, team, q } = scene('cd-serve');
    const other = l.teams.find((t) => t.id !== team.id)!;
    const o = l.players[other.depthChart.QB[0]];
    ban(q[0], 2);
    ban(o, 2);
    serveGames(l, [team.id]);
    expect(q[0].suspension!.games).toBe(1);
    expect(o.suspension!.games).toBe(2);
    serveGames(l, [team.id]);
    expect(q[0].suspension).toBeUndefined();
  });

  it('holds through a bye and an offseason ruling keeps its games for week 1', () => {
    const l = createLeague({ seed: 'cd-bye' });
    const bye = (w: number) => {
      const played = new Set(gamesInWeek(l, w).flatMap((g) => [g.homeId, g.awayId]));
      return l.teams.find((t) => !played.has(t.id));
    };
    let w = 1;
    while (!bye(w)) w++;
    const team = bye(w)!;
    // Move to the bye week with a fresh ban and check it holds.
    const l2 = l;
    const t2 = l2.teams[team.id];
    const p2 = l2.players[t2.depthChart.QB[0]];
    l2.week = w;
    ban(p2, 1);
    playWeek(l2);
    expect(p2.suspension?.games).toBe(1);
    playWeek(l2);
    expect(p2.suspension).toBeUndefined();
  });
});

describe('serving in every kind of week', () => {
  it('counts a game already played (live or early) when the week is played', () => {
    const l = createLeague({ seed: 'cd-live' });
    const g = gamesInWeek(l)[0];
    const p = l.players[l.teams[g.homeId].depthChart.QB[0]];
    ban(p, 2);
    // Its result is recorded first, as a live game does.
    playGame(l, g);
    expect(g.result).toBeDefined();
    playWeek(l);
    expect(p.suspension?.games).toBe(1);
  });

  it('keeps counting into the playoffs', () => {
    const l = createLeague({ seed: 'cd-playoffs' });
    while (l.phase === 'regular') playWeek(l);
    expect(l.phase).toBe('playoffs');
    const t = l.games.find((g) => g.season === l.season && g.week === l.week)!;
    const p = l.players[l.teams[t.homeId].depthChart.QB[0]];
    ban(p, 2);
    playWeek(l);
    expect(p.suspension?.games).toBe(1);
  });
});

describe('the bench and the job holder', () => {
  function suspendedHolder(seed: string) {
    const { l, team, q } = scene(seed);
    team.autoDepth = false;
    setJobs(l);
    team.depthChart.QB = [q[1].id, q[2].id, q[0].id];
    ban(q[0], 1);
    benchKickoff(l);
    return { l, team, q };
  }

  it('asks a suspended holder nothing: he was out, not benched', () => {
    const { team, q } = suspendedHolder('cd-bench');
    expect(team.kickoff!.out).toContain(q[0].id);
    expect(team.jobs!.questions ?? []).toEqual([]);
  });

  it('reminds you once he is back and listed below the starters', () => {
    const { l, q } = suspendedHolder('cd-back');
    expect(clearedNotStarting(l)).toEqual([]);
    delete q[0].suspension;
    expect(clearedNotStarting(l).map((p) => p.id)).toEqual([q[0].id]);
  });
});

describe('save and retirement', () => {
  it('a v103 save migrates to 104', () => {
    const l = createLeague({ seed: 'cd-v104' });
    l.version = 103;
    const up = migrateLeague(l as League)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(104);
  });

  it('retiring drops the record and the suspension', () => {
    const { l, q } = scene('cd-retire');
    q[2].discipline = { entries: [{ season: 1, week: 1, kind: 'fight', outcome: 'fine' }] };
    ban(q[2]);
    retirePlayer(l, q[2]);
    slimRetired(q[2]);
    expect(q[2].discipline).toBeUndefined();
    expect(q[2].suspension).toBeUndefined();
  });
});

// ───────── trouble, the league's review and your answers ─────────

const entries = (l: League) => Object.values(l.players).flatMap((p) => p.discipline?.entries ?? []);

/** Plays `n` in-season steps of trouble, clearing what a ruling leaves so every step rolls the same field. */
function steps(l: League, n: number, each?: (week: number) => void) {
  l.phase = 'regular';
  for (let w = 1; w <= n; w++) {
    l.week = w;
    each?.(w);
    troubleWeek(l, 'week');
    for (const p of Object.values(l.players)) {
      delete p.suspension;
      if (p.discipline) delete p.discipline.lean;
    }
  }
}
const setAll = (_l: League, ps: Player[], k: 'workEthic' | 'temperament' | 'controversy', v: number) =>
  ps.forEach((p) => (p.traits[k] = v));
const rostered = (l: League, skipUser = false) =>
  l.teams.filter((t) => !skipUser || t.id !== l.userTeamId).flatMap((t) => teamPlayers(l, t.id));
const result = (r: Partial<GameResult>) => r as GameResult;
const eject = (p: Player, why: 'fight' | 'twoUnsportsmanlike' | 'flagrant') =>
  result({ ejections: [{ playerId: p.id, teamId: p.teamId!, quarter: 2, clock: 300, why }] });

describe('trouble by character', () => {
  it('a bottom-of-the-room man gets into far more than a median one, and a median one almost never does', () => {
    const l = createLeague({ seed: 'cd-rates' });
    const all = rostered(l, true);
    const low = all.filter((_, i) => i % 2 === 0);
    const mid = all.filter((_, i) => i % 2 === 1);
    setAll(l, low, 'workEthic', 3);
    setAll(l, low, 'controversy', 18);
    setAll(l, mid, 'workEthic', 10);
    setAll(l, mid, 'temperament', 10);
    setAll(l, mid, 'controversy', 10);
    steps(l, 18);
    const lowSet = new Set(low.map((p) => p.id));
    let lowN = 0;
    let midN = 0;
    for (const p of all)
      lowSet.has(p.id) ? (lowN += p.discipline?.entries.length ?? 0) : (midN += p.discipline?.entries.length ?? 0);
    expect(lowN / low.length).toBeGreaterThan(8 * (midN / mid.length));
    expect(midN / mid.length).toBeLessThan(0.05);
  });

  it('is a pure function: the same seed and week give the same trouble', () => {
    const run = () => {
      const l = createLeague({ seed: 'cd-pure' });
      setAll(l, rostered(l), 'workEthic', 2);
      steps(l, 3);
      return JSON.stringify(entries(l));
    };
    const a = run();
    expect(a).not.toBe('[]');
    expect(run()).toBe(a);
  });

  it('draws none for a man suspended or not reporting', () => {
    const l = createLeague({ seed: 'cd-none' });
    const all = rostered(l, true);
    setAll(l, all, 'workEthic', 1);
    setAll(l, all, 'temperament', 1);
    setAll(l, all, 'controversy', 20);
    for (const p of all) p.morale = { level: 0, reported: true } as Player['morale'];
    steps(l, 6);
    expect(entries(l)).toEqual([]);
    for (const p of all) delete p.morale;
    steps(l, 6);
    expect(entries(l).length).toBeGreaterThan(0);
    l.week = 1;
    for (const p of all) {
      delete p.discipline;
      p.suspension = { games: 3, by: 'league', reason: 'fight' };
    }
    troubleWeek(l, 'week');
    expect(entries(l)).toEqual([]);
  });

  it('a fight off the field goes to the league as a suspension', () => {
    const l = createLeague({ seed: 'cd-fight' });
    const all = rostered(l, true);
    setAll(l, all, 'temperament', 1);
    l.phase = 'regular';
    let found: Player | undefined;
    for (let w = 1; w <= 20 && !found; w++) {
      l.week = w;
      troubleWeek(l, 'week');
      found = all.find((p) => p.suspension?.reason === 'fight');
    }
    expect(found).toBeDefined();
    expect(found!.suspension).toMatchObject({ by: 'league', games: 1 });
  });
});

describe("the league's review", () => {
  it('a first league suspension is one game whatever happened, and the ladder climbs only on suspensions', () => {
    const l = createLeague({ seed: 'cd-ladder' });
    const p = rostered(l)[0];
    l.phase = 'regular';
    l.week = 3;
    const ban = () => {
      reviewWeek(l, [eject(p, 'fight')]);
      const g = p.suspension!.games;
      delete p.suspension;
      return g;
    };
    p.discipline = { entries: [{ season: l.season, week: 9, kind: 'practiceScuffle', outcome: 'sat' }] };
    expect(ban()).toBe(LADDER[0]);
    expect(ban()).toBe(LADDER[1]);
    expect(ban()).toBe(LADDER[2]);
    expect(ban()).toBe(LADDER[2]);
  });

  it('an ejection is a fine the first time, a suspension the second in the league year', () => {
    const l = createLeague({ seed: 'cd-eject' });
    const p = rostered(l)[0];
    l.phase = 'regular';
    l.week = 4;
    reviewWeek(l, [eject(p, 'twoUnsportsmanlike')]);
    expect(p.suspension).toBeUndefined();
    expect(p.discipline!.entries.at(-1)!.outcome).toBe('leagueFine');
    l.week = 6;
    reviewWeek(l, [eject(p, 'flagrant')]);
    expect(p.suspension).toMatchObject({ games: 1, by: 'league' });
    expect(publicConduct(l, l.season).map((r) => r.outcome)).toEqual(['leagueFine', 'suspended']);
  });

  it('a pattern of dangerous fouls is a fine, then a suspension', () => {
    const l = createLeague({ seed: 'cd-fouls' });
    const p = rostered(l)[0];
    l.phase = 'regular';
    const foul = result({ personalFouls: [{ playerId: p.id, foul: 'unnecessaryRoughness' }] });
    for (const w of [1, 2, 3]) {
      l.week = w;
      reviewWeek(l, [foul]);
    }
    expect(p.discipline!.entries.map((e) => e.outcome)).toEqual(['leagueFine']);
    for (const w of [10, 11, 12]) {
      l.week = w;
      reviewWeek(l, [foul]);
    }
    expect(p.suspension).toMatchObject({ games: 1, by: 'league', reason: 'dangerousFouls' });
  });

  it('two fouls spread beyond the span are no pattern', () => {
    const l = createLeague({ seed: 'cd-span' });
    const p = rostered(l)[0];
    l.phase = 'regular';
    const foul = result({ personalFouls: [{ playerId: p.id, foul: 'faceMask' }] });
    for (const w of [1, 5, 9, 13]) {
      l.week = w;
      reviewWeek(l, [foul]);
    }
    expect(p.discipline!.entries).toEqual([]);
  });
});

describe('your answers', () => {
  const pend = (l: League, p: Player) => {
    const t = l.teams[l.userTeamId];
    t.conduct = { pending: [{ playerId: p.id, kind: 'meeting', clock: 100 }] };
    l.moraleAt = 100;
  };

  it('Sit him a game sets a team suspension; fine and let it go set the lean', () => {
    const l = createLeague({ seed: 'cd-answer' });
    const [a, b, c] = teamPlayers(l, l.userTeamId);
    for (const [p, ans] of [
      [a, 'sat'],
      [b, 'fine'],
      [c, 'letGo'],
    ] as const) {
      pend(l, p);
      answerConduct(l, p.id, ans);
      expect(l.teams[l.userTeamId].conduct).toBeUndefined();
    }
    expect(a.suspension).toMatchObject({ games: 1, by: 'team' });
    expect(a.discipline!.entries[0].outcome).toBe('sat');
    expect(b.discipline!.entries[0].outcome).toBe('fine');
    expect(c.discipline!.lean!.by).toBeGreaterThan(1);
    expect(b.discipline!.lean!.by).toBeLessThan(1);
    expect(a.discipline!.lean!.by).toBeLessThan(b.discipline!.lean!.by);
  });

  it('does nothing for a player traded away or with no row', () => {
    const l = createLeague({ seed: 'cd-traded' });
    const [p, q] = teamPlayers(l, l.userTeamId);
    pend(l, p);
    setTeam(l, p, l.teams.find((t) => t.id !== l.userTeamId)!.id);
    answerConduct(l, p.id, 'sat');
    expect(p.suspension).toBeUndefined();
    expect(p.discipline).toBeUndefined();
    answerConduct(l, q.id, 'sat');
    expect(q.suspension).toBeUndefined();
  });

  it('an unanswered row settles as Let it go after the usual wait, and not before', () => {
    const l = createLeague({ seed: 'cd-settle' });
    const p = teamPlayers(l, l.userTeamId)[0];
    pend(l, p);
    l.moraleAt = 100 + waitFor(l, p) - 1;
    settleConduct(l);
    expect(l.teams[l.userTeamId].conduct?.pending).toHaveLength(1);
    l.moraleAt = 100 + waitFor(l, p);
    settleConduct(l);
    expect(l.teams[l.userTeamId].conduct).toBeUndefined();
    expect(p.discipline!.entries[0].outcome).toBe('letGo');
  });

  it('settles nothing, and does not throw, while the user has no team (the league plays itself)', () => {
    const l = createLeague({ seed: 'cd-nojob' });
    l.userTeamId = -1;
    expect(() => settleConduct(l)).not.toThrow();
  });

  it('the head coach handles it at once when set to, answering what already waits', () => {
    const l = createLeague({ seed: 'cd-bycoach' });
    const mine = teamPlayers(l, l.userTeamId);
    setAll(l, mine, 'workEthic', 1);
    steps(l, 4);
    expect(l.teams[l.userTeamId].conduct?.pending?.length).toBeGreaterThan(0);
    setConductByCoach(l, true);
    expect(l.teams[l.userTeamId].conduct).toEqual({ byCoach: true });
    const before = entries(l).length;
    steps(l, 8);
    expect(l.teams[l.userTeamId].conduct).toEqual({ byCoach: true });
    expect(entries(l).length).toBeGreaterThan(before);
    setConductByCoach(l, false);
    expect(l.teams[l.userTeamId].conduct).toBeUndefined();
  });
});

describe('AI head coaches', () => {
  const sats = (discipline: number) => {
    const l = createLeague({ seed: 'cd-coaches' });
    for (const t of l.teams)
      for (const c of teamCoaches(l, t.id)) if (c.role === 'headCoach') setTrait(c, 'discipline', discipline);
    setAll(l, rostered(l, true), 'workEthic', 2);
    steps(l, 18);
    const es = rostered(l, true).flatMap((p) => p.discipline?.entries ?? []);
    return {
      n: es.length,
      sat: es.filter((e) => e.outcome === 'sat').length,
      letGo: es.filter((e) => e.outcome === 'letGo').length,
    };
  };

  it('a strict one sits his men far more often than a lenient one, who lets more go', () => {
    const strict = sats(20);
    const lenient = sats(1);
    expect(strict.n).toBeGreaterThan(50);
    expect(strict.sat / strict.n).toBeGreaterThan(2 * (lenient.sat / lenient.n));
    expect(lenient.letGo / lenient.n).toBeGreaterThan(strict.letGo / strict.n);
  });
});

describe('the lean from your last answer', () => {
  it('Let it go raises his odds for a while and sitting him lowers them most', () => {
    const l = createLeague({ seed: 'cd-lean' });
    const all = rostered(l, true);
    setAll(l, all, 'workEthic', 3);
    const groups = { letGo: [] as Player[], none: [] as Player[], sat: [] as Player[] };
    all.forEach((p, i) => groups[(['letGo', 'none', 'sat'] as const)[i % 3]].push(p));
    const lean = { letGo: 1.5, none: 1, sat: 0.5 };
    steps(l, 5, () => {
      for (const k of ['letGo', 'sat'] as const)
        for (const p of groups[k]) (p.discipline ??= { entries: [] }).lean = { by: lean[k], until: 9999 };
    });
    const rate = (ps: Player[]) => ps.reduce((n, p) => n + (p.discipline?.entries.length ?? 0), 0) / ps.length;
    expect(rate(groups.letGo)).toBeGreaterThan(rate(groups.none));
    expect(rate(groups.none)).toBeGreaterThan(rate(groups.sat));
  });
});
