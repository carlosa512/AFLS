import { createContext, useContext, useEffect, useState } from 'react';
import { gamesInWeek, playWeek, simToEndOfRegularSeason, simToEndOfSeason, userGame } from '../engine/league';
import {
  advanceOffseason,
  beginOffseason,
  draftComplete,
  FA_DAYS,
  offseasonBlockers,
  simOffseason,
} from '../engine/offseason';
import { unreadCount } from '../engine/inbox';
import { computeRecords } from '../engine/season/standings';
import { isDeadlineDay } from '../engine/trade';
import type { League } from '../engine/types';
import { Dialog, TeamChip } from './components';
import { isOffseasonPhase, PHASE_LABELS, recordText, resultsSeason, weekLabel } from './format';
import { BoxScore } from './screens/BoxScore';
import { CoachCard } from './screens/Coaches';
import { MedicCard } from './screens/Medical';
import { ScoutCard } from './screens/Staff';
import { Compare } from './screens/Compare';
import { GameViewer } from './screens/GameViewer';
import { LiveGame } from './screens/LiveGame';
import { live, useLive } from './live';
import { Home } from './screens/Home';
import { Inbox } from './screens/Inbox';
import { NewGame } from './screens/NewGame';
import { PlayerCard } from './screens/PlayerCard';
import { Playoffs } from './screens/Playoffs';
import { Finances } from './screens/Finances';
import { FrontOffice } from './screens/FrontOffice';
import { Roster } from './screens/Roster';
import { Schedule } from './screens/Schedule';
import { Standings } from './screens/Standings';
import { Stats } from './screens/Stats';
import { hashToRoute, isHistoryEntry, routeToHash, type HistoryEntry, type Route } from './routes';
import { store, useLeague } from './store';
import { APP_VERSION } from './version';

export type { Route };

interface Nav {
  route: Route;
  go: (route: Route) => void;
  openGame: (gameId: number) => void;
  watchGame: (gameId: number) => void;
  openPlayer: (playerId: number) => void;
  /** A coach's, scout's or medic's card. */
  openStaff: (kind: StaffKind, id: number) => void;
  openTeam: (teamId: number) => void;
  /** Players lined up on the comparison screen (at most MAX_COMPARE). */
  compareIds: number[];
  toggleCompare: (playerId: number) => void;
  clearCompare: () => void;
}

export const MAX_COMPARE = 3;

export type StaffKind = 'coach' | 'scout' | 'medic';

const NavContext = createContext<Nav | null>(null);
export const useNav = () => useContext(NavContext)!;

const TABS: { view: Route['view']; label: string }[] = [
  { view: 'home', label: 'Home' },
  { view: 'roster', label: 'Roster' },
  { view: 'cap', label: 'Cap' },
  { view: 'inbox', label: 'Inbox' },
  { view: 'office', label: 'Front office' },
  { view: 'schedule', label: 'Schedule' },
  { view: 'standings', label: 'Standings' },
  { view: 'stats', label: 'Stats' },
  { view: 'playoffs', label: 'Playoffs' },
];

interface SimAction {
  label: string;
  fn: (l: League) => void;
  /** The confirmation dialog. */
  title: string;
  body: string;
  ok: string;
  cancel: string;
  then?: Route;
}

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
      return {
        label: `Begin ${league.season + 1} offseason`,
        run: beginOffseason,
        then: { view: 'office', tab: 'resign' },
      };
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
  // Playing on ends deadline day: say so, it's the last chance to trade until the new league year.
  if (isDeadlineDay(league)) return `Play ${label} (closes the trade deadline)`;
  return userGame(league) ? `Play ${label}` : `Play ${label} (bye)`;
}

function currentDepth(): number {
  return isHistoryEntry(history.state) ? history.state.depth : 0;
}

function writeHistory(entry: HistoryEntry, replace: boolean) {
  try {
    if (replace) history.replaceState(entry, '', routeToHash(entry.route));
    else history.pushState(entry, '', routeToHash(entry.route));
  } catch {
    // Some sandboxed hosts block history changes; the screen still changes, only Back and refresh don't follow.
  }
}

/** The screen to open on load: the history entry being restored, else the address bar, else Home. */
function initialRoute(): Route {
  const entry = isHistoryEntry(history.state) ? history.state : null;
  const route = entry?.route ?? hashToRoute(location.hash) ?? { view: 'home' };
  writeHistory({ route, depth: entry?.depth ?? 0 }, true);
  return route;
}

