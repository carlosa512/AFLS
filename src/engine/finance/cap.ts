/**
 * Team cap sheets and the moves that change them. Cap used in a league year is the sum of the
 * roster's cap hits plus dead money; in the offseason only the 51 largest hits count.
 */
import { STARTERS } from '../positions';
import { clamp, type Rng } from '../rng';
import { teamPlayers } from '../roster';
import type { Contract, League, Phase, Player, Team, Transaction } from '../types';
import { OFFSEASON_PHASES, POSITIONS } from '../types';
import {
  capHit,
  deadMoney,
  remainingProration,
  restructure,
  restructurePreview,
  yearOf,
  type DeadMoneySplit,
  type RestructurePreview,
} from './contract';
import { BASE_CAP, minSalary } from './market';

export const POST_JUNE1_LIMIT = 2;
/** Projected yearly cap growth for future-year planning. */
export const PROJECTED_CAP_GROWTH = 0.07;

/** Salary cap for a league year: actual once set, otherwise projected from the latest known year. */
export function capFor(league: League, season: number): number {
  if (league.caps[season]) return league.caps[season];
  const known = Object.keys(league.caps)
    .map(Number)
    .filter((y) => y <= season);
  const from = known.length ? Math.max(...known) : season;
  const base = league.caps[from] ?? BASE_CAP;
  return Math.round(base * (1 + PROJECTED_CAP_GROWTH) ** (season - from));
}

export const isOffseason = (phase: Phase) => OFFSEASON_PHASES.includes(phase);

/** Moves made once training camp opens use post-June 1 accounting automatically. */
export const autoPostJune1 = (phase: Phase) => phase === 'preseason' || phase === 'regular' || phase === 'playoffs';

const SEASON_WEEKS = 18;

/** Weekly salary checks paid so far this league year (18 in a season). */
export function weeksPaid(league: League): number {
  if (league.phase === 'regular') return Math.min(SEASON_WEEKS, league.week - 1);
  if (league.phase === 'playoffs' || league.phase === 'complete') return SEASON_WEEKS;
  return 0;
}

/** Share of a full season's base already paid out: what a brand-new deal signed today no longer pays. */
export const paidFraction = (league: League) => weeksPaid(league) / SEASON_WEEKS;

/**
 * Share of this contract's current-year base already paid. A base set mid-season (a signing or
 * a trade) only covers the weeks left from then, so it is measured from that point.
 */
export function paidShare(league: League, c: Contract): number {
  const before = yearOf(c, league.season)?.paidBefore ?? 0;
  if (before >= SEASON_WEEKS) return 1;
  return clamp((weeksPaid(league) - before) / (SEASON_WEEKS - before), 0, 1);
}

export function deadMoneyIn(team: Team, season: number): number {
  return team.deadMoney.filter((d) => d.season === season).reduce((s, d) => s + d.amount, 0);
}

export interface CapSheet {
  season: number;
  cap: number;
  carryover: number;
  /** Cap hits that count (top 51 in the offseason). */
  active: number;
  dead: number;
  used: number;
  space: number;
  rosterSize: number;
  top51: boolean;
}

/**
 * League year cap position (the top-51 rule applies to the current year until camp). `roster` saves
 * a scan of the league when the caller already holds the team's players (the trade market does).
 */
