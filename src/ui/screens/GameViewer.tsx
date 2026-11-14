import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game, League, PlayLogEntry, Team } from '../../engine/types';
import { useNav } from '../App';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { TeamChip } from '../components';
import { gameClock, weekLabel } from '../format';
import { HIGHLIGHT_LEVELS, nextShown, playOn, type HighlightLevel } from '../highlights';
import { HIGHLIGHTS_KEY, STAGE_TABS, TAB_KEY, usePref, VIEW_KEY } from '../viewerPrefs';
import { asRan } from '../../engine/field/stage';
import { fumbleIn } from '../../engine/field/fumble';
import { holdAfter, TopDownField } from './TopDownField';
import { Field, IdleField, restingSpot } from './BroadcastField';
import { PregameCard, PREGAME_MS } from './PregameCard';
import { BeatClock, FastForward } from './FastForward';
import { beatMs, beatSpan } from '../fastForward';
import { gameWeather, weatherAt } from '../../engine/weather';
import { gameStadium } from '../stadiums/gameLook';
import { driveAt } from '../gameRead';
import { momentHold, periodHold, playMoments } from '../moments';
import { ALL22_OWN, GameMoments, HALF_MS, shownMoments } from './GameMoments';
import { buildPlayNames, type PlayNames } from '../gameRead';
import { downParts, Scorebug } from './Scorebug';
import { GameTimeline } from './GameTimeline';
import { GamePanel, PlayersPanel, StageTabs } from './GamePanels';
import { Icon } from '../icons';

// ───────── viewer screen ─────────
/** Plays whose result waits until it's been seen (from scrimmage, and at the posts); a kickoff, a punt, a flag or a
 * timeout is told at once. */
const IN_PLAY: ReadonlySet<string> = new Set([
  'run',
  'pass',
  'incomplete',
  'int',
  'sack',
  'scramble',
  // A kick at the posts, and a two-point try: good or not waits until you've seen it.
  'fg',
  'xp',
  'two',
]);
export const inPlay = (e: PlayLogEntry | undefined): boolean => {
  // A snap a flag wiped out ran like any other: its result waits too.
  const kind = e ? asRan(e).kind : undefined;
  return !!kind && IN_PLAY.has(kind);
};

/** Snaps that end a fourth down short of the line to gain hand the ball over. */
const ON_DOWNS: ReadonlySet<string> = new Set(['run', 'pass', 'scramble', 'sack', 'incomplete']);

export function playLabel(e: PlayLogEntry, homeId: number): string {
  // A two-point try is a real snap since 0.4.11: its run or catch may read TOUCHDOWN, but it's the try.
  if (/^Two-point try: /.test(e.text)) return `Two-point try · ${/ — NO GOOD\.$/.test(e.text) ? 'No good' : 'Good'}`;
  if (/TOUCHDOWN/.test(e.text)) return 'Touchdown';
  const dir = e.offense === homeId ? 1 : -1;
  // A lost fumble gained to where the ball came out: its logged end is where the other side's return finished.
  const f = fumbleIn(e);
  const end = f?.lost ? f.x : e.to;
  const gain = e.from !== undefined && end !== undefined ? Math.round((end - e.from) * dir) : 0;
  const yds = `${gain > 0 ? '+' : ''}${gain} yds`;
  // What the ball did after the play: the other side has it, or the offense hung on to it.
  const then = f
    ? f.lost
      ? ' · Fumble lost'
      : ' · Fumble kept'
    : e.down === 4 && ON_DOWNS.has(e.kind ?? '') && gain < e.distance
      ? ' · Turnover on downs'
      : '';
  switch (e.kind) {
    case 'pass':
      return `Pass · ${yds}${then}`;
    case 'run':
      return `Run · ${yds}${then}`;
    case 'scramble':
      return `Scramble · ${yds}${then}`;
    case 'sack':
      return f?.lost ? 'Strip sack · Fumble lost' : `Sack · ${yds}${then}`;
    case 'incomplete':
      return `Incomplete${then}`;
    case 'int':
      return 'Interception';
    case 'kickoff':
      return 'Kickoff';
    case 'punt':
      return 'Punt';
    case 'fg':
      return /NO GOOD/.test(e.text) ? 'FG missed' : 'Field goal';
    case 'xp':
      return /NO GOOD/.test(e.text) ? 'PAT missed' : 'Extra point';
    case 'two':
      return 'Two-point try';
    case 'penalty':
      return 'Penalty';
    case 'kneel':
      return /runs out the clock/.test(e.text) ? 'Clock killed' : 'Kneel';
    case 'spike':
      return 'Spike';
    default:
      return /Timeout/.test(e.text) ? 'Timeout' : '';
  }
}

