import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { IR_MIN_WEEKS, IR_RETURNS } from './injuries';
import { migrateLeague } from './migrate';
import { briefingCurrent, deliverMail, draftClassOf, mailSubject, needsYou } from './inbox';
import { emptyMarket } from './trade/execute';
import { keyTradeNews, rumorNews, tradeNewsWindow } from './tradeNews';
import { divisionTable, teamStatContext } from './newsContext';
import { leagueNews, matchupStakes, rookieImpactMail } from './news';
import type { Game, GameResult, League, TeamGameStats } from './types';

const base = createLeague({ seed: 'news-desk' });
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const blank: TeamGameStats = {
  firstDowns: 0,
  plays: 60,
  totalYds: 0,
  passYds: 0,
  rushYds: 0,
  passAtt: 0,
  passCmp: 0,
  rushAtt: 0,
  sacked: 0,
  turnovers: 0,
  penalties: 0,
  penaltyYds: 0,
  thirdDownAtt: 0,
  thirdDownConv: 0,
  fourthDownAtt: 0,
  fourthDownConv: 0,
  redZoneAtt: 0,
  redZoneTd: 0,
  top: 1800,
};
function game(l: League, homeId: number, awayId: number, week: number, homeScore = 24, awayScore = 10): Game {
  const result: GameResult = {
    homeScore,
    awayScore,
    overtime: false,
    quarters: { home: [7, 7, 7, 3], away: [0, 7, 0, 3] },
    home: { ...blank },
    away: { ...blank },
    playerStats: {},
    playerTeams: {},
  };
  return { id: l.nextGameId++, season: l.season, homeId, awayId, week, result };
}
function trajectory(count = 8): League {
  const l = copy(base);
  l.games = Array.from({ length: count }, (_, i) => game(l, 0, 4, i + 1));
  // A future fixture keeps these eight games from being treated as a finished season.
  l.games.push({ ...game(l, 0, 4, 18), result: undefined });
  l.week = count + 1;
  l.history = [{ season: l.season - 1, championId: 1, runnerUpId: 2, records: { 0: { w: 4, l: 13, t: 0 } } }];
  return l;
}

