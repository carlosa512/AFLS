/**
 * The graphics a game stops for, drawn over the field in either view: a banner for a score, a giveaway, a flag or an
 * injury; a player's line after a big gain; and a card at the quarter, the half and the final. What to show is
 * `moments.ts`'s call and the screen's (a card only comes up when play reaches it by playing); this only draws it,
 * one thing at a time, whole (nothing is revealed bit by bit). Spec:
 * docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md §3.
 */
import { useEffect, useState } from 'react';
import type { FieldRecord, League, PlayLogEntry, Team } from '../../engine/types';
import { PlayerLink } from '../components';
import {
  linesAt,
  lineWords,
  SHOWN_TEAM,
  teamStatsAt,
  type PlayNames,
  type RunningLine,
  type RunningTeam,
} from '../gameRead';
import { cardWait, momentHold, type Moment, type Tone } from '../moments';
import { laneColor } from './GameTimeline';

/** What All-22 announces itself, timed to its own staging (the officials confer, the trainers come out). */
export const ALL22_OWN: readonly Tone[] = ['flag', 'injury', 'turnover'];
/** A replay holds on the halftime card this long at 1× before it carries on. */
export const HALF_MS = 5000;

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

/** The card a period's end brings up, as the screen decided: a quarter's line, the half or the final. */
export type Card = { kind: 'quarter'; head: string } | { kind: 'half' } | { kind: 'final' };
/** What a card reads its numbers from: the log through the last play shown. */
export interface CardFacts {
  plays: readonly PlayLogEntry[];
  shown: number;
  names: PlayNames;
  record?: FieldRecord;
  /** A finished game's own list of who played for whom. */
  playerTeams?: Record<number, number>;
}

/** The four numbers a card compares, under the box score's labels; one the reader can't give exactly is left out. */
const CARD_ROWS: { label: string; needs: (keyof RunningTeam)[]; text: (t: RunningTeam) => string | number }[] = [
  { label: 'Total yards', needs: ['totalYds'], text: (t) => t.totalYds },
  { label: 'First downs', needs: ['firstDowns'], text: (t) => t.firstDowns },
  { label: '3rd down', needs: ['thirdDownConv', 'thirdDownAtt'], text: (t) => `${t.thirdDownConv}/${t.thirdDownAtt}` },
  { label: 'Turnovers', needs: ['turnovers'], text: (t) => t.turnovers },
];
/** The game's leading passer, rusher and receiver so far, whichever side he plays for. */
const LEADERS: { kind: 'passing' | 'rushing' | 'receiving'; by: (l: RunningLine) => number }[] = [
  { kind: 'passing', by: (l) => (l.passAtt ? (l.passYds ?? 0) : -Infinity) },
  { kind: 'rushing', by: (l) => (l.rushAtt ? (l.rushYds ?? 0) : -Infinity) },
  { kind: 'receiving', by: (l) => (l.rec ? (l.recYds ?? 0) : -Infinity) },
];

