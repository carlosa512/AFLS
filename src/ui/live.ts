/**
 * The game being watched live. Held outside the League (the engine object is not
 * serializable) so you can browse other tabs mid-game and come back to the same snap.
 * A page reload drops the session; the game is still unplayed and restarts identically.
 */
import { useSyncExternalStore } from 'react';
import { playWeek, recordResult, startLiveGame } from '../engine/league';
import type { LiveGame } from '../engine/match/gameSim';
import type { Game, League, PlayLogEntry } from '../engine/types';
import { store } from './store';

export interface LiveSession {
  gameId: number;
  sim: LiveGame;
  /** Plays revealed so far, in order. */
  plays: PlayLogEntry[];
  /** Index of the play on screen. */
  current: number;
  speed: number;
  playing: boolean;
  /** The result is recorded and the rest of the week has been played. */
  finished: boolean;
  /** The play on screen was skipped by the highlight level: show where it ended, don't animate it. */
  still: boolean;
}

let session: LiveSession | null = null;

/** Make sure the play at `index` (default: the one after the current play) has been played. False when it never will. */
function pull(s: LiveSession, index = s.current + 1): boolean {
  while (index >= s.plays.length) {
    if (s.sim.over) return false;
    const batch = s.sim.next();
    if (!batch.length) return false;
    s.plays.push(...batch);
  }
  return true;
}
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};

export const live = {
  get: () => session,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  version: () => version,

  /** True while a game is under way and its result is not yet recorded. */
  inProgress: () => !!session && !session.finished,

  start(league: League, game: Game) {
    const sim = startLiveGame(league, game);
    session = {
      gameId: game.id,
      sim,
      plays: sim.next(),
      current: 0,
      speed: session?.speed ?? 2,
      playing: true,
      finished: false,
      still: false,
    };
    emit();
  },

  update(patch: Partial<Pick<LiveSession, 'current' | 'speed' | 'playing'>>) {
    if (!session) return;
    Object.assign(session, patch);
    emit();
  },

  /** Reveal the next play, pulling more from the engine when needed. Returns false at the final whistle. */
  advance(): boolean {
    if (!session || !pull(session)) return false;
    session.current++;
    session.still = false;
    emit();
    return true;
  },

  /**
   * Highlights: move to the last play before the next one `isShown` accepts, pulling plays from the engine as needed,
   * so the log and the scoreboard catch up in one step. Returns false when the next play is already shown (or there is
   * none). At the final whistle it stops on the last play.
   */
  skipTo(isShown: (plays: PlayLogEntry[], i: number) => boolean): boolean {
    const s = session;
    if (!s) return false;
    let i = s.current;
    while (pull(s, i + 1) && !isShown(s.plays, i + 1)) i++;
    if (i === s.current) return false;
    s.current = i;
    s.still = true;
    emit();
    return true;
  },

  /**
   * Record the game and play the rest of the week. With `thenPlayWeek: false` only the game
   * is recorded (used before a multi-week sim, which plays the remaining games itself).
   */
  finish(thenPlayWeek = true) {
    const s = session;
    if (!s || s.finished) return;
    while (!s.sim.over) s.plays.push(...s.sim.next());
    s.current = s.plays.length - 1;
    s.playing = false;
    s.finished = true;
    store.mutate((l) => {
      const game = l.games.find((g) => g.id === s.gameId);
      if (game) recordResult(l, game, s.sim.result());
      if (thenPlayWeek) playWeek(l);
    });
    emit();
  },

  clear() {
    session = null;
    emit();
  },
};

/** Roster moves wait until the live game is over: the players on the field are already set. */
export const liveLock = (): string | null =>
  live.inProgress() ? 'Finish your live game first (or sim it to the final).' : null;

export function useLive(): LiveSession | null {
  useSyncExternalStore(live.subscribe, live.version);
  return session;
}