describe('the public news desk', () => {
  it('uses public results at a checkpoint, with one headline per completed week', () => {
    const l = trajectory();
    const [m] = leagueNews(l, new Set());
    expect(m.from).toBe('The Arena Gazette');
    expect(m.body).toContain('8–0 through 8 games');
    expect(m.body).toContain('4–13');
    expect(m.actions).toContainEqual({ kind: 'team', teamId: 0 });
    expect(mailSubject({ ...m, read: false })).toEqual({ kind: 'news', season: l.season });
    expect(needsYou(l, { ...m, read: false })).toBe(false);
    // Even another candidate cannot take a second slot when the manager makes a same-week mutation.
    expect(leagueNews(l, new Set([m.id]))).toEqual([]);
    const hidden = copy(l);
    for (const p of Object.values(hidden.players)) {
      p.potential = 1;
      p.ratings.speed = 1;
    }
    expect(leagueNews(hidden, new Set())).toEqual([m]);
  });

  it('says nothing without history or a substantial change, or in a partial week', () => {
    const l = trajectory();
    l.history = [];
    expect(leagueNews(l, new Set())).toEqual([]);
    l.history = [{ season: l.season - 1, championId: 1, runnerUpId: 2, records: { 0: { w: 12, l: 5, t: 0 } } }];
    expect(leagueNews(l, new Set())).toEqual([]);
    const partial = trajectory();
    partial.games.push({ ...game(partial, 2, 3, 8), result: undefined });
    expect(leagueNews(partial, new Set())).toEqual([]);
    expect(leagueNews(trajectory(9), new Set())).toEqual([]);
  });

  it('covers a sustained decline and skips intermediate checkpoints after a long advance', () => {
    const l = trajectory(17);
    l.games = l.games.filter((g) => g.result);
    for (const g of l.games) {
      g.result!.homeScore = 10;
      g.result!.awayScore = 24;
    }
    l.history[0].records[0] = { w: 12, l: 5, t: 0 };
    l.phase = 'playoffs';
    const news = leagueNews(l, new Set());
    expect(news).toHaveLength(1);
    expect(news[0].body).toContain('finish the regular season 0–17');
    expect(news[0].body).not.toContain('through 8 games');
    expect(news[0].week).toBe(17);
  });

  it('uses SNN for a late division lead change and respects current tiebreakers', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.games = [];
    // Same-division clubs 0 and 1 start 5–4 and 6–3, then finish tied at 6–4.
    for (let w = 1; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 5 ? 24 : 10, w <= 5 ? 10 : 24));
      l.games.push(game(l, 1, 5, w, w <= 6 ? 24 : 10, w <= 6 ? 10 : 24));
    }
    l.games.push(game(l, 0, 1, 10)); // Direct win gives 0 the head-to-head tiebreaker.
    l.week = 11;
    const [m] = leagueNews(l, new Set());
    expect(m.from).toBe('SNN — Sports News Network');
    expect(m.subject).toContain(l.teams[0].name);
    expect(m.body).toContain('head-to-head edge');
    expect(m.body).not.toMatch(/clinched|champion/);
    expect(m.leagueReport!.standings).toHaveLength(4);
    expect(m.leagueReport!.standings[0]).toMatchObject({ teamId: 0, w: 6, l: 4, gap: 0 });
    expect(m.leagueReport!.stats).toHaveLength(4);
    expect(m.body).toMatch(/^The .* took over first place .* with a 24–10 win over/);
    expect(m.body.split('\n\n')).toHaveLength(2);
    expect(m.body).toContain('6–0 start has given way to four straight defeats');
    const snapshot = copy(m.leagueReport);
    l.inbox = [{ ...m, read: false }];
    l.games = [];
    deliverMail(l);
    expect(l.inbox.find((x) => x.id === m.id)!.leagueReport).toEqual(snapshot);
    // Restore the last fixture before testing partial-week suppression.
    l.games = [game(l, 0, 1, 10)];
    l.games.at(-1)!.result = undefined;
    expect(leagueNews(l, new Set())).toEqual([]);
  });

  it('keeps a statement win in the recap and uses the opponent record before kickoff', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.games = [];
    for (let w = 1; w <= 6; w++) {
      l.games.push(game(l, 0, 4, w, w <= 3 ? 24 : 10, w <= 3 ? 10 : 24));
      l.games.push(game(l, 1, 5, w));
    }
    const win = game(l, 0, 1, 7, 31, 10);
    l.games.push(win);
    for (let w = 8; w <= 15; w++) l.games.push(game(l, 1, 5, w, 10, 24));
    l.week = 16;
    deliverMail(l);
    const recap = l.inbox!.find((m) => m.id === `recap:${l.season}:${win.id}`)!;
    expect(recap.subject).toMatch(/^Statement win:/);
    expect(l.inbox!.filter((m) => m.id.startsWith('recap:'))).toHaveLength(1);
  });

  it('adds matchup stakes only when a win guarantees sole first by percentage', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.week = 10;
    l.games = [];
    for (let w = 1; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 6 ? 24 : 10, w <= 6 ? 10 : 24));
      l.games.push(game(l, 1, 5, w, w <= 7 ? 24 : 10, w <= 7 ? 10 : 24));
    }
    // At 6–3 vs 7–2 a win only ties records; do not promise first place on a tiebreaker.
    expect(matchupStakes(l, 1)).toBeNull();
    l.games.find((g) => g.homeId === 1)!.result!.homeScore = 0;
    expect(matchupStakes(l, 1)?.subject).toContain('take first place');
    expect(matchupStakes(l, 4)).toBeNull();
    // A third division club can still win this week and draw level: our game cannot guarantee sole first.
    for (let w = 1; w <= 9; w++) l.games.push(game(l, 2, 6, w, w <= 6 ? 24 : 10, w <= 6 ? 10 : 24));
    l.games.push({ ...game(l, 2, 6, 10), result: undefined });
    expect(matchupStakes(l, 1)).toBeNull();
  });
});

function rookieLeague(count = 8) {
  const l = trajectory(count);
  l.userTeamId = 0;
  const p = Object.values(l.players).find((p) => p.teamId === 0 && p.position === 'OL')!;
  p.draft = { season: l.season, round: 2, pick: 40, teamId: 0 };
  p.scouting = { grade: 12, ceiling: 15 };
  for (const g of l.games.filter((g) => g.result)) {
    g.result!.playerTeams[p.id] = 0;
    g.result!.playerStats[p.id] = { snaps: 50 };
  }
  return { l, p };
}

