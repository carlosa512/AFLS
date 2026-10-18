/**
 * Screens as URLs. The current screen lives in the address bar (#/roster/12, #/office/draft) and in
 * browser history, so Back moves between screens instead of leaving the game and a refresh stays put.
 */
import type { OfficeTab } from './screens/FrontOffice';
import type { StatsTab } from './screens/Stats';

export type Route =
  | { view: 'home' }
  | { view: 'roster'; teamId?: number }
  | { view: 'cap'; teamId?: number }
  | { view: 'inbox' }
  | { view: 'office'; tab?: OfficeTab }
  | { view: 'schedule' }
  | { view: 'standings' }
  | { view: 'stats'; tab?: StatsTab }
  | { view: 'playoffs' }
  | { view: 'compare' }
  | { view: 'game'; gameId: number; back: Route }
  | { view: 'watch'; gameId: number; back: Route }
  | { view: 'live' };

const OFFICE_TABS: readonly OfficeTab[] = ['resign', 'fa', 'draft', 'trades', 'coaches', 'staff', 'medical'];
const STATS_TABS: readonly StatsTab[] = ['leaders', 'players', 'records', 'awards', 'officials'];
const PLAIN = ['home', 'inbox', 'schedule', 'standings', 'playoffs', 'compare', 'live'] as const;

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'home':
      return '#/';
    case 'roster':
    case 'cap':
      return route.teamId === undefined ? `#/${route.view}` : `#/${route.view}/${route.teamId}`;
    case 'office':
    case 'stats':
      return route.tab ? `#/${route.view}/${route.tab}` : `#/${route.view}`;
    case 'game':
    case 'watch':
      return `#/${route.view}/${route.gameId}`;
    default:
      return `#/${route.view}`;
  }
}

const id = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined);

/** The route a hash names, or null for anything unrecognised. A game opened from a link goes back to the schedule. */
export function hashToRoute(hash: string): Route | null {
  const [view, arg] = hash.replace(/^#\/?/, '').split('/');
  if (!view) return { view: 'home' };
  if ((PLAIN as readonly string[]).includes(view)) return { view } as Route;
  if (view === 'roster' || view === 'cap') return arg === undefined ? { view } : id(arg) !== undefined ? { view, teamId: id(arg) } : null;
  if (view === 'office') return arg === undefined ? { view } : (OFFICE_TABS as readonly string[]).includes(arg) ? { view, tab: arg as OfficeTab } : null;
  if (view === 'stats') return arg === undefined ? { view } : (STATS_TABS as readonly string[]).includes(arg) ? { view, tab: arg as StatsTab } : null;
  // The Stats tab was called Leaders; keep old bookmarks working.
  if (view === 'leaders') return { view: 'stats', tab: 'leaders' };
  if ((view === 'game' || view === 'watch') && id(arg) !== undefined) return { view, gameId: id(arg)!, back: { view: 'schedule' } };
  return null;
}

/** What the browser keeps for each history entry: the full route (with its way back) and how many in-app steps led here. */
export interface HistoryEntry {
  route: Route;
  depth: number;
}

export function isHistoryEntry(state: unknown): state is HistoryEntry {
  const s = state as HistoryEntry | null;
  return !!s && typeof s === 'object' && typeof s.depth === 'number' && !!s.route && typeof s.route.view === 'string';
}
