/**
 * The Column's ladder as claims that hold: what SNN may say about a unit, a head coach or a general manager, from the
 * public record alone. Leagues are built by hand (results planted week by week), so each rung is asked for exactly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import { columnStory } from './snnVoice';
import { ruleBreaks } from './storyRules';
import { FORM, unitMan } from './slump';
import { teamPlayers } from './roster';
import { clubContext, columnClaims, gmLeadKey, LADDER, pickColumn, type Claim } from './snnColumn';
import type { Game, GameResult, League, TeamGameStats } from './types';

const stats = (over: Partial<TeamGameStats> = {}): TeamGameStats =>
  ({
    firstDowns: 20,
    plays: 62,
    totalYds: 330,
    passYds: 220,
    rushYds: 110,
    passAtt: 34,
    passCmp: 22,
    rushAtt: 26,
    sacked: 2,
    turnovers: 1,
    penalties: 5,
    penaltyYds: 40,
    thirdDownAtt: 12,
    thirdDownConv: 5,
    fourthDownAtt: 1,
    fourthDownConv: 0,
    redZoneAtt: 3,
    redZoneTd: 2,
    top: 1800,
    ...over,
  }) as TeamGameStats;

/**
 * Play weeks `from`…`to` by decree: `losers` lose, everyone else at home wins (the visitor wins when the home side is a
 * loser). `side` overrides a club's own box-score line.
 */
