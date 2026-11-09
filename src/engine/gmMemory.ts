/**
 * What an AI GM remembers of his dealings with your GM (spec 2026-11-07-gm-memory-voice, §1): a short list of
 * moments on his record, and a standing worked out from them each time it's read, never stored. Nothing here
 * draws a random number, and no screen reads it as a number.
 */
import { starters } from './roster';
import { seasonRole } from './scouting';
import type { GeneralManager, League, TradeSide, TradeVerdictLater, YouMoment, YouMomentKind } from './types';

/** Seasons a moment is kept. */
export const KEEP_SEASONS = 6;
/** Moments kept a GM; past it the oldest small one goes first. */
export const KEEP_MOMENTS = 12;
/** How far his standing with you moves his price, either way (a share of the stakes). */
export const STANDING_MARGIN = 0.06;

/** Starting values: the tests pin their order and bounds, not the decimals. */
export const WEIGHTS: Record<YouMomentKind | TradeVerdictLater, number> = {
  trade: 0.05,
  tookOffer: 0.05,
  ledOn: -0.1,
  finalNo: -0.15,
  heWon: 0.25,
  both: 0.2,
  even: 0,
  youWon: -0.3,
  brokeDown: -0.25,
};

/** A big trade's verdict counts one and a half times. */
const BIG = 1.5;

/** Note a moment with your GM on his record. Nothing for no GM, or for yours. */
export function noteMoment(
  league: League,
  gm: GeneralManager | undefined,
  m: Omit<YouMoment, 'season' | 'phase'>,
): void {
  if (!gm || gm.id === league.userGmId) return;
  (gm.withYou ??= []).push({ ...m, season: league.season, phase: league.phase });
  pruneMoments(league, gm);
}

/** Drop what is too old, then past the cap the oldest small moment first, a big trade the last to go. */
export function pruneMoments(league: League, gm: GeneralManager): void {
  if (!gm.withYou) return;
  let kept = gm.withYou.filter((m) => league.season - m.season <= KEEP_SEASONS);
  // Moments are pushed in order, so index order is age order.
  while (kept.length > KEEP_MOMENTS) {
    const i = kept.findIndex((m) => !m.big);
    kept = kept.filter((_, j) => j !== (i < 0 ? 0 : i));
  }
  gm.withYou = kept;
}

/** −1 … 1: how he stands with you. Each moment fades by its age at a half-life of one to three seasons by his stubbornness. */
export function standingWith(league: League, gm: GeneralManager | undefined): number {
  if (!gm?.withYou?.length) return 0;
  const stubborn =
    gm.traits?.stubbornness ?? (gm.teamId === null ? undefined : league.teams[gm.teamId]?.gm.stubbornness) ?? 0.5;
  const half = 1 + 2 * stubborn;
  let s = 0;
  for (const m of gm.withYou) {
    const verdict = m.verdict ? WEIGHTS[m.verdict] * (m.big ? BIG : 1) : 0;
    s += (WEIGHTS[m.kind] + verdict) * 0.5 ** (Math.max(0, league.season - m.season) / half);
  }
  return Math.max(-1, Math.min(1, s));
}

export type StandingBand = 'warm' | 'easy' | 'neutral' | 'cool' | 'sour';

export function standingBand(s: number): StandingBand {
  return s >= 0.35 ? 'warm' : s >= 0.12 ? 'easy' : s <= -0.35 ? 'sour' : s <= -0.12 ? 'cool' : 'neutral';
}

/** The patience step: +1 for a friendly GM, −1 for a sour one. */
export function standingStep(s: number): -1 | 0 | 1 {
  return s >= 0.35 ? 1 : s <= -0.35 ? -1 : 0;
}

