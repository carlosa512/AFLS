/**
 * Every team's regular season side by side, from the box scores (`teamSeasonStats`): scoring, yards,
 * turnovers, third downs and sacks, sortable. The box scores are kept for the last two seasons, so
 * those are the seasons this table can show.
 */
import { useState } from 'react';
import { teamSeasonStats, type TeamSeasonLine } from '../../engine/stats';
import type { League } from '../../engine/types';
import { useNav } from '../App';
import { Panel, SortTh, sortRows, TeamChip, useSort } from '../components';
import { recordText, resultsSeason } from '../format';

export interface TeamStatCol {
  key: string;
  /** What the column is, as a widget titles it. */
  label: string;
  /** Its table header. */
  short: string;
  value: (l: TeamSeasonLine) => number;
  format: (v: number) => string;
  /** Lower is better (points and yards allowed, giveaways). */
  fewest?: true;
}

const perGame = (n: (l: TeamSeasonLine) => number) => (l: TeamSeasonLine) => (l.games ? n(l) / l.games : 0);
const oneDp = (v: number) => v.toFixed(1);
const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`;
const count = (v: number) => String(v);

export const TEAM_COLS: TeamStatCol[] = [
  { key: 'ppg', label: 'Points per game', short: 'Pts/G', value: perGame((l) => l.pointsFor), format: oneDp },
  {
    key: 'papg',
    label: 'Points allowed',
    short: 'Opp/G',
    value: perGame((l) => l.pointsAgainst),
    format: oneDp,
    fewest: true,
  },
  {
    key: 'diff',
    label: 'Point differential',
    short: 'Diff',
    value: (l) => l.pointsFor - l.pointsAgainst,
    format: signed,
  },
  { key: 'ypg', label: 'Yards per game', short: 'Yds/G', value: perGame((l) => l.yards), format: oneDp },
  {
    key: 'yapg',
    label: 'Yards allowed',
    short: 'Opp Yds/G',
    value: perGame((l) => l.yardsAllowed),
    format: oneDp,
    fewest: true,
  },
  { key: 'take', label: 'Takeaways', short: 'Take', value: (l) => l.takeaways, format: count },
  { key: 'give', label: 'Giveaways', short: 'Give', value: (l) => l.giveaways, format: count, fewest: true },
  { key: 'to', label: 'Turnover margin', short: 'TO ±', value: (l) => l.takeaways - l.giveaways, format: signed },
  {
    key: 'third',
    label: 'Third-down rate',
    short: '3rd %',
    value: (l) => (l.thirdDownAtt ? l.thirdDownConv / l.thirdDownAtt : 0),
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
  { key: 'sacks', label: 'Sacks', short: 'Sacks', value: (l) => l.sacks, format: count },
];

/** A team's place in a column among the teams that have played: one more than the teams better at it (ties share). */
export function teamRank(stats: Map<number, TeamSeasonLine>, col: TeamStatCol, teamId: number): number {
  const v = col.value(stats.get(teamId)!);
  return 1 + [...stats.values()].filter((l) => l.games && (col.fewest ? col.value(l) < v : col.value(l) > v)).length;
}

/** The regular seasons whose box scores the league still keeps, newest first. */
export const teamStatSeasons = (league: League) =>
  [...new Set(league.games.filter((g) => g.result && !g.playoffRound).map((g) => g.season))].sort((a, b) => b - a);

export function TeamStats({ league }: { league: League }) {
  const nav = useNav();
  const seasons = teamStatSeasons(league);
  const [picked, setPicked] = useState(() => resultsSeason(league));
  const season = seasons.includes(picked) ? picked : seasons[0];
  const [sort, onSort] = useSort<string>({ key: 'diff', desc: true });
  if (season === undefined) {
    return (
      <Panel title="Team stats">
        <p className="muted" style={{ margin: 0 }}>
          Team stats appear once the first week is played.
        </p>
      </Panel>
    );
  }
  const stats = teamSeasonStats(league, season);
  const rows = league.teams.map((t) => ({ t, l: stats.get(t.id)! })).filter((r) => r.l.games > 0);
  const win = (l: TeamSeasonLine) => {
    const w = l.home.w + l.road.w + 0.5 * (l.home.t + l.road.t);
    return l.games ? w / l.games : 0;
  };
  const sorted = sortRows(rows, sort, ({ t, l }, key) =>
    key === 'team'
      ? t.name.toLowerCase()
      : key === 'rec'
        ? win(l)
        : key === 'g'
          ? l.games
          : TEAM_COLS.find((c) => c.key === key)!.value(l),
  );
  return (
    <Panel
      title={`${season} team stats`}
      action={
        seasons.length > 1 && (
          <select aria-label="Season" value={season} onChange={(e) => setPicked(Number(e.target.value))}>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s} season
              </option>
            ))}
          </select>
        )
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Regular season, from the box scores. Per-game columns divide by games played. Click a column to sort.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <SortTh label="Team" k="team" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
              <SortTh label="G" k="g" sort={sort} onSort={onSort} className="num" />
              <SortTh label="W-L" k="rec" sort={sort} onSort={onSort} className="num" />
              {TEAM_COLS.map((c) => (
                <SortTh
                  key={c.key}
                  label={<span title={c.label}>{c.short}</span>}
                  k={c.key}
                  sort={sort}
                  onSort={onSort}
                  desc={!c.fewest}
                  className="num"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ t, l }, i) => (
              <tr key={t.id} className={t.id === league.userTeamId ? 'is-user' : undefined}>
                <td className="num muted">{i + 1}</td>
                <td className="sticky-col">
                  <button className="linklike team-inline" onClick={() => nav.openTeam(t.id)}>
                    <TeamChip team={t} /> {t.name}
                  </button>
                </td>
                <td className="num">{l.games}</td>
                <td className="num">
                  {recordText({ w: l.home.w + l.road.w, l: l.home.l + l.road.l, t: l.home.t + l.road.t })}
                </td>
                {TEAM_COLS.map((c) => (
                  <td key={c.key} className="num" style={sort.key === c.key ? { fontWeight: 700 } : undefined}>
                    {c.format(c.value(l))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
