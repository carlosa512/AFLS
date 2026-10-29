/**
 * The one scale every mood effect reads (G2, docs/superpowers/specs/2026-10-29-morale-effects-design.md). Its own module,
 * free of imports, so the effects (development, the lineup, training, negotiation) all read the same two functions
 * however the modules around `morale.ts` load, and a test can hold every effect at zero by mocking this one file.
 */
import { clamp } from './rng';

/** His mood as −1…+1: Superb (≥ 6) is +1, Abysmal (≤ −6) −1, Okay about 0. Talks and position learning read it. */
export const moodLean = (level: number): number => clamp(level / 6, -1, 1);

/**
 * The lean measured against a mean (`moraleMean`, or the young players' for growth): growth and game day read it, so
 * however happy the league runs, its totals hold.
 */
export const moodPull = (level: number, mean: number): number => clamp((level - mean) / 6, -1, 1);
