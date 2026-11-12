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

/**
 * A reader of everyone's standing after one season (the last one unless given): build it once, ask it in a loop. A
 * season the league never played (a first-year save) has no honors and no stat lines, so everyone reads depth.
 */
export function standingReader(l: League, season = l.season - 1): (p: Player) => Standing {
  const stars = new Set<number>();
  const awards = l.awards.find((a) => a.season === season);
  for (const w of Object.values(awards?.winners ?? {})) if (w) stars.add(w.playerId);
  for (const team of awards?.allLeague ?? []) for (const w of team) stars.add(w.playerId);

  const lines = Object.values(l.players).flatMap((p) => {
    const line = statLine(p, season);
    return line ? [{ p, line }] : [];
  });
  for (const k of MAJOR)
    [...lines]
      .filter((x) => (x.line[k] ?? 0) > 0)
      .sort((a, b) => (b.line[k] ?? 0) - (a.line[k] ?? 0) || a.p.id - b.p.id)
      .slice(0, STANDING.topN)
      .forEach((x) => stars.add(x.p.id));

  // A winning club's passer: the most attempts among the men who finished the season there.
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
    if (r && r.w > r.l) stars.add(id);
  }

  return (p) => (stars.has(p.id) ? 'star' : (statLine(p, season)?.snaps ?? 0) >= STANDING.snaps ? 'starter' : 'depth');
}

/** One player's standing. In a loop, build `standingReader` once instead. */
export const publicStanding = (l: League, p: Player, season = l.season - 1): Standing => standingReader(l, season)(p);

/** A first- or second-round pick of the last three drafts: still young, and still a name. */
export function draftedHigh(l: League, p: Player): boolean {
  const d = p.draft;
  return !!d && d.round <= STANDING.highRounds && d.season <= l.season && d.season > l.season - STANDING.highYears;
}