export function capSheet(
  league: League,
  teamId: number,
  season = league.season,
  roster: readonly Player[] = teamPlayers(league, teamId),
): CapSheet {
  const team = league.teams[teamId];
  // The top-51 rule runs until the final roster is set in training camp.
  const top51 =
    season === league.season &&
    (league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft');
  let hits = roster.map((p) => (p.contract ? capHit(p.contract, season) : 0)).sort((a, b) => b - a);
  if (top51) hits = hits.slice(0, 51);
  const active = hits.reduce((a, b) => a + b, 0);
  const dead = deadMoneyIn(team, season);
  const carryover = season === league.season ? team.carryover : 0;
  const cap = capFor(league, season);
  const used = active + dead;
  // Injured reserve still counts on the cap, but not toward the roster limit.
  return {
    season,
    cap,
    carryover,
    active,
    dead,
    used,
    space: cap + carryover - used,
    rosterSize: roster.filter((p) => !p.ir).length,
    top51,
  };
}

export const capSpace = (league: League, teamId: number, season = league.season, roster?: readonly Player[]) =>
  capSheet(league, teamId, season, roster).space;

export function logTransaction(league: League, kind: Transaction['kind'], teamIds: number[], text: string): void {
  league.transactions.push({ season: league.season, phase: league.phase, week: league.week, teamIds, kind, text });
  // Keep saves small: a few seasons of history is plenty.
  if (league.transactions.length > 3000) league.transactions.splice(0, league.transactions.length - 3000);
}

const nameOf = (p: Player) => `${p.position} ${p.firstName} ${p.lastName}`;

// ───────── release ─────────

export interface ReleasePreview extends DeadMoneySplit {
  postJune1: boolean;
  /** Designation available (pre-June 1 window, under the limit)? */
  canDesignate: boolean;
}

export function releasePreview(league: League, player: Player, designatePostJune1 = false): ReleasePreview {
  const team = league.teams[player.teamId!];
  const auto = autoPostJune1(league.phase);
  const canDesignate = !auto && team.postJune1Used < POST_JUNE1_LIMIT;
  const postJune1 = auto || (designatePostJune1 && canDesignate);
  const split = deadMoney(player.contract!, league.season, { paid: paidShare(league, player.contract!), postJune1 });
  return { ...split, postJune1, canDesignate };
}

/** Why a release isn't allowed right now, or null if it is. */
export function releaseBlocker(league: League, player: Player): string | null {
  if (player.teamId === null || !player.contract) return 'Not under contract.';
  if (league.phase === 'playoffs' || league.phase === 'complete')
    return 'Roster moves reopen when the new league year begins.';
  if (league.phase === 'regular') {
    const left = teamPlayers(league, player.teamId).filter((p) => p.position === player.position).length - 1;
    if (left < STARTERS[player.position])
      return `Keep at least ${STARTERS[player.position]} ${player.position} on the roster during the season.`;
  }
  return null;
}

/** Cut a player: he becomes a free agent and the team books the dead money. */
export function releasePlayer(league: League, player: Player, designatePostJune1 = false): ReleasePreview {
  if (player.teamId === null || !player.contract) throw new Error('Player is not under contract');
  const preview = releasePreview(league, player, designatePostJune1);
  const team = league.teams[player.teamId];
  const note = preview.postJune1 && !autoPostJune1(league.phase) ? 'Released (post-June 1)' : 'Released';
  if (preview.thisYear > 0)
    team.deadMoney.push({ season: league.season, amount: Math.round(preview.thisYear), playerId: player.id, note });
  if (preview.nextYear > 0)
    team.deadMoney.push({ season: league.season + 1, amount: Math.round(preview.nextYear), playerId: player.id, note });
  if (preview.postJune1 && !autoPostJune1(league.phase)) team.postJune1Used++;
  // Wherever he was lined up (a player can be at another position on a hand-sorted chart).
  for (const pos of POSITIONS) team.depthChart[pos] = team.depthChart[pos].filter((id) => id !== player.id);
  if (team.taggedId === player.id) team.taggedId = null;
  player.tagCount = 0; // a later tag elsewhere is not a consecutive one
  logTransaction(league, 'release', [team.id], `${team.abbrev} released ${nameOf(player)}`);
  player.teamId = null;
  player.contract = null;
  return preview;
}

// ───────── restructure ─────────

/** Why a restructure isn't possible right now, or null if it is. */
export function restructureBlocker(league: League, player: Player): string | null {
  const c = player.contract;
  if (!c) return 'Not under contract.';
  if (c.kind === 'rookie') return 'Rookie-scale deals can’t be restructured.';
  if (c.kind === 'tag') return 'A franchise tag is a one-year deal: nothing to spread.';
  // Restructures happen in the offseason, before salary starts being paid.
  if (!isOffseason(league.phase)) return 'Restructures happen in the offseason, before salaries are paid.';
  const p = restructurePreview(c, league.season, Infinity, minSalary(player.experience, capFor(league, league.season)));
  if (p.years <= 1) return 'Needs at least two contract years (real or void) to spread the money.';
  if (p.max <= 0) return 'Already at the league minimum.';
  return null;
}

export const canRestructure = (league: League, player: Player) => restructureBlocker(league, player) === null;

export function restructureOptions(league: League, player: Player, amount = Infinity): RestructurePreview {
  return restructurePreview(
    player.contract!,
    league.season,
    amount,
    minSalary(player.experience, capFor(league, league.season)),
  );
}

export function restructurePlayer(league: League, player: Player, amount = Infinity): number {
  if (!canRestructure(league, player)) return 0;
  const saved = restructure(
    player.contract!,
    league.season,
    amount,
    minSalary(player.experience, capFor(league, league.season)),
  );
  const team = league.teams[player.teamId!];
  if (saved > 0)
    logTransaction(
      league,
      'restructure',
      [team.id],
      `${team.abbrev} restructured ${nameOf(player)} (+$${(saved / 1000).toFixed(1)}M cap room)`,
    );
  return saved;
}

/**
 * A deal ends (it ran out, the player re-signed or was tagged, or he retired): every bonus dollar
 * still scheduled from this league year on, void years included, hits this year's cap at once.
 */
export function accelerateProration(league: League, player: Player, teamId: number, note = 'Void years'): void {
  const c = player.contract;
  if (!c) return;
  const amount = Math.round(remainingProration(c, league.season));
  if (amount > 0) league.teams[teamId].deadMoney.push({ season: league.season, amount, playerId: player.id, note });
}

/** Five league years of commitments, for the cap projection chart. */
export function capProjection(league: League, teamId: number, span = 5) {
  return Array.from({ length: span }, (_, i) => {
    const season = league.season + i;
    const sheet = capSheet(league, teamId, season);
    const roster = teamPlayers(league, teamId);
    const voidCharges = roster.reduce((s, p) => {
      const c = p.contract;
      if (!c) return s;
      const y = c.years.find((x) => x.season === season);
      return s + (y?.void ? capHit(c, season) : 0);
    }, 0);
    const players = roster.filter((p) => p.contract?.years.some((y) => y.season === season && !y.void)).length;
    return { ...sheet, voidCharges, players };
  });
}

/**
 * Next league year's cap: usually 6–10% growth, with a rare revenue shock (like 2021's
 * COVID cut) that stress-tests cap-heavy teams.
 */
export function nextCap(rng: Rng, cap: number): number {
  const growth = rng.chance(0.04) ? -rng.float(0.05, 0.1) : clamp(rng.normal(0.08, 0.012), 0.06, 0.1);
  return Math.round(cap * (1 + growth));
}
