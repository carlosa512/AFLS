import { MOOD_ACTS, onDidNotReport } from './disputeRead';
import { coachOrder } from './coachDecisions';
import { teamCoaches, teamScheme } from './coaching';
import { spotsFor } from './schemes';
import { skill } from './attributes';
import { slotOvr } from './familiarity';
import { playerOvr, STARTERS } from './positions';
import { sizeEdge, typicalAt } from './size';
import type { Coach, DepthChart, Gear, Injury, League, Player, PlayingAt, Position, Team } from './types';
import { POSITIONS } from './types';
import type { RosterList } from './personnel/types';

/** One authoritative list query: legacy IR data is retained as the reserve-stint record. */
export function rosterList(p: Player): RosterList {
  if (p.retired) return 'retired';
  if (p.waiver) return 'waivers';
  if (p.teamId === null) return 'unattached';
  if (p.squad) return p.squad.kind;
  if (p.ir) return 'injuredReserve';
  return onDidNotReport(p) ? 'didNotReport' : 'active';
}

/** Eligible list membership, independent of health (emergency injury fallbacks still need this). */
export const onGameRoster = (p: Player) => rosterList(p) === 'active';

export function practiceSquad(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId).filter((p) => rosterList(p) === 'practiceSquad');
}

export function practicingPlayers(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId).filter(
    (p) => (onGameRoster(p) || rosterList(p) === 'practiceSquad') && (!p.injury || playingHurt(p.injury)),
  );
}

/**
 * Each league's players by club, in id order (the order a pass over `league.players` reads them): built from one pass
 * the first time a club's players are asked for, then kept current by `setTeam` and `addPlayer`. It lives beside the
 * league, never in it, so the save stays plain JSON and a loaded or copied league builds its own. Reading every
 * player the league ever had for each club, retired ones too, was 14% of a 16-season league.
 */
const byTeam = new WeakMap<League, Map<number, Player[]>>();

function clubIndex(league: League): Map<number, Player[]> {
  let index = byTeam.get(league);
  if (!index) {
    index = new Map();
    for (const p of Object.values(league.players)) {
      if (p.teamId === null || p.teamId === undefined) continue;
      const club = index.get(p.teamId);
      if (club) club.push(p);
      else index.set(p.teamId, [p]);
    }
    byTeam.set(league, index);
  }
  return index;
}

/** Into a club's list at his place by id. */
function place(club: Player[], p: Player): void {
  let lo = 0;
  let hi = club.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (club[mid].id < p.id) lo = mid + 1;
    else hi = mid;
  }
  club.splice(lo, 0, p);
}

function unplace(index: Map<number, Player[]>, p: Player, teamId: number | null | undefined): void {
  if (teamId === null || teamId === undefined) return;
  const club = index.get(teamId);
  const at = club?.indexOf(p) ?? -1;
  if (at >= 0) club!.splice(at, 1);
}

/** How often a club's list was read again because a player's club changed around `setTeam` (the game never does). */
let heals = 0;
export const teamIndexHeals = () => heals;

export function teamPlayers(league: League, teamId: number): Player[] {
  let club = clubIndex(league).get(teamId) ?? [];
  // A player whose club was changed by hand, not through `setTeam` (a test, an old save's upgrade): read again.
  if (club.some((p) => p.teamId !== teamId || league.players[p.id] !== p)) {
    heals++;
    byTeam.delete(league);
    club = clubIndex(league).get(teamId) ?? [];
  }
  return club.slice();
}

/** Move a player to a club (null: none). Every change of a player's club goes through here. */
export function setTeam(league: League, p: Player, teamId: number | null): void {
  const index = byTeam.get(league);
  if (index && p.teamId !== teamId) {
    unplace(index, p, p.teamId);
    if (teamId !== null) {
      const club = index.get(teamId);
      if (club) place(club, p);
      else index.set(teamId, [p]);
    }
  }
  // Waiting on room at the club he reported to (G4): a new club has none to make.
  if (p.teamId !== teamId && p.morale?.reported) delete p.morale.reported;
  p.teamId = teamId;
}

/** A new player into the league (a draft class, an undrafted signing, a generated free agent). */
export function addPlayer(league: League, p: Player): void {
  const index = byTeam.get(league);
  const before = league.players[p.id];
  if (index && before) unplace(index, before, before.teamId);
  league.players[p.id] = p;
  if (index && p.teamId !== null && p.teamId !== undefined) {
    const club = index.get(p.teamId);
    if (club) place(club, p);
    else index.set(p.teamId, [p]);
  }
}

