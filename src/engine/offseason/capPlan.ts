/**
 * A front office's cap plan for the league year (`docs/superpowers/specs/2026-11-07-free-agency-planning-design.md`):
 * the keepers it means to re-sign, best first and each judged worth his price or not, what next year already needs, the
 * targets its scouts see coming to market, and its stance. A pure read of the league as it stands: nothing is stored,
 * and the window and each free-agency pass build it once per club with their own stream, so a reload plans the same.
 */
import { capFor, capSheet } from '../finance/cap';
import { leagueMarket, marketApy } from '../finance/market';
import { teamOutlook } from '../outlook';
import { Rng } from '../rng';
import { quirkWorth, viewCache } from '../scouting';
import type { League, Player, Position, Team } from '../types';
import {
  aiOffer,
  depthOutlooks,
  expiringPlayers,
  minGainFor,
  needGain,
  nextYearCeiling,
  nextYearNeeds,
  resignCall,
  spendable,
  upgradeBar,
  winNow,
} from './ai';
import { offerCharge, type Offer } from './negotiation';

export type Stance = 'spend' | 'balance' | 'bank';

/** `winNow` from here a club spends to its reserve floor: a contender. */
export const STANCE_SPEND = 0.6;
/** `winNow` under here a club banks: it keeps its keepers, buys young or big, and carries the rest into next year. */
export const STANCE_BANK = 0.35;

export const stanceFor = (wn: number): Stance => (wn >= STANCE_SPEND ? 'spend' : wn < STANCE_BANK ? 'bank' : 'balance');
export const stanceOf = (league: League, team: Team): Stance => stanceFor(winNow(league, team));

export interface PlannedKeeper {
  player: Player;
  call: 'keep' | 'tag';
  /** Where the club reads him headed (`teamOutlook`). */
  ahead: number;
  /** What he adds to the room as it stands without him (`needGain`). */
  gain: number;
  offer: Offer;
  /** His new deal's charge this league year, less his old one's (`offerCharge`). */
  cost: number;
  worth: boolean;
}

export interface Target {
  player: Player;
  gain: number;
  /** His market price (`marketApy`). */
  price: number;
}

export interface CapPlan {
  stance: Stance;
  keepers: PlannedKeeper[];
  /** Next league year's needs before anything is borrowed (`nextYearNeeds`). */
  nextYear: number;
  targets: Target[];
  /** What it can spend now (`spendable`), before any keeper: the room a target would be bought with. */
  room: number;
  /** What's left for outside free agents once its worth keepers are signed and next year is held. */
  faRoom: number;
}

/**
 * Worth his price: his gain clears the bar his price sets for any signing (`upgradeBar`, as a free agent's must), and
 * no target at his position the club can reach buys more gain a dollar. Otherwise the money goes to the market.
 */
export function worthIt(
  keeper: { gain: number; apy: number; position: Position },
  bar: number,
  targets: readonly Target[],
  room: number,
): boolean {
  if (keeper.gain < bar) return false;
  return !targets.some(
    (t) => t.player.position === keeper.position && t.price <= room && t.gain / t.price > keeper.gain / keeper.apy,
  );
}

/** Its scouts' best two upgrades among other clubs' players whose deals have run out (the coming market). */
function targetsFor(league: League, team: Team, depth: Record<Position, number[]>, wn: number): Target[] {
  // Only the window weighs keepers against the market; in free agency there's no keeper left to judge.
  if (league.phase !== 'resign') return [];
  const read = viewCache(league);
  const market = leagueMarket(league);
  const bar = minGainFor(league, team);
  const pool = league.teams.filter((t) => t.id !== team.id).flatMap((t) => expiringPlayers(league, t.id));
  return pool
    .map((p) => ({
      player: p,
      gain: needGain(depth, p, teamOutlook(league, team.id, p, wn, read(team.id, p)) + quirkWorth(league, team.id, p)),
      price: marketApy(market, p),
    }))
    .filter((t) => t.gain >= bar)
    .sort((a, b) => b.gain - a.gain || a.player.id - b.player.id)
    .slice(0, 2);
}

export function capPlan(league: League, team: Team, rng: Rng): CapPlan {
  const depth = depthOutlooks(league, team);
  const wn = winNow(league, team);
  const stance = stanceFor(wn);
  const targets = targetsFor(league, team, depth, wn);
  const room = spendable(league, team.id);
  const keepers: PlannedKeeper[] = [];
  const own = expiringPlayers(league, team.id)
    .map((p) => ({ p, c: resignCall(league, team.id, p, depth, wn) }))
    .filter(({ c }) => c.call !== 'walk')
    .sort((a, b) => b.c.ahead - a.c.ahead || a.p.id - b.p.id);
  for (const { p, c } of own) {
    const gain = needGain(depth, p, c.ahead + quirkWorth(league, team.id, p));
    const offer = aiOffer(league, team, p, rng, gain);
    // A loyal GM pays his own a little more, a hard one a little less.
    offer.apy = Math.round(offer.apy * (0.96 + team.gm.loyalty * 0.08));
    const worth = worthIt(
      { gain, apy: offer.apy, position: p.position },
      upgradeBar(league, team, offer.apy),
      targets,
      room,
    );
    keepers.push({
      player: p,
      call: c.call as 'keep' | 'tag',
      ahead: c.ahead,
      gain,
      offer,
      cost: offerCharge(league, p, team.id, offer),
      worth,
    });
  }
  const nextYear = nextYearNeeds(league, team);
  const season = league.season + 1;
  const nextRoom = nextYearCeiling(team.gm, wn) * capFor(league, season) - capSheet(league, team.id, season).used;
  const held = stance === 'spend' ? 0 : Math.max(0, nextYear - nextRoom);
  const signing = keepers.filter((k) => k.worth).reduce((sum, k) => sum + k.cost, 0);
  return { stance, keepers, nextYear, targets, room, faRoom: room - signing - held };
}
