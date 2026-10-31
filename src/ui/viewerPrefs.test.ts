import { afterEach, describe, expect, it, vi } from 'vitest';
import { HIGHLIGHT_LEVELS } from './highlights';
import { HIGHLIGHTS_KEY, readPref, writePref } from './viewerPrefs';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

afterEach(() => vi.unstubAllGlobals());

describe('viewer prefs', () => {
  it('falls back to the default when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readPref(HIGHLIGHTS_KEY, HIGHLIGHT_LEVELS, 'full')).toBe('full');
    expect(() => writePref(HIGHLIGHTS_KEY, 'key')).not.toThrow();
  });

  it('reads back a stored pick, and ignores one it does not know', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    writePref(HIGHLIGHTS_KEY, 'key');
    expect(readPref(HIGHLIGHTS_KEY, HIGHLIGHT_LEVELS, 'full')).toBe('key');
    writePref(HIGHLIGHTS_KEY, 'loud');
    expect(readPref(HIGHLIGHTS_KEY, HIGHLIGHT_LEVELS, 'full')).toBe('full');
  });
});
