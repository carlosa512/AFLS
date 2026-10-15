import { useState } from 'react';
import { gamesInWeek } from '../../engine/league';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { REGULAR_SEASON_WEEKS } from '../../engine/season/schedule';
import { computeRecords } from '../../engine/season/standings';
import type { League } from '../../engine/types';
import { useNav } from '../App';
import { Panel, TeamLabel } from '../components';
import { recordText, weekLabel } from '../format';
import { ScoreLine } from './Home';

function MySchedule({ league }: { league: League }) {
  const nav = useNav();
  const uid = league.userTeamId;
  const records = computeRecords(league);
  const games = league.games.filter((g) => g.season === league.season && (g.homeId === uid || g.awayId === uid));
  const lastWeek = Math.max(REGULAR_SEASON_WEEKS, ...games.map((g) => g.week));
  const rows = Array.from({ length: lastWeek }, (_, i) => i + 1).map((week) => ({ week, game: games.find((g) => g.week === week) }));

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Week</th>
            <th>Opponent</th>
            <th>Result</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ week, game }) => {
            if (!game) {
              if (week > REGULAR_SEASON_WEEKS) return null;
              return (
                <tr key={week}>
                  <td>{weekLabel(week)}</td>
                  <td className="muted" colSpan={3}>
                    Bye
                  </td>
                </tr>
              );
            }
            const home = game.homeId === uid;
            const opp = league.teams[home ? game.awayId : game.homeId];
            const r = game.result;
            const us = r ? (home ? r.homeScore : r.awayScore) : 0;
            const them = r ? (home ? r.awayScore : r.homeScore) : 0;
            const res = r ? (us > them ? 'W' : us < them ? 'L' : 'T') : null;
            return (
              <tr key={week} className={r ? 'clickable' : week === league.week ? 'is-user' : ''} onClick={r ? () => nav.openGame(game.id) : undefined}>
                <td>
                  {r ? (
                    <button className="linklike" onClick={(e) => (e.stopPropagation(), nav.openGame(game.id))}>
                      {game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(week)}
                    </button>
                  ) : game.playoffRound ? (
                    ROUND_NAMES[game.playoffRound]
                  ) : (
                    weekLabel(week)
                  )}
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span className="muted" style={{ width: '1.2em' }}>
                      {game.neutral ? 'vs' : home ? 'vs' : '@'}
                    </span>
                    <TeamLabel team={opp} sub={recordText(records.get(opp.id)!)} />
                  </span>
                </td>
                <td>{res ? <span className={`res-${res}`}>{res}</span> : <span className="muted">{week === league.week ? 'Next' : '–'}</span>}</td>
                <td className="num">{r ? `${us}–${them}${r.overtime ? ' OT' : ''}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekView({ league }: { league: League }) {
  const maxWeek = Math.max(...league.games.filter((g) => g.season === league.season).map((g) => g.week));
  const [week, setWeek] = useState(Math.min(Math.max(1, league.week - 1), maxWeek));
  const games = gamesInWeek(league, week);
  const played = games.filter((g) => g.result);
  const upcoming = games.filter((g) => !g.result);
  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-sm" disabled={week <= 1} onClick={() => setWeek(week - 1)} aria-label="Previous week">
          ◀
        </button>
        <select aria-label="Week" id="week-select" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              {weekLabel(w)}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" disabled={week >= maxWeek} onClick={() => setWeek(week + 1)} aria-label="Next week">
          ▶
        </button>
      </div>
      {played.length > 0 && (
        <div className="scores-grid">
          {played.map((g) => (
            <ScoreLine key={g.id} league={league} game={g} />
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="scores-grid">
          {upcoming.map((g) => (
            <div key={g.id} className="score-line" style={{ cursor: 'default' }}>
              <span className="t">
                <TeamLabel team={league.teams[g.awayId]} />
              </span>
              <span className="s muted">@</span>
              <span className="t">
                <TeamLabel team={league.teams[g.homeId]} />
              </span>
              <span />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Schedule({ league }: { league: League }) {
  const [mode, setMode] = useState<'mine' | 'week'>('mine');
  return (
    <Panel
      title="Schedule"
      action={
        <div className="seg" role="group" aria-label="Schedule view">
          <button aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>
            My team
          </button>
          <button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
            League by week
          </button>
        </div>
      }
    >
      {mode === 'mine' ? <MySchedule league={league} /> : <WeekView league={league} />}
    </Panel>
  );
}
