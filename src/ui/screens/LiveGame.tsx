import { employed } from '../../engine/employment';
import { useEffect, useRef, useState } from 'react';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import type { League } from '../../engine/types';
import { useNav } from '../App';
import { TeamChip } from '../components';
import { gameClock, weekLabel } from '../format';
import { live, useLive } from '../live';
import { shows } from '../highlights';
import {
  Field,
  HighlightSwitch,
  inPlay,
  playLabel,
  PlayText,
  restingSpot,
  situation,
  allSpeed,
  useHighlightPick,
  usePlayNames,
  useViewPick,
  ViewSwitch,
} from './GameViewer';
import { holdAfter, TopDownField } from './TopDownField';

const SPEEDS = [1, 2, 4, 8];
/** Pause between plays at 1×, so each snap can be read. */
const HOLD_MS = 700;

export function LiveGame({ league }: { league: League }) {
  const nav = useNav();
  const s = useLive();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const game = s ? league.games.find((g) => g.id === s.gameId) : undefined;
  const names = usePlayNames(league, game);
  const [pick, setPick] = useHighlightPick();
  const [viewPick, setViewPick] = useViewPick();
  // The play whose finish has been shown: until then its result, its line in the log and its points stay hidden.
  const [toldKey, setToldKey] = useState('');
  if (!s || !game) {
    return (
      <section className="panel stack">
        <h2>No game in progress</h2>
        <p className="muted" style={{ margin: 0 }}>
          Press Play Week to watch your next game live.
        </p>
        <div>
          <button className="btn" onClick={() => nav.go({ view: 'home' })}>
            Back to Home
          </button>
        </div>
      </section>
    );
  }

  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const entry = s.plays[s.current];
  const playKey = `${s.gameId}:${s.current}`;
  const told = toldKey === playKey || s.finished || !inPlay(entry);
  /** The score on the board: the last play's until this one has been seen. */
  const board = told ? entry : (s.plays[s.current - 1] ?? { homeScore: 0, awayScore: 0 });
  const record = s.sim.field();
  const all22 = viewPick === 'all22' && !!record;
  const speeds = all22 ? [1, 2, 4] : SPEEDS;
  const speed = all22 ? allSpeed(s.speed) : s.speed;
  const label = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(game.week);

  const step = () => {
    if (!live.advance()) live.finish();
  };
  /** Past the plays the highlight level skips (they land in the log together, still), or on to the next snap. */
  const next = () => {
    if (pick !== 'full' && live.skipTo((plays, i) => shows(plays, i, home.id, pick))) return;
    step();
  };
  const onDone = () => {
    setToldKey(playKey);
    clearTimeout(timer.current);
    if (!s.playing || s.finished) return;
    // A skipped batch's hold was the pause: the highlight follows at once.
    if (s.still) return step();
    // All-22 holds a beat on the play's end, longer after a kick, a score or a turnover, to read what happened.
    timer.current = setTimeout(next, (all22 ? holdAfter(entry) : HOLD_MS) / speed);
  };
  const togglePlay = () => {
    clearTimeout(timer.current);
    const playing = !s.playing;
    live.update({ playing });
    if (playing) next();
  };
  const simToFinal = () => {
    clearTimeout(timer.current);
    live.finish();
  };

  const result = s.finished ? game.result : undefined;
  const userIsHome = !employed(league) || game.homeId === league.userTeamId;
  const us = result ? (userIsHome ? result.homeScore : result.awayScore) : 0;
  const them = result ? (userIsHome ? result.awayScore : result.homeScore) : 0;
  const verdict = us > them ? 'W' : us < them ? 'L' : 'T';
  // Every play so far, newest first, in a box that scrolls back to the kickoff.
  const recent = s.plays.slice(0, told ? s.current + 1 : s.current).reverse();

  const broadcast = (
    <Field
      home={home}
      away={away}
      entry={entry}
      restX={restingSpot(s.plays, s.current, home.id)}
      animKey={`live:${s.gameId}:${s.current}`}
      speed={speed}
      still={s.still}
      onDone={onDone}
    />
  );
  return (
    <>
      <section className="viewer">
        <div className="viewer-bug">
          {[away, home].map((t) => (
            <div key={t.id} className="vb-team" style={{ background: t.colors[0] }}>
              <span className="vb-name">
                {t.abbrev}
                {!s.finished && entry.offense === t.id && entry.down ? (
                  <span className="vb-poss" aria-label="has the ball" />
                ) : null}
              </span>
              <span className="vb-score">{t.id === home.id ? board.homeScore : board.awayScore}</span>
            </div>
          ))}
          <div className="vb-clock">
            <span>
              {s.finished ? (
                `Final${result?.overtime ? '/OT' : ''}`
              ) : (
                <>
                  <span className="live-dot" aria-hidden="true" />
                  {entry.quarter <= 4 ? `Q${entry.quarter}` : 'OT'} · {gameClock(entry.clock)}
                </>
              )}
            </span>
            <span>{label}</span>
          </div>
        </div>

        {all22 ? (
          <TopDownField
            league={league}
            record={record}
            game={game}
            home={home}
            away={away}
            plays={s.plays}
            index={s.current}
            animKey={`live:${s.gameId}:${s.current}`}
            speed={speed}
            still={s.still}
            onDone={onDone}
            fallback={broadcast}
          />
        ) : (
          broadcast
        )}

        <div className="viewer-sit">
          <span className="num">{situation(entry, home, away) || ' '}</span>
          <span className="viewer-tag">{told ? playLabel(entry, home.id) : ''}</span>
        </div>

        {!s.finished && (
          <div className="viewer-controls">
            <button className="vc-btn vc-play" onClick={togglePlay} aria-label={s.playing ? 'Pause' : 'Play'}>
              {s.playing ? '❚❚' : '▶'}
            </button>
            <button
              className="vc-speed"
              onClick={() => live.update({ speed: speeds[(speeds.indexOf(speed) + 1) % speeds.length] })}
              aria-label="Playback speed"
            >
              {speed}×
            </button>
            <HighlightSwitch value={pick} onChange={setPick} />
            {record && <ViewSwitch value={viewPick} onChange={setViewPick} />}
            <span className="live-label">Live</span>
            <button className="vc-skip" onClick={simToFinal}>
              Sim to final
            </button>
          </div>
        )}
      </section>

      {s.finished && result && (
        <section className="panel live-final">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row">
              <span
                className={`res-${verdict}`}
                style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)', lineHeight: 1 }}
              >
                {employed(league) ? verdict : 'Final'}
              </span>
              <span
                style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--step-3)', fontWeight: 800, lineHeight: 1 }}
              >
                {us}–{them}
              </span>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" onClick={() => nav.openGame(game.id)}>
                Box score
              </button>
              <button className="btn btn-sm" onClick={() => nav.watchGame(game.id)}>
                Watch replay
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => nav.go({ view: 'home' })}>
                Continue
              </button>
            </span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            The rest of the league's games are in. Head back to Home for this week's scores.
          </p>
        </section>
      )}

      <section className="panel">
        <div className="play-log" aria-label="Plays so far">
          {recent.map((p, i) => {
            const team = p.offense === home.id ? home : away;
            return (
              <div
                key={s.current - i - (told ? 0 : 1)}
                className={`play-card${i === 0 && told ? ' current' : ''}${p.scoring ? ' scoring' : ''}`}
              >
                <span className="pc-meta">
                  <TeamChip team={team} />
                  <span className="num muted">
                    {p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} {gameClock(p.clock)}
                  </span>
                </span>
                <span className="pc-body">
                  <span className="pc-sit">{situation(p, home, away)}</span>
                  <span>
                    <PlayText text={p.text} names={names} />
                  </span>
                </span>
                <span className="pc-tag">{playLabel(p, home.id)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
