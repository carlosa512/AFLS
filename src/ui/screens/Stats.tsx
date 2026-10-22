import { useState } from 'react';
import {
  ALL_LEAGUE_SLOTS,
  AWARD_KEYS,
  AWARD_NAMES,
  HONOR_SLOTS,
  lineStats,
  MONTHS,
  periodLine,
  seasonAwards,
  weeklyAwards,
  type AwardWinner,
} from '../../engine/awards';
import {
  leaders,
  LEADER_CATEGORIES,
  passerRating,
  seasonRecords,
  statLine,
  statSeasons,
  type StatScope,
} from '../../engine/stats';
import type { League, Player, StatLine } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerLink, SortTh, sortRows, useSort } from '../components';
import { resultsSeason } from '../format';
import { Officials } from './Officials';
import { TeamStats } from './TeamStats';

export type StatsTab = 'leaders' | 'players' | 'teams' | 'records' | 'awards' | 'officials';

const TABS: [StatsTab, string][] = [
  ['leaders', 'Leaders'],
  ['players', 'Player stats'],
  ['teams', 'Team stats'],
  ['records', 'Records'],
  ['awards', 'Awards'],
  ['officials', 'Officials'],
];

/** Stats are regular season only, so a season is "on record" once its first week is played. */
export function Stats({ league, tab = 'leaders' }: { league: League; tab?: StatsTab }) {
  const nav = useNav();
  const seasons = statSeasons(league);
  const [picked, setPicked] = useState<StatScope>(() => resultsSeason(league));
  // Fall back to the latest season with stats (week 1 of a new season has none yet).
  const scope: StatScope = picked === 'career' || seasons.includes(picked) ? picked : (seasons[0] ?? picked);

  return (
    <>
      <div className="row office-bar" style={{ justifyContent: 'space-between' }}>
        <div className="seg office-tabs" role="tablist" aria-label="Stats">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-pressed={tab === key}
              onClick={() => nav.go({ view: 'stats', tab: key })}
            >
              {label}
            </button>
          ))}
        </div>
        {(tab === 'leaders' || tab === 'players') && seasons.length > 0 && (
          <ScopeSelect seasons={seasons} value={scope} onChange={setPicked} />
        )}
      </div>
      {seasons.length === 0 ? (
        <Panel title="Stats">
          <p className="muted" style={{ margin: 0 }}>
            Stats appear once the first week is played.
          </p>
        </Panel>
      ) : tab === 'players' ? (
        <PlayerStats league={league} scope={scope} />
      ) : tab === 'teams' ? (
        <TeamStats league={league} />
      ) : tab === 'records' ? (
        <Records league={league} />
      ) : tab === 'awards' ? (
        <Awards league={league} />
      ) : tab === 'officials' ? (
        <Officials league={league} />
      ) : (
        <Leaders league={league} scope={scope} />
      )}
    </>
  );
}

function ScopeSelect({
  seasons,
  value,
  onChange,
}: {
  seasons: number[];
  value: StatScope;
  onChange: (s: StatScope) => void;
}) {
  return (
    <select
      aria-label="Season"
      value={String(value)}
      onChange={(e) => onChange(e.target.value === 'career' ? 'career' : Number(e.target.value))}
    >
      {seasons.map((s) => (
        <option key={s} value={s}>
          {s} season
        </option>
      ))}
      <option value="career">Career totals</option>
    </select>
  );
}

const scopeLabel = (scope: StatScope) => (scope === 'career' ? 'Career' : String(scope));

/** Where a player is now: stats aren't split by team, so this is his current club. */
function teamTag(league: League, p: Player): string {
  if (p.teamId !== null) return league.teams[p.teamId].abbrev;
  return p.retired ? 'Ret.' : 'FA';
}

// ───────── leaders ─────────

