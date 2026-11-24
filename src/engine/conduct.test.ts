import { describe, expect, it } from 'vitest';
import { benchKickoff, clearedNotStarting, setJobs } from './benching';
import { serveGames, suspended } from './conduct';
import { createLeague } from './generate';
import { gamesInWeek, playWeek } from './league';
import { buildLineup } from './match/lineup';
import { migrateLeague } from './migrate';
import { isAvailable, retirePlayer, slimRetired } from './roster';
import { SAVE_VERSION } from './generate';
import { outFor } from '../ui/pregame';
import type { League, Player } from './types';

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
    const p = l.players[team.depthChart.QB[0]];
    ban(p, 1);
    for (; l.week < w; ) {
      playWeek(l);
      // Not his bye yet: he serves his one game on his first game played.
      if (p.suspension?.games === 0 || !p.suspension) break;
    }
    // Move to the bye week with a fresh ban and check it holds.
    const l2 = createLeague({ seed: 'cd-bye' });
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
