/**
 * Form: how a club's units have played over its last few games, read from the box scores and nothing else. A pure
 * function of public results that draws from no stream. SNN's Column (`snnColumn.ts`) and a slumping leader's talk
 * (`playerTalks.ts`) both read it, which is how the two arrive together without either reading the other.
 * Spec: docs/superpowers/specs/2026-11-11-snn-column-and-storylines-design.md.
 */
import type { Game, League, Position, TeamGameStats } from './types';

/** The six units the Key matchups card names (`opposition.ts`), an offense's three and a defense's three. */
export const UNITS = ['offensive line', 'pass rush', 'run game', 'run defense', 'passing game', 'coverage'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * The bars, first guesses until the owner sets them from `npm run editions -- --seasons` (never moved to pass a test):
 * the span in games, the places that make a quarter of the league, and the results of the span that must agree.
 */
export const FORM = { games: 4, quarter: 8, results: 3 };

/** What a club's games add up to, for and against: every unit's measure is a ratio of two of these. */
export interface UnitSums {
  games: number;
  pass: number;
  attempts: number;
  dropbacks: number;
  sacks: number;
  rush: number;
  carries: number;
  allowedPass: number;
  facedPass: number;
  facedDropbacks: number;
  madeSacks: number;
  allowedRush: number;
  facedRush: number;
}
export const noSums = (): UnitSums => ({
  games: 0,
  pass: 0,
  attempts: 0,
  dropbacks: 0,
  sacks: 0,
  rush: 0,
  carries: 0,
  allowedPass: 0,
  facedPass: 0,
  facedDropbacks: 0,
  madeSacks: 0,
  allowedRush: 0,
  facedRush: 0,
});
/** One game added to a club's sums: its own side of the box score, then the other's. */
export function addGame(s: UnitSums, us: TeamGameStats, them: TeamGameStats): void {
  s.games++;
  s.pass += us.passYds;
  s.attempts += us.passAtt;
  s.dropbacks += us.passAtt + us.sacked;
  s.sacks += us.sacked;
  s.rush += us.rushYds;
  s.carries += us.rushAtt;
  s.allowedPass += them.passYds;
  s.facedPass += them.passAtt;
  s.facedDropbacks += them.passAtt + them.sacked;
  s.madeSacks += them.sacked;
  s.allowedRush += them.rushYds;
  s.facedRush += them.rushAtt;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
/** Each unit's number, and whether a lower one is better (sacks allowed, yards allowed). */
const MEASURE: Record<Unit, { of: (s: UnitSums) => number; low: boolean }> = {
  'offensive line': { of: (s) => ratio(s.sacks, s.dropbacks), low: true },
  'pass rush': { of: (s) => ratio(s.madeSacks, s.facedDropbacks), low: false },
  'run game': { of: (s) => ratio(s.rush, s.carries), low: false },
  'run defense': { of: (s) => ratio(s.allowedRush, s.facedRush), low: true },
  'passing game': { of: (s) => ratio(s.pass, s.attempts), low: false },
  coverage: { of: (s) => ratio(s.allowedPass, s.facedPass), low: true },
};
export const unitValue = (unit: Unit, s: UnitSums) => MEASURE[unit].of(s);
export const lowIsBetter = (unit: Unit) => MEASURE[unit].low;

export interface UnitForm {
  /** The unit's number over the span. */
  value: number;
  /** 1 is the league's best over each club's own span. */
  rank: number;
  games: number;
  /** The first and last week of the span. */
  from: number;
  to: number;
  won: number;
  lost: number;
  /** The same number over the club's earlier games this season; null under three of them. */
  before: { value: number; games: number; won: number; lost: number } | null;
  /** The league's number over the span's weeks. */
  league: number;
}

interface Span {
  sums: UnitSums;
  earlier: UnitSums;
  from: number;
  to: number;
  won: number;
  lost: number;
  wonBefore: number;
  lostBefore: number;
}

const sideOf = (g: Game, teamId: number) => {
  const home = g.homeId === teamId;
  const r = g.result!;
  return {
    us: home ? r.home : r.away,
    them: home ? r.away : r.home,
    mine: home ? r.homeScore : r.awayScore,
    theirs: home ? r.awayScore : r.homeScore,
  };
};

/** A club's regular-season games played through a week, oldest first. */
function gamesOf(l: League, teamId: number, through: number): Game[] {
  return l.games
    .filter(
      (g) =>
        g.season === l.season &&
        !g.playoffRound &&
        g.result &&
        g.week <= through &&
        (g.homeId === teamId || g.awayId === teamId),
    )
    .sort((a, b) => a.week - b.week || a.id - b.id);
}

function spanOf(l: League, teamId: number, through: number): Span | null {
  const all = gamesOf(l, teamId, through);
  if (all.length < FORM.games) return null;
  const last = all.slice(-FORM.games);
  const out: Span = {
    sums: noSums(),
    earlier: noSums(),
    from: last[0].week,
    to: last.at(-1)!.week,
    won: 0,
    lost: 0,
    wonBefore: 0,
    lostBefore: 0,
  };
  for (const g of all) {
    const s = sideOf(g, teamId);
    const late = last.includes(g);
    addGame(late ? out.sums : out.earlier, s.us, s.them);
    if (s.mine > s.theirs) late ? out.won++ : out.wonBefore++;
    else if (s.mine < s.theirs) late ? out.lost++ : out.lostBefore++;
  }
  return out;
}

/** Every club's span through a week, or null while a club has not played `FORM.games`. */
function spans(l: League, through: number): Map<number, Span> | null {
  const out = new Map<number, Span>();
  for (const t of l.teams) {
    const s = spanOf(l, t.id, through);
    if (!s) return null;
    out.set(t.id, s);
  }
  return out;
}

/**
 * A unit's form through a week: its number over the club's last `FORM.games` games, where that ranks among every
 * club's own last games, the results of the span, and the same number before it and around the league.
 */
export function unitForm(l: League, teamId: number, unit: Unit, through: number): UnitForm | null {
  const all = spans(l, through);
  const mine = all?.get(teamId);
  if (!all || !mine) return null;
  const { of, low } = MEASURE[unit];
  const value = of(mine.sums);
  let rank = 1;
  for (const [id, s] of all) {
    if (id === teamId) continue;
    const v = of(s.sums);
    // A tie goes to the lower team id, so the 32 places are each held once.
    if ((low ? v < value : v > value) || (v === value && id < teamId)) rank++;
  }
  const around = noSums();
  for (const g of l.games) {
    if (g.season !== l.season || g.playoffRound || !g.result || g.week < mine.from || g.week > mine.to) continue;
    addGame(around, g.result.home, g.result.away);
    addGame(around, g.result.away, g.result.home);
  }
  return {
    value,
    rank,
    games: mine.sums.games,
    from: mine.from,
    to: mine.to,
    won: mine.won,
    lost: mine.lost,
    before:
      mine.earlier.games >= 3
        ? { value: of(mine.earlier), games: mine.earlier.games, won: mine.wonBefore, lost: mine.lostBefore }
        : null,
    league: of(around),
  };
}

/** The unit a man plays in. A kicker and a punter are in none. */
export function unitOf(position: Position): Unit | null {
  switch (position) {
    case 'QB':
    case 'WR':
    case 'TE':
      return 'passing game';
    case 'RB':
      return 'run game';
    case 'OL':
      return 'offensive line';
    case 'EDGE':
      return 'pass rush';
    case 'DT':
    case 'LB':
      return 'run defense';
    case 'CB':
    case 'S':
      return 'coverage';
    default:
      return null;
  }
}

/** A starter's share of the most snaps a teammate at his position played in the game. */
const STARTED = 0.6;

/**
 * A man's form: his unit's over his club's last games, and how many of those he started. A start is read from the box
 * score, as the public would: he played most of the snaps his position's busiest man did.
 */
export function manForm(
  l: League,
  playerId: number,
  through: number,
): { unit: Unit; form: UnitForm; started: number } | null {
  const p = l.players[playerId];
  const unit = p ? unitOf(p.position) : null;
  if (!p || p.teamId === null || !unit) return null;
  const form = unitForm(l, p.teamId, unit, through);
  if (!form) return null;
  let started = 0;
  for (const g of gamesOf(l, p.teamId, through).slice(-FORM.games)) {
    const r = g.result!;
    const own = r.playerStats[playerId]?.snaps ?? 0;
    if (!own || r.playerTeams[playerId] !== p.teamId) continue;
    let most = 0;
    for (const [id, line] of Object.entries(r.playerStats)) {
      if (r.playerTeams[Number(id)] !== p.teamId || l.players[Number(id)]?.position !== p.position) continue;
      most = Math.max(most, line.snaps ?? 0);
    }
    if (own >= STARTED * most) started++;
  }
  return { unit, form, started };
}

/** He started every game of a span in which his unit was in the league's bottom quarter. */
export function inSlump(l: League, playerId: number, through: number): boolean {
  const m = manForm(l, playerId, through);
  return !!m && m.started === FORM.games && m.form.rank > l.teams.length - FORM.quarter;
}