export function situation(e: PlayLogEntry, home: Team, away: Team): string {
  const p = downParts(e, home, away);
  return p ? `${p.ord} & ${p.togo} · ${p.spot}` : '';
}

/** The left end of the bar under the field: the down as a pill, then the spot. Empty between snaps. */
export function DownBar({ entry, home, away }: { entry: PlayLogEntry; home: Team; away: Team }) {
  const p = downParts(entry, home, away);
  if (!p) return <span className="num">{' '}</span>;
  return (
    <span className="vb-sit">
      <span className="vb-down">{p.down}</span>
      <span className="num">{p.spot}</span>
    </span>
  );
}

const SPEEDS = [1, 2, 4];

const LEVEL_LABELS: Record<HighlightLevel, string> = { key: 'Key', extended: 'Ext', full: 'Full' };
const LEVEL_NAMES: Record<HighlightLevel, string> = {
  key: 'Key plays only',
  extended: 'Extended highlights',
  full: 'Full game',
};

/** How much of the game to animate: Key · Ext · Full. Skipped plays still land in the log and on the scoreboard. */
export function HighlightSwitch({ value, onChange }: { value: HighlightLevel; onChange: (v: HighlightLevel) => void }) {
  return (
    <span className="vc-levels" role="group" aria-label="Highlights">
      {HIGHLIGHT_LEVELS.map((l) => (
        <button
          key={l}
          className={`vc-level${l === value ? ' on' : ''}`}
          aria-pressed={l === value}
          title={LEVEL_NAMES[l]}
          onClick={() => onChange(l)}
        >
          {LEVEL_LABELS[l]}
        </button>
      ))}
    </span>
  );
}

export type ViewKind = 'broadcast' | 'all22';
const VIEWS: readonly ViewKind[] = ['broadcast', 'all22'];
/** All-22's speeds: faster than 2× it can't be read. */
const ALL22_SPEEDS = [1, 2, 4];
/** All-22 plays at 1×, 2× or 4×: a faster pick from the broadcast view (8×) drops to 4×. */
export const allSpeed = (speed: number): 1 | 2 | 4 => (speed >= 4 ? 4 : speed > 1 ? 2 : 1);

/** Broadcast | All-22, above the viewer: shown only for games that kept who was on the field. */
export function ViewSwitch({ value, onChange }: { value: ViewKind; onChange: (v: ViewKind) => void }) {
  return (
    <span className="seg" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>
          {v === 'all22' ? 'All-22' : 'Broadcast'}
        </button>
      ))}
    </span>
  );
}

/** Broadcast or All-22, picked on this device. */
export const useViewPick = () => usePref<ViewKind>(VIEW_KEY, VIEWS, 'broadcast');

/** Plays, Game or Players under the field on a narrow window, picked on this device. */
export const useStageTab = () => usePref(TAB_KEY, STAGE_TABS, 'plays');

/** The highlight level picked on this device. */
export const useHighlightPick = () => usePref<HighlightLevel>(HIGHLIGHTS_KEY, HIGHLIGHT_LEVELS, 'full');

export type { PlayNames } from '../gameRead';

