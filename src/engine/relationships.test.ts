import { beforeAll, describe, expect, it } from 'vitest';
import { releasePlayer } from './finance/cap';
import { createLeague } from './generate';
import { signPlayer } from './offseason/negotiation';
import { askOffer, demand } from './offseason/negotiation';
import {
  addTie,
  clubFeeling,
  coachedBy,
  contractLean,
  relationshipMarbles,
  endFeudsOutsideRoom,
  feudOdds,
  MAX_TIES,
  noteDeparture,
  rapport,
  snubCheck,
  speaksOut,
  tiesOffseason,
} from './relationships';
import { endPair } from './mentoring';
import { QUIRKS, QUIRKS_FOR } from './quirks';
import { simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { seasonRole } from './scouting';
import { teamCoaches } from './coaching';
import { activeRoster, starters } from './roster';
import type { League, Player } from './types';

const fresh = (seed = 'relationships') => createLeague({ seed });
const roomOf = (l: League, teamId: number, p: Player) =>
  activeRoster(l, teamId).filter((x) => x.position === p.position && x.id !== p.id);

describe('how a player left', () => {
  it('records a release as a cut, once per club per season, newest three kept', () => {
    const l = fresh();
    const p = activeRoster(l, 5).find((x) => x.contract && !x.squad)!;
    releasePlayer(l, p);
    expect(p.left).toEqual([{ teamId: 5, season: l.season, how: 'cut' }]);
    noteDeparture(l, p, 5, 'cut');
    expect(p.left).toHaveLength(1);
    noteDeparture(l, p, 6, 'traded');
    noteDeparture(l, p, 7, 'walked');
    l.season++;
    noteDeparture(l, p, 8, 'cut');
    expect(p.left!.map((d) => d.teamId)).toEqual([6, 7, 8]);
  });

  it('records a free agent who signs elsewhere as having walked from his last club', () => {
    const l = fresh();
    const p = activeRoster(l, 4).find((x) => x.contract && !x.squad)!;
    p.statTeams = { [l.season - 1]: [4] };
    p.teamId = null;
    p.contract = null;
    signPlayer(l, p, 9, askOffer(demand(l, p, 9)));
    expect(p.left).toEqual([{ teamId: 4, season: l.season, how: 'walked' }]);
  });

  it('ends a feud the moment either man leaves the room, and it stays ended', () => {
    const l = fresh();
    const p = activeRoster(l, 2).find((x) => x.position === 'CB')!;
    const q = roomOf(l, 2, p)[0];
    addTie(l, p, q, 'feud');
    expect(p.ties).toHaveLength(1);
    noteDeparture(l, p, 2, 'traded');
    expect(p.ties ?? []).toHaveLength(0);
    expect(q.ties ?? []).toHaveLength(0);
    addTie(l, p, q, 'feud');
    p.position = 'S';
    endFeudsOutsideRoom(l, p);
    expect(q.ties ?? []).toHaveLength(0);
  });
});

describe('rapport, homecomings and grudges, read off history', () => {
  let l: League;
  beforeAll(() => {
    l = fresh('rapport');
    for (let i = 0; i < 2; i++) {
      simToEndOfSeason(l);
      beginOffseason(l);
      while (l.phase !== 'regular') advanceOffseason(l, { autoUser: true });
    }
  }, 240_000);

  /**
   * A player who started both seasons on one club and is still there with no departures behind him (the tests write
   * his `left` themselves, and the caches key on how many he has), under the head coach there both seasons, still in
   * the chair.
   */
  const twoYearStarter = () => {
    const [a, b] = [l.season - 2, l.season - 1];
    for (const p of Object.values(l.players)) {
      const t = p.statTeams?.[a]?.at(-1);
      if (t === undefined || p.statTeams?.[b]?.at(-1) !== t || p.teamId !== t || p.left?.length) continue;
      if (seasonRole(l, p, a)?.role !== 'starter' || seasonRole(l, p, b)?.role !== 'starter') continue;
      const hc = Object.values(l.coaches).find(
        (c) =>
          c.role === 'headCoach' &&
          c.teamId === t &&
          [a, b].every((s) => c.career?.some((r) => r.season === s && r.teamId === t && r.role === 'headCoach')),
      );
      if (hc) return { p, hc, teamId: t };
    }
    throw new Error('no two-year starter found');
  };

  it('builds rapport over two good seasons under a coach, and not one', () => {
    const { p, hc } = twoYearStarter();
    expect(coachedBy(l, p, hc, l.season - 1)).toBe(true);
    expect(rapport(l, p, hc)).toBe('good');
    const once = { ...p, statTeams: { [l.season - 1]: p.statTeams![l.season - 1] } };
    expect(rapport(l, once, hc)).toBeNull();
  });

  it('sours on the head coach whose club cut him', () => {
    const { p, hc, teamId } = twoYearStarter();
    const cut = { ...p, left: [{ teamId, season: l.season - 1, how: 'cut' as const }] };
    expect(rapport(l, cut, hc)).toBe('sour');
  });

  it('holds a grudge three seasons against a club that cut or traded him, and feels at home where he walked from', () => {
    const { p, teamId } = twoYearStarter();
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season - 2, how: 'traded' }] }, teamId)).toBe('grudge');
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season - 4, how: 'cut' }] }, teamId)).toBeNull();
    expect(clubFeeling(l, { ...p, left: [{ teamId, season: l.season, how: 'walked' }] }, teamId)).toBe('home');
    expect(clubFeeling(l, p, (teamId + 1) % 32)).toBeNull();
  });

  it('nudges the price: grudges dearer, home and friends cheaper, a Mercenary unmoved', () => {
    const { p, teamId } = twoYearStarter();
    const other = (teamId + 5) % 32;
    expect(contractLean(l, p, other)).toEqual({ value: 1, walkAway: 1, ask: 1 });
    const grudge = { ...p, left: [{ teamId: other, season: l.season - 1, how: 'cut' as const }] };
    expect(contractLean(l, grudge, other).ask).toBeCloseTo(1.05);
    expect(contractLean(l, grudge, other).walkAway).toBeCloseTo(1.05);
    const home = { ...p, left: [{ teamId, season: l.season, how: 'walked' as const }], teamId: null };
    expect(contractLean(l, home, teamId).walkAway).toBeLessThan(1);
    const friend = activeRoster(l, other)[0];
    const pal = { ...p, ties: [{ kind: 'friend' as const, with: friend.id, since: l.season }] };
    expect(contractLean(l, pal, other).value).toBeGreaterThan(1);
    // Personality never changes in play, and the price is cached on that: another man, not the same one remade.
    const merc = { ...pal, id: pal.id + 1_000_000, personality: { ...p.personality, greed: 0.95, loyalty: 0.2 } };
    expect(contractLean(l, merc, other)).toEqual({ value: 1, walkAway: 1, ask: 1 });
  });

  it('keeps a lean through free agency, but reads it again when his friend signs somewhere', () => {
    const { p, teamId } = twoYearStarter();
    const other = (teamId + 7) % 32;
    const friend = activeRoster(l, other)[0];
    const pal = {
      ...p,
      id: p.id + 3_000_000,
      teamId: null,
      ties: [{ kind: 'friend' as const, with: friend.id, since: l.season }],
    };
    const was = { phase: l.phase, faDay: l.faDay, team: friend.teamId };
    l.phase = 'freeAgency';
    l.faDay = 1;
    expect(contractLean(l, pal, other).value).toBeGreaterThan(1);
    // A day later his friend has signed with another club: the pull goes with him.
    l.faDay = 2;
    friend.teamId = (other + 1) % 32;
    expect(contractLean(l, pal, other).value).toBe(1);
    expect(contractLean(l, pal, friend.teamId).value).toBeGreaterThan(1);
    Object.assign(l, { phase: was.phase, faDay: was.faDay });
    friend.teamId = was.team;
  });

  it('draws a man to an old coach at another club, never to the coaches he already has', () => {
    const { p, teamId } = twoYearStarter();
    const home = { ...p, id: p.id + 2_000_000, teamId };
    expect(contractLean(l, home, teamId).value).toBe(1);
  });

  it('puts fix marbles in the bag for rapport and temper marbles for a feud', () => {
    const { p, hc } = twoYearStarter();
    expect(rapport(l, p, hc)).toBe('good');
    const bad = (Object.keys(QUIRKS) as (keyof typeof QUIRKS)[]).find(
      (id) => QUIRKS[id].tone === 'bad' && QUIRKS_FOR[p.position].includes(id),
    )!;
    const x = structuredClone(p);
    x.quirks = { [bad]: 1 };
    x.quirkBag = { blank: 10, [`fix:${bad}`]: 5 };
    relationshipMarbles(l, x);
    expect(x.quirkBag[`fix:${bad}`]).toBeGreaterThan(5);
  });

  it('never counts a coach who was on another club', () => {
    const { p, teamId } = twoYearStarter();
    const other = teamCoaches(l, (teamId + 1) % 32).find((c) => c.role === 'headCoach')!;
    expect(rapport(l, p, other)).toBeNull();
  });
});