/** Players counting toward the 53; employment and practice squad membership are separate queries. */
export function activeRoster(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId).filter(onGameRoster);
}

/** Playing through an injury: on injections, or back early in protective gear once his wait is over. */
export const playingHurt = (i: Injury | undefined) =>
  !!i && (i.treatment === 'injection' || (i.treatment === 'brace' && !i.braceWait));

/** Can he play this week? Not on reserve, and healthy or playing through it. */
export const isAvailable = (p: Player) => onGameRoster(p) && (!p.injury || playingHurt(p.injury));

/**
 * Depth chart ordered by what each player is worth where he lines up: his own position, or the one `playingAt`
 * puts him at (his worth there carries the out-of-position knock, so he ranks among its own players by it).
 */
export function buildAutoDepthChart(
  players: Player[],
  playingAt: Record<number, PlayingAt> = {},
  staff: readonly Coach[] = [],
  elevated: ReadonlySet<number> = new Set(),
  wrSpots = 3,
): DepthChart {
  const chart = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as Player[]])) as Record<Position, Player[]>;
  // Retain ordinary IR chart entries for old saves, but never admit a squad member as emergency depth.
  for (const p of players)
    if ((!p.squad || elevated.has(p.id)) && !p.retired) chart[playingAt[p.id]?.pos ?? p.position].push(p);
  const out = {} as DepthChart;
  for (const pos of POSITIONS) out[pos] = spotOrder(coachOrder(chart[pos], pos, staff), pos, wrSpots).map((p) => p.id);
  out.OL = lineOrder(out.OL.map((id) => players.find((p) => p.id === id)!)).map((p) => p.id);
  return out;
}

/**
 * Where the starters line up, by build: the corners who hold up best against a typical X and Z play outside and the
 * other starter covers the slot, and the receivers who win best against a typical corner play X and Z and the other
 * works the slot. An offense with two receiver spots (12 personnel) has no slot, so nothing moves: its third receiver
 * doesn't play, and size never sends a better one there. Who starts is the overall's call; this only says where, and
 * the bench behind them stays in its order.
 */
export function spotOrder(players: Player[], pos: Position, wrSpots = 3): Player[] {
  const n = pos === 'WR' ? Math.min(STARTERS.WR, wrSpots) : STARTERS[pos];
  const starters = players.slice(0, n);
  const rest = players.slice(n);
  // The two outside keep the coaches' order between them: the first spot draws the most looks and the bracket, and
  // size only says outside or slot (ranking them by it made a deep threat the number one and ran up leaders' yards).
  const outsideFirst = (score: (p: Player) => number) => {
    const out = new Set([...starters].sort((a, b) => score(b) - score(a)).slice(0, 2));
    return [...starters.filter((p) => out.has(p)), ...starters.filter((p) => !out.has(p)), ...rest];
  };
  if (pos === 'CB') return outsideFirst((p) => skill(p, 'coverage') + sizeEdge(p, 'contested', typicalAt('WR')));
  if (pos === 'WR') return outsideFirst((p) => skill(p, 'deepRoutes') + sizeEdge(p, 'contested', typicalAt('CB')));
  return players;
}

/**
 * The five best linemen in spot order (LT, LG, C, RG, RT; see `schemes.ts`), the rest behind them as
 * depth: the best pass protectors play tackle, the line's sharpest mind snaps the ball, the guards
 * are what's left. Who starts is the overall's call; this only says where.
 */
export function lineOrder(ol: Player[]): Player[] {
  const five = ol.slice(0, 5);
  if (five.length < 5) return ol;
  // Length counts outside: a tackle faces the edge rusher's speed, and a short-armed one is a guard.
  const outside = (p: Player) => skill(p, 'passPro') - sizeEdge(typicalAt('EDGE'), 'edgeLength', p);
  const byPass = [...five].sort((a, b) => outside(b) - outside(a));
  const [lt, rt] = byPass;
  const inside = five.filter((p) => p !== lt && p !== rt);
  const c = inside.reduce((a, b) => (skill(b, 'discipline') > skill(a, 'discipline') ? b : a));
  const [lg, rg] = inside.filter((p) => p !== c).sort((a, b) => skill(b, 'runBlocking') - skill(a, 'runBlocking'));
  return [lt, lg, c, rg, rt, ...ol.slice(5)];
}