function plant(
  l: League,
  from: number,
  to: number,
  opt: { losers?: number[]; winners?: number[]; side?: Record<number, Partial<TeamGameStats>> } = {},
) {
  const lose = new Set(opt.losers ?? []);
  const win = new Set(opt.winners ?? []);
  for (const g of l.games as Game[]) {
    if (g.season !== l.season || g.playoffRound || g.week < from || g.week > to) continue;
    const homeWins = win.has(g.awayId) || lose.has(g.homeId) ? win.has(g.homeId) && !lose.has(g.homeId) : true;
    g.result = {
      homeScore: homeWins ? 24 : 13,
      awayScore: homeWins ? 13 : 24,
      home: stats(opt.side?.[g.homeId]),
      away: stats(opt.side?.[g.awayId]),
      quarters: { home: [7, 7, 7, 3], away: [3, 3, 7, 0] },
      playerStats: {},
      playerTeams: {},
    } as unknown as GameResult;
  }
  l.week = to + 1;
}
const world = (seed = 'column') => createLeague({ seed });
const head = (l: League, teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach')!;
/** A club that is not the reader's. */
const other = (l: League, n = 0) => l.teams.filter((t) => t.id !== l.userTeamId)[n].id;
const secondYear = (l: League, teamId: number) => {
  const hc = head(l, teamId);
  delete hc.interim;
  hc.career = [{ season: l.season - 1, teamId, role: 'headCoach' }];
  return hc;
};
const about = (claims: Claim[], kind: string, teamId: number) =>
  claims.filter((c) => c.subject.kind === kind && c.teamId === teamId);

/** A team's GM with nothing on his public record: no picks a generated league gave the team, no moves, nobody gone. */
function wipe(l: League, t: number) {
  for (const p of Object.values(l.players)) {
    if (p.draft?.teamId === t) delete p.draft;
    if (p.left) p.left = p.left.filter((d) => d.teamId !== t);
  }
  delete l.gms[l.teams[t].gmId!].deals;
  l.teams[t].jobs = { held: {} };
}
const quarterbacks = (l: League, t: number) => teamPlayers(l, t).filter((p) => p.position === 'QB');
/**
 * Something to blame him for: first-round picks spent on quarterbacks in his last two seasons. `starting` makes it all
 * he has (two first-round picks who both start are no finding against him).
 */
function blameRecord(l: League, t: number, starting = false) {
  wipe(l, t);
  quarterbacks(l, t)
    .slice(0, 2)
    .forEach((p, i) => {
      p.draft = { season: l.season - 2 + i, round: 1, pick: 2 + i, teamId: t };
      if (starting) l.teams[t].jobs!.held[p.id] = { pos: 'QB', since: 0 };
    });
}
/** Something to credit him with: two of last season's picks on the All-League team here. */
function creditRecord(l: League, t: number) {
  wipe(l, t);
  const picks = teamPlayers(l, t)
    .filter((p) => p.position !== 'QB')
    .slice(0, 2);
  picks.forEach((p, i) => (p.draft = { season: l.season - 1, round: 2 + i, pick: 40 + 30 * i, teamId: t }));
  l.awards.push({
    season: l.season - 1,
    winners: {},
    allLeague: [picks.map((p) => ({ playerId: p.id, teamId: t })), []],
  });
}

describe('where a club is in its season', () => {
  it('reads the race, the stage and the games left from the table', () => {
    const l = world();
    const [top, bottom] = [other(l, 0), other(l, 1)];
    plant(l, 1, 12, { losers: [bottom], winners: [top] });
    const a = clubContext(l, top, 12);
    expect(a.race).toBe('in');
    expect(a.stage).toBe('middle');
    expect(a.w + a.l + a.t + a.left).toBe(17);
    expect(a.place).toBe(1);
    const b = clubContext(l, bottom, 12);
    expect(b.race).toBe('out');
    expect(b.w).toBe(0);
    // A league's first season has no last year to read a club against.
    expect(a.last).toBeNull();
    expect(clubContext(l, top, 6).stage).toBe('early');
    expect(clubContext(l, top, 15).stage).toBe('runIn');
  });
});

describe('a head coach on the ladder', () => {
  it('is fair to ask about at .300 or worse through six games, never in his first season or as an interim', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 8, { losers: [t] });
    const hc = secondYear(l, t);
    const claims = about(columnClaims(l, 8, new Set()), 'coach', t);
    expect(claims.map((c) => [c.rung, c.dir])).toEqual([[2, 'blame']]);
    expect(claims[0].key).toBe(`column:${l.season}:coach:${hc.id}:2-`);
    hc.career = [];
    expect(about(columnClaims(l, 8, new Set()), 'coach', t)).toEqual([]);
    secondYear(l, t).interim = true;
    expect(about(columnClaims(l, 8, new Set()), 'coach', t)).toEqual([]);
  });

  it('is time only after Week 11, after a loss, and after it was fair to ask', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 12, { losers: [t] });
    const hc = secondYear(l, t);
    const fair = `column:${l.season}:coach:${hc.id}:2-`;
    const rungs = (week: number, have: string[]) =>
      about(columnClaims(l, week, new Set(have)), 'coach', t).map((c) => c.rung);
    // Without the earlier Column there is no third rung: only the second, not yet made.
    expect(rungs(12, [])).toEqual([2]);
    expect(rungs(12, [fair])).toEqual([3]);
    // Last season's "fair to ask" counts too.
    expect(rungs(12, [`column:${l.season - 1}:coach:${hc.id}:2-`])).toContain(3);
    expect(rungs(10, [fair])).toEqual([]);
    // Made once.
    expect(rungs(12, [fair, `column:${l.season}:coach:${hc.id}:3-`])).toEqual([]);
  });

  it('is not written about once he has gone, and his interim is left alone', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 12, { losers: [t] });
    const hc = secondYear(l, t);
    const fair = `column:${l.season}:coach:${hc.id}:2-`;
    // Dismissed: an interim sits in the chair.
    hc.role = 'defCoord';
    const interim = teamCoaches(l, t).find((c) => c.id !== hc.id)!;
    const was = interim.role;
    interim.role = 'headCoach';
    interim.interim = true;
    const claims = columnClaims(l, 12, new Set([fair]));
    expect(about(claims, 'coach', t)).toEqual([]);
    interim.role = was;
  });

  it('gets the credit for a turnaround he has been there for', () => {
    const l = world();
    const t = other(l);
    l.history.push({
      season: l.season - 1,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(l.teams.map((x) => [x.id, { w: x.id === t ? 4 : 9, l: x.id === t ? 13 : 8, t: 0 }])),
    });
    plant(l, 1, 9, { winners: [t] });
    secondYear(l, t);
    const claims = about(columnClaims(l, 9, new Set()), 'coach', t);
    expect(claims.map((c) => [c.rung, c.dir])).toEqual([[2, 'credit']]);
    expect(claims[0].context.last).toEqual({ w: 4, l: 13 });
    // A first-year coach's turnaround is his general manager's hire, said once the run-in has come.
    head(l, t).career = [];
    const gm = l.gms[l.teams[t].gmId!];
    gm.career = [{ season: l.season - 1, teamId: t }];
    wipe(l, t);
    const again = columnClaims(l, 9, new Set());
    expect(about(again, 'coach', t)).toEqual([]);
    expect(about(again, 'gm', t)).toEqual([]);
    plant(l, 10, 14, { winners: [t] });
    const late = about(columnClaims(l, 14, new Set()), 'gm', t);
    expect(late.map((c) => [c.rung, c.dir, c.facts.why])).toEqual([[2, 'credit', 'hire']]);
    // The hire is the finding the piece is built on.
    expect(late[0].findings).toMatchObject([{ family: 'coaches', newCoach: true }]);
  });
});

