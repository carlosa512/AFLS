import { allSeeds, PLAYOFF_ROUNDS, playoffGames, ROUND_NAMES, winnerOf } from '../../engine/season/playoffs';
import type { Game, League } from '../../engine/types';
import { useNav } from '../App';
import { Panel, SortTh, sortRows, TeamChip, TeamLink, useSort } from '../components';
import { recordText, resultsSeason } from '../format';
import { PlayoffPicture } from './Standings';

function BracketGame({ league, game, seedOf }: { league: League; game: Game; seedOf: (id: number) => number }) {
  const nav = useNav();
  const r = game.result;
  const winner = winnerOf(game);
  const side = (id: number, score?: number) => {
    const t = league.teams[id];
    return (
      <span className={`t${winner !== null && winner !== id ? ' lost' : ''}`}>
        <TeamChip team={t} />
        <span className="muted num" style={{ fontSize: '0.75rem' }}>
          {seedOf(id) + 1}
        </span>
        {t.name}
        {score !== undefined && (
          <b className="num" style={{ marginLeft: 'auto' }}>
            {score}
          </b>
        )}
      </span>
    );
  };
  return (
    <button
      className="score-line"
      style={{ gridTemplateColumns: '1fr', cursor: r ? 'pointer' : 'default' }}
      onClick={r ? () => nav.openGame(game.id) : undefined}
      disabled={!r}
    >
      {side(game.awayId, r?.awayScore)}
      {side(game.homeId, r?.homeScore)}
    </button>
  );
}

export function Playoffs({ league }: { league: League }) {
  const season = resultsSeason(league);
  const games = playoffGames(league, undefined, season);
  if (league.phase === 'regular') {
    return (
      <>
        <div className="notice">
          The top seven teams in each conference make the playoffs: four division winners and three wild cards. The 1
          seed gets a bye. This is the field if the season ended today.
        </div>
        <div className="grid-2">
          {league.conferences.map((conf, c) => (
            <Panel key={conf.name} title={conf.name}>
              <PlayoffPicture league={league} conference={c} />
            </Panel>
          ))}
        </div>
        <LeagueHistory league={league} />
      </>
    );
  }
  const seeds = allSeeds(league, season);
  const seedOf = (id: number) => seeds.flat().indexOf(id) % 7;
  return (
    <>
      <Panel title={`${season} playoffs`}>
        <div className="table-scroll">
          <div className="bracket">
            {PLAYOFF_ROUNDS.map((round) => (
              <div key={round} className="bracket-col">
                <span className="eyebrow">{ROUND_NAMES[round]}</span>
                {games
                  .filter((g) => g.playoffRound === round)
                  .sort((a, b) => league.teams[a.homeId].conference - league.teams[b.homeId].conference)
                  .map((g) => (
                    <BracketGame key={g.id} league={league} game={g} seedOf={seedOf} />
                  ))}
                {!games.some((g) => g.playoffRound === round) && <span className="muted">To be decided</span>}
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <LeagueHistory league={league} />
    </>
  );
}

const winPct = (r: { w: number; l: number; t: number }) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

/** Every finished season: who won it all, who came closest, the best regular season, and how you did. */
function LeagueHistory({ league }: { league: League }) {
  const user = league.teams[league.userTeamId];
  const [sort, onSort] = useSort<'season' | 'mine'>({ key: 'season', desc: true });
  const history = sortRows(league.history, sort, (h, key) =>
    key === 'season' ? h.season : h.records[user.id] ? winPct(h.records[user.id]) : -1,
  );
  const titles = history.filter((h) => h.championId === user.id).length;
  const finals = history.filter((h) => h.runnerUpId === user.id).length;
  return (
    <Panel title="League history">
      {history.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Champions are listed here once the first season is over.
        </p>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            {user.city} {user.name}: {titles} title{titles === 1 ? '' : 's'}
            {finals ? `, ${finals} more championship game${finals === 1 ? '' : 's'}` : ''} in {history.length} season
            {history.length === 1 ? '' : 's'}.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Season" k="season" sort={sort} onSort={onSort} className="num" />
                  <th>Champion</th>
                  <th>Runner-up</th>
                  <th>Best record</th>
                  <SortTh label="Your record" k="mine" sort={sort} onSort={onSort} className="num" />
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const best = Object.entries(h.records).sort(([, a], [, b]) => winPct(b) - winPct(a))[0];
                  const mine = h.records[user.id];
                  return (
                    <tr key={h.season} className={h.championId === user.id ? 'is-user' : ''}>
                      <td className="num">{h.season}</td>
                      <td>
                        <TeamLink team={league.teams[h.championId]} chip full />
                      </td>
                      <td>
                        <TeamLink team={league.teams[h.runnerUpId]} chip full />
                      </td>
                      <td>
                        {best && (
                          <>
                            <TeamLink team={league.teams[Number(best[0])]} chip full />{' '}
                            <span className="muted num">{recordText(best[1])}</span>
                          </>
                        )}
                      </td>
                      <td className="num">{mine ? recordText(mine) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
