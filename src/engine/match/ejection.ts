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
/**
 * The league's dangerous fouls, the spec's three: the review counts them in a pattern (`reviewWeek`) and a flagrant one
 * can put a man out. One list for both.
 */
export const DANGEROUS_FOULS: readonly Foul[] = ['roughingPasser', 'unnecessaryRoughness', 'faceMask'];

export const EJECT: { on: boolean; fight: number; fightBack: number; flagrant: Partial<Record<Foul, number>> } = {
  on: true,
  fight: 0.138,
  fightBack: 0.19,
  // Face mask took horse collar's place in the list. Horse collar was called 0.0005 a tackled play and judged flagrant
  // 0.013 of the time (6.5e-6 a play); face mask is called 0.0029 (`FACE_MASK` in gameSim.ts), so 0.0022 keeps the
  // expected flagrant ejections a season where they were (0.0029 x 0.0022 = 6.4e-6).
  flagrant: { roughingPasser: 0.017, unnecessaryRoughness: 0.017, faceMask: 0.0022 },
};

/** A short temper starts it and keeps it going: about ±3 across the league's range. */
export const hotHead = (p: Player) => Math.exp(-0.28 * (temperamentOf(p) - TRAIT_MEAN));

/** A dirty player's hit is the one the league calls flagrant (the same lean as the late hit itself). */
export const flagrantLean = (p: Player) => Math.exp(-0.06 * (roughness(p) - 11));