describe('a general manager on the ladder', () => {
  /** An editor with nothing run and no team taken. */
  const NOTHING_RAN = {
    taken: new Set<number>(),
    userTeamId: null,
    yoursTold: 0,
    yoursLastWeek: false,
    editionId: 'snn:test',
    ran: [],
  };
  const losing = (l: League, t: number, seasons: number) => {
    const gm = l.gms[l.teams[t].gmId!];
    gm.career = [];
    for (let back = 1; back <= seasons; back++) {
      gm.career.push({ season: l.season - back, teamId: t });
      l.history.push({
        season: l.season - back,
        championId: -1,
        runnerUpId: -1,
        records: Object.fromEntries(
          l.teams.map((x) => [x.id, { w: x.id === t ? 5 : 9, l: x.id === t ? 12 : 8, t: 0 }]),
        ),
      });
    }
    return gm;
  };
  it('is blamed only after week 11 and only once his team is out of the race', () => {
    const l = world();
    const t = other(l);
    losing(l, t, 2);
    blameRecord(l, t);
    plant(l, 1, 8, { losers: [t] });
    // Winless through eight, and out of it already: still too early to judge a general manager.
    expect(clubContext(l, t, 8).race).toBe('out');
    expect(about(columnClaims(l, 8, new Set()), 'gm', t)).toEqual([]);
    plant(l, 9, 11, { losers: [t] });
    expect(about(columnClaims(l, 11, new Set()), 'gm', t)).toEqual([]);
    plant(l, 12, 12, { losers: [t] });
    const claims = about(columnClaims(l, 12, new Set()), 'gm', t);
    expect(claims.map((c) => [c.rung, c.dir])).toEqual([[2, 'blame']]);
    expect(claims[0].findings!.map((f) => f.family)).toEqual(['qbPicks', 'firsts']);
    expect(LADDER.gmBlameAfter).toBe(11);
  });

  it('runs one blame piece a GM a season, and "it is time" a season after he was asked about', () => {
    const l = world();
    const t = other(l);
    const gm = losing(l, t, 2);
    blameRecord(l, t);
    plant(l, 1, 14, { losers: [t] });
    const fairNow = `column:${l.season}:gm:${gm.id}:2-`;
    expect(about(columnClaims(l, 14, new Set()), 'gm', t).map((c) => c.rung)).toEqual([2]);
    // Asked about this season already (as an older save did in week 8): nothing more this year.
    expect(about(columnClaims(l, 14, new Set([fairNow])), 'gm', t)).toEqual([]);
    expect(about(columnClaims(l, 14, new Set([`column:${l.season}:gm:${gm.id}:3-`])), 'gm', t)).toEqual([]);
    // Three losing seasons and never asked about: it is still "fair to ask" first.
    const m = world('column-three');
    const gm3 = losing(m, t, 3);
    blameRecord(m, t);
    plant(m, 1, 12, { losers: [t] });
    expect(about(columnClaims(m, 12, new Set()), 'gm', t).map((c) => c.rung)).toEqual([2]);
    // Asked about last season: now it is time.
    const fairLast = `column:${m.season - 1}:gm:${gm3.id}:2-`;
    expect(about(columnClaims(m, 12, new Set([fairLast])), 'gm', t).map((c) => c.rung)).toEqual([3]);
    // Two losing seasons are not three, whatever was written last year.
    const lastYear = `column:${l.season - 1}:gm:${gm.id}:2-`;
    expect(about(columnClaims(l, 14, new Set([lastYear])), 'gm', t).map((c) => c.rung)).toEqual([2]);
  });

  it('makes no claim about a GM with nothing on record, unless asked for the bare ones', () => {
    const l = world();
    const t = other(l);
    losing(l, t, 2);
    wipe(l, t);
    plant(l, 1, 12, { losers: [t] });
    expect(about(columnClaims(l, 12, new Set()), 'gm', t)).toEqual([]);
    const bare = about(columnClaims(l, 12, new Set(), { bare: true }), 'gm', t);
    expect(bare.map((c) => [c.rung, c.findings])).toEqual([[2, []]]);
    // The editor never runs a claim with nothing to build a piece on.
    const pick = pickColumn(bare, { ...NOTHING_RAN, week: 12 });
    expect(pick).toBeNull();
  });

  it('does not lead twice with the same family unless it has a new fact', () => {
    const l = world();
    const t = other(l);
    const gm = losing(l, t, 2);
    blameRecord(l, t);
    plant(l, 1, 12, { losers: [t] });
    const led = gmLeadKey(l.season - 1, gm.id, t, 'qbPicks');
    // Last season's piece led with the quarterbacks, and neither pick is newer than that: the other finding leads.
    const families = (have: string[]) =>
      about(columnClaims(l, 12, new Set(have)), 'gm', t).map((c) => c.findings!.map((f) => f.family));
    expect(families([led])).toEqual([['firsts', 'qbPicks']]);
    // Told two seasons ago, or about another general manager's team: it leads as it would.
    expect(families([gmLeadKey(l.season - 1, gm.id, t + 1, 'qbPicks')])).toEqual([['qbPicks', 'firsts']]);
    // With the quarterbacks all he has, and nothing new about them, there is no piece.
    blameRecord(l, t, true);
    expect(families([])).toEqual([['qbPicks']]);
    expect(families([led])).toEqual([]);
    // A quarterback picked this year is a new fact.
    quarterbacks(l, t)[1].draft!.season = l.season;
    expect(families([led])).toEqual([['qbPicks']]);
  });

  it('leads with another family when a GM piece this season already led with this one', () => {
    const l = world();
    const t = other(l);
    losing(l, t, 2);
    blameRecord(l, t);
    plant(l, 1, 12, { losers: [t] });
    // Another general manager, another team, this season.
    const elsewhere = gmLeadKey(l.season, 999, 30, 'qbPicks');
    const families = () =>
      about(columnClaims(l, 12, new Set([elsewhere])), 'gm', t).map((c) => c.findings!.map((f) => f.family));
    expect(families()).toEqual([['firsts', 'qbPicks']]);
    // With the quarterbacks all he has, they still lead.
    blameRecord(l, t, true);
    expect(families()).toEqual([['qbPicks']]);
  });
  /** `seasons` finished seasons under the club's GM, each with this record and playoff finish. */
  const past = (
    l: League,
    t: number,
    seasons: number,
    rec: { w: number; l: number },
    round?: 'WC' | 'DIV' | 'CONF' | 'FINAL',
  ) => {
    const gm = l.gms[l.teams[t].gmId!];
    gm.career = [];
    for (let back = 1; back <= seasons; back++) {
      gm.career.push({ season: l.season - back, teamId: t });
      l.history.push({
        season: l.season - back,
        championId: -1,
        runnerUpId: -1,
        records: Object.fromEntries(l.teams.map((x) => [x.id, x.id === t ? { ...rec, t: 0 } : { w: 8, l: 9, t: 0 }])),
        ...(round && back === 1 ? { playoffs: { [t]: { w: 2, l: 1, round } } } : {}),
      });
    }
    return gm;
  };
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });

  it('gets the credit for three winning seasons in a row', () => {
    const l = world('column-built');
    const t = other(l);
    const gm = past(l, t, 2, { w: 11, l: 6 });
    creditRecord(l, t);
    plant(l, 1, 14, { winners: [t] });
    const claims = about(columnClaims(l, 14, new Set()), 'gm', t);
    expect(claims.map((c) => [c.rung, c.dir, c.facts.why])).toEqual([[2, 'credit', 'built']]);
    expect(claims[0].key).toBe(`column:${l.season}:gm:${gm.id}:2+`);
    const s = columnStory(l, claims[0], at());
    expect(s.paragraphs.join(' ')).toContain('winning seasons');
    expect(ruleBreaks(l, s), s.paragraphs.join(' / ')).toEqual([]);
    // Four straight losses after it, and the Column takes some of it back.
    plant(l, 15, 18, { losers: [t] });
    const fixes = about(columnClaims(l, 18, new Set([claims[0].key])), 'gm', t).filter((c) => c.dir === 'fix');
    expect(fixes.map((c) => c.of)).toEqual([claims[0].key]);
    expect(ruleBreaks(l, columnStory(l, fixes[0], at()))).toEqual([]);
    // A fourth winning season is not news again: it was said when the run reached three.
    const k = world('column-built');
    past(k, t, 3, { w: 11, l: 6 });
    creditRecord(k, t);
    plant(k, 1, 14, { winners: [t] });
    expect(about(columnClaims(k, 14, new Set()), 'gm', t)).toEqual([]);
    // One winning season before this one is not a run of them.
    const m = world('column-built');
    past(m, t, 1, { w: 11, l: 6 });
    creditRecord(m, t);
    plant(m, 1, 14, { winners: [t] });
    expect(about(columnClaims(m, 14, new Set()), 'gm', t)).toEqual([]);
    // And not while this season is going badly.
    const n = world('column-built');
    past(n, t, 2, { w: 11, l: 6 });
    creditRecord(n, t);
    plant(n, 1, 14, { losers: [t] });
    expect(about(columnClaims(n, 14, new Set()), 'gm', t).filter((c) => c.dir === 'credit')).toEqual([]);
  });

  it('gets the credit for following a deep playoff run with another good season', () => {
    const l = world('column-run');
    const t = other(l);
    past(l, t, 1, { w: 12, l: 5 }, 'CONF');
    creditRecord(l, t);
    plant(l, 1, 14, { winners: [t] });
    const claims = about(columnClaims(l, 14, new Set()), 'gm', t);
    expect(claims.map((c) => [c.dir, c.facts.why])).toEqual([['credit', 'run']]);
    const s = columnStory(l, claims[0], at());
    expect(s.paragraphs[0]).toContain('conference final');
    expect(ruleBreaks(l, s), s.paragraphs.join(' / ')).toEqual([]);
    // A first-round exit is not a deep run.
    const m = world('column-run');
    past(m, t, 1, { w: 12, l: 5 }, 'WC');
    creditRecord(m, t);
    plant(m, 1, 14, { winners: [t] });
    expect(about(columnClaims(m, 14, new Set()), 'gm', t)).toEqual([]);
  });

  it('is credited only after week 13 and only while his team is in the race', () => {
    const l = world('column-late');
    const t = other(l);
    past(l, t, 2, { w: 11, l: 6 });
    creditRecord(l, t);
    // The head coach was here last season: a coach in his first year would be a finding of its own.
    secondYear(l, t);
    plant(l, 1, 13, { winners: [t] });
    expect(clubContext(l, t, 13).race).toBe('in');
    expect(about(columnClaims(l, 13, new Set()), 'gm', t)).toEqual([]);
    plant(l, 14, 14, { winners: [t] });
    const claims = about(columnClaims(l, 14, new Set()), 'gm', t);
    expect(claims.map((c) => c.dir)).toEqual(['credit']);
    expect(claims[0].findings!.map((f) => f.family)).toEqual(['class']);
    expect(LADDER.gmCreditAfter).toBe(13);
  });

  it('is left alone after one losing season', () => {
    const l = world();
    const t = other(l);
    losing(l, t, 1);
    plant(l, 1, 12, { losers: [t] });
    expect(about(columnClaims(l, 12, new Set()), 'gm', t)).toEqual([]);
  });
});

