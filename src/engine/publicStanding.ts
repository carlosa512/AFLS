/**
 * Who a player is in public, out of season (`docs/NEWS.md`, "SNN on the big days"): a star, a starter or depth, read
 * from last season's record alone (the awards, the league's leaders, his snaps, his club's record), and whether he was
 * drafted high lately. SNN's big-day editions rank and choose by it, so nothing they print leans on a rating or on any
 * club's scouts. In season the weekly edition reads this season's box scores instead (`starOutCandidates`). Pure: no
 * draws, nothing stored, and nothing in the sim calls it.
 */
import { statLine } from './stats';
import type { League, Player, StatKey } from './types';

export type Standing = 'star' | 'starter' | 'depth';

/** The bars, each the owner's call from the counts (`npm run editions -- --offseasons n`). */
export const STANDING = {
  /** A place this high in the league in a major stat makes a star. */
  topN: 5,
  /** Scrimmage snaps in the season that make a starter: what tells him from a backup who dressed. */
  snaps: 500,
  /** Drafted high: this round or better… */
  highRounds: 2,
  /** …in one of the last this many drafts, the league year's own among them. */
  highYears: 3,
};

/** The marks that make a star in public, as the weekly edition's (`STAR_STATS` in `snnWeek.ts`). */
const MAJOR: readonly StatKey[] = ['passYds', 'rushYds', 'recYds', 'sacks', 'defInt'];

/** Why a player is a star, as a fact a story can state. */
export type StarWhy = { kind: 'award' } | { kind: 'allLeague' } | { kind: 'top'; stat: StatKey } | { kind: 'passer' };

/** What the public record says of everyone after one season: his standing, why, and a worth to rank stories by. */
export interface PublicRecord {
  standing: (p: Player) => Standing;
  /** Why he is a star (the biggest reason), or null when he is not one. */
  why: (p: Player) => StarWhy | null;
  /** About 0 to 1, for putting the bigger name first: an award over All-League over a league leader over a starter. Never shown. */
  worth: (p: Player) => number;
}

/**
 * The public record after one season (the last one unless given): build it once, ask it in a loop. A season the
 * league never played (a first-year save) has no honors and no stat lines, so everyone reads depth.
 */
export function publicRecord(l: League, season = l.season - 1): PublicRecord {
  const why = new Map<number, StarWhy>();
  const worth = new Map<number, number>();
  const star = (id: number, w: StarWhy, value: number) => {
    if ((worth.get(id) ?? 0) >= value) return;
    why.set(id, w);
    worth.set(id, value);
  };
  const awards = l.awards.find((a) => a.season === season);
  for (const w of Object.values(awards?.winners ?? {})) if (w) star(w.playerId, { kind: 'award' }, 1);
  (awards?.allLeague ?? []).forEach((team, i) => {
    for (const w of team) star(w.playerId, { kind: 'allLeague' }, 0.9 - i * 0.1);
  });

  const lines = Object.values(l.players).flatMap((p) => {
    const line = statLine(p, season);
    return line ? [{ p, line }] : [];
  });
  for (const k of MAJOR)
    [...lines]
      .filter((x) => (x.line[k] ?? 0) > 0)
      .sort((a, b) => (b.line[k] ?? 0) - (a.line[k] ?? 0) || a.p.id - b.p.id)
      .slice(0, STANDING.topN)
      .forEach((x, i) => star(x.p.id, { kind: 'top', stat: k }, 0.7 - i * 0.01));

  // A winning team's passer: the most attempts among the players who finished the season there.
  const records = l.history.find((h) => h.season === season)?.records ?? {};
  const passer = new Map<number, { id: number; att: number }>();
  for (const { p, line } of lines) {
    const teamId = p.statTeams?.[season]?.at(-1);
    const att = line.passAtt ?? 0;
    if (teamId === undefined || att <= (passer.get(teamId)?.att ?? 0)) continue;
    passer.set(teamId, { id: p.id, att });
  }
  for (const [teamId, { id }] of passer) {
    const r = records[teamId];
    if (r && r.w > r.l) star(id, { kind: 'passer' }, 0.6);
  }

  const snaps = (p: Player) => statLine(p, season)?.snaps ?? 0;
  return {
    standing: (p) => (why.has(p.id) ? 'star' : snaps(p) >= STANDING.snaps ? 'starter' : 'depth'),
    why: (p) => why.get(p.id) ?? null,
    // A starter ranks under every star, the busier the higher.
    worth: (p) => worth.get(p.id) ?? Math.min(0.5, snaps(p) / 2400),
  };
}

/** A reader of everyone's standing after one season. */
export const standingReader = (l: League, season = l.season - 1): ((p: Player) => Standing) =>
  publicRecord(l, season).standing;

/** One player's standing. In a loop, build `standingReader` once instead. */
export const publicStanding = (l: League, p: Player, season = l.season - 1): Standing => standingReader(l, season)(p);

/** A first- or second-round pick of the last three drafts: still young, and still a name. */
export function draftedHigh(l: League, p: Player): boolean {
  const d = p.draft;
  return !!d && d.round <= STANDING.highRounds && d.season <= l.season && d.season > l.season - STANDING.highYears;
}
