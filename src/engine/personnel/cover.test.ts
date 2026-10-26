import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague, generatePlayer } from '../generate';
import { freeAgents } from '../offseason/negotiation';
import { activeRoster, isAvailable, practiceSquad, slotOf } from '../roster';
import { perceive } from '../scouting';
import type { Injury, League, Player } from '../types';
import type { Elevation } from './types';
import { squadCover } from './cover';
import { elevationRecords, nextTeamGame, planAIElevations } from './elevations';
import { settleWeek } from './flow';
import { submitPoachOffer, protectionPicks } from './poaching';
import { NEED } from '../injuries';
import { manageInjuries } from '../injuries';
import { Rng } from '../rng';

const template = createLeague({ seed: 'cover-tests', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  for (const t of l.teams) t.carryover = 100_000;
});
const hurt = (weeks: number): Injury => ({
  type: 'Ankle sprain',
  severity: 'moderate',
  weeksRemaining: weeks,
  estimate: [Math.max(1, weeks - 1), weeks],
  season: l.season,
  week: 1,
  where: 'game',
});
/** An AI club and a position where it has a healthy squad player. */
function setup(): { team: number; pos: Player['position']; squad: Player } {
  for (const t of l.teams.filter((t) => t.id !== 0)) {
    const s = practiceSquad(l, t.id).find((p) => !p.injury);
    if (s) return { team: t.id, pos: s.position, squad: s };
  }
  throw new Error('no squad');
}
const starter = (team: number, pos: string) => activeRoster(l, team).filter((p) => p.position === pos)[0];

describe('AI cover uses the practice squad', () => {
  it('a short absence with a squad player there is a call-up, not a signing', () => {
    const { team, pos } = setup();
    starter(team, pos).injury = hurt(2);
    expect(squadCover(l, team, pos)).toBe('callup');
  });

  it('with his call-ups used up, it is not', () => {
    const { team, pos, squad } = setup();
    starter(team, pos).injury = hurt(2);
    const records: Elevation[] = [];
    l.personnel!.elevations = { season: l.season, records, blocked: {} };
    for (let g = 0; g < 3; g++)
      records.push({
        playerId: squad.id,
        teamId: team,
        gameId: 9000 + g,
        status: 'reverted',
        additionalCap: 0,
        weeklyPay: 13.75,
      });
    for (const other of practiceSquad(l, team).filter((p) => p.position === pos && p.id !== squad.id))
      other.injury = hurt(5);
    expect(elevationRecords(l)).toHaveLength(3);
    expect(squadCover(l, team, pos)).not.toBe('callup');
  });

  it('a long absence promotes the own squad player when he reads at least the best free agent', () => {
    const { team, pos } = setup();
    starter(team, pos).injury = hurt(8);
    for (const f of freeAgents(l).filter((f) => f.position === pos)) f.retired = true;
    const pick = squadCover(l, team, pos);
    expect(typeof pick).toBe('object');
    expect((pick as Player).teamId).toBe(team);
  });

  it('a long absence with a better free agent available is left to free agency', () => {
    const { team, pos } = setup();
    starter(team, pos).injury = hurt(8);
    const fa = generatePlayer(new Rng('cover-fa'), {
      id: l.nextPlayerId++,
      position: pos,
      quality: 10,
      age: 26,
      teamId: null,
      jerseysUsed: new Set(),
    });
    fa.contract = null;
    l.players[fa.id] = fa;
    for (const k of Object.keys(fa.ratings) as (keyof Player['ratings'])[]) fa.ratings[k] = 20;
    fa.injury = undefined;
    expect(perceive(l, team, fa).ovr).toBeGreaterThan(10);
    expect(squadCover(l, team, pos)).toBeNull();
  });
});