/** How a deal looked to him at close: what he got against what he needed (under 1.03 of it squeezed, 1.15 and up paid up). */
export function atCloseOf(get: number, need: number): 'paidUp' | 'fair' | 'squeezed' {
  const r = get / Math.max(need, 1);
  return r < 1.03 ? 'squeezed' : r >= 1.15 ? 'paidUp' : 'fair';
}

/** A first-round pick, or a player who starts for his club now. Read before the deal moves anyone. */
export function isBig(league: League, sides: readonly TradeSide[]): boolean {
  return sides.some(
    (s) =>
      s.picks.some((id) => league.draftPicks.find((p) => p.id === id)?.round === 1) ||
      s.players.some((id) => {
        const p = league.players[id];
        return (
          !!p && p.teamId !== null && starters(league, league.teams[p.teamId], p.position).some((q) => q.id === id)
        );
      }),
  );
}

/** How a traded piece played last season: 3 starter, 2 rotation, 1 backup, 0 gone or no games. */
export interface PieceRead {
  role: number;
  hurt: boolean;
}

const ROLE_POINTS = { starter: 3, rotation: 2, backup: 1 } as const;
/** A layoff this long last season counts as a season lost to injury. */
const HURT_WEEKS = 4;

/** Null when it isn't known yet: a pick not used, or whose player hasn't played a season. */
export function pieceRole(league: League, kind: 'player' | 'pick', id: number): PieceRead | null {
  if (kind === 'pick') {
    const pick = league.draftPicks.find((p) => p.id === id);
    // A pick pruned from the list is unknown, like one not yet used.
    if (pick?.playerId === undefined) return null;
    const p = league.players[pick.playerId];
    if (!p || !p.stats[league.season - 1]) return null;
    return pieceRole(league, 'player', pick.playerId);
  }
  const p = league.players[id];
  if (!p || p.retired || p.teamId === null) return { role: 0, hurt: false };
  const read = seasonRole(league, p);
  const last = league.season - 1;
  return {
    role: read ? ROLE_POINTS[read.role] : 0,
    hurt: !!p.injuries?.some((i) => i.season === last && i.weeks >= HURT_WEEKS),
  };
}

/** What he made of a trade once the men had played, or null while it can't be said (or a verdict is already set). */
export function judgeTrade(
  m: YouMoment,
  season: number,
  read: (kind: 'player' | 'pick', id: number) => PieceRead | null,
): TradeVerdictLater | null {
  if (m.verdict || season <= m.season) return null;
  const reads = (side?: { players: number[]; picks: number[] }) => {
    const out: PieceRead[] = [];
    let unknown = false;
    for (const [kind, ids] of [
      ['player', side?.players ?? []],
      ['pick', side?.picks ?? []],
    ] as const)
      for (const id of ids) {
        const r = read(kind, id);
        if (r) out.push(r);
        else unknown = true;
      }
    return { out, unknown };
  };
  const got = reads(m.got);
  const gave = reads(m.gave);
  // A pick's man may not have played yet; wait up to three league years, then judge without him.
  if ((got.unknown || gave.unknown) && season - m.season < 3) return null;
  if (got.out.some((r) => r.hurt && r.role <= 1)) return 'brokeDown';
  const G = got.out.reduce((a, r) => a + r.role, 0);
  const V = gave.out.reduce((a, r) => a + r.role, 0);
  if (G >= 3 && V >= 3 && Math.abs(G - V) <= 1) return 'both';
  if (G - V >= 2) return 'heWon';
  if (V - G >= 2) return 'youWon';
  return 'even';
}

/** At the new league year: judge every trade not yet judged, for every GM with a record of you, then prune. */
export function memoryNewYear(league: League): void {
  for (const gm of Object.values(league.gms ?? {})) {
    if (!gm.withYou?.length) continue;
    for (const m of gm.withYou)
      if (m.kind === 'trade') {
        const v = judgeTrade(m, league.season, (kind, id) => pieceRole(league, kind, id));
        if (v) m.verdict = v;
      }
    pruneMoments(league, gm);
  }
}
