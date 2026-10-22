import { createContext, useContext } from 'react';
import type { Route } from './routes';

/**
 * Where a click goes. Lives apart from `App.tsx` so the shared link components in `components.tsx` can
 * read it without importing the app shell.
 */
export interface Nav {
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

export const NavContext = createContext<Nav | null>(null);
export const useNav = () => useContext(NavContext)!;
