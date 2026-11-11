import { employed } from '../../engine/employment';
import { useEffect, useRef, useState } from 'react';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import type { League } from '../../engine/types';
import { useNav } from '../App';
import { TeamChip } from '../components';
import { gameClock, weekLabel } from '../format';
import { live, useLive } from '../live';
import { stopsAt } from '../highlights';
import {
  DownBar,
  HighlightSwitch,
  inPlay,
  playLabel,
  PlayText,
  situation,
  allSpeed,
  useHighlightPick,
  useStageTab,
  usePlayNames,
  useViewPick,
  ViewSwitch,
} from './GameViewer';
import { Field, IdleField, restingSpot } from './BroadcastField';
import { PregameCard } from './PregameCard';
import { gameWeather, weatherAt } from '../../engine/weather';
import { gameStadium } from '../stadiums/gameLook';
import { driveAt } from '../gameRead';
import { momentHold, periodHold, playMoments } from '../moments';
import { ALL22_OWN, GameMoments, shownMoments } from './GameMoments';
import { holdAfter, TopDownField } from './TopDownField';
import { Scorebug } from './Scorebug';
import { GameTimeline } from './GameTimeline';
import { GamePanel, PlayersPanel, StageTabs } from './GamePanels';

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
  const [tab, setTab] = useStageTab();
  // The play whose finish has been shown: until then its result, its line in the log and its points stay hidden.
  const [toldKey, setToldKey] = useState('');
  // The play whose snap All-22 has shown: until then the last play's result stays up.
  const [snapKey, setSnapKey] = useState('');
  // The play the game is waiting on at the half, until Continue.
  const [waitKey, setWaitKey] = useState('');
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
  // Before the kickoff the game waits on its pregame card: no play is on the field yet.
  const pre = !s.kicked && !s.finished;
  const told = !pre && (toldKey === playKey || s.finished || !inPlay(entry));
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
    if (pick !== 'full' && live.skipTo((plays, i) => stopsAt(plays, i, home.id, pick))) return;
    step();
  };
  const onDone = () => {
    // The next play, unseen: without it the screen can't tell that this one ended a quarter or the half.
    live.peek();
    setToldKey(playKey);
    clearTimeout(timer.current);
    if (!s.playing || s.finished) return;
    // All-22 holds a beat on the play's end, longer after a kick, a score or a turnover, to read what happened.
    // A moment (a score's banner, a player's line) holds the screen long enough to be read.
    const all = playMoments(s.plays, s.current, { ...momentFacts, told: true, still: false });
    const made = shownMoments(all, speed, own);
    // The half, reached by playing (its last play watched, or landed on with a skipped batch): the game waits on
    // its card until Continue.
    if (made.some((m) => m.kind === 'half')) {
      live.update({ playing: false });
      return setWaitKey(playKey);
    }
    // A skipped batch's hold was the pause: the highlight follows at once.
    if (s.still) return step();
    // A quarter's card comes up after the play's banner, whichever view draws it.
    const hold = Math.max(
      (all22 ? holdAfter(entry) : HOLD_MS) / speed,
      momentHold(made, speed),
      periodHold(all, speed),
    );
    timer.current = setTimeout(next, hold);
  };
  const togglePlay = () => {
    clearTimeout(timer.current);
    setWaitKey('');
    // Before the kickoff, Play is the kickoff: the first play is shown and the game runs on from it.
    if (pre) return live.kickoff();
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
  // What the play on screen gives the viewer to show: nothing until its result has been seen.
  const momentFacts = { home, away, names, record, over: s.finished };
  const moments = playMoments(s.plays, s.current, { ...momentFacts, told, still: s.still });
  const own = all22 ? ALL22_OWN : undefined;
  // The card a period's end brings up: the final once the game is recorded, the half while the game waits on it, a
  // quarter's while the game plays through it.
  const period = shownMoments(moments, speed).find(
    (m) => m.kind === 'quarter' || m.kind === 'half' || m.kind === 'final',
  );
  const card =
    period && (period.kind === 'final' ? s.finished : period.kind === 'half' ? waitKey === playKey : s.playing)
      ? period
      : null;
  const resume = () => {
    setWaitKey('');
    live.update({ playing: true });
    next();
  };

  const broadcast = (
    <Field
      home={home}
      away={away}
      neutral={game.neutral}
      weather={weatherAt(gameWeather(league, game), entry.quarter)}
      stadium={gameStadium(league, game, weatherAt(gameWeather(league, game), entry.quarter))}
      drive={driveAt(s.plays, s.current, home.id)}
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
      {record && (
        <div className="row viewer-top">
          <ViewSwitch value={viewPick} onChange={setViewPick} />
        </div>
      )}
      <div className="game-stage" data-tab={tab}>
        <div className="stage-mid">
          <section className="viewer">
            <Scorebug
              league={league}
              game={game}
              home={home}
              away={away}
              plays={s.plays}
              index={s.current}
              told={told}
              live
              final={s.finished}
              label={label}
            />

            <div className="viewer-scene">
              {pre ? (
                <IdleField
                  home={home}
                  away={away}
                  neutral={game.neutral}
                  weather={weatherAt(gameWeather(league, game), 1)}
                  stadium={gameStadium(league, game, weatherAt(gameWeather(league, game), 1))}
                />
              ) : all22 ? (
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
                  final={s.sim.over && s.current === s.plays.length - 1}
                  onDone={onDone}
                  onSnap={() => setSnapKey(playKey)}
                  fallback={broadcast}
                />
              ) : (
                broadcast
              )}
              {pre && (
                <PregameCard
                  league={league}
                  game={game}
                  home={home}
                  away={away}
                  out={s.out}
                  label={label}
                  onKickoff={live.kickoff}
                  onSim={simToFinal}
                />
              )}
              <GameMoments
                league={league}
                home={home}
                away={away}
                moments={pre ? [] : moments}
                speed={speed}
                own={own}
                card={pre ? null : card}
                facts={{
                  plays: s.plays,
                  shown: told ? s.current : s.current - 1,
                  names,
                  record,
                  playerTeams: result?.playerTeams,
                }}
                verdict={card?.kind === 'final' && employed(league) ? verdict : undefined}
                onContinue={
                  card?.kind === 'final' ? () => nav.go({ view: 'home' }) : card?.kind === 'half' ? resume : undefined
                }
                onSim={card?.kind === 'half' ? simToFinal : undefined}
                onBoxScore={card?.kind === 'final' ? () => nav.openGame(game.id) : undefined}
                onReplay={card?.kind === 'final' ? () => nav.watchGame(game.id) : undefined}
              />
            </div>

            <div className="viewer-sit">
              <DownBar entry={entry} home={home} away={away} />
              <span className="viewer-tag">
                {told
                  ? playLabel(entry, home.id)
                  : all22 && snapKey !== playKey && s.current > 0
                    ? playLabel(s.plays[s.current - 1], home.id)
                    : ''}
              </span>
            </div>

            <GameTimeline
              home={home}
              away={away}
              plays={s.plays}
              index={s.current}
              told={told}
              replay={false}
              transport={
                s.finished ? null : (
                  <button className="vc-btn vc-play" onClick={togglePlay} aria-label={s.playing ? 'Pause' : 'Play'}>
                    {s.playing ? '❚❚' : '▶'}
                  </button>
                )
              }
              settings={
                s.finished ? null : (
                  <>
                    <button
                      className="vc-speed"
                      onClick={() => live.update({ speed: speeds[(speeds.indexOf(speed) + 1) % speeds.length] })}
                      aria-label="Playback speed"
                    >
                      {speed}×
                    </button>
                    <HighlightSwitch value={pick} onChange={setPick} />
                    <button className="vc-skip" onClick={simToFinal}>
                      Sim to final
                    </button>
                  </>
                )
              }
            />
          </section>
        </div>
        <StageTabs value={tab} onChange={setTab} />
        <GamePanel
          league={league}
          game={game}
          home={home}
          away={away}
          plays={s.plays}
          shown={told ? s.current : s.current - 1}
          names={names}
          result={result}
          out={s.out}
        />
        <PlayersPanel
          league={league}
          home={home}
          away={away}
          plays={s.plays}
          shown={told ? s.current : s.current - 1}
          names={names}
          record={record}
          playerTeams={result?.playerTeams}
        />

        <section className="panel game-log">
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
      </div>
    </>
  );
}
