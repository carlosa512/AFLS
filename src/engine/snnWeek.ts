/**
 * The editor of SNN's weekly edition, in the shape of the head coach's weekly letter (`coachWeek.ts`): gather the week's
 * candidates from the league's public record, rank them in five tiers, cut them to the edition's slots, then word each
 * (`snnVoice.ts`). Mail-side only: nothing in the sim reads this, and it draws from no stream (ties break on a stable
 * hash). Spec: docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md §2.
 */
import { weeklyAwards } from './awards';
import { gamesInWeek } from './league';
import { CUT, gameFacts, recordPct, recordsBefore, type ClubRecord, type GameAngle, type GameFacts } from './snnStory';
import type { EditionKind, Game, League, StatLine } from './types';
import { stableHash } from './voice';

/** Something the week made that an edition could tell. */
export interface Candidate {
  /** What it is about, kept in the edition's `covered` so it is told once. */
  key: string;
  kind: EditionKind;
  /** The one thing it says: a game's angle, 'streak', 'faded', 'starOut', 'bye'… */
  angle: string;
  tier: 1 | 2 | 3 | 4 | 5;
  /** The club the angle is about. An edition runs one story a club. */
  clubId: number;
  /** Every club in it (both sides of a game). */
  teams: number[];
  /** Ranks candidates inside a tier: the clubs' winning percentages, and a little for a division game. */
  stakes: number;
  game?: GameFacts;
  run?: { teamId: number; length: number; startWeek: number; faded?: true };
  out?: { playerId: number; gameId: number };
}

/** A game's tier by its angle (spec §2). */
const GAME_TIER: Record<GameAngle, Candidate['tier']> = {
  unbeatenFalls: 2,
  winlessWins: 2,
  upset: 3,
  tie: 3,
  streakEnds: 3,
  comeback: 4,
  yardage: 4,
  day: 4,
  qbLost: 4,
  rout: 5,
  overtime: 5,
  result: 5,
};

/** The club a game's angle is about: whose run ended, who had the day, who lost his quarterback, else the winner. */
function clubOf(g: Game, f: GameFacts): number {
  if ((f.angle === 'unbeatenFalls' || f.angle === 'streakEnds') && f.streak) return f.streak.teamId;
  if (f.angle === 'day' && f.day) return f.day.teamId;
  if (f.angle === 'qbLost' && f.qbLost) return f.qbLost.teamId;
  return f.winnerId ?? g.homeId;
}

const played = (l: League, week: number) => gamesInWeek(l, week).filter((g) => g.season === l.season && g.result);

/** How much a game mattered: both clubs' records going in, and a division game a little more. */
function stakesOf(l: League, g: Game, before: Map<number, ClubRecord>): number {
  const pct = (id: number) => recordPct(before.get(id) ?? { w: 0, l: 0, t: 0, streak: 0 });
  const division = l.teams[g.homeId]?.division === l.teams[g.awayId]?.division;
  return pct(g.homeId) + pct(g.awayId) + (division && !g.playoffRound ? 0.25 : 0);
}

/** One candidate for each game of the week, with its angle. */
export function gameCandidates(l: League, week: number): Candidate[] {
  const before = recordsBefore(l, week);
  return played(l, week).map((g) => {
    const game = gameFacts(l, g, before);
    return {
      key: `game:${g.id}`,
      kind: 'game' as const,
      angle: game.angle,
      tier: GAME_TIER[game.angle],
      clubId: clubOf(g, game),
      teams: [g.homeId, g.awayId],
      stakes: stakesOf(l, g, before),
      game,
    };
  });
}

/** The user's club on a week it does not play: its slot says where it stands and who is next. */
export function byeCandidate(l: League, week: number, userTeamId: number): Candidate | null {
  if (week > 18) return null;
  const plays = l.games.some(
    (g) => g.season === l.season && g.week === week && (g.homeId === userTeamId || g.awayId === userTeamId),
  );
  if (plays) return null;
  return {
    key: `bye:${userTeamId}:${week}`,
    kind: 'game',
    angle: 'bye',
    tier: 5,
    clubId: userTeamId,
    teams: [userTeamId],
    stakes: 0,
  };
}

