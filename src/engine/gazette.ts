/**
 * The Arena Gazette's numbers column (`docs/NEWS.md`): after weeks 4, 7, 10, 13 and 16, a playoff preview and a season
 * wrap. Built from the box scores' advanced numbers (`analytics.ts`, `TeamGameStats.adv`): public facts only, never a
 * rating. One story, chosen by the first condition that holds, then the tables it rests on, with our club always in
 * them. The sim makes the facts; the writing says what they mean.
 */
import { employed } from './employment';
import { ordinal } from './opposition';
import { computeRecords, conferenceSeeds } from './season/standings';
import type { AdvancedStats, GazetteTable, GazetteUnit, League, Team } from './types';

export type { GazetteTable };

export type Edition = 'w4' | 'w7' | 'w10' | 'w13' | 'w16' | 'preview' | 'wrap';

const WEEKLY: Record<number, Edition> = { 4: 'w4', 7: 'w7', 10: 'w10', 13: 'w13', 16: 'w16' };
const WEEK_OF: Partial<Record<Edition, number>> = { w4: 4, w7: 7, w10: 10, w13: 13, w16: 16 };

/** The edition due now: the week just played is a checkpoint, the playoffs haven't started, or the final is over. */
export function editionAt(league: League): Edition | null {
  if (league.phase === 'regular') return WEEKLY[league.week - 1] ?? null;
  if (league.phase === 'playoffs')
    return league.games.some((g) => g.season === league.season && g.playoffRound && g.result) ? null : 'preview';
  return league.phase === 'complete' ? 'wrap' : null;
}

const zero = (): AdvancedStats => ({
  plays: 0,
  success: 0,
  epa: 0,
  explosive: 0,
  dropbacks: 0,
  passSuccess: 0,
  passEpa: 0,
  rushes: 0,
  rushSuccess: 0,
  rushEpa: 0,
  pressured: 0,
});
const add = (a: AdvancedStats, b: AdvancedStats) => {
  for (const k of Object.keys(a) as (keyof AdvancedStats)[]) a[k] += b[k];
};

export interface TeamAdvanced {
  /** Regular-season games with advanced numbers. */
  games: number;
  off: AdvancedStats;
  /** What opponents did against it. */
  def: AdvancedStats;
  third: [number, number];
  red: [number, number];
}

/** Each club's season so far, as the offense and against it, from games that carry advanced numbers. */
export function teamAdvanced(
  league: League,
  season = league.season,
  throughWeek = Infinity,
): Map<number, TeamAdvanced> {
  const out = new Map<number, TeamAdvanced>(
    league.teams.map((t) => [t.id, { games: 0, off: zero(), def: zero(), third: [0, 0], red: [0, 0] }]),
  );
  for (const g of league.games) {
    const r = g.result;
    if (g.season !== season || g.playoffRound || g.week > throughWeek || !r?.home.adv || !r.away.adv) continue;
    for (const [mine, theirs, id] of [
      [r.home, r.away, g.homeId],
      [r.away, r.home, g.awayId],
    ] as const) {
      const t = out.get(id)!;
      t.games++;
      add(t.off, mine.adv!);
      add(t.def, theirs.adv!);
      t.third = [t.third[0] + mine.thirdDownAtt, t.third[1] + mine.thirdDownConv];
      t.red = [t.red[0] + mine.redZoneAtt, t.red[1] + mine.redZoneTd];
    }
  }
  return out;
}

export interface PlayerAdvanced {
  teamId: number;
  /** His club's games with advanced numbers: the samples are per team game. */
  games: number;
  dropbacks: number;
  epa: number;
  successes: number;
  rushAtt: number;
  rushSnaps: number;
  pressures: number;
}

