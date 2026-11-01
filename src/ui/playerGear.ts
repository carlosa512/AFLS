import { gamesInWeek } from '../engine/league';
import type { Game, Gear, GearColor, GearSide as Side, League, Player, Position, SleeveLength } from '../engine/types';
import { gameWeather } from '../engine/weather';
import { pick } from './staffLook';

// What a player wears on his arms in his avatar: picked once from his id and position, so his look is his for a
// career, plus sleeves in a cold game. Nothing is saved and nothing reads ratings. The rates come from how players
// dress by position (`docs/AVATARS.md`): skill players in light sleeves and bands, the trenches in elbow pads, a
// shoulder brace now and then, and sleeves on a lineman now and then (edge rushers most, then tackles, then the
// offensive line), though the offensive line never pulls them on for the cold. The pictures are in `gearArt.tsx`.

export type { Gear, GearColor, GearSide as Side, SleeveLength } from '../engine/types';

/** How often each position wears each piece (0 to 1), before the two-piece limit. */
interface Rates {
  sleeve?: number;
  /** Of those in a sleeve, how many wear one on both arms. */
  bothArms?: number;
  /** How likely a sleeve is a shooter sleeve, against the other lengths' weights (35 full, 25 half…; default 10). */
  shooter?: number;
  /** Of those in shooter sleeves, how many wear them on both arms: mostly the secondary (default 0.2). */
  shooterBoth?: number;
  undershirt?: number;
  biceps?: number;
  forearm?: number;
  elbowPads?: number;
  brace?: number;
  /** Who pulls full sleeves on in a cold game: most players, half the tackles, never the offensive line. */
  cold?: number;
}
export const GEAR_RATES: Record<Position, Rates> = {
  QB: {
    sleeve: 0.4,
    bothArms: 0.6,
    shooter: 45,
    shooterBoth: 0.05,
    undershirt: 0.15,
    biceps: 0.05,
    forearm: 0.12,
    cold: 0.85,
  },
  RB: {
    sleeve: 0.45,
    bothArms: 0.6,
    undershirt: 0.2,
    biceps: 0.3,
    forearm: 0.15,
    elbowPads: 0.1,
    brace: 0.02,
    cold: 0.85,
  },
  WR: {
    sleeve: 0.6,
    bothArms: 0.7,
    shooter: 35,
    shooterBoth: 0.15,
    undershirt: 0.15,
    biceps: 0.35,
    forearm: 0.15,
    cold: 0.85,
  },
  TE: { sleeve: 0.25, bothArms: 0.5, undershirt: 0.25, biceps: 0.1, elbowPads: 0.35, brace: 0.04, cold: 0.85 },
  OL: { sleeve: 0.1, bothArms: 0.5, undershirt: 0.08, elbowPads: 0.4, brace: 0.06 },
  DT: { sleeve: 0.15, bothArms: 0.5, undershirt: 0.15, elbowPads: 0.3, brace: 0.04, cold: 0.5 },
  EDGE: { sleeve: 0.25, bothArms: 0.6, undershirt: 0.2, elbowPads: 0.4, brace: 0.05, cold: 0.85 },
  LB: { sleeve: 0.25, bothArms: 0.6, undershirt: 0.3, biceps: 0.15, elbowPads: 0.3, brace: 0.04, cold: 0.85 },
  CB: {
    sleeve: 0.55,
    bothArms: 0.7,
    shooter: 35,
    shooterBoth: 0.5,
    undershirt: 0.2,
    biceps: 0.3,
    forearm: 0.15,
    cold: 0.85,
  },
  S: {
    sleeve: 0.45,
    bothArms: 0.65,
    shooter: 30,
    shooterBoth: 0.5,
    undershirt: 0.2,
    biceps: 0.2,
    forearm: 0.15,
    cold: 0.85,
  },
  K: { sleeve: 0.1, bothArms: 0.3, undershirt: 0.2, cold: 0.85 },
  P: { sleeve: 0.1, bothArms: 0.3, undershirt: 0.2, cold: 0.85 },
};
/** Bands over a sleeve are rare (layered): their usual chance times this. Over an undershirt sleeve, they're usual. */
export const BANDS_OVER_SLEEVE = 0.15;
/** Pieces a player wears at most in normal weather; a cold game's sleeves can make it three. */
export const GEAR_MAX = 2;
/** Open air at this or colder at kickoff, or snow, or heavy rain: most players pull sleeves on (tune). */
export const COLD_KICKOFF_F = 35;

const LENGTHS: readonly (readonly [SleeveLength, number])[] = [
  ['full', 35],
  ['half', 25],
  ['threeQuarter', 25],
  ['forearm', 15],
];
const SLEEVE_COLORS: readonly (readonly [GearColor, number])[] = [
  ['black', 45],
  ['white', 30],
  ['primary', 25],
];
const BAND_COLORS: readonly (readonly [GearColor, number])[] = [
  ['white', 35],
  ['black', 35],
  ['primary', 15],
  ['secondary', 15],
];
const PAD_COLORS: readonly (readonly [GearColor, number])[] = [
  ['black', 60],
  ['white', 30],
  ['primary', 10],
];

