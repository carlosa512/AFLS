import { describe, expect, it } from 'vitest';
import { version } from '../../package.json';
import { CHANGELOG } from './changelog';
import { versionLines } from './versionHistory';

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

  it('says each update in one or two short sentences', () => {
    for (const e of CHANGELOG) {
      expect(e.text.length, `${e.version} is ${e.text.length} characters`).toBeLessThanOrEqual(200);
      expect((e.text.match(/[.!?](\s|$)/g) ?? []).length, `${e.version} runs past two sentences`).toBeLessThanOrEqual(
        2,
      );
      expect(e.title.length, `${e.version}'s title`).toBeLessThanOrEqual(40);
    }
  });

  it('folds the updates under their line, newest line first, none lost', () => {
    const lines = versionLines(CHANGELOG);
    expect(lines[0].line).toBe(version.split('.').slice(0, 2).join('.'));
    expect(new Set(lines.map((l) => l.line)).size).toBe(lines.length);
    expect(lines.flatMap((l) => l.entries)).toEqual([...CHANGELOG]);
    for (const l of lines) for (const e of l.entries) expect(e.version.startsWith(`${l.line}.`)).toBe(true);
  });
});