describe('rookie impact and delivery', () => {
  const sender = { from: 'Director of scouting' };
  it('counts offensive linemen by snaps and offers a factual midpoint report', () => {
    const { l, p } = rookieLeague();
    const [m] = rookieImpactMail(l, draftClassOf(l, l.season), sender);
    expect(m.subject).toContain('eight games in');
    expect(m.rookieReport!.rows).toContainEqual(
      expect.objectContaining({ playerId: p.id, snaps: 400, name: `${p.firstName} ${p.lastName}` }),
    );
    expect(m.body).not.toContain('400');
    deliverMail(l);
    const saved = copy(l);
    deliverMail(saved);
    expect(saved.inbox).toEqual(l.inbox);
    expect(saved.inbox!.filter((m) => m.id.startsWith('rookies:'))).toHaveLength(1);
  });

  it('uses event-time team identity, excluding work after a rookie leaves', () => {
    const { l, p } = rookieLeague();
    p.teamId = 4;
    l.games[7].result!.playerTeams[p.id] = 4;
    l.games[7].result!.playerStats[p.id] = { snaps: 99 };
    const [m] = rookieImpactMail(l, [p], sender);
    expect(m.rookieReport!.rows[0].snaps).toBe(350);
    expect(m.rookieReport!.rows[0].context).toContain('before leaving the roster');
  });

  it('sends a season review instead of backfilled midpoint mail after a long sim', () => {
    const { l, p } = rookieLeague(17);
    l.games = l.games.filter((g) => g.result);
    l.phase = 'playoffs';
    const [m] = rookieImpactMail(l, [p], sender);
    expect(m.subject).toContain('season in review');
    expect(m.rookieReport!.rows[0].snaps).toBe(850);
    expect(m.body).not.toContain('eight games');
  });

  it('does not invent snap history or report before the eighth game', () => {
    const { l, p } = rookieLeague(7);
    expect(rookieImpactMail(l, [p], sender)).toEqual([]);
    const old = rookieLeague();
    for (const g of old.l.games) if (g.result) delete g.result.playerStats[old.p.id].snaps;
    expect(rookieImpactMail(old.l, [old.p], sender)).toEqual([]);
  });

  it('keeps matchup and deadline briefings current without a Needs you task', () => {
    const l = copy(base);
    deliverMail(l);
    const m = l.inbox!.find((m) => m.id.startsWith('matchup:'))!;
    expect(briefingCurrent(l, m)).toBe(true);
    expect(needsYou(l, m)).toBe(false);
    const deadline = { ...m, id: `deadline:${l.season}:day` };
    expect(needsYou(l, deadline)).toBe(false);
    l.phase = 'complete';
    expect(briefingCurrent(l, deadline)).toBe(false);
  });

  it('only asks for an IR activation when the player is eligible to return', () => {
    const l = copy(base);
    const team = l.teams[l.userTeamId];
    team.autoInjuries = false;
    const p = Object.values(l.players).find((p) => p.teamId === team.id)!;
    delete p.injury;
    p.ir = { season: l.season, week: 1, weeks: IR_MIN_WEEKS - 1 };
    deliverMail(l);
    const note = { ...l.inbox![0], id: `cleared:${l.season}:1:${p.id}:hamstring` };
    expect(needsYou(l, note)).toBe(false);
    p.ir.weeks = IR_MIN_WEEKS;
    expect(needsYou(l, note)).toBe(true);
    team.irReturns = { [l.season]: IR_RETURNS };
    expect(needsYou(l, note)).toBe(false);
  });

  it('migrates existing saves without inventing a discarded-mail history', () => {
    const old = copy(base);
    old.version = 35;
    const migrated = migrateLeague(old)!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.mailFloor).toBeUndefined();
  });
});

