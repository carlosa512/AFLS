/**
 * App state: one League object, mutated in place by engine functions, plus a
 * version counter that tells React to re-render. Saves go to IndexedDB.
 */
import { useSyncExternalStore } from 'react';
import { SAVE_VERSION } from '../engine/generate';
import { deliverMail } from '../engine/inbox';
import type { League } from '../engine/types';

let league: League | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const l of listeners) l();
}

export const store = {
  get: () => league,
  set(next: League | null) {
    league = next;
    emit();
    scheduleSave();
  },
  /** Run an engine mutation against the current league, file any new mail, then re-render and autosave. */
  mutate(fn: (l: League) => void) {
    if (!league) return;
    fn(league);
    deliverMail(league);
    emit();
    scheduleSave();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  version: () => version,
};

export function useLeague(): League | null {
  useSyncExternalStore(store.subscribe, store.version);
  return league;
}

// ───────────── persistence ─────────────

const DB_NAME = 'afls';
const STORE_NAME = 'saves';
const SAVE_KEY = 'career';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSave(): Promise<League | null> {
  try {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(SAVE_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as League;
    // Older saves are upgraded by migrateLeague on load; newer ones can't be read.
    return parsed.version <= SAVE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSave(data: League | null): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const os = tx.objectStore(STORE_NAME);
      if (data) os.put(JSON.stringify(data), SAVE_KEY);
      else os.delete(SAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Storage can be unavailable (private mode, sandboxed previews); the game still runs.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void writeSave(league), 400);
}
