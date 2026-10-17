import { skill } from '../attributes';
import { teamScheme } from '../coaching';
import type { TeamScheme } from '../schemes';
import { temperOffset } from '../traits';
import type { League, Player, Position, Team } from '../types';

/** The 22 starters plus the depth the engine draws on, with unit composites. */
export interface Lineup {
  team: Team;
  /** What its coordinators run: personnel, play mix, front and coverage (see `schemes.ts`). */
  scheme: TeamScheme;
  /** Fourth receiver: on the field in 10 personnel, depth otherwise. */
  wr4?: Player;
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
  /** The third edge and tackle: defensive lines rotate, so they spell the starters on passing downs. */
  rushRotation: Player[];
  k: Player;
  p: Player;
  kr: Player;
  pr: Player;
  /** Unit composites on the 1–20 scale. */
  passBlock: number;
  runBlock: number;
  passRush: number;
  runStop: number;
  /** How well the edge defenders turn outside runs back inside. */
  edgeContain: number;
  /** Linemen's discipline: false starts and holding (offense), offside (defense). */
  offenseDiscipline: number;
  defenseDiscipline: number;
}

/** A lineman's discipline: his football IQ, plus or minus his temper (a hothead jumps early and grabs). */
const discipline = (p: Player) => skill(p, 'discipline') + temperOffset(p.traits);

const avg = (players: Player[], f: (p: Player) => number) =>
  players.reduce((sum, p) => sum + f(p), 0) / Math.max(1, players.length);

export function buildLineup(league: League, team: Team): Lineup {
  const depth = (pos: Position, n: number): Player[] => {
    const players = team.depthChart[pos].slice(0, n).map((id) => league.players[id]);
    if (players.length === 0) throw new Error(`${team.abbrev} has no ${pos} on the depth chart`);
    return players;
  };

  const scheme = teamScheme(league, team.id);
  const personnel = scheme.offense.personnel;
  const front = scheme.front;
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
  const best = (pool: Player[]) => pool.reduce((a, b) => (skill(b, 'returns') > skill(a, 'returns') ? b : a));

  // Who blocks besides the line depends on who is on the field: a second tight end helps, a fourth receiver doesn't.
  const olPass = avg(ol, (p) => skill(p, 'passPro'));
  const olRun = avg(ol, (p) => skill(p, 'runBlocking'));
  const te2 = tes[1] ?? tes[0];
  const slot = wrs[3] ?? wrs[2];
  const passBlock =
    personnel === '12'
      ? olPass * 0.78 + skill(tes[0], 'passPro') * 0.07 + skill(te2, 'passPro') * 0.05 + skill(rbs[0], 'passPro') * 0.1
      : personnel === '10'
        ? olPass * 0.88 + skill(rbs[0], 'passPro') * 0.12
        : olPass * 0.8 + skill(tes[0], 'passPro') * 0.1 + skill(rbs[0], 'passPro') * 0.1;
  const runBlock =
    personnel === '12'
      ? olRun * 0.74 + skill(tes[0], 'runBlocking') * 0.14 + skill(te2, 'runBlocking') * 0.12
      : personnel === '10'
        ? olRun * 0.9 + skill(slot, 'runBlocking') * 0.1
        : olRun * 0.8 + skill(tes[0], 'runBlocking') * 0.2;
  const coverRun = scheme.coverage?.runAdj ?? 0;

  return {
    team,
    scheme,
    wr4: wrs[3],
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
    rushRotation: [team.depthChart.EDGE[2], team.depthChart.DT[2]].filter((id) => id !== undefined).map((id) => league.players[id]),
    k: depth('K', 1)[0],
    p: depth('P', 1)[0],
    kr: best(krPool),
    pr: best(prPool),
    // Unit composites: the line does most of the work, with help from the backs and tight ends.
    passBlock,
    runBlock,
    // The front decides who the rush and the run defense lean on, and what it trades for its strength.
    passRush:
      avg(edge, (p) => skill(p, 'edgeRush')) * front.rush.edge +
      avg(dt, (p) => skill(p, 'interiorRush')) * front.rush.dt +
      avg(lb, (p) => skill(p, 'edgeRush')) * front.rush.lb +
      front.rushAdj,
    runStop:
      avg(dt, (p) => skill(p, 'runDefense')) * front.run.dt +
      avg(edge, (p) => skill(p, 'runDefense')) * front.run.edge +
      avg(lb, (p) => skill(p, 'runFit')) * front.run.lb +
      avg(s, (p) => skill(p, 'runFit')) * front.run.s +
      front.runAdj +
      coverRun,
    edgeContain: avg(edge, (p) => skill(p, 'setEdge')) + front.containAdj,
    offenseDiscipline: avg(ol, discipline),
    defenseDiscipline: avg([...dt, ...edge], discipline),
  };
}

/** Players credited with a game played when they dress as starters or key reserves. */
export function activePlayers(l: Lineup): Player[] {
  return [l.qb, ...l.rbs, ...l.wrs, ...(l.scheme.offense.personnel === '10' && l.wr4 ? [l.wr4] : []), ...l.tes, ...l.ol, ...l.dt, ...l.edge, ...l.lb, ...l.cb, ...l.s, ...l.rushRotation, l.k, l.p, l.kr, l.pr];
}
