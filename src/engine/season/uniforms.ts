import { UNIFORMS } from '../data/uniforms';
import { Rng } from '../rng';
import type { Game, League } from '../types';
import { isPrimeTime } from './kickoff';

/** The last week a special uniform can fall in: week 18's slots are only set once week 17 is played. */
const LAST_WEEK = 17;
/** Alternates a club wears a season at most, and classics; with both at two, never more than the NFL's four. */
const ALTERNATES = 2;

/**
 * Stamps each club's special uniforms on its home games (`Game.uniform`) when the schedule is made, as the NFL's clubs
 * do: up to two primetime home games in an alternate, Thursday nights first (a club with a blackout wears its colour
 * rush, then its blackout), and one or two classics, division games first and never in back-to-back weeks. The slot
 * read is the one it was scheduled in, so a flex never changes it. Its own stream, so the schedule's is untouched.
 */
export function assignUniforms(league: League, games: Game[], season: number): void {
  const rng = new Rng(`${league.seed}:${season}:uniforms`);
  const slot = (g: Game) => g.flexed ?? g.kickoff;
  for (const team of league.teams) {
    const home = games
      .filter((g) => g.homeId === team.id && !g.playoffRound && g.week <= LAST_WEEK)
      .sort((a, b) => a.week - b.week);
    const blackout = !!(team.uniforms ?? UNIFORMS[team.abbrev])?.blackout;
    const prime = home
      .filter((g) => {
        const k = slot(g);
        return !!k && isPrimeTime(k);
      })
      .sort((a, b) => Number(slot(b)!.day === 'thu') - Number(slot(a)!.day === 'thu') || a.week - b.week)
      .slice(0, ALTERNATES);
    prime.forEach((g, i) => (g.uniform = i === 1 && blackout ? 'blackout' : 'rush'));

    const want = rng.chance(0.5) ? 2 : 1;
    const others = home.filter((g) => !g.uniform);
    const division = (g: Game) => league.teams[g.awayId].division === team.division;
    const order = [...rng.shuffle(others.filter(division)), ...rng.shuffle(others.filter((g) => !division(g)))];
    const picked: Game[] = [];
    for (const g of order) {
      if (picked.length === want) break;
      if (picked.some((p) => Math.abs(p.week - g.week) <= 1)) continue;
      g.uniform = 'classic';
      picked.push(g);
    }
  }
}
