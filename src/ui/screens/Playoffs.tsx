import { allSeeds, PLAYOFF_ROUNDS, playoffGames, ROUND_NAMES, winnerOf } from '../../engine/season/playoffs';
import type { Game, League } from '../../engine/types';
import { useNav } from '../App';
import { Panel, TeamChip } from '../components';
import { resultsSeason } from '../format';
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
        {score !== undefined && <b className="num" style={{ marginLeft: 'auto' }}>{score}</b>}
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
          The top seven teams in each conference make the playoffs: four division winners and three wild cards. The 1 seed gets a bye. This is
          the field if the season ended today.
        </div>
        <div className="grid-2">
          {league.conferences.map((conf, c) => (
            <Panel key={conf.name} title={conf.name}>
              <PlayoffPicture league={league} conference={c} />
            </Panel>
          ))}
        </div>
      </>
    );
  }
  const seeds = allSeeds(league, season);
  const seedOf = (id: number) => seeds.flat().indexOf(id) % 7;
  return (
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
  );
}
