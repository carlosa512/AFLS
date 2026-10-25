import { skill, useKnocks } from '../attributes';
import { specialTeamsEdge, teamScheme } from '../coaching';
import type { TeamScheme } from '../schemes';
import { knockFor, slotOvr } from '../familiarity';
import { isAvailable, onGameRoster } from '../roster';
import { temperOffset } from '../traits';
import type { League, Player, Position, Team } from '../types';
import { POSITIONS } from '../types';

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
  /**
   * The ten men around the kicker, punter or returner on a kick, both ways: backups first (linebackers,
   * safeties, corners, tight ends, receivers, backs), so starters don't pile up snaps and injuries.
   */
  st: Player[];
  /** The kick units' discipline: blocks in the back, holding on returns, a kickoff lined up wrong. */
  specialDiscipline: number;
  /**
   * The field goal and extra point unit's blockers: the starting line, with a backup lineman and a tight end
   * on the wings (`fgDiscipline`: false starts and holds on kicks). Its block unit is the defense's front
   * (`blockDiscipline`: offside on kicks).
   */
  fg: Player[];
  fgDiscipline: number;
  blockDiscipline: number;
  /** The special teams coordinator's edge, in rating points against a typical coach (`specialTeamsEdge`). */
  stCoach: number;
  /** Players lined up away from their own position, and the knock each takes on every skill (`knockFor`). */
  knocks: ReadonlyMap<number, number>;
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

/** Where special-teams units come from, in the order they're filled, after each position's starters. */
const ST_POOL: [Position, number][] = [
  ['LB', 2],
  ['S', 2],
  ['CB', 2],
  ['TE', 1],
  ['WR', 3],
  ['RB', 1],
  ['EDGE', 2],
  ['DT', 2],
];
const ST_SIZE = 10;
/** A point of the special teams coordinator's quality is worth half a point of his units' discipline. */
const COACH_DISCIPLINE = 0.5;
/** A kick unit's flags get this much less likely per point of its discipline (`unitLoose` in `gameSim.ts`). */
export const KICK_FLAG_PER_POINT = 0.06;
/** Return yards per point of special teams coordinator edge, the returning team's against the covering team's. */
export const RETURN_COACH = { kick: 0.25, punt: 0.15 };

/**
 * What a special teams coordinator does on game day against a typical one, for a screen: his kick units'
 * flags (a multiplier) and the yards his returners gain, or his coverage saves, on each kickoff and punt.
 */
export function kickCoaching(edge: number): { flags: number; kickoff: number; punt: number } {
  return {
    flags: Math.exp(-KICK_FLAG_PER_POINT * COACH_DISCIPLINE * edge),
    kickoff: RETURN_COACH.kick * edge,
    punt: RETURN_COACH.punt * edge,
  };
}

/**
 * A kick unit: one backup from each position in turn (a linebacker, a safety, a corner, a tight end…)
 * until there are ten, so the unit mixes like an NFL one; starters only when the backups run out.
 */
function coverUnit(league: League, team: Team, out: ReadonlySet<number>): Player[] {
  const ok = (id: number) => !out.has(id) && !!league.players[id] && isAvailable(league.players[id]);
  const lanes = ST_POOL.map(([pos, starters]) => team.depthChart[pos].filter(ok).slice(starters));
  const unit: Player[] = [];
  for (let round = 0; unit.length < ST_SIZE && lanes.some((l) => l.length > round); round++) {
    for (const lane of lanes) if (round < lane.length && unit.length < ST_SIZE) unit.push(league.players[lane[round]]);
  }
  for (const [pos, starters] of ST_POOL) {
    for (const id of team.depthChart[pos].filter(ok).slice(0, starters))
      if (unit.length < ST_SIZE) unit.push(league.players[id]);
  }
  return unit;
}

/** A lineman's discipline: his football IQ, plus or minus his temper (a hothead jumps early and grabs). */
export const discipline = (p: Player) => skill(p, 'discipline') + temperOffset(p.traits);

const avg = (players: Player[], f: (p: Player) => number) =>
  players.reduce((sum, p) => sum + f(p), 0) / Math.max(1, players.length);

