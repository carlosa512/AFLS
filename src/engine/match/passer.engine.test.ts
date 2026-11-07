import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { League, PlayLogEntry } from '../types';
import { simulateGame, type DropbackTap } from './gameSim';

/** What a log entry was as it ran, a flag or not. */
const ran = (e: PlayLogEntry) => (e.kind === 'penalty' ? e.ran?.kind : e.kind);

function play(league: League, games: number) {
  const taps: DropbackTap[] = [];
  const plays: PlayLogEntry[] = [];
  for (const g of league.games.filter((g) => !g.playoffRound).slice(0, games)) {
    const r = simulateGame(league, g, { keepPlays: true, dropbackTap: (t) => taps.push(t) });
    // A two-point try's snap books nothing and taps nothing (`twoPointTry`).
    plays.push(...r.plays!.filter((e) => !/^Two-point try: /.test(e.text)));
  }
  return { taps, plays };
}

describe('the passer chooses after his read', () => {
  const league = createLeague({ seed: 'passer-t' });
  const { taps, plays } = play(league, 40);
  const count = (f: (t: DropbackTap) => boolean) => taps.filter(f).length;

  it('every dropback taps once, and nothing else does', () => {
    const kinds = plays.map(ran);
    expect(count((t) => t.call === 'sack')).toBe(kinds.filter((k) => k === 'sack').length);
    expect(count((t) => t.call === 'run')).toBe(kinds.filter((k) => k === 'scramble').length);
    const throws = plays.filter(
      (e) => ['pass', 'incomplete', 'int'].includes(ran(e) ?? '') && !/two-point/i.test(e.text),
    );
    expect(count((t) => t.call === 'throw' || t.call === 'away')).toBe(throws.length);
  });

  it('a clean pocket can end in a throwaway or a run, which it never did before', () => {
    expect(count((t) => !t.pressured && t.call === 'away')).toBeGreaterThan(0);
    expect(count((t) => !t.pressured && t.call === 'run')).toBeGreaterThan(0);
  });

  it('every sack was pressured, and a throwaway says where it came from', () => {
    for (const t of taps) if (t.call === 'sack') expect(t.pressured).toBe(true);
    for (const t of taps) if (t.call === 'away') expect(typeof t.outside).toBe('boolean');
  });

  it('a gunslinger still throws it away now and then', () => {
    const slingers = createLeague({ seed: 'passer-t' });
    for (const p of Object.values(slingers.players)) if (p.position === 'QB') p.quirks = { ...p.quirks, gunslinger: 3 };
    const { taps: st } = play(slingers, 40);
    const away = st.filter((t) => t.call === 'away').length;
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThan(count((t) => t.call === 'away'));
  });
});
