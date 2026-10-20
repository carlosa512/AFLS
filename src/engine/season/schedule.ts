import type { Rng } from '../rng';
import type { Game, League } from '../types';
import { assignKickoffs } from './kickoff';

export const REGULAR_SEASON_WEEKS = 18;
/** The NFL's bye weeks, 5 through 14: every team has one, two to six teams a week. */
const BYE_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const BYES_A_WEEK = [2, 6];
/** Every week of the season as bits (bit w for week w). */
const ALL_WEEKS = (1 << (REGULAR_SEASON_WEEKS + 1)) - 2;

type Matchup = [home: number, away: number];

/**
 * The two games against the same team (a division rival) are at least this many weeks apart: week 4
 * and week 7, never back to back. The NFL spreads its rematches the same way.
 */
const REMATCH_GAP = 3;
/** Road games in a row no team plays: the NFL never sends anyone on a third straight (a bye doesn't break a trip). */
const ROAD_TRIP = 3;
/**
 * The search's limits, measured over 8,000 seasons: a season takes about 4,000 annealing moves (at most
 * ~40,000), a week's matching a few hundred DFS steps, and a build backs up a week a few times before it
 * either finishes or is better rebuilt; at most three attempts were ever needed, so the cap never bites.
 */
const ANNEAL_MOVES = 40_000;
const MATCHING_STEPS = 4000;
const BUILD_RETRIES = 20;
const ATTEMPTS = 1000;

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
    [
      [0, 1],
      [2, 3],
    ],
    [
      [0, 2],
      [1, 3],
    ],
    [
      [0, 3],
      [1, 2],
    ],
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
 * that always expands the most constrained team first; `done` can still turn down a full matching.
 */
function findWeekMatching(
  teams: number[],
  byTeam: number[][],
  matchups: Matchup[],
  used: boolean[],
  rng: Rng,
  budget: { steps: number },
  allowed: (m: number) => boolean,
  cost: (m: number) => number = () => 0,
  done: () => boolean = () => true,
): number[] | null {
  const open = new Uint8Array(byTeam.length);
  for (const t of teams) open[t] = 1;
  let left = teams.length;
  const chosen: number[] = [];

  const available = (team: number, m: number) => {
    const [h, a] = matchups[m];
    return !used[m] && open[h === team ? a : h] === 1 && allowed(m);
  };

  const solve = (): boolean => {
    if (left === 0) return done();
    if (--budget.steps < 0) return false;
    let best = -1;
    let fewest = Infinity;
    for (const t of teams) {
      if (!open[t]) continue;
      let n = 0;
      for (const m of byTeam[t]) if (available(t, m)) n++;
      if (n < fewest) {
        best = t;
        fewest = n;
        if (n <= 1) break;
      }
    }
    if (fewest === 0) return false;
    // Cheapest first, then one candidate per opponent (of a division home-and-away, the cheaper).
    const seen = new Set<number>();
    const ranked = rng.shuffle(byTeam[best].filter((m) => available(best, m))).map((m) => ({ m, c: cost(m) }));
    const candidates = ranked
      .sort((x, y) => x.c - y.c)
      .map((x) => x.m)
      .filter((m) => {
        const [h, a] = matchups[m];
        const opp = h === best ? a : h;
        if (seen.has(opp)) return false;
        seen.add(opp);
        return true;
      });
    for (const m of candidates) {
      const [h, a] = matchups[m];
      used[m] = true;
      open[h] = open[a] = 0;
      left -= 2;
      chosen.push(m);
      if (solve()) return true;
      chosen.pop();
      open[h] = open[a] = 1;
      left += 2;
      used[m] = false;
      if (budget.steps < 0) return false;
    }
    return false;
  };

  return solve() ? chosen : null;
}

/**
 * A team's road games past the second in a row, from its weeks as bits (bit w for week w): the weeks it
 * plays and the weeks it plays away. A bye doesn't break a trip, so the road weeks close up over it (the
 * weeks after it shift down one) before the runs are counted. One week off at most: a second gap would
 * not close up (every team has exactly one bye, and no move changes that).
 */
