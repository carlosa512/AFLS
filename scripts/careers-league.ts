/**
 * One league for the career audit's Part 2 (`scripts/careers.ts`): play `seasons` seasons on a seed
 * and collect what the audit judges, from the steady state (the second half of the run). The audit
 * runs one of these per seed in its own process and pools them.
 */
import { workEthicOf } from '../src/engine/traits';
import { coachingForPlayer, NEUTRAL, staffScore, teamCoaches } from '../src/engine/coaching';
import { developPlayer, playedShare, rollInputs, trueUp } from '../src/engine/development';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { hasTree, liveTrees, treeFor, treeOf } from '../src/engine/trees';
import { playerOvr, STARTERS } from '../src/engine/positions';
import { Rng } from '../src/engine/rng';
import { regularSeasonGames } from '../src/engine/season/standings';
import { bodyAs } from '../src/engine/training';
import type { Position } from '../src/engine/types';
import { POSITIONS } from '../src/engine/types';
import { seasonTops } from './leaders';

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
  steady: {
    qb35: number[];
    k38: number[];
    rb30: number[];
    points: number[];
    penalties: number[];
    sacks: number[];
    /** Each steady season's spread of team wins (SD), against a fresh league's in the sim check. */
    winSpread: number[];
  };
  /** What coaching applies league-wide (it must stay neutral); kickers and punters apart, they have their own blend. */
  ledger: { growth: number[]; body: number[]; craft: number[]; kpGrowth: number[]; kpCraft: number[] };
  /**
   * What coaching did to young players' yearly OVR, paired: each player's year replayed on his own
   * stream with a typical staff and with his real one, so nothing else (playing time, roster mix)
   * leaks in. All rostered players under 26, and those on the best-8 and worst-8 staffs.
   */
  coached: { all: number[]; best: number[]; worst: number[] };
  /** Each steady-state season's top five, by stat. */
  leaders: Record<string, number[][]>;
  /** Final starters' positions and ages. */
  starterAges: { position: Position; age: number }[];
  /**
   * Every pick from the drafts this run held whose class is old enough to judge (five league years on): his round,
   * and whether his true overall reached the line for his round by 27: a high-end starter's at his position (the
   * 60th percentile of its starters) for a first-rounder, a solid starter's (the 30th) for anyone else
   * (docs/research/draft-outcomes.md).
   */
  drafts: { round: number; hit: boolean }[];
  /** Every settled ceiling of those picks: the year in the league it settled in, the change and his work ethic. */
  shifts: { year: number; shift: number; workEthic: number }[];
  /**
   * Coaching trees, season by season (spec §4.6): live trees, the biggest one's active head coaches, the share of head
   * coaches in a live tree; each offseason's new head coaches and how many came from a tree (and the most from one);
   * trees born during the run, and founding trees still alive at the end.
   */
  /** Each season's win share by team, for how long a record lasts (against the NFL's carryover). */
  records: number[][];
  trees: {
    live: number[];
    biggest: number[];
    inTreeShare: number[];
    hires: { total: number; fromTree: number; mostFromOne: number }[];
    born: number;
    foundingAlive: number;
  };
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
    steady: { qb35: [], k38: [], rb30: [], points: [], penalties: [], sacks: [], winSpread: [] },
    ledger: { growth: [], body: [], craft: [], kpGrowth: [], kpCraft: [] },
    coached: { all: [], best: [], worst: [] },
    leaders: {},
    starterAges: [],
    drafts: [],
    shifts: [],
    trees: { live: [], biggest: [], inTreeShare: [], hires: [], born: 0, foundingAlive: 0 },
    records: [],
  };
  const headCoaches = () =>
    new Map(league.teams.map((t) => [t.id, teamCoaches(league, t.id).find((c) => c.role === 'headCoach')?.id]));
  const founding = liveTrees(league).map((t) => t.rootId);
  const rootsAtStart = new Set(
    [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)]
      .filter((c) => hasTree(league, c.id))
      .map((c) => c.id),
  );
  const bornRoots = new Set<number>();
  const firstDraft = league.season + 1;
  const hits = new Set<number>();
  const starters = () =>
    league.teams.flatMap((t) =>
      POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id])),
    );
  const awareness = () => mean(starters().map((p) => p.ratings.awareness));
  out.awareness[0] = awareness();

  for (let s = 0; s < seasons; s++) {
    simToEndOfSeason(league);
    {
      const wins = new Map(league.teams.map((t) => [t.id, 0]));
      const games = regularSeasonGames(league);
      for (const g of games) {
        const r = g.result!;
        const w = r.homeScore > r.awayScore ? g.homeId : r.awayScore > r.homeScore ? g.awayId : null;
        if (w !== null) wins.set(w, wins.get(w)! + 1);
        else for (const id of [g.homeId, g.awayId]) wins.set(id, wins.get(id)! + 0.5);
      }
      const played = (2 * games.length) / league.teams.length;
      out.records.push(league.teams.map((t) => wins.get(t.id)! / played));
    }
    if (s >= steadyFrom) {
      for (const [key, top] of Object.entries(seasonTops(league, league.season))) (out.leaders[key] ??= []).push(top);
      for (const g of league.games) {
        if (g.season !== league.season || g.playoffRound || !g.result) continue;
        const r = g.result;
        out.steady.points.push((r.homeScore + r.awayScore) / 2);
        out.steady.penalties.push((r.home.penalties + r.away.penalties) / 2);
        out.steady.sacks.push((r.home.sacked + r.away.sacked) / 2);
      }
      const wins = new Map(league.teams.map((t) => [t.id, 0]));
      for (const g of regularSeasonGames(league)) {
        const r = g.result!;
        if (r.homeScore !== r.awayScore) {
          const w = r.homeScore > r.awayScore ? g.homeId : g.awayId;
          wins.set(w, wins.get(w)! + 1);
        }
      }
      const w = [...wins.values()];
      out.steady.winSpread.push(Math.sqrt(mean(w.map((x) => (x - mean(w)) ** 2))));
    }
    const before = new Map(
      Object.values(league.players)
        .filter((p) => !p.retired)
        .map((p) => [p.id, { ovr: playerOvr(p), age: p.age, rostered: p.teamId !== null }]),
    );
    const ranked = [...league.teams]
      .sort((a, b) => staffScore(teamCoaches(league, b.id)) - staffScore(teamCoaches(league, a.id)))
      .map((t) => t.id);
    if (s >= steadyFrom) {
      for (const p of Object.values(league.players)) {
        if (p.retired || p.teamId === null) continue;
        const c = coachingForPlayer(league, p);
        if (p.position === 'K' || p.position === 'P') {
          out.ledger.kpGrowth.push(c.rate);
          out.ledger.kpCraft.push(c.decline.technical);
          continue;
        }
        if (p.age < 26) {
          out.ledger.growth.push(c.rate);
          // The year beginOffseason is about to give him (same stream, same reps), typical staff vs his own.
          const year = (coaching: typeof NEUTRAL) => {
            const clone = structuredClone(p);
            trueUp(league, clone);
            developPlayer(
              new Rng(`${league.seed}:dev:${league.season + 1}:${p.id}`),
              clone,
              rollInputs({ playedShare: playedShare(p, league.season), ...coaching, bodyAs: bodyAs(p) }),
            );
            return playerOvr(clone);
          };
          const gain = year(c) - year(NEUTRAL);
          out.coached.all.push(gain);
          if (ranked.slice(0, 8).includes(p.teamId)) out.coached.best.push(gain);
          if (ranked.slice(-8).includes(p.teamId)) out.coached.worst.push(gain);
        }
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
    }
    const hcBefore = headCoaches();
    while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
    out.starterOvr.push(mean(starters().map(playerOvr)));
    {
      const live = liveTrees(league);
      out.trees.live.push(live.length);
      out.trees.biggest.push(Math.max(0, ...live.map((t) => t.activeHeadCoaches.length)));
      out.trees.inTreeShare.push(new Set(live.flatMap((t) => t.activeHeadCoaches)).size / league.teams.length);
      const hired = [...headCoaches()]
        .filter(([team, id]) => id !== undefined && hcBefore.get(team) !== id)
        .map(([, id]) => id!);
      const fromTree = hired.map((id) => treeFor(league, id)?.rootId).filter((r): r is number => r !== undefined);
      const perTree = new Map<number, number>();
      for (const r of fromTree) perTree.set(r, (perTree.get(r) ?? 0) + 1);
      out.trees.hires.push({
        total: hired.length,
        fromTree: fromTree.length,
        mostFromOne: Math.max(0, ...perTree.values()),
      });
      for (const c of [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)])
        if (!rootsAtStart.has(c.id) && hasTree(league, c.id)) bornRoots.add(c.id);
    }
    // A first-rounder hits once his true overall reaches a high-end starter's at his position by 27 (the 60th
    // percentile of its starters: what a first-round pick is for); any later pick once he reaches a solid starter's
    // (the 30th). The scout report's tiers (`tierOf`) draw the same lines.
    const bars = new Map<Position, { solid: number; high: number }>();
    for (const pos of POSITIONS) {
      const ovrs = starters()
        .filter((p) => p.position === pos)
        .map(playerOvr)
        .sort((a, b) => a - b);
      bars.set(pos, { solid: ovrs[Math.floor(0.3 * ovrs.length)], high: ovrs[Math.floor(0.6 * ovrs.length)] });
    }
    for (const p of Object.values(league.players)) {
      if (p.retired || !p.draft || p.draft.season < firstDraft || p.age > 27) continue;
      const bar = bars.get(p.position)!;
      if (playerOvr(p) >= (p.draft.round === 1 ? bar.high : bar.solid)) hits.add(p.id);
    }
    if (s >= steadyFrom) {
      const first = (pos: Position) => league.teams.map((t) => league.players[t.depthChart[pos][0]]);
      out.steady.qb35.push((100 * first('QB').filter((p) => p.age >= 35).length) / 32);
      out.steady.rb30.push((100 * first('RB').filter((p) => p.age >= 30).length) / 32);
      out.steady.k38.push(first('K').filter((p) => p.age >= 38).length + first('P').filter((p) => p.age >= 38).length);
    }
  }
  out.awareness[1] = awareness();
  out.trees.born = bornRoots.size;
  out.trees.foundingAlive = founding.filter((id) => (treeOf(league, id)?.activeHeadCoaches.length ?? 0) > 0).length;
  out.starterAges = starters().map((p) => ({ position: p.position, age: p.age }));
  for (const p of Object.values(league.players)) {
    if (!p.draft || p.draft.season < firstDraft) continue;
    if (p.draft.season <= league.season - 5) out.drafts.push({ round: p.draft.round, hit: hits.has(p.id) });
    for (const [season, shift] of Object.entries(p.ceilingShifts ?? {}))
      // The work ethic the game reads (mentoring included), as `ceiling.ts` does.
      out.shifts.push({ year: Number(season) - p.draft.season, shift, workEthic: workEthicOf(p) });
  }
  return out;
}

// Run as the audit's child process: one seed, results back to the parent.
if (process.env.CAREERS_SEED && process.send) {
  process.send(runLeague(process.env.CAREERS_SEED, Number(process.env.CAREERS_SEASONS ?? 16)));
}
