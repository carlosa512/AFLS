import { originOf } from '../engine/origin';
import { starters } from '../engine/roster';
import { isProspect } from '../engine/scouting';
import type { HelmetDesign, HelmetModel, League, Player, Position, Team } from '../engine/types';
import { contrast, readableOn } from './color';
import { pick } from './staffLook';

// The rules behind the avatar's helmet (`docs/AVATARS.md`): who wears one, which shell, the mask, the club's design and
// the decals on the back. The drawing is in `helmetArt.tsx`. Nothing here reads ratings; every pick is stable from the
// player's id, like his sleeves (`playerGear.ts`).

/** The helmet's size against the mockups' first modern shell, scaled about the middle of the head (50, 26). */
export const HELMET_SCALE = 0.85;
/** Where the back's lowest point sits on an average build, in the figure's units: a little above the collar. */
export const HELMET_NECK_Y = 38.8;
/** How much higher it rides for each step a build's shoulders rise toward the collar, so linemen keep some neck. */
export const HELMET_NECK_PER_TRAP = 0.5;

/** A helmet only with a club: free agents, draft prospects until they're drafted, and retired players go bareheaded. */
export function wearsHelmet(
  player: Pick<Player, 'teamId' | 'retired' | 'scouting' | 'draft'>,
  team: Team | null,
): boolean {
  return team !== null && !player.retired && !isProspect(player as Player);
}

/** The shells by our own names, as the gear editor lists them. */
export const HELMET_LABEL: Record<HelmetModel, string> = {
  modern: 'Modern',
  modernSmooth: 'Modern, smooth',
  plated: 'Plated',
  classic: 'Classic',
  pod: 'Pod',
  podWide: 'Pod, wide',
  ridgeback: 'Ridgeback',
  retro: 'Retro',
};

type Group = 'qb' | 'skill' | 'middle' | 'line' | 'kick';
const GROUP: Record<Position, Group> = {
  QB: 'qb',
  RB: 'skill',
  WR: 'skill',
  CB: 'skill',
  S: 'skill',
  LB: 'middle',
  EDGE: 'middle',
  TE: 'middle',
  OL: 'line',
  DT: 'line',
  K: 'kick',
  P: 'kick',
};
/**
 * How often each position group wears each shell (an AFLS estimate, tuned by eye on a league's rosters): the wide pod
 * up front and in the middle, the older shapes for kickers.
 */
export const HELMET_WEIGHTS: Record<Group, Partial<Record<HelmetModel, number>>> = {
  qb: { modern: 35, modernSmooth: 20, plated: 15, pod: 20, ridgeback: 10 },
  skill: { modern: 25, modernSmooth: 15, plated: 15, pod: 20, ridgeback: 15, retro: 10 },
  middle: { modern: 25, modernSmooth: 5, plated: 20, classic: 10, pod: 15, podWide: 15, ridgeback: 10 },
  line: { modern: 20, modernSmooth: 10, plated: 20, classic: 15, podWide: 35 },
  kick: { modern: 10, modernSmooth: 20, classic: 30, pod: 15, retro: 25 },
};

/** His shell: the one you picked for him, or his own, drawn once from his id by his position's weights. */
export function helmetModelOf(player: Pick<Player, 'id' | 'position' | 'gear'>): HelmetModel {
  if (player.gear?.helmet) return player.gear.helmet;
  const options = Object.entries(HELMET_WEIGHTS[GROUP[player.position]]) as [HelmetModel, number][];
  const total = options.reduce((a, [, w]) => a + w, 0);
  let x = (pick(String(player.id), 'gear:helmet', 1_000_000) / 1_000_000) * total;
  for (const [model, weight] of options) if ((x -= weight) < 0) return model;
  return options[options.length - 1][0];
}

/** The facemask's lower corners as they show from behind: one bar out wide, two in the middle, the full cage up front. */
export type MaskKind = 'qb' | 'skill' | 'hybrid' | 'line' | 'kicker';
export function maskOf(position: Position): MaskKind {
  if (position === 'QB') return 'qb';
  if (position === 'OL' || position === 'DT') return 'line';
  if (position === 'LB' || position === 'EDGE' || position === 'TE') return 'hybrid';
  if (position === 'K' || position === 'P') return 'kicker';
  return 'skill';
}

const GREY_MASK = '#9AA3AD';
/**
 * The club's helmet, or for a club without one (a mod's) one built from its colours: its primary as a gloss shell, a
 * single stripe in its secondary (or light or dark, when the secondary doesn't stand off the shell), no number, the
 * secondary as bumper and a grey mask.
 */
export function helmetDesignOf(team: Pick<Team, 'colors' | 'helmet'>): HelmetDesign {
  if (team.helmet) return team.helmet;
  const [primary, secondary] = team.colors;
  const stripeA = contrast(primary, secondary) >= 1.8 ? secondary : readableOn(primary, secondary);
  return { shell: primary, finish: 'gloss', stripe: 'single', stripeA, bumper: secondary, mask: GREY_MASK };
}

/** A shell dark enough to melt into a dark jersey: it gets a rim of light (`helmetArt.tsx`). */
export const isDarkShell = (hex: string) => contrast(hex, '#000000') < 2.4;

export type FlagCode =
  | 'US'
  | 'DE'
  | 'GB'
  | 'AU'
  | 'NG'
  | 'MX'
  | 'FR'
  | 'AT'
  | 'IT'
  | 'BR'
  | 'JP'
  | 'GH'
  | 'NZ'
  | 'CA'
  | 'IE'
  | 'SE';
/** The International Pathway's countries (`data/origins.ts`), by name, to their flags. */
export const PATHWAY_FLAGS: Record<string, FlagCode> = {
  Germany: 'DE',
  'United Kingdom': 'GB',
  Australia: 'AU',
  Nigeria: 'NG',
  Mexico: 'MX',
  France: 'FR',
  Austria: 'AT',
  Italy: 'IT',
  Brazil: 'BR',
  Japan: 'JP',
  Ghana: 'GH',
  'New Zealand': 'NZ',
  Canada: 'CA',
  Ireland: 'IE',
  Sweden: 'SE',
};

/**
 * The flags on the back, the US flag on top as on every NFL helmet. The NFL's Heritage Program lets a player add a
 * country he or his family comes from; the game knows one only through the Pathway, so a Pathway player's country goes
 * under it, all season. A CFL arrival's league isn't where he's from.
 */
export function flagsOf(player: Pick<Player, 'origin'>): FlagCode[] {
  const o = originOf(player as Player);
  const country = o?.kind === 'pathway' ? PATHWAY_FLAGS[o.name] : undefined;
  return country ? ['US', country] : ['US'];
}

/**
 * The green dot: the one helmet on each side with the coach's radio. The starting quarterback, and the defence's
 * play-caller, the first linebacker (the MLB or MIKE spot in every scheme), or a safety when there's none. It follows
 * the depth chart, which is public.
 */
export function greenDotOf(league: League, team: Team, player: Pick<Player, 'id'>): boolean {
  const qb = starters(league, team, 'QB')[0];
  const caller = starters(league, team, 'LB')[0] ?? starters(league, team, 'S')[0];
  return qb?.id === player.id || caller?.id === player.id;
}