/** Each player's season so far in the advanced numbers, with his latest club. */
export function playerAdvanced(league: League, season = league.season): Map<number, PlayerAdvanced> {
  const teams = teamAdvanced(league, season);
  const out = new Map<number, PlayerAdvanced>();
  for (const g of league.games) {
    const r = g.result;
    if (g.season !== season || g.playoffRound || !r?.home.adv) continue;
    for (const [id, line] of Object.entries(r.playerStats)) {
      const teamId = r.playerTeams[Number(id)];
      const p = out.get(Number(id)) ?? {
        teamId,
        games: 0,
        dropbacks: 0,
        epa: 0,
        successes: 0,
        rushAtt: 0,
        rushSnaps: 0,
        pressures: 0,
      };
      p.teamId = teamId;
      p.dropbacks += line.dropbacks ?? 0;
      p.epa += line.epa ?? 0;
      p.successes += line.successes ?? 0;
      p.rushAtt += line.rushAtt ?? 0;
      p.rushSnaps += line.rushSnaps ?? 0;
      p.pressures += line.pressures ?? 0;
      out.set(Number(id), p);
    }
  }
  for (const p of out.values()) p.games = teams.get(p.teamId)?.games ?? 0;
  return out;
}

interface TeamMeasure {
  title: string;
  /** How a sentence names it: "1st in EPA per play on offense". */
  phrase: string;
  unit: GazetteUnit;
  lowerBetter?: true;
  value: (t: TeamAdvanced) => number;
}
const per = (a: number, b: number) => (b ? a / b : 0);
const TEAM: Record<string, TeamMeasure> = {
  offEpa: {
    phrase: 'EPA per play on offense',
    title: 'Offense: EPA per play',
    unit: 'epa',
    value: (t) => per(t.off.epa, t.off.plays),
  },
  offSuccess: {
    phrase: 'success rate on offense',
    title: 'Offense: success rate',
    unit: 'pct',
    value: (t) => per(t.off.success, t.off.plays),
  },
  defEpa: {
    phrase: 'EPA per play allowed',
    title: 'Defense: EPA per play allowed',
    unit: 'epa',
    lowerBetter: true,
    value: (t) => per(t.def.epa, t.def.plays),
  },
  defSuccess: {
    phrase: 'success rate allowed',
    title: 'Defense: success rate allowed',
    unit: 'pct',
    lowerBetter: true,
    value: (t) => per(t.def.success, t.def.plays),
  },
  rushEpa: {
    phrase: 'EPA per rush',
    title: 'Running game: EPA per rush',
    unit: 'epa',
    value: (t) => per(t.off.rushEpa, t.off.rushes),
  },
  offExplosive: {
    phrase: 'explosive-play rate',
    title: 'Explosive plays',
    unit: 'pct',
    value: (t) => per(t.off.explosive, t.off.plays),
  },
  defExplosive: {
    phrase: 'explosive plays allowed',
    title: 'Explosive plays allowed',
    unit: 'pct',
    lowerBetter: true,
    value: (t) => per(t.def.explosive, t.def.plays),
  },
  pressure: {
    phrase: 'pressure rate',
    title: 'Pass rush: pressure rate',
    unit: 'pct',
    value: (t) => per(t.def.pressured, t.def.dropbacks),
  },
  third: {
    phrase: 'third-down conversion rate',
    title: 'Third-down conversions',
    unit: 'pct',
    value: (t) => per(t.third[1], t.third[0]),
  },
  red: {
    phrase: 'red-zone touchdown rate',
    title: 'Red-zone touchdowns',
    unit: 'pct',
    value: (t) => per(t.red[1], t.red[0]),
  },
};
type PlayerMeasure = 'qb' | 'rusher' | 'rush';
/** Themes by edition, so consecutive columns read differently. Team measures first: the first leads the story. */
const THEMES: Record<Edition, (keyof typeof TEAM | PlayerMeasure)[]> = {
  w4: ['offEpa', 'offSuccess', 'qb'],
  w7: ['defEpa', 'defSuccess', 'rusher'],
  w10: ['offExplosive', 'defExplosive', 'rush'],
  w13: ['offEpa', 'third', 'red'],
  w16: ['defEpa', 'pressure', 'qb'],
  preview: ['offEpa', 'defEpa'],
  wrap: ['offEpa', 'defEpa', 'qb', 'rusher', 'rush'],
};
/** Every club needs this many counted games before a team table ranks them. */
const MIN_TEAM_GAMES = 3;
/** Per team game: a passer's dropbacks, a rusher's carries, a pass rusher's rush snaps. */
const SAMPLE = { qb: 12, rusher: 6, rush: 15 };

const name = (t: Team) => t.name;

