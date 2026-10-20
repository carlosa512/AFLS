import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTESTS, contestsFor, relevantAttributes, skill, type Contest, type ContestName } from './attributes';
import { createLeague } from './generate';
import { OVR_WEIGHTS } from './positions';
import type { Attribute } from './types';
import { POSITIONS } from './types';

describe('attribute registry', () => {
  it('gives every attribute an overall counts an engine contest at that position', () => {
    // "No engine hook, no attribute": the overall must never weigh something play ignores.
    for (const pos of POSITIONS) {
      for (const attr of Object.keys(OVR_WEIGHTS[pos]) as Attribute[]) {
        expect(contestsFor(attr, pos), `${pos} ${attr}`).not.toHaveLength(0);
      }
    }
  });

  it('keeps every contest on the 1–20 scale', () => {
    for (const [name, c] of Object.entries(CONTESTS) as [ContestName, Contest][]) {
      const total = Object.values(c.weights).reduce((a, b) => a + b!, 0);
      expect(total, name).toBeCloseTo(1, 6);
    }
    const p = Object.values(createLeague({ seed: 'registry' }).players)[0];
    for (const attr of Object.keys(p.ratings) as Attribute[]) p.ratings[attr] = 13;
    for (const name of Object.keys(CONTESTS) as ContestName[]) expect(skill(p, name)).toBeCloseTo(13, 6);
  });

  it('declares only contests the match engine actually reads', () => {
    const src = ['match/gameSim.ts', 'match/lineup.ts']
      .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
      .join('\n');
    for (const name of Object.keys(CONTESTS)) expect(src, name).toContain(`'${name}'`);
  });

  it('lists position attributes first, heaviest first', () => {
    expect(relevantAttributes('QB').slice(0, 3)).toEqual(['throwAccShort', 'awareness', 'throwAccDeep']);
    expect(relevantAttributes('K')).toEqual(['kickAccuracy', 'kickPower']);
    expect(relevantAttributes('OL')).not.toContain('catching');
  });
});
