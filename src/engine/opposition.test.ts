import { describe, it, expect } from 'vitest';
import { createLeague } from './generate';
import { focusMatchups, MATCHUP_LINES, type MatchupWords } from './opposition';
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
    expect(line.label).toBe('Edge: us');
    expect(line).toMatchObject({ basis: 'film', clear: true, tag: 'us' });
    expect(line.heading).toBe('Our offensive line vs their pass rush');
    expect(line.why).toMatch(/^Our scouts grade our offensive line well ahead of their pass rush\./);
    expect(line.ours!.label).toBe('allows a sack on 3.2% of dropbacks');
    expect(line.theirs!.label).toBe('gets a sack on 3.2% of dropbacks');
    expect(line.ours!.games).toBe(5);
  });
  it('gives one honest close contest when all units look alike', () => {
    const l = setup();
    const [focus, ...rest] = focusMatchups(l, 1);
    expect(rest).toHaveLength(0);
    expect(focus.advantage).toBeNull();
    expect(focus.label).toBe('Even');
    expect(focus.tag).toBe('even');
    expect(focus.why).toMatch(/^Our scouts see nothing between our .* and their [a-z ]+\./);
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
    expect(focus.label).toBe('Edge: us');
    expect(focus.basis).toBe('results');
    expect(focus.tag).toBe('us');
    expect(focus.heading).toBe('Our passing game vs their coverage');
    expect(focus.why).toContain('Our scouts see nothing between our passing game and their coverage.');
    expect(focus.why).toMatch(/The stats this season (favor|lean toward) us\./);
    expect(focus.ours!.label).toBe('gains 11.0 yards an attempt');
  });
  it('tags a matchup Split when the film favours us and the stats favour them, and never makes the scouts wrong', () => {
    const l = setup();
    for (const p of Object.values(l.players))
      if ((p.teamId === 0 && p.position === 'OL') || (p.teamId === 1 && ['DT', 'EDGE'].includes(p.position)))
        for (const k of Object.keys(p.ratings)) p.ratings[k as keyof typeof p.ratings] = p.teamId === 0 ? 20 : 1;
    for (const g of l.games) {
      if (g.homeId === 0) g.result!.home.sacked = 7;
      if (g.homeId === 1) g.result!.away.sacked = 5;
    }
    const line = focusMatchups(l, 1).find((f) => f.side === 'attack' && f.matchup.title === 'Trenches')!;
    expect(line.tag).toBe('split');
    expect(line.label).toBe('Split');
    expect(line.lean).toBe('them');
    expect(line.why).toMatch(/They (are performing|have performed) above expectations this season\./);
    expect(line.why).toContain('They get a sack on');
  });
  it('puts our unit first on the other side of the ball, and says when it is below expectations', () => {
    const l = setup();
    for (const p of Object.values(l.players))
      if ((p.teamId === 0 && ['DT', 'EDGE'].includes(p.position)) || (p.teamId === 1 && p.position === 'OL'))
        for (const k of Object.keys(p.ratings)) p.ratings[k as keyof typeof p.ratings] = p.teamId === 0 ? 20 : 1;
    for (const g of l.games) {
      if (g.homeId === 0) g.result!.away.sacked = 0; // our rush gets nobody
      if (g.homeId === 1) g.result!.home.sacked = 9; // their line gives up plenty
    }
    const rush = focusMatchups(l, 1).find((f) => f.side === 'defend' && f.matchup.title === 'Trenches')!;
    expect(rush.heading).toBe('Our pass rush vs their offensive line');
    expect(rush.tag).toBe('us');
    expect(rush.ours!.teamId).toBe(0);
    expect(rush.why).toMatch(
      /We (are performing|have performed) below expectations this season(, ranked| and sit) 32nd in sacks\./,
    );
    expect(rush.why).toMatch(/They are \d+(st|nd|rd|th) at preventing sacks\.$/);
  });
  it('keeps every wording to the rules: the stats this season, no contradiction, no colon or semicolon', () => {
    const fact = (label: string, place: string, rank: number) => ({ label, place, rank });
    const c: MatchupWords = {
      ours: 'offensive line',
      theirs: 'pass rush',
      ahead: 'ahead of',
      mine: fact('allows a sack on 5.1% of dropbacks', 'at preventing sacks', 15),
      them: fact('gets a sack on 10.5% of dropbacks', 'in sacks', 2),
    };
    const all = Object.values(MATCHUP_LINES).flatMap((bank) => bank.map((line) => line(c)));
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const why of all) {
      expect(why).not.toMatch(/say otherwise|should win|On talent|numbers|;|:/);
      expect(why).toMatch(/^Our scouts /);
      expect(why).not.toMatch(/undefined|NaN/);
    }
    // The units are named once, in the first sentence. After it they are "we" and "they".
    for (const why of all) {
      const [, ...rest] = why.split(/(?<=\.) /);
      expect(rest.join(' ')).not.toMatch(/\b(our|their)\b/i);
    }
    // Wherever the stats are spoken of, they are "the stats this season".
    for (const why of all.filter((w) => /stats/.test(w))) expect(why).toMatch(/[Tt]he stats this season/);
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
    expect(focusMatchups(l, 1).every((f) => f.ours === null && f.theirs === null && f.lean === null)).toBe(true);
  });
});
