import { beforeAll, describe, expect, it } from 'vitest';
import { assessCoachAdvice, updateCoachAdvice, adviceKey } from './coachDecisions';
import { coachAdviceObservation, userCoachGameObservation } from './coachReports';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { deliverMail, deleteMail } from './inbox';
import { simulateGame, startGame } from './match/gameSim';
import { teamPlayers, isAvailable } from './roster';
import { ATTRIBUTES, type CoachAdvice, type GameResult, type League } from './types';

let world: League, result: GameResult;
beforeAll(() => {
  world = createLeague({ seed: 'coach-story-tests' });
  result = simulateGame(world, world.games[0]);
});
const copy = <T>(v: T): T => structuredClone(v);
function suggestion() {
  const l = copy(world),
    t = l.teams[0],
    staff = teamCoaches(l, 0),
    c = staff.find((c) => c.room === 'WR')!;
  for (const coach of staff) coach.quirks = {};
  c.quirks = { earnYourReps: 2 };
  const wr = teamPlayers(l, 0).filter((p) => p.position === 'WR');
  for (const [i, p] of wr.entries()) for (const key of ATTRIBUTES) p.ratings[key] = i < 2 ? 16 : i < 4 ? 12 : 8;
  const veteran = wr[2],
    p = wr[3];
  veteran.traits.workEthic = 5;
  p.traits.workEthic = 18;
  t.autoDepth = false;
  t.depthChart.WR = wr.map((p) => p.id);
  return { l, t, staff, c, p, veteran };
}
function watchedTrial() {
  const { l, t, staff, c, p, veteran } = suggestion();
  l.week = 7;
  t.depthChart.WR = t.depthChart.WR.filter((id) => id !== p.id);
  t.depthChart.WR.unshift(p.id);
  const a: CoachAdvice = {
    season: l.season,
    week: 1,
    coachId: c.id,
    coachName: `${c.firstName} ${c.lastName}`,
    position: 'WR',
    playerId: p.id,
    playerName: `${p.firstName} ${p.lastName}`,
    aheadId: veteran.id,
    aheadName: `${veteran.firstName} ${veteran.lastName}`,
    reason: 'trusts his preparation',
    applied: true,
    baselineGames: 0,
    resolved: 'The initial trial was promising.',
    review: { week: 2, promising: true, adopted: true },
    noted: { offer: 1, followup: 3 },
  };
  t.coachAdvice = [a];
  const games = [3, 4, 5].map((week) => {
    const r = copy(result);
    r.playerStats = { [p.id]: { gp: 1, snaps: 40, targets: 4, rec: 1, recYds: 4 } };
    r.playerTeams = { [p.id]: 0 };
    const g = { ...l.games[0], id: 9000 + week, week, homeId: 0, awayId: 1, result: r };
    l.games.push(g);
    return g;
  });
  const update = () => updateCoachAdvice(l, t, staff, teamPlayers(l, 0).filter(isAvailable));
  return { l, t, staff, c, p, veteran, a, games, update };
}
describe('bounded coaching conversations', () => {
  it('suppresses both directions and replacement coaches after readable history is trimmed', () => {
    const { l, t, staff, c, p, veteran } = suggestion();
    const before = copy(l);
    expect(assessCoachAdvice(l, t, staff, teamPlayers(l, 0))).toBeDefined();
    expect(l).toEqual(before);
    updateCoachAdvice(l, t, staff, teamPlayers(l, 0));
    expect(t.coachAdvice).toHaveLength(1);
    t.coachAdvice = [];
    l.week = 12;
    const replacement = { ...c, id: 9999 };
    const newStaff = staff.map((x) => (x.id === c.id ? replacement : x));
    expect(assessCoachAdvice(l, t, newStaff, teamPlayers(l, 0))).toBeUndefined();
    p.traits.workEthic = 5;
    veteran.traits.workEthic = 18;
    for (const key of ATTRIBUTES) p.ratings[key] = 12.1;
    expect(assessCoachAdvice(l, t, newStaff, teamPlayers(l, 0))).toBeUndefined();
    delete t.coachAdviceMemory;
    expect(assessCoachAdvice(l, t, newStaff, teamPlayers(l, 0))?.playerId).toBe(veteran.id);
  });
  it('keeps season memory across save/load and clears its restriction in a new season', () => {
    const { l, t, staff } = suggestion();
    updateCoachAdvice(l, t, staff, teamPlayers(l, 0));
    t.coachAdvice = [];
    const loaded = JSON.parse(JSON.stringify(l)) as League;
    loaded.week = 15;
    expect(assessCoachAdvice(loaded, loaded.teams[0], teamCoaches(loaded, 0), teamPlayers(loaded, 0))).toBeUndefined();
    loaded.season++;
    expect(assessCoachAdvice(loaded, loaded.teams[0], teamCoaches(loaded, 0), teamPlayers(loaded, 0))).toBeDefined();
  });
  it('bounds season suggestions even if six readable threads were removed', () => {
    const { l, t, staff } = suggestion();
    t.coachAdviceMemory = {
      season: l.season,
      players: [],
      pairs: ['1:2', '3:4', '5:6', '7:8', '9:10', '11:12'],
      positions: {},
    };
    expect(assessCoachAdvice(l, t, staff, teamPlayers(l, 0))).toBeUndefined();
  });
  it('allows one sustained-slump revisit, files it once, and stays closed after deletion and rebound', () => {
    const { l, a, p, games, update } = watchedTrial();
    update();
    expect(a.revisit?.text).toContain('last three games');
    const before = copy(l);
    expect(coachAdviceObservation(l)?.kind).toBe('revisit');
    expect(l).toEqual(before);
    deliverMail(l);
    const message = l.inbox!.find((m) => m.coachNoteKey === adviceKey(a, 'revisit'))!;
    expect(message.coachNote?.kind).toBe('revisit');
    expect(a.noted?.revisit).toBe(l.week);
    deleteMail(l, [message.id]);
    l.inbox = [];
    expect(coachAdviceObservation(l)).toBeUndefined();
    for (const g of games) g.result.playerStats[p.id] = { gp: 1, snaps: 40, targets: 8, rec: 7, recYds: 120 };
    for (let week = 8; week <= 18; week++) {
      l.week = week;
      update();
      expect(coachAdviceObservation(l)).toBeUndefined();
    }
    expect(a.revisit).toBeDefined();
  });
  it.each([
    'oneGoodGame',
    'lowVolume',
    'cooldown',
    'notAdopted',
    'poorInitialTrial',
    'coachLeft',
    'playerUnavailable',
    'trialReversed',
  ] as const)('does not reopen for $0', (reason) => {
    const { l, t, c, p, a, games, update } = watchedTrial();
    if (reason === 'oneGoodGame') games[1].result.playerStats[p.id] = { gp: 1, targets: 4, rec: 3, recYds: 50 };
    if (reason === 'lowVolume')
      for (const g of games) g.result.playerStats[p.id] = { gp: 1, targets: 1, rec: 0, recYds: 0 };
    if (reason === 'cooldown') l.week = 6;
    if (reason === 'notAdopted') a.review!.adopted = false;
    if (reason === 'poorInitialTrial') a.review!.promising = false;
    if (reason === 'coachLeft') c.teamId = null;
    if (reason === 'playerUnavailable')
      p.injury = {
        type: 'hamstring',
        severity: 'moderate',
        weeksRemaining: 3,
        estimate: [2, 4],
        season: l.season,
        week: l.week,
        where: 'game',
      };
    if (reason === 'trialReversed') {
      t.depthChart.WR = t.depthChart.WR.filter((id) => id !== p.id);
      t.depthChart.WR.push(p.id);
    }
    update();
    expect(a.revisit).toBeUndefined();
  });
  it('does not republish the initial check-in after a message is removed', () => {
    const { l, a, update } = watchedTrial();
    a.noted = { offer: 1 };
    update();
    expect(coachAdviceObservation(l)?.kind).toBe('followup');
    deliverMail(l);
    expect(a.noted?.followup).toBe(l.week);
    l.inbox = [];
    expect(coachAdviceObservation(l)).toBeUndefined();
  });
});

