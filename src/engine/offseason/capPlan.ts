/**
 * A front office's cap plan for the league year (`docs/superpowers/specs/2026-11-07-free-agency-planning-design.md`):
 * the keepers it means to re-sign, best first and each judged worth his price or not, what next year already needs, the
 * targets its scouts see coming to market, and its stance. A pure read of the league as it stands: nothing is stored,
 * and the window and each free-agency pass build it once per club with their own stream, so a reload plans the same.
 */
import { leagueMarket, marketApy } from '../finance/market';
import { playerOvr } from '../positions';
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
  nextYearNeeds,
  resignCall,
  type ResignReason,
  spendable,
  upgradeBar,
  winNow,
} from './ai';
import { capBooks, commit, dealAdds, shapeToBooks } from './capBooks';
import { offerCharge, type Offer } from './negotiation';

export type Stance = 'spend' | 'balance' | 'bank';

/** `winNow` from here a club spends to its reserve floor: a contender. */
export const STANCE_SPEND = 0.6;
/** `winNow` under here a club banks: it keeps its keepers, buys young or big, and carries the rest into next year. */
export const STANCE_BANK = 0.35;

export const stanceFor = (wn: number): Stance => (wn >= STANCE_SPEND ? 'spend' : wn < STANCE_BANK ? 'bank' : 'balance');
export const stanceOf = (league: League, team: Team): Stance => stanceFor(winNow(league, team));

/**
 * Whether this GM gambles this league year: he weighs even his starters against the coming market and may let one walk
 * for another club's man who never comes (the owner, Nov 7: GMs make bad calls). One in four, up to one in two for a
 * GM with no loyalty to his own; drawn on its own stream, so nothing else in the world moves with it.
 */
export function gambles(league: League, team: Team): boolean {
  return new Rng(`${league.seed}:plan-gamble:${league.season}:${team.id}`).chance(0.25 + 0.25 * (1 - team.gm.loyalty));
}

export interface PlannedKeeper {
  player: Player;
  call: 'keep' | 'tag';
  /** Why the club would keep him (`resignCall`): a starter is weighed only against his price, never a maybe. */
  reason: ResignReason;
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

/**
 * How much over what it reads him worth where he's headed an AI club pays to keep its own: a club kept 47–57% of its good
 * players whose deals ended against the NFL's 36% (2026-11-16), paying a veteran for what he was. Tuned against stayed.
 */
export const RESIGN_VALUE = { ratio: 1.2 };

/** What a club reads its own player worth where he's headed: his market price, scaled by its outlook on him. */
export const fairPrice = (league: League, p: Player, ahead: number): number =>
  marketApy(leagueMarket(league), p) * Math.min(1.2, Math.max(0.5, ahead / Math.max(1, playerOvr(p))));

/** A keeper's price fits the club's plan: no more than `RESIGN_VALUE.ratio` times what it reads him worth. */
export const priceFits = (apy: number, fair: number): boolean => apy <= RESIGN_VALUE.ratio * fair;

export function capPlan(league: League, team: Team, rng: Rng): CapPlan {
  const depth = depthOutlooks(league, team);
  const wn = winNow(league, team);
  const stance = stanceFor(wn);
  const targets = targetsFor(league, team, depth, wn);
  const room = spendable(league, team.id);
  const gamble = gambles(league, team);
  // The books the plan spends as it keeps each man (`capBooks`): a keeper's deal must fit the years it reaches.
  const books = capBooks(league, team);
  const keepers: PlannedKeeper[] = [];
  // Best first by where the club reads them headed; each judged against the room as the plan leaves it, the worth
  // keepers before him in it (two expiring receivers don't both fill the same hole).
  const working = Object.fromEntries(Object.entries(depth).map(([k, v]) => [k, [...v]])) as typeof depth;
  const own = expiringPlayers(league, team.id)
    .map((p) => ({ p, ahead: teamOutlook(league, team.id, p, wn) }))
    .sort((a, b) => b.ahead - a.ahead || a.p.id - b.p.id);
  for (const { p } of own) {
    const c = resignCall(league, team.id, p, working, wn);
    if (c.call === 'walk') continue;
    const gain = needGain(working, p, c.ahead + quirkWorth(league, team.id, p));
    const asked = aiOffer(league, team, p, rng, gain);
    // A loyal GM pays his own a little more, a hard one a little less.
    asked.apy = Math.round(asked.apy * (0.96 + team.gm.loyalty * 0.08));
    // A keeper short of a starter is weighed against the coming market (the spec's depth keeper). A starter is too only
    // when the GM gambles this year: another club's man may never reach the market, so it's a bad call he can make.
    const wanted =
      priceFits(asked.apy, fairPrice(league, p, c.ahead)) &&
      worthIt(
        { gain, apy: asked.apy, position: p.position },
        upgradeBar(league, team, asked.apy),
        c.reason === 'starter' && !gamble ? [] : targets,
        room,
      );
    // Shaped to the books before anyone signs: a man the club wants may stretch to the GM's full ceiling in the later
    // years (`softRoom`); one it can't carry even for a year isn't worth keeping.
    const carried = shapeToBooks(league, team, p, asked, books, wanted);
    const worth = wanted && !!carried;
    const offer = carried ?? asked;
    if (worth) {
      commit(books, dealAdds(league, p, team.id, offer, books));
      working[p.position].push(c.ahead);
      working[p.position].sort((a, b) => b - a);
    }
    keepers.push({
      player: p,
      call: c.call as 'keep' | 'tag',
      reason: c.reason,
      ahead: c.ahead,
      gain,
      offer,
      cost: offerCharge(league, p, team.id, offer),
      worth,
    });
  }
  return { stance, keepers, nextYear: nextYearNeeds(league, team), targets, room };
}