function teamTable(league: League, stats: Map<number, TeamAdvanced>, m: TeamMeasure, only?: number[]): GazetteTable {
  const ranked = [...stats.entries()]
    .filter(([id]) => !only || only.includes(id))
    .map(([teamId, t]) => ({ teamId, value: m.value(t), name: name(league.teams[teamId]) }))
    .sort((a, b) => (m.lowerBetter ? a.value - b.value : b.value - a.value) || a.teamId - b.teamId)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  const shown = ranked.filter(
    (r) => r.rank <= 5 || r.rank > ranked.length - 3 || (employed(league) && r.teamId === league.userTeamId),
  );
  return { title: m.title, unit: m.unit, ...(m.lowerBetter ? { lowerBetter: true as const } : {}), rows: shown };
}

function playerTable(league: League, players: Map<number, PlayerAdvanced>, m: PlayerMeasure): GazetteTable {
  const rows = [...players.entries()]
    .flatMap(([playerId, p]) => {
      const pl = league.players[playerId];
      if (!pl || !p.games) return [];
      if (m === 'qb' && p.dropbacks >= SAMPLE.qb * p.games) return [{ playerId, p, value: p.epa / p.dropbacks }];
      if (m === 'rusher' && !p.dropbacks && p.rushAtt >= SAMPLE.rusher * p.games)
        return [{ playerId, p, value: p.successes / p.rushAtt }];
      if (m === 'rush' && p.rushSnaps >= SAMPLE.rush * p.games)
        return [{ playerId, p, value: p.pressures / p.rushSnaps }];
      return [];
    })
    .sort((a, b) => b.value - a.value || a.playerId - b.playerId)
    .slice(0, 10)
    .map((r, i) => {
      const pl = league.players[r.playerId];
      return {
        teamId: r.p.teamId,
        playerId: r.playerId,
        name: `${pl.firstName} ${pl.lastName}`,
        value: r.value,
        rank: i + 1,
      };
    });
  const title =
    m === 'qb'
      ? 'Quarterbacks: EPA per dropback'
      : m === 'rusher'
        ? 'Running backs: success rate'
        : 'Pass rushers: pressure per rush';
  const unit = m === 'qb' ? 'perDropback' : m === 'rusher' ? 'rushSuccess' : 'pressureRate';
  return { title, unit, players: true, rows };
}

const epa = (v: number) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (unit: GazetteUnit, v: number) => (unit === 'epa' || unit === 'perDropback' ? epa(v) : pct(v));

function rankOf(league: League, stats: Map<number, TeamAdvanced>, m: TeamMeasure, teamId: number) {
  return teamTable(league, stats, m).rows.find((r) => r.teamId === teamId)?.rank ?? fullRank(stats, m, teamId);
}
function fullRank(stats: Map<number, TeamAdvanced>, m: TeamMeasure, teamId: number) {
  const vs = [...stats.entries()].map(([id, t]) => ({ id, v: m.value(t) }));
  vs.sort((a, b) => (m.lowerBetter ? a.v - b.v : b.v - a.v) || a.id - b.id);
  return vs.findIndex((x) => x.id === teamId) + 1;
}

interface Story {
  subject: string;
  lead: string;
}