describe('friendships and feuds', () => {
  const room = (l: League, teamId: number, pos: Player['position']) =>
    activeRoster(l, teamId).filter((x) => x.position === pos);

  it('keeps feuds inside the room and ends them at the new league year when one has left it', () => {
    const l = fresh('feuds-room');
    const [a, b] = room(l, 1, 'WR');
    addTie(l, a, b, 'feud');
    b.teamId = 2;
    l.season++;
    tiesOffseason(l);
    expect(a.ties?.some((t) => t.with === b.id) ?? false).toBe(false);
  });

  it('is likelier between two who stir it up, and rarer with leaders in the room', () => {
    const l = fresh('feuds-odds');
    const r = room(l, 1, 'CB');
    const [a, b] = r;
    const base = feudOdds(l, a, b, r);
    const hot = feudOdds(
      l,
      { ...a, traits: { ...a.traits, controversy: 18, temperament: 4 } },
      { ...b, traits: { ...b.traits, controversy: 17, temperament: 5 } },
      r,
    );
    expect(hot).toBeGreaterThan(base * 3);
    const led = r.map((x) => ({ ...x, traits: { ...x.traits, leads: 19 } }));
    expect(feudOdds(l, a, b, led)).toBeLessThan(base);
  });

  it(`caps a player at ${MAX_TIES} ties, and a feud replaces a friendship`, () => {
    const l = fresh('feuds-cap');
    const r = room(l, 1, 'OL');
    const [a, ...others] = r;
    for (const o of others.slice(0, 4)) addTie(l, a, o, 'friend');
    expect(a.ties).toHaveLength(MAX_TIES);
    addTie(l, a, others[0], 'feud');
    expect(a.ties!.find((t) => t.with === others[0].id)?.kind).toBe('feud');
    expect(a.ties).toHaveLength(MAX_TIES);
  });

  it('starts a snub feud, with a temper marble for each, when a roommate gets paid over a starter', () => {
    const l = fresh('feuds-snub');
    const team = l.teams[1];
    const b = starters(l, team, 'EDGE')[0];
    const a = room(l, 1, 'EDGE').find((x) => x.id !== b.id && x.contract)!;
    const tempers = QUIRKS_FOR.EDGE.filter((id) => (QUIRKS[id] as { temper?: boolean }).temper);
    const marbles = (p: Player) => tempers.reduce((n, id) => n + ((p.quirkBag ?? {})[id] ?? 0), 0);
    const [ma, mb] = [marbles(a), marbles(b)];
    a.contract!.apy = b.contract!.apy + 1000;
    b.contract!.signedSeason = l.season - 2;
    a.traits = { ...a.traits, controversy: 20, temperament: 1 };
    b.traits = { ...b.traits, controversy: 20, temperament: 1 };
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      l.season += 1;
      a.contract!.signedSeason = l.season;
      snubCheck(l, a);
      started = !!b.ties?.some((t) => t.with === a.id && t.kind === 'feud' && t.why === 'snubbed');
    }
    expect(started).toBe(true);
    expect(marbles(a)).toBeGreaterThan(ma);
    expect(marbles(b)).toBeGreaterThan(mb);
  });

  it('turns some mentoring pairs of two seasons or more into friendships, and never a shorter one', () => {
    const l = fresh('feuds-mentor');
    const lbs = room(l, 1, 'LB');
    const vet = lbs[0];
    let friends = 0;
    let n = 0;
    for (const kid of [...room(l, 1, 'CB'), ...room(l, 1, 'S'), ...room(l, 1, 'WR'), ...room(l, 1, 'OL')]) {
      kid.mentor = vet.id;
      kid.mentorWeeks = 5;
      kid.mentoredBy = [{ id: vet.id, from: l.season - 1, to: l.season - 1 }];
      delete kid.ties;
      delete vet.ties;
      endPair(l, kid);
      n++;
      const ties = (kid as Player).ties as Player['ties'];
      if (ties?.some((t) => t.with === vet.id && t.kind === 'friend')) friends++;
    }
    expect(friends).toBeGreaterThan(0);
    expect(friends).toBeLessThan(n);
    const short = lbs[1];
    short.mentor = vet.id;
    short.mentorWeeks = 5;
    delete short.mentoredBy;
    delete vet.ties;
    endPair(l, short);
    expect(short.ties ?? []).toHaveLength(0);
  });
});

