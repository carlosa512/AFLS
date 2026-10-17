/**
 * One league for the career audit's Part 2 (`scripts/careers.ts`): play `seasons` seasons on a seed
 * and collect what the audit judges, from the steady state (the second half of the run). The audit
 * runs one of these per seed in its own process and pools them.
 */
import { coachingFor, staffScore, teamCoaches } from '../src/engine/coaching';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { playerOvr, STARTERS } from '../src/engine/positions';
import type { Position } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';

export interface LeagueRun {
  seed: string;
  /** Mean starter OVR after each season's offseason. */
  starterOvr: number[];
  /** Mean starter awareness at the start and the end. */
  awareness: [number, number];
  /** Age at retirement of rostered players, by group (steady state). */
  retiredAt: Record<string, number[]>;
  /** Yearly OVR change of rostered players, by age bucket. */
  deltas: Record<string, number[]>;
  steady: { qb35: number[]; k38: number[]; rb30: number[]; points: number[]; penalties: number[]; sacks: number[] };
  /** What coaching applies league-wide (it must stay neutral). */
  ledger: { growth: number[]; body: number[]; craft: number[] };
  /** Young players' yearly OVR change under the best-8 and worst-8 coaching staffs. */
  coached: { best: number[]; worst: number[] };
  /** Final starters' positions and ages. */
  starterAges: { position: Position; age: number }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function runLeague(seed: string, seasons: number): LeagueRun {
  const steadyFrom = Math.floor(seasons / 2);
  const league = createLeague({ seed });
  const out: LeagueRun = {
    seed,
    starterOvr: [],
    awareness: [0, 0],
    retiredAt: {},
    deltas: { '21-25': [], '26-29': [], '30-33': [], '34+': [] },
    steady: { qb35: [], k38: [], rb30: [], points: [], penalties: [], sacks: [] },
    ledger: { growth: [], body: [], craft: [] },
    coached: { best: [], worst: [] },
    starterAges: [],
  };
  const starters = () => league.teams.flatMap((t) => POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id])));
  const awareness = () => mean(starters().map((p) => p.ratings.awareness));
  out.awareness[0] = awareness();

  for (let s = 0; s < seasons; s++) {
    simToEndOfSeason(league);
    if (s >= steadyFrom) {
      for (const g of league.games) {
        if (g.season !== league.season || g.playoffRound || !g.result) continue;
        const r = g.result;
        out.steady.points.push((r.homeScore + r.awayScore) / 2);
        out.steady.penalties.push((r.home.penalties + r.away.penalties) / 2);
        out.steady.sacks.push((r.home.sacked + r.away.sacked) / 2);
      }
    }
    const before = new Map(Object.values(league.players).filter((p) => !p.retired).map((p) => [p.id, { ovr: playerOvr(p), age: p.age, rostered: p.teamId !== null, team: p.teamId }]));
    const ranked = [...league.teams].sort((a, b) => staffScore(teamCoaches(league, b.id)) - staffScore(teamCoaches(league, a.id))).map((t) => t.id);
    if (s >= steadyFrom) {
      for (const p of Object.values(league.players)) {
        if (p.retired || p.teamId === null || p.position === 'K' || p.position === 'P') continue;
        const c = coachingFor(league, p.teamId, p.position);
        if (p.age < 26) out.ledger.growth.push(c.rate);
        if (p.age >= 28) {
          out.ledger.body.push(c.decline.physical);
          out.ledger.craft.push(c.decline.technical);
        }
      }
    }
    beginOffseason(league);
    for (const [id, b] of before) {
      const p = league.players[id];
      if (p.retired) {
        const group = p.position === 'K' || p.position === 'P' ? 'K/P' : p.position;
        if (b.rostered && s >= steadyFrom) (out.retiredAt[group] ??= []).push(p.age);
        continue;
      }
      if (!b.rostered) continue;
      const bucket = b.age <= 25 ? '21-25' : b.age <= 29 ? '26-29' : b.age <= 33 ? '30-33' : '34+';
      out.deltas[bucket].push(playerOvr(p) - b.ovr);
      if (b.age <= 25 && s >= steadyFrom) {
        if (ranked.slice(0, 8).includes(b.team!)) out.coached.best.push(playerOvr(p) - b.ovr);
        if (ranked.slice(-8).includes(b.team!)) out.coached.worst.push(playerOvr(p) - b.ovr);
      }
    }
    while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
    out.starterOvr.push(mean(starters().map(playerOvr)));
    if (s >= steadyFrom) {
      const first = (pos: Position) => league.teams.map((t) => league.players[t.depthChart[pos][0]]);
      out.steady.qb35.push((100 * first('QB').filter((p) => p.age >= 35).length) / 32);
      out.steady.rb30.push((100 * first('RB').filter((p) => p.age >= 30).length) / 32);
      out.steady.k38.push(first('K').filter((p) => p.age >= 38).length + first('P').filter((p) => p.age >= 38).length);
    }
  }
  out.awareness[1] = awareness();
  out.starterAges = starters().map((p) => ({ position: p.position, age: p.age }));
  return out;
}

// Run as the audit's child process: one seed, results back to the parent.
if (process.env.CAREERS_SEED && process.send) {
  process.send(runLeague(process.env.CAREERS_SEED, Number(process.env.CAREERS_SEASONS ?? 16)));
}
