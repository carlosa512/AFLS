import type { Foul, Player } from '../types';
import { roughness } from './lineup';
import { temperamentOf, TRAIT_MEAN } from '../traits';

/**
 * A player is thrown out only for the NFL's reasons (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`): a
 * fight after the whistle, a second unsportsmanlike conduct foul in one game (automatic, no dice) and, very rarely, a
 * flagrant hit. Every draw is on the game's own `:eject` stream, so with `on` false every other roll is unchanged.
 * `fight` is the odds the after-the-whistle foul on a sack was a fight; `fightBack` that the man he
 * hit swings back; `flagrant` the odds an accepted personal foul is judged flagrant. Starting odds from
 * `docs/research/discipline.md` (about 15 a league season, most of them fights); the discipline check tunes them.
 */
export const EJECT: { on: boolean; fight: number; fightBack: number; flagrant: Partial<Record<Foul, number>> } = {
  on: true,
  fight: 0.3,
  fightBack: 0.25,
  flagrant: { roughingPasser: 0.016, unnecessaryRoughness: 0.016, horseCollar: 0.012 },
};

/** A short temper starts it and keeps it going: about ±2.5 across the league's range. */
export const hotHead = (p: Player) => Math.exp(-0.18 * (temperamentOf(p) - TRAIT_MEAN));

/** A dirty player's hit is the one the league calls flagrant (the same lean as the late hit itself). */
export const flagrantLean = (p: Player) => Math.exp(-0.06 * (roughness(p) - 11));
