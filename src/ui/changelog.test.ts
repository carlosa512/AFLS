import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { CHANGELOG } from './changelog';

describe('version history', () => {
  it('opens with the version package.json ships, newest first, one entry a version', () => {
    expect(CHANGELOG[0].version).toBe(version);
    const parts = (v: string) => v.split('.').map(Number);
    for (let i = 1; i < CHANGELOG.length; i++) {
      const [a, b] = [parts(CHANGELOG[i - 1].version), parts(CHANGELOG[i].version)];
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer, `${CHANGELOG[i - 1].version} before ${CHANGELOG[i].version}`).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
    for (const e of CHANGELOG) expect(e.title && e.text).toBeTruthy();
  });
});