/**
 * Make sure the depth chart only references players currently on the team and that every roster player
 * appears exactly once. An auto-sorted chart files everyone where he lines up (`playingAt`, else his own
 * position); a hand-sorted one keeps a player where the user put him and adds anyone missing where he lines up.
 * A `playingAt` entry goes once he's off the team or that position is now his own.
 */
export function syncDepthChart(league: League, team: Team): void {
  const players = teamPlayers(league, team.id).filter((p) => !p.squad && !p.retired);
  const byId = new Map(players.map((p) => [p.id, p]));
  if (team.playingAt)
    for (const id of Object.keys(team.playingAt).map(Number)) {
      const p = byId.get(id);
      if (!p || p.position === team.playingAt[id].pos) delete team.playingAt[id];
    }
  const at = team.playingAt ?? {};
  if (team.autoDepth) {
    team.depthChart = buildAutoDepthChart(
      players,
      at,
      teamCoaches(league, team.id),
      undefined,
      wrSpotsOf(league, team.id),
    );
    keepSnapsPromises(league, team);
    return;
  }
  const placed = new Set<number>();
  const kept = {} as DepthChart;
  for (const pos of POSITIONS) {
    // A player lined up elsewhere stays out of his own group.
    kept[pos] = (team.depthChart[pos] ?? []).filter(
      (id) => byId.has(id) && !placed.has(id) && (!at[id] || at[id].pos === pos),
    );
    kept[pos].forEach((id) => placed.add(id));
  }
  const auto = buildAutoDepthChart(players, at);
  for (const pos of POSITIONS) team.depthChart[pos] = [...kept[pos], ...auto[pos].filter((id) => !placed.has(id))];
  keepSnapsPromises(league, team);
}

/**
 * An AI club keeps a snaps promise (G4): a promised man just past its starters takes the last starter's place while
 * the promise runs, when he's within a point of him. Your club's chart is yours to set.
 */
function keepSnapsPromises(league: League, team: Team): void {
  if (!MOOD_ACTS.on || team.id === league.userTeamId) return;
  for (const pos of POSITIONS) {
    const chart = team.depthChart[pos];
    const n = STARTERS[pos];
    const last = league.players[chart[n - 1]];
    if (!last) continue;
    const i = chart.findIndex((id, k) => {
      const t = k >= n ? league.players[id]?.morale?.talk : undefined;
      return t?.club === team.id && t.promise?.kind === 'snaps' && playerOvr(last) - playerOvr(league.players[id]) <= 1;
    });
    if (i < 0) continue;
    [chart[n - 1], chart[i]] = [chart[i], chart[n - 1]];
  }
}

/**
 * Line a player up at a position, his own or another ("Play at…"): away from his own he plays out of position
 * and takes a knock (`knockFor`). The move is remembered (`playingAt`), so an auto-sorted chart keeps it; only a
 * pick of an exact spot (`index`, a drag) hand-sorts the chart. A user's move of staff's man makes it his.
 */
export function placeAt(
  league: League,
  playerId: number,
  pos: Position,
  index?: number,
  by: PlayingAt['by'] = 'user',
): void {
  const p = league.players[playerId];
  if (p.teamId === null) throw new Error('Not on a team.');
  const team = league.teams[p.teamId];
  if (pos === p.position) {
    if (team.playingAt) delete team.playingAt[playerId];
  } else
    (team.playingAt ??= {})[playerId] =
      by === 'staff' ? { pos, by, since: { season: league.season, week: league.week } } : { pos, by };
  for (const q of POSITIONS) team.depthChart[q] = team.depthChart[q].filter((id) => id !== playerId);
  if (index !== undefined) {
    const list = team.depthChart[pos];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, playerId);
    team.autoDepth = false;
  }
  syncDepthChart(league, team);
}

/** The user moved staff's man (a drag within his group): the move is his now, and staff won't send him back. */
export function claimMove(league: League, playerId: number): void {
  const p = league.players[playerId];
  const at = p.teamId === null ? undefined : league.teams[p.teamId].playingAt?.[playerId];
  if (at?.by === 'staff') league.teams[p.teamId!].playingAt![playerId] = { pos: at.pos, by: 'user' };
}

/**
 * Send a player lined up elsewhere back to his own position ("Play at…" his own, or staff's cover ending). An
 * auto-sorted chart files him by rating itself; on a hand-sorted one he goes back among his group by rating, where
 * auto-sort would put him, not last, so a starter who played somewhere else for a week isn't buried.
 */
