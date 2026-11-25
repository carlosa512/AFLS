/**
 * The editor of SNN's stories about players in trouble and players doing good (spec
 * `docs/superpowers/specs/2026-11-23-discipline-design.md`, "SNN: players in trouble and players doing good"): what
 * the public may read of a man's conduct (`publicConduct` reads only what went public: an ejection, a league ruling, a
 * public spat, a skipped team event, a team sitting a man) and a few good deeds, rolled from character. Mail-side only:
 * public facts, nothing drawn, nothing in the sim reads it. Its words are `snnConductVoice.ts`.
 */
import { gamesInWeek } from './league';
import { YEAR } from './morale';
import { characterZ, trueCharacter } from './personality';
import { moraleContext } from './morale';
import { unitOf, unitRead } from './standing';
import { draftedHigh, publicRecord } from './publicStanding';
import { hashUnits } from './rng';
import { suspended, teamPlayers } from './roster';
import type { Candidate } from './snnWeek';
import type { ConductEntry, League } from './types';

/** What a conduct story is about. The stories that are a team's rules, a spat or a good deed never lead the page. */
export type ConductAngle =
  | 'ejectFight'
  | 'ejectTwo'
  | 'ejectFlagrant'
  | 'fine'
  | 'ban'
  | 'banFight'
  | 'sat'
  | 'spat'
  | 'teamEvent'
  | 'goodCommunity'
  | 'goodFamily'
  | 'goodTeammate';

export const GOOD_ANGLES: readonly ConductAngle[] = ['goodCommunity', 'goodFamily', 'goodTeammate'];
/** Tiles, never the lead: a team's own business, a spat, and the good side. */
export const NO_LEAD: ReadonlySet<string> = new Set(['sat', 'spat', 'teamEvent', ...GOOD_ANGLES]);

/** What a conduct story reads (`Candidate.conduct`): the man, what happened, and where in the games it happened. */
export interface ConductFacts {
  playerId: number;
  angle: ConductAngle;
  outcome?: ConductEntry['outcome'];
  /** Games of a suspension. */
  games?: number;
  /** The game week it belongs to (a morale step is `8 +` it). */
  week: number;
  gameId?: number;
  quarter?: number;
  /** His ejections this league year (this one counted), and his league suspensions in two years. */
  nth: number;
  bans: number;
  /** His other public troubles this league year, before this one. */
  again: number;
  /** The week of the edition that tells it (0 on a big day of the offseason): the record and the next game are read as of it. */
  asOf: number;
  /** A prior dangerous-foul fine and ban on his record (two league years), for what a line may say he had before. */
  prior: { fine: boolean; ban: boolean };
  /** A named man: a star by last season's record or a recent high pick. */
  star: boolean;
}

/** Good deeds a week league-wide, on average (not a cap), and how hard character tilts who. */
export const GOOD = { perWeek: 2, tilt: 1.2, stakes: 1.4, kinds: { community: 0.4, family: 0.3, teammate: 0.3 } };

/** The morale step the weeks' trouble is filed under, as `conduct.ts` writes it: `8 +` the game week. */
const REGULAR = 8;

type GoodKind = 'community' | 'family' | 'teammate';

/**
 * Who does good this week, as a pure function of the seed, the clock and a man's character (nothing drawn, nothing
 * stored): high leadership, loyalty, work ethic and temperament weigh most, and a week's chances add up to
 * `GOOD.perWeek` across the league.
 */
export function goodSideWeek(l: League, clock: number): { playerId: number; kind: GoodKind }[] {
  const pool = l.teams.flatMap((t) =>
    teamPlayers(l, t.id)
      .filter((p) => !p.retired && !suspended(p))
      .map((p) => {
        const z = characterZ(trueCharacter(p));
        const lean = (z.leads + z.loyalty + z.workEthic + z.temperament) / 4;
        return { p, lean, weight: Math.exp(GOOD.tilt * lean), leads: z.leads };
      }),
  );
  const total = pool.reduce((a, x) => a + x.weight, 0);
  const out: { playerId: number; kind: GoodKind }[] = [];
  for (const x of pool) {
    const u = hashUnits(`${l.seed}:${Math.floor(clock / YEAR)}:${clock}:good:${x.p.id}`);
    if (u[0] >= Math.min(0.5, (GOOD.perWeek * x.weight) / total)) continue;
    // A man the room follows is likelier to be the teammate everyone wants.
    const teammate = GOOD.kinds.teammate * (x.leads > 0.5 ? 2 : 0.5);
    const sum = GOOD.kinds.community + GOOD.kinds.family + teammate;
    const v = u[1] * sum;
    out.push({
      playerId: x.p.id,
      kind:
        v < GOOD.kinds.community ? 'community' : v < GOOD.kinds.community + GOOD.kinds.family ? 'family' : 'teammate',
    });
  }
  return out.sort((a, b) => a.playerId - b.playerId);
}