describe('in the injury-cover pass', () => {
  /** An AI club with a healthy squad QB. */
  const qbClub = () =>
    l.teams.find((t) => t.id !== 0 && practiceSquad(l, t.id).some((p) => p.position === 'QB' && !p.injury))!.id;
  const qbIds = (team: number) =>
    activeRoster(l, team)
      .filter((p) => p.position === 'QB')
      .map((p) => p.id)
      .sort();

  it('a short absence signs nobody: the squad QB will be called up', () => {
    const team = qbClub();
    for (const p of activeRoster(l, team).filter((p) => p.position === 'QB')) p.injury = hurt(2);
    const before = qbIds(team);
    manageInjuries(l, l.teams[team], new Rng('short'));
    expect(qbIds(team)).toEqual(before);
  });

  it('a long absence promotes the squad QB when he reads at least the best free agent', () => {
    const team = qbClub();
    for (const p of activeRoster(l, team).filter((p) => p.position === 'QB')) p.injury = hurt(8);
    for (const f of freeAgents(l).filter((f) => f.position === 'QB')) f.retired = true;
    const squadQbs = practiceSquad(l, team)
      .filter((p) => p.position === 'QB')
      .map((p) => p.id);
    manageInjuries(l, l.teams[team], new Rng('long'));
    expect(activeRoster(l, team).some((p) => squadQbs.includes(p.id))).toBe(true);
  });
});

describe('the call-up promise holds', () => {
  it('no promise when the call-up could not be filed (no cap room) or two are already promised this pass', () => {
    const { team, pos } = setup();
    starter(team, pos).injury = hurt(2);
    expect(squadCover(l, team, pos)).toBe('callup');
    expect(squadCover(l, team, pos, 2)).not.toBe('callup');
    l.teams[team].carryover = -1_000_000;
    expect(squadCover(l, team, pos)).not.toBe('callup');
  });

  it('the planner calls up a squad player for a position short of its need, not only of its starters', () => {
    const team = l.teams.find(
      (t) => t.id !== 0 && practiceSquad(l, t.id).some((p) => p.position === 'WR' && !p.injury),
    )!.id;
    const wrs = activeRoster(l, team).filter((p) => p.position === 'WR');
    // Healthy receivers: one short of the need (4), still at least the starters (3).
    for (const p of wrs.slice(NEED.WR - 1)) p.injury = hurt(2);
    // Worse than every receiver the club has: only being short at the position can earn him the call-up.
    for (const p of practiceSquad(l, team).filter((p) => p.position === 'WR'))
      for (const k of Object.keys(p.ratings) as (keyof Player['ratings'])[]) p.ratings[k] = 2;
    const g = nextTeamGame(l, team)!;
    planAIElevations(l, g);
    const squadWRs = practiceSquad(l, team)
      .filter((p) => p.position === 'WR')
      .map((p) => p.id);
    expect(elevationRecords(l).some((e) => e.teamId === team && squadWRs.includes(e.playerId))).toBe(true);
  });

  it('a club whose promised call-up was poached signs cover at the settle', () => {
    // Quarterback: nobody from another position can line up there, so only a call-up or a signing covers it.
    const team = l.teams.find((t) => {
      if (t.id === 0) return false;
      const qbs = practiceSquad(l, t.id).filter((p) => p.position === 'QB');
      const g = nextTeamGame(l, 0)!;
      return (
        qbs.length === 1 && !protectionPicks(l, t.id).includes(qbs[0].id) && g.homeId !== t.id && g.awayId !== t.id
      );
    })?.id;
    expect(team).toBeDefined();
    const qbs = activeRoster(l, team!).filter((p) => p.position === 'QB');
    for (const p of qbs.slice(1)) p.injury = hurt(2);
    const healthy = () => activeRoster(l, team!).filter((p) => slotOf(l, p) === 'QB' && isAvailable(p)).length;
    manageInjuries(l, l.teams[team!], new Rng('promise'));
    expect(healthy()).toBe(1); // a call-up promised, nobody signed
    const target = practiceSquad(l, team!).find((p) => p.position === 'QB')!;
    const out = activeRoster(l, 0)
      .filter((x) => x.position === 'WR')
      .at(-1)!;
    out.teamId = null;
    out.contract = null;
    submitPoachOffer(l, { playerId: target.id, teamId: 0, years: 2 });
    settleWeek(l);
    expect(target.teamId).toBe(0);
    expect(healthy()).toBeGreaterThanOrEqual(NEED.QB);
  });
});