describe('recorded defensive decisions', () => {
  it('keeps facts identical in live/batch and with replay retention disabled', () => {
    const g = world.games[0],
      options = { seed: 'defense-story-parity', keepPlays: true };
    const batch = simulateGame(world, g, options),
      quiet = simulateGame(world, g, { ...options, keepPlays: false });
    const live = startGame(world, g, options);
    while (!live.over) live.next();
    expect(live.result()).toEqual(batch);
    expect(quiet.coaching).toEqual(batch.coaching);
    expect(quiet.playerStats).toEqual(batch.playerStats);
  });
  it('requires meaningful late facts, preserves names, and recognizes coverage and costly pressure too', () => {
    const l = copy(world),
      g = copy(l.games.find((g) => g.homeId === 0)!);
    g.result = copy(result);
    g.result.homeScore = 24;
    g.result.awayScore = 20;
    const dc = teamCoaches(l, 0).find((c) => c.role === 'defCoord')!;
    const e = {
      quarter: 4,
      clock: 72,
      down: 4,
      distance: 6,
      call: 'blitz' as const,
      outcome: 'fourthDownStop' as const,
      text: 'J.Brown SACKED by M.Allen for -8 yards',
      marginBefore: 4,
      marginAfter: 4,
    };
    g.result.coaching = [
      {
        coachId: dc.id,
        name: 'Original Coordinator',
        role: 'defCoord',
        teamId: 0,
        opportunities: {},
        choices: {},
        uses: { thirdDownHeat: 1 },
        events: [],
        defensiveDecisions: [e],
      },
    ];
    expect(userCoachGameObservation(l, g)).toContain('Original Coordinator, sent pressure on fourth-and-6');
    expect(userCoachGameObservation(l, g)).toContain('M.Allen');
    dc.firstName = 'Changed';
    expect(userCoachGameObservation(l, g)).toContain('Original Coordinator');
    e.clock = 500;
    expect(userCoachGameObservation(l, g)).toBe('');
    e.clock = 72;
    g.result.coaching[0].defensiveDecisions![0] = { ...e, call: 'passD' };
    expect(userCoachGameObservation(l, g)).toContain('leaned on coverage');
    g.result.homeScore = 20;
    g.result.awayScore = 24;
    g.result.coaching[0].defensiveDecisions![0] = {
      ...e,
      outcome: 'touchdownAllowed',
      marginAfter: -4,
      text: 'J.Brown passes to A.White for a TOUCHDOWN',
    };
    expect(userCoachGameObservation(l, g)).toContain('giving them a late lead');
  });
});