/**
 * Who fills in when a position runs out of healthy players, best fit first: a safety covers at
 * corner, a defensive tackle lines up at guard, the punter kicks. Out of position he plays at what
 * his ratings are worth there.
 */
const FILL_IN: Record<Position, Position[]> = {
  QB: ['RB', 'WR', 'TE'],
  RB: ['WR', 'TE', 'S', 'LB'],
  WR: ['TE', 'RB', 'CB', 'S'],
  TE: ['OL', 'WR', 'DT', 'LB'],
  OL: ['DT', 'TE', 'EDGE'],
  DT: ['EDGE', 'OL', 'LB'],
  EDGE: ['DT', 'LB', 'TE'],
  LB: ['EDGE', 'S', 'DT'],
  CB: ['S', 'WR', 'LB'],
  S: ['CB', 'LB', 'WR'],
  K: ['P'],
  P: ['K'],
};

/**
 * The lineup for a game. Players on injured reserve, hurt (unless playing through it) or in `out`
 * (hurt earlier in this game) sit; the next man on the depth chart steps in, and a position with too
 * few healthy players borrows from its neighbours (`FILL_IN`), never using anyone twice, except that
 * one healthy specialist can both kick and punt.
 */
export function buildLineup(league: League, team: Team, out: ReadonlySet<number> = new Set()): Lineup {
  const scheme = teamScheme(league, team.id);
  const personnel = scheme.offense.personnel;
  // How many each position dresses for the engine, and how many it can't do without.
  const want: Record<Position, [number, number]> = {
    QB: [1, 1],
    RB: [2, 1],
    WR: [4, personnel === '10' ? 4 : 3],
    TE: [2, personnel === '12' ? 2 : 1],
    OL: [5, 5],
    DT: [2, 2],
    EDGE: [2, 2],
    LB: [2, 2],
    CB: [3, 3],
    S: [2, 2],
    K: [1, 1],
    P: [1, 1],
  };
  const used = new Set<number>();
  const fit = (id: number) => !out.has(id) && !used.has(id) && !!league.players[id] && isAvailable(league.players[id]);
  const take = (players: Player[]) => players.forEach((p) => used.add(p.id));
  // First every position's own healthy players, so a fill-in never takes another position's starter.
  const at = {} as Record<Position, Player[]>;
  for (const pos of POSITIONS)
    take(
      (at[pos] = team.depthChart[pos]
        .filter(fit)
        .slice(0, want[pos][0])
        .map((id) => league.players[id])),
    );
  for (const pos of POSITIONS) {
    const list = at[pos];
    const need = want[pos][1];
    for (const from of FILL_IN[pos]) {
      if (list.length >= need) break;
      const extra = team.depthChart[from].filter(fit).map((id) => league.players[id]);
      // Best at the job knock included: a versatile backup, or one learning it, gets the call first.
      const picked = extra.sort((a, b) => slotOvr(b, pos) - slotOvr(a, pos)).slice(0, need - list.length);
      take(picked);
      list.push(...picked);
    }
    // Nobody healthy anywhere close: one specialist kicks and punts, and otherwise someone plays hurt.
    if (!list.length && (pos === 'K' || pos === 'P')) list.push(...at[pos === 'K' ? 'P' : 'K'].slice(0, 1));
    if (list.length < need) {
      const hurt = team.depthChart[pos]
        .filter((id) => !out.has(id) && !used.has(id) && !!league.players[id] && onGameRoster(league.players[id]))
        .slice(0, need - list.length)
        .map((id) => league.players[id]);
      take(hurt);
      list.push(...hurt);
    }
    // Still nobody (both specialists hurt in the same game): whoever on the roster does it best,
    // even a man already on the field.
    if (list.length === 0) {
      const anyone = POSITIONS.flatMap((from) => team.depthChart[from]).filter(
        (id) => !out.has(id) && league.players[id] && onGameRoster(league.players[id]),
      );
      const best = anyone.map((id) => league.players[id]).sort((a, b) => slotOvr(b, pos) - slotOvr(a, pos))[0];
      if (best) list.push(best);
    }
    if (list.length === 0) throw new Error(`${team.abbrev} has no ${pos} on the depth chart`);
  }
  // Who lines up away from his own position (a fill-in, or one the user put there), and what it costs him.
  // A man with two jobs keeps his full game if one is his own: the specialist who kicks and punts, say.
  // The third edge and tackle who rotate in count too: a hand-sorted chart can list anyone there.
  const rotation = (['EDGE', 'DT'] as const).flatMap((pos) => {
    const id = team.depthChart[pos].find(fit);
    return id === undefined ? [] : [{ p: league.players[id], pos }];
  });
  const slots = new Map<Player, Position[]>();
  for (const pos of POSITIONS) for (const p of at[pos]) slots.set(p, [...(slots.get(p) ?? []), pos]);
  for (const { p, pos } of rotation) slots.set(p, [...(slots.get(p) ?? []), pos]);
  const knocks = new Map<number, number>();
  for (const [p, mine] of slots)
    if (!mine.includes(p.position)) knocks.set(p.id, Math.max(...mine.map((pos) => knockFor(p, pos))));
  // The unit composites below are read with the knocks on.
  const prev = useKnocks(knocks);
  try {
    return assemble(
      league,
      team,
      out,
      scheme,
      at,
      rotation.map((r) => r.p),
      fit,
      knocks,
    );
  } finally {
    useKnocks(prev);
  }
}

