/**
 * How draft picks turned out and how prospects read on draft day, always through the user's club's scouts: a pick
 * judged against what its round should produce (provisional for two seasons, locked after the third, when his ceiling
 * has settled), a prospect's risk, and where the staff's board parts from the league's consensus.
 */
import { employed } from './employment';
import { boardValue, POSITION_PREMIUM } from './offseason/draft';
import { perceive, tierOf, type PlayerView } from './scouting';
import type { League, Player, PickVerdict } from './types';

export type { PickVerdict };

/** Seasons before a pick's verdict locks: a ceiling settles over his first three (`ceiling.ts`). */
export const VERDICT_YEARS = 3;

/**
 * What a round should produce, as a `tierOf` level (0 = elite): a first-rounder a high-end starter, a second a solid
 * starter, a third a fringe starter, Day 3 a quality backup.
 */
export const ROUND_BAR = (round: number) => Math.min(round, 4);

/** Two levels over the bar is a steal, at it or over a hit, under it a miss. */
export function verdictFor(round: number, tier: number): PickVerdict {
  const bar = ROUND_BAR(round);
  return tier <= bar - 2 ? 'steal' : tier <= bar ? 'hit' : 'miss';
}

/** A pick's mark: `verdict` null while it's too early to say; `locked` once stored for good. */
export interface PickMark {
  verdict: PickVerdict | null;
  locked: boolean;
}

/** Whose eyes the screens see through: the user's club, or nobody's scouts between jobs (as `viewOf`). */
const viewer = (league: League) => (employed(league) ? league.userTeamId : -1);

/** The live verdict: where the user's scouts think he tops out, against his round's bar. */
const liveVerdict = (league: League, p: Player): PickVerdict =>
  verdictFor(p.draft!.round, tierOf(league, p.position, perceive(league, viewer(league), p).potMid));

/**
 * How a pick reads now, or null for a player from no draft this league held (a new league's veterans come with
 * made-up draft lines and no consensus read). Too early until his rookie season is in: its end is the first time
 * his ceiling settles.
 */
export function pickMark(league: League, p: Player): PickMark | null {
  if (!p.draft || !p.scouting) return null;
  if (p.draft.verdict) return { verdict: p.draft.verdict, locked: true };
  if (p.experience === 0 && !Object.keys(p.ceilingShifts ?? {}).length) return { verdict: null, locked: false };
  return { verdict: liveVerdict(league, p), locked: false };
}

/**
 * Locks the verdict on every pick three league years back, from the user's club's read at that moment. Retired
 * players count (a bust who left early is still a bust); a stored verdict is never rewritten.
 */
export function lockVerdicts(league: League): void {
  for (const p of Object.values(league.players)) {
    if (!p.draft || !p.scouting || p.draft.verdict) continue;
    if (league.season - p.draft.season >= VERDICT_YEARS) p.draft.verdict = liveVerdict(league, p);
  }
}

// ───────── draft day ─────────

/** Safe: little of his value is still upside and the read is tight (about a fifth of a class). */
const SAFE_UPSIDE = 3;
const SAFE_SD = 1.8;
/** Boom-or-bust: most of his value is upside, or the scouts barely know (about a fifth of a class). */
const BOOM_UPSIDE = 5.8;
const BOOM_SD = 2.5;

export type RiskWord = 'safe' | 'boom-or-bust' | null;

/** A prospect's floor-to-ceiling read on the 1–20 scale: his grade now, the ceiling's best guess, its top. */
export interface Risk {
  lo: number;
  mid: number;
  hi: number;
  word: RiskWord;
}

export function riskOf(view: PlayerView): Risk {
  const upside = view.potMid - view.ovr;
  const word: RiskWord =
    upside >= BOOM_UPSIDE || view.potSd >= BOOM_SD
      ? 'boom-or-bust'
      : upside <= SAFE_UPSIDE && view.potSd <= SAFE_SD
        ? 'safe'
        : null;
  const lo = view.ovr;
  const mid = Math.max(lo, view.potMid);
  return { lo, mid, hi: Math.max(mid, view.potHi), word };
}

/** The staff's board value: the consensus's formula, fed the user's scouts' grades. */
export const staffBoardValue = (league: League, p: Player) => {
  const v = perceive(league, viewer(league), p);
  return 0.6 * v.ovr + 0.4 * v.potMid + POSITION_PREMIUM[p.position];
};

/** Spots of disagreement that make a prospect a sleeper or a fade: a round's worth, like `reachOrSteal`. */
export const GAP_LINE = 12;

/** Where the staff and the consensus rank a prospect in `pool`; `diff` > 0 when the staff likes him more. */
export interface Gap {
  ours: number;
  consensus: number;
  diff: number;
  tag: 'sleeper' | 'fade' | null;
}

export function staffGaps(league: League, pool: Player[]): Map<number, Gap> {
  const rank = (value: (p: Player) => number) => {
    const scored = pool.map((p) => ({ id: p.id, v: value(p) }));
    scored.sort((a, b) => b.v - a.v || a.id - b.id);
    return new Map(scored.map((s, i) => [s.id, i + 1]));
  };
  const ours = rank((p) => staffBoardValue(league, p));
  const consensus = rank(boardValue);
  return new Map(
    pool.map((p) => {
      const o = ours.get(p.id)!;
      const c = consensus.get(p.id)!;
      const diff = c - o;
      return [
        p.id,
        { ours: o, consensus: c, diff, tag: diff >= GAP_LINE ? 'sleeper' : diff <= -GAP_LINE ? 'fade' : null },
      ];
    }),
  );
}