/** This season's results for one club up to and including `week`, oldest first: W, L or T, and the week. */
function formOf(l: League, teamId: number, week: number): { week: number; r: 'W' | 'L' | 'T' }[] {
  return l.games
    .filter((g) => g.season === l.season && !g.playoffRound && g.result && g.week <= week)
    .filter((g) => g.homeId === teamId || g.awayId === teamId)
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const [us, them] =
        g.homeId === teamId ? [g.result!.homeScore, g.result!.awayScore] : [g.result!.awayScore, g.result!.homeScore];
      return { week: g.week, r: us > them ? ('W' as const) : us < them ? ('L' as const) : ('T' as const) };
    });
}

/**
 * A club's run, told once: the week a winning or losing streak reaches six, and the week a club that started 5–0 or
 * better has lost two of its last three.
 */
export function runCandidates(l: League, week: number): Candidate[] {
  if (week > 18) return [];
  const after = recordsBefore(l, week + 1);
  const out: Candidate[] = [];
  for (const g of played(l, week))
    for (const teamId of [g.homeId, g.awayId]) {
      const form = formOf(l, teamId, week);
      const rec = after.get(teamId)!;
      const stakes = recordPct(rec);
      if (Math.abs(rec.streak) === CUT.streak) {
        const startWeek = form[form.length - CUT.streak].week;
        out.push({
          key: `run:${teamId}:${l.season}:${startWeek}`,
          kind: 'run',
          angle: 'streak',
          tier: 5,
          clubId: teamId,
          teams: [teamId],
          stakes,
          run: { teamId, length: rec.streak, startWeek },
        });
        continue;
      }
      // Started 5–0 or better, and this week's loss makes it two defeats in three.
      const firstLoss = form.findIndex((x) => x.r !== 'W');
      const last3 = form.slice(-3);
      const fadedNow = (xs: typeof form) => xs.length === 3 && xs.filter((x) => x.r === 'L').length >= 2;
      if (
        firstLoss >= CUT.runGames &&
        form.at(-1)!.r === 'L' &&
        fadedNow(last3) &&
        // Not already true a week ago: it is told the week it becomes true.
        !fadedNow(form.slice(-4, -1))
      )
        out.push({
          key: `run:${teamId}:${l.season}:faded`,
          kind: 'run',
          angle: 'faded',
          tier: 5,
          clubId: teamId,
          teams: [teamId],
          stakes,
          run: { teamId, length: firstLoss, startWeek: form[0].week, faded: true },
        });
    }
  return out;
}

/** This season's totals from the box scores through `week`: what the public knows a man has done. */
function seasonLines(l: League, week: number): Map<number, { line: Record<string, number>; teamId: number }> {
  const out = new Map<number, { line: Record<string, number>; teamId: number }>();
  for (const g of l.games) {
    if (g.season !== l.season || g.playoffRound || !g.result || g.week > week) continue;
    for (const [id, s] of Object.entries(g.result.playerStats) as [string, StatLine][]) {
      const row = out.get(Number(id)) ?? { line: {}, teamId: g.result.playerTeams[Number(id)] };
      for (const k of ['passAtt', 'passYds', 'rushYds', 'recYds', 'sacks', 'defInt'] as const)
        row.line[k] = (row.line[k] ?? 0) + (s[k] ?? 0);
      row.teamId = g.result.playerTeams[Number(id)];
      out.set(Number(id), row);
    }
  }
  return out;
}

/** The marks that make a man a star in public: a place in the league's top five in one of these. */
const STAR_STATS = ['passYds', 'rushYds', 'recYds', 'sacks', 'defInt'] as const;

/**
 * A star lost for the season in this week's games. A star is judged from public production only: a weekly award this
 * season, a top-five place in the league in a major stat, or his club's quarterback (its most pass attempts).
 */