/**
 * A man's room is fit for a story about the teammate everyone wants: its read is not Split or Down. A room too small to
 * have a read passes.
 */
export function roomFine(
  l: League,
  p: { id: number; position: Parameters<typeof unitOf>[0]; teamId: number | null },
  ctx = moraleContext(l),
): boolean {
  if (p.teamId === null) return false;
  const word = unitRead(l, p.teamId, unitOf(p.position), ctx)?.word;
  return word !== 'Split' && word !== 'Down';
}

/**
 * The good deeds nobody has told yet: none for a man already told this league year (one a man a year), and no second
 * family moment ever. A teammate story the room's read would contradict is told as community work instead.
 */
export function freshGood(l: League, clock: number, have: Set<string>): { playerId: number; kind: GoodKind }[] {
  const told = [...have].filter((k) => k.startsWith('good:'));
  const ctx = moraleContext(l);
  return goodSideWeek(l, clock).flatMap((g) => {
    const p = l.players[g.playerId];
    const mine = told.filter((k) => k.split(':')[3] === String(p.id));
    if (mine.some((k) => k.split(':')[1] === String(l.season))) return [];
    if (g.kind === 'family' && mine.some((k) => k.endsWith(':family'))) return [];
    return [g.kind === 'teammate' && !roomFine(l, p, ctx) ? { ...g, kind: 'community' as const } : g];
  });
}

/** The clock a game week's good deeds are rolled at: its morale step in the league year. */
export const goodClock = (l: League, week: number) => l.season * YEAR + Math.min(YEAR - 1, REGULAR + week);

/** Which story an entry tells, or none (a private kind that stayed inside the team). */
function angleOf(e: ConductEntry, why: string | undefined): ConductAngle | null {
  if (e.kind === 'ejected')
    return why === 'fight' ? 'ejectFight' : why === 'flagrant' ? 'ejectFlagrant' : why ? 'ejectTwo' : null;
  if (e.kind === 'dangerousFouls')
    return e.outcome === 'suspended' ? 'ban' : e.outcome === 'leagueFine' ? 'fine' : null;
  if (e.kind === 'fight') return e.outcome === 'suspended' ? 'banFight' : null;
  if (e.kind === 'spat') return 'spat';
  if (e.kind === 'teamEvent') return 'teamEvent';
  return e.outcome === 'sat' ? 'sat' : null;
}

/**
 * The week's conduct stories: what the public record holds for the week just played or the week before (an edition
 * that found no room waits one more), and the week's good deeds. Nothing already told (`have`). `pct` ranks a team's
 * stories by how it is doing.
 */
