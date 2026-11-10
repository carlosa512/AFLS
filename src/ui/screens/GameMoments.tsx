/**
 * The graphics a game stops for, drawn over the field in either view: a banner for a score, a giveaway, a flag or an
 * injury, and a player's line after a big gain. What to show is `moments.ts`'s call; this only draws it, one thing
 * at a time, whole (nothing is revealed bit by bit). Spec:
 * docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md §3.
 */
import type { League, Team } from '../../engine/types';
import { PlayerLink } from '../components';
import { momentHold, type Moment, type Tone } from '../moments';

/** What All-22 announces itself, timed to its own staging (the officials confer, the trainers come out). */
export const ALL22_OWN: readonly Tone[] = ['flag', 'injury', 'turnover'];

/** The moments an overlay shows at this speed: not the ones the view announces itself, nor one too brief to read. */
export function shownMoments(moments: readonly Moment[], speed: number, own: readonly Tone[] = []): Moment[] {
  return moments.filter((m) => {
    if (m.kind === 'banner') return !own.includes(m.tone);
    if (m.kind === 'player' || m.kind === 'quarter') return momentHold([m], speed) > 0;
    return true;
  });
}

/** A banner: the side's block (FLAG for a flag), the call, the line under it, and a note at the side. */
export function MomentBanner({
  tone,
  team,
  head,
  line,
  side,
}: {
  tone: Tone;
  team: Team | null;
  head: string;
  line: string;
  side?: string;
}) {
  const who = team ? team.abbrev : tone === 'flag' ? 'FLAG' : '';
  return (
    <div className={`moment-banner ${tone}`}>
      {who && (
        <div
          className="mb-who"
          style={team ? { background: team.colors[0], boxShadow: `inset 0 -4px 0 ${team.colors[1]}` } : undefined}
        >
          {who}
        </div>
      )}
      <div className="mb-what">
        <b>{head}</b>
        {line && <span>{line}</span>}
      </div>
      {side && <div className="mb-side">{side}</div>}
    </div>
  );
}

export function GameMoments({
  league,
  home,
  away,
  moments,
  speed,
  own,
}: {
  league: League;
  home: Team;
  away: Team;
  /** The moments of the play on screen (`playMoments`): empty until its result has been shown. */
  moments: readonly Moment[];
  speed: number;
  /** Banners the view under this one announces itself (`ALL22_OWN`). */
  own?: readonly Tone[];
}) {
  const shown = shownMoments(moments, speed, own);
  const teamOf = (id: number | null) => (id === home.id ? home : id === away.id ? away : null);
  const banner = shown.find((m): m is Extract<Moment, { kind: 'banner' }> => m.kind === 'banner');
  // Never a line with a banner: one thing to read at a time.
  const player = banner ? undefined : shown.find((m): m is Extract<Moment, { kind: 'player' }> => m.kind === 'player');
  const man = player ? league.players[player.playerId] : undefined;
  if (!banner && !(player && man)) return null;
  // A score or a takeaway: the bench of the side it went to has something to cheer (and the crowd, at home).
  const cheer =
    banner && (banner.tone === 'score' || banner.tone === 'turnover') && banner.teamId !== null
      ? banner.teamId === home.id
        ? 'home'
        : 'away'
      : undefined;
  const club = player ? teamOf(player.teamId) : null;
  return (
    <div className="moments" aria-live="polite" data-cheer={cheer}>
      {banner && (
        <MomentBanner
          tone={banner.tone}
          team={teamOf(banner.teamId)}
          head={banner.head}
          line={banner.line}
          side={banner.side}
        />
      )}
      {player && man && (
        <div className="moment-player">
          <div
            className="mp-num"
            style={club ? { background: club.colors[0], boxShadow: `inset 0 -4px 0 ${club.colors[1]}` } : undefined}
          >
            {player.number ?? ''}
          </div>
          <div className="mp-txt">
            <PlayerLink league={league} player={man} short bold />
            <small>
              {man.position}
              {club ? ` · ${club.city}` : ''}
            </small>
            <span className="num">{player.line}</span>
          </div>
        </div>
      )}
    </div>
  );
}
