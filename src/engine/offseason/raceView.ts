/**
 * What a screen may read of free agency's race (`race.ts`): where your offer stands among a player's offers, as coarse
 * bars and a place, never another team's price but the agent's rounded number for the leader, and a word for how close
 * he is to choosing. Words and rounded figures only (fog of war): nothing of what an offer is worth to him.
 */
import { clubFeeling } from '../relationships';
import { characterRead } from '../scouting';
import type { League, Player, RaceOffer } from '../types';
import { FA_DAYS } from '../types';
import { demand, type Offer } from './negotiation';
import { decides, rankOffers } from './race';

export type RaceStatus = 'waiting' | 'weighing' | 'close';

export const STATUS_WORDS: Record<RaceStatus, string> = {
  waiting: 'Waiting on more offers',
  weighing: 'Weighing offers',
  close: 'Close to a decision',
};

export interface RaceView {
  /** The teams in for him that he would sign with, best first: a bar in tenths of the leader's (the leader's is 1). */
  teams: { teamId: number; bar: number; you: boolean }[];
  /** Your place among them, or null with no offer of yours standing. */
  place: number | null;
  of: number;
  status: RaceStatus;
  leader: number | null;
  /** What the leader offers a year ($K), as his agent tells it: to the nearest half million. */
  leaderApy: number | null;
  yours: Offer | null;
  /** His agent's warning is waiting on your answer. */
  warned: boolean;
}

const HALF_MILLION = 500;

/** A bar in tenths of the leader's: at least a tenth, so a team in for him always shows. */
export const barOf = (value: number, top: number): number => Math.max(0.1, Math.round((value / top) * 10) / 10);

/** What an agent says of a price ($K a year): to the nearest half million. */
export const roundApy = (apy: number): number => Math.round(apy / HALF_MILLION) * HALF_MILLION;

/** This season's offers for him while free agency runs, or null. */
function offersFor(league: League, playerId: number): readonly RaceOffer[] | null {
  const race = league.faRace;
  if (league.phase !== 'freeAgency' || !race || race.season !== league.season) return null;
  return race.offers[playerId] ?? [];
}

/** The race for one free agent as a screen may read it; null outside the race. */
export function raceView(league: League, playerId: number): RaceView | null {
  const p = league.players[playerId];
  const offers = offersFor(league, playerId);
  if (!p || p.retired || p.teamId !== null || !offers) return null;
  const user = league.userTeamId;
  const ranked = rankOffers(league, p, offers);
  const top = ranked[0];
  const mine = offers.find((o) => o.teamId === user);
  const since = league.faRace!.since[playerId] ?? league.faDay;
  const close =
    !!top &&
    decides(ranked, {
      waited: league.faDay - since,
      patience: p.personality.patience,
      lastDay: league.faDay >= FA_DAYS,
      askApy: demand(league, p, top.teamId).askApy,
    });
  const place = ranked.findIndex((r) => r.teamId === user);
  return {
    teams: ranked.map((r) => ({ teamId: r.teamId, bar: barOf(r.value, top.value), you: r.teamId === user })),
    place: place < 0 ? null : place + 1,
    of: ranked.length,
    status: close ? 'close' : ranked.length >= 2 ? 'weighing' : 'waiting',
    leader: top?.teamId ?? null,
    leaderApy: top ? roundApy(top.offer.apy) : null,
    yours: mine?.offer ?? null,
    warned: !!league.faRace!.warnings.some((w) => w.playerId === playerId && !w.answered),
  };
}

/**
 * What he cares about most, from what `teamId`'s scouts read of him: the top two of money, a winner and staying with
 * his old team (only when that team has an offer in), with home first when a team that has an offer in is one he
 * walked away from as a starter. Null while they haven't read him.
 */
export function wantsLine(league: League, teamId: number, p: Player): string | null {
  const read = characterRead(league, teamId, p);
  if (!read) return null;
  const offers = offersFor(league, p.id) ?? [];
  const inFor = (id: number | undefined) => id !== undefined && offers.some((o) => o.teamId === id);
  const old = p.statTeams?.[league.season - 1]?.at(-1) ?? p.left?.at(-1)?.teamId;
  const wants: { word: string; weight: number }[] = [
    { word: 'money', weight: read.greed },
    { word: 'a winner', weight: read.winning },
  ];
  if (inFor(old)) wants.push({ word: 'staying with his old team', weight: read.loyalty });
  wants.sort((a, b) => b.weight - a.weight);
  const home = offers.some((o) => clubFeeling(league, p, o.teamId) === 'home');
  // Home first says his old team already: the second is money or a winner.
  const [first, second] = home ? [{ word: 'home' }, wants.find((w) => w.word !== 'staying with his old team')!] : wants;
  const lead = first.word[0].toUpperCase() + first.word.slice(1);
  return `${lead} first, then ${second.word}`;
}