/** The players a game's plays can name (`buildPlayNames`), worked out once a game and again at the final whistle. */
export function usePlayNames(league: League, game: Game | undefined): PlayNames {
  const done = !!game?.result;
  // The rosters only matter until the final whistle; after that the game keeps its own list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildPlayNames(league, game), [game?.id, done]);
}

/** A play's text with every player in it a link to his card. A tap on a name doesn't also jump the replay. */
export function PlayText({ text, names }: { text: string; names: PlayNames }) {
  const nav = useNav();
  if (!names.re) return <>{text}</>;
  return (
    <>
      {text.split(names.re).map((part, i) =>
        i % 2 ? (
          <button
            key={i}
            className="linklike"
            onClick={(e) => {
              e.stopPropagation();
              nav.openPlayer(names.ids.get(part)!);
            }}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function GameViewer({
  league,
  gameId,
  onBack,
  onBoxScore,
  pregame = true,
}: {
  league: League;
  gameId: number;
  onBack: () => void;
  onBoxScore: () => void;
  /** Open on the pregame card (false: straight to the first play). */
  pregame?: boolean;
}) {
  const game = league.games.find((g) => g.id === gameId);
  const plays = game?.result?.plays ?? [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0); // bumps to replay the current play
  const [still, setStill] = useState(false);
  // The play on screen when playing on skipped past plays: where the fast-forward to the still landing counts from.
  const [beatFrom, setBeatFrom] = useState(0);
  // Whether the current play has finished on screen: until it has, its result, its line in the log and the score it
  // put up stay hidden, so the words never get ahead of the picture.
  const [seen, setSeen] = useState(false);
  // The replay ran to its last play (it wasn't stepped or scrubbed there): the final card comes up.
  const [ended, setEnded] = useState(false);
  // Whether the play shown has been snapped (All-22): until then the last play's result stays up.
  const [snapped, setSnapped] = useState(true);
  const [pick, setPick] = useHighlightPick();
  const [viewPick, setViewPick] = useViewPick();
  const [tab, setTab] = useStageTab();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const names = usePlayNames(league, game);
  // A replay opens on the pregame card: it holds a few seconds, or until anything is pressed, and then the first
  // play is shown as before.
  const [pre, setPre] = useState(pregame);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!pregame) return;
    const t = setTimeout(() => setPre(false), PREGAME_MS);
    return () => clearTimeout(t);
    // Only as the replay opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pruned games keep only scoring plays; a replay needs the full log.
  if (!game?.result || !plays.some((p) => !p.scoring)) {
    return (
      <section className="panel">
        <h2>Replay not available</h2>
        <p className="muted">Full play-by-play is kept for your team's games and the most recent week.</p>
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </section>
    );
  }

  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const entry = plays[index];
  const all22 = viewPick === 'all22' && !!game.result.field;
  const speeds = all22 ? ALL22_SPEEDS : SPEEDS;
  const shownSpeed = all22 ? allSpeed(speed) : speed;
  const atEnd = index >= plays.length - 1;
  const momentFacts = { home, away, names, record: game.result.field, over: true };
  const own = all22 ? ALL22_OWN : undefined;
  const label = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(game.week);

  const go = (i: number, keepPlaying = false, skipped = false) => {
    clearTimeout(timer.current);
    setPre(false);
    setIndex(Math.max(0, Math.min(plays.length - 1, i)));
    setStill(skipped);
    setSeen(false);
    setSnapped(false);
    setEnded(false);
    setRun((r) => r + 1);
    if (!keepPlaying) setPlaying(false);
  };
  /** The next play to show from `from` at the level picked: past the plays it skips, they land together, still. */
  const advanceFrom = (from: number) => {
    // Still playing when the last play is reached past skipped ones: its end is what brings the final up.
    const to = playOn(plays, from, home.id, pick);
    if (to.still) setBeatFrom(from);
    go(to.index, true, to.still);
  };
  const onDone = () => {
    setSeen(true);
    if (!playing) return;
    if (atEnd) {
      setEnded(true);
      return setPlaying(false);
    }
    // A skipped batch has been shown: its hold was the pause, so the highlight follows at once, unless the batch
    // ended the half, whose card gets its time.
    const reached = playMoments(plays, index, { ...momentFacts, told: true, still });
    if (still && !reached.length) return go(index + 1, true);
    // All-22 holds a beat on the play's end, longer after a kick, a score or a turnover, to read what happened.
    // A moment (a score's banner, a player's line) holds the screen long enough to be read.
    const all = still ? reached : playMoments(plays, index, { ...momentFacts, told: true, still: false });
    const made = shownMoments(all, shownSpeed, own);
    // A period's card comes up after the play's banner; the half's stays up a while before the replay carries on.
    const hold = Math.max(
      (all22 ? holdAfter(entry) : 650) / shownSpeed,
      momentHold(made, shownSpeed),
      periodHold(all, shownSpeed, HALF_MS),
    );
    timer.current = setTimeout(() => advanceFrom(index), hold);
  };
  const step = (dir: 1 | -1) => {
    const n = nextShown(plays, index, home.id, pick, dir);
    go(n === -1 ? (dir === 1 ? plays.length - 1 : 0) : n);
  };
  const togglePlay = () => {
    // Play on the pregame card: the first play hasn't been shown yet, so it starts there.
    if (pre) {
      setPre(false);
      return setPlaying(true);
    }
    if (playing) {
      clearTimeout(timer.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      if (atEnd) go(0, true);
      else advanceFrom(index);
    }
  };
  // Every play up to this one, newest first: nothing past the current play (nor the current one, until it's been
  // seen), so the log never spoils it.
  const told = !pre && (seen || !inPlay(entry));
  // The result on the bar: this play's once it's been seen; before that (All-22's jog and huddle) the last play's
  // stays up until the snap.
  const tag = told
    ? playLabel(entry, home.id)
    : all22 && !snapped && index > 0
      ? playLabel(plays[index - 1], home.id)
      : '';
  const recent = plays.slice(0, told ? index + 1 : index).reverse();
  // The fast-forward: a still landing reached by playing on, until its field has got there. Not read from `told`: a
  // landed note is told at once. Pausing or stepping ends it, and the field lands at once.
  const beating = still && playing && !seen && !pre;
  const beat = beating ? beatMs(shownSpeed) : 0;
  // What the play on screen gives the viewer to show: nothing until its result has been seen.
  const moments = playMoments(plays, index, { ...momentFacts, told, still });
  // A period's card comes up only when the replay plays into it: stepped or scrubbed to, the play shows without one.
  const period = shownMoments(moments, shownSpeed).find(
    (m) => m.kind === 'quarter' || m.kind === 'half' || m.kind === 'final',
  );
  const card = period && (period.kind === 'final' ? ended : playing) ? period : null;
  const final = atEnd && !playing;

  const broadcast = (
    <Field
      home={home}
      away={away}
      neutral={game.neutral}
      weather={weatherAt(game.result.weather ?? gameWeather(league, game), entry.quarter)}
      stadium={gameStadium(league, game, weatherAt(game.result.weather ?? gameWeather(league, game), entry.quarter))}
      drive={driveAt(plays, index, home.id)}
      entry={entry}
      restX={restingSpot(plays, index, home.id)}
      animKey={`${index}:${run}`}
      speed={shownSpeed}
      still={still}
      beat={beat}
      onDone={onDone}
    />
  );
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack}>
          <Icon name="back" /> Back
        </button>
        <span className="row" style={{ gap: 10 }}>
          {game.result.field && <ViewSwitch value={viewPick} onChange={setViewPick} />}
          <button className="btn btn-sm" onClick={onBoxScore}>
            Box score
          </button>
        </span>
      </div>

      <div className="game-stage" data-tab={tab}>
        <section className="viewer">
          <Scorebug
            league={league}
            game={game}
            home={home}
            away={away}
            plays={plays}
            index={index}
            told={told || beating}
            final={final}
            label={label}
            clock={
              beating ? (
                <BeatClock key={index} plays={plays} span={beatSpan(plays, beatFrom, index)} ms={beat} />
              ) : undefined
            }
          />

          <div className="viewer-scene">
            {pre ? (
              <IdleField
                home={home}
                away={away}
                neutral={game.neutral}
                weather={weatherAt(game.result.weather ?? gameWeather(league, game), 1)}
                stadium={gameStadium(league, game, weatherAt(game.result.weather ?? gameWeather(league, game), 1))}
              />
            ) : all22 ? (
              <TopDownField
                league={league}
                record={game.result.field}
                game={game}
                home={home}
                away={away}
                plays={plays}
                index={index}
                animKey={`${index}:${run}`}
                speed={shownSpeed}
                still={still}
                beat={beat}
                final={index === plays.length - 1}
                onDone={onDone}
                onSnap={() => setSnapped(true)}
                fallback={broadcast}
              />
            ) : (
              broadcast
            )}
            {beating && (
              <FastForward key={index} plays={plays} from={beatFrom} to={index} home={home} away={away} ms={beat} />
            )}
            {pre && <PregameCard league={league} game={game} home={home} away={away} label={label} />}
            <GameMoments
              league={league}
              home={home}
              away={away}
              moments={pre ? [] : moments}
              speed={shownSpeed}
              own={own}
              card={pre ? null : card}
              facts={{
                plays,
                shown: told ? index : index - 1,
                names,
                record: game.result.field,
                playerTeams: game.result.playerTeams,
              }}
              onBoxScore={card?.kind === 'final' ? onBoxScore : undefined}
            />
          </div>

          <div className="viewer-sit">
            <DownBar entry={entry} home={home} away={away} />
            <span className="viewer-tag">{tag}</span>
          </div>

          <GameTimeline
            home={home}
            away={away}
            plays={plays}
            index={index}
            told={told}
            replay
            onJump={(i) => go(i)}
            transport={
              <>
                <button className="vc-btn" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous play">
                  <Icon name="rewind" />
                </button>
                <button className="vc-btn vc-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                  <Icon name={playing ? 'pause' : 'play'} />
                </button>
                <button className="vc-btn" onClick={() => step(1)} disabled={atEnd} aria-label="Next play">
                  <Icon name="forward" />
                </button>
              </>
            }
            settings={
              <>
                <button
                  className="vc-speed"
                  onClick={() => setSpeed(speeds[(speeds.indexOf(shownSpeed) + 1) % speeds.length])}
                  aria-label="Playback speed"
                >
                  {shownSpeed}×
                </button>
                <HighlightSwitch value={pick} onChange={setPick} />
              </>
            }
          />
        </section>
        <StageTabs value={tab} onChange={setTab} />
        <GamePanel
          league={league}
          game={game}
          home={home}
          away={away}
          plays={plays}
          shown={told ? index : index - 1}
          names={names}
          result={game.result}
        />
        <PlayersPanel
          league={league}
          home={home}
          away={away}
          plays={plays}
          shown={told ? index : index - 1}
          names={names}
          record={game.result.field}
          playerTeams={game.result.playerTeams}
        />

        <section className="panel game-log">
          <div className="play-log" aria-label="Plays so far">
            {recent.map((p, i) => {
              const idx = index - i - (told ? 0 : 1);
              const team = p.offense === home.id ? home : away;
              return (
                // The whole card jumps to its play (the clock is the keyboard way in); a name opens the player.
                <div
                  key={idx}
                  className={`play-card${i === 0 && told ? ' current' : ''}${p.scoring ? ' scoring' : ''}`}
                  onClick={() => go(idx)}
                >
                  <span className="pc-meta">
                    <TeamChip team={team} />
                    <button
                      className="linklike num muted"
                      onClick={() => go(idx)}
                      aria-label={`Jump to the play at ${p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} ${gameClock(p.clock)}`}
                    >
                      {p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} {gameClock(p.clock)}
                    </button>
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
