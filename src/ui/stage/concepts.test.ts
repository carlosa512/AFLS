import { describe, expect, it } from 'vitest';
import { Rng } from '../../engine/rng';
import type { OffSchemeId } from '../../engine/schemes';
import { assign, conceptFor, decoyEnd, type ConceptId } from './concepts';
import { ROUTES, type RouteId, type Spot } from './routes';

const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];
const SPOTS: Spot[] = ['WIDE', 'SLOT', 'TE', 'RB'];

describe('concepts', () => {
  it("always has the target's route at his spot, and calls a designed shot a shot", () => {
    const rng = new Rng('has');
    for (const spot of SPOTS)
      for (const route of ROUTE_IDS) {
        if (!ROUTES[route].spots.includes(spot)) continue;
        const c = conceptFor({ spot, route }, 'proStyle', false, rng);
        expect(c.play[spot], `${spot} ${route}`).toBe(route);
        expect(c.id).not.toBe('shot');
      }
    expect(conceptFor({ spot: 'WIDE', route: 'go' }, 'vertical', true, rng).id).toBe('shot');
  });

  it('leans each offense toward the concepts it is built on', () => {
    const share = (scheme: OffSchemeId, ids: ConceptId[]) => {
      const rng = new Rng(`lean:${scheme}`);
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const spot = SPOTS[i % 4];
        const pool = ROUTE_IDS.filter((r) => ROUTES[r].spots.includes(spot));
        if (ids.includes(conceptFor({ spot, route: pool[i % pool.length] }, scheme, false, rng).id)) n++;
      }
      return n / 4000;
    };
    expect(share('airRaid', ['mesh', 'fourVerts'])).toBeGreaterThan(share('westCoast', ['mesh', 'fourVerts']));
    expect(share('westCoast', ['slantFlat', 'curlFlat'])).toBeGreaterThan(share('airRaid', ['slantFlat', 'curlFlat']));
  });

  it('spreads a pattern out: no two routes end within two yards of each other', () => {
    // A three-receiver set at the 30, attacking up the field: wide out each side, a slot and a tight end on the
    // right, the back behind. Every concept, with the target at each spot on the right.
    const ball = { x: 30, y: 26.65 };
    const men = [
      { id: 1, spot: 'WIDE' as Spot, at: { x: 29, y: 46.65 } },
      { id: 2, spot: 'SLOT' as Spot, at: { x: 29, y: 36.65 } },
      { id: 3, spot: 'TE' as Spot, at: { x: 29.2, y: 32.65 } },
      { id: 4, spot: 'RB' as Spot, at: { x: 23.5, y: 25.15 } },
      { id: 5, spot: 'WIDE' as Spot, at: { x: 29, y: 6.65 } },
    ];
    const rng = new Rng('spread');
    let checked = 0;
    for (const target of men.slice(0, 3))
      for (const route of ROUTE_IDS) {
        if (!ROUTES[route].spots.includes(target.spot) || route === 'screen') continue;
        const c = conceptFor({ spot: target.spot, route }, undefined, false, rng);
        const others = men.filter((m) => m !== target);
        const jobs = assign(
          c,
          others.map((m) => ({ id: m.id, spot: m.spot, playSide: m.at.y > ball.y })),
        );
        const ends = [target, ...others].flatMap((m) => {
          const job = m === target ? route : jobs.get(m.id);
          if (!job || job === 'block') return [];
          const inward = (Math.sign(ball.y - m.at.y) || 1) as 1 | -1;
          return [decoyEnd(job, m.at, ball.x, 1, inward)];
        });
        for (let i = 0; i < ends.length; i++)
          for (let j = i + 1; j < ends.length; j++)
            expect(
              Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y),
              `${c.id} ${target.spot} ${route}`,
            ).toBeGreaterThan(2);
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });
});
