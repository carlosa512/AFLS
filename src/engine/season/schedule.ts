import type { Rng } from '../rng';
import type { Game, League } from '../types';
import { assignKickoffs } from './kickoff';

export const REGULAR_SEASON_WEEKS = 18;
/** The NFL's bye weeks, 5 through 14: every team has one, two to six teams a week. */
const BYE_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const BYES_A_WEEK = [2, 6];

type Matchup = [home: number, away: number];

/**
 * The two games against the same team (a division rival) are at least this many weeks apart: week 4
 * and week 7, never back to back. The NFL spreads its rematches the same way.
 */
const REMATCH_GAP = 3;
/** Road games in a row no team plays: the NFL never sends anyone on a third straight (a bye doesn't break a trip). */
const ROAD_TRIP = 3;

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
  allowed: (m: number) => boolean,
  cost: (m: number) => number = () => 0,
): number[] | null {
  const open = new Set(teams);
  const chosen: number[] = [];

  const options = (team: number) =>
    byTeam.get(team)!.filter((m) => {
      if (used[m] || !allowed(m)) return false;
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
    // Cheapest first, then one candidate per opponent (of a division home-and-away, the cheaper).
    const seen = new Set<number>();
    const ranked = rng.shuffle(bestOpts).map((m) => ({ m, c: cost(m) }));
    const candidates = ranked.sort((x, y) => x.c - y.c).map((x) => x.m).filter((m) => {
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

/**
 * Put the season in an order the NFL would sign off on: no two games between the same teams within
 * `REMATCH_GAP` weeks, and no team on a `ROAD_TRIP`. Three moves keep every week a full, valid slate:
 * - swap two weeks whole (bye weeks only with bye weeks, so they keep their byes; week 18 stays put);
 * - swap a division rivalry's two meetings (the same teams play those weeks; only the host changes);
 * - trade a closed chain of games between two weeks (A–B in one, B–C in the other, C–D … back to A):
 *   both weeks stay full slates, with different games in them.
 * Simulated annealing on the count of broken rules; false if it finds no clean season.
 */
function orderWeeks(league: League, matchups: Matchup[], weekOf: number[], rng: Rng): boolean {
  const W = REGULAR_SEASON_WEEKS;
  const teams = league.teams.map((t) => t.id);
  // game[t][w]: team t's game in slate w (slates are the weeks as built), or -1 on its bye.
  const game = new Map<number, number[]>(teams.map((t) => [t, new Array<number>(W + 1).fill(-1)]));
  const place = (m: number, w: number) => matchups[m].forEach((t) => (game.get(t)![w] = m));
  matchups.forEach((_, m) => place(m, weekOf[m]));
  const meetings = new Map<number, number[]>();
  matchups.forEach(([h, a], m) => {
    const key = Math.min(h, a) * 1024 + Math.max(h, a);
    meetings.set(key, [...(meetings.get(key) ?? []), m]);
  });
  const rematches = [...meetings.values()].filter((ms) => ms.length === 2);
  // label[slate] is the week it's played; slateAt is the inverse.
  const label = Array.from({ length: W + 1 }, (_, w) => w);
  const slateAt = [...label];

  // The rules a team breaks: rematches too soon (both teams), and each road game past the second in a row.
  const teamCost = (t: number) => {
    let road = 0;
    let cost = 0;
    const g = game.get(t)!;
    for (let week = 1; week <= W; week++) {
      const m = g[slateAt[week]];
      if (m < 0) continue;
      road = matchups[m][0] === t ? 0 : road + 1;
      if (road >= ROAD_TRIP) cost++;
    }
    return cost;
  };
  const rematchCost = () => rematches.reduce((n, [x, y]) => n + (Math.abs(label[weekOf[x]] - label[weekOf[y]]) < REMATCH_GAP ? 1 : 0), 0);
  // Each team's road-trip count, kept current: a move re-scores only the teams it touches.
  const trips = new Map(teams.map((t) => [t, teamCost(t)]));
  let tripTotal = [...trips.values()].reduce((a, b) => a + b, 0);
  const rescore = (ts: Iterable<number>) => {
    for (const t of ts) {
      const c = teamCost(t);
      tripTotal += c - trips.get(t)!;
      trips.set(t, c);
    }
  };

  const groups = [BYE_WEEKS, Array.from({ length: W - 1 }, (_, i) => i + 1).filter((w) => !BYE_WEEKS.includes(w))];
  const groupOf = (w: number) => groups.find((g) => g.includes(w))!;
  const relabel = (a: number, b: number) => {
    [label[a], label[b]] = [label[b], label[a]];
    slateAt[label[a]] = a;
    slateAt[label[b]] = b;
  };
  const move = (m: number, w: number) => {
    matchups[m].forEach((t) => game.get(t)![weekOf[m]] === m && (game.get(t)![weekOf[m]] = -1));
    weekOf[m] = w;
    place(m, w);
  };
  /** The chain through team `t` between slates x and y, or null if it reaches a bye or is the whole week. */
  const chain = (t: number, x: number, y: number): number[] | null => {
    const out: number[] = [];
    let team = t;
    for (let side = 0; ; side ^= 1) {
      const m = game.get(team)![side ? y : x];
      if (m < 0) return null;
      out.push(m);
      const [h, a] = matchups[m];
      team = h === team ? a : h;
      if (team === t && side === 1) return out.length < teams.length ? out : null;
    }
  };

  /** A broken rule to aim at: a team on a road trip and the slate of its third game, or a rematch too soon. */
  const target = (): { team: number; slate: number } | null => {
    const soon = rematches.filter(([x, y]) => Math.abs(label[weekOf[x]] - label[weekOf[y]]) < REMATCH_GAP);
    const tripping = teams.filter((t) => trips.get(t)! > 0);
    if (!soon.length && !tripping.length) return null;
    if (rng.next() * (soon.length + tripping.length) < soon.length) {
      const m = rng.pick(rng.pick(soon));
      return { team: rng.pick(matchups[m]), slate: weekOf[m] };
    }
    const t = rng.pick(tripping);
    const g = game.get(t)!;
    let road = 0;
    for (let week = 1; week <= W; week++) {
      const m = g[slateAt[week]];
      if (m < 0) continue;
      road = matchups[m][0] === t ? 0 : road + 1;
      if (road >= ROAD_TRIP) return { team: t, slate: slateAt[week] };
    }
    return null;
  };
  let now = rematchCost() + tripTotal;
  // Rounds of cooling from where the last left off: a season a rule or two short is closer than a fresh one.
  const STEPS = 20_000;
  for (let step = 0; now > 0 && step < STEPS; step++) {
    const heat = 1.5 * (1 - (step % STEPS) / STEPS) + 0.05;
    let undo: () => void;
    let touched: Iterable<number>;
    // Most moves go at a rule that is broken: that team, that week. The rest wander.
    const aim = rng.chance(0.6) ? target() : null;
    const r = rng.next();
    if (r < 0.3) {
      const w = aim && aim.slate !== W ? aim.slate : rng.int(1, W - 1);
      const other = rng.pick(groupOf(w).filter((x) => x !== w));
      relabel(w, other);
      undo = () => relabel(w, other);
      touched = teams;
    } else if (r < 0.5) {
      const own = aim ? rematches.filter(([m]) => matchups[m].includes(aim.team)) : [];
      const [x, y] = rng.pick(own.length ? own : rematches);
      const [wx, wy] = [weekOf[x], weekOf[y]];
      move(x, wy);
      move(y, wx);
      undo = () => {
        move(x, wx);
        move(y, wy);
      };
      touched = matchups[x];
    } else {
      const x = aim && aim.slate !== W ? aim.slate : rng.int(1, W - 1);
      const y = rng.int(1, W - 1);
      const ms = x === y ? null : chain(aim?.team ?? rng.pick(teams), x, y);
      if (!ms) continue;
      for (const m of ms) move(m, weekOf[m] === x ? y : x);
      undo = () => ms.forEach((m) => move(m, weekOf[m] === x ? y : x));
      touched = new Set(ms.flatMap((m) => matchups[m]));
    }
    rescore(touched);
    const next = rematchCost() + tripTotal;
    if (next <= now || rng.chance(Math.exp((now - next) / heat))) now = next;
    else {
      undo();
      rescore(touched);
    }
  }
  if (now > 0) return false;
  weekOf.forEach((w, m) => (weekOf[m] = label[w]));
  return true;
}

/** How many teams sit each bye week: two to six (an even number, so the rest pair off), 32 in all. */
function byeCounts(league: League, rng: Rng): number[] {
  const counts = BYE_WEEKS.map(() => BYES_A_WEEK[0]);
  for (let left = league.teams.length - counts.length * BYES_A_WEEK[0]; left > 0; ) {
    const i = rng.int(0, counts.length - 1);
    if (counts[i] + 2 > BYES_A_WEEK[1]) continue;
    counts[i] += 2;
    left -= 2;
  }
  return counts;
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

  const division = (m: number) => league.teams[matchups[m][0]].division === league.teams[matchups[m][1]].division;
  // The same two teams, whichever hosts.
  const pair = (m: number) => Math.min(...matchups[m]) * 1024 + Math.max(...matchups[m]);
  // The last week is all division games, as in the NFL, so it's filled first; then the rest in order.
  const weeks = [REGULAR_SEASON_WEEKS, ...Array.from({ length: REGULAR_SEASON_WEEKS - 1 }, (_, i) => i + 1)];

  for (let attempt = 0; attempt < 1000; attempt++) {
    const byeOf = new Map<number, number>();
    const sitting = byeCounts(league, rng).flatMap((n, i) => Array<number>(n).fill(BYE_WEEKS[i]));
    rng.shuffle([...teamIds]).forEach((t, i) => byeOf.set(t, sitting[i]));

    const used = new Array<boolean>(matchups.length).fill(false);
    const weekOf = new Array<number>(matchups.length).fill(0);
    // Each team's road weeks, and the weeks each pair has met, as the weeks fill.
    const away = new Map<number, boolean[]>(teamIds.map((t) => [t, []]));
    const met = new Map<number, number[]>();
    let ok = true;
    for (const week of weeks) {
      if (!ok) break;
      const playing = teamIds.filter((t) => byeOf.get(t) !== week);
      // The rules a game would break here: a rematch too soon, a third road game in a row (the weeks
      // before, a bye not breaking a trip, and week 18 after 17).
      const cost = (m: number) => {
        const soon = (met.get(pair(m)) ?? []).some((w) => Math.abs(w - week) < REMATCH_GAP) ? 1 : 0;
        const a = matchups[m][1];
        let trip = 1 + (week === REGULAR_SEASON_WEEKS - 1 && away.get(a)![REGULAR_SEASON_WEEKS] ? 1 : 0);
        for (let w = week - 1; w >= 1 && trip < ROAD_TRIP; w--) {
          if (byeOf.get(a) === w) continue;
          if (!away.get(a)![w]) break;
          trip++;
        }
        return soon + (trip >= ROAD_TRIP ? 1 : 0);
      };
      const legal = (m: number) => week !== REGULAR_SEASON_WEEKS || division(m);
      // A clean week if there is one; otherwise the one that breaks the fewest rules, for `orderWeeks` to mend.
      const matching =
        findWeekMatching(playing, byTeam, matchups, used, rng, { steps: 1500 }, (m) => legal(m) && cost(m) === 0) ??
        findWeekMatching(playing, byTeam, matchups, used, rng, { steps: 4000 }, legal, cost);
      if (!matching) ok = false;
      else
        for (const m of matching) {
          weekOf[m] = week;
          away.get(matchups[m][1])![week] = true;
          met.set(pair(m), [...(met.get(pair(m)) ?? []), week]);
        }
    }
    if (!ok || !orderWeeks(league, matchups, weekOf, rng)) continue;

    const games: Game[] = matchups.map(([homeId, awayId], i) => ({
      id: 0,
      season,
      week: weekOf[i],
      homeId,
      awayId,
    }));
    games.sort((a, b) => a.week - b.week || a.homeId - b.homeId);
    for (const g of games) g.id = league.nextGameId++;
    assignKickoffs(league, games, season);
    return games;
  }
  throw new Error('Unable to generate a valid schedule');
}