describe('a unit on the ladder', () => {
  const sacked = { sacked: 7, passAtt: 30 };
  it('is a problem after four bad games that were lost, with its evidence in a table', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 4);
    plant(l, 5, 9, { losers: [t], side: { [t]: sacked } });
    const claims = about(columnClaims(l, 9, new Set()), 'unit', t).filter(
      (c) => c.subject.kind === 'unit' && c.subject.unit === 'offensive line',
    );
    expect(claims.map((c) => [c.rung, c.dir])).toEqual([[1, 'blame']]);
    const c = claims[0];
    expect(c.key).toBe(`column:${l.season}:unit:${t}:offensive line:1-`);
    expect(c.table.rows.length).toBeGreaterThanOrEqual(2);
    expect(c.table.rows.length).toBeLessThanOrEqual(4);
    for (const row of c.table.rows) expect(row).toHaveLength(c.table.head.length);
    expect(c.numbers.length).toBeLessThanOrEqual(3);
    // Before and after: it had earlier games to set the span against.
    expect(c.table.head[2]).toBe('Since');
  });

  it('makes no claim it has made, and none before every club has four games', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 3, { losers: [t], side: { [t]: sacked } });
    expect(columnClaims(l, 3, new Set())).toEqual([]);
    plant(l, 4, 9, { losers: [t], side: { [t]: sacked } });
    const all = columnClaims(l, 9, new Set());
    expect(all.length).toBeGreaterThan(0);
    const have = new Set(all.map((c) => c.key));
    expect(columnClaims(l, 9, have).filter((c) => have.has(c.key))).toEqual([]);
  });

  it('is corrected when the facts reverse, once', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 5, { losers: [t], side: { [t]: sacked } });
    const told = `column:${l.season}:unit:${t}:offensive line:1-`;
    // Four games on, the same line allows nothing and the club has won them.
    plant(l, 6, 10, { winners: [t], side: { [t]: { sacked: 0, passAtt: 30 } } });
    const fixes = columnClaims(l, 10, new Set([told])).filter((c) => c.dir === 'fix');
    expect(fixes.map((c) => c.of)).toEqual([told]);
    expect(fixes[0].key).toBe(`column:${l.season}:unit:${t}:offensive line:fix`);
    expect(columnClaims(l, 10, new Set([told, fixes[0].key])).filter((c) => c.dir === 'fix')).toEqual([]);
    // Nothing is corrected that was never claimed.
    expect(columnClaims(l, 10, new Set()).filter((c) => c.dir === 'fix')).toEqual([]);
  });

  it('gives a club out of the race one unit-blame Column a season', () => {
    const l = world();
    const t = other(l);
    plant(l, 1, 12, { losers: [t], side: { [t]: { ...sacked, rushYds: 40, rushAtt: 26 } } });
    expect(clubContext(l, t, 12).race).toBe('out');
    const first = about(columnClaims(l, 12, new Set()), 'unit', t).filter((c) => c.dir === 'blame');
    expect(first.length).toBeGreaterThan(1);
    const after = about(columnClaims(l, 12, new Set([first[0].key])), 'unit', t).filter((c) => c.dir === 'blame');
    expect(after).toEqual([]);
  });
});

