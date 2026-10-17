import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../engine/generate';
import { sortRows } from './components';
import { hashToRoute, routeToHash, type Route } from './routes';
import { backupFileName, parseBackup } from './saves';

describe('routes', () => {
  it('round-trip through the address bar', () => {
    const routes: Route[] = [
      { view: 'home' },
      { view: 'roster' },
      { view: 'roster', teamId: 0 },
      { view: 'cap', teamId: 31 },
      { view: 'office' },
      { view: 'office', tab: 'draft' },
      { view: 'standings' },
      { view: 'live' },
    ];
    for (const r of routes) expect(hashToRoute(routeToHash(r))).toEqual(r);
  });

  it('send a game opened from a link back to the schedule', () => {
    expect(hashToRoute(routeToHash({ view: 'game', gameId: 42, back: { view: 'home' } }))).toEqual({ view: 'game', gameId: 42, back: { view: 'schedule' } });
  });

  it('reject anything unrecognised', () => {
    expect(hashToRoute('')).toEqual({ view: 'home' });
    for (const bad of ['#/nope', '#/office/payroll', '#/roster/abc', '#/game/', '#/roster/-1']) expect(hashToRoute(bad)).toBeNull();
  });
});

describe('backups', () => {
  const league = createLeague({ seed: 'backup-test' });

  it('load back what was saved', () => {
    const result = parseBackup(JSON.stringify(league));
    expect('league' in result && result.league.seed).toBe('backup-test');
    expect(backupFileName(league)).toMatch(/^afls-[a-z]+-\d{4}-\w+\.json$/);
  });

  it('turn away other files and newer versions', () => {
    expect(parseBackup('not json')).toHaveProperty('error');
    expect(parseBackup('{"hello":1}')).toHaveProperty('error');
    expect(parseBackup(JSON.stringify({ ...league, version: SAVE_VERSION + 1 }))).toMatchObject({ error: expect.stringContaining('newer') });
  });
});

describe('sortRows', () => {
  it('sorts both ways and keeps ties in order', () => {
    const rows = [
      { n: 'a', v: 2 },
      { n: 'b', v: 1 },
      { n: 'c', v: 2 },
    ];
    expect(sortRows(rows, { key: 'v', desc: true }, (r) => r.v).map((r) => r.n)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, { key: 'v', desc: false }, (r) => r.v).map((r) => r.n)).toEqual(['b', 'a', 'c']);
  });
});
