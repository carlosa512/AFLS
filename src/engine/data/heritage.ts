/**
 * Who draws names from which heritage pool (`names.ts`), and how often scouts and medical staff are women.
 * Moddable like the pools. Heritage is only ever used to pick a name: it is never stored on a person and
 * nothing in the sim reads it.
 *
 * Sources (see docs/NAMES.md): the TIDES NFL Racial and Gender Report Cards (players 53.5% Black in 2023,
 * Pacific Islander 1.8%, Asian 0.1%; assistant coaches 43.6% people of color, 36.9% Black), published
 * position studies (kickers and punters about 95% white, cornerbacks overwhelmingly Black, half of 2025's
 * Week 1 quarterbacks Black), team-physician and athletic-trainer surveys, and the 2022 officiating count.
 * Cells nobody publishes are estimates between those anchors. Every heritage keeps a small floor, so a rare
 * name stays possible rather than impossible.
 */
import type { CoachRole, MedicRole, Position, StaffRole } from '../types';
import type { Heritage } from './names';

/** Relative weights over the heritage pools (they needn't sum to 100). */
export type Mix = Readonly<Record<Heritage, number>>;

const mix = (
  white: number,
  black: number,
  hispanic: number,
  pacific: number,
  asian: number,
  native: number,
  african: number,
  international: number,
): Mix => ({
  white,
  black,
  hispanic,
  pacific,
  asian,
  native,
  african,
  international,
});

//                                     white black hisp  pacif asian nativ afric intl
/** Players by position: `african` is African-immigrant heritage (Nigerian, Ghanaian...), about 6% of the league. */
export const PLAYER_MIX: Record<Position, Mix> = {
  QB: /*   */ mix(54, 37, 3, 2, 1, 1, 1, 1),
  RB: /*   */ mix(15, 74, 3, 1, 0.3, 0.3, 4, 3),
  WR: /*   */ mix(16, 70, 3, 1, 0.3, 0.3, 6, 4),
  TE: /*   */ mix(47, 39, 3, 3, 0.3, 1, 4, 3),
  OL: /*   */ mix(38, 43, 3, 7, 0.3, 1, 5, 3),
  DT: /*   */ mix(20, 56, 3, 8, 0.3, 0.5, 10, 3),
  EDGE: /* */ mix(22, 60, 2, 3, 0.3, 0.3, 10, 3),
  LB: /*   */ mix(26, 57, 4, 4, 0.3, 1, 6, 2),
  CB: /*   */ mix(4, 86, 1, 1, 0.3, 0.3, 6, 2),
  S: /*    */ mix(14, 74, 2, 2, 0.3, 0.3, 5, 3),
  K: /*    */ mix(80, 3, 5, 1, 3, 0.3, 0.3, 8),
  P: /*    */ mix(68, 2, 2, 2, 1, 0.3, 0.3, 25), // Australian punters are real
};

const COORDINATOR = mix(70, 22, 3, 1, 2, 0.5, 1, 0.5);
/** Coaches: head coaches about a quarter people of color, position coaches about 44% (TIDES 2023). */
export const COACH_MIX: Record<CoachRole, Mix> = {
  headCoach: mix(75, 16, 5, 1, 2, 0.5, 0.5, 0.5),
  offCoord: COORDINATOR,
  defCoord: COORDINATOR,
  stCoord: COORDINATOR,
  positionCoach: mix(56, 37, 2, 1.5, 1.5, 0.5, 1, 0.5),
  strengthCoach: mix(65, 25, 3, 2, 2, 0.5, 1.5, 1),
};

/** Scouting: the Director looks like a GM's office, area and pro scouts lean more on ex-players. */
export const SCOUT_MIX: Record<StaffRole, Mix> = {
  director: mix(72, 20, 3, 0.5, 2, 0.5, 1, 1),
  collegeScout: mix(65, 25, 4, 1, 2, 0.5, 1.5, 1),
  proScout: mix(65, 25, 4, 1, 2, 0.5, 1.5, 1),
};

/** Medical: team physicians are about 91% white, athletic trainers follow the NATA membership (about 80%). */
export const MEDIC_MIX: Record<MedicRole, Mix> = {
  doctor: mix(88, 4, 2, 0.3, 5, 0.3, 0.4, 0.5),
  physio: mix(80, 8, 4, 1, 5, 0.5, 0.5, 1),
  scientist: mix(72, 6, 6, 1, 10, 0.5, 0.5, 4),
};

/** Referees: about a quarter people of color, most of them Black (2022 report card). */
export const OFFICIAL_MIX: Mix = mix(74, 19, 2, 1, 2, 0.5, 0.5, 1);

/**
 * How often a new scout or medic is a woman, by chair: about 7% of scouts, 3% of physicians (and of
 * Directors, like GMs), 15-20% of athletic trainers and more in sports science. Coaches stay 0.
 */
export const WOMEN_SHARE: Record<StaffRole | MedicRole, number> = {
  director: 0.03,
  collegeScout: 0.07,
  proScout: 0.07,
  doctor: 0.03,
  physio: 0.15,
  scientist: 0.25,
};

const WOMEN_SCOUTING = mix(55, 25, 8, 1, 6, 0.5, 2, 2.5);
/** Women by field: scouting hires are more spread out than the men's; medicine follows its own pipeline. */
export const WOMEN_MIX: Record<StaffRole | MedicRole, Mix> = {
  director: WOMEN_SCOUTING,
  collegeScout: WOMEN_SCOUTING,
  proScout: WOMEN_SCOUTING,
  doctor: mix(80, 5, 4, 0.5, 9, 0.5, 0.5, 0.5),
  physio: mix(72, 6, 8, 1, 9, 0.5, 1, 2.5),
  scientist: mix(68, 6, 8, 1, 12, 0.5, 1, 3.5),
};

/**
 * Share of people whose surname comes from a second draw of their mix: mixed-heritage families, adoption,
 * marriage. It's why a Jaylen Kowalski or a Mateo Johnson turns up now and then.
 */
export const MIXED_SURNAME = 0.12;