/** The story: the first of the column's conditions that holds. */
function story(league: League, edition: Edition, stats: Map<number, TeamAdvanced>, measures: TeamMeasure[]): Story {
  const m = measures[0];
  const full = [...stats.entries()]
    .map(([id, t]) => ({ id, v: m.value(t) }))
    .sort((a, b) => (m.lowerBetter ? a.v - b.v : b.v - a.v) || a.id - b.id);
  const [first, second] = full;
  const tenth = full[Math.min(9, full.length - 1)];
  const gap = Math.abs(first.v - second.v);
  const spread = Math.abs(first.v - tenth.v);
  const team = (id: number) => league.teams[id];
  // 1. A runaway leader.
  if (spread > 0 && gap >= 0.25 * spread)
    return {
      subject: `The ${name(team(first.id))} lead the league in ${m.phrase} by a distance`,
      lead: `The ${name(team(first.id))} lead the league at ${fmt(m.unit, first.v)}, ${fmt(m.unit, gap)} clear of the ${name(team(second.id))}. Nobody else is close.`,
    };
  // 2. Our club at either end of a table in this column.
  if (employed(league))
    for (const mm of measures) {
      const r = fullRank(stats, mm, league.userTeamId);
      if (r <= 3 || r > stats.size - 3) {
        const v = mm.value(stats.get(league.userTeamId)!);
        const avg = [...stats.values()].reduce((a, t) => a + mm.value(t), 0) / stats.size;
        return {
          subject: `The ${name(team(league.userTeamId))}: ${ordinal(r)} in ${mm.phrase}`,
          lead: `The ${name(team(league.userTeamId))} rank ${ordinal(r)} in the league in ${mm.phrase}, at ${fmt(mm.unit, v)}; the league average is ${fmt(mm.unit, avg)}.`,
        };
      }
    }
  // 3. The biggest mover on offense since the last column.
  const order: Edition[] = ['w4', 'w7', 'w10', 'w13', 'w16'];
  const prev = order[order.indexOf(edition) - 1];
  if (prev && WEEK_OF[prev]) {
    const then = teamAdvanced(league, league.season, WEEK_OF[prev]);
    const off = TEAM.offEpa;
    const moves = league.teams
      .map((t) => ({ t, from: fullRank(then, off, t.id), to: fullRank(stats, off, t.id) }))
      .sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to) || a.t.id - b.t.id);
    const big = moves[0];
    if (big && Math.abs(big.from - big.to) >= 10)
      return {
        subject: `The ${name(big.t)} ${big.to < big.from ? 'climb' : 'slide'} from ${ordinal(big.from)} to ${ordinal(big.to)} on offense`,
        lead: `Since the last column the ${name(big.t)} have gone from ${ordinal(big.from)} to ${ordinal(big.to)} in EPA per play, ${big.to < big.from ? 'the biggest climb in the league' : 'the steepest fall in the league'}.`,
      };
  }
  // 4. A split between the two sides of the ball.
  for (const t of league.teams) {
    const o = fullRank(stats, TEAM.offEpa, t.id),
      d = fullRank(stats, TEAM.defEpa, t.id);
    if ((o <= 5 && d > stats.size - 5) || (d <= 5 && o > stats.size - 5))
      return {
        subject: `The ${name(t)}: ${o <= 5 ? 'top-five offense, bottom-five defense' : 'top-five defense, bottom-five offense'}`,
        lead: `The ${name(t)} are ${ordinal(o)} in EPA per play on offense and ${ordinal(d)} on defense: ${o <= 5 ? 'they score their way through games the defense lets slip' : 'the defense keeps them in games the offense can’t win'}.`,
      };
  }
  // 5. A turnaround from last season.
  const last = league.history.find((h) => h.season === league.season - 1);
  if (last) {
    const now = computeRecords(league);
    for (const t of league.teams) {
      const was = last.records[t.id],
        is = now.get(t.id)!;
      const games = is.w + is.l + is.t;
      if (!was || games < 4) continue;
      const p = (is.w + is.t / 2) / games;
      if ((was.w <= 6 && p >= 0.75) || (was.w >= 10 && p <= 0.375))
        return {
          subject: `The ${name(t)}, ${is.w}–${is.l}${is.t ? `–${is.t}` : ''} after a ${was.w}–${was.l} season`,
          lead: `The ${name(t)} are ${is.w}–${is.l}${is.t ? `–${is.t}` : ''}, after going ${was.w}–${was.l} last season. The numbers say why: ${ordinal(fullRank(stats, TEAM.offEpa, t.id))} in EPA per play on offense, ${ordinal(fullRank(stats, TEAM.defEpa, t.id))} on defense.`,
        };
    }
  }
  // 6. The league's state on the lead measure.
  const all = [...stats.values()].reduce(
    (a, t) => ({
      pass: a.pass + t.off.passEpa,
      db: a.db + t.off.dropbacks,
      rush: a.rush + t.off.rushEpa,
      r: a.r + t.off.rushes,
    }),
    { pass: 0, db: 0, rush: 0, r: 0 },
  );
  return {
    subject: 'The league by the numbers',
    lead: `Across the league, a dropback is worth ${epa(per(all.pass, all.db))} expected points and a run ${epa(per(all.rush, all.r))}. The gap is why teams throw.`,
  };
}

