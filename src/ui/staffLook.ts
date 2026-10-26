// What a staff member wears today. Pure: the same person on the same day always looks the same,
// so nothing is saved. The person decides the outfit (seeded by id); the day can override it.
import type { CoachRole, MedicRole, StaffRole } from '../engine/types';

export type Garment = 'hoodie' | 'quarterzip' | 'polo' | 'tee' | 'jacket' | 'blazer' | 'labcoat' | 'scrubs';
export type Headwear = 'none' | 'cap' | 'visor' | 'beanie';
export type Gear = 'headset' | 'credential' | 'stethoscope' | 'cross' | 'whistle' | 'none';
export type Hair = 'bun' | 'ponytail' | 'bob' | 'long';
export type StaffFamily = 'coach' | 'strength' | 'scout' | 'director' | 'medical' | 'gm';
export type StaffDay = 'game' | 'cold' | 'hot' | 'offseason';

export interface StaffLook {
  garment: Garment;
  headwear: Headwear;
  gear: Gear;
  /** Index into the head shapes (five for men, three for women). */
  head: number;
  woman: boolean;
  hair: Hair;
}

type Outfit = [Garment, Headwear, Gear];
const WARDROBE: Record<StaffFamily, Outfit[]> = {
  coach: [
    ['hoodie', 'none', 'headset'],
    ['quarterzip', 'none', 'headset'],
    ['polo', 'cap', 'headset'],
    ['jacket', 'none', 'headset'],
  ],
  // the weight room's uniform: a tee and a whistle, no headset (he runs warm-ups, not the play sheet)
  strength: [
    ['tee', 'none', 'whistle'],
    ['tee', 'cap', 'whistle'],
    ['quarterzip', 'none', 'whistle'],
    ['hoodie', 'none', 'whistle'],
  ],
  scout: [
    ['polo', 'cap', 'credential'],
    ['quarterzip', 'none', 'credential'],
    ['jacket', 'none', 'credential'],
    ['polo', 'none', 'credential'],
  ],
  director: [['blazer', 'none', 'credential']], // the Director always wears the suit
  gm: [
    ['blazer', 'none', 'none'],
    ['quarterzip', 'none', 'credential'],
    ['polo', 'none', 'credential'],
    ['jacket', 'none', 'none'],
  ],
  medical: [
    ['polo', 'none', 'cross'],
    ['scrubs', 'none', 'stethoscope'],
    ['quarterzip', 'none', 'stethoscope'],
    ['labcoat', 'none', 'stethoscope'],
  ],
};
const OFFSEASON: Record<StaffFamily, Outfit> = {
  coach: ['quarterzip', 'none', 'none'], // no headset without games
  strength: ['tee', 'none', 'whistle'], // the offseason program is his busiest stretch
  scout: ['blazer', 'none', 'credential'],
  director: ['blazer', 'none', 'credential'],
  gm: ['blazer', 'none', 'none'],
  medical: ['labcoat', 'none', 'stethoscope'],
};
const HAIRS: Hair[] = ['bun', 'ponytail', 'bob', 'long'];
const MEN_HEADS = 5;
const WOMEN_HEADS = 3;

/** Which wardrobe a chair dresses from. Role names never repeat across coaches, scouts and medics. */
export const STAFF_FAMILY: Record<CoachRole | StaffRole | MedicRole, Exclude<StaffFamily, 'gm'>> = {
  headCoach: 'coach',
  offCoord: 'coach',
  defCoord: 'coach',
  positionCoach: 'coach',
  stCoord: 'coach',
  strengthCoach: 'strength',
  director: 'director',
  collegeScout: 'scout',
  proScout: 'scout',
  doctor: 'medical',
  physio: 'medical',
  scientist: 'medical',
};

// FNV-1a: a stable pick per person and purpose. Not randomness, so it doesn't go through Rng.
export function pick(id: string, salt: string, n: number): number {
  let h = 2166136261;
  for (const ch of salt + id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

/** `id` is unique across every kind of staff (a scout and a coach can share a number), e.g. `coach:12`. */
export function staffLook(id: string, family: StaffFamily, woman: boolean, day: StaffDay): StaffLook {
  let [garment, headwear, gear] =
    day === 'offseason' ? OFFSEASON[family] : WARDROBE[family][pick(id, 'wear', WARDROBE[family].length)];
  if (day === 'cold') [garment, headwear] = ['jacket', 'beanie'];
  if (day === 'hot') [garment, headwear] = [family === 'strength' ? 'tee' : 'polo', 'visor'];
  if (garment !== 'polo' && garment !== 'jacket' && gear === 'cross') gear = 'stethoscope'; // the cross is a chest patch
  const head = pick(id, 'head', woman ? WOMEN_HEADS : MEN_HEADS);
  // with a blazer, hair is always long (the Director's look, picked in design)
  const hair = garment === 'blazer' ? 'long' : HAIRS[pick(id, 'hair', HAIRS.length)];
  return { garment, headwear, gear, head, woman, hair };
}
