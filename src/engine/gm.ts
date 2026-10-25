/** Persistent GM careers. The carousel will call these moves; nothing schedules dismissals yet. */
import { generateGm } from './gmTraits';
import { recruitmentProblem } from './employment';
import { newIdentity } from './identity';
import { Rng } from './rng';
import { departForGm, staffWindowOpen } from './staff';
import type { CareerDate, GeneralManager, GmTraits, League } from './types';

export const careerDate = (league: League): CareerDate => ({
  season: league.season,
  phase: league.phase,
  week: league.phase === 'regular' || league.phase === 'playoffs' ? league.week : 0,
});

export function teamGm(league: League, teamId: number): GeneralManager | undefined {
  const id = league.teams[teamId]?.gmId;
  return id == null ? undefined : league.gms[id];
}

/** Tendencies have one home: the active team, or the unemployed person's file. */
export function gmTraits(league: League, gm: GeneralManager): GmTraits {
  const traits = gm.teamId === null ? gm.traits : league.teams[gm.teamId]?.gm;
  if (!traits) throw new Error('This GM has no management tendencies on file.');
  return traits;
}

/** Isolated identity stream: adding people must never reroll players, contracts or schedules. */
export function initializeGms(league: League): void {
  league.gms = {};
  league.nextGmId = 1;
  for (const team of league.teams) {
    const id = league.nextGmId++;
    const rng = new Rng(`${league.seed}:gm:identity:${team.id}`);
    league.gms[id] = {
      id,
      ...newIdentity(rng, { kind: 'scout', role: 'director' }),
      age: rng.int(40, 62),
      appearanceId: `gm:${id}`,
      teamId: team.id,
      origin: 'opening',
      appointments: [{ teamId: team.id, start: careerDate(league), interim: false, through: league.season + 2 }],
      career: [],
    };
    team.gmId = id;
    if (team.id === league.userTeamId) league.userGmId = id;
  }
}

/** Close the actual spell; appointment records and tendencies remain with the person. */
export function endGmAppointment(league: League, gmId: number, reason: 'dismissed' | 'expired' | 'retired'): void {
  const gm = league.gms[gmId];
  if (!gm || gm.teamId === null) throw new Error('This GM has no active appointment.');
  const appointment = gm.appointments.at(-1);
  if (!appointment || appointment.end) throw new Error('This GM has no active appointment.');
  const team = league.teams[gm.teamId];
  gm.traits = team.gm;
  // A vacancy carries a neutral caretaker's tendencies, never the departed GM's mutable object.
  team.gm = {
    archetype: 'Balanced',
    winNow: 0.5,
    capAggression: 0.5,
    pickChart: 'johnson',
    futureDiscount: 0.25,
    loyalty: 0.5,
    stubbornness: 0.5,
  };
  team.gmId = null;
  appointment.end = careerDate(league);
  appointment.reason = reason;
  gm.teamId = null;
  if (reason === 'retired') gm.retired = true;
}

export interface GmOffer {
  through: number;
  interim?: boolean;
}

function offerProblem(league: League, teamId: number, offer: GmOffer): string | null {
  if (!league.teams[teamId]) return 'This team does not exist.';
  if (league.teams[teamId].gmId !== null) return 'This team already has a GM.';
  if (!Number.isInteger(offer.through) || offer.through < league.season) return 'The offer must cover this season.';
  if (offer.interim && (league.phase !== 'regular' || offer.through !== league.season))
    return 'An interim appointment starts midseason and lasts through this season only.';
  if (league.phase !== 'regular' && !staffWindowOpen(league))
    return 'GM appointments open during the season or hiring window.';
  return null;
}

export function appointGm(league: League, teamId: number, gmId: number, offer: GmOffer): void {
  const gm = league.gms[gmId];
  if (!gm || gm.retired || gm.teamId !== null) throw new Error('This GM is not available.');
  const problem = offerProblem(league, teamId, offer);
  if (problem) throw new Error(problem);
  const traits = gmTraits(league, gm);
  league.teams[teamId].gm = traits;
  league.teams[teamId].gmId = gm.id;
  delete gm.traits;
  gm.teamId = teamId;
  gm.appointments.push({ teamId, start: careerDate(league), interim: offer.interim ?? false, through: offer.through });
}

/** Only an explicit offseason offer turns a midseason interim spell into a permanent job. */
export function makeGmPermanent(league: League, gmId: number, through: number): void {
  const gm = league.gms[gmId];
  const old = gm?.appointments.at(-1);
  if (!gm || gm.teamId === null || !old?.interim || old.end) throw new Error('This GM is not an active interim.');
  if (!staffWindowOpen(league)) throw new Error('A permanent offer is made in the offseason hiring window.');
  if (!Number.isInteger(through) || through < league.season) throw new Error('The offer must cover this season.');
  old.end = careerDate(league);
  old.reason = 'permanent';
  gm.appointments.push({ teamId: gm.teamId, start: careerDate(league), interim: false, through });
}

/** New entrants come from actual scouting directors, carrying their identity and observed career. */
export function appointDirectorAsGm(league: League, teamId: number, staffId: number, offer: GmOffer): GeneralManager {
  const director = league.staff[staffId];
  if (!director || director.role !== 'director') throw new Error('A new GM must be a scouting director.');
  const recruitment = recruitmentProblem(league, teamId, director.teamId);
  if (recruitment) throw new Error(recruitment);
  const problem = offerProblem(league, teamId, offer);
  if (problem) throw new Error(problem);
  const scouting = departForGm(league, staffId);
  const id = league.nextGmId++;
  const gm: GeneralManager = {
    id,
    firstName: scouting.firstName,
    lastName: scouting.lastName,
    ...(scouting.woman ? { woman: true } : {}),
    age: scouting.age,
    appearanceId: `staff:${scouting.id}`,
    teamId: null,
    origin: 'director',
    scouting,
    traits: generateGm(new Rng(`${league.seed}:gm:director:${staffId}`)),
    appointments: [],
    career: [],
  };
  league.gms[id] = gm;
  appointGm(league, teamId, id, offer);
  return gm;
}

export function ageGms(league: League): void {
  for (const gm of Object.values(league.gms)) if (!gm.retired) gm.age++;
}