describe('choosing the week’s Column', () => {
  const claim = (key: string, over: Partial<Claim>): Claim =>
    ({
      key,
      subject: { kind: 'unit', teamId: 3, unit: 'run game' },
      rung: 1,
      dir: 'blame',
      teamId: 3,
      margin: 0.5,
      numbers: [],
      table: { head: ['', 'a', 'b'], rows: [] },
      facts: {},
      context: { w: 5, l: 5, t: 0, race: 'out', last: null },
      ...over,
    }) as Claim;
  const opt = {
    taken: new Set<number>(),
    userTeamId: 1 as number | null,
    yoursTold: 0,
    yoursLastWeek: false,
    editionId: 'snn:2026:w9',
    week: 9,
    ran: [] as { week: number; key: string }[],
  };

  it('takes a correction first, then the higher rung', () => {
    const one = claim('a', { rung: 1 });
    const three = claim('b', { rung: 3, teamId: 4 });
    const fix = claim('c', { dir: 'fix', teamId: 5 });
    expect(pickColumn([one, three], opt)!.key).toBe('b');
    expect(pickColumn([one, three, fix], opt)!.key).toBe('c');
    expect(pickColumn([], opt)).toBeNull();
  });

  it('puts a contender’s problem ahead of a struggling club’s', () => {
    const out = claim('out', { teamId: 3 });
    const contender = claim('in', { teamId: 4, context: { w: 9, l: 2, t: 0, race: 'in', last: null } as never });
    expect(pickColumn([out, contender], opt)!.key).toBe('in');
    expect(pickColumn([contender, out], opt)!.key).toBe('in');
  });

  it('passes over a club the page already covers, and holds the reader’s club to its limits', () => {
    const mine = claim('mine', { teamId: 1, rung: 3 });
    const theirs = claim('theirs', { teamId: 4 });
    expect(pickColumn([mine, theirs], opt)!.key).toBe('mine');
    expect(pickColumn([mine, theirs], { ...opt, taken: new Set([1]) })!.key).toBe('theirs');
    expect(pickColumn([mine, theirs], { ...opt, yoursTold: LADDER.yoursASeason })!.key).toBe('theirs');
    expect(pickColumn([mine, theirs], { ...opt, yoursLastWeek: true })!.key).toBe('theirs');
    expect(pickColumn([mine], { ...opt, yoursLastWeek: true })).toBeNull();
    // A reader between jobs: nothing is his club's, and the Column still runs.
    expect(pickColumn([mine, theirs], { ...opt, userTeamId: null, yoursTold: 9 })!.key).toBe('mine');
  });
});

