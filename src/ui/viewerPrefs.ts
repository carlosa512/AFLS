/**
 * How you like to watch games: per-device choices, so they live in localStorage (like the theme), never in the save.
 * Storage can be blocked (private mode, a sandboxed host): then the default holds and a pick lasts until reload.
 */
import { useState } from 'react';

export const HIGHLIGHTS_KEY = 'afls-viewer-highlights';
export const VIEW_KEY = 'afls-viewer-view';

export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until reload.
  }
}

export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState(() => readPref(key, allowed, fallback));
  const set = (v: T) => {
    writePref(key, v);
    setValue(v);
  };
  return [value, set];
}