export function App() {
  const league = useLeague();
  useLive();
  const [route, setRoute] = useState<Route>(initialRoute);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [staffCard, setStaffCard] = useState<{ kind: StaffKind; id: number } | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmSim, setConfirmSim] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    // Phones show only some tabs; bring the current one into view (e.g. after "All standings" on Home).
    document.querySelector('.tab[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [route]);

  // Browser Back/Forward restore the screen that history entry was showing (and close the player card over it).
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      setPlayerId(null);
      setStaffCard(null);
      setRoute(isHistoryEntry(e.state) ? e.state.route : (hashToRoute(location.hash) ?? { view: 'home' }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Show a screen and record it in browser history (replace: swap the current entry instead of adding one). */
  const navigate = (next: Route, replace = false) => {
    const depth = currentDepth();
    writeHistory({ route: next, depth: replace ? depth : depth + 1 }, replace);
    setRoute(next);
  };
  // Leaving a game: step back through history when we came here in-app, so Back doesn't bounce into the game again.
  const leaveGame = (back: Route) => (currentDepth() > 0 ? history.back() : navigate(back, true));

  if (!league) return <NewGame />;

  const inGame = route.view === 'game' || route.view === 'watch';
  const nav: Nav = {
    route,
    go: (r) => navigate(r),
    // Switching between a game's viewer and box score replaces the entry, so Back returns to where the game was opened.
    openGame: (gameId) =>
      inGame
        ? navigate({ view: 'game', gameId, back: route.back }, true)
        : navigate({ view: 'game', gameId, back: route }),
    watchGame: (gameId) =>
      inGame
        ? navigate({ view: 'watch', gameId, back: route.back }, true)
        : navigate({ view: 'watch', gameId, back: route }),
    openPlayer: setPlayerId,
    openStaff: (kind, id) => {
      setPlayerId(null);
      setStaffCard({ kind, id });
    },
    openTeam: (teamId) => navigate({ view: 'roster', teamId }),
    compareIds,
    toggleCompare: (id) =>
      setCompareIds((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_COMPARE ? ids : [...ids, id],
      ),
    clearCompare: () => setCompareIds([]),
  };

  const userTeam = league.teams[league.userTeamId];
  // A team id typed into the address bar may not exist.
  const teamOr = (teamId: number | undefined) =>
    teamId !== undefined && league.teams[teamId] ? teamId : league.userTeamId;
  const record = computeRecords(league, resultsSeason(league)).get(userTeam.id)!;
  const blockers = offseasonBlockers(league);
  const step = offseasonStep(league);
  const unread = unreadCount(league);

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
      if (step.then) navigate(step.then);
      return;
    }
    // Your game plays out live; the rest of the week is simulated when it ends.
    if (live.inProgress()) return navigate({ view: 'live' });
    const game = userGame(league);
    if (game && !game.result) {
      live.start(league, game);
      navigate({ view: 'live' });
      return;
    }
    run((l) => {
      playWeek(l);
    });
  };

  // Every multi-week sim asks first: on phones it sits under the thumb, and it can't be undone.
  const secondary: SimAction | null =
    league.phase === 'regular'
      ? {
          label: 'Sim to playoffs',
          fn: simToEndOfRegularSeason,
          title: 'Sim the rest of the regular season?',
          body: "Every remaining regular-season game is simulated, yours included, and you won't watch them. This can't be undone.",
          ok: 'Sim to playoffs',
          cancel: 'Keep playing',
        }
      : league.phase === 'playoffs'
        ? {
            label: 'Sim to the title',
            fn: simToEndOfSeason,
            title: 'Sim the rest of the playoffs?',
            body: "Every remaining playoff game is simulated, yours included, and you won't watch them. This can't be undone.",
            ok: 'Sim to the title',
            cancel: 'Keep playing',
          }
        : step
          ? {
              label: 'Sim offseason…',
              fn: simOffseason,
              title: 'Let the AI run your offseason?',
              body: 'Your front office makes every call through to week 1: re-signings, tags, free agency, the draft and cuts. You can review every move on the Cap screen afterwards.',
              ok: 'Sim to week 1',
              cancel: "I'll do it myself",
              then: { view: 'home' },
            }
          : null;

  const pendingGames = gamesInWeek(league).filter((g) => !g.result).length;
  const tabOf = (r: Route): Route['view'] =>
    r.view === 'game' || r.view === 'watch' ? tabOf(r.back) : r.view === 'live' ? 'home' : r.view;
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
                {league.season} ·{' '}
                {league.phase === 'regular' || league.phase === 'playoffs'
                  ? weekLabel(league.week)
                  : PHASE_LABELS[league.phase]}
                {league.phase === 'freeAgency' ? ` (day ${league.faDay})` : ''} ·{' '}
                {isOffseasonPhase(league) ? `${resultsSeason(league)}: ` : ''}
                {recordText(record)}
              </span>
            </div>
            <span className="app-version">{APP_VERSION}</span>
          </div>
          {/* The live game has its own controls; Resume and a season sim would only be stray taps there. */}
          {route.view !== 'live' && (
            <div className="actions">
              {secondary && (
                <button
                  className="btn"
                  disabled={busy || (!step && blockers.length > 0)}
                  title={!step ? blockers[0] : undefined}
                  onClick={() => setConfirmSim(true)}
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
          )}
        </div>
        <nav className="wrap tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.view}
              className="tab"
              aria-current={activeTab === t.view ? 'page' : undefined}
              onClick={() =>
                navigate(
                  t.view === 'roster' || t.view === 'cap'
                    ? { view: t.view, teamId: league.userTeamId }
                    : ({ view: t.view } as Route),
                )
              }
            >
              {t.label}
              {t.view === 'inbox' && unread > 0 && <span className="tab-badge"> ({unread})</span>}
            </button>
          ))}
        </nav>
        {blockers.length > 0 && (
          <div className="wrap blockers" role="status">
            <b>Before you continue:</b> {blockers.join(' ')}
          </div>
        )}
      </header>
      {confirmSim && secondary && (
        <Dialog
          title={secondary.title}
          onClose={() => setConfirmSim(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmSim(false)} data-autofocus>
                {secondary.cancel}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirmSim(false);
                  // Finish a game in progress first; the sim then plays everything else.
                  live.finish(false);
                  run(secondary.fn);
                  if (secondary.then) navigate(secondary.then);
                }}
              >
                {secondary.ok}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{secondary.body}</p>
        </Dialog>
      )}

      <main className="wrap">
        {route.view === 'home' && <Home league={league} />}
        {route.view === 'roster' && <Roster league={league} teamId={teamOr(route.teamId)} />}
        {route.view === 'cap' && <Finances league={league} teamId={teamOr(route.teamId)} />}
        {route.view === 'inbox' && (
          <Inbox key={`${route.messageId ?? ''}:${route.focus ?? ''}`} league={league} messageId={route.messageId} />
        )}
        {route.view === 'office' && <FrontOffice league={league} tab={route.tab} pos={route.pos} />}
        {route.view === 'schedule' && <Schedule league={league} />}
        {route.view === 'standings' && <Standings league={league} />}
        {route.view === 'stats' && <Stats league={league} tab={route.tab} />}
        {route.view === 'playoffs' && <Playoffs league={league} />}
        {route.view === 'compare' && <Compare league={league} />}
        {route.view === 'game' && (
          <BoxScore league={league} gameId={route.gameId} onBack={() => leaveGame(route.back)} />
        )}
        {route.view === 'live' && <LiveGame league={league} />}
        {route.view === 'watch' && (
          <GameViewer
            league={league}
            gameId={route.gameId}
            onBack={() => leaveGame(route.back)}
            onBoxScore={() => nav.openGame(route.gameId)}
          />
        )}
      </main>

      {compareIds.length > 0 && route.view !== 'compare' && (
        <div className="compare-tray" role="region" aria-label="Comparison">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setPlayerId(null);
              navigate({ view: 'compare' });
            }}
          >
            Compare {compareIds.length} player{compareIds.length > 1 ? 's' : ''}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setCompareIds([])} aria-label="Clear the comparison">
            ✕
          </button>
        </div>
      )}

      {playerId !== null && league.players[playerId] && (
        <PlayerCard league={league} player={league.players[playerId]} onClose={() => setPlayerId(null)} />
      )}
      {staffCard?.kind === 'coach' && (league.coaches[staffCard.id] ?? league.retiredCoaches[staffCard.id]) && (
        <CoachCard
          league={league}
          coach={league.coaches[staffCard.id] ?? league.retiredCoaches[staffCard.id]}
          onClose={() => setStaffCard(null)}
        />
      )}
      {staffCard?.kind === 'scout' && league.staff[staffCard.id] && (
        <ScoutCard league={league} scout={league.staff[staffCard.id]} onClose={() => setStaffCard(null)} />
      )}
      {staffCard?.kind === 'medic' && league.medics[staffCard.id] && (
        <MedicCard league={league} medic={league.medics[staffCard.id]} onClose={() => setStaffCard(null)} />
      )}
    </NavContext.Provider>
  );
}