function roadTrips(plays: number, aways: number): number {
  const before = (ALL_WEEKS & ~plays) - 1;
  const road = (aways & before) | ((aways & ~before) >>> 1);
  let run = road;
  for (let k = 1; k < ROAD_TRIP; k++) run &= road >>> k;
  let trips = 0;
  for (; run; run &= run - 1) trips++;
  return trips;
}

/**
 * Put the season in an order the NFL would sign off on: no two games between the same teams within
 * `REMATCH_GAP` weeks, and no team on a `ROAD_TRIP`. One move keeps every week a full, valid slate: trade
 * a closed set of games between two weeks x and y. Take a team's game in x, its opponent's game in y,
 * that team's game in x… until the chain closes, or ends at a team on bye (which then has its bye in the
 * other week). The teams in the chain play once in each week, as before. A division rivalry's two
 * meetings are the shortest chain; at the other extreme, a chain that takes every game of both weeks
 * swaps them whole.
 *
 * Simulated annealing on the count of broken rules, each move aimed at a broken rule most of the time.
 * A move is scored before it's played, from what it touches (each team's weeks are bits, so a road trip
 * is a few bit operations), and played only if kept: a few thousand moves take a few milliseconds. When
 * a round of cooling ends short of a clean season, the next starts warm again from the best season found
 * so far. (Trying every move that touches a broken rule, or every pair of them, mends a stuck season less
 * often per millisecond than another round does.) False if it finds none in `moves` moves.
 */