function comparisonLeague(): League {
  const l = copy(base);
  l.games = [];
  for (const [season, weeks] of [
    [l.season - 1, 17],
    [l.season, 8],
  ]) {
    for (let w = 1; w <= weeks; w++)
      for (let t = 0; t < 32; t += 2) {
        const g = game(l, t, t + 1, w, 20, 20);
        g.season = season;
        for (const [id, side] of [
          [t, g.result!.home],
          [t + 1, g.result!.away],
        ] as const) {
          side.passYds = 200;
          side.thirdDownAtt = 20;
          side.thirdDownConv = id === 0 ? (season === l.season ? 9 : 4) : 7;
        }
        l.games.push(g);
      }
  }
  return l;
}

describe('year-over-year and division context', () => {
  it('selects a third-down reversal with exact percentages, rank and percentage-point change', () => {
    const l = comparisonLeague();
    const text = teamStatContext(l, 0, 'up');
    expect(text).toContain('20.0% (32nd) last season');
    expect(text).toContain('45.0% (1st in the league) this season');
    expect(text).toContain('25.0 percentage-point increase');
  });
  it('explains a defensive decline even when scoring has improved slightly', () => {
    const l = comparisonLeague();
    for (const g of l.games) {
      g.result!.home.thirdDownConv = 7;
      g.result!.away.thirdDownConv = 7;
      if (g.homeId === 0) {
        g.result!.homeScore = g.season === l.season ? 26 : 25;
        g.result!.awayScore = g.season === l.season ? 35 : 14;
      }
    }
    const text = teamStatContext(l, 0, 'down');
    expect(text).toContain('defense has fallen off a cliff');
    expect(text).toContain('allowing 35.0 points per game');
    expect(text).toContain('14.0');
    expect(text).toContain('35.0');
  });
  it('recognizes a scoring leader who was last, and distinguishes shared first place', () => {
    const l = comparisonLeague();
    for (const g of l.games) {
      g.result!.home.thirdDownConv = 7;
      g.result!.away.thirdDownConv = 7;
      if (g.homeId === 0) g.result!.homeScore = g.season === l.season ? 45 : 5;
    }
    expect(teamStatContext(l, 0)).toContain('5.0 (32nd) last season to 45.0 (1st in the league)');
    for (const g of l.games) if (g.homeId === 2 && g.season === l.season) g.result!.homeScore = 45;
    expect(teamStatContext(l, 0)).toContain('tied 1st in the league');
  });
  it('can select a passing reversal and does not invent comparisons or ranks from missing history', () => {
    const l = comparisonLeague();
    for (const g of l.games) {
      g.result!.home.thirdDownConv = 7;
      g.result!.away.thirdDownConv = 7;
      if (g.homeId === 0) g.result!.home.passYds = g.season === l.season ? 350 : 100;
    }
    expect(teamStatContext(l, 0)).toContain('passing yards per game');
    l.games = l.games.filter((g) => g.season === l.season);
    expect(teamStatContext(l, 0)).not.toContain('last season');
    l.games = l.games.filter((g) => g.homeId === 0);
    expect(teamStatContext(l, 0)).not.toContain('in the league');
    for (const g of l.games) g.result!.home.thirdDownAtt = 0;
    expect(teamStatContext(l, 0)).not.toMatch(/NaN|Infinity/);
  });
  it('reports a first defeat after a recorded winning streak', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.week = 11;
    l.games = [];
    for (let w = 1; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 8 ? 24 : 10, w <= 8 ? 10 : 24));
      l.games.push(game(l, 1, 5, w));
    }
    l.games.push(game(l, 0, 1, 10));
    expect(leagueNews(l, new Set())[0].body).toContain('nine-game winning streak');
  });
  it('locates our team behind the new leader and reports the former leader losing streak', () => {
    const l = copy(base);
    l.userTeamId = 2;
    l.week = 11;
    l.games = [];
    for (let w = 1; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 5 ? 24 : 10, w <= 5 ? 10 : 24));
      l.games.push(game(l, 1, 5, w, w <= 6 ? 24 : 10, w <= 6 ? 10 : 24));
    }
    l.games.push(game(l, 0, 1, 10));
    for (let w = 1; w <= 10; w++) l.games.push(game(l, 2, 6, w, w <= 4 ? 24 : 10, w <= 4 ? 10 : 24));
    const [m] = leagueNews(l, new Set());
    expect(m.body).toContain(`${l.teams[2].name} sit third at 4–6, 2 games behind`);
    expect(m.body).toContain('four straight defeats');
  });
});

