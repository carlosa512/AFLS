import type { Rng } from '../rng';
import type { Game, League } from '../types';

export const REGULAR_SEASON_WEEKS = 18;
/** Weeks in which four teams are on bye (8 weeks × 4 teams = 32 byes). */
const BYE_WEEKS = [6, 7, 8, 9, 10, 11, 12, 13];

type Matchup = [home: number, away: number];

/** Team ids per division, ordered by last season's finish (index 0 = champion). */
export type DivisionOrder = number[][];

function defaultDivisionOrder(league: League): DivisionOrder {
  return league.divisions.map((_, d) => league.teams.filter((t) => t.division === d).map((t) => t.id));
}

/** Divisions belonging to each conference, in order. */
function conferenceDivisions(league: League): number[][] {
  return league.conferences.map((_, c) =>
    league.divisions.map((d, i) => (d.conference === c ? i : -1)).filter((i) => i >= 0),
  );
}

/**
 * The NFL 17-game formula:
 *  - 6 division games (home and away vs each rival)
 *  - 4 vs a rotating division in the same conference
 *  - 4 vs a rotating division in the other conference
 *  - 2 vs same-place finishers in the remaining two same-conference divisions
 *  - 1 vs a same-place finisher in a non-rotation division of the other conference
 */
export function buildMatchups(league: League, season: number, order: DivisionOrder): Matchup[] {
  const games: Matchup[] = [];
  const confDivs = conferenceDivisions(league);

  // Division home-and-home.
  for (const teams of order) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        games.push([teams[i], teams[j]], [teams[j], teams[i]]);
      }
    }
  }

  const fullDivisionSeries = (divA: number, divB: number) => {
    order[divA].forEach((a, i) => {
      order[divB].forEach((b, j) => {
        games.push((i + j + season) % 2 === 0 ? [a, b] : [b, a]);
      });
    });
  };

  // Same-conference rotation, cycling every 3 seasons.
  const rotations = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  const intraPairs = rotations[season % 3];
  for (const divs of confDivs) {
    for (const [x, y] of intraPairs) fullDivisionSeries(divs[x], divs[y]);

    // Same-place games vs the two unpaired divisions, oriented as a cycle so
    // every team gets exactly one home and one away game.
    const [[a, b], [c, d]] = intraPairs;
    const cycle: [number, number][] = [
      [a, c],
      [c, b],
      [b, d],
      [d, a],
    ];
    for (const [hx, ax] of cycle) {
      const [homeDiv, awayDiv] = season % 2 === 0 ? [divs[hx], divs[ax]] : [divs[ax], divs[hx]];
      for (let rank = 0; rank < 4; rank++) games.push([order[homeDiv][rank], order[awayDiv][rank]]);
    }
  }

  // Cross-conference rotation (4-season cycle) plus the 17th game.
  const shift = season % 4;
  const [conf0, conf1] = confDivs;
  for (let i = 0; i < 4; i++) {
    fullDivisionSeries(conf0[i], conf1[(i + shift) % 4]);
    const extraDiv = conf1[(i + shift + 2) % 4];
    for (let rank = 0; rank < 4; rank++) {
      const a = order[conf0[i]][rank];
      const b = order[extraDiv][rank];
      games.push(season % 2 === 0 ? [a, b] : [b, a]);
    }
  }
  return games;
}

/**
 * Find a perfect matching of `teams` using unused matchups. Randomized DFS
 * that always expands the most constrained team first.
 */
function findWeekMatching(
  teams: number[],
  byTeam: Map<number, number[]>,
  matchups: Matchup[],
  used: boolean[],
  rng: Rng,
  budget: { steps: number },
): number[] | null {
  const open = new Set(teams);
  const chosen: number[] = [];

  const options = (team: number) =>
    byTeam.get(team)!.filter((m) => {
      if (used[m]) return false;
      const [h, a] = matchups[m];
      return open.has(h === team ? a : h);
    });

  const solve = (): boolean => {
    if (open.size === 0) return true;
    if (--budget.steps < 0) return false;
    let best = -1;
    let bestOpts: number[] = [];
    for (const t of open) {
      const opts = options(t);
      if (best === -1 || opts.length < bestOpts.length) {
        best = t;
        bestOpts = opts;
        if (opts.length <= 1) break;
      }
    }
    if (bestOpts.length === 0) return false;
    // One candidate per opponent; duplicates (division home/away) are interchangeable here.
    const seen = new Set<number>();
    const candidates = rng.shuffle(bestOpts).filter((m) => {
      const [h, a] = matchups[m];
      const opp = h === best ? a : h;
      if (seen.has(opp)) return false;
      seen.add(opp);
      return true;
    });
    for (const m of candidates) {
      const [h, a] = matchups[m];
      used[m] = true;
      open.delete(h);
      open.delete(a);
      chosen.push(m);
      if (solve()) return true;
      chosen.pop();
      open.add(h);
      open.add(a);
      used[m] = false;
      if (budget.steps < 0) return false;
    }
    return false;
  };

  return solve() ? chosen : null;
}

export function generateSchedule(league: League, rng: Rng, order?: DivisionOrder): Game[] {
  const season = league.season;
  const matchups = buildMatchups(league, season, order ?? defaultDivisionOrder(league));
  const teamIds = league.teams.map((t) => t.id);
  const byTeam = new Map<number, number[]>(teamIds.map((t) => [t, []]));
  matchups.forEach(([h, a], i) => {
    byTeam.get(h)!.push(i);
    byTeam.get(a)!.push(i);
  });

  for (let attempt = 0; attempt < 1000; attempt++) {
    const byeOf = new Map<number, number>();
    rng.shuffle([...teamIds]).forEach((t, i) => byeOf.set(t, BYE_WEEKS[Math.floor(i / 4)]));

    const used = new Array<boolean>(matchups.length).fill(false);
    const weekOf = new Array<number>(matchups.length).fill(0);
    let ok = true;
    for (let week = 1; week <= REGULAR_SEASON_WEEKS && ok; week++) {
      const playing = teamIds.filter((t) => byeOf.get(t) !== week);
      const matching = findWeekMatching(playing, byTeam, matchups, used, rng, { steps: 4000 });
      if (!matching) ok = false;
      else for (const m of matching) weekOf[m] = week;
    }
    if (!ok) continue;

    const games: Game[] = matchups.map(([homeId, awayId], i) => ({
      id: 0,
      season,
      week: weekOf[i],
      homeId,
      awayId,
    }));
    games.sort((a, b) => a.week - b.week || a.homeId - b.homeId);
    for (const g of games) g.id = league.nextGameId++;
    return games;
  }
  throw new Error('Unable to generate a valid schedule');
}
