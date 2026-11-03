/**
 * Developer-only switches: shown with `?dev` in the address. The spatial engine's switch lives in the save
 * (`League.settings`: it changes results), the only part of it that's the browser's is whether it's shown.
 */
import type { League } from '../engine/types';
import { store } from './store';

/** Developer mode: `?dev` in the address. */
export function devMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).has('dev');
}

/** Your games' open field played by the spatial engine, or not. */
export function setSpatialField(league: League, on: boolean): void {
  (league.settings ??= {}).spatialField = on;
}

/** The spatial engine's switch, for developers until its checks pass. */
export function FieldSwitch({ league }: { league: League }) {
  if (!devMode()) return null;
  return (
    <label className="theme-select" title="Your games' runs, catches and returns play out on the field.">
      <input
        type="checkbox"
        checked={!!league.settings?.spatialField}
        onChange={(e) => {
          const on = e.target.checked;
          store.mutate((l) => setSpatialField(l, on));
        }}
      />{' '}
      Spatial open field (in development)
    </label>
  );
}