/** The lineup from each position's players: returners, kick units and the composites the engine reads. */
function assemble(
  league: League,
  team: Team,
  out: ReadonlySet<number>,
  scheme: TeamScheme,
  at: Record<Position, Player[]>,
  rushRotation: Player[],
  fit: (id: number) => boolean,
  knocks: ReadonlyMap<number, number>,
): Lineup {
  const personnel = scheme.offense.personnel;
  const front = scheme.front;
  const qb = at.QB[0];
  const { RB: rbs, WR: wrs, TE: tes, OL: ol, DT: dt, EDGE: edge, LB: lb, CB: cb, S: s } = at;
  const kicker = at.K[0];
  const punter = at.P[0];

  // Returners come from skill-position depth, not the starters' workload, unless the user picked them.
  const krPool = [rbs[1], wrs[3], wrs[2], cb[2]].filter(Boolean);
  const prPool = [wrs[2], wrs[3], cb[2], rbs[1]].filter(Boolean);
  const best = (pool: Player[]) => pool.reduce((a, b) => (skill(b, 'returns') > skill(a, 'returns') ? b : a));
  const picked = (id: number | undefined) => {
    const p = id === undefined ? undefined : league.players[id];
    return p && p.teamId === team.id && !out.has(p.id) && isAvailable(p) ? p : undefined;
  };
  const st = coverUnit(league, team, out);
  const stCoach = specialTeamsEdge(league, team.id);
  // The kick unit's wings: the first healthy backup lineman and the second tight end (the first, if not).
  const backupOl = team.depthChart.OL.map((id) => league.players[id]).find((p) => p && fit(p.id));
  const wings = [...new Set([backupOl ?? tes[0], tes[1] ?? tes[0]])].filter((p): p is Player => !!p);
  const fg = [...ol, ...wings];

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
    rushRotation,
    k: kicker,
    p: punter,
    kr: picked(team.returners?.kr) ?? best(krPool),
    pr: picked(team.returners?.pr) ?? best(prPool),
    st,
    specialDiscipline: avg(st, discipline) + COACH_DISCIPLINE * stCoach,
    fg,
    fgDiscipline: avg(fg, discipline) + COACH_DISCIPLINE * stCoach,
    blockDiscipline: avg([...dt, ...edge], discipline) + COACH_DISCIPLINE * stCoach,
    stCoach,
    knocks,
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
  return [
    l.qb,
    ...l.rbs,
    ...l.wrs,
    ...(l.scheme.offense.personnel === '10' && l.wr4 ? [l.wr4] : []),
    ...l.tes,
    ...l.ol,
    ...l.dt,
    ...l.edge,
    ...l.lb,
    ...l.cb,
    ...l.s,
    ...l.rushRotation,
    l.k,
    l.p,
    l.kr,
    l.pr,
  ];
}
