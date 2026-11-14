/**
 * The fast-forward card: over a dimmed, greyed field, the game clock counting down through the plays the highlight
 * level skipped and a line on what changed. A screen puts it up while a still landing is being glided to (a beat).
 * Spec: docs/superpowers/specs/2026-11-14-fast-forward-between-highlights-design.md.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PlayLogEntry, Team } from '../../engine/types';
import { beatClock, beatProgress, beatSpan, skipSummary } from '../fastForward';
import { gameClock } from '../format';
import { Icon } from '../icons';

const reduced = () =>
  typeof window === 'undefined' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The game clock through a beat, "Q2 · 6:41": counted on its own frames from when it is put up. */
export function BeatClock({
  plays,
  span,
  ms,
}: {
  plays: readonly PlayLogEntry[];
  span: { start: number; end: number };
  ms: number;
}) {
  // No window (a static render) shows the clock as the beat starts; asked for less motion, as it ends.
  const [k, setK] = useState(() => (typeof window !== 'undefined' && reduced() ? 1 : 0));
  const length = useRef(ms);
  length.current = ms;
  useEffect(() => {
    if (reduced()) return setK(1);
    let raf = 0;
    let shown = 0;
    let second = -1;
    const t0 = performance.now();
    const tick = (now: number) => {
      shown = beatProgress(now - t0, length.current, shown);
      const s = Math.round(span.start + (span.end - span.start) * shown);
      // Only a new second re-renders.
      if (s !== second) {
        second = s;
        setK(shown);
      }
      if (shown < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The beat's span is fixed for the play it was put up for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { quarter, clock } = beatClock(plays, span, k);
  return (
    <>
      {quarter <= 4 ? `Q${quarter}` : 'OT'} · {gameClock(clock)}
    </>
  );
}

export function FastForward({
  plays,
  from,
  to,
  home,
  away,
  ms,
}: {
  plays: readonly PlayLogEntry[];
  /** The play on screen before the skipped ones. */
  from: number;
  /** The play landed on. */
  to: number;
  home: Team;
  away: Team;
  /** The beat's length (`beatMs`). */
  ms: number;
}) {
  const lines = skipSummary(plays, from, to, home, away);
  return (
    <div className="ff" style={{ '--beat': `${ms}ms` } as CSSProperties}>
      <div className="ff-in">
        <div className="ff-top" aria-hidden="true">
          <Icon name="forward" />
          <span className="num">
            <BeatClock plays={plays} span={beatSpan(plays, from, to)} ms={ms} />
          </span>
        </div>
        {lines.length > 0 && (
          <div className="ff-lines" aria-live="polite">
            {lines.map((l) => (
              <div key={l} className="ff-line">
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
