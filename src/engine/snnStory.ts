/**
 * A game's angle for SNN's weekly edition (`snnWeek.ts`): the one thing that makes a result a story, read from its box
 * score and the standings before it. Pure functions of public facts: nothing here reads a rating, a mood or the sim's
 * randomness, and nothing in the sim reads this. Spec: docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md §3.
 *
 * An angle is news only when it is rare, so each cutoff was set from how often it fires in the NFL and in our own league
 * (`scripts/research-edition.py`). Tune them here, from a season of editions (`npm run editions`).
 */
import type { Game, League, StatLine } from './types';

export const CUT = {
  /** An unbeaten club at 5–0 or better loses, or a winless one at 0–5 or worse wins: about two a season. */
  runGames: 5,
  /** A winning or losing streak this long ends: about one every two weeks. At five it was one a week. */
  streak: 6,
  /** The winner's winning percentage sat this far below the loser's: nine in ten such NFL winners were real underdogs. */
  upsetGap: 0.4,
  /** Records mean too little before this week is played. */
  upsetAfterWeek: 5,
  /** The winner trailed by this much at the end of a quarter (a halftime-only rule missed the fourth-quarter ones). */
  comeback: 10,
  /** The winner was outgained by this many yards. */
  yardage: 100,
  /** Won by this much, ahead after every quarter. A 21-point win happens twice a week. */
  rout: 28,
  /** A backup's dropbacks before a hurt starter makes "a quarterback lost". */
  backupDropbacks: 10,
  /** One player's day. Looser marks (150 yards, four passing touchdowns, two picks) fired in half our games. */
  day: { td: 3, scrimmage: 200, passYds: 400, passTd: 5, sacks: 3, int: 3 },
} as const;

/** In order: a game's angle is the first that fits, and the rest that fit are its support. */
export const ANGLES = [
  'unbeatenFalls',
  'winlessWins',
  'upset',
  'tie',
  'streakEnds',
  'comeback',
  'yardage',
  'day',
  'qbLost',
  'rout',
  'overtime',
  'result',
] as const;
export type GameAngle = (typeof ANGLES)[number];

/** A club's record before a game. `streak`: +3 has won three straight, −2 has lost two; a tie resets it. */
export interface ClubRecord {
  w: number;
  l: number;
  t: number;
  streak: number;
}
export interface Day {
  playerId: number;
  teamId: number;
  mark: keyof typeof CUT.day;
  value: number;
}
export interface GameFacts {
  gameId: number;
  week: number;
  /** Null on a tie. */
  winnerId: number | null;
  loserId: number | null;
  before: { home: ClubRecord; away: ClubRecord };
  angle: GameAngle;
  fits: GameAngle[];
  /** The best day in the game, whichever angle won. */
  day?: Day;
  /** The most the winner trailed by at the end of a quarter. */
  deficit?: number;
  /** The winner's total yards less the loser's. */
  yards?: number;
  qbLost?: { teamId: number; starterId: number; backupId: number };
  /** The run or streak that ended: whose, and how long (negative for losses). */
  streak?: { teamId: number; length: number };
}

const NONE: ClubRecord = { w: 0, l: 0, t: 0, streak: 0 };
export const recordPct = (r: ClubRecord) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

/** Every club's record and streak from this season's regular-season results before `week`. */
export function recordsBefore(l: League, week: number): Map<number, ClubRecord> {
  const out = new Map<number, ClubRecord>(l.teams.map((t) => [t.id, { ...NONE }]));
  const played = l.games
    .filter((g) => g.season === l.season && !g.playoffRound && g.result && g.week < week)
    .sort((a, b) => a.week - b.week || a.id - b.id);
  for (const g of played) {
    const [hs, as] = [g.result!.homeScore, g.result!.awayScore];
    for (const [id, us, them] of [
      [g.homeId, hs, as],
      [g.awayId, as, hs],
    ]) {
      const r = out.get(id) ?? { ...NONE };
      if (us > them) out.set(id, { ...r, w: r.w + 1, streak: r.streak > 0 ? r.streak + 1 : 1 });
      else if (us < them) out.set(id, { ...r, l: r.l + 1, streak: r.streak < 0 ? r.streak - 1 : -1 });
      else out.set(id, { ...r, t: r.t + 1, streak: 0 });
    }
  }
  return out;
}

/** What one man did against each mark: touchdowns scored count returns and defensive scores. */
const DAY_VALUE: Record<keyof typeof CUT.day, (s: StatLine) => number> = {
  td: (s) => (s.rushTd ?? 0) + (s.recTd ?? 0) + (s.krTd ?? 0) + (s.prTd ?? 0) + (s.defTd ?? 0),
  scrimmage: (s) => (s.rushYds ?? 0) + (s.recYds ?? 0),
  passYds: (s) => s.passYds ?? 0,
  passTd: (s) => s.passTd ?? 0,
  sacks: (s) => s.sacks ?? 0,
  int: (s) => s.defInt ?? 0,
};

