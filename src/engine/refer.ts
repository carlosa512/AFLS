/**
 * How a story names people and clubs (SNN's edition, `snnVoice.ts`): a man's full name the first time and his surname
 * after it, a club's nickname the first time and its city after it. Never into an ambiguity: two men of one surname in
 * the story keep their full names, and a city two clubs share is never used for either. One referrer a story.
 */
import type { League } from './types';

export interface Referrer {
  /** His name as this mention should have it. */
  man(playerId: number): string;
  /** "the Voyageurs" the first time, "Minnesota" after it. Capitalise it yourself at the start of a sentence. */
  club(teamId: number): string;
  /** The short form whatever came before: the city, or the nickname where the city is shared. */
  city(teamId: number): string;
  /** The bare nickname ("Squall"), for "the 7–1 Squall". */
  nickname(teamId: number): string;
  /** The men named so far, in order. */
  named(): number[];
}

export function referrer(l: League, cast: { playerIds: number[] }): Referrer {
  const full = (id: number) => `${l.players[id].firstName} ${l.players[id].lastName}`;
  const surnames = new Map<string, number>();
  for (const id of new Set(cast.playerIds)) {
    const s = l.players[id]?.lastName;
    if (s) surnames.set(s, (surnames.get(s) ?? 0) + 1);
  }
  const cities = new Map<string, number>();
  for (const t of l.teams) cities.set(t.city, (cities.get(t.city) ?? 0) + 1);
  const men: number[] = [];
  const clubs = new Set<number>();
  const nickname = (teamId: number) => `the ${l.teams[teamId].name}`;
  const city = (teamId: number) =>
    (cities.get(l.teams[teamId].city) ?? 0) > 1 ? nickname(teamId) : l.teams[teamId].city;
  return {
    man(id) {
      const first = !men.includes(id);
      if (first) men.push(id);
      const shared = (surnames.get(l.players[id].lastName) ?? 0) > 1;
      return first || shared ? full(id) : l.players[id].lastName;
    },
    club(teamId) {
      if (clubs.has(teamId)) return city(teamId);
      clubs.add(teamId);
      return nickname(teamId);
    },
    city,
    nickname: (teamId) => l.teams[teamId].name,
    named: () => [...men],
  };
}

/** A phrase with its first letter in capitals, for the start of a sentence ("the Voyageurs" opens as "The Voyageurs"). */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Reed's", "the Knights'". */
export const possessive = (s: string) => `${s}${s.endsWith('s') ? "'" : "'s"}`;
