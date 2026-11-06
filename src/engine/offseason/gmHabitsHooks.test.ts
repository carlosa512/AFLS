import { afterEach, describe, expect, it } from 'vitest';
import { ageShift } from '../aging';
import { capFor, capSheet, releasePlayer } from '../finance/cap';
import { yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { aiGm, habitsForce } from '../gmHabits';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import { teamPlayers } from '../roster';
import { POSITIONS } from '../types';
import type { League, Player, Team } from '../types';
import { beginOffseason } from './index';
import {
  aiExtendEarly,
  aiFreeAgencyDay,
  aiOffer,
  aiResignWindow,
  applyFranchiseTag,
  cutChoice,
  expiringPlayers,
  KEEP_MIN,
  resignCall,
  youngQbClub,
} from './ai';
import { OFFSEASON_ROSTER_MAX } from './negotiation';

const base = (() => {
  const l = createLeague({ seed: 'gm-habits-hooks' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const aiTeam = (l: League): Team => l.teams.find((t) => t.id !== l.userTeamId && aiGm(l, t))!;

afterEach(() => {
  habitsForce.all = null;
  habitsForce.off = false;
  habitsForce.pos = 'QB';
});

/** A club with a 23-year-old starter at quarterback and a 32-year-old free agent a touch better, no other club with room. */
function bridgeScene(delta = 0.4) {
  const l = fresh();
  l.phase = 'freeAgency';
  const t = aiTeam(l);
  const qbs = teamPlayers(l, t.id).filter((p) => p.position === 'QB');
  const young = qbs.sort((a, b) => playerOvr(b) - playerOvr(a))[0];
  young.age = 23;
  const other = Object.values(l.players).find((p) => p.position === 'QB' && p.teamId !== null && p.teamId !== t.id)!;
  releasePlayer(l, other);
  other.age = 31 + ageShift('QB');
  other.ratings = { ...young.ratings };
  for (const k of Object.keys(other.ratings) as (keyof typeof other.ratings)[]) other.ratings[k] += delta;
  for (const c of l.teams) {
    if (c.id === t.id || c.id === l.userTeamId) continue;
    c.deadMoney.push({ season: l.season, amount: 1e9, playerId: -1, note: 'test' });
  }
  return { l, t, young, fa: other };
}

describe('Signs a Bridge QB', () => {
  it('signs a 30+ QB to one year beside his young starter and logs the young QB', () => {
    habitsForce.all = 'bridgeQb';
    const { l, t, young, fa } = bridgeScene();
    expect(youngQbClub(l, t)?.id).toBe(young.id);
    aiFreeAgencyDay(l, new Rng('bridge'), { rosterMax: OFFSEASON_ROSTER_MAX });
    expect(fa.teamId).toBe(t.id);
    expect(fa.contract!.length).toBe(1);
    expect(aiGm(l, t)!.habitLog).toContainEqual(expect.objectContaining({ habit: 'bridgeQb', playerId: young.id }));
  });
  it('does not with the habit off', () => {
    habitsForce.off = true;
    const { l, t, fa } = bridgeScene();
    aiFreeAgencyDay(l, new Rng('bridge'), { rosterMax: OFFSEASON_ROSTER_MAX });
    // Without the habit he is a plain signing (or none): never the one-year bridge deal.
    expect(fa.teamId !== t.id || fa.contract!.length > 1).toBe(true);
  });
});

describe('Gun-Shy on Big Deals', () => {
  it('pays less at that position', () => {
    const { l, t, fa } = bridgeScene();
    habitsForce.off = true;
    const a = aiOffer(l, t, fa, new Rng('x'), 2);
    habitsForce.off = false;
    habitsForce.all = 'gunShy';
    const b = aiOffer(l, t, fa, new Rng('x'), 2);
    expect(b.apy / a.apy).toBeCloseTo(0.92, 1);
  });
  it('asks a bigger upgrade at that position', () => {
    const signs = (delta: number) => {
      const { l, t, fa } = bridgeScene(delta);
      aiFreeAgencyDay(l, new Rng('bridge'), { rosterMax: OFFSEASON_ROSTER_MAX });
      return fa.teamId === t.id;
    };
    // Somewhere along the free agent's range he clears the usual bar but not 1.3 times it.
    const hit = Array.from({ length: 25 }, (_, i) => -6 + i * 0.25).filter((d) => {
      habitsForce.off = true;
      habitsForce.all = null;
      const off = signs(d);
      habitsForce.off = false;
      habitsForce.all = 'gunShy';
      return off && !signs(d);
    });
    expect(hit.length).toBeGreaterThan(0);
  });
});

describe('Brings His Guys Back', () => {
  it('keeps a draftee over an equal player', () => {
    const l = fresh();
    const t = aiTeam(l);
    const gm = aiGm(l, t)!;
    // Two equal players, one drafted in this GM's tenure.
    const pos = POSITIONS.find((q) => teamPlayers(l, t.id).filter((p) => p.position === q).length > KEEP_MIN[q] + 1)!;
    const [a, b] = teamPlayers(l, t.id).filter((p) => p.position === pos);
    for (const k of Object.keys(a.ratings) as (keyof typeof a.ratings)[]) b.ratings[k] = a.ratings[k];
    b.age = a.age = 28;
    b.contract = { ...a.contract! };
    a.draft = { season: l.season - 5, round: 6, pick: 200, teamId: t.id };
    b.draft = { season: l.season - 5, round: 6, pick: 201, teamId: t.id + 1 };
    const appt = gm.appointments.at(-1)!;
    appt.start = { ...appt.start, season: l.season - 9 };
    appt.teamId = t.id;
    delete appt.end;
    a.draft!.teamId = t.id;
    const roster = teamPlayers(l, t.id);
    const pool = [a, b];
    expect(roster.length).toBeGreaterThan(0);
    habitsForce.off = true;
    const offCut = cutChoice(l, roster, roster.length - 1, pool)[0];
    habitsForce.off = false;
    habitsForce.all = 'hisGuys';
    const onCut = cutChoice(l, roster, roster.length - 1, pool)[0];
    expect(onCut.id).toBe(b.id);
    expect(offCut.id === a.id || offCut.id === b.id).toBe(true);
  });
});

describe('the blowup at release', () => {
  it('forms Gun-Shy at the position', () => {
    const l = fresh();
    const t = aiTeam(l);
    const gm = aiGm(l, t)!;
    const p: Player = teamPlayers(l, t.id).find((x) => x.position === 'QB')!;
    const appt = gm.appointments.at(-1)!;
    appt.start = { ...appt.start, season: l.season - 1 };
    p.contract!.signedSeason = l.season;
    p.contract!.signedWeek = 0;
    // A deal so big that cutting it leaves a real slice of the cap on the books.
    p.contract!.bonuses.push({ amount: l.caps[l.season] * 0.2, start: l.season, years: 4, source: 'signing' });
    releasePlayer(l, p);
    expect(gm.habits?.gunShy?.pos).toBe('QB');
  });
});

/** Cut a veteran's deal to two years left, leaving his pay as it was. */
function twoYears(l: League, p: Player) {
  const c = p.contract!;
  c.years = c.years.filter((y) => y.season <= l.season + 1);
  c.kind = 'veteran';
  p.experience = Math.max(p.experience, 5);
  expect(yearsLeft(c, l.season)).toBe(2);
}

/** Starters the club would keep, each a candidate for an early deal. */
function extendScene() {
  const l = fresh();
  l.phase = 'resign';
  const t = aiTeam(l);
  const starters = teamPlayers(l, t.id)
    .filter((p) => p.contract && yearsLeft(p.contract, l.season) >= 2 && p.age <= 29)
    .sort((a, b) => playerOvr(b) - playerOvr(a))
    .filter(
      (p) => (twoYears(l, p), resignCall(l, t.id, p).reason === 'starter' && resignCall(l, t.id, p).call !== 'walk'),
    );
  return { l, t, starters };
}

describe('Extends Early', () => {
  it('extends a two-years-left starter; at most two per window; logs each', () => {
    habitsForce.all = 'extendEarly';
    const { l, t, starters } = extendScene();
    expect(starters.length).toBeGreaterThan(2);
    const before = starters.map((p) => p.contract);
    aiResignWindow(l, t, new Rng('w'));
    const changed = starters.filter((p, i) => p.contract !== before[i] && p.contract!.signedSeason === l.season);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(2);
    const log = aiGm(l, t)!.habitLog!.filter((m) => m.habit === 'extendEarly');
    expect(log.length).toBeGreaterThan(0);
    expect(log.length).toBeLessThanOrEqual(2);
    for (const m of log) expect(yearsLeft(l.players[m.playerId!].contract!, l.season)).toBeGreaterThan(2);
  });
  it('does nothing with the habit off', () => {
    habitsForce.off = true;
    const { l, t, starters } = extendScene();
    const before = starters.map((p) => p.contract);
    aiResignWindow(l, t, new Rng('w'));
    expect(starters.every((p, i) => p.contract === before[i])).toBe(true);
  });
  it('not a rookie in year two', () => {
    habitsForce.all = 'extendEarly';
    const { l, t, starters } = extendScene();
    const p = starters[0];
    p.contract!.kind = 'rookie';
    p.experience = 1;
    expect(aiExtendEarly(l, t, p)).toBe(false);
  });
  it('nothing extends when next year’s cap is already full', () => {
    habitsForce.all = 'extendEarly';
    const { l, t, starters } = extendScene();
    t.deadMoney.push({ season: l.season + 1, amount: capFor(l, l.season + 1), playerId: -1, note: 'test' });
    expect(capSheet(l, t.id, l.season + 1).used).toBeGreaterThan(capFor(l, l.season + 1) * 0.92);
    expect(starters.some((p) => aiExtendEarly(l, t, p))).toBe(false);
  });
});

describe('Tags First', () => {
  /** A club whose best expiring player the call would tag. */
  function tagScene() {
    const l = fresh();
    l.phase = 'resign';
    for (const t of l.teams) {
      if (t.id === l.userTeamId || !aiGm(l, t)) continue;
      const tagged = expiringPlayers(l, t.id).find((p) => resignCall(l, t.id, p).call === 'tag');
      if (tagged) return { l, t, p: tagged };
    }
    throw new Error('no club with a tag call');
  }
  it('tags before the offer; off, the offer comes first', () => {
    const on = tagScene();
    habitsForce.all = 'tagsFirst';
    aiResignWindow(on.l, on.t, new Rng('w'));
    expect(on.t.taggedId).toBe(on.p.id);
    habitsForce.all = null;
    habitsForce.off = true;
    const off = tagScene();
    aiResignWindow(off.l, off.t, new Rng('w'));
    // Off, the player re-signs (or not) on an offer; a tag only ever follows a refused one.
    if (off.t.taggedId === off.p.id) expect(off.p.contract!.kind).toBe('tag');
    else expect(off.p.contract!.kind).not.toBe('tag');
  });
  it('logs every AI tag, not yours', () => {
    const { l, t, p } = tagScene();
    applyFranchiseTag(l, p);
    expect(aiGm(l, t)!.habitLog).toContainEqual(expect.objectContaining({ habit: 'tagsFirst', playerId: p.id }));
    const mine = l.teams[l.userTeamId];
    const q = expiringPlayers(l, mine.id)[0];
    applyFranchiseTag(l, q);
    expect(aiGm(l, mine)).toBeFalsy();
  });
});