/** The day furthest past its mark, as a share of the mark (300 scrimmage yards beats three touchdowns). */
function bestDay(g: Game): Day | undefined {
  const r = g.result!;
  let best: (Day & { over: number }) | undefined;
  for (const [id, s] of Object.entries(r.playerStats)) {
    for (const mark of Object.keys(CUT.day) as (keyof typeof CUT.day)[]) {
      const value = DAY_VALUE[mark](s);
      const over = value / CUT.day[mark];
      if (over >= 1 && (!best || over > best.over || (over === best.over && Number(id) < best.playerId)))
        best = { playerId: Number(id), teamId: r.playerTeams[Number(id)], mark, value, over };
    }
  }
  if (!best) return undefined;
  const { over: _over, ...day } = best;
  return day;
}

/** A quarterback hurt in the game whose club then gave a second passer real work. */
function lostQuarterback(l: League, g: Game): GameFacts['qbLost'] {
  const r = g.result!;
  for (const hurt of r.injuries ?? []) {
    if (l.players[hurt.playerId]?.position !== 'QB') continue;
    const backup = Object.entries(r.playerStats)
      .map(([id, s]) => ({ id: Number(id), dropbacks: s.dropbacks ?? 0 }))
      .filter((x) => x.id !== hurt.playerId && r.playerTeams[x.id] === hurt.teamId)
      .filter((x) => x.dropbacks >= CUT.backupDropbacks)
      .sort((a, b) => b.dropbacks - a.dropbacks || a.id - b.id)[0];
    if (backup) return { teamId: hurt.teamId, starterId: hurt.playerId, backupId: backup.id };
  }
  return undefined;
}

/** A played game's facts and its angle. `before` is `recordsBefore(l, g.week)`. */
export function gameFacts(l: League, g: Game, before: Map<number, ClubRecord>): GameFacts {
  const r = g.result!;
  const home = before.get(g.homeId) ?? NONE;
  const away = before.get(g.awayId) ?? NONE;
  const tied = r.homeScore === r.awayScore;
  const homeWon = r.homeScore > r.awayScore;
  const winnerId = tied ? null : homeWon ? g.homeId : g.awayId;
  const loserId = tied ? null : homeWon ? g.awayId : g.homeId;
  const fits = new Set<GameAngle>();
  const facts: GameFacts = {
    gameId: g.id,
    week: g.week,
    winnerId,
    loserId,
    before: { home, away },
    angle: 'result',
    fits: [],
  };

  if (tied) fits.add('tie');
  else {
    const [won, lost] = homeWon ? [home, away] : [away, home];
    const [wq, lq] = homeWon ? [r.quarters.home, r.quarters.away] : [r.quarters.away, r.quarters.home];
    const [wt, lt] = homeWon ? [r.home, r.away] : [r.away, r.home];
    if (lost.l + lost.t === 0 && lost.w >= CUT.runGames) {
      fits.add('unbeatenFalls');
      facts.streak = { teamId: loserId!, length: lost.streak };
    }
    if (won.w + won.t === 0 && won.l >= CUT.runGames) {
      fits.add('winlessWins');
      facts.streak ??= { teamId: winnerId!, length: won.streak };
    }
    const games = (x: ClubRecord) => x.w + x.l + x.t;
    if (
      g.week > CUT.upsetAfterWeek &&
      games(won) &&
      games(lost) &&
      recordPct(lost) - recordPct(won) >= CUT.upsetGap - 1e-9
    )
      fits.add('upset');
    if (lost.streak >= CUT.streak) {
      fits.add('streakEnds');
      facts.streak ??= { teamId: loserId!, length: lost.streak };
    } else if (won.streak <= -CUT.streak) {
      fits.add('streakEnds');
      facts.streak ??= { teamId: winnerId!, length: won.streak };
    }
    // The score at the end of each of the first three quarters: what a box score keeps.
    const through = (q: number[], n: number) => q.slice(0, n).reduce((a, b) => a + b, 0);
    const behind = [1, 2, 3].map((n) => through(lq, n) - through(wq, n));
    const deficit = Math.max(...behind);
    if (deficit > 0) facts.deficit = deficit;
    if (deficit >= CUT.comeback) fits.add('comeback');
    facts.yards = wt.totalYds - lt.totalYds;
    if (facts.yards <= -CUT.yardage) fits.add('yardage');
    if (Math.abs(r.homeScore - r.awayScore) >= CUT.rout && behind.every((b) => b < 0)) fits.add('rout');
  }
  facts.day = bestDay(g);
  if (facts.day) fits.add('day');
  facts.qbLost = lostQuarterback(l, g);
  if (facts.qbLost) fits.add('qbLost');
  else delete facts.qbLost;
  if (!facts.day) delete facts.day;
  if (r.overtime) fits.add('overtime');
  if (!fits.size) fits.add('result');
  facts.fits = ANGLES.filter((a) => fits.has(a));
  facts.angle = facts.fits[0];
  return facts;
}
