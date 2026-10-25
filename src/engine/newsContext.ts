/** Public team context, read from retained regular-season box scores at the story's date. */
import { teamSeasonStats } from './stats';
import type { League, LeagueNewsReport } from './types';

type Measures = { games: number; scoring: number; passing: number; allowed: number; third: number | null };
function measures(l: League, season: number): Map<number, Measures> {
  const passing = new Map<number, number>();
  for (const g of l.games) {
    if (g.season !== season || g.playoffRound || !g.result) continue;
    passing.set(g.homeId, (passing.get(g.homeId) ?? 0) + g.result.home.passYds);
    passing.set(g.awayId, (passing.get(g.awayId) ?? 0) + g.result.away.passYds);
  }
  return new Map(
    [...teamSeasonStats(l, season)].map(([id, s]) => [
      id,
      {
        games: s.games,
        scoring: s.games ? s.pointsFor / s.games : 0,
        allowed: s.games ? s.pointsAgainst / s.games : 0,
        passing: s.games ? (passing.get(id) ?? 0) / s.games : 0,
        third: s.thirdDownAtt ? s.thirdDownConv / s.thirdDownAtt : null,
      },
    ]),
  );
}
const metrics = [
  { key: 'scoring', label: 'points per game', scale: 7, low: false, format: (n: number) => n.toFixed(1) },
  { key: 'passing', label: 'passing yards per game', scale: 50, low: false, format: (n: number) => n.toFixed(1) },
  {
    key: 'third',
    label: 'third-down conversions',
    scale: 0.1,
    low: false,
    format: (n: number) => `${(n * 100).toFixed(1)}%`,
  },
  { key: 'allowed', label: 'points allowed per game', scale: 7, low: true, format: (n: number) => n.toFixed(1) },
] as const;
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;

const rank = (
  values: Map<number, Measures>,
  key: 'scoring' | 'passing' | 'third' | 'allowed',
  value: number,
  minimum = 6,
  low = false,
) => {
  // Partial/missing league history does not establish a rank among all 32 teams.
  if ([...values.values()].some((s) => s.games < minimum || s[key] === null)) return null;
  return {
    place: 1 + [...values.values()].filter((s) => (low ? s[key]! < value : s[key]! > value)).length,
    tied: [...values.values()].filter((s) => s[key] === value).length > 1,
  };
};

/** Prefer a league-leading reversal, then the largest directional change in these four areas.
 * Each scale is a meaningful football change, so 10 percentage points can be compared with 7 PPG.
 */
export function teamStatContext(l: League, teamId: number, direction: 'up' | 'down' | 'standout' = 'standout'): string {
  const now = measures(l, l.season);
  const last = measures(l, l.season - 1);
  const current = now.get(teamId)!;
  const prior = last.get(teamId)!;
  if (!current.games) return '';
  const choices = metrics.flatMap((m) => {
    const value = current[m.key];
    const before = prior[m.key];
    if (value === null) return [];
    const comparable = prior.games >= 8 && before !== null;
    const delta = comparable ? value - before : 0;
    return [
      {
        m,
        value,
        before,
        comparable,
        delta,
        rank: rank(now, m.key, value, 6, m.low),
        oldRank: comparable ? rank(last, m.key, before, 8, m.low) : null,
      },
    ];
  });
  const benefit = (x: (typeof choices)[number]) => x.delta * (x.m.low ? -1 : 1);
  const directional = choices.some((x) =>
    direction === 'up' ? benefit(x) > 0 : direction === 'down' ? benefit(x) < 0 : false,
  );
  choices.sort((a, b) => {
    const leader = (x: typeof a) => Number(x.rank?.place === 1 && (x.oldRank?.place ?? 0) >= 16);
    const change = (x: typeof a) =>
      (directional ? (direction === 'down' ? -benefit(x) : benefit(x)) : Math.abs(benefit(x))) / x.m.scale;
    return leader(b) - leader(a) || change(b) - change(a);
  });
  const c = choices[0];
  if (!c) return '';
  const rankWords = c.rank ? ` (${c.rank.tied ? 'tied ' : ''}${ordinal(c.rank.place)} in the league)` : '';
  const oldRankWords = c.oldRank ? ` (${c.oldRank.tied ? 'tied ' : ''}${ordinal(c.oldRank.place)})` : '';
  if (c.comparable && Math.abs(c.delta) > 0.0001) {
    const from = `${c.m.format(c.before!)}${oldRankWords} last season`;
    const to = `${c.m.format(c.value)}${rankWords} this season`;
    if (c.m.key === 'allowed') {
      const collapse = c.delta >= 10 || (c.delta >= 7 && (c.oldRank?.place ?? 99) <= 8 && (c.rank?.place ?? 0) >= 24);
      const change = c.delta > 0 ? (collapse ? 'has fallen off a cliff' : 'has lost ground') : 'has tightened up';
      return `Their defense ${change}: they are allowing ${c.m.format(c.value)} points per game${rankWords} this season, compared with ${from}.`;
    }
    const gap =
      c.m.key === 'third'
        ? `, a ${Math.abs(c.delta * 100).toFixed(1)} percentage-point ${c.delta > 0 ? 'increase' : 'drop'}`
        : '';
    return `Their ${c.m.label} ${c.delta > 0 ? 'have risen' : 'have fallen'} from ${from} to ${to}${gap}.`;
  }
  if (c.m.key === 'allowed') return `They are allowing ${c.m.format(c.value)} points per game${rankWords}.`;
  return c.m.key === 'third'
    ? `They are converting ${c.m.format(c.value)} of third downs${rankWords}.`
    : `They are averaging ${c.m.format(c.value)} ${c.m.label}${rankWords}.`;
}

/** Keep the evidence behind an SNN story at its original date. */
export function teamStatRows(l: League, teamId: number): LeagueNewsReport['stats'] {
  const current = measures(l, l.season);
  const old = measures(l, l.season - 1);
  const a = current.get(teamId)!;
  const b = old.get(teamId)!;
  const rankText = (r: ReturnType<typeof rank>) => (r ? `${r.tied ? 'Tied ' : ''}${ordinal(r.place)}` : '');
  return metrics.map((m) => {
    const value = a[m.key];
    const previous = b[m.key];
    return {
      label: m.label,
      current: a.games && value !== null ? m.format(value) : '—',
      previous: b.games >= 8 && previous !== null ? m.format(previous) : '—',
      currentRank: value !== null ? rankText(rank(current, m.key, value, 6, m.low)) : '',
      previousRank: b.games >= 8 && previous !== null ? rankText(rank(old, m.key, previous, 8, m.low)) : '',
    };
  });
}

/** Rotate useful supporting evidence, saving the choice with the article. Large changes earn a comparison. */
export function divisionTable(l: League, teamId: number, week: number): NonNullable<LeagueNewsReport['table']> {
  const a = measures(l, l.season).get(teamId)!;
  const b = measures(l, l.season - 1).get(teamId)!;
  const exceptional =
    a.games >= 6 &&
    b.games >= 8 &&
    metrics.some((m) => a[m.key] !== null && b[m.key] !== null && Math.abs(a[m.key]! - b[m.key]!) >= m.scale * 1.5);
  if (exceptional) return 'yearOverYear';
  return (week + teamId) % 2 ? 'team' : 'division';
}
