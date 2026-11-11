/**
 * The game as a timeline, in place of the replay's slider: each team's drives on the game clock (away above the line,
 * home below), a mark where a drive scored or gave the ball away, and a playhead at the play on screen. A live game
 * draws only what has been shown; a replay draws the whole game, the drives to come dimmed, and can be clicked or
 * dragged to jump. The caption under it tells the drive on the field. The screen's own buttons ride on it.
 * Spec: docs/superpowers/specs/2026-11-10-broadcast-info-design.md §3.
 */
import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { PlayLogEntry, Team } from '../../engine/types';
import { contrast, tint } from '../color';
import { gameClock } from '../format';
import { drivesOf, gameLength, secondsOf, type Drive, type DriveEnd } from '../gameRead';

/** The viewer's night scene (`--scene-bg`): what a drive's bar has to read on. */
const SCENE = '#0b1210';
/** How much a colour must stand out from the scene to be a bar on it. */
const READS = 3;
/**
 * A club's colour for its drives. Its first colour when that reads on the night scene; lightened until it does when
 * it's only dark (a navy stays a blue); its second colour when the first is all but black, which would lighten to grey.
 */
export function laneColor(colors: readonly [string, string]): string {
  const [first, second] = colors;
  if (contrast(SCENE, first) >= READS) return first;
  if (contrast(SCENE, first) < 1.15 && contrast(SCENE, second) >= READS) return second;
  for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) if (contrast(SCENE, tint(first, t)) >= READS) return tint(first, t);
  return '#ffffff';
}

const ENDED: Record<DriveEnd, string> = {
  td: 'Touchdown',
  fg: 'Field goal',
  missed: 'Missed field goal',
  punt: 'Punt',
  int: 'Interception',
  fumble: 'Fumble',
  downs: 'Turnover on downs',
  safety: 'Safety',
  half: 'End of half',
  end: 'End of game',
  on: '',
};
/** Ends that gave the ball away with nothing to show for it. */
const GAVE_UP: ReadonlySet<DriveEnd> = new Set(['missed', 'int', 'fumble', 'downs']);

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const when = (e: PlayLogEntry) => `${e.quarter <= 4 ? `Q${e.quarter}` : 'OT'} ${gameClock(e.clock)}`;

/**
 * A drive in words, after its team's name. The drive on the field: its plays, yards and time so far. A finished
 * one: when it began and how it ended, a touchdown with the play that scored it.
 */
export function driveCaption(d: Drive, plays: readonly PlayLogEntry[], current: boolean): string {
  const size = `${count(d.snaps, 'play')} · ${d.yards} yds`;
  if (current) return `${size} · ${gameClock(Math.max(0, Math.round(d.end - d.start)))}`;
  const scored = d.how === 'td' ? `, ${plays[d.last].text.replace(/[,.]? ?TOUCHDOWN.*$/, '')}` : '';
  // The fourth quarter's end is the end of regulation: there is overtime to come, or the log would say the game ended.
  const how = d.how === 'half' && plays[d.last].quarter === 4 ? 'End of regulation' : ENDED[d.how];
  return `${when(plays[d.first])} · ${size} · ${how}${scored}`;
}