function orderWeeks(
  league: League,
  matchups: Matchup[],
  rematch: number[],
  weekOf: number[],
  rng: Rng,
  moves: number,
): boolean {
  const W = REGULAR_SEASON_WEEKS;
  const S = W + 1; // a team's row of weeks, 1..W (0 unused)
  const T = league.teams.length;
  const G = matchups.length;
  const homeTeam = matchups.map(([h]) => h);
  const awayTeam = matchups.map(([, a]) => a);
  const division = matchups.map(([h, a]) => league.teams[h].division === league.teams[a].division);
  // A week's slate: every team in a week without byes, two to six on bye in a bye week.
  const slateFits = (w: number, games: number) =>
    BYE_WEEKS.includes(w) ? games >= (T - BYES_A_WEEK[1]) / 2 && games <= (T - BYES_A_WEEK[0]) / 2 : games === T / 2;
  // The first meeting of each pair that meets twice.
  const rematches = rematch.flatMap((o, m) => (m < o ? [m] : []));

  const gameWeek = Int8Array.from(weekOf);
  // at[t * S + w]: team t's game in week w, or -1 on its bye; slate[w]: games in week w; plays and aways:
  // each team's weeks as bits.
  const at = new Int16Array(T * S);
  const slate = new Int8Array(S);
  const plays = new Int32Array(T);
  const aways = new Int32Array(T);
  // The rules each team breaks on the road and each rematch's shortfall from the gap (on both meetings).
  const road = new Int16Array(T);
  const short = new Int16Array(G);
  const shortfall = (gap: number) => Math.max(0, REMATCH_GAP - Math.abs(gap));
  let broken = 0;
  // Whether `spots` (below) still lists the broken rules: only a kept move changes them.
  let spotsFresh = false;
  const score = () => {
    at.fill(-1);
    slate.fill(0);
    plays.fill(0);
    aways.fill(0);
    for (let m = 0; m < G; m++) {
      at[homeTeam[m] * S + gameWeek[m]] = at[awayTeam[m] * S + gameWeek[m]] = m;
      slate[gameWeek[m]]++;
      plays[homeTeam[m]] |= 1 << gameWeek[m];
      plays[awayTeam[m]] |= 1 << gameWeek[m];
      aways[awayTeam[m]] |= 1 << gameWeek[m];
    }
    broken = 0;
    for (let t = 0; t < T; t++) broken += road[t] = roadTrips(plays[t], aways[t]);
    for (const m of rematches) broken += short[m] = short[rematch[m]] = shortfall(gameWeek[m] - gameWeek[rematch[m]]);
    spotsFresh = false;
  };
  score();

  // The move in hand: its two weeks and the games that trade between them (marked with its stamp).
  const moved: number[] = [];
  let mx = 0;
  let my = 0;
  const inMove = new Int32Array(G);
  const reached = new Int32Array(T);
  let stamp = 0;
  /** The week game m would be played in after the move in hand. */
  const to = (m: number) => (inMove[m] !== stamp ? gameWeek[m] : gameWeek[m] === mx ? my : mx);
  const begin = (x: number, y: number) => {
    moved.length = 0;
    [mx, my] = [x, y];
    stamp++;
  };
  /** The chain through team t between weeks x and y. */
  const chain = (t: number, x: number, y: number) => {
    begin(x, y);
    const stack = [t];
    reached[t] = stamp;
    while (stack.length) {
      const u = stack.pop()!;
      for (let side = 0; side < 2; side++) {
        const m = at[u * S + (side ? y : x)];
        if (m < 0 || inMove[m] === stamp) continue;
        inMove[m] = stamp;
        moved.push(m);
        const v = homeTeam[m] === u ? awayTeam[m] : homeTeam[m];
        if (reached[v] !== stamp) {
          reached[v] = stamp;
          stack.push(v);
        }
      }
    }
  };
  /** Weeks x and y swapped whole. */
  const relabel = (x: number, y: number) => {
    begin(x, y);
    for (let m = 0; m < G; m++) {
      if (gameWeek[m] !== x && gameWeek[m] !== y) continue;
      inMove[m] = stamp;
      moved.push(m);
    }
  };
  /** Whether the move in hand leaves both weeks valid slates, and the last week all division games. */
  const moveLegal = () => {
    let into = 0;
    for (const m of moved) {
      if (to(m) === W && !division[m]) return false;
      into += to(m) === mx ? 1 : -1;
    }
    return moved.length > 0 && slateFits(mx, slate[mx] + into) && slateFits(my, slate[my] - into);
  };

  // What the move in hand would change: each touched team's weeks (bits to toggle), then [team, its new
  // count] and [game, its rematch's new shortfall].
  const togglePlays = new Int32Array(T);
  const toggleAways = new Int32Array(T);
  const scored = new Int32Array(T);
  const touched: number[] = [];
  const newRoad: number[] = [];
  const newShort: number[] = [];
  /** The change in broken rules the move in hand would make. */
  const delta = () => {
    touched.length = newRoad.length = newShort.length = 0;
    let d = 0;
    const bits = (1 << mx) | (1 << my);
    for (const m of moved) {
      for (let side = 0; side < 2; side++) {
        const t = side ? awayTeam[m] : homeTeam[m];
        if (scored[t] !== stamp) {
          scored[t] = stamp;
          togglePlays[t] = toggleAways[t] = 0;
          touched.push(t);
        }
        togglePlays[t] ^= bits;
      }
      toggleAways[awayTeam[m]] ^= bits;
      const o = rematch[m];
      if (o >= 0 && (o > m || inMove[o] !== stamp)) {
        const c = shortfall(to(m) - to(o));
        d += c - short[m];
        newShort.push(m, c);
      }
    }
    for (const t of touched) {
      const c = roadTrips(plays[t] ^ togglePlays[t], aways[t] ^ toggleAways[t]);
      d += c - road[t];
      newRoad.push(t, c);
    }
    return d;
  };
  /** Play the move in hand, as scored by `delta`: it reuses what `delta` worked out, so `delta` must run first. */
  const play = (d: number) => {
    for (const m of moved) at[homeTeam[m] * S + gameWeek[m]] = at[awayTeam[m] * S + gameWeek[m]] = -1;
    for (const m of moved) {
      const w = to(m);
      slate[gameWeek[m]]--;
      slate[w]++;
      gameWeek[m] = w;
      at[homeTeam[m] * S + w] = at[awayTeam[m] * S + w] = m;
    }
    for (const t of touched) {
      plays[t] ^= togglePlays[t];
      aways[t] ^= toggleAways[t];
    }
    for (let i = 0; i < newRoad.length; i += 2) road[newRoad[i]] = newRoad[i + 1];
    for (let i = 0; i < newShort.length; i += 2) short[newShort[i]] = short[rematch[newShort[i]]] = newShort[i + 1];
    broken += d;
    spotsFresh = false;
  };

  /** The broken rules, as (team, week) spots: each game of a trip's last three, both meetings of a rematch too soon. */
  const spots: number[] = [];
  const findSpots = () => {
    if (spotsFresh) return;
    spotsFresh = true;
    spots.length = 0;
    for (let t = 0; t < T; t++) {
      if (!road[t]) continue;
      // The two weeks it last played before this one, so a trip's three games can all be aimed at.
      let prev2 = 0;
      let prev1 = 0;
      let run = 0;
      for (let w = 1; w <= W; w++) {
        const m = at[t * S + w];
        if (m < 0) continue;
        if (awayTeam[m] !== t) run = 0;
        else if (++run >= ROAD_TRIP) spots.push(t * S + prev2, t * S + prev1, t * S + w);
        prev2 = prev1;
        prev1 = w;
      }
    }
    for (const m of rematches)
      if (short[m]) spots.push(homeTeam[m] * S + gameWeek[m], homeTeam[m] * S + gameWeek[rematch[m]]);
  };
  /**
   * A move aimed at a broken rule (or, now and then, anywhere): a chain from it, or its week swapped
   * whole. Aimed, it goes to a week that would mend the rule if it can: a rematch to a week clear of the
   * other meeting, a road game to a week the team is home (or off).
   */
  const randomMove = (aim: boolean) => {
    if (aim) findSpots();
    const spot = aim && spots.length ? rng.pick(spots) : rng.int(0, T - 1) * S + rng.int(1, W);
    const t = Math.floor(spot / S);
    const x = spot % S;
    const m = at[spot];
    const mends = (y: number) => {
      if (!aim || m < 0) return true;
      if (short[m]) return Math.abs(y - gameWeek[rematch[m]]) >= REMATCH_GAP;
      const there = at[t * S + y];
      return awayTeam[m] !== t || there < 0 || awayTeam[there] !== t;
    };
    // A few draws for a week that mends it; past that any other week will do (a step sideways can still help).
    let y = rng.int(1, W);
    for (let tries = 0; tries < 8 && (y === x || !mends(y)); tries++) y = rng.int(1, W);
    if (y === x) return false;
    // Whole-week swaps now and then: big moves that most often break more than they mend.
    if (rng.chance(0.08)) relabel(x, y);
    else chain(t, x, y);
    return moveLegal();
  };

  const best = Int8Array.from(gameWeek);
  let bestBroken = broken;
  /**
   * Anneal for `steps` moves (within what's left of `moves`), cooling from `hot` to a floor that still
   * lets a move break one more rule now and then. Four moves in five aim at a broken rule; the rest wander,
   * so the search isn't stuck circling the same few spots.
   */
  const anneal = (steps: number, hot: number) => {
    for (let step = 0; step < steps && broken > 0 && moves > 0; step++) {
      moves--;
      if (!randomMove(rng.chance(0.8))) continue;
      const heat = hot * (1 - step / steps) + 0.05;
      const d = delta();
      if (d > 0 && rng.next() >= Math.exp(-d / heat)) continue;
      play(d);
      if (broken < bestBroken) {
        best.set(gameWeek);
        bestBroken = broken;
      }
    }
  };

  // A long first round settles most seasons; shorter warm rounds from the best season finish the rest.
  anneal(3000, 0.5);
  while (broken > 0 && moves > 0) {
    if (bestBroken < broken) {
      gameWeek.set(best);
      score();
    }
    anneal(1500, 0.6);
  }
  if (broken > 0) return false;
  gameWeek.forEach((w, m) => (weekOf[m] = w));
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
  // Team ids index straight into arrays here, as they do into league.teams across the engine (team i has id i).
  const matchups = buildMatchups(league, season, order ?? defaultDivisionOrder(league));
  const teamIds = league.teams.map((t) => t.id);
  const byTeam = teamIds.map((): number[] => []);
  matchups.forEach(([h, a], i) => {
    byTeam[h].push(i);
    byTeam[a].push(i);
  });

  const division = (m: number) => league.teams[matchups[m][0]].division === league.teams[matchups[m][1]].division;
  // The other meeting of the same two teams (whichever hosts), if they meet twice.
  const meetings = new Map<number, number[]>();
  const pair = ([h, a]: Matchup) => Math.min(h, a) * 1024 + Math.max(h, a);
  matchups.forEach((g, m) => meetings.set(pair(g), [...(meetings.get(pair(g)) ?? []), m]));
  const rematch = matchups.map((g, m) => meetings.get(pair(g))!.find((o) => o !== m) ?? -1);
  // The last week is all division games, as in the NFL, so it's filled first; then the rest in order.
  const weeks = [REGULAR_SEASON_WEEKS, ...Array.from({ length: REGULAR_SEASON_WEEKS - 1 }, (_, i) => i + 1)];

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const byeOf: number[] = [];
    const sitting = byeCounts(league, rng).flatMap((n, i) => Array<number>(n).fill(BYE_WEEKS[i]));
    rng.shuffle([...teamIds]).forEach((t, i) => (byeOf[t] = sitting[i]));

    const used = new Array<boolean>(matchups.length).fill(false);
    const weekOf = new Array<number>(matchups.length).fill(0);
    // Each team's road weeks, as the weeks fill.
    const roadWeeks = teamIds.map((): boolean[] => []);
    const fill = (week: number, ms: number[]) => {
      for (const m of ms) {
        used[m] = true;
        weekOf[m] = week;
        roadWeeks[matchups[m][1]][week] = true;
      }
    };
    const empty = (week: number) =>
      weekOf.forEach((w, m) => {
        if (w !== week) return;
        used[m] = false;
        weekOf[m] = 0;
        roadWeeks[matchups[m][1]][week] = false;
      });
    /**
     * Whether the games left, two a team, split into two full weeks: they make cycles (A at B, B at C, …
     * back to A), and each cycle splits into alternate weeks only if it is even. Two a team because the last
     * two weeks filled (16 and 17) come after the bye weeks.
     */
    const splits = () => {
      const left = teamIds.map((): number[] => []);
      matchups.forEach(([h, a], m) => {
        if (used[m]) return;
        left[h].push(m);
        left[a].push(m);
      });
      const seen = new Set<number>();
      for (const [first] of left) {
        if (first === undefined || seen.has(first)) continue;
        let length = 0;
        let team = matchups[first][0];
        for (let m = first; length === 0 || m !== first; length++) {
          seen.add(m);
          team = matchups[m][0] === team ? matchups[m][1] : matchups[m][0];
          m = left[team].find((o) => o !== m)!;
        }
        if (length % 2) return false;
      }
      return true;
    };
    // A week that can't be filled (most often the last few, when the games left no longer pair off) sends
    // the build back to fill the week before another way.
    let filled = 0;
    for (let retries = 0; filled < weeks.length && retries <= BUILD_RETRIES; ) {
      const week = weeks[filled];
      const playing = teamIds.filter((t) => byeOf[t] !== week);
      // The rules a game would break here: a rematch too soon, a third road game in a row (the weeks
      // before, a bye not breaking a trip, and week 18 after 17).
      const cost = (m: number) => {
        const o = rematch[m];
        const soon = o >= 0 && weekOf[o] && Math.abs(weekOf[o] - week) < REMATCH_GAP ? 1 : 0;
        const a = matchups[m][1];
        let trip = 1 + (week === REGULAR_SEASON_WEEKS - 1 && roadWeeks[a][REGULAR_SEASON_WEEKS] ? 1 : 0);
        for (let w = week - 1; w >= 1 && trip < ROAD_TRIP; w--) {
          if (byeOf[a] === w) continue;
          if (!roadWeeks[a][w]) break;
          trip++;
        }
        return soon + (trip >= ROAD_TRIP ? 1 : 0);
      };
      const fitsWeek = (m: number) => week !== REGULAR_SEASON_WEEKS || division(m);
      // The week that breaks the fewest rules it can find, for `orderWeeks` to mend. With two weeks to go
      // after it, only a week that leaves games that still split into two.
      const last = filled === weeks.length - 3;
      const done = () => !last || splits();
      const matching = findWeekMatching(
        playing,
        byTeam,
        matchups,
        used,
        rng,
        { steps: MATCHING_STEPS },
        fitsWeek,
        cost,
        done,
      );
      if (matching) {
        fill(week, matching);
        filled++;
      } else if (filled > 0) {
        empty(weeks[--filled]);
        retries++;
      } else break;
    }
    if (filled < weeks.length || !orderWeeks(league, matchups, rematch, weekOf, rng, ANNEAL_MOVES)) continue;

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
