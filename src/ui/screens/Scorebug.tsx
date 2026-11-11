/**
 * The scorebug over the field, the same for a live game and a replay: each club's name, record going in, timeouts
 * left and score, then the clock. It reads through the last play whose result has been shown, so a score or a
 * timeout never gets ahead of the picture. Spec: docs/superpowers/specs/2026-11-10-broadcast-info-design.md §2.
 */
import type { Game, League, PlayLogEntry, Team } from '../../engine/types';
import { gameClock } from '../format';
import { recordBefore, timeoutsAt } from '../gameRead';

const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];

/** A snap's down, distance and spot in words; null between snaps (a kickoff, a timeout). */
export function downParts(
  e: PlayLogEntry,
  home: Team,
  away: Team,
): { ord: string; togo: string; down: string; spot: string } | null {
  if (!e.down) return null;
  const ord = ORDINALS[e.down];
  const togo = e.yardLine + e.distance >= 100 ? 'Goal' : String(e.distance);
  const off = e.offense === home.id ? home : away;
  const def = off === home ? away : home;
  const where =
    e.yardLine === 50
      ? 'midfield'
      : e.yardLine < 50
        ? `${off.abbrev} ${e.yardLine}`
        : `${def.abbrev} ${100 - e.yardLine}`;
  return { ord, togo, down: `${ord} & ${togo}`.toUpperCase(), spot: `Ball on ${where}` };
}

const recordText = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;

export function Scorebug({
  league,
  game,
  home,
  away,
  plays,
  index,
  told,
  live = false,
  final = false,
  label,
}: {
  league: League;
  game: Game;
  home: Team;
  away: Team;
  plays: readonly PlayLogEntry[];
  /** The play on screen. */
  index: number;
  /** Its result has been shown: the board reads through it, else through the play before. */
  told: boolean;
  /** A game being played now: the clock carries the live dot. */
  live?: boolean;
  final?: boolean;
  /** The week or the playoff round. */
  label: string;
}) {
  const entry = plays[index];
  const shown = told ? index : index - 1;
  const board = shown >= 0 ? plays[shown] : { homeScore: 0, awayScore: 0 };
  const left = timeoutsAt(plays, shown, home, away);
  const period = entry.quarter <= 4 ? `Q${entry.quarter}` : 'OT';
  return (
    <div className="viewer-bug">
      {/* The game's own network signs the broadcast. White: yellow is for what is happening now. */}
      <span className="vb-net" aria-label="SNN, the Sports News Network">
        SNN
      </span>
      {[away, home].map((t) => {
        const isHome = t.id === home.id;
        const timeouts = isHome ? left.home : left.away;
        return (
          <div
            key={t.id}
            className="vb-team"
            style={{ background: t.colors[0], boxShadow: `inset 0 -3px 0 ${t.colors[1]}` }}
          >
            <span className="vb-id">
              <span className="vb-name">
                {t.abbrev}
                {!final && entry.offense === t.id && entry.down ? (
                  <span className="vb-poss" aria-label="has the ball" />
                ) : null}
              </span>
              <span className="vb-sub">
                <span className="vb-rec num">{recordText(recordBefore(league, t.id, game))}</span>
                <span className="vb-tos" role="img" aria-label={`${timeouts} timeout${timeouts === 1 ? '' : 's'} left`}>
                  {[0, 1, 2].map((k) => (
                    <i key={k} className={k < timeouts ? undefined : 'used'} />
                  ))}
                </span>
              </span>
            </span>
            <span className="vb-score">{isHome ? board.homeScore : board.awayScore}</span>
          </div>
        );
      })}
      <div className="vb-clock">
        <span>
          {final ? (
            `Final${entry.quarter > 4 ? '/OT' : ''}`
          ) : (
            <>
              {live && <span className="live-dot" aria-hidden="true" />}
              {period} · {gameClock(entry.clock)}
            </>
          )}
        </span>
        <span>{label}</span>
      </div>
    </div>
  );
}
