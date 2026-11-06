import { afterEach, describe, expect, it } from 'vitest';
import { ageShift } from '../aging';
import { releasePlayer } from '../finance/cap';
import { createLeague } from '../generate';
import { aiGm, habitsForce } from '../gmHabits';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import { teamPlayers } from '../roster';
import { POSITIONS } from '../types';
import type { League, Player, Team } from '../types';
import { beginOffseason } from './index';
import { aiFreeAgencyDay, aiOffer, cutChoice, KEEP_MIN, youngQbClub } from './ai';
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
