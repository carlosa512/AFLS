import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { playWeek } from '../../engine/league';
import type { PlayLogEntry } from '../../engine/types';
import { exitFor, flagCall, foulsIn, injuryBanner, injuryCall } from './calls';
import { injuryScene } from './injury';
import type { Mark } from './transition';

const entry = (text: string, o: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 600,
  offense: 1,
  down: 1,
  distance: 10,
  yardLine: 50,
  homeScore: 0,
  awayScore: 0,
  text,
  ...o,
});

describe('the calls on the banner', () => {
  it('reads a flag: what, on whom, how far, and whether it wiped the play out', () => {
    expect(flagCall(entry('PENALTY on BUF (B.Bennett): False start, 5 yards.'))).toBe(
      'False start · BUF B.Bennett · 5 yds',
    );
    expect(
      flagCall(
        entry(
          'J.Largo rush right end for 9 yards (N.Gaoa). PENALTY on BAL (J.Murphy): Offensive holding, 10 yards. No play.',
        ),
      ),
    ).toBe('Offensive holding · BAL J.Murphy · 10 yds, no play');
    expect(flagCall(entry('K.Williams rush right end for 6 yards (C.Neal). Offside on BAL (D.Miller), declined'))).toBe(
      'Offside · BAL D.Miller · declined',
    );
    expect(
      flagCall(entry('X pass incomplete. Offsetting penalties: holding on A, holding on B. Replay the down.')),
    ).toBe('Offsetting penalties · replay the down');
    expect(flagCall(entry('J.Largo rush right end for 9 yards (N.Gaoa).'))).toBeNull();
    expect(
      flagCall(
        entry(
          'T.Berry kicks off out of bounds. PENALTY on MIA (T.Berry): Kickoff out of bounds or short. Ball at the CAR 40.',
        ),
      ),
    ).toBe('Kickoff out of bounds or short · MIA T.Berry · ball at the CAR 40');
  });

  it('names every foul on a play, who did it and when it happened', () => {
    expect(foulsIn(entry('PENALTY on BUF (B.Bennett): False start, 5 yards.'))).toEqual([
      { label: 'False start', team: 'BUF', name: 'B.Bennett', phase: 'early' },
    ]);
    expect(
      foulsIn(
        entry(
          'R.Moore pass deep left to D.Oliver incomplete. Offsetting penalties: offensive holding on JAX (K.Liufau), pass interference on NYK (T.Miles). Replay the down.',
        ),
      ),
    ).toEqual([
      { label: 'offensive holding', team: 'JAX', name: 'K.Liufau', phase: 'during' },
      { label: 'pass interference', team: 'NYK', name: 'T.Miles', phase: 'ball' },
    ]);
    expect(
      foulsIn(
        entry(
          'D.Bryant pass medium middle to N.Stevenson incomplete. Defensive holding on DET (C.Meadows), declined. PENALTY on DET (O.Okafor): Roughing the passer, 15 yards. No play.',
        ),
      ).map((f) => [f.name, f.phase]),
    ).toEqual([
      ['C.Meadows', 'during'],
      ['O.Okafor', 'afterThrow'],
    ]);
    expect(foulsIn(entry('Running into the kicker on SEA (C.Boateng), declined. D.Webb extra point is GOOD.'))).toEqual(
      [{ label: 'Running into the kicker', team: 'SEA', name: 'C.Boateng', phase: 'afterKick' }],
    );
    expect(
      foulsIn(
        entry(
          'M.Hunter rush right tackle for 6 yards (J.Gibson). PENALTY on HOU (J.Gibson): Unnecessary roughness, 3 yards.',
        ),
      )[0].phase,
    ).toBe('whistle');
    expect(foulsIn(entry('J.Largo rush right end for 9 yards (N.Gaoa).'))).toEqual([]);
  });

  it('reads every flag in a week of games', () => {
    const league = createLeague({ seed: 'calls' });
    playWeek(league);
    let flags = 0;
    for (const g of league.games)
      for (const e of g.result?.plays ?? [])
        if (/PENALTY|declined|Offsetting/.test(e.text)) {
          expect(flagCall(e), e.text).not.toBeNull();
          flags++;
        }
    expect(flags).toBeGreaterThan(50);
  });

  it('reads an injury, and sends a severe one off on the cart', () => {
    const league = createLeague({ seed: 'calls' });
    playWeek(league);
    let n = 0;
    const exits = new Set<string>();
    for (const g of league.games)
      for (const e of g.result?.plays ?? []) {
        if (!/^Injury:/.test(e.text)) continue;
        const call = injuryCall(e)!;
        expect(call, e.text).not.toBeNull();
        const hurt = g.result!.injuries!.find((i) => {
          const p = league.players[i.playerId];
          return `${p.firstName[0]}.${p.lastName}` === call.name;
        })!;
        const exit = exitFor(league, hurt.playerId, call.label, g.result!.injuries);
        exits.add(exit);
        expect(injuryBanner(call, exit)).toContain(call.name);
        n++;
      }
    expect(n).toBeGreaterThan(10);
    expect(exits.has('walk')).toBe(true);
  });
});

describe('an injury stoppage', () => {
  const mark = (x: number, y: number, home = true): Mark => ({ x, y, home });
  const spots = new Map<number, Mark>(
    Array.from({ length: 22 }, (_, i) => [i, mark(40 + (i % 6) * 1.5, 15 + (i % 11) * 2.5, i < 11)]),
  );
  for (const exit of ['walk', 'helped', 'cart'] as const) {
    const scene = injuryScene(spots, 3, exit, `s-${exit}`);
    const down = spots.get(3)!;

    it(`${exit}: the trainers reach him, and he's off the field at the end`, () => {
      const tending = scene.trainers(scene.duration / 2);
      for (const tr of tending) expect(Math.hypot(tr.x - down.x, tr.y - down.y)).toBeLessThan(3);
      const end = scene.hurt(scene.duration);
      expect(end.opacity).toBe(0);
      expect(end.y).toBeLessThan(0);
      expect(scene.after.has(3)).toBe(false);
      expect(!!scene.cart(scene.duration / 2)).toBe(exit === 'cart');
    });

    it(`${exit}: everyone else backs off him, and nobody jumps a frame`, () => {
      for (const [id, m] of scene.after) {
        const was = spots.get(id)!;
        if (Math.hypot(was.x - down.x, was.y - down.y) < 25)
          expect(Math.hypot(m.x - down.x, m.y - down.y), `${id}`).toBeGreaterThan(5);
      }
      for (const id of [...spots.keys()].filter((x) => x !== 3)) {
        let prev = scene.at(id, 0)!;
        for (let t = 0.05; t <= scene.duration; t += 0.05) {
          const p = scene.at(id, t)!;
          expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.55);
          prev = p;
        }
      }
      let prev = scene.hurt(0);
      for (let t = 0.05; t <= scene.duration; t += 0.05) {
        const p = scene.hurt(t);
        if (p.opacity > 0.05) expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.55);
        prev = p;
      }
    });
  }
});
