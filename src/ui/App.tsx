import { createContext, useContext, useEffect, useState } from 'react';
import { gamesInWeek, playWeek, simToEndOfRegularSeason, simToEndOfSeason, userGame } from '../engine/league';
import { advanceOffseason, beginOffseason, draftComplete, FA_DAYS, offseasonBlockers, simOffseason } from '../engine/offseason';
import { computeRecords } from '../engine/season/standings';
import type { League } from '../engine/types';
import { Dialog, TeamChip } from './components';
import { isOffseasonPhase, PHASE_LABELS, recordText, resultsSeason, weekLabel } from './format';
import { BoxScore } from './screens/BoxScore';
import { GameViewer } from './screens/GameViewer';
import { LiveGame } from './screens/LiveGame';
import { live, useLive } from './live';
import { Home } from './screens/Home';
import { Leaders } from './screens/Leaders';
import { NewGame } from './screens/NewGame';
import { PlayerCard } from './screens/PlayerCard';
import { Playoffs } from './screens/Playoffs';
import { Finances } from './screens/Finances';
import { FrontOffice, type OfficeTab } from './screens/FrontOffice';
import { Roster } from './screens/Roster';
import { Schedule } from './screens/Schedule';
import { Standings } from './screens/Standings';
import { store, useLeague } from './store';

export type Route =
  | { view: 'home' }
  | { view: 'roster'; teamId?: number }
  | { view: 'cap'; teamId?: number }
  | { view: 'office'; tab?: OfficeTab }
  | { view: 'schedule' }
  | { view: 'standings' }
  | { view: 'leaders' }
  | { view: 'playoffs' }
  | { view: 'game'; gameId: number; back: Route }
  | { view: 'watch'; gameId: number; back: Route }
  | { view: 'live' };

interface Nav {
  route: Route;
  go: (route: Route) => void;
  openGame: (gameId: number) => void;
  watchGame: (gameId: number) => void;
  openPlayer: (playerId: number) => void;
  openTeam: (teamId: number) => void;
}

const NavContext = createContext<Nav | null>(null);
export const useNav = () => useContext(NavContext)!;

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'roster', label: 'Roster' },
  { view: 'cap', label: 'Cap' },
  { view: 'office', label: 'Front office' },
  { view: 'schedule', label: 'Schedule' },
  { view: 'standings', label: 'Standings' },
  { view: 'leaders', label: 'Leaders' },
  { view: 'playoffs', label: 'Playoffs' },
];

interface Step {
  label: string;
  run: (l: League) => void;
  /** Where to go once it's done. */
  then?: Route;
}

/** The one obvious next action in the offseason calendar. */
function offseasonStep(league: League): Step | null {
  switch (league.phase) {
    case 'complete':
      return { label: `Begin ${league.season + 1} offseason`, run: beginOffseason, then: { view: 'office', tab: 'resign' } };
    case 'resign':
      return { label: 'Open free agency', run: (l) => advanceOffseason(l), then: { view: 'office', tab: 'fa' } };
    case 'freeAgency':
      return league.faDay < FA_DAYS
        ? { label: `Next free-agency day (${league.faDay}/${FA_DAYS})`, run: (l) => advanceOffseason(l) }
        : { label: 'Go to the draft', run: (l) => advanceOffseason(l), then: { view: 'office', tab: 'draft' } };
    case 'draft':
      return draftComplete(league)
        ? { label: 'Start training camp', run: (l) => advanceOffseason(l), then: { view: 'cap' } }
        : { label: 'Finish the draft', run: (l) => advanceOffseason(l), then: { view: 'cap' } };
    case 'preseason':
      return { label: `Start the ${league.season} season`, run: (l) => advanceOffseason(l), then: { view: 'home' } };
    default:
      return null;
  }
}

function primaryActionLabel(league: League): string {
  const step = offseasonStep(league);
  if (step) return step.label;
  if (live.inProgress()) return 'Resume live game';
  const label = weekLabel(league.week);
  if (league.phase === 'playoffs') return `Play ${label}`;
  return userGame(league) ? `Play ${label}` : `Play ${label} (bye)`;
}