describe('rookie table context', () => {
  const sender = { from: 'Director of scouting' };
  it('lists every selection including zero snaps, and freezes the table after reload and history pruning', () => {
    const { l, p } = rookieLeague();
    const reserve = Object.values(l.players).find((x) => x.teamId === 0 && x.id !== p.id)!;
    reserve.draft = { season: l.season, round: 7, pick: 220, teamId: 0 };
    reserve.scouting = { grade: 8, ceiling: 12 };
    deliverMail(l);
    const m = l.inbox!.find((m) => m.id === `rookies:${l.season}:mid`)!;
    expect(m.rookieReport!.rows).toHaveLength(2);
    expect(m.rookieReport!.rows.find((r) => r.playerId === reserve.id)!.snaps).toBe(0);
    const frozen = copy(m.rookieReport);
    const loaded = copy(l);
    loaded.games = [];
    loaded.phase = 'complete';
    loaded.players[p.id].position = 'TE';
    deliverMail(loaded);
    expect(loaded.inbox!.find((x) => x.id === m.id)!.rookieReport).toEqual(frozen);
  });
  it('describes a workload rise only after a documented injury to a teammate with regular work', () => {
    const { l, p } = rookieLeague();
    const mate = Object.values(l.players).find((x) => x.teamId === 0 && x.position === 'OL' && x.id !== p.id)!;
    for (const g of l.games.filter((g) => g.result)) {
      g.result!.playerStats[p.id] = { snaps: g.week <= 4 ? 8 : 40 };
      g.result!.playerTeams[mate.id] = 0;
      g.result!.playerStats[mate.id] = { snaps: g.week < 4 ? 50 : 0 };
    }
    l.games[3].result!.injuries = [
      { playerId: mate.id, teamId: 0, quarter: 2, clock: 300, type: 'hamstring', estimate: [3, 4] },
    ];
    const note = rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context;
    expect(note).toContain('from 8 to 40 snaps per game after');
    expect(note).toContain(`${mate.firstName} ${mate.lastName}`);
    delete l.games[3].result!.injuries;
    expect(rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context).not.toContain('after');
  });
  it('names the teammate carrying the work without inventing a depth-chart decision', () => {
    const { l, p } = rookieLeague();
    const mate = Object.values(l.players).find((x) => x.teamId === 0 && x.position === 'OL' && x.id !== p.id)!;
    for (const g of l.games.filter((g) => g.result)) {
      g.result!.playerStats[p.id] = { snaps: 2 };
      g.result!.playerTeams[mate.id] = 0;
      g.result!.playerStats[mate.id] = { snaps: 60 };
    }
    expect(rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context).toContain('480 snaps');
  });
  it('compares late-pick receiving production with enough rookie peers, not a hidden projection', () => {
    const { l, p } = rookieLeague();
    p.position = 'WR';
    p.draft!.pick = 150;
    const peers = Object.values(l.players)
      .filter((x) => x.position === 'WR' && x.id !== p.id)
      .slice(0, 3);
    for (const peer of peers) {
      peer.draft = { season: l.season, round: 2, pick: 40, teamId: 4 };
      peer.scouting = { grade: 12, ceiling: 14 };
    }
    for (const g of l.games.filter((g) => g.result)) {
      g.result!.playerStats[p.id] = { snaps: 50, recYds: 80 };
      for (const peer of peers) {
        g.result!.playerTeams[peer.id] = 4;
        g.result!.playerStats[peer.id] = { snaps: 50, recYds: 20 };
      }
    }
    const note = rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context;
    expect(note).toContain('Pick 150: 160.0 receiving yards per 100 snaps');
    expect(note).toContain('better than');
    expect(note).toContain('3 peers');
    // An early selection with the lowest rate gets a measured underperformance note.
    p.draft!.pick = 20;
    for (const g of l.games.filter((g) => g.result)) g.result!.playerStats[p.id].recYds = 1;
    expect(rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context).toContain('worse than');
  });
});