/** A stable draw in [0, 1) for this player and this question. */
const roll = (id: number, salt: string) => pick(String(id), `gear:${salt}`, 1_000_000) / 1_000_000;
function weighted<T>(id: number, salt: string, options: readonly (readonly [T, number])[]): T {
  let x = roll(id, salt) * options.reduce((a, o) => a + o[1], 0);
  for (const [value, weight] of options) if ((x -= weight) < 0) return value;
  return options[options.length - 1][0];
}
const oneSide = (id: number, salt: string): 'left' | 'right' => (roll(id, salt) < 0.5 ? 'left' : 'right');

/**
 * What `player` wears on his arms: the gear you chose for him (the card's pencil), or his own (`ownGear`). In a cold
 * game most players pull on full sleeves and wear them alone, but for a shoulder brace or bands: the undershirt
 * sleeve and elbow pads come off. The offensive line dresses the same in any weather.
 */
export function gearOf(player: Pick<Player, 'id' | 'position' | 'gear'>, cold = false): Gear {
  const { id, position } = player;
  const base = player.gear ?? ownGear(player);
  const r = GEAR_RATES[position];
  if (!cold || !r.cold || roll(id, 'cold') >= r.cold) return base;
  const gear: Gear = {
    // full sleeves on both arms, in the colour he'd pick anyway
    sleeve: {
      length: 'full',
      color: base.sleeve?.color ?? base.undershirt ?? weighted(id, 'sleeveColor', SLEEVE_COLORS),
      side: 'both',
    },
  };
  if (base.band) gear.band = base.band;
  if (base.shoulderBrace) gear.shoulderBrace = base.shoulderBrace;
  return gear;
}

/**
 * The gear the avatar picks for `player` by his position: a brace first (rare, and needed), then elbow pads, a sleeve
 * or an undershirt sleeve, then bands (rarely over a sleeve), two pieces at most. Each piece has its own draw.
 */
export function ownGear(player: Pick<Player, 'id' | 'position'>): Gear {
  const { id, position } = player;
  const r = GEAR_RATES[position];
  const gear: Gear = {};
  let pieces = 0;
  const room = () => pieces < GEAR_MAX;
  if (r.brace && roll(id, 'brace') < r.brace) {
    gear.shoulderBrace = { side: oneSide(id, 'braceSide'), strap: roll(id, 'strap') < 0.5 ? 'primary' : 'secondary' };
    pieces++;
  }
  if (r.elbowPads && room() && roll(id, 'pads') < r.elbowPads) {
    const side = roll(id, 'padsBoth') < 0.75 ? 'both' : oneSide(id, 'padsSide');
    gear.elbowPads = { color: weighted(id, 'padsColor', PAD_COLORS), side };
    pieces++;
  }
  // a quarterback's single sleeve is on his throwing arm (the right: no handedness yet); shooter sleeves on both
  // arms are mostly the secondary's
  const sleeveSide = (length: SleeveLength): Side => {
    const both = length === 'shooter' ? (r.shooterBoth ?? 0.2) : (r.bothArms ?? 0.5);
    return roll(id, 'sleeveBoth') < both ? 'both' : position === 'QB' ? 'right' : oneSide(id, 'sleeveSide');
  };
  if (r.sleeve && room() && roll(id, 'sleeve') < r.sleeve) {
    const length = weighted(id, 'length', [...LENGTHS, ['shooter', r.shooter ?? 10] as const]);
    gear.sleeve = { length, color: weighted(id, 'sleeveColor', SLEEVE_COLORS), side: sleeveSide(length) };
    pieces++;
  } else if (r.undershirt && room() && roll(id, 'undershirt') < r.undershirt) {
    gear.undershirt = weighted(id, 'sleeveColor', SLEEVE_COLORS);
    pieces++;
  }
  if (room()) {
    const layered = gear.sleeve ? BANDS_OVER_SLEEVE : 1;
    if (r.biceps && roll(id, 'biceps') < r.biceps * layered) {
      const side = roll(id, 'bicepsBoth') < 0.85 ? 'both' : oneSide(id, 'bandSide');
      gear.band = { at: 'biceps', color: weighted(id, 'bandColor', BAND_COLORS), side };
    } else if (r.forearm && roll(id, 'forearm') < r.forearm * layered) {
      gear.band = { at: 'forearm', color: weighted(id, 'bandColor', BAND_COLORS), side: oneSide(id, 'bandSide') };
    }
  }
  return gear;
}

/**
 * Whether a team plays this week's game (or `game`) in the cold: open air at `COLD_KICKOFF_F` or colder at
 * kickoff, or snow, or heavy rain. A pure function of the game, like the hot-day white jerseys; a bye and the
 * offseason are never cold.
 */
export function coldGame(league: League | null, teamId: number, game?: Game): boolean {
  const inSeason = league?.phase === 'regular' || league?.phase === 'playoffs';
  const g =
    game ??
    (league && inSeason ? gamesInWeek(league).find((x) => x.homeId === teamId || x.awayId === teamId) : undefined);
  if (!league || !g || (g.homeId !== teamId && g.awayId !== teamId)) return false;
  const w = gameWeather(league, g);
  if (w.roof !== 'outdoors' && w.roof !== 'open') return false;
  return w.tempF <= COLD_KICKOFF_F || w.precip === 'snow' || w.heavy === true;
}
