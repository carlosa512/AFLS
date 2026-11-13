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
    const hc = structuredClone(base({ teamId: null, career: [], role: 'headCoach' }));
    for (const t of traits) setTrait(hc, t, 10);
    setTrait(hc, 'ambition', 18);
    // Out of work: a bigger job than his last. At a small team: always looking. At a big market: has it, wants more.
    expect(coachOverview(league, hc).join(' ')).toContain('a head coach who wants a bigger job than his last one');
    const small = league.teams.find((t) => t.staffBudgetMult < 1.08)!;
    const big = league.teams.find((t) => t.staffBudgetMult >= 1.08)!;
    expect(coachOverview(league, { ...hc, teamId: small.id }).join(' ')).toContain(
      'a head coach who is always looking for a bigger job',
    );
    expect(coachOverview(league, { ...hc, teamId: big.id }).join(' ')).toContain(
      'a head coach who already has one of the league’s biggest jobs and still wants more',
    );
    // Titles make a big job too, as the save goes on: two championships and a small market reads like a big one.
    const storied = structuredClone(league);
    const champ = storied.teams.find((t) => t.staffBudgetMult < 1.08)!;
    storied.history = [
      ...storied.history,
      { season: 2020, championId: champ.id } as (typeof storied.history)[number],
      { season: 2021, championId: champ.id } as (typeof storied.history)[number],
    ];
    expect(coachOverview(storied, { ...hc, teamId: champ.id }).join(' ')).toContain('one of the league’s biggest jobs');
    expect(coachOverview(league, { ...hc, teamId: champ.id }).join(' ')).toContain('always looking for a bigger job');
    const asst = structuredClone(base({ teamId: null, career: [], role: 'offCoord' }));
    for (const t of traits) setTrait(asst, t, 10);
    setTrait(asst, 'ambition', 18);
    expect(coachOverview(league, asst).join(' ')).toMatch(/a coach who wants to run his own team\./);
  });

  it('tells a promotion during a season as until his promotion', () => {
    const c = base({
      teamId: 4,
      role: 'defCoord',
      since: 2026,
      career: [
        { season: 2026, teamId: 4, role: 'positionCoach', room: 'DL', record: svc(9, 8) },
        { season: 2027, teamId: 4, role: 'positionCoach', room: 'DL', record: svc(3, 4) },
        { season: 2027, teamId: 4, role: 'defCoord', record: svc(4, 6) },
      ],
    } as Partial<Coach>);
    expect(coachOverview(league, c).join(' ')).toContain('there from 2026 until his promotion in 2027.');
  });

  it('dates a promotion on the same team from the promotion, and says there', () => {
    const c = base({
      teamId: 4,
      role: 'defCoord',
      since: 2026,
      career: [
        { season: 2026, teamId: 4, role: 'positionCoach', room: 'DL', record: svc(9, 8) },
        { season: 2027, teamId: 4, role: 'positionCoach', room: 'DL', record: svc(7, 10) },
        { season: 2028, teamId: 4, role: 'defCoord', record: svc(10, 7) },
      ],
    } as Partial<Coach>);
    const text = coachOverview(league, c).join(' ');
    expect(text).toContain('since 2028');
    expect(text).toMatch(/Before that he was [a-z ]+ there from 2026 to 2027\./);
  });
});