describe('concrete rookie highlights', () => {
  const sender = { from: 'Director of scouting' };
  it('uses a productive best game instead of an average workload and ignores games after a trade', () => {
    const { l, p } = rookieLeague();
    p.position = 'WR';
    for (const g of l.games.filter((g) => g.result)) g.result!.playerStats[p.id] = { snaps: 40, rec: 2, recYds: 20 };
    l.games[2].result!.playerStats[p.id] = { snaps: 40, rec: 6, recYds: 110, recTd: 1 };
    l.games[6].result!.playerTeams[p.id] = 4;
    l.games[6].result!.playerStats[p.id] = { snaps: 70, rec: 15, recYds: 300 };
    const note = rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context;
    expect(note).toContain('Best game: 6 rec · 110 yds · 1 TD');
    expect(note).toContain('Week 3');
    expect(note).not.toContain('Averaging');
  });
  it('calls limited action spot work and keeps the teammate carrying the load in view', () => {
    const { l, p } = rookieLeague();
    const mate = Object.values(l.players).find((x) => x.teamId === 0 && x.position === 'OL' && x.id !== p.id)!;
    for (const g of l.games.filter((g) => g.result)) {
      g.result!.playerStats[p.id] = { snaps: 2 };
      g.result!.playerTeams[mate.id] = 0;
      g.result!.playerStats[mate.id] = { snaps: 50 };
    }
    const note = rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context;
    expect(note).toContain('Spot work');
    expect(note).toContain(`${mate.firstName} ${mate.lastName}`);
    expect(note).not.toContain('per team game');
  });
  it('does not invent a best performance when only snap counts were recorded', () => {
    const { l, p } = rookieLeague();
    const note = rookieImpactMail(l, [p], sender)[0].rookieReport!.rows[0].context;
    expect(note).toContain('Most work: 50 snaps');
    expect(note).not.toContain('Best game');
  });
});

describe('SNN article flow across different lead changes', () => {
  it('reports a bye-week lead change without inventing a game for the new leader', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.games = [];
    l.week = 11;
    // Miami wins their meeting, so they hold first while both teams stand at 6–3.
    l.games.push(game(l, 0, 1, 1, 10, 24));
    for (let w = 2; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 7 ? 24 : 10, w <= 7 ? 10 : 24));
      l.games.push(game(l, 1, 5, w, w <= 6 ? 24 : 10, w <= 6 ? 10 : 24));
    }
    l.games.push(game(l, 1, 4, 10, 10, 24));
    l.games.push({ ...game(l, 0, 3, 11), result: undefined });
    const [m] = leagueNews(l, new Set());
    expect(m.body).toContain('emerged from their bye week');
    expect(m.body).toContain('6–3, ahead of');
    expect(m.body).toContain('Another division game awaits');
    expect(m.body.split('\n\n')).toHaveLength(3);
    expect(m.body).not.toContain('Blizzard beat');
  });
  it('does not claim a head-to-head tiebreaker when the season series is level', () => {
    const l = copy(base);
    l.userTeamId = 0;
    l.games = [];
    l.week = 11;
    // Miami win the first meeting and lead entering week 10. Buffalo then level the series.
    l.games.push(game(l, 0, 1, 1, 10, 24));
    for (let w = 2; w <= 9; w++) {
      l.games.push(game(l, 0, 4, w, w <= 6 ? 31 : 3, w <= 6 ? 0 : 7));
      l.games.push(game(l, 1, 5, w, w <= 6 ? 14 : 7, w <= 6 ? 7 : 14));
    }
    l.games.push(game(l, 0, 1, 10, 31, 3));
    const [m] = leagueNews(l, new Set());
    expect(m).toBeDefined();
    expect(m.body).toContain('current tiebreakers');
    expect(m.body).not.toContain('head-to-head edge');
  });
});

