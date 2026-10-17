/**
 * Career backups: the IndexedDB autosave is the only copy of a career, and clearing site data or
 * starting over loses it. A backup is the same JSON document, downloaded as a file and loaded back
 * through the usual save upgrades.
 */
import { useRef, useState } from 'react';
import { SAVE_VERSION } from '../engine/generate';
import { migrateLeague } from '../engine/migrate';
import type { League } from '../engine/types';
import { Dialog } from './components';
import { PHASE_LABELS } from './format';
import { live } from './live';
import { store } from './store';

export function backupFileName(league: League): string {
  const team = league.teams[league.userTeamId];
  return `afls-${team.abbrev.toLowerCase()}-${league.season}-${league.phase}.json`;
}

export function downloadBackup(league: League) {
  const blob = new Blob([JSON.stringify(league)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(league);
  a.click();
  // Revoke after the click has been handled, or some browsers cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Reads a backup file's text into an upgraded league, or explains why it can't. */
export function parseBackup(text: string): { league: League } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "That file isn't an AFLS backup." };
  }
  const l = raw as Partial<League> | null;
  if (!l || typeof l !== 'object' || typeof l.version !== 'number' || !Array.isArray(l.teams) || typeof l.players !== 'object' || !l.teams[l.userTeamId ?? -1]) {
    return { error: "That file isn't an AFLS backup." };
  }
  if (l.version > SAVE_VERSION) return { error: 'That backup was made by a newer version of AFLS. Update the game to load it.' };
  const league = migrateLeague(l as League);
  return league ? { league } : { error: "That backup couldn't be upgraded." };
}

function describe(league: League): string {
  const team = league.teams[league.userTeamId];
  return `${team.city} ${team.name}, ${league.season} (${PHASE_LABELS[league.phase].toLowerCase()})`;
}

/** Downloads the current career as a file. */
export function BackupButton({ league }: { league: League }) {
  return (
    <button className="btn btn-sm btn-ghost" onClick={() => downloadBackup(league)} title="Download this career as a file you can load later">
      Download backup
    </button>
  );
}

/** Loads a career from a backup file, asking first when it would replace the one in progress. */
export function LoadBackupButton({ className = 'btn btn-sm btn-ghost' }: { className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<League | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (league: League) => {
    setPending(null);
    live.clear();
    store.set(league);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const result = parseBackup(await file.text());
    if ('error' in result) return setError(result.error);
    setError(null);
    const current = store.get();
    if (current) setPending(result.league);
    else load(result.league);
  };

  const current = store.get();
  return (
    <>
      <button className={className} onClick={() => input.current?.click()}>
        Load backup…
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          // Reset so picking the same file again still fires a change.
          e.target.value = '';
        }}
      />
      {error && (
        <Dialog title="Couldn't load that file" onClose={() => setError(null)}>
          <p style={{ margin: 0 }}>{error}</p>
        </Dialog>
      )}
      {pending && current && (
        <Dialog
          title="Replace your current career?"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)} data-autofocus>
                Keep playing
              </button>
              <button className="btn" onClick={() => downloadBackup(current)}>
                Back up current first
              </button>
              <button className="btn btn-primary" onClick={() => load(pending)}>
                Load backup
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Loading <strong>{describe(pending)}</strong> replaces <strong>{describe(current)}</strong>. Download a backup of it first if you want to come
            back to it.
          </p>
        </Dialog>
      )}
    </>
  );
}