export function App() {
  const league = useLeague();
  useLive();
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSim, setConfirmSim] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  if (!league) return <NewGame />;

  const nav: Nav = {
    route,
    go: setRoute,
    openGame: (gameId) => setRoute({ view: 'game', gameId, back: route.view === 'game' || route.view === 'watch' ? route.back : route }),
    watchGame: (gameId) => setRoute({ view: 'watch', gameId, back: route.view === 'game' || route.view === 'watch' ? route.back : route }),
    openPlayer: setPlayerId,
    openTeam: (teamId) => setRoute({ view: 'roster', teamId }),
  };

  const userTeam = league.teams[league.userTeamId];
  const record = computeRecords(league, resultsSeason(league)).get(userTeam.id)!;
  const blockers = offseasonBlockers(league);
  const step = offseasonStep(league);

  // Run long sims after a paint so the button can show its busy state.
  const run = (fn: (l: League) => void) => {
    setBusy(true);
    setTimeout(() => {
      store.mutate(fn);
      setBusy(false);
    }, 16);
  };

  const primary = () => {
    if (step) {
      run(step.run);
      if (step.then) setRoute(step.then);
      return;
    }
    // Your game plays out live; the rest of the week is simulated when it ends.
    if (live.inProgress()) return setRoute({ view: 'live' });
    const game = userGame(league);
    if (game && !game.result) {
      live.start(league, game);
      setRoute({ view: 'live' });
      return;
    }
    run((l) => {
      playWeek(l);
    });
  };

  const secondary =
    league.phase === 'regular'
      ? { label: 'Sim to playoffs', fn: simToEndOfRegularSeason }
      : league.phase === 'playoffs'
        ? { label: 'Sim to the title', fn: simToEndOfSeason }
        : step
          ? { label: 'Sim offseason…', fn: simOffseason, confirm: true }
          : null;

  const pendingGames = gamesInWeek(league).filter((g) => !g.result).length;
  const tabOf = (r: Route): Route['view'] => (r.view === 'game' || r.view === 'watch' ? tabOf(r.back) : r.view === 'live' ? 'home' : r.view);
  const activeTab = tabOf(route);

  return (
    <NavContext.Provider value={nav}>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <div className="brand">
            <TeamChip team={userTeam} large />
            <div className="brand-text">
              <strong>
                {userTeam.city} {userTeam.name}
              </strong>
              <span>
                {league.season} · {league.phase === 'regular' || league.phase === 'playoffs' ? weekLabel(league.week) : PHASE_LABELS[league.phase]}
                {league.phase === 'freeAgency' ? ` (day ${league.faDay})` : ''} · {isOffseasonPhase(league) ? `${resultsSeason(league)}: ` : ''}
                {recordText(record)}
              </span>
            </div>
          </div>
          <div className="actions">
            {secondary && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if ('confirm' in secondary) return setConfirmSim(true);
                  // Finish a game in progress first; the sim then plays everything else.
                  live.finish(false);
                  run(secondary.fn);
                }}
              >
                {secondary.label}
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={busy || (!step && pendingGames === 0) || blockers.length > 0}
              title={blockers[0]}
              onClick={primary}
            >
              {busy ? 'Simulating…' : primaryActionLabel(league)}
            </button>
          </div>
        </div>
        <nav className="wrap tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.view}
              className="tab"
              aria-current={activeTab === t.view ? 'page' : undefined}
              onClick={() => setRoute(t.view === 'roster' || t.view === 'cap' ? { view: t.view, teamId: league.userTeamId } : ({ view: t.view } as Route))}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {blockers.length > 0 && (
          <div className="wrap blockers" role="status">
            <b>Before you continue:</b> {blockers.join(' ')}
          </div>
        )}
      </header>
      {confirmSim && (
        <Dialog
          title="Let the AI run your offseason?"
          onClose={() => setConfirmSim(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSim(false)} data-autofocus>
                I'll do it myself
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirmSim(false);
                  run(simOffseason);
                  setRoute({ view: 'home' });
                }}
              >
                Sim to week 1
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Your front office makes every call through to week 1: re-signings, tags, free agency, the draft and cuts. You can review every move on the Cap
            screen afterwards.
          </p>
        </Dialog>
      )}

      <main className="wrap">
        {route.view === 'home' && <Home league={league} />}
        {route.view === 'roster' && <Roster league={league} teamId={route.teamId ?? league.userTeamId} />}
        {route.view === 'cap' && <Finances league={league} teamId={route.teamId ?? league.userTeamId} />}
        {route.view === 'office' && <FrontOffice league={league} tab={route.tab} />}
        {route.view === 'schedule' && <Schedule league={league} />}
        {route.view === 'standings' && <Standings league={league} />}
        {route.view === 'leaders' && <Leaders league={league} />}
        {route.view === 'playoffs' && <Playoffs league={league} />}
        {route.view === 'game' && <BoxScore league={league} gameId={route.gameId} onBack={() => setRoute(route.back)} />}
        {route.view === 'live' && <LiveGame league={league} />}
        {route.view === 'watch' && (
          <GameViewer league={league} gameId={route.gameId} onBack={() => setRoute(route.back)} onBoxScore={() => nav.openGame(route.gameId)} />
        )}
      </main>

      {playerId !== null && league.players[playerId] && (
        <PlayerCard league={league} player={league.players[playerId]} onClose={() => setPlayerId(null)} />
      )}
    </NavContext.Provider>
  );
}