describe('SNN trade reporting', () => {
  function marketLeague() {
    const l = copy(base);
    l.market = emptyMarket();
    l.phase = 'regular';
    l.week = 9;
    l.games = Array.from({ length: 8 }, (_, i) => game(l, 0, 4, i + 1));
    const p = Object.values(l.players).find((p) => p.teamId === 1 && p.position === 'QB')!;
    const pick = l.draftPicks.find((p) => p.ownerId === 2 && p.season === l.season + 1 && p.round === 1)!;
    const deal = {
      season: l.season,
      phase: 'regular' as const,
      week: 7,
      kind: 'star' as const,
      sides: [
        { teamId: 1, players: [p.id], picks: [], retain: { [p.id]: 1500 } },
        { teamId: 2, players: [], picks: [pick.id] },
      ] as import('./types').TradeRecord['sides'],
    };
    return { l, p, pick, deal };
  }
  it('reports what each club receives, including draft capital and retained salary, once per week', () => {
    const { l, p, pick, deal } = marketLeague();
    l.market!.history = [deal];
    p.teamId = 2;
    const [m] = leagueNews(l, new Set());
    expect(m.subject).toContain(`${p.firstName} ${p.lastName}`);
    expect(m.tradeReport!.exchanges.find((r) => r.teamId === 2)!.receives).toContain(`QB ${p.firstName} ${p.lastName}`);
    expect(m.tradeReport!.exchanges.find((r) => r.teamId === 2)!.receives).toContain('$1,500,000');
    expect(m.tradeReport!.exchanges.find((r) => r.teamId === 1)!.receives).toContain(`${pick.season} first-round pick`);
    expect(leagueNews(l, new Set([m.id]))).toEqual([]);
    l.inbox = [{ ...m, read: false }];
    const saved = copy(m.tradeReport);
    l.draftPicks = [];
    l.games = [];
    p.position = 'WR';
    deliverMail(l);
    expect(l.inbox.find((x) => x.id === m.id)!.tradeReport).toEqual(saved);
  });
  it('skips an incomplete asset history instead of silently dropping part of the price', () => {
    const { l, deal } = marketLeague();
    deal.sides[1].picks = [99999999];
    l.market!.history = [deal];
    expect(keyTradeNews(l, 8)).toEqual([]);
  });
  it('uses recorded public rumors, and removes the story once the player has actually moved', () => {
    const { l, p, deal } = marketLeague();
    const text = `League sources say the Miami Barracudas are shopping QB ${p.firstName} ${p.lastName}.`;
    l.market!.rumors = [
      {
        id: 'shopping-test',
        season: l.season,
        phase: 'regular',
        week: 7,
        kind: 'shopping',
        teamIds: [1],
        playerId: p.id,
        text,
      },
    ];
    const [m] = leagueNews(l, new Set());
    expect(m.body).toContain(text);
    expect(m.body).toContain('remains with the');
    expect(m.tradeReport!.exchanges).toEqual([]);
    expect(m.tradeReport!.rumors[0]).toMatchObject({ playerId: p.id, clubId: 1, status: 'Being shopped' });
    expect(needsYou(l, { ...m, read: false })).toBe(false);
    l.market!.history = [deal];
    expect(rumorNews(l, 8)).toEqual([]);
    l.market!.history = [];
    l.week = 12;
    expect(rumorNews(l, 8)).toEqual([]);
  });
});

