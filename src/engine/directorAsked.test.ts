import { describe, expect, it, vi } from 'vitest';

// A fresh league has no history to feel at home with: who thinks of us as home is set by the test.
const home = new Set<number>();
vi.mock('./relationships', async (original) => ({
  ...(await original<typeof import('./relationships')>()),
  clubFeeling: (_l: unknown, p: { id: number }) => (home.has(p.id) ? 'home' : null),
  rapport: () => null,
}));

const { createLeague } = await import('./generate');
const { adviceFor, adviceNeeds, askedAboutUs } = await import('./directorAdvice');
const { deliverMail, editionIds, newEdition } = await import('./inbox');
const { perceive } = await import('./scouting');
type League = import('./types').League;
type Player = import('./types').Player;

/** Free agency's first day, with `n` of the league's veterans at our top need let go. */
function market(n: number): { l: League; free: Player[] } {
  home.clear();
  const l = createLeague({ seed: 'director-asked' });
  l.phase = 'freeAgency';
  l.faDay = 1;
  const pos = adviceNeeds(l)[0].position;
  const free = Object.values(l.players)
    .filter((p) => p.position === pos && p.teamId !== null && p.teamId !== l.userTeamId && p.experience > 0)
    .slice(0, n);
  for (const p of free) {
    p.teamId = null;
    p.contract = null;
    l.knowledge[p.id] = 1;
  }
  return { l, free };
}

describe('free agents who asked about us', () => {
  it('are two of each kind at most, our best read first, one sentence each', () => {
    const { l, free } = market(5);
    for (const p of free) home.add(p.id);
    const asked = askedAboutUs(l);
    const best = [...free]
      .sort((a, b) => perceive(l, l.userTeamId, b).ovr - perceive(l, l.userTeamId, a).ovr || a.id - b.id)
      .slice(0, 2)
      .map((p) => p.id);
    expect([...asked.keys()]).toEqual(best);
    for (const why of asked.values())
      expect(why).toBe('His agent says he still thinks of us as home and would rather sign here than anywhere.');
  });

  it("ride in the director's free-agency letter, not a letter each", () => {
    const { l, free } = market(3);
    for (const p of free) home.add(p.id);
    // No room: nobody fits, and the letter still comes for the players who asked.
    const a = adviceFor(l, -1)!;
    const rows = a.rows.filter((r) => r.kind === 'asked');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.price).toMatch(/^asking about \$[\d.]+M a year$/);
    expect(a.subject).toBe('Free agency: two asked about us');
    expect(a.body).toContain('Nobody fits our needs and our cap. Two players have asked about joining us.');
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => /^(home|rapport):/.test(m.id))).toEqual([]);
    // Filed with our real cap room, so fits may come first: the players who asked are the same.
    const filed = (l.inbox ?? []).find((m) => m.id === `advice:${l.season}:fa`)!;
    expect(filed.advice!.rows.filter((r) => r.kind === 'asked')).toEqual(rows);
  });

  it('add their sentence to a fit we already name instead of a second row', () => {
    const { l, free } = market(6);
    const fits = adviceFor(l, 1e9)!.rows.filter((r) => r.kind === 'sign');
    expect(fits.length).toBeGreaterThan(0);
    const fit = fits[0].playerId;
    home.add(fit);
    const a = adviceFor(l, 1e9)!;
    expect(a.rows.filter((r) => r.playerId === fit)).toHaveLength(1);
    expect(a.rows.find((r) => r.playerId === fit)!.why).toMatch(/He.* His agent says he still thinks of us as home/);
    expect(a.body).not.toContain('asked about joining us');
    expect(free.length).toBe(6);
  });
});

describe('the edition a step filed', () => {
  it('is the newest SNN edition not on file before', () => {
    const { l } = market(0);
    l.inbox = [];
    const before = editionIds(l);
    expect(newEdition(l, before)).toBeUndefined();
    const edition = (id: string) => ({
      id,
      season: l.season,
      phase: 'regular' as const,
      week: 1,
      from: 'SNN',
      category: 'league' as const,
      subject: id,
      body: '',
      read: false,
      actions: [],
      edition: {} as never,
    });
    l.inbox.push(edition('snn:a'), { ...edition('letter'), edition: undefined }, edition('snn:b'));
    expect(newEdition(l, before)).toBe('snn:b');
    expect(newEdition(l, editionIds(l))).toBeUndefined();
  });
});