export function starOutCandidates(l: League, week: number): Candidate[] {
  const left = 18 - week;
  if (left <= 0) return [];
  const hurt = played(l, week).flatMap((g) =>
    (g.result!.injuries ?? [])
      // Out for what is left of the season, and a real layoff: late in the year every knock would count.
      .filter((i) => i.estimate[0] >= Math.max(left, 4))
      .map((i) => ({ ...i, gameId: g.id })),
  );
  if (!hurt.length) return [];
  const lines = seasonLines(l, week);
  const top = new Set<number>();
  for (const k of STAR_STATS)
    [...lines]
      .filter(([, x]) => (x.line[k] ?? 0) > 0)
      .sort((a, b) => b[1].line[k] - a[1].line[k] || a[0] - b[0])
      .slice(0, 5)
      .forEach(([id]) => top.add(id));
  const honored = new Set(
    Object.values(weeklyAwards(l, l.season)?.weeks ?? {})
      .flat()
      .flatMap((w) => (w ? [w.playerId] : [])),
  );
  const passer = new Map<number, { id: number; att: number }>();
  for (const [id, x] of lines) {
    const att = x.line.passAtt ?? 0;
    if (att > (passer.get(x.teamId)?.att ?? 0)) passer.set(x.teamId, { id, att });
  }
  const after = recordsBefore(l, week + 1);
  return hurt
    .filter((i) => top.has(i.playerId) || honored.has(i.playerId) || passer.get(i.teamId)?.id === i.playerId)
    .map((i) => ({
      key: `starOut:${i.playerId}:${week}`,
      kind: 'starOut' as const,
      angle: 'starOut',
      tier: 3 as const,
      clubId: i.teamId,
      teams: [i.teamId],
      stakes: recordPct(after.get(i.teamId) ?? { w: 0, l: 0, t: 0, streak: 0 }),
      out: { playerId: i.playerId, gameId: i.gameId },
    }));
}

/** Top tier first, then the higher stakes, then a hash of the edition and the story: the same league, the same order. */
export function rankCandidates(cs: Candidate[], editionId: string): Candidate[] {
  return [...cs].sort(
    (a, b) =>
      a.tier - b.tier ||
      b.stakes - a.stakes ||
      stableHash(`${editionId}:${a.key}`) - stableHash(`${editionId}:${b.key}`) ||
      (a.key < b.key ? -1 : 1),
  );
}

/** Tiles in an edition: three, and a fourth when the reader's own game leads (it has no slot of its own then). */
const TILES = 3;

/**
 * The edition's slots from the ranked week. The reader's game is his club's story unless it is the week's biggest, when
 * it leads. One story a club; one trade tile unless a second is the top tier. What is cut is dropped, not listed.
 */
export function cutEdition(
  ranked: Candidate[],
  userTeamId: number | null,
): { lead: Candidate; leadYours: boolean; club?: Candidate; clubExtra?: Candidate; tiles: Candidate[] } | null {
  if (!ranked.length) return null;
  const mine = (x: Candidate) => userTeamId !== null && x.kind === 'game' && x.teams.includes(userTeamId);
  const own = ranked.find(mine);
  const leadYours = !!own && ranked[0] === own;
  const lead = leadYours ? own! : ranked.find((x) => !mine(x) && x.clubId !== userTeamId);
  if (!lead) {
    // Only the reader's own club made news (a bye week's lone candidate, a one-game round): it leads.
    return { lead: ranked[0], leadYours: userTeamId !== null, tiles: [] };
  }
  const club = leadYours ? undefined : own;
  // The biggest other public thing about the reader's club rides in its story, never in a tile of its own.
  const clubExtra =
    userTeamId === null ? undefined : ranked.find((x) => x !== own && x !== lead && x.clubId === userTeamId);
  const used = new Set<number>([lead.clubId]);
  if (userTeamId !== null) used.add(userTeamId);
  // The limit is on tiles: a trade that leads does not use it up.
  let trades = 0;
  const tiles: Candidate[] = [];
  for (const x of ranked) {
    if (tiles.length >= TILES + (leadYours ? 1 : 0)) break;
    if (x === lead || x === club || mine(x) || used.has(x.clubId)) continue;
    if (x.kind === 'trade' && trades >= 1 && x.tier !== 1) continue;
    if (x.kind === 'trade') trades++;
    used.add(x.clubId);
    tiles.push(x);
  }
  return { lead, leadYours, club, clubExtra, tiles };
}