describe('trade roundup cadence and selection', () => {
  it('uses non-overlapping fortnightly windows, then weekly windows near the deadline', () => {
    const l = copy(base);
    l.week = 3;
    expect(tradeNewsWindow(l, 1)).toBeNull();
    expect(tradeNewsWindow(l, 2)).toEqual({ from: 1, to: 2, deadline: false });
    expect(tradeNewsWindow(l, 3)).toBeNull();
    expect(tradeNewsWindow(l, 4)).toEqual({ from: 3, to: 4, deadline: false });
    expect(tradeNewsWindow(l, 6)).toEqual({ from: 5, to: 6, deadline: false });
    expect(tradeNewsWindow(l, 7)).toBeNull();
    expect(tradeNewsWindow(l, 8)).toEqual({ from: 7, to: 8, deadline: false });
    expect(tradeNewsWindow(l, 9)).toEqual({ from: 9, to: 9, deadline: false });
    l.week = 10;
    expect(tradeNewsWindow(l, 10)).toEqual({ from: 10, to: 10, deadline: true });
    l.week = 11;
    expect(tradeNewsWindow(l, 10)).toBeNull();
  });
  it('publishes a new deadline-day deal once without repeating the previous week', () => {
    const l = copy(base);
    l.week = 10;
    l.market = emptyMarket();
    l.games = [game(l, 0, 4, 9)];
    const p = Object.values(l.players).find((p) => p.teamId === 1 && p.position === 'QB')!;
    const deal: import('./types').TradeRecord = {
      season: l.season,
      phase: 'regular',
      week: 9,
      kind: 'star',
      sides: [
        { teamId: 1, players: [p.id], picks: [] },
        { teamId: 2, players: [], picks: [] },
      ],
    };
    l.market.history = [deal];
    const [weekly] = leagueNews(l, new Set());
    expect(weekly.id).toContain(':9:trade:');
    const have = new Set([weekly.id]);
    expect(leagueNews(l, have)).toEqual([]);
    deal.week = 10;
    const [deadline] = leagueNews(l, have);
    expect(deadline.id).toContain(':deadline:trade:');
    expect(deadline.tradeReport!.period).toBe('Deadline day');
    have.add(deadline.id);
    expect(leagueNews(l, have)).toEqual([]);
  });
  it('leads with the highest scouted-rated notable player rather than prioritizing a quarterback', () => {
    const l = copy(base);
    l.market = emptyMarket();
    l.week = 7;
    l.games = Array.from({ length: 6 }, (_, i) => game(l, 0, 4, i + 1));
    const qb = Object.values(l.players).find((p) => p.teamId === 1 && p.position === 'QB')!;
    const wr = Object.values(l.players).find((p) => p.teamId === 3 && p.position === 'WR')!;
    for (const p of [qb, wr]) {
      for (const key of Object.keys(p.ratings)) p.ratings[key as keyof typeof p.ratings] = p.id === wr.id ? 19 : 10;
      l.knowledge[p.id] = 1;
    }
    const make = (p: typeof qb, from: number, to: number): import('./types').TradeRecord => ({
      season: l.season,
      phase: 'regular',
      week: 5,
      kind: 'star',
      sides: [
        { teamId: from, players: [p.id], picks: [] },
        { teamId: to, players: [], picks: [] },
      ],
    });
    l.market.history = [make(qb, 1, 2), make(wr, 3, 5)];
    const [m] = keyTradeNews(l, 6);
    expect(m.subject).toContain(`${wr.firstName} ${wr.lastName}`);
    expect(m.tradeReport!.exchanges).toHaveLength(2);
    expect(keyTradeNews({ ...l, week: 9 }, 8)).toEqual([]);
  });
  it('includes several other active names and does not promote the main traded player as a rumor', () => {
    const l = copy(base);
    l.market = emptyMarket();
    l.week = 7;
    const people = [1, 2, 3, 4].map(
      (id) => Object.values(l.players).find((p) => p.teamId === id && p.position === 'WR')!,
    );
    l.market.history = [
      {
        season: l.season,
        phase: 'regular',
        week: 6,
        kind: 'star',
        sides: [
          { teamId: 1, players: [people[0].id], picks: [] },
          { teamId: 5, players: [], picks: [] },
        ],
      },
    ];
    l.market.rumors = people.map((p, i) => ({
      id: `r${i}`,
      season: l.season,
      phase: 'regular' as const,
      week: 5,
      kind: 'shopping' as const,
      teamIds: [p.teamId!],
      playerId: p.id,
      text: `League sources say the ${l.teams[p.teamId!].name} are shopping ${p.firstName} ${p.lastName}.`,
    }));
    const [m] = keyTradeNews(l, 6);
    expect(m.tradeReport!.rumors).toHaveLength(3);
    expect(m.tradeReport!.rumors.some((r) => r.playerId === people[0].id)).toBe(false);
  });
});

describe('the supporting division table', () => {
  it('rotates standings and current stats without forcing a year-over-year comparison', () => {
    const l = copy(base);
    expect(divisionTable(l, 0, 10)).toBe('division');
    expect(divisionTable(l, 0, 11)).toBe('team');
    l.games = Array.from({ length: 8 }, (_, i) => game(l, 0, 4, i + 1));
    const prior = l.games.map((g) => ({ ...copy(g), season: l.season - 1 }));
    l.games.push(...prior);
    expect(divisionTable(l, 0, 10)).toBe('division');
    for (const g of l.games) if (g.season === l.season) g.result!.homeScore = 40;
    expect(divisionTable(l, 0, 10)).toBe('yearOverYear');
  });
});
