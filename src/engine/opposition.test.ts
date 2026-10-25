import { describe, it, expect } from 'vitest';
import { createLeague } from './generate';
import { focusMatchups } from './opposition';
import type { Game, TeamGameStats } from './types';
const base = createLeague({ seed: 'focus-report' });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const stats: TeamGameStats = {
  firstDowns: 20,
  plays: 65,
  totalYds: 310,
  passYds: 210,
  rushYds: 100,
  passAtt: 30,
  passCmp: 20,
  rushAtt: 25,
  sacked: 1,
  turnovers: 0,
  penalties: 3,
  penaltyYds: 20,
  thirdDownAtt: 12,
  thirdDownConv: 5,
  fourthDownAtt: 0,
  fourthDownConv: 0,
  redZoneAtt: 3,
  redZoneTd: 2,
  top: 1800,
};
function setup() {
  const l = copy(base);
  l.userTeamId = 0;
  l.week = 6;
  l.games = [];
  for (const p of Object.values(l.players)) {
    l.knowledge[p.id] = 1;
    for (const k of Object.keys(p.ratings)) p.ratings[k as keyof typeof p.ratings] = 10;
  }
  const game = (homeId: number, awayId: number, week: number): Game => ({
    id: l.nextGameId++,
    season: l.season,
    homeId,
    awayId,
    week,
    result: {
      homeScore: 24,
      awayScore: 10,
      overtime: false,
      quarters: { home: [7, 7, 7, 3], away: [0, 7, 0, 3] },
      home: { ...stats },
      away: { ...stats },
      playerStats: {},
      playerTeams: {},
    },
  });
  for (let w = 1; w <= 5; w++) {
    l.games.push(game(0, 4, w), game(1, 5, w), game(2, 3, w));
    for (let t = 6; t < 32; t += 2) l.games.push(game(t, t + 1, w));
  }
  return l;
}
describe('focused opposition briefing', () => {
  it('finds one clear line matchup and grounds it in sacks and dropbacks', () => {
    const l = setup();
    for (const p of Object.values(l.players))
      if ((p.teamId === 0 && p.position === 'OL') || (p.teamId === 1 && ['DT', 'EDGE'].includes(p.position)))
        for (const k of Object.keys(p.ratings)) p.ratings[k as keyof typeof p.ratings] = p.teamId === 0 ? 20 : 1;
    const focus = focusMatchups(l, 1);
    expect(focus.length).toBeLessThanOrEqual(2);
    const line = focus.find((f) => f.side === 'attack' && f.matchup.title === 'Trenches')!;
    expect(line).toBeDefined();
    expect(line.label).toContain('Clear scouted edge: ours');
    expect(line.facts).toHaveLength(2);
    expect(line.facts[0].label).toBe('Sacks allowed');
    expect(line.facts[0].value).toBe('3.2% of dropbacks');
    expect(line.facts[0].games).toBe(5);
  });
  it('gives one honest close contest when all units look alike', () => {
    const l = setup();
    const [focus, ...rest] = focusMatchups(l, 1);
    expect(rest).toHaveLength(0);
    expect(focus.advantage).toBeNull();
    expect(focus.why).toContain('Neither group has a clear advantage');
  });
  it('uses season efficiency to find an opening when the scouting grades are level', () => {
    const l = setup();
    for (const g of l.games) {
      if (g.homeId === 0) g.result!.home.passYds = 330;
      if (g.homeId === 1) g.result!.away.passYds = 300;
    }
    const [focus] = focusMatchups(l, 1);
    expect(focus.side).toBe('attack');
    expect(focus.matchup.title).toBe('Pass game');
    expect(focus.label).toBe('Results edge: ours');
    expect(focus.facts[0].value).toBe('11.0 yards per attempt');
  });
  it('calls out results that contradict a clear scouting edge', () => {
    const l = setup();
    for (const p of Object.values(l.players))
      if ((p.teamId === 0 && p.position === 'OL') || (p.teamId === 1 && ['DT', 'EDGE'].includes(p.position)))
        for (const k of Object.keys(p.ratings)) p.ratings[k as keyof typeof p.ratings] = p.teamId === 0 ? 20 : 1;
    for (const g of l.games) {
      if (g.homeId === 0) g.result!.home.sacked = 7;
      if (g.homeId === 1) g.result!.away.sacked = 5;
    }
    const line = focusMatchups(l, 1).find((f) => f.side === 'attack' && f.matchup.title === 'Trenches')!;
    expect(line.why).toContain('season results point the other way');
  });
  it('does not use future games or fabricate statistics before enough games exist', () => {
    const l = setup();
    const before = focusMatchups(l, 1);
    const future = copy(l.games[0]);
    future.week = 6;
    future.result!.home.sacked = 100;
    l.games.push(future);
    expect(focusMatchups(l, 1)).toEqual(before);
    l.week = 3;
    expect(focusMatchups(l, 1).every((f) => f.facts.length === 0)).toBe(true);
  });
});