/** The column due now, or null: not a checkpoint, or not enough counted games to rank every club. */
export function gazetteFor(
  league: League,
): { edition: Edition; subject: string; body: string; tables: GazetteTable[] } | null {
  const edition = editionAt(league);
  if (!edition) return null;
  const stats = teamAdvanced(league);
  if ([...stats.values()].some((t) => t.games < MIN_TEAM_GAMES)) return null;
  const players = playerAdvanced(league);
  const seeds = edition === 'preview' ? league.conferences.flatMap((_, c) => conferenceSeeds(league, c)) : undefined;
  const themes = THEMES[edition];
  const measures = themes.filter((x): x is keyof typeof TEAM => x in TEAM).map((x) => TEAM[x]);
  const tables = themes.map((x) =>
    x in TEAM
      ? teamTable(league, stats, TEAM[x as keyof typeof TEAM], seeds)
      : playerTable(league, players, x as PlayerMeasure),
  );
  const s =
    edition === 'preview'
      ? previewStory(league, stats, seeds!)
      : edition === 'wrap'
        ? wrapStory(league, stats)
        : story(league, edition, stats, measures);
  const context = tables
    .filter((t) => t.rows.length > 1)
    .map((t) => {
      const top = t.rows[0],
        bottom = t.rows.at(-1)!;
      return `${t.title}: ${t.players ? top.name : `the ${top.name}`} lead${t.players ? 's' : ''} at ${fmt(t.unit, top.value)}${t.players ? '' : `; the ${bottom.name} trail at ${fmt(t.unit, bottom.value)}`}.`;
    })
    .join(' ');
  const us = league.teams[league.userTeamId];
  const close = employed(league)
    ? `The ${name(us)} sit ${ordinal(rankOf(league, stats, TEAM.offEpa, us.id))} on offense and ${ordinal(rankOf(league, stats, TEAM.defEpa, us.id))} on defense.`
    : '';
  return {
    edition,
    subject: s.subject,
    body: [s.lead, context, close].filter(Boolean).join('\n\n'),
    tables,
  };
}

/** The playoff field on both sides of the ball, and the widest first-round gap. */
function previewStory(league: League, stats: Map<number, TeamAdvanced>, seeds: number[]): Story {
  const net = (id: number) => TEAM.offEpa.value(stats.get(id)!) - TEAM.defEpa.value(stats.get(id)!);
  const pairs = league.conferences.flatMap((_, c) => {
    const s = conferenceSeeds(league, c);
    return [
      [s[1], s[6]],
      [s[2], s[5]],
      [s[3], s[4]],
    ].filter(([a, b]) => a !== undefined && b !== undefined) as [number, number][];
  });
  const widest = pairs.sort((x, y) => Math.abs(net(y[0]) - net(y[1])) - Math.abs(net(x[0]) - net(x[1])))[0];
  const ours = seeds.includes(league.userTeamId) && employed(league);
  if (!widest) return { subject: 'Playoff preview: the field by the numbers', lead: 'The field is set.' };
  const [a, b] = widest.map((id) => league.teams[id]);
  return {
    subject: `Playoff preview: the ${name(a)} and the ${name(b)}, the widest gap of the first round`,
    lead: `On EPA per play, offense minus defense, the ${name(a)} and the ${name(b)} are the furthest apart of any first-round pairing: ${epa(net(a.id))} against ${epa(net(b.id))}.${ours ? ` The ${name(league.teams[league.userTeamId])} come in ${ordinal(fullRank(stats, TEAM.offEpa, league.userTeamId))} on offense.` : ''}`,
  };
}

/** The champion's season in the numbers. */
function wrapStory(league: League, stats: Map<number, TeamAdvanced>): Story {
  const final = league.games.find((g) => g.season === league.season && g.playoffRound === 'FINAL' && g.result);
  if (!final?.result) return { subject: 'The season in numbers', lead: 'The season is over.' };
  const champ = league.teams[final.result.homeScore > final.result.awayScore ? final.homeId : final.awayId];
  return {
    subject: `The season in numbers: how the ${name(champ)} won it`,
    lead: `The ${name(champ)} won the title with the ${ordinal(fullRank(stats, TEAM.offEpa, champ.id))} offense and the ${ordinal(fullRank(stats, TEAM.defEpa, champ.id))} defense by EPA per play.`,
  };
}
