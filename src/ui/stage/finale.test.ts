import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { playWeek } from '../../engine/league';
import type { PlayLogEntry } from '../../engine/types';
import { finaleBanner, finaleKind, finaleScene } from './finale';
import { FIELD_W } from './ballPath';
import type { Mark } from './transition';

const play = (o: Partial<PlayLogEntry>): PlayLogEntry => ({
  quarter: 4,
  clock: 600,
  offense: 1,
  down: 1,
  distance: 10,
  yardLine: 50,
  text: '',
  homeScore: 0,
  awayScore: 0,
  ...o,
});

describe('the final whistle', () => {
  it('tells a game won on its last play from one closed out, and a tie', () => {
    const before = play({ homeScore: 25, awayScore: 26, clock: 31 });
    expect(finaleKind([before, play({ kind: 'fg', homeScore: 28, awayScore: 26, clock: 2 })], 1)).toBe('walkoff');
    // In overtime too.
    expect(
      finaleKind(
        [play({ homeScore: 16, awayScore: 16 }), play({ kind: 'fg', quarter: 5, homeScore: 19, awayScore: 16 })],
        1,
      ),
    ).toBe('walkoff');
    // Ahead already, kneeling it out.
    expect(
      finaleKind(
        [play({ homeScore: 19, awayScore: 13 }), play({ kind: 'kneel', homeScore: 19, awayScore: 13, clock: 29 })],
        1,
      ),
    ).toBe('win');
    // A go-ahead score with minutes left isn't a walk-off.
    expect(finaleKind([before, play({ kind: 'fg', homeScore: 28, awayScore: 26, clock: 200 })], 1)).toBe('win');
    expect(finaleKind([play({}), play({ homeScore: 20, awayScore: 20, quarter: 5 })], 1)).toBe('tie');
  });

  it('finds the walk-offs in a week of games', () => {
    const league = createLeague({ seed: 'look' });
    playWeek(league);
    const kinds = league.games
      .filter((g) => g.result?.plays?.length)
      .map((g) => finaleKind(g.result!.plays!, g.result!.plays!.length - 1));
    expect(kinds).toContain('walkoff');
    expect(kinds).toContain('win');
  });

  const mark = (x: number, y: number, home = true): Mark => ({ x, y, home });
  const spots = new Map<number, Mark>(
    Array.from({ length: 22 }, (_, i) => [i, mark(70 + (i % 6) * 2, 12 + (i % 11) * 3, i < 11)]),
  );
  const sideline = Array.from({ length: 12 }, (_, i) => 100 + i);

  it('on a walk-off, the winners mob the hero and the losers walk off', () => {
    const scene = finaleScene({
      kind: 'walkoff',
      spots,
      winnersHome: true,
      at: { x: 72, y: 20 },
      hero: 3,
      sideline,
      playoff: false,
      title: false,
      colors: ['#123456', '#abcdef'],
      seed: 'w',
    });
    const hero = spots.get(3)!;
    for (const id of [...spots.keys()].filter((id) => id < 11).concat(sideline)) {
      const f = scene.at(id, scene.duration)!;
      expect(Math.hypot(f.x - hero.x, f.y - hero.y), `${id}`).toBeLessThan(7);
    }
    for (const id of [...spots.keys()].filter((id) => id >= 11)) {
      const f = scene.at(id, scene.duration)!;
      expect(f.opacity, `${id}`).toBe(0);
    }
    // They jump for joy; nobody blurs across the field.
    expect([...spots.keys()].some((id) => scene.at(id, scene.duration - 0.3)!.scale > 1)).toBe(true);
    for (const id of [...spots.keys(), ...sideline]) {
      let prev = scene.at(id, 0)!;
      for (let t = 0.05; t <= scene.duration; t += 0.05) {
        const f = scene.at(id, t)!;
        if (f.opacity > 0.05 && prev.opacity > 0.05) expect(Math.hypot(f.x - prev.x, f.y - prev.y)).toBeLessThan(0.55);
        prev = f;
      }
    }
    expect(scene.confetti(3)).toHaveLength(0);
  });

  it('a title game ends in confetti, in the winners colors, coming down onto the field', () => {
    const scene = finaleScene({
      kind: 'win',
      spots,
      winnersHome: false,
      at: { x: 50, y: 26 },
      sideline,
      playoff: true,
      title: true,
      colors: ['#123456', '#abcdef'],
      seed: 't',
    });
    const late = scene.confetti(scene.duration);
    expect(late.length).toBeGreaterThan(100);
    expect(late.every((c) => c.y >= -1 && c.y <= FIELD_W + 1)).toBe(true);
    expect(late.filter((c) => c.h === 0).length).toBeGreaterThan(50);
    expect(
      finaleBanner({ kind: 'win', winner: 'MIA', score: 'CAR 13 – MIA 19', playoff: true, title: true }),
    ).toContain('champions');
  });
});