describe('how often the Column runs, and about what (the owner’s rule G)', () => {
  const claim = (key: string, over: Partial<Claim> = {}): Claim =>
    ({
      key,
      subject: { kind: 'unit', teamId: 3, unit: 'run game' },
      rung: 1,
      dir: 'blame',
      teamId: 3,
      margin: 0.5,
      numbers: [],
      table: { head: ['', 'a', 'b'], rows: [] },
      facts: {},
      context: { w: 5, l: 5, t: 0, race: 'out', last: null },
      ...over,
    }) as Claim;
  const blame = claim('column:2026:unit:3:run game:1-');
  const credit = claim('column:2026:unit:4:pass rush:1+', { dir: 'credit', teamId: 4 });
  const fix = claim('column:2026:unit:5:coverage:fix', { dir: 'fix', teamId: 5 });
  const job = claim('column:2026:coach:77:2-', {
    subject: { kind: 'coach', teamId: 6, coachId: 77 },
    rung: 2,
    teamId: 6,
  });
  const at = (week: number, ran: { week: number; key: string }[]) => ({
    taken: new Set<number>(),
    userTeamId: null,
    yoursTold: 0,
    yoursLastWeek: false,
    editionId: `snn:2026:w${week}`,
    week,
    ran,
  });
  const UNIT_BLAME = 'column:2026:unit:9:run defense:1-';
  const UNIT_CREDIT = 'column:2026:unit:9:run game:1+';
  const COACH_BLAME = 'column:2026:coach:12:2-';

  it('never runs two weeks running, not even a correction', () => {
    expect(pickColumn([blame, credit, fix, job], at(9, [{ week: 8, key: UNIT_CREDIT }]))).toBeNull();
    expect(pickColumn([blame, credit, fix, job], at(9, [{ week: 7, key: UNIT_CREDIT }]))).not.toBeNull();
  });

  it('takes blame and credit in turn, and a correction either way', () => {
    expect(pickColumn([blame, credit], at(9, [{ week: 7, key: UNIT_BLAME }]))!.key).toBe(credit.key);
    expect(pickColumn([blame, credit], at(9, [{ week: 7, key: UNIT_CREDIT }]))!.key).toBe(blame.key);
    expect(pickColumn([blame], at(9, [{ week: 7, key: UNIT_BLAME }]))).toBeNull();
    expect(pickColumn([blame, fix], at(9, [{ week: 7, key: UNIT_BLAME }]))!.key).toBe(fix.key);
    // A correction does not use up a turn: the one before it still decides.
    const ran = [
      { week: 7, key: 'column:2026:unit:9:coverage:fix' },
      { week: 5, key: UNIT_BLAME },
    ];
    expect(pickColumn([blame, credit], at(9, ran))!.key).toBe(credit.key);
  });

  it('asks about the general manager before his head coach: three losing seasons point at him', () => {
    const gm = claim('column:2026:gm:5:2-', { subject: { kind: 'gm', teamId: 6, gmId: 5 }, rung: 2, teamId: 6 });
    const elsewhere = claim('column:2026:coach:78:2-', {
      subject: { kind: 'coach', teamId: 7, coachId: 78 },
      rung: 2,
      teamId: 7,
      margin: 0.9,
    });
    expect(pickColumn([job, gm], at(9, []))!.key).toBe(gm.key);
    expect(pickColumn([elsewhere, gm, job], at(9, []))!.key).toBe(gm.key);
    // Not past a higher rung, and not past a correction.
    const time = claim('column:2026:coach:78:3-', {
      subject: { kind: 'coach', teamId: 7, coachId: 78 },
      rung: 3,
      teamId: 7,
    });
    expect(pickColumn([gm, time], at(9, []))!.key).toBe(time.key);
    expect(pickColumn([gm, fix], at(9, []))!.key).toBe(fix.key);
  });

  it('asks about a man’s job in one Column in three at most', () => {
    // The last two Columns hold one about a job: not again yet.
    const soon = [
      { week: 7, key: UNIT_CREDIT },
      { week: 5, key: COACH_BLAME },
    ];
    expect(pickColumn([job, blame], at(9, soon))!.key).toBe(blame.key);
    const later = [
      { week: 9, key: UNIT_CREDIT },
      { week: 7, key: UNIT_BLAME },
      { week: 5, key: COACH_BLAME },
    ];
    expect(pickColumn([job, blame], at(11, later))!.key).toBe(job.key);
    // Credit for a man is not a Column about his job.
    const praised = [
      { week: 7, key: 'column:2026:coach:12:2+' },
      { week: 5, key: UNIT_BLAME },
    ];
    expect(pickColumn([job], at(9, praised))!.key).toBe(job.key);
  });

  it('gives a general manager his own turn: the one-in-three limit is the head coaches’', () => {
    const gm = claim('column:2026:gm:5:2-', { subject: { kind: 'gm', teamId: 8, gmId: 5 }, rung: 2, teamId: 8 });
    // A coach's job was the subject two Columns ago: a coach waits, a general manager does not.
    const soon = [
      { week: 12, key: UNIT_CREDIT },
      { week: 10, key: COACH_BLAME },
    ];
    expect(pickColumn([job, blame], at(14, soon))!.key).toBe(blame.key);
    expect(pickColumn([job, gm, blame], at(14, soon))!.key).toBe(gm.key);
    // And a piece about a general manager does not use up the coaches' turn.
    const afterGm = [
      { week: 14, key: UNIT_CREDIT },
      { week: 12, key: 'column:2026:gm:9:2-' },
    ];
    expect(pickColumn([job, blame], at(16, afterGm))!.key).toBe(job.key);
    // Blame and credit still take turns, and it still never runs two weeks running.
    expect(pickColumn([gm], at(14, [{ week: 12, key: UNIT_BLAME }]))).toBeNull();
    expect(pickColumn([gm], at(14, [{ week: 13, key: UNIT_CREDIT }]))).toBeNull();
  });

  it('keeps the season’s last edition for a verdict on a general manager', () => {
    const gm = claim('column:2026:gm:5:2-', { subject: { kind: 'gm', teamId: 8, gmId: 5 }, rung: 2, teamId: 8 });
    const praise = claim('column:2026:gm:6:2+', {
      subject: { kind: 'gm', teamId: 9, gmId: 6 },
      rung: 2,
      dir: 'credit',
      teamId: 9,
    });
    const time = claim('column:2026:coach:78:3-', {
      subject: { kind: 'coach', teamId: 7, coachId: 78 },
      rung: 3,
      teamId: 7,
    });
    expect(LADDER.gmVerdictWeek).toBe(18);
    // Week 18: it runs although the last Column was blame too, and ahead of a coach's "it is time" and a correction.
    const blamed = [{ week: 16, key: UNIT_BLAME }];
    expect(pickColumn([gm], at(18, blamed))!.key).toBe(gm.key);
    expect(pickColumn([time, fix, credit, gm], at(18, blamed))!.key).toBe(gm.key);
    // Blame before credit when both general managers are open.
    expect(pickColumn([praise, gm], at(18, blamed))!.key).toBe(gm.key);
    expect(pickColumn([praise, credit], at(18, [{ week: 16, key: UNIT_CREDIT }]))!.key).toBe(praise.key);
    // Week 17 is held back while a verdict is waiting, so that week 18 is free for it.
    expect(pickColumn([blame, credit, gm], at(17, [{ week: 15, key: UNIT_CREDIT }]))).toBeNull();
    expect(pickColumn([blame, credit], at(17, [{ week: 15, key: UNIT_CREDIT }]))!.key).toBe(blame.key);
    // It is still never two weeks running, a team the page covers is still passed over, and with no general manager
    // to judge the last edition is an ordinary one.
    expect(pickColumn([gm], at(18, [{ week: 17, key: UNIT_CREDIT }]))).toBeNull();
    expect(pickColumn([gm, credit], { ...at(18, blamed), taken: new Set([8]) })!.key).toBe(credit.key);
    expect(pickColumn([blame, credit], at(18, blamed))!.key).toBe(credit.key);
  });
});