export function conductCandidates(
  l: League,
  week: number,
  have: Set<string>,
  pct: (teamId: number) => number = () => 0.5,
): Candidate[] {
  const out: Candidate[] = [];
  const rec = publicRecord(l);
  const named = (id: number) => {
    const p = l.players[id];
    return !!p && (rec.why(p) !== null || draftedHigh(l, p));
  };
  for (const row of Object.values(l.players)) {
    const entries = row.discipline?.entries ?? [];
    entries.forEach((e, i) => {
      const gw = e.week - REGULAR;
      // Step 8 (gw 0) is the last offseason step: no game week, told with the offseason's rulings.
      if (!e.public || e.season !== l.season || gw < 1 || gw < week - 1 || gw > week) return;
      const club = e.teamId ?? row.teamId;
      if (club === null || club === undefined) return;
      const game = gamesInWeek(l, gw).find((g) => g.result && (g.homeId === club || g.awayId === club));
      const ej = game?.result?.ejections?.find((x) => x.playerId === row.id);
      const angle = angleOf(e, ej?.why);
      if (!angle) return;
      // An ejection and a pattern of fouls are about a game: no game, no story.
      if ((e.kind === 'ejected' || e.kind === 'dangerousFouls') && !game) return;
      // The public entries before this one: a spat after a skipped event is not his first.
      const before = entries.slice(0, i).filter((x) => x.public && x.season === l.season);
      const key = `conduct:${l.season}:${row.id}:${e.week}:${e.kind}`;
      if (have.has(key)) return;
      const star = named(row.id);
      const suspendedOutcome = e.outcome === 'suspended';
      out.push({
        key,
        kind: 'conduct',
        angle,
        // A ruling that takes a man off the field is news; a fine or a team's own business fills a tile.
        tier: NO_LEAD.has(angle) ? 5 : suspendedOutcome ? (star ? 3 : 4) : star ? 4 : 5,
        clubId: club,
        teams: [club],
        stakes: pct(club) + (star ? 0.3 : 0),
        conduct: {
          playerId: row.id,
          angle,
          outcome: e.outcome,
          ...(e.games !== undefined ? { games: e.games } : {}),
          week: gw,
          asOf: week,
          prior: {
            fine: entries.slice(0, i).some((x) => x.kind === 'dangerousFouls' && x.outcome === 'leagueFine'),
            ban: entries.slice(0, i).some((x) => x.kind === 'dangerousFouls' && x.outcome === 'suspended'),
          },
          ...(game ? { gameId: game.id } : {}),
          ...(ej ? { quarter: ej.quarter } : {}),
          nth: entries.filter((x) => x.kind === 'ejected' && x.season === l.season).indexOf(e) + 1,
          bans: entries.filter((x) => x.outcome === 'suspended' && x.season >= l.season - 1 && entries.indexOf(x) <= i)
            .length,
          again: before.length,
          star,
        },
      });
    });
  }
  // The good side: a tile on any week, in the regular season.
  // Rolled from today's rosters, so only for the week just played: a past week is never re-rolled.
  const latest = Math.max(0, ...l.games.filter((g) => g.season === l.season && g.result).map((g) => g.week));
  if (week <= 18 && week === latest)
    for (const g of freshGood(l, goodClock(l, week), have)) {
      const p = l.players[g.playerId];
      const key = `good:${l.season}:${week}:${p.id}:${g.kind}`;
      if (have.has(key) || p.teamId === null) continue;
      const angle = g.kind === 'community' ? 'goodCommunity' : g.kind === 'family' ? 'goodFamily' : 'goodTeammate';
      out.push({
        key,
        kind: 'conduct',
        angle,
        tier: 5,
        clubId: p.teamId,
        teams: [p.teamId],
        // Among the tier's tiles a good deed ranks with a close game's: a quiet week has room for one.
        stakes: GOOD.stakes + pct(p.teamId),
        conduct: {
          playerId: p.id,
          angle,
          week,
          asOf: week,
          prior: { fine: false, ban: false },
          nth: 0,
          bans: 0,
          again: 0,
          star: named(p.id),
        },
      });
    }
  return out;
}

/**
 * A league suspension handed down in the offseason (a fight off the field, ruled at one of the offseason's
 * steps) is a big-day story: served from week 1, so it is told on the first day's edition built after it was ruled.
 * `step` is the morale step it was filed under (the re-sign window 0, free-agency days 1–5, the draft 6, camp 7).
 */
export function offseasonBans(
  l: League,
): { playerId: number; clubId: number; games: number; step: number; star: boolean }[] {
  const rec = publicRecord(l);
  const out: ReturnType<typeof offseasonBans> = [];
  for (const p of Object.values(l.players))
    for (const e of p.discipline?.entries ?? [])
      if (e.public && e.season === l.season && e.week <= REGULAR && e.outcome === 'suspended' && !p.retired) {
        const clubId = e.teamId ?? p.teamId;
        if (clubId === null || clubId === undefined) continue;
        out.push({
          playerId: p.id,
          clubId,
          games: e.games ?? 1,
          step: e.week,
          star: rec.why(p) !== null || draftedHigh(l, p),
        });
      }
  return out.sort((a, b) => a.step - b.step || a.playerId - b.playerId);
}