export function GameTimeline({
  home,
  away,
  plays,
  index,
  told,
  replay,
  onJump,
  transport,
  settings,
}: {
  home: Team;
  away: Team;
  plays: readonly PlayLogEntry[];
  /** The play on screen, and whether its result has been shown. */
  index: number;
  told: boolean;
  /** A replay draws the whole game and can be clicked; a live game draws only what has been shown. */
  replay: boolean;
  /** Replay only: jump to a play. */
  onJump?: (index: number) => void;
  /** Previous, Play, Next: the screen's own buttons. */
  transport: ReactNode;
  /** Speed and highlights. */
  settings: ReactNode;
}) {
  const shown = told ? index : index - 1;
  const area = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<number | null>(null);

  // A live game's log is one list that grows in place: anything remembered from it is keyed on its length too, or it
  // would go stale as plays arrive (the playhead once sat at the kickoff all game).
  const logged = plays.length;
  // What has been shown, read as a game still going: the drive on the field and its numbers so far.
  const soFar = useMemo(() => drivesOf(plays.slice(0, shown + 1), home.id, true), [plays, logged, shown, home.id]);
  // A replay knows the rest; a live game has nothing more to draw.
  const whole = useMemo(() => (replay ? drivesOf(plays, home.id) : []), [plays, logged, replay, home.id]);
  const drives = replay ? whole : soFar;
  const seconds = useMemo(() => secondsOf(plays), [plays, logged]);
  const total = gameLength(replay ? plays : plays.slice(0, index + 1));
  const pct = (s: number) => `${((Math.min(s, total) / total) * 100).toFixed(2)}%`;
  const now = seconds[index] ?? 0;
  const teamOf = (id: number) => (id === home.id ? home : away);
  const colors = { home: laneColor(home.colors), away: laneColor(away.colors) };

  const current = soFar[soFar.length - 1];
  const onField = current && current.how === 'on' ? current : undefined;
  const told_ = picked !== null ? drives[picked] : undefined;
  const caption = told_
    ? { team: teamOf(told_.teamId), text: driveCaption(told_, plays, false) }
    : onField
      ? { team: teamOf(onField.teamId), text: driveCaption(onField, plays, true) }
      : current
        ? { team: teamOf(current.teamId), text: driveCaption(current, plays, false) }
        : null;

  /** The last play at or before a spot on the track. */
  const playAt = (clientX: number): number => {
    const box = area.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * total;
    let i = 0;
    while (i + 1 < seconds.length && seconds[i + 1] <= t) i++;
    return i;
  };
  /**
   * A press on the track (replay only). A drag scrubs, wherever it began and ended; a press let go where it landed
   * is a click: on a drive it jumps to the drive's first snap, on bare track to that moment. Left button only.
   */
  const press = useRef<{ x: number; drive: number | null; moved: boolean } | null>(null);
  const pressed = (e: PointerEvent<HTMLDivElement>) => {
    if (!replay || !onJump || e.button !== 0) return;
    const bar = (e.target as HTMLElement).closest<HTMLElement>('.tl-drive');
    press.current = { x: e.clientX, drive: bar ? Number(bar.dataset.first) : null, moved: false };
    // The drag keeps coming here even when the pointer leaves the track.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const dragged = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || (!p.moved && Math.abs(e.clientX - p.x) < 4)) return;
    p.moved = true;
    onJump?.(playAt(e.clientX));
  };
  const released = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    if (p && !p.moved) onJump?.(p.drive ?? playAt(e.clientX));
  };

  // Regulation's four quarters, and one more section for whatever overtime was played.
  const sections = [0, 900, 1800, 2700].map((s, q) => ({ label: `Q${q + 1}`, from: s, to: s + 900 }));
  if (total > 3600) sections.push({ label: 'OT', from: 3600, to: total });

  return (
    <div className="tl">
      <div className="tl-main">
        {transport && <span className="tl-transport">{transport}</span>}
        <div className="tl-grid">
          <span className="tl-lab" style={{ color: colors.away }}>
            {away.abbrev}
          </span>
          <div
            className={`tl-area${replay ? ' can-jump' : ''}`}
            ref={area}
            onPointerDown={pressed}
            onPointerMove={dragged}
            onPointerUp={released}
            onPointerCancel={() => (press.current = null)}
            onMouseLeave={() => setPicked(null)}
          >
            {sections.map((s) => (
              <div key={s.label} className="tl-q" style={{ left: pct(s.from), width: pct(s.to - s.from) }} />
            ))}
            <div className="tl-axis" />
            {!replay && <div className="tl-future" style={{ left: pct(now) }} />}
            {drives.map((d, i) => {
              const side = d.teamId === home.id ? 'home' : 'away';
              const later = replay && d.first > shown;
              // Live, the drive on the field stops at the playhead.
              const end = !replay && d.how === 'on' ? now : d.end;
              const label = `${teamOf(d.teamId).city} drive, ${driveCaption(d, plays, d.how === 'on')}`;
              return (
                <button
                  key={d.first}
                  className={`tl-drive ${side}${later ? ' later' : ''}${picked === i ? ' picked' : ''}`}
                  style={{
                    left: pct(d.start),
                    width: `max(4px, calc(${pct(Math.max(0, Math.min(end, total) - d.start))} - 2px))`,
                    background: colors[side],
                  }}
                  aria-label={label}
                  title={label}
                  disabled={!replay}
                  data-first={d.first}
                  onMouseEnter={() => setPicked(i)}
                  onFocus={() => setPicked(i)}
                  onBlur={() => setPicked(null)}
                  // The pointer is handled on the track (a drag across a bar must not end as a click on it): this is
                  // the keyboard's Enter or Space, which arrives as a click with no detail.
                  onClick={(e) => {
                    if (e.detail === 0) onJump?.(d.first);
                  }}
                />
              );
            })}
            {drives.map((d) => {
              const later = replay && d.last > shown;
              // Live, a mark waits until the play that earned it has been shown.
              if (!replay && d.how === 'on') return null;
              const cls = (side: 'home' | 'away', kind: 'score' | 'miss') => (
                <span
                  key={`${d.first}-${side}`}
                  className={`tl-mark ${kind} ${side}${later ? ' later' : ''}`}
                  style={{ left: pct(d.end) }}
                />
              );
              // Both sides can score before the next drive: a touchdown, then the kickoff run back.
              const scores = [
                d.points.home > 0 ? cls('home', 'score') : null,
                d.points.away > 0 ? cls('away', 'score') : null,
              ].filter(Boolean);
              if (scores.length) return scores;
              return GAVE_UP.has(d.how) ? cls(d.teamId === home.id ? 'home' : 'away', 'miss') : null;
            })}
            <div className="tl-head" style={{ left: pct(now) }} />
          </div>
          <span className="tl-lab" style={{ color: colors.home }}>
            {home.abbrev}
          </span>
          <div className="tl-qs" aria-hidden="true">
            {sections.map((s) => (
              <span key={s.label} style={{ width: pct(s.to - s.from) }}>
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="tl-foot">
        <p className="tl-cap">
          {caption ? (
            <>
              <b>{caption.team.city} drive</b> · {caption.text}
            </>
          ) : (
            ' '
          )}
        </p>
        {settings && <span className="tl-set">{settings}</span>}
      </div>
      <span className="tl-key" aria-hidden="true">
        <span>
          <i className="score" />
          Score
        </span>
        <span>
          <i className="miss" />
          Missed kick or turnover
        </span>
      </span>
      {replay && (
        <input
          className="visually-hidden"
          type="range"
          id="viewer-scrub"
          min={0}
          max={plays.length - 1}
          value={index}
          onChange={(e) => onJump?.(Number(e.target.value))}
          aria-label="Jump to play"
          aria-valuetext={plays[index] ? when(plays[index]) : undefined}
        />
      )}
    </div>
  );
}
