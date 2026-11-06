import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GRIP,
  BLANKS,
  BLANKS_OLD,
  BLOWUP_SHARE,
  STARTING_HABITS,
  addMarbles,
  aiGm,
  archetypeOf,
  bagOf,
  draftedBy,
  drawHabits,
  gunShyAt,
  habitOn,
  logMove,
  noteRelease,
  startHabits,
  usedThisYear,
} from './gmHabits';
import { createLeague } from './generate';
import { Rng } from './rng';
import type { GeneralManager, League, Player, Team } from './types';

function setup(seed = 'habits'): { l: League; team: Team; gm: GeneralManager } {
  const l = createLeague({ seed });
  const team = l.teams.find((t) => t.id !== l.userTeamId)!;
  return { l, team, gm: aiGm(l, team)! };
}

describe('gm habits', () => {
  it('reads a habit only at grip 2 or more, never for your club or a vacancy', () => {
    const { l, team, gm } = setup();
    gm.habits = { swaps: { grip: 1 } };
    expect(habitOn(l, team, 'swaps')).toBe(false);
    gm.habits.swaps.grip = 2;
    expect(habitOn(l, team, 'swaps')).toBe(true);
    expect(habitOn(l, l.teams[l.userTeamId], 'swaps')).toBe(false);
    team.gmId = null;
    expect(aiGm(l, team)).toBeUndefined();
    expect(habitOn(l, team, 'swaps')).toBe(false);
  });

  it('reads Gun-Shy only at its position', () => {
    const { l, team, gm } = setup();
    gm.habits = { gunShy: { grip: 2, pos: 'WR' } };
    expect(gunShyAt(l, team, 'WR')).toBe(true);
    expect(gunShyAt(l, team, 'QB')).toBe(false);
    gm.habits.gunShy.grip = 1;
    expect(gunShyAt(l, team, 'WR')).toBe(false);
  });

  it('starts a GM on his archetype’s first habit, Balanced at random, never the user', () => {
    const { l, team, gm } = setup();
    for (const t of l.teams) {
      const g = aiGm(l, t);
      if (!g) continue;
      startHabits(l, g);
      const a = archetypeOf(l, g);
      const keys = Object.keys(g.habits!);
      expect(keys).toHaveLength(1);
      expect(g.habits![keys[0]].grip).toBe(ACTIVE_GRIP);
      expect(keys[0]).not.toBe('gunShy');
      const first = STARTING_HABITS[a][0];
      if (first) expect(keys[0]).toBe(first);
    }
    const before = JSON.stringify(gm.habits);
    startHabits(l, gm);
    expect(JSON.stringify(gm.habits)).toBe(before);
    expect(team.id).not.toBe(l.userTeamId);
    const user = l.gms[l.userGmId];
    startHabits(l, user);
    expect(user.habits).toBeUndefined();
  });

  it('logs moves for AI clubs only and prunes past eight years', () => {
    const { l, team, gm } = setup();
    logMove(l, l.teams[l.userTeamId], 'swaps');
    expect(l.gms[l.userGmId].habitLog).toBeUndefined();
    logMove(l, team, 'swaps');
    l.season += 9;
    logMove(l, team, 'bpa');
    expect(gm.habitLog!.map((m) => m.habit)).toEqual(['bpa']);
    expect(gm.habitLog![0]).toMatchObject({ season: l.season, teamId: team.id });
  });

  it('fills the bag from blanks, archetype marbles and the year’s marbles', () => {
    const { l, team, gm } = setup();
    team.gm.archetype = 'All-In';
    gm.age = 50;
    let bag = bagOf(l, gm);
    expect(bag.filter((m) => m === 'blank')).toHaveLength(BLANKS);
    expect(bag.filter((m) => m === 'firstsForStars')).toHaveLength(2);
    expect(bag.filter((m) => m === 'bridgeQb')).toHaveLength(2);
    expect(bag).toHaveLength(BLANKS + 4);
    gm.age = 55;
    expect(bagOf(l, gm).filter((m) => m === 'blank')).toHaveLength(BLANKS_OLD);
    addMarbles(gm, 'swaps', 3);
    bag = bagOf(l, gm);
    expect(bag.filter((m) => m === 'swaps')).toHaveLength(3);
    team.gm.archetype = 'Balanced';
    bag = bagOf(l, gm);
    expect(bag.filter((m) => m === 'bpa')).toHaveLength(1);
    expect(bag).not.toContain('gunShy');
  });

  it('draws three, caps grip at 3 and active habits at 3, fades to zero, clears the marbles', () => {
    const { l, gm } = setup();
    gm.habits = { swaps: { grip: 2 } };
    addMarbles(gm, 'swaps', 500);
    drawHabits(l, gm, new Rng('d1'));
    expect(gm.habits.swaps.grip).toBe(3);
    expect(gm.habitMarbles).toBeUndefined();

    gm.habits = { bpa: { grip: 2 }, hisGuys: { grip: 2 }, swaps: { grip: 2 } };
    addMarbles(gm, 'youngQb', 500);
    drawHabits(l, gm, new Rng('d2'));
    expect(gm.habits.youngQb.grip).toBe(1);

    gm.habits = { swaps: { grip: 2 } };
    addMarbles(gm, 'fade:swaps', 500);
    addMarbles(gm, 'fade:bpa', 500);
    drawHabits(l, gm, new Rng('d3'));
    expect(gm.habits.swaps).toBeUndefined();
    expect(gm.habits.bpa).toBeUndefined();
  });

  it('never forms Gun-Shy from a draw', () => {
    const { l, gm } = setup();
    gm.habits = {};
    addMarbles(gm, 'gunShy', 500);
    drawHabits(l, gm, new Rng('g'));
    expect(gm.habits.gunShy).toBeUndefined();
    gm.habits = { gunShy: { grip: 1, pos: 'RB' } };
    addMarbles(gm, 'gunShy', 500);
    drawHabits(l, gm, new Rng('g'));
    expect(gm.habits.gunShy).toEqual({ grip: 3, pos: 'RB' });
  });

  it('forms Gun-Shy on a blowup at his own signing only', () => {
    const { l, team, gm } = setup();
    gm.appointments = [{ teamId: team.id, start: { season: l.season - 2 } as never, interim: false, through: 0 }];
    const dead = BLOWUP_SHARE * l.caps[l.season];
    const p = Object.values(l.players).find((x) => x.teamId === team.id && x.position === 'WR')!;
    const c = p.contract!;
    c.signedSeason = l.season - 3;
    c.signedWeek = 0;
    noteRelease(l, team, p, dead);
    expect(gm.habits?.gunShy).toBeUndefined();
    c.signedSeason = l.season - 1;
    noteRelease(l, team, p, dead - 1);
    expect(gm.habits?.gunShy).toBeUndefined();
    noteRelease(l, team, p, dead);
    expect(gm.habits!.gunShy).toEqual({ grip: 1, pos: 'WR' });
    expect(gm.habitMarbles!.gunShy).toBe(3);
    expect(gm.habitLog).toHaveLength(1);
    expect(gm.habitLog![0]).toMatchObject({ habit: 'gunShy', playerId: p.id, pos: 'WR' });
  });

  it('knows who drafted a player', () => {
    const { team, gm } = setup();
    gm.appointments = [
      {
        teamId: team.id,
        start: { season: 2030 } as never,
        end: { season: 2033 } as never,
        interim: false,
        through: 0,
        priorSeasons: 2,
      },
    ];
    const p = { draft: { season: 2028, teamId: team.id } } as Player;
    expect(draftedBy(gm, p)).toBe(true);
    p.draft!.season = 2027;
    expect(draftedBy(gm, p)).toBe(false);
    p.draft!.season = 2034;
    expect(draftedBy(gm, p)).toBe(false);
    expect(draftedBy(gm, {} as Player)).toBe(false);
  });

  it('survives a GM record with no habit fields', () => {
    const { l, team, gm } = setup();
    delete gm.habits;
    delete gm.habitLog;
    delete gm.habitMarbles;
    expect(usedThisYear(gm, 'swaps', l.season)).toBe(false);
    expect(bagOf(l, gm).length).toBeGreaterThan(0);
    logMove(l, team, 'swaps');
    expect(usedThisYear(gm, 'swaps', l.season)).toBe(true);
    delete gm.habitLog;
    addMarbles(gm, 'bpa', 1);
    expect(usedThisYear(gm, 'bpa', l.season)).toBe(true);
  });

  it('draws only from its own stream', () => {
    const a = setup('same');
    const b = setup('same');
    for (const t of a.l.teams) {
      const g = aiGm(a.l, t);
      if (!g) continue;
      startHabits(a.l, g);
      drawHabits(a.l, g, new Rng(`${a.l.seed}:test:${g.id}`));
      logMove(a.l, t, 'swaps');
    }
    expect(a.l.rngState).toEqual(b.l.rngState);
  });
});
