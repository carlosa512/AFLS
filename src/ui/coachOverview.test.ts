import { describe, expect, it } from 'vitest';
import { createLeague } from '../engine/generate';
import type { Coach, CoachSeason, League } from '../engine/types';
import { setTrait } from '../engine/coachTraits';
import { coachOverview } from './coachOverview';

const league = createLeague({ seed: 'overview' });
const full = (l: League, t: number) => `${l.teams[t].city} ${l.teams[t].name}`;
const base = (over: Partial<Coach>): Coach => ({ ...Object.values(league.coaches)[0], ...over }) as Coach;
const svc = (w: number, l: number) => ({ regular: { w, l, t: 0 } }) as unknown as NonNullable<CoachSeason['record']>;

describe('a coach in a few plain sentences', () => {
  it('names his current job and the one before it, in order, with no semicolon or colon', () => {
    const c = base({
      teamId: 3,
      role: 'headCoach',
      since: 2027,
      career: [
        { season: 2025, teamId: 7, role: 'offCoord', record: svc(10, 7) },
        { season: 2026, teamId: 7, role: 'offCoord', record: svc(12, 5) },
        { season: 2027, teamId: 3, role: 'headCoach', record: svc(6, 11) },
      ],
    });
    const text = coachOverview(league, c).join(' ');
    const now = text.indexOf(full(league, 3));
    const before = text.indexOf(full(league, 7));
    expect(now).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(now);
    expect(text).toContain('since 2027');
    expect(text).toContain('2025 to 2026');
    expect(text).not.toMatch(/[;:]/);
  });

  it('gives two to four sentences, and tells a coach out of work in the past tense', () => {
    const c = base({
      teamId: null,
      role: 'defCoord',
      career: [{ season: 2026, teamId: 5, role: 'defCoord', record: svc(8, 9) }],
    });
    const lines = coachOverview(league, c);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(lines.join(' ')).toMatch(/was defensive coordinator of the /);
    for (const s of lines) expect(s).toMatch(/^[A-Z].*[.!?]$/);
  });

  it('turns his reputation into a sentence about him', () => {
    const lines = coachOverview(league, base({ teamId: null, career: [] }));
    expect(lines.join(' ')).toMatch(/Around the league he is (known as|seen as)/);
    expect(lines.join(' ')).not.toMatch(/[;:]/);
  });

  it('says what his label means, in the same sentence, for every label', () => {
    const roles = ['headCoach', 'offCoord'] as const;
    const traits = ['ambition', 'loyalty', 'adaptability', 'discipline'] as const;
    const seen = new Set<string>();
    for (const role of roles)
      for (const k of traits)
        for (const v of [3, 18]) {
          const c = structuredClone(base({ teamId: null, career: [], role }));
          for (const t of traits) setTrait(c, t, 10);
          setTrait(c, k, v);
          const text = coachOverview(league, c).join(' ');
          const m = /Around the league he is known as an? ([^,.]+), ([^.]+)\./.exec(text);
          expect(m, `${role} ${k} ${v}: ${text}`).not.toBeNull();
          seen.add(m![1]);
        }
    const steady = structuredClone(base({ teamId: null, career: [] }));
    for (const t of traits) setTrait(steady, t, 10);
    expect(coachOverview(league, steady).join(' ')).toMatch(/known as a steady hand, /);
    expect(seen.has('climber')).toBe(true);
  });
});
