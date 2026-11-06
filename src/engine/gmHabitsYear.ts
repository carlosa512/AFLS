import { seasonAwards } from './awards';
import { addMarbles, aiGm, draftedBy, drawHabits, habitsForce, HABIT_IDS, logMove, usedThisYear } from './gmHabits';
import { playerOvr } from './positions';
import { Rng } from './rng';
import { seasonRole } from './scouting';
import type { GeneralManager, HabitMove, League } from './types';

/** Seasons after a move before its outcome can be read. */
const DUE: Record<string, number> = {
  bridgeQb: 2,
  tradeUpQb: 1,
  extendEarly: 3,
  sellsEarly: 2,
  hisGuys: 1,
  firstsForStars: 1,
  swaps: 1,
  bpa: 2,
  tagsFirst: 2,
  youngQb: 1,
  gunShy: 1,
};

/** How a logged move turned out: 1 a marble for the habit, -1 one for its fade, 0 none, null not yet. */
function verdict(league: League, e: HabitMove): 1 | -1 | 0 | null {
  const age = league.season - e.season;
  if (age < (DUE[e.habit] ?? Infinity)) return null;
  const p = e.playerId === undefined ? undefined : league.players[e.playerId];
  if (e.playerId !== undefined && !p) return 0;
  const s = e.season;
  const on = !!p && p.teamId === e.teamId;
  const starts = (season: number) => !!p && seasonRole(league, p, season)?.role === 'starter';
  switch (e.habit) {
    case 'bridgeQb':
      return on && starts(s + 1) ? 1 : -1;
    case 'tradeUpQb':
      if (starts(s)) return 1;
      if (!on) return -1;
      // Still on the club but benched: give him the next year.
      return age >= 2 ? (starts(s + 1) ? 1 : -1) : null;
    case 'extendEarly':
      return on && starts(s + 2) ? 1 : -1;
    case 'sellsEarly': {
      const picks = [s, s + 1].flatMap((y) => seasonAwards(league, y)?.allLeague.flat() ?? []);
      const his = picks.filter((w) => w.playerId === e.playerId);
      if (his.some((w) => w.teamId !== e.teamId)) return -1;
      return e.good && !his.length ? 1 : 0;
    }
    case 'hisGuys':
      return !on ? -1 : starts(s) ? 1 : 0;
    case 'firstsForStars':
      return league.history.find((h) => h.season === s)?.playoffs?.[e.teamId] ? 1 : -1;
    case 'swaps':
      return 1;
    case 'bpa':
      if (starts(s) || starts(s + 1)) return 1;
      return age >= 3 ? (starts(s + 2) ? 1 : -1) : null;
    case 'tagsFirst':
      return on ? 1 : -1;
    case 'youngQb': {
      if (!on) return -1;
      if (playerOvr(p!) >= (e.ovr ?? Infinity) + 0.5) return 1;
      return 0;
    }
    default:
      return 0;
  }
}

/** The year's moves, read against what became of them and turned into marbles before the habits fade and draw. */
export function resolveMoves(league: League, gm: GeneralManager): void {
  const log = gm.habitLog;
  if (!log) return;
  // Oldest first, so a third flat year in a row sees the two before it already read.
  for (const e of [...log].sort((a, b) => a.season - b.season)) {
    if (e.resolved !== undefined) continue;
    let v = verdict(league, e);
    if (v === null) continue;
    if (e.habit === 'youngQb' && v === 0) {
      const mine = log.filter((m) => m.habit === 'youngQb' && m.playerId === e.playerId && m.season < e.season);
      const lastTwo = mine.sort((a, b) => a.season - b.season).slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((m) => m.resolved === 0)) v = -1;
    }
    e.resolved = v;
    if (v) addMarbles(gm, v === 1 ? e.habit : `fade:${e.habit}`, 1);
  }
}

/** A young quarterback his GM drafted who started for a losing club: a season of sticking with him, logged against the one just played. */
export function noteYoungQbSeasons(league: League): void {
  const last = league.season - 1;
  for (const team of league.teams) {
    const gm = aiGm(league, team);
    const rec = league.history.find((h) => h.season === last)?.records[team.id];
    if (!gm || !rec) continue;
    const games = rec.w + rec.l + rec.t;
    if (!games || rec.w + rec.t / 2 >= games / 2) continue;
    for (const p of Object.values(league.players)) {
      // The year's p.age++ has run: 25 and under when the season was played.
      if (p.teamId !== team.id || p.position !== 'QB' || p.age > 26 || !draftedBy(gm, p)) continue;
      if (seasonRole(league, p, last)?.role !== 'starter') continue;
      logMove(league, team, 'youngQb', { playerId: p.id, ovr: playerOvr(p) });
      const m = gm.habitLog?.at(-1);
      if (m) m.season = last;
    }
  }
}

/**
 * The new league year's habit step. `league.season` has just ticked, so the season just played is `season - 1`.
 * A GM between jobs keeps his marbles and his grip: nothing draws for him.
 */
export function habitsNewYear(league: League): void {
  const played = league.season - 1;
  noteYoungQbSeasons(league);
  for (const gm of Object.values(league.gms)) {
    if (gm.id === league.userGmId || gm.retired) continue;
    resolveMoves(league, gm);
    for (const id of HABIT_IDS) if (gm.habits?.[id] && !usedThisYear(gm, id, played)) addMarbles(gm, `fade:${id}`, 1);
    if (gm.teamId === null || habitsForce.all || habitsForce.off) continue;
    drawHabits(league, gm, new Rng(`${league.seed}:${league.season}:gm-habits:${gm.id}`));
  }
}