function Leaders({ league, scope }: { league: League; scope: StatScope }) {
  return (
    <>
      <h2>{scope === 'career' ? 'Career leaders' : `${scope} league leaders`}</h2>
      <div className="grid-3">
        {LEADER_CATEGORIES.map((cat) => {
          const rows = leaders(league, cat, 5, scope);
          return (
            <Panel key={cat.key} title={<h3>{cat.label}</h3>}>
              <table>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.player.id} className={r.player.teamId === league.userTeamId ? 'is-user' : ''}>
                      <td className="num muted" style={{ width: '1.5em' }}>
                        {i + 1}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        <PlayerLink league={league} player={r.player} avatar={28} short />
                        <small className="muted"> {teamTag(league, r.player)}</small>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {cat.format ? cat.format(r.value) : r.value.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="muted">No qualifiers yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

// ───────── awards ─────────

const num = (v: number | undefined) => (v ?? 0).toLocaleString();
const sacks = (v: number | undefined) => `${num(v)} sack${v === 1 ? '' : 's'}`;

/** The numbers behind an award or an All-League pick, in a few words. */
export function honorLine(p: Player, s: StatLine | undefined): string {
  if (!s) return '';
  const parts = (...xs: (string | false)[]) => xs.filter(Boolean).join(' · ');
  switch (p.position) {
    case 'QB':
      return parts(
        `${num(s.passYds)} yds`,
        `${num(s.passTd)} TD`,
        `${num(s.passInt)} INT`,
        (s.rushYds ?? 0) >= 300 && `${num(s.rushYds)} rush`,
      );
    case 'RB':
      return parts(
        `${num(s.rushYds)} rush yds`,
        `${num((s.rushTd ?? 0) + (s.recTd ?? 0))} TD`,
        (s.recYds ?? 0) >= 200 && `${num(s.recYds)} rec yds`,
      );
    case 'WR':
    case 'TE':
      return parts(`${num(s.rec)} rec`, `${num(s.recYds)} yds`, `${num(s.recTd)} TD`);
    case 'DT':
    case 'EDGE':
      return parts(sacks(s.sacks), `${num(s.tfl)} TFL`, !!s.forcedFum && `${s.forcedFum} FF`);
    case 'LB':
      return parts(`${num(s.tackles)} tkl`, sacks(s.sacks), !!s.defInt && `${s.defInt} INT`);
    case 'CB':
    case 'S':
      return parts(`${num(s.defInt)} INT`, `${num(s.passDef)} PD`, `${num(s.tackles)} tkl`);
    case 'K':
      return parts(`${num(s.fgMade)}/${num(s.fgAtt)} FG`, !!s.fgLong && `long ${s.fgLong}`);
    case 'P':
      return s.punts ? `${((s.puntYds ?? 0) / s.punts).toFixed(1)} avg` : '';
    default:
      return `${num(s.gp)} games`;
  }
}

/** The club a winner played for that season (or, if that's lost, where he is now). */
function clubThen(league: League, w: AwardWinner): string {
  return w.teamId !== null ? league.teams[w.teamId].abbrev : teamTag(league, league.players[w.playerId]);
}

/**
 * A winner, his club then, and the numbers behind it: his season, or `weeks` for a player of the
 * week or month (shown while those box scores are kept).
 */
export function WinnerCell({
  league,
  winner: w,
  season,
  weeks,
}: {
  league: League;
  winner: AwardWinner | null | undefined;
  season: number;
  weeks?: [number, number];
}) {
  if (!w) return <span className="muted">—</span>;
  const p = league.players[w.playerId];
  // Linemen have no stats of their own: show what their line did.
  const line = p.position === 'OL' && w.teamId !== null ? lineStats(league, season, w.teamId) : null;
  const numbers = line
    ? `line: ${line.ypc.toFixed(1)} yds/carry · ${line.sacked} sacks allowed`
    : honorLine(p, weeks ? periodLine(league, season, weeks, p.id) : p.stats[season]);
  return (
    <span className="stack" style={{ gap: 2 }}>
      <PlayerLink league={league} player={p} avatar={28} short />
      <small className="muted">
        {p.position} · {clubThen(league, w)}
        {numbers && ` · ${numbers}`}
      </small>
    </span>
  );
}

/** One row per All-League spot, in the order the teams are stored. */
const SLOT_ROWS = ALL_LEAGUE_SLOTS.flatMap(([pos, count]) =>
  Array.from({ length: count }, (_, i) => ({ pos, firstOfPos: i === 0 })),
);

/** Players of the week or month for one season: a row per period, a column per conference and side. */
export function HonorTable({
  league,
  season,
  rows,
}: {
  league: League;
  season: number;
  rows: { label: string; weeks: [number, number]; winners: (AwardWinner | null)[] }[];
}) {
  const userCell = (w: AwardWinner | null) =>
    w && league.players[w.playerId].teamId === league.userTeamId ? 'is-user' : '';
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th />
            {HONOR_SLOTS.map(({ conference, side }) => (
              <th key={`${conference}-${side}`}>
                {league.conferences[conference].abbrev} {side}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {r.winners.map((w, i) => (
                <td key={i} className={userCell(w)} style={{ whiteSpace: 'normal', minWidth: '11em' }}>
                  <WinnerCell league={league} winner={w} season={season} weeks={r.weeks} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Awards({ league }: { league: League }) {
  const seasons = [
    ...new Set([...league.awards.map((a) => a.season), ...league.weeklyAwards.map((w) => w.season)]),
  ].sort((a, b) => b - a);
  const [picked, setPicked] = useState<number | undefined>(seasons[0]);
  if (seasons.length === 0) {
    return (
      <Panel title="Awards">
        <p className="muted" style={{ margin: 0 }}>
          Players of the week are named after each week of the regular season, the season's awards when it ends.
        </p>
      </Panel>
    );
  }
  const season = picked !== undefined && seasons.includes(picked) ? picked : seasons[0];
  const awards = seasonAwards(league, season);
  const weekly = weeklyAwards(league, season);
  const months = MONTHS.filter((m) => weekly?.months[m.key]).map((m) => ({
    label: m.label,
    weeks: m.weeks,
    winners: weekly!.months[m.key]!,
  }));
  const weeks = Object.entries(weekly?.weeks ?? {})
    .map(([w, winners]) => ({ week: Number(w), winners }))
    .sort((a, b) => b.week - a.week)
    .map(({ week, winners }) => ({ label: `Week ${week}`, weeks: [week, week] as [number, number], winners }));
  const userRow = (w: AwardWinner | undefined) =>
    w && league.players[w.playerId].teamId === league.userTeamId ? 'is-user' : '';
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{season} awards</h2>
        <select aria-label="Awards season" value={season} onChange={(e) => setPicked(Number(e.target.value))}>
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s} season
            </option>
          ))}
        </select>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Voted on the numbers and the standings, the way the press votes: players of the week and month as the season
        goes, the season's awards when the regular season ends. Teams are where each player played at the time.
      </p>
      {awards ? (
        <div className="grid-2">
          <Panel title={<h3>Season awards</h3>}>
            <table>
              <tbody>
                {AWARD_KEYS.map((k) => (
                  <tr key={k} className={userRow(awards.winners[k])}>
                    <th scope="row" style={{ whiteSpace: 'normal' }}>
                      {AWARD_NAMES[k]}
                    </th>
                    <td style={{ whiteSpace: 'normal' }}>
                      <WinnerCell league={league} winner={awards.winners[k]} season={season} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={<h3>All-League teams</h3>}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>First team</th>
                    <th>Second team</th>
                  </tr>
                </thead>
                <tbody>
                  {SLOT_ROWS.map(({ pos, firstOfPos }, at) => (
                    <tr key={at}>
                      <td className="muted">{firstOfPos ? pos : ''}</td>
                      {awards.allLeague.map((squad, t) => (
                        <td key={t} className={userRow(squad[at])} style={{ whiteSpace: 'normal' }}>
                          <WinnerCell league={league} winner={squad[at]} season={season} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel title={<h3>Season awards</h3>}>
          <p className="muted" style={{ margin: 0 }}>
            Voted when the regular season ends.
          </p>
        </Panel>
      )}
      {months.length > 0 && (
        <Panel title={<h3>Players of the month</h3>}>
          <HonorTable league={league} season={season} rows={months} />
        </Panel>
      )}
      {weeks.length > 0 && (
        <Panel title={<h3>Players of the week</h3>}>
          <HonorTable league={league} season={season} rows={weeks} />
        </Panel>
      )}
    </>
  );
}

// ───────── records ─────────

function Records({ league }: { league: League }) {
  return (
    <>
      <h2>Single-season records</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        The best regular seasons since the league began. Career totals are under Leaders (choose “Career totals”).
      </p>
      <div className="grid-3">
        {LEADER_CATEGORIES.map((cat) => {
          const rows = seasonRecords(league, cat, 10);
          return (
            <Panel key={cat.key} title={<h3>{cat.label}</h3>}>
              <table>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.player.id}-${r.season}`}
                      className={r.player.teamId === league.userTeamId ? 'is-user' : ''}
                    >
                      <td className="num muted" style={{ width: '1.5em' }}>
                        {i + 1}
                      </td>
                      <td>
                        <PlayerLink league={league} player={r.player} avatar={28} short />
                      </td>
                      <td className="num muted">{r.season}</td>
                      <td className="num" style={{ fontWeight: 700 }}>
                        {cat.format ? cat.format(r.value) : r.value.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td className="muted">No qualifiers yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

// ───────── full stat tables ─────────

interface StatCol {
  key: string;
  label: string;
  title?: string;
  value: (s: StatLine) => number;
  format?: (v: number) => string;
  /** A rate (average, percentage): low-volume lines sort below qualified ones. */
  rate?: boolean;
}

interface StatTable {
  key: string;
  label: string;
  /** Who belongs in the table at all. */
  include: (s: StatLine) => boolean;
  /** Enough volume for a rate to count, per game played (NFL-style minimums). */
  qualifies: (s: StatLine) => boolean;
  cols: StatCol[];
  sortBy: string;
}

const n = (k: keyof StatLine) => (s: StatLine) => s[k] ?? 0;
const ratio =
  (a: keyof StatLine, b: keyof StatLine, scale = 1) =>
  (s: StatLine) =>
    (s[b] ?? 0) ? ((s[a] ?? 0) / s[b]!) * scale : 0;
const fixed1 = (v: number) => v.toFixed(1);
const gp = (s: StatLine) => s.gp ?? 0;

const TABLES: StatTable[] = [
  {
    key: 'passing',
    label: 'Passing',
    include: (s) => (s.passAtt ?? 0) > 0,
    qualifies: (s) => (s.passAtt ?? 0) >= 14 * gp(s),
    sortBy: 'passYds',
    cols: [
      { key: 'passCmp', label: 'Cmp', value: n('passCmp') },
      { key: 'passAtt', label: 'Att', value: n('passAtt') },
      {
        key: 'pct',
        label: 'Pct',
        title: 'Completion percentage',
        value: ratio('passCmp', 'passAtt', 100),
        format: fixed1,
        rate: true,
      },
      { key: 'passYds', label: 'Yds', value: n('passYds') },
      {
        key: 'ya',
        label: 'Y/A',
        title: 'Yards per attempt',
        value: ratio('passYds', 'passAtt'),
        format: fixed1,
        rate: true,
      },
      { key: 'passTd', label: 'TD', value: n('passTd') },
      { key: 'passInt', label: 'Int', value: n('passInt') },
      { key: 'sacked', label: 'Sck', title: 'Times sacked', value: n('sacked') },
      { key: 'rating', label: 'Rate', title: 'Passer rating', value: passerRating, format: fixed1, rate: true },
    ],
  },
  {
    key: 'rushing',
    label: 'Rushing',
    include: (s) => (s.rushAtt ?? 0) > 0,
    qualifies: (s) => (s.rushAtt ?? 0) >= 6.25 * gp(s),
    sortBy: 'rushYds',
    cols: [
      { key: 'rushAtt', label: 'Att', value: n('rushAtt') },
      { key: 'rushYds', label: 'Yds', value: n('rushYds') },
      {
        key: 'ypc',
        label: 'Avg',
        title: 'Yards per carry',
        value: ratio('rushYds', 'rushAtt'),
        format: fixed1,
        rate: true,
      },
      { key: 'rushTd', label: 'TD', value: n('rushTd') },
      { key: 'rushLong', label: 'Long', value: n('rushLong') },
      { key: 'fumblesLost', label: 'FL', title: 'Fumbles lost', value: n('fumblesLost') },
    ],
  },
  {
    key: 'receiving',
    label: 'Receiving',
    include: (s) => (s.rec ?? 0) > 0 || (s.targets ?? 0) > 0,
    qualifies: (s) => (s.rec ?? 0) >= 1.875 * gp(s),
    sortBy: 'recYds',
    cols: [
      { key: 'targets', label: 'Tgt', title: 'Targets', value: n('targets') },
      { key: 'rec', label: 'Rec', value: n('rec') },
      { key: 'recYds', label: 'Yds', value: n('recYds') },
      { key: 'ypr', label: 'Avg', title: 'Yards per catch', value: ratio('recYds', 'rec'), format: fixed1, rate: true },
      { key: 'recTd', label: 'TD', value: n('recTd') },
      { key: 'recLong', label: 'Long', value: n('recLong') },
    ],
  },
  {
    key: 'defense',
    label: 'Defense',
    include: (s) => (s.tackles ?? 0) + (s.sacks ?? 0) + (s.defInt ?? 0) + (s.passDef ?? 0) > 0,
    qualifies: () => true,
    sortBy: 'tackles',
    cols: [
      { key: 'tackles', label: 'Tkl', title: 'Tackles', value: n('tackles') },
      { key: 'tfl', label: 'TFL', title: 'Tackles for loss', value: n('tfl') },
      {
        key: 'sacks',
        label: 'Sck',
        title: 'Sacks',
        value: n('sacks'),
        format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
      },
      { key: 'defInt', label: 'Int', value: n('defInt') },
      { key: 'passDef', label: 'PD', title: 'Passes defended', value: n('passDef') },
      { key: 'forcedFum', label: 'FF', title: 'Forced fumbles', value: n('forcedFum') },
      { key: 'fumRec', label: 'FR', title: 'Fumble recoveries', value: n('fumRec') },
      { key: 'defTd', label: 'TD', value: n('defTd') },
    ],
  },
  {
    key: 'kicking',
    label: 'Kicking',
    include: (s) => (s.fgAtt ?? 0) + (s.xpAtt ?? 0) > 0,
    qualifies: (s) => (s.fgAtt ?? 0) >= gp(s),
    sortBy: 'fgMade',
    cols: [
      { key: 'fgMade', label: 'FGM', value: n('fgMade') },
      { key: 'fgAtt', label: 'FGA', value: n('fgAtt') },
      {
        key: 'fgPct',
        label: 'Pct',
        title: 'Field-goal percentage',
        value: ratio('fgMade', 'fgAtt', 100),
        format: fixed1,
        rate: true,
      },
      { key: 'fgLong', label: 'Long', value: n('fgLong') },
      { key: 'xpMade', label: 'XPM', value: n('xpMade') },
      { key: 'xpAtt', label: 'XPA', value: n('xpAtt') },
    ],
  },
  {
    key: 'punting',
    label: 'Punting',
    include: (s) => (s.punts ?? 0) > 0,
    qualifies: (s) => (s.punts ?? 0) >= 2 * gp(s),
    sortBy: 'avg',
    cols: [
      { key: 'punts', label: 'Punts', value: n('punts') },
      { key: 'puntYds', label: 'Yds', value: n('puntYds') },
      {
        key: 'avg',
        label: 'Avg',
        title: 'Yards per punt',
        value: ratio('puntYds', 'punts'),
        format: fixed1,
        rate: true,
      },
    ],
  },
  {
    key: 'returns',
    label: 'Returns',
    include: (s) => (s.krAtt ?? 0) + (s.prAtt ?? 0) > 0,
    qualifies: (s) => (s.krAtt ?? 0) + (s.prAtt ?? 0) >= gp(s),
    sortBy: 'krYds',
    cols: [
      { key: 'krAtt', label: 'KR', title: 'Kick returns', value: n('krAtt') },
      { key: 'krYds', label: 'Yds', title: 'Kick-return yards', value: n('krYds') },
      {
        key: 'krAvg',
        label: 'Avg',
        title: 'Yards per kick return',
        value: ratio('krYds', 'krAtt'),
        format: fixed1,
        rate: true,
      },
      { key: 'krTd', label: 'TD', title: 'Kick-return touchdowns', value: n('krTd') },
      { key: 'prAtt', label: 'PR', title: 'Punt returns', value: n('prAtt') },
      { key: 'prYds', label: 'Yds', title: 'Punt-return yards', value: n('prYds') },
      {
        key: 'prAvg',
        label: 'Avg',
        title: 'Yards per punt return',
        value: ratio('prYds', 'prAtt'),
        format: fixed1,
        rate: true,
      },
      { key: 'prTd', label: 'TD', title: 'Punt-return touchdowns', value: n('prTd') },
    ],
  },
];

/** Rows shown before "Show all": the full league can be several hundred defenders. */
const PAGE = 50;

function PlayerStats({ league, scope }: { league: League; scope: StatScope }) {
  const [tableKey, setTableKey] = useState(TABLES[0].key);
  const table = TABLES.find((t) => t.key === tableKey)!;
  const [teamFilter, setTeamFilter] = useState<'all' | 'mine'>('all');
  const [sort, onSort, setSort] = useSort<string>({ key: table.sortBy, desc: true });
  const [showAll, setShowAll] = useState(false);

  const pickTable = (key: string) => {
    const next = TABLES.find((t) => t.key === key)!;
    setTableKey(key);
    setSort({ key: next.sortBy, desc: true });
    setShowAll(false);
  };

  const rows = Object.values(league.players)
    .filter((p) => teamFilter === 'all' || p.teamId === league.userTeamId)
    .map((p) => ({ p, s: statLine(p, scope) }))
    .filter((r): r is { p: Player; s: StatLine } => !!r.s && table.include(r.s));
  const sorted = sortRows(rows, sort, ({ p, s }, key) => {
    if (key === 'name') return `${p.lastName} ${p.firstName}`.toLowerCase();
    if (key === 'team') return teamTag(league, p);
    if (key === 'pos') return POSITIONS.indexOf(p.position);
    if (key === 'gp') return gp(s);
    const col = table.cols.find((c) => c.key === key)!;
    // Keep a 3-for-3 backup from topping the completion-percentage column.
    if (col.rate && !table.qualifies(s)) return sort.desc ? -Infinity : Infinity;
    return col.value(s);
  });
  const shown = showAll ? sorted : sorted.slice(0, PAGE);
  const hasRates = table.cols.some((c) => c.rate);

  return (
    <Panel
      title={`${scopeLabel(scope)} ${table.label.toLowerCase()}`}
      action={
        <span className="row" style={{ gap: 8 }}>
          <select aria-label="Stat category" value={tableKey} onChange={(e) => pickTable(e.target.value)}>
            {TABLES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Players"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value as 'all' | 'mine')}
          >
            <option value="all">Whole league</option>
            <option value="mine">Your roster</option>
          </select>
        </span>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Regular season. Click a column to sort.
        {hasRates ? ' Averages and percentages rank qualified players first (enough attempts per game).' : ''} Team is
        each player's current team.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <SortTh label="Player" k="name" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
              <SortTh label="Team" k="team" sort={sort} onSort={onSort} desc={false} />
              <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
              <SortTh label="GP" k="gp" sort={sort} onSort={onSort} className="num" />
              {table.cols.map((c) => (
                <SortTh
                  key={c.key}
                  label={<span title={c.title}>{c.label}</span>}
                  k={c.key}
                  sort={sort}
                  onSort={onSort}
                  className="num"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ p, s }, i) => (
              <tr key={p.id} className={p.teamId === league.userTeamId ? 'is-user' : ''}>
                <td className="num muted">{i + 1}</td>
                <td className="sticky-col">
                  <PlayerLink league={league} player={p} avatar={28} />
                </td>
                <td>{teamTag(league, p)}</td>
                <td>{p.position}</td>
                <td className="num">{gp(s)}</td>
                {table.cols.map((c) => {
                  const v = c.value(s);
                  return (
                    <td
                      key={c.key}
                      className={`num${c.rate && !table.qualifies(s) ? ' muted' : ''}`}
                      style={sort.key === c.key ? { fontWeight: 700 } : undefined}
                    >
                      {c.format ? c.format(v) : v.toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5 + table.cols.length} className="muted">
                  No one has recorded {table.label.toLowerCase()} stats yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > shown.length && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => setShowAll(true)}>
            Show all {sorted.length}
          </button>
        </div>
      )}
    </Panel>
  );
}