describe('speaking out', () => {
  it('is for the outspoken only, and the same answer every time', () => {
    const l = fresh('speak');
    const [a] = activeRoster(l, 1);
    const quiet = { ...a, traits: { ...a.traits, controversy: 9 } };
    expect(speaksOut(l, quiet, l.season, 'traded')).toBe(false);
    const loud = { ...a, traits: { ...a.traits, controversy: 20 } };
    const first = speaksOut(l, loud, l.season, 'traded');
    expect(speaksOut(l, loud, l.season, 'traded')).toBe(first);
    let any = false;
    for (let s = 0; s < 20; s++) any ||= speaksOut(l, loud, l.season + s, 'cut');
    expect(any).toBe(true);
  });

  it('lets a retired man keep his mentor on his card and drop the rest', () => {
    const l = fresh('retire-trim');
    const [vet, kid] = activeRoster(l, 1).filter((x) => x.position === 'LB');
    vet.age = 45; // he retires at the new league year
    vet.left = [{ teamId: 3, season: l.season - 1, how: 'cut' }];
    vet.shifts = { workEthic: 0.5 };
    vet.mentoredBy = [{ id: kid.id, from: l.season - 2, to: l.season - 1 }];
    addTie(l, vet, kid, 'friend');
    l.phase = 'complete';
    beginOffseason(l);
    expect(vet.retired).toBe(true);
    expect(vet.left).toBeUndefined();
    expect(vet.shifts).toBeUndefined();
    expect(vet.ties).toBeUndefined();
    expect(vet.mentoredBy).toHaveLength(1);
  });
});
