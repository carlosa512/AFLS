/**
 * The card before the kickoff, over the field in the game viewer: the week and the kickoff slot, both clubs and their
 * records coming in, the conditions at kickoff, and who is out for each side. A live game waits on it for Kick off; a
 * replay shows it a few seconds as it opens (no list: a finished game's save doesn't keep who sat out). It wears the
 * halftime and final cards' look (`GameMoments.tsx`).
 */
import { gameWeather, weatherAt } from '../../engine/weather';
import { kickoffLabel } from '../../engine/season/kickoff';
import type { Game, League, Team } from '../../engine/types';
import { PlayerLink } from '../components';
import { weatherText } from '../format';
import { recordBefore } from '../gameRead';
import type { GameOut, OutMan } from '../pregame';
import { laneColor } from './GameTimeline';

/** How many men out a side the card names before "and n more". */
export const OUT_SHOWN = 3;
/** A replay holds on the card this long as it opens. */
export const PREGAME_MS = 4000;

const recordText = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;

function OutList({ league, men, right }: { league: League; men: OutMan[]; right?: boolean }) {
  const shown = men.filter((m) => league.players[m.id]).slice(0, OUT_SHOWN);
  return (
    <div className={right ? 'pg-right' : undefined}>
      <h3>Out</h3>
      {shown.map((m) => (
        <span key={m.id}>
          <PlayerLink league={league} player={league.players[m.id]} short bold />{' '}
          <i>
            {league.players[m.id].position} · {m.what}
          </i>
        </span>
      ))}
      {men.length > shown.length && <i>and {men.length - shown.length} more</i>}
      {men.length === 0 && <i>Nobody</i>}
    </div>
  );
}

export function PregameCard({
  league,
  game,
  home,
  away,
  out,
  label,
  onKickoff,
  onSim,
}: {
  league: League;
  game: Game;
  home: Team;
  away: Team;
  /** Who is out for each side, taken as a live game starts. A replay has none. */
  out?: GameOut;
  /** "Week 2", or the playoff round. */
  label: string;
  /** A live game's buttons: each shows only when given. */
  onKickoff?: () => void;
  onSim?: () => void;
}) {
  const weather = weatherAt(game.result?.weather ?? gameWeather(league, game), 1);
  const slot = game.kickoff ? kickoffLabel(game.kickoff) : '';
  const sides = [
    { team: away, men: out?.away ?? [] },
    { team: home, men: out?.home ?? [] },
  ];
  const anyOut = sides.some((s) => s.men.length > 0);
  return (
    <div className="moment-card pregame" role="dialog" aria-label="Before the game">
      <div className="mc-in">
        <div className="mc-top">
          <span>{slot ? `${label} · ${slot}` : label}</span>
          <span className="mc-net" aria-label="SNN, the Sports News Network">
            SNN
          </span>
        </div>
        <div className="mc-score">
          {sides.map(({ team }, i) => (
            <span
              key={team.id}
              className={`mc-team pg-club${i ? ' mc-home' : ''}`}
              style={{ color: laneColor(team.colors), gridColumn: i ? 3 : 1 }}
            >
              {team.abbrev}
              <small className="num">{recordText(recordBefore(league, team.id, game))}</small>
            </span>
          ))}
          <span className="pg-at">{game.neutral ? 'vs' : 'at'}</span>
        </div>
        <div className="pg-where">
          {!game.neutral && <b>{home.city}</b>}
          {!game.neutral && ' · '}
          {weatherText(weather)}
        </div>
        {out && anyOut && (
          <>
            <div className="pg-out">
              <OutList league={league} men={out.away} />
              <OutList league={league} men={out.home} right />
            </div>
            <div className="pg-count">
              {sides
                .filter((s) => s.men.length > 0)
                .map((s) => `${s.team.abbrev} ${s.men.length} out`)
                .join(' · ')}
            </div>
          </>
        )}
        {(onSim || onKickoff) && (
          <div className="mc-btns">
            {onSim && (
              <button className="btn btn-sm" onClick={onSim}>
                Sim to final
              </button>
            )}
            {onKickoff && (
              <button className="btn btn-sm btn-primary" onClick={onKickoff}>
                Kick off
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
