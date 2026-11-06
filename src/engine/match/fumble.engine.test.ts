import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { GameResult, PlayLogEntry } from '../types';
import { simulateGame, type ContactTap } from './gameSim';

const REASONS = {
  strip: /, stripped by /,
  hit: /, jarred loose by the hit/,
  fight: /, fighting for the extra yard, the ball comes out/,
  own: /, puts it on the ground/,
} as const;

const league = createLeague({ seed: 'fumble-t' });
const taps: ContactTap[] = [];
const results: GameResult[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 40))
  results.push(simulateGame(league, g, { keepPlays: true, contactTap: (t) => taps.push(t) }));
const plays: PlayLogEntry[] = results.flatMap((r) => r.plays!);
/** The plays as they stand (a flag that wiped one out leaves its text, but not its stats). */
const standing = plays.filter((e) => e.kind !== 'penalty');

describe('fumbles on contact in a game', () => {
  it('taps every tackle in bounds once: runs, catches and scrambles', () => {
    const tackled = (e: PlayLogEntry, kinds: readonly string[]) => {
      const kind = e.kind === 'penalty' ? e.ran?.kind : e.kind;
      if (!kind || !kinds.includes(kind) || e.down <= 0) return false;
      const t = e.text.split('. ')[0];
      return /\([A-Z]\.[^)]*\)/.test(t) && !/TOUCHDOWN|out of bounds|, slides|two-point/i.test(e.text);
    };
    for (const [kind, logged] of [
      ['run', ['run']],
      ['catch', ['pass']],
      ['scramble', ['scramble']],
    ] as const)
      expect(taps.filter((t) => t.kind === kind).length, kind).toBe(plays.filter((e) => tackled(e, logged)).length);
  });

  it('names each fumble’s reason in the play, before the recovery', () => {
    for (const [why, re] of Object.entries(REASONS)) {
      const logged = plays.filter(
        (e) => re.test(e.text) && /FUMBLE, recovered by|Fumble, recovered by the offense/.test(e.text),
      );
      expect(logged.length, why).toBe(taps.filter((t) => t.fumbled && t.why === why).length);
    }
    expect(taps.filter((t) => t.fumbled).length).toBeGreaterThan(10);
    for (const t of taps) if (t.fumbled) expect(t.why).toBe(t.forced ? t.why : 'own');
  });

  it('credits a forced fumble only when a defender forced it', () => {
    const credited = results.reduce(
      (n, r) => n + Object.values(r.playerStats).reduce((m, s) => m + (s.forcedFum ?? 0), 0),
      0,
    );
    const forced = standing.filter(
      (e) => REASONS.strip.test(e.text) || REASONS.hit.test(e.text) || REASONS.fight.test(e.text),
    );
    const sackStrips = standing.filter((e) => e.kind === 'sack' && /FUMBLE|Fumble/.test(e.text));
    expect(credited).toBe(forced.length + sackStrips.length);
    // Some fumbles were the carrier's own: no defender credited.
    expect(taps.some((t) => t.fumbled && t.why === 'own')).toBe(true);
  });

  it('never fumbles out of bounds', () => {
    expect(
      plays.filter((e) => /out of bounds/.test(e.text) && /FUMBLE|Fumble/.test(e.text) && e.kind !== 'sack'),
    ).toEqual([]);
  });
});