function MomentCard({
  league,
  home,
  away,
  card,
  facts,
  verdict,
  onContinue,
  onSim,
  onBoxScore,
  onReplay,
}: {
  league: League;
  home: Team;
  away: Team;
  card: Card;
  facts: CardFacts;
  verdict?: 'W' | 'L' | 'T';
  onContinue?: () => void;
  onSim?: () => void;
  onBoxScore?: () => void;
  onReplay?: () => void;
}) {
  const { plays, shown } = facts;
  const board = shown >= 0 ? plays[shown] : { homeScore: 0, awayScore: 0 };
  const title = card.kind === 'quarter' ? card.head : card.kind === 'half' ? 'Halftime' : 'Final';
  const colors = { home: laneColor(home.colors), away: laneColor(away.colors) };
  const full = card.kind !== 'quarter';
  const stats = full ? teamStatsAt(plays, shown, home.id) : null;
  const lines = full ? [...linesAt(plays, shown, home.id, facts.names, facts.record)] : [];
  const leaders = LEADERS.map((c) => {
    const best = lines
      .filter(([id, l]) => league.players[id] && c.by(l) > -Infinity)
      .sort((a, b) => c.by(b[1]) - c.by(a[1]))[0];
    return best ? { id: best[0], text: lineWords(c.kind, best[1]) } : null;
  }).filter((x): x is { id: number; text: string } => !!x);
  const buttons = [
    onSim && { label: 'Sim to final', on: onSim, primary: false },
    onBoxScore && { label: 'Box score', on: onBoxScore, primary: false },
    onReplay && { label: 'Watch replay', on: onReplay, primary: false },
    onContinue && { label: 'Continue', on: onContinue, primary: true },
  ].filter((b): b is { label: string; on: () => void; primary: boolean } => !!b);
  return (
    <div className={`moment-card${full ? '' : ' small'}`} role="dialog" aria-label={title}>
      <div className="mc-in">
        <div className="mc-top">
          <span>{title}</span>
          <span className="mc-net" aria-label="SNN, the Sports News Network">
            SNN
          </span>
        </div>
        <div className="mc-score">
          <span className="mc-team" style={{ color: colors.away }}>
            {away.abbrev}
          </span>
          <span className="mc-pts">
            {verdict && <span className={`res-${verdict}`}>{verdict}</span>}
            <span>
              {board.awayScore} – {board.homeScore}
            </span>
          </span>
          <span className="mc-team mc-home" style={{ color: colors.home }}>
            {home.abbrev}
          </span>
        </div>
        {stats && (
          <div className="mc-body">
            {CARD_ROWS.filter((r) => r.needs.every((k) => SHOWN_TEAM.includes(k))).map((r) => (
              <div key={r.label} className="mc-row">
                <span className="num" style={{ color: colors.away }}>
                  {r.text(stats.away)}
                </span>
                <span className="mc-k">{r.label}</span>
                <span className="num mc-h" style={{ color: colors.home }}>
                  {r.text(stats.home)}
                </span>
              </div>
            ))}
            {leaders.length > 0 && (
              <div className="mc-lead">
                {leaders.map((l) => (
                  <div key={`${l.id}:${l.text}`}>
                    <PlayerLink league={league} player={league.players[l.id]} short bold />
                    <span className="num">{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {buttons.length > 0 && (
          <div className="mc-btns">
            {buttons.map((b) => (
              <button key={b.label} className={`btn btn-sm${b.primary ? ' btn-primary' : ''}`} onClick={b.on}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>
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
  card,
  facts,
  verdict,
  onContinue,
  onSim,
  onBoxScore,
  onReplay,
}: {
  league: League;
  home: Team;
  away: Team;
  /** The moments of the play on screen (`playMoments`): empty until its result has been shown. */
  moments: readonly Moment[];
  speed: number;
  /** Banners the view under this one announces itself (`ALL22_OWN`). */
  own?: readonly Tone[];
  /** The card to put up, when the screen has decided on one, and what it reads. */
  card?: Card | null;
  facts?: CardFacts;
  /** The final, for your club: won, lost or tied. */
  verdict?: 'W' | 'L' | 'T';
  /** The card's buttons: each shows only when given. A live game waits at the half for Continue. */
  onContinue?: () => void;
  onSim?: () => void;
  onBoxScore?: () => void;
  onReplay?: () => void;
}) {
  const shown = shownMoments(moments, speed, own);
  const teamOf = (id: number | null) => (id === home.id ? home : id === away.id ? away : null);
  const banner = shown.find((m): m is Extract<Moment, { kind: 'banner' }> => m.kind === 'banner');
  // Never a line with a banner: one thing to read at a time.
  const player = banner ? undefined : shown.find((m): m is Extract<Moment, { kind: 'player' }> => m.kind === 'player');
  const man = player ? league.players[player.playerId] : undefined;
  // A card waits for the play's banner to be read (this view's or All-22's own): the play that ends a game is told
  // before the final comes up over it.
  const due = card && facts ? card : null;
  const wait = due ? cardWait(moments, speed) : 0;
  const key = due && facts ? `${facts.shown}:${due.kind}` : '';
  const [waited, setWaited] = useState('');
  useEffect(() => {
    if (!key || !wait || waited === key) return;
    const t = setTimeout(() => setWaited(key), wait);
    return () => clearTimeout(t);
  }, [key, wait, waited]);
  const up = due && (!wait || waited === key) ? due : null;
  if (!banner && !(player && man) && !up) return null;
  // A score or a takeaway: the bench of the side it went to has something to cheer (and the crowd, at home).
  const cheer =
    banner && (banner.tone === 'score' || banner.tone === 'turnover') && banner.teamId !== null
      ? banner.teamId === home.id
        ? 'home'
        : 'away'
      : undefined;
  const club = player ? teamOf(player.teamId) : null;
  return (
    <>
      {(banner || (player && man)) && !up && (
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
      )}
      {up && facts && (
        <MomentCard
          league={league}
          home={home}
          away={away}
          card={up}
          facts={facts}
          verdict={verdict}
          onContinue={onContinue}
          onSim={onSim}
          onBoxScore={onBoxScore}
          onReplay={onReplay}
        />
      )}
    </>
  );
}
