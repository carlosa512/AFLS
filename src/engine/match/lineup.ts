import type { League, Player, Position, Team } from '../types';

/** The 22 starters plus the depth the engine draws on, with unit composites. */
export interface Lineup {
  team: Team;
  qb: Player;
  rbs: Player[];
  wrs: Player[];
  tes: Player[];
  ol: Player[];
  dt: Player[];
  edge: Player[];
  lb: Player[];
  cb: Player[];
  s: Player[];
  k: Player;
  p: Player;
  kr: Player;
  pr: Player;
  /** Unit composites on the 1–20 scale. */
  passBlock: number;
  runBlock: number;
  passRush: number;
  runStop: number;
}

const avg = (players: Player[], f: (p: Player) => number) =>
  players.reduce((sum, p) => sum + f(p), 0) / Math.max(1, players.length);

const returnSkill = (p: Player) => p.ratings.speed + p.ratings.elusiveness + p.ratings.agility * 0.5;

export function buildLineup(league: League, team: Team): Lineup {
  const depth = (pos: Position, n: number): Player[] => {
    const players = team.depthChart[pos].slice(0, n).map((id) => league.players[id]);
    if (players.length === 0) throw new Error(`${team.abbrev} has no ${pos} on the depth chart`);
    return players;
  };

  const qb = depth('QB', 1)[0];
  const rbs = depth('RB', 2);
  const wrs = depth('WR', 4);
  const tes = depth('TE', 2);
  const ol = depth('OL', 5);
  const dt = depth('DT', 2);
  const edge = depth('EDGE', 2);
  const lb = depth('LB', 2);
  const cb = depth('CB', 3);
  const s = depth('S', 2);

  // Returners come from skill-position depth, not the starters' workload.
  const krPool = [rbs[1], wrs[3], wrs[2], cb[2]].filter(Boolean);
  const prPool = [wrs[2], wrs[3], cb[2], rbs[1]].filter(Boolean);
  const best = (pool: Player[]) => pool.reduce((a, b) => (returnSkill(b) > returnSkill(a) ? b : a));

  return {
    team,
    qb,
    rbs,
    wrs: wrs.slice(0, 3),
    tes,
    ol,
    dt,
    edge,
    lb,
    cb,
    s,
    k: depth('K', 1)[0],
    p: depth('P', 1)[0],
    kr: best(krPool),
    pr: best(prPool),
    passBlock: avg(ol, (p) => p.ratings.passBlock) * 0.9 + tes[0].ratings.passBlock * 0.05 + rbs[0].ratings.passBlock * 0.05,
    runBlock: avg(ol, (p) => p.ratings.runBlock) * 0.85 + tes[0].ratings.runBlock * 0.15,
    passRush:
      avg(edge, (p) => p.ratings.passRush) * 0.55 +
      avg(dt, (p) => p.ratings.passRush) * 0.35 +
      avg(lb, (p) => p.ratings.passRush) * 0.1,
    runStop:
      avg(dt, (p) => p.ratings.runStop) * 0.4 +
      avg(edge, (p) => p.ratings.runStop) * 0.25 +
      avg(lb, (p) => (p.ratings.runStop + p.ratings.tackling) / 2) * 0.25 +
      avg(s, (p) => p.ratings.runStop) * 0.1,
  };
}

/** Players credited with a game played when they dress as starters or key reserves. */
export function activePlayers(l: Lineup): Player[] {
  return [l.qb, ...l.rbs, ...l.wrs, ...l.tes, ...l.ol, ...l.dt, ...l.edge, ...l.lb, ...l.cb, ...l.s, l.k, l.p, l.kr, l.pr];
}
