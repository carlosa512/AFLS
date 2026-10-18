import { useState } from 'react';
import { userGame } from '../../engine/league';
import { crewSeason, crewSeasons, crewStanding, crewTable, FOUL_KINDS, FOULS, gameCrew, RANK_MIN_GAMES, refName, type CrewStat } from '../../engine/officials';
import type { Game, League, Team } from '../../engine/types';
import { useNav } from '../App';
import { Panel, SortTh, sortRows, useSort } from '../components';
import { crewStandingText, ordinal, resultsSeason } from '../format';

/** The crew working a game, linked to the crews page, and where it ranks in flags per game. */
export function CrewNote({ league, game }: { league: League; game: Game }) {
  const nav = useNav();
  const crew = gameCrew(league, game);
  if (!crew) return null;
  const standing = crewStanding(league, crew, game.season);
  return (
    <span>
      <button className="linklike" onClick={() => nav.go({ view: 'stats', tab: 'officials' })}>
        {refName(crew)}
      </button>
      {standing && <span className="muted"> ({crewStandingText(standing, game.season)})</span>}
    </span>
  );
}

const COLUMNS: [CrewStat, string, string][] = [
  ['flags', 'Flags/g', 'Every accepted penalty, both teams'],
  ['holding', 'Holding/g', 'Offensive holding'],
  ['coverage', 'Coverage/g', 'Pass interference and defensive holding'],
];

/**
 * The crews page. A crew's tendencies are hidden; what it calls is not, and this is where a player
 * learns who throws flags and who lets them play.
 */
export function Officials({ league }: { league: League }) {
  const seasons = crewSeasons(league);
  const [picked, setPicked] = useState(() => resultsSeason(league));
  const season = seasons.includes(picked) ? picked : (seasons[0] ?? picked);
  const [sort, onSort] = useSort<'name' | 'games' | CrewStat>({ key: 'flags', desc: true });
  const { rows, ranked } = crewTable(league, season);
  const next = userGame(league);
  const nextCrew = next && !next.result ? gameCrew(league, next) : undefined;
  const sorted = sortRows(rows, sort, (r, key) => (key === 'name' ? r.crew.lastName : key === 'games' ? r.games : r.games ? r.perGame[key] : -1));

  return (
    <Panel
      title="Officiating crews"
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
      <p className="muted" style={{ marginTop: 0 }}>
        Each game gets one of {rows.length} crews. Some throw flags all day, some let the linemen hold. You can't see their habits, only what they call.
        Holding is offensive holding; coverage is pass interference and defensive holding. Ranks show once a crew has worked {RANK_MIN_GAMES} games.
      </p>
      {seasons.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          The crews' numbers start with the next game played.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh label="Head referee" k="name" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                <SortTh label="Games" k="games" sort={sort} onSort={onSort} className="num" />
                {COLUMNS.map(([key, label, title]) => (
                  <SortTh key={key} label={<span title={title}>{label}</span>} k={key} sort={sort} onSort={onSort} className="num" />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.crew.id} className={r.crew === nextCrew ? 'is-user' : undefined}>
                  <td className="sticky-col">
                    {refName(r.crew, true)}
                    {r.crew === nextCrew && <span className="tag-pill" style={{ marginLeft: 6 }}>Next game</span>}
                  </td>
                  <td className="num">{r.games}</td>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className="num">
                      {r.games ? r.perGame[key].toFixed(1) : '–'}
                      {r.ranks && <span className="muted small"> {ordinal(r.ranks[key])}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {seasons.length > 0 && ranked === 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          No crew has worked {RANK_MIN_GAMES} games yet: too few to rank.
        </p>
      )}
    </Panel>
  );
}

/** What the crew called in a game, by kind and team, beside what it calls in a typical game this season. */
export function GameOfficials({ league, game, away, home }: { league: League; game: Game; away: Team; home: Team }) {
  const nav = useNav();
  const r = game.result;
  const crew = gameCrew(league, game);
  // Games played before the crews have neither a crew nor penalties by kind.
  if (!r || !crew || !r.home.flags || !r.away.flags) return null;
  const line = crewSeason(league, game.season).get(crew.id);
  const avg = (n: number) => (line ? (n / line.games).toFixed(1) : '–');
  const rows = FOUL_KINDS.map((f) => [FOULS[f].label, r.away.flags![f] ?? 0, r.home.flags![f] ?? 0, avg(line?.fouls[f] ?? 0)] as const);
  const total = line ? FOUL_KINDS.reduce((s, f) => s + line.fouls[f], 0) : 0;
  return (
    <Panel title="Officials">
      <p style={{ marginTop: 0 }}>
        Crew:{' '}
        <button className="linklike" onClick={() => nav.go({ view: 'stats', tab: 'officials' })}>
          {refName(crew, true)}
        </button>
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Penalty</th>
              <th className="num">{away.abbrev}</th>
              <th className="num">{home.abbrev}</th>
              <th className="num" title="Per game, both teams, this season">
                Crew avg
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, h, crewAvg]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{a}</td>
                <td className="num">{h}</td>
                <td className="num muted">{crewAvg}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td className="num">
                <strong>{r.away.penalties}</strong>
              </td>
              <td className="num">
                <strong>{r.home.penalties}</strong>
              </td>
              <td className="num muted">{avg(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {line && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Crew avg: per game, both teams, over the {line.games} game{line.games === 1 ? '' : 's'} it has worked this season.
        </p>
      )}
    </Panel>
  );
}
