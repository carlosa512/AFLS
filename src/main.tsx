import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { League } from './engine/types';
import { App } from './ui/App';
import { loadSave, store } from './ui/store';
import './styles.css';

interface HotApi {
  snapshot?: (capture: () => unknown) => void;
  ready?: (start: (data: unknown) => void) => void;
  data?: unknown;
}
declare global {
  interface Window {
    claude?: { hot?: HotApi };
  }
}

function leagueFromHot(data: unknown): League | null {
  try {
    const raw = (data as { league?: string } | undefined)?.league;
    return raw ? (JSON.parse(raw) as League) : null;
  } catch {
    return null;
  }
}

async function start(hotData: unknown) {
  const league = leagueFromHot(hotData) ?? (await loadSave());
  if (league) store.set(league);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// When the page is hosted as a shared artifact, keep the career across live updates.
const hot = window.claude?.hot;
hot?.snapshot?.(() => {
  const league = store.get();
  return { league: league ? JSON.stringify(league) : null };
});
if (hot?.ready) hot.ready(start);
else void start(hot?.data ?? {});
