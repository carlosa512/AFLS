/**
 * Personality: the name a player's character goes by, FM-style ("Consummate Pro", "Mercenary"), and the one sentence a
 * scout would say about him. Both are read off ten things he already has: six hidden traits (1–20) and four of the
 * dials his agent negotiates with (0–1). Nothing here is stored: a name is worked out whenever a screen or a letter
 * needs it, so it follows the player as he changes (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §1).
 */
import { characterRead } from './scouting';
import { TRAIT_MEAN } from './traits';
import type { League, Personality, Player, Traits } from './types';

/** Everything a personality reads. */
export interface Character extends Traits, Personality {}

export type CharacterKey =
  | 'workEthic'
  | 'temperament'
  | 'leads'
  | 'poise'
  | 'controversy'
  | 'sportsmanship'
  | 'loyalty'
  | 'winning'
  | 'greed'
  | 'patience';

export type PersonalityName =
  | 'Locker-Room Lawyer'
  | 'Born Leader'
  | 'Dirty Player'
  | 'Volatile'
  | 'Diva'
  | 'Consummate Pro'
  | 'Clutch'
  | 'Jittery'
  | 'Mercenary'
  | 'Ring Chaser'
  | 'Company Man'
  | 'Hothead'
  | 'Driven'
  | 'Fiery Competitor'
  | 'Quiet Pro'
  | 'Coaster'
  | 'Easygoing'
  | 'Even-Keeled';

/**
 * The parts of a character whose job has shipped. A name or a sentence never leans on one that doesn't do anything
 * yet: leadership arrives with mentoring, controversy with feuds.
 */
export const TRAITS_ON: ReadonlySet<CharacterKey> = new Set<CharacterKey>([
  'workEthic',
  'temperament',
  'poise',
  'sportsmanship',
  'loyalty',
  'winning',
  'greed',
  'patience',
]);

const TRAIT_SD = 3.5;

/** How far each part sits from the league's average, in spreads (dials as `generatePersonality` rolls them). */
export function characterZ(c: Character): Record<CharacterKey, number> {
  const t = (x: number) => (x - TRAIT_MEAN) / TRAIT_SD;
  return {
    workEthic: t(c.workEthic),
    temperament: t(c.temperament),
    leads: t(c.leads),
    poise: t(c.poise),
    controversy: t(c.controversy),
    sportsmanship: t(c.sportsmanship),
    loyalty: (c.loyalty - 0.5) / 0.22,
    winning: (c.winning - 0.5) / 0.22,
    greed: (c.greed - 0.5) / 0.289,
    patience: (c.patience - 0.55) / 0.2,
  };
}

type Z = Record<CharacterKey, number>;