it('keeps its bars where the owner can set them', () => {
  expect(FORM.games).toBeGreaterThan(0);
  expect(LADDER.coachPct).toBeLessThan(0.5);
});

describe('the Column’s words', () => {
  const at = () => ({ editionId: 'snn:test', said: [] as string[] });
  const FOG = /\b(rating|overall|morale|mood|potential|trait|ceiling)\b/i;
  const sacked = { sacked: 7, passAtt: 30 };
  const lineBlame = (l: League, t: number, week: number) =>
    columnClaims(l, week, new Set()).find(
      (c) => c.teamId === t && c.subject.kind === 'unit' && c.subject.unit === 'offensive line' && c.dir === 'blame',
    )!;

  it('writes the same problem differently for a contender and for a club that is out', () => {
    const top = world('column-words');
    const t = other(top);
    // Winning all year, the line still gives up sacks: a contender's one weakness.
    plant(top, 1, 12, { winners: [t], side: { [t]: sacked } });
    const out = world('column-words');
    plant(out, 1, 12, { losers: [t], side: { [t]: sacked } });
    // Blame needs lost games in the span: the contender drops its last three.
    plant(top, 10, 12, { losers: [t], side: { [t]: sacked } });
    const a = columnStory(top, lineBlame(top, t, 12), at());
    const b = columnStory(out, lineBlame(out, t, 12), at());
    expect(a.paragraphs[0]).not.toBe(b.paragraphs[0]);
    expect(a.paragraphs.join(' ')).toMatch(/race|playoff/);
    expect(b.paragraphs.join(' ')).not.toMatch(/playoff|seed|race/);
    for (const s of [a, b]) {
      expect(s.kind).toBe('column');
      expect(s.kicker).toBe('Column');
      expect(s.covers).toEqual([s.key]);
      expect(ruleBreaks(top, s)).toEqual([]);
    }
  });

  it('says how small the sample is early, and how many games are left late', () => {
    const early = world('column-early');
    const t = other(early);
    plant(early, 1, 6, { losers: [t], side: { [t]: sacked } });
    const first = columnStory(early, lineBlame(early, t, 6), at());
    expect(first.paragraphs[1]).toMatch(/small sample|early/);
    const late = world('column-early');
    plant(late, 1, 15, { losers: [t], side: { [t]: sacked } });
    const last = columnStory(late, lineBlame(late, t, 15), at());
    expect(last.paragraphs[1]).not.toMatch(/small sample|early/);
    expect(last.paragraphs.join(' ')).toMatch(/next season|games left/);
  });

  it('writes every rung to the rules, with nothing private in it', () => {
    const l = world('column-rungs');
    const [a, b, c] = [other(l, 0), other(l, 1), other(l, 2)];
    l.history.push({
      season: l.season - 1,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(l.teams.map((x) => [x.id, { w: x.id === c ? 4 : 5, l: x.id === c ? 13 : 12, t: 0 }])),
    });
    l.history.push({
      season: l.season - 2,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(l.teams.map((x) => [x.id, { w: 5, l: 12, t: 0 }])),
    });
    plant(l, 1, 12, { losers: [a, b], winners: [c], side: { [a]: sacked } });
    const hc = secondYear(l, a);
    secondYear(l, c);
    const gm = l.gms[l.teams[b].gmId!];
    gm.career = [1, 2].map((back) => ({ season: l.season - back, teamId: b }));
    const have = new Set([
      `column:${l.season}:coach:${hc.id}:2-`,
      `column:${l.season}:unit:${c}:run game:1-`,
      `column:${l.season}:coach:${head(l, c).id}:2-`,
    ]);
    const claims = [...columnClaims(l, 12, new Set()), ...columnClaims(l, 12, have)];
    const kinds = new Set<string>();
    for (const claim of claims) {
      const s = columnStory(l, claim, at());
      kinds.add(`${claim.subject.kind} ${claim.dir} ${claim.rung}`);
      expect(ruleBreaks(l, s), `${claim.key}: ${s.paragraphs.join(' / ')}`).toEqual([]);
      expect(s.paragraphs.join(' ')).not.toMatch(FOG);
      expect(s.table!.rows.length).toBeGreaterThanOrEqual(2);
      expect(s.headline.length).toBeLessThanOrEqual(70);
    }
    for (const k of [
      'unit blame 1',
      'unit credit 1',
      'coach blame 2',
      'coach blame 3',
      'coach credit 2',
      'gm blame 2',
      'coach fix 2',
    ])
      expect([...kinds], k).toContain(k);
  });

  describe('over a played league', () => {
    let l: League;
    beforeAll(() => {
      l = createLeague({ seed: 'column-played' });
      for (let week = 1; week <= 9; week++) playWeek(l);
    }, 240_000);
    it('carries the one man the box scores point at, and names him in full when there is one', () => {
      const claims = columnClaims(l, 9, new Set()).filter((c) => c.subject.kind === 'unit' && c.dir !== 'fix');
      for (const c of claims) {
        const unit = c.subject.kind === 'unit' ? c.subject.unit : 'run game';
        expect(c.man ?? null).toEqual(unitMan(l, c.teamId, unit, 9, c.dir === 'blame' ? 'blame' : 'credit'));
      }
      // Written by hand: a lineman charged with six of the sacks.
      const blame = claims.find(
        (c) => c.dir === 'blame' && c.subject.kind === 'unit' && c.subject.unit === 'offensive line',
      )!;
      const lineman = Object.values(l.players).find((p) => p.teamId === blame.teamId && p.position === 'OL')!;
      const s = columnStory(l, { ...blame, man: { playerId: lineman.id, what: 'lineSacks', n: 6 } }, at());
      expect(s.paragraphs[0]).toContain(`${lineman.firstName} ${lineman.lastName}`);
      expect(s.paragraphs[0]).toContain('six of the sacks');
      expect(s.cast).toEqual([lineman.id]);
      expect(s.picture.playerId).toBe(lineman.id);
      expect(ruleBreaks(l, s)).toEqual([]);
      // With nobody to point at, the Column stays with the unit.
      const plain = columnStory(l, { ...blame, man: null }, at());
      expect(plain.cast).toEqual([]);
    });

    it('writes every claim that holds to the rules, and no two alike', () => {
      const wording = at();
      const firsts: string[] = [];
      for (let week = 5; week <= 9; week++)
        for (const claim of columnClaims(l, week, new Set())) {
          const s = columnStory(l, claim, wording);
          expect(ruleBreaks(l, s), `${claim.key}: ${s.paragraphs.join(' / ')}`).toEqual([]);
          expect(s.paragraphs).toHaveLength(2);
          firsts.push(s.paragraphs.join(' '));
        }
      expect(firsts.length).toBeGreaterThan(20);
      expect(new Set(firsts).size).toBe(firsts.length);
    });
  });
});
