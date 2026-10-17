import { useState } from 'react';
import { leaders, LEADER_CATEGORIES, passerRating, seasonRecords, statLine, statSeasons, type StatScope } from '../../engine/stats';
import type { League, Player, StatLine } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, SortTh, sortRows, useSort } from '../components';
import { resultsSeason } from '../format';

export type StatsTab = 'leaders' | 'players' | 'records';

const TABS: [StatsTab, string][] = [
  ['leaders', 'Leaders'],
  ['players', 'Player stats'],
  ['records', 'Records'],
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
            <button key={key} role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => nav.go({ view: 'stats', tab: key })}>
              {label}
            </button>
          ))}
        </div>
        {tab !== 'records' && seasons.length > 0 && <ScopeSelect seasons={seasons} value={scope} onChange={setPicked} />}
      </div>
      {seasons.length === 0 ? (
        <Panel title="Stats">
          <p className="muted" style={{ margin: 0 }}>
            Stats appear once the first week is played.
          </p>
        </Panel>
      ) : tab === 'players' ? (
        <PlayerStats league={league} scope={scope} />
      ) : tab === 'records' ? (
        <Records league={league} />
      ) : (
        <Leaders league={league} scope={scope} />
      )}
    </>
  );
}

function ScopeSelect({ seasons, value, onChange }: { seasons: number[]; value: StatScope; onChange: (s: StatScope) => void }) {
  return (
    <select aria-label="Season" value={String(value)} onChange={(e) => onChange(e.target.value === 'career' ? 'career' : Number(e.target.value))}>
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

function PlayerLink({ league, player: p, short = false }: { league: League; player: Player; short?: boolean }) {
  const nav = useNav();
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  return (
    <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
      <PlayerAvatar player={p} team={team} size={28} />
      <span>{short ? `${p.firstName[0]}. ${p.lastName}` : `${p.firstName} ${p.lastName}`}</span>
    </button>
  );
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
                        <PlayerLink league={league} player={r.player} short />
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
                    <tr key={`${r.player.id}-${r.season}`} className={r.player.teamId === league.userTeamId ? 'is-user' : ''}>
                      <td className="num muted" style={{ width: '1.5em' }}>
                        {i + 1}
                      </td>
                      <td>
                        <PlayerLink league={league} player={r.player} short />
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
const ratio = (a: keyof StatLine, b: keyof StatLine, scale = 1) => (s: StatLine) => ((s[b] ?? 0) ? ((s[a] ?? 0) / s[b]!) * scale : 0);
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
      { key: 'pct', label: 'Pct', title: 'Completion percentage', value: ratio('passCmp', 'passAtt', 100), format: fixed1, rate: true },
      { key: 'passYds', label: 'Yds', value: n('passYds') },
      { key: 'ya', label: 'Y/A', title: 'Yards per attempt', value: ratio('passYds', 'passAtt'), format: fixed1, rate: true },
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
      { key: 'ypc', label: 'Avg', title: 'Yards per carry', value: ratio('rushYds', 'rushAtt'), format: fixed1, rate: true },
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
      { key: 'sacks', label: 'Sck', title: 'Sacks', value: n('sacks'), format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
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
      { key: 'fgPct', label: 'Pct', title: 'Field-goal percentage', value: ratio('fgMade', 'fgAtt', 100), format: fixed1, rate: true },
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
      { key: 'avg', label: 'Avg', title: 'Yards per punt', value: ratio('puntYds', 'punts'), format: fixed1, rate: true },
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
      { key: 'krAvg', label: 'Avg', title: 'Yards per kick return', value: ratio('krYds', 'krAtt'), format: fixed1, rate: true },
      { key: 'krTd', label: 'TD', title: 'Kick-return touchdowns', value: n('krTd') },
      { key: 'prAtt', label: 'PR', title: 'Punt returns', value: n('prAtt') },
      { key: 'prYds', label: 'Yds', title: 'Punt-return yards', value: n('prYds') },
      { key: 'prAvg', label: 'Avg', title: 'Yards per punt return', value: ratio('prYds', 'prAtt'), format: fixed1, rate: true },
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
          <select aria-label="Players" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value as 'all' | 'mine')}>
            <option value="all">Whole league</option>
            <option value="mine">Your roster</option>
          </select>
        </span>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Regular season. Click a column to sort.{hasRates ? ' Averages and percentages rank qualified players first (enough attempts per game).' : ''} Team is
        each player's current club.
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
                <SortTh key={c.key} label={<span title={c.title}>{c.label}</span>} k={c.key} sort={sort} onSort={onSort} className="num" />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ p, s }, i) => (
              <tr key={p.id} className={p.teamId === league.userTeamId ? 'is-user' : ''}>
                <td className="num muted">{i + 1}</td>
                <td className="sticky-col">
                  <PlayerLink league={league} player={p} />
                </td>
                <td>{teamTag(league, p)}</td>
                <td>{p.position}</td>
                <td className="num">{gp(s)}</td>
                {table.cols.map((c) => {
                  const v = c.value(s);
                  return (
                    <td key={c.key} className={`num${c.rate && !table.qualifies(s) ? ' muted' : ''}`} style={sort.key === c.key ? { fontWeight: 700 } : undefined}>
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