/** Checked in order, the first that holds names him: the rarer and sharper reads come first. */
const RULES: { name: PersonalityName; needs: CharacterKey[]; holds: (z: Z) => boolean }[] = [
  // The room listens to him, and he stirs it.
  { name: 'Locker-Room Lawyer', needs: ['leads', 'controversy'], holds: (z) => z.leads >= 1 && z.controversy >= 1 },
  { name: 'Born Leader', needs: ['leads'], holds: (z) => z.leads >= 1.5 },
  { name: 'Dirty Player', needs: ['sportsmanship'], holds: (z) => z.sportsmanship <= -1.75 },
  {
    name: 'Volatile',
    needs: ['temperament', 'controversy'],
    holds: (z) => z.temperament <= -1 && z.controversy >= 1,
  },
  { name: 'Diva', needs: ['greed', 'controversy'], holds: (z) => z.greed >= 1 && z.controversy >= 0.5 },
  {
    name: 'Consummate Pro',
    needs: ['workEthic', 'temperament', 'sportsmanship'],
    holds: (z) => z.workEthic >= 1 && z.temperament >= 0.5 && z.sportsmanship >= 0,
  },
  { name: 'Clutch', needs: ['poise'], holds: (z) => z.poise >= 1.5 },
  { name: 'Jittery', needs: ['poise'], holds: (z) => z.poise <= -1.6 },
  { name: 'Mercenary', needs: ['greed', 'loyalty'], holds: (z) => z.greed >= 0.9 && z.loyalty <= -0.45 },
  { name: 'Ring Chaser', needs: ['winning', 'loyalty'], holds: (z) => z.winning >= 1 && z.loyalty <= -0.5 },
  { name: 'Company Man', needs: ['loyalty'], holds: (z) => z.loyalty >= 1.35 },
  { name: 'Hothead', needs: ['temperament'], holds: (z) => z.temperament <= -1.5 },
  { name: 'Driven', needs: ['workEthic', 'winning'], holds: (z) => z.workEthic >= 1 && z.winning >= 0.5 },
  {
    name: 'Fiery Competitor',
    needs: ['winning', 'temperament'],
    holds: (z) => z.winning >= 0.7 && z.temperament <= -0.25,
  },
  { name: 'Quiet Pro', needs: ['workEthic', 'leads'], holds: (z) => z.workEthic >= 0.75 && z.leads <= -0.25 },
  { name: 'Coaster', needs: ['workEthic'], holds: (z) => z.workEthic <= -1.25 },
  {
    name: 'Easygoing',
    needs: ['greed', 'patience', 'winning'],
    holds: (z) => z.greed <= -0.4 && z.patience >= 0.4 && z.winning <= 0,
  },
];

/** The one name his character goes by. */
export function personalityOf(c: Character, on: ReadonlySet<CharacterKey> = TRAITS_ON): PersonalityName {
  const z = characterZ(c);
  return RULES.find((r) => r.needs.every((k) => on.has(k)) && r.holds(z))?.name ?? 'Even-Keeled';
}

/** What a scout says about each part, at either end. */
const PHRASES: Record<CharacterKey, [high: string, low: string]> = {
  workEthic: ['outworks everyone', 'has to be pushed'],
  temperament: ['keeps his cool', 'loses his head'],
  leads: ['the room follows him', 'keeps to himself'],
  poise: ['wants the ball late', 'tightens up when it counts'],
  controversy: ['says what he thinks, to anyone', 'never a word out of place'],
  sportsmanship: ['plays it clean', 'plays past the whistle'],
  loyalty: ['wants to stay put', 'no ties to anywhere'],
  winning: ['wants a ring', 'happy wherever'],
  greed: ['wants top dollar', 'not about the money'],
  patience: ['takes his time at the table', 'wants a deal done fast'],
};

/** One sentence on the one or two things that stand out most: an average man gets a sentence saying so. */
export function characterLine(c: Character, on: ReadonlySet<CharacterKey> = TRAITS_ON): string {
  const z = characterZ(c);
  const stand = [...on]
    .filter((k) => Math.abs(z[k]) >= 1)
    .sort((a, b) => Math.abs(z[b]) - Math.abs(z[a]))
    .slice(0, 2)
    .map((k) => PHRASES[k][z[k] > 0 ? 0 : 1]);
  if (!stand.length) return 'Nothing about him stands out.';
  const s = stand.join(' and ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** The truth about a player's character: for the engine and tests, never a screen. */
export const trueCharacter = (p: Pick<Player, 'traits' | 'personality'>): Character => ({
  ...p.traits,
  ...p.personality,
});

/**
 * What `teamId`'s scouts call him, from their own read, or null until they know him well enough. Hedged while the read
 * is still loose (the same rule as the makeup notes).
 */
export function personalityRead(
  league: League,
  teamId: number,
  p: Player,
): { name: PersonalityName; line: string; hedged: boolean } | null {
  const read = characterRead(league, teamId, p);
  if (!read) return null;
  return { name: personalityOf(read), line: characterLine(read), hedged: !read.exact && read.sd > 1.2 };
}
