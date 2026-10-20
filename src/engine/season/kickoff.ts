/**
 * When each game kicks off, NFL-style: a Thursday night game, the Sunday 1:00 and 4:05/4:25 windows,
 * Sunday and Monday nights, and the playoffs' Saturday-to-Monday windows. Times are US Eastern, as the
 * league publishes them. Prime time leans toward last season's better teams and spreads across the
 * league; a team that played on Monday night never turns around for Thursday; a western home team never
 * hosts at 1:00 (10:00 or 11:00 where it plays). The kickoff decides whether a game is played at night
 * (`weather.ts`). Each season's slots come from their own seeded stream, so they move nothing else.
 */
import { ZONES } from '../data/stadiums';
import { Rng } from '../rng';
import type { Game, Kickoff, League, PlayoffRound } from '../types';

const at = (h: number, m = 0) => h * 60 + m;
export const THURSDAY: Kickoff = { day: 'thu', et: at(20, 15) };
export const EARLY: Kickoff = { day: 'sun', et: at(13) };
export const LATE: Kickoff[] = [
  { day: 'sun', et: at(16, 5) },
  { day: 'sun', et: at(16, 25) },
];
export const SUNDAY_NIGHT: Kickoff = { day: 'sun', et: at(20, 20) };
export const MONDAY: Kickoff = { day: 'mon', et: at(20, 15) };
/** Week 18's Saturday doubleheader, set once week 17 is played (`season/flex.ts`). */
export const SATURDAY: Kickoff[] = [
  { day: 'sat', et: at(16, 30) },
  { day: 'sat', et: at(20) },
];
/** Games in the Sunday late window most weeks (the rest kick off at 1:00). */
const LATE_GAMES = 4;

/** The playoffs' windows, round by round (Wild Card: two Saturday, three Sunday, one Monday). */
const PLAYOFF_WINDOWS: Record<PlayoffRound, Kickoff[]> = {
  WC: [
    { day: 'sat', et: at(16, 30) },
    { day: 'sat', et: at(20, 15) },
    { day: 'sun', et: at(13) },
    { day: 'sun', et: at(16, 30) },
    { day: 'sun', et: at(20, 15) },
    { day: 'mon', et: at(20, 15) },
  ],
  DIV: [
    { day: 'sat', et: at(16, 30) },
    { day: 'sat', et: at(20, 15) },
    { day: 'sun', et: at(15) },
    { day: 'sun', et: at(18, 30) },
  ],
  CONF: [
    { day: 'sun', et: at(15) },
    { day: 'sun', et: at(18, 30) },
  ],
  FINAL: [{ day: 'sun', et: at(18, 30) }],
};

/** After dark: the night windows, and January's 6:30 kickoffs. */
export const isPrimeTime = (k: Kickoff) => k.et >= at(18);

const DAYS: Record<Kickoff['day'], string> = { thu: 'Thu', sat: 'Sat', sun: 'Sun', mon: 'Mon' };

/** "Sun 1:00 PM ET". */
export function kickoffLabel(k: Kickoff): string {
  const h = Math.floor(k.et / 60);
  const m = k.et % 60;
  return `${DAYS[k.day]} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} ET`;
}

/** Order within a week: Thursday first, then by day and time. */
export const kickoffOrder = (k: Kickoff | undefined) =>
  k ? ['thu', 'sat', 'sun', 'mon'].indexOf(k.day) * 1440 + k.et : 1440 * 2 + at(13);

/** Hosts this many hours behind Eastern (Mountain and Pacific) never get the 1:00 window. */
export const western = (league: League, teamId: number) => (ZONES[league.teams[teamId].abbrev] ?? 0) <= -2;

/** How strongly the networks want a team before a down is played: last season's win share, or even without one. */
function draw(league: League, season: number): (teamId: number) => number {
  const records = league.history.find((h) => h.season === season - 1)?.records;
  return (id) => {
    const r = records?.[id];
    const n = r ? r.w + r.l + r.t : 0;
    return r && n ? (r.w + 0.5 * r.t) / n : 0.5;
  };
}

/**
 * Kickoffs for a season's regular-season games, week by week (it sets `kickoff` on each). Week 1's
 * Thursday game is the champion's home opener when it has one; week 18 has only a Sunday night game.
 */
export function assignKickoffs(league: League, games: Game[], season: number): void {
  const rng = new Rng(`${league.seed}:${season}:kickoffs`);
  const appeal = draw(league, season);
  const champion = league.history.find((h) => h.season === season - 1)?.championId;
  const prime = new Map<number, number>();
  let monday = new Set<number>();
  const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const open = games.filter((g) => g.week === week);
    const pick = (ok: (g: Game) => boolean): Game | undefined => {
      const pool = open.filter((g) => !g.kickoff && ok(g));
      if (!pool.length) return undefined;
      // Better teams draw the lights; a team already in prime time a few times draws them less.
      const weight = (g: Game) =>
        (0.4 + appeal(g.homeId) + appeal(g.awayId)) * 0.6 ** ((prime.get(g.homeId) ?? 0) + (prime.get(g.awayId) ?? 0));
      return rng.weighted(pool, weight);
    };
    const light = (g: Game | undefined, k: Kickoff) => {
      if (!g) return;
      g.kickoff = k;
      for (const id of [g.homeId, g.awayId]) prime.set(id, (prime.get(id) ?? 0) + 1);
    };
    const last = week === weeks[weeks.length - 1];
    if (!last) {
      const opener = week === weeks[0] && champion !== undefined ? open.find((g) => g.homeId === champion) : undefined;
      // A short week after a Monday night game is no week at all.
      light(opener ?? pick((g) => !monday.has(g.homeId) && !monday.has(g.awayId)), THURSDAY);
      light(
        pick(() => true),
        MONDAY,
      );
    }
    light(
      pick(() => true),
      SUNDAY_NIGHT,
    );
    monday = new Set(open.filter((g) => g.kickoff === MONDAY).flatMap((g) => [g.homeId, g.awayId]));
    // Sunday afternoon: western hosts play late, and enough others join them to fill the window.
    const day = rng.shuffle(open.filter((g) => !g.kickoff));
    const late = [
      ...day.filter((g) => western(league, g.homeId)),
      ...day.filter((g) => !western(league, g.homeId)),
    ].slice(0, Math.max(LATE_GAMES, day.filter((g) => western(league, g.homeId)).length));
    late.forEach((g, i) => (g.kickoff = LATE[i % LATE.length]));
    for (const g of day) g.kickoff ??= EARLY;
  }
  // Copies, so no two games share a kickoff object in the saved league.
  for (const g of games) if (g.kickoff) g.kickoff = { ...g.kickoff };
}

/** Kickoffs for one playoff round's games: the round's windows in a seeded order, a western host never at 1:00. */
export function assignPlayoffKickoffs(league: League, games: Game[], round: PlayoffRound): void {
  const windows = new Rng(`${league.seed}:${league.season}:${round}:kickoffs`).shuffle([...PLAYOFF_WINDOWS[round]]);
  const early = windows.findIndex((k) => k.et < at(15));
  games.forEach((g, i) => {
    if (i === early && western(league, g.homeId)) {
      const swap = games.findIndex((o, j) => j !== i && !western(league, o.homeId));
      if (swap >= 0) [windows[i], windows[swap]] = [windows[swap], windows[i]];
    }
  });
  games.forEach((g, i) => (g.kickoff = { ...windows[i % windows.length] }));
}