export function returnHome(league: League, playerId: number): void {
  const p = league.players[playerId];
  if (p.teamId === null) {
    // Gone already: no team keeps a move for him.
    for (const t of league.teams) if (t.playingAt) delete t.playingAt[playerId];
    return;
  }
  const team = league.teams[p.teamId];
  if (team.playingAt) delete team.playingAt[playerId];
  for (const q of POSITIONS) team.depthChart[q] = team.depthChart[q].filter((id) => id !== playerId);
  if (!team.autoDepth) {
    const rank = new Map(buildAutoDepthChart(teamPlayers(league, team.id))[p.position].map((id, i) => [id, i]));
    const mine = rank.get(p.id) ?? Infinity;
    const list = team.depthChart[p.position];
    // Only his own room counts: a man the user lined up here from another position has no rank in it.
    const at = list.findIndex((id) => rank.has(id) && rank.get(id)! > mine);
    list.splice(at < 0 ? list.length : at, 0, p.id);
  }
  syncDepthChart(league, team);
}

/** The user took injuries back from his staff: its moves are his now (nothing on the field changes). */
export function handOverMoves(league: League, teamId: number): void {
  for (const at of Object.values(league.teams[teamId].playingAt ?? {}))
    if (at.by === 'staff') {
      at.by = 'user';
      delete at.since;
    }
}

/** Where a player is lined up on his team's depth chart (his own position unless the user moved him). */
export function slotOf(league: League, p: Player): Position {
  if (p.teamId === null) return p.position;
  const chart = league.teams[p.teamId].depthChart;
  return POSITIONS.find((pos) => chart[pos].includes(p.id)) ?? p.position;
}

/** The least a player has to be worth at a position, knock included, to cover it from the roster: a fringe backup. */
export const COVER_BAR = 8.5;

/**
 * Who covers a short position from the roster ("use what you have"): the healthy player worth the most there
 * (`slotOvr`, knock included) who isn't already lined up elsewhere, doesn't start at his own position, and whose
 * position keeps `need` healthy players without him. Nobody, if the best of them isn't a decent backup there.
 */
export function chooseCover(
  league: League,
  team: Team,
  pos: Position,
  need: Readonly<Record<Position, number>>,
): Player | null {
  const players = activeRoster(league, team.id).filter(isAvailable);
  const healthy = new Map<Position, number>();
  for (const p of players) healthy.set(slotOf(league, p), (healthy.get(slotOf(league, p)) ?? 0) + 1);
  const best = players
    .filter(
      (p) =>
        p.position !== pos &&
        !team.playingAt?.[p.id] &&
        !starters(league, team, p.position).includes(p) &&
        (healthy.get(p.position) ?? 0) - 1 >= need[p.position],
    )
    .sort((a, b) => slotOvr(b, pos) - slotOvr(a, pos))[0];
  return best && slotOvr(best, pos) >= COVER_BAR ? best : null;
}

/** Starters at a position per the depth chart, skipping anyone hurt (may be fewer if the roster is short). */
export function starters(league: League, team: Team, pos: Position): Player[] {
  const out: Player[] = [];
  for (const id of team.depthChart[pos]) {
    const p = league.players[id];
    if (p && isAvailable(p)) out.push(p);
    if (out.length === STARTERS[pos]) return out;
  }
  // Preserve the old injury fallback for strength estimates, but never borrow practice squad depth.
  return out.length
    ? out
    : team.depthChart[pos]
        .map((id) => league.players[id])
        .filter((p) => p && !p.squad && !p.retired && p.teamId === team.id)
        .slice(0, STARTERS[pos]);
}

/** The units a team's strength is read by, and the positions whose starters make each one. */
export const UNIT_POSITIONS = {
  qb: ['QB'],
  offense: ['QB', 'RB', 'WR', 'TE', 'OL'],
  defense: ['DT', 'EDGE', 'LB', 'CB', 'S'],
  special: ['K', 'P'],
} as const satisfies Record<string, readonly Position[]>;

/** The headline number from the units. QB play matters most, so it is weighted in on its own as well. */
export const headline = (qb: number, offense: number, defense: number, special: number) =>
  qb * 0.2 + offense * 0.35 + defense * 0.4 + special * 0.05;

