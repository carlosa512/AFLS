import { createContext, useContext, useEffect, useState } from 'react';
import { gamesInWeek, playWeek, simToEndOfRegularSeason, simToEndOfSeason, startNextSeason, userGame } from '../engine/league';
import { computeRecords } from '../engine/season/standings';
import type { League } from '../engine/types';
import { TeamChip } from './components';
import { recordText, weekLabel } from './format';
import { BoxScore } from './screens/BoxScore';
import { Home } from './screens/Home';
import { Leaders } from './screens/Leaders';
import { NewGame } from './screens/NewGame';
import { PlayerCard } from './screens/PlayerCard';
import { Playoffs } from './screens/Playoffs';
import { Roster } from './screens/Roster';
import { Schedule } from './screens/Schedule';
import { Standings } from './screens/Standings';
import { store, useLeague } from './store';

export type Route =
  | { view: 'home' }
  | { view: 'roster'; teamId?: number }
  | { view: 'schedule' }
  | { view: 'standings' }
  | { view: 'leaders' }
  | { view: 'playoffs' }
  | { view: 'game'; gameId: number; back: Route };

interface Nav {
  route: Route;
  go: (route: Route) => void;
  openGame: (gameId: number) => void;
  openPlayer: (playerId: number) => void;
  openTeam: (teamId: number) => void;
}

const NavContext = createContext<Nav | null>(null);
export const useNav = () => useContext(NavContext)!;

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'roster', label: 'Roster' },
  { view: 'schedule', label: 'Schedule' },
  { view: 'standings', label: 'Standings' },
  { view: 'leaders', label: 'Leaders' },
  { view: 'playoffs', label: 'Playoffs' },
];

function primaryActionLabel(league: League): string {
  if (league.phase === 'complete') return `Start ${league.season + 1} season`;
  const label = weekLabel(league.week);
  if (league.phase === 'playoffs') return `Play ${label}`;
  return userGame(league) ? `Play ${label}` : `Play ${label} (bye)`;
}

export function App() {
  const league = useLeague();
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route]);

  if (!league) return <NewGame />;

  const nav: Nav = {
    route,
    go: setRoute,
    openGame: (gameId) => setRoute({ view: 'game', gameId, back: route.view === 'game' ? route.back : route }),
    openPlayer: setPlayerId,
    openTeam: (teamId) => setRoute({ view: 'roster', teamId }),
  };

  const userTeam = league.teams[league.userTeamId];
  const record = computeRecords(league).get(userTeam.id)!;

  // Run long sims after a paint so the button can show its busy state.
  const run = (fn: (l: League) => void) => {
    setBusy(true);
    setTimeout(() => {
      store.mutate(fn);
      setBusy(false);
    }, 16);
  };

  const primary = () => {
    if (league.phase === 'complete') {
      run(startNextSeason);
      setRoute({ view: 'home' });
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
        : null;

  const pendingGames = gamesInWeek(league).filter((g) => !g.result).length;
  const activeTab = route.view === 'game' ? route.back.view : route.view;

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
                {league.season} · {league.phase === 'complete' ? 'Season complete' : weekLabel(league.week)} · {recordText(record)}
              </span>
            </div>
          </div>
          <div className="actions">
            {secondary && (
              <button className="btn" disabled={busy} onClick={() => run(secondary.fn)}>
                {secondary.label}
              </button>
            )}
            <button className="btn btn-primary" disabled={busy || (league.phase !== 'complete' && pendingGames === 0)} onClick={primary}>
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
              onClick={() => setRoute(t.view === 'roster' ? { view: 'roster', teamId: league.userTeamId } : ({ view: t.view } as Route))}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="wrap">
        {route.view === 'home' && <Home league={league} />}
        {route.view === 'roster' && <Roster league={league} teamId={route.teamId ?? league.userTeamId} />}
        {route.view === 'schedule' && <Schedule league={league} />}
        {route.view === 'standings' && <Standings league={league} />}
        {route.view === 'leaders' && <Leaders league={league} />}
        {route.view === 'playoffs' && <Playoffs league={league} />}
        {route.view === 'game' && <BoxScore league={league} gameId={route.gameId} onBack={() => setRoute(route.back)} />}
      </main>

      {playerId !== null && league.players[playerId] && (
        <PlayerCard league={league} player={league.players[playerId]} onClose={() => setPlayerId(null)} />
      )}
    </NavContext.Provider>
  );
}
