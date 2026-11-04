import { describe, expect, it } from 'vitest';
import { CONTESTS, relevantAttributes } from '../attributes';
import { createLeague } from '../generate';
import { OVR_WEIGHTS } from '../positions';
import type { Attribute, Player, Position } from '../types';
import { POSITIONS } from '../types';
import { FIELD_HABITS } from './habits';
import { FIELD_CONTESTS, fieldJobs, fieldSkills } from './skills';

const league = createLeague({ seed: 'field-skills' });
const players = Object.values(league.players);
const at = (pos: Position) => players.find((p) => p.position === pos)!;
const none = () => [];

describe('the field reads players through contests', () => {
  it('reads every man through contests, on the 1–20 scale', () => {
    const p = structuredClone(at('RB'));
    for (const a of Object.keys(p.ratings) as Attribute[]) p.ratings[a] = 13;
    const s = fieldSkills(p, none);
    for (const k of ['speed', 'burst', 'reads', 'pursuit', 'tackle', 'shed', 'block', 'move', 'ret', 'power'] as const)
      expect(s[k], k).toBeCloseTo(13, 6);
  });

  it("takes the shed from the front's run defense, the second level's run fit, and tackling elsewhere", () => {
    const shaped = (pos: Position): Player => {
      const p = structuredClone(at(pos));
      for (const a of Object.keys(p.ratings) as Attribute[]) p.ratings[a] = 10;
      p.ratings.runStop = 20;
      return p;
    };
    // runDefense and runFit weigh runStop; tackling doesn't.
    expect(fieldSkills(shaped('DT'), none).shed).toBeGreaterThan(12);
    expect(fieldSkills(shaped('EDGE'), none).shed).toBeGreaterThan(12);
    expect(fieldSkills(shaped('LB'), none).shed).toBeGreaterThan(12);
    expect(fieldSkills(shaped('S'), none).shed).toBeGreaterThan(12);
    expect(fieldSkills(shaped('CB'), none).shed).toBeCloseTo(10, 6);
    expect(fieldSkills(shaped('WR'), none).shed).toBeCloseTo(10, 6);
  });

  it('rounds to hundredths, so a snapshot replays exactly', () => {
    for (const p of players.slice(0, 200)) {
      const s = fieldSkills(p, none);
      for (const v of Object.values(s)) if (typeof v === 'number') expect(Math.round(v * 100) / 100).toBe(v);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }
  });

  it('carries his field habits, sorted, and nothing else', () => {
    const p = at('RB');
    const s = fieldSkills(p, () => ['thumper', 'jumpCutter', 'gunslinger']);
    expect(s.habits).toEqual(['jumpCutter', 'thumper']);
    expect(fieldSkills(p, none).habits).toBeUndefined();
    expect([...FIELD_HABITS]).toHaveLength(19);
  });

  it("leaves every position's relevant attributes as they were", () => {
    const without = (pos: Position) => {
      const weights = OVR_WEIGHTS[pos];
      const weighted = (Object.keys(weights) as Attribute[]).sort((a, b) => weights[b]! - weights[a]!);
      const read = (Object.keys(players[0].ratings) as Attribute[]).filter(
        (a) =>
          !weights[a] &&
          Object.entries(CONTESTS).some(
            ([name, c]) =>
              name !== 'burst' &&
              name !== 'reads' &&
              (c.positions as readonly Position[]).includes(pos) &&
              ((c.weights as Partial<Record<Attribute, number>>)[a] ?? 0) > 0,
          ),
      );
      return [...weighted, ...read];
    };
    for (const pos of POSITIONS) expect(new Set(relevantAttributes(pos)), pos).toEqual(new Set(without(pos)));
  });

  it("finds the field's main jobs", () => {
    expect(fieldJobs('RB')).toEqual(expect.arrayContaining(['speed', 'elusiveness']));
    expect(fieldJobs('CB')).toEqual(expect.arrayContaining(['tackling', 'speed']));
    expect(fieldJobs('OL')).toEqual(expect.arrayContaining(['runBlock']));
    for (const pos of POSITIONS) expect(fieldJobs(pos)).not.toContain('throwAccShort');
    expect(FIELD_CONTESTS).toHaveLength(11);
  });
});
