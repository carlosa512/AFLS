/**
 * One league for the size check's long run (`scripts/size.ts`): play `seasons` seasons and count, after each offseason,
 * each position's rostered players at and past the founding bounds (`sizeLimits(pos, 'founding')`), and anyone outside
 * the arrival bounds. Every founding player is gone within about twenty seasons, so the last seasons show the league
 * the arrival curve makes on its own. The check runs it in its own process and judges the counts.
 */
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { sizeLimits } from '../src/engine/size';
import { POSITIONS, type League, type Position } from '../src/engine/types';

export interface SeasonCount {
  n: number;
  atMax: number;
  atMin: number;
  past: number;
}
export interface LongRun {
  seasons: Record<Position, SeasonCount>[];
  strays: number;
  rare: { pos: Position; heightIn: number; weightLb: number; drafted: number | null }[];
}

function count(league: League, run: LongRun, seen: Set<number>): void {
  const season = Object.fromEntries(POSITIONS.map((pos) => [pos, { n: 0, atMax: 0, atMin: 0, past: 0 }])) as Record<
    Position,
    SeasonCount
  >;
  for (const p of Object.values(league.players)) {
    if (p.retired || p.teamId === null) continue;
    const tight = sizeLimits(p.position, 'founding');
    const wide = sizeLimits(p.position, 'arrival');
    const c = season[p.position];
    c.n++;
    if (p.heightIn >= tight.h[1]) c.atMax++;
    if (p.heightIn <= tight.h[0]) c.atMin++;
    const past =
      p.heightIn < tight.h[0] || p.heightIn > tight.h[1] || p.weightLb < tight.w[0] || p.weightLb > tight.w[1];
    if (past) {
      c.past++;
      if (!seen.has(p.id)) {
        seen.add(p.id);
        run.rare.push({
          pos: p.position,
          heightIn: p.heightIn,
          weightLb: p.weightLb,
          drafted: p.draft?.season ?? null,
        });
      }
    }
    if (p.heightIn < wide.h[0] || p.heightIn > wide.h[1] || p.weightLb < wide.w[0] || p.weightLb > wide.w[1])
      run.strays++;
  }
  run.seasons.push(season);
}

export function runLong(seed: string, seasons: number): LongRun {
  const league = createLeague({ seed });
  const run: LongRun = { seasons: [], strays: 0, rare: [] };
  const seen = new Set<number>();
  for (let s = 0; s < seasons; s++) {
    simToEndOfSeason(league);
    beginOffseason(league);
    while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
    count(league, run, seen);
  }
  return run;
}

if (process.env.SIZE_LONG_SEED && process.send) {
  process.send(runLong(process.env.SIZE_LONG_SEED, Number(process.env.SIZE_LONG_SEASONS ?? 20)));
}