/** Team strength summary: average starter overall per unit, on the 1–20 scale. */
export function teamRatings(league: League, team: Team) {
  const avg = (positions: readonly Position[]) => {
    // A starter lined up out of position counts at what he's worth there, knock included.
    const ps = positions.flatMap((pos) => starters(league, team, pos).map((p) => slotOvr(p, pos)));
    return ps.reduce((sum, v) => sum + v, 0) / Math.max(1, ps.length);
  };
  const qb = avg(UNIT_POSITIONS.qb);
  const offense = avg(UNIT_POSITIONS.offense);
  const defense = avg(UNIT_POSITIONS.defense);
  const special = avg(UNIT_POSITIONS.special);
  return { overall: headline(qb, offense, defense, special), qb, offense, defense, special };
}

export interface PlayerIdentity {
  firstName: string;
  lastName: string;
  jersey: number;
}

/** Why a name or number edit can't go through, or null. Teammates can't share a number; anyone else can. */
export function identityProblem(league: League, p: Player, edit: PlayerIdentity): string | null {
  if (!edit.firstName.trim() || !edit.lastName.trim()) return 'Both names are needed.';
  if (edit.firstName.trim().length > 24 || edit.lastName.trim().length > 24) return 'Names are 24 letters at most.';
  if (!Number.isInteger(edit.jersey) || edit.jersey < 0 || edit.jersey > 99) return 'Numbers run 0–99.';
  if (p.teamId !== null) {
    const holder = teamPlayers(league, p.teamId).find((x) => x.id !== p.id && x.jersey === edit.jersey);
    if (holder) return `#${edit.jersey} belongs to ${holder.firstName} ${holder.lastName}.`;
  }
  return null;
}

/** Renames or renumbers a player (a cosmetic edit: nothing in the sim reads names or numbers). */
export function editPlayerIdentity(league: League, playerId: number, edit: PlayerIdentity): void {
  const p = league.players[playerId];
  const problem = identityProblem(league, p, edit);
  if (problem) throw new Error(problem);
  const firstName = edit.firstName.trim();
  const lastName = edit.lastName.trim();
  if (firstName !== p.firstName || lastName !== p.lastName) p.nameEdited = true;
  if (edit.jersey !== p.jersey) p.numberEdited = true;
  p.firstName = firstName;
  p.lastName = lastName;
  p.jersey = edit.jersey;
}

/** Dress a player's avatar in `gear`, or `null` to give him back his own. Cosmetic, like a rename: any player. */
export function editPlayerGear(league: League, playerId: number, gear: Gear | null): void {
  const p = league.players[playerId];
  if (gear) p.gear = JSON.parse(JSON.stringify(gear)) as Gear;
  else delete p.gear;
}

/**
 * The head coach's word on a hand-sorted chart (the screen names the player): a starter the auto-sort would move off
 * his spot for his build, a corner it would play at nickel or a tackle it would play inside. It runs the same order
 * on the same available starters, so an elite small corner it keeps outside draws no note. Nothing under auto-sort.
 */
export function spotNotes(league: League, teamId: number): { playerId: number; text: string }[] {
  const team = league.teams[teamId];
  if (team.autoDepth) return [];
  const at = (pos: Position) =>
    team.depthChart[pos].map((id) => league.players[id]).filter((p): p is Player => !!p && isAvailable(p));
  const out: { playerId: number; text: string }[] = [];
  const cbs = at('CB').slice(0, STARTERS.CB);
  const outside = new Set(spotOrder(cbs, 'CB').slice(0, 2));
  for (const p of cbs.slice(0, 2))
    if (!outside.has(p) && sizeEdge(p, 'contested', typicalAt('WR')) <= -1)
      out.push({ playerId: p.id, text: "is giving up height outside. He's a nickel." });
  const ol = at('OL').slice(0, STARTERS.OL);
  if (ol.length === STARTERS.OL) {
    const order = lineOrder(ol);
    const tackles = new Set([order[0], order[4]]);
    for (const p of [ol[0], ol[4]])
      if (!tackles.has(p) && sizeEdge(typicalAt('EDGE'), 'edgeLength', p) >= 1)
        out.push({ playerId: p.id, text: "is short for tackle. He's a guard." });
  }
  return out;
}

/** How many receivers a team's offense lines up (two in 12 personnel), for where spot fit may move them. */
export function wrSpotsOf(league: League, teamId: number): number {
  return spotsFor(teamScheme(league, teamId), 'WR').length;
}
