/**
 * The editor of SNN's weekly edition, in the shape of the head coach's weekly letter (`coachWeek.ts`): gather the week's
 * candidates from the league's public record, rank them in five tiers, cut them to the edition's slots, then word each
 * (`snnVoice.ts`). Mail-side only: nothing in the sim reads this, and it draws from no stream (ties break on a stable
 * hash). Spec: docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md §2.
 */
import { weeklyAwards } from './awards';
import { gamesInWeek } from './league';
import { mentorFacts, speakFacts } from './lockerMail';
import { snnRumor } from './meetings/mail';
import { divisionLeadChange } from './news';
import type { SpeakEvent } from './relationships';
import { reportableRumors, reportableTrades, type ReportableTrade } from './tradeNews';
import { isDeadlineDay, TRADE_DEADLINE_WEEK } from './trade/rules';
import { gameOfWeek } from './season/gameOfWeek';
import { computeRecords, divisionStandings } from './season/standings';
import { CUT, gameFacts, recordPct, recordsBefore, type ClubRecord, type GameAngle, type GameFacts } from './snnStory';
import { employed } from './employment';
import { columnClaims, pickColumn, type Claim } from './snnColumn';
import { columnStory, writeStory } from './snnVoice';
import type { Draft } from './senders';
import { SNN_OUTLET } from './stories';
import { titleEdition } from './snnTitle';
import type { BeatKind, Edition, EditionKind, EditionScore, Game, League, StatLine } from './types';
import { seasonSaid, stableHash, toldKeys } from './voice';

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
  /** The ids today's separate mails file the same news under, so an edition is not a second telling of one. */
  covers?: string[];
  division?: { leaderId: number; formerId: number; week: number };
  trade?: ReportableTrade & { week: number; earlierSales: number };
  rumor?: { playerId: number; clubId: number; text: string; shopping: boolean; askerId?: number; week: number };
  /** A head coach, a GM or a coordinator out: who went, and who steps in when someone is named. */
  leader?: { teamId: number; role: 'headCoach' | 'gm' | 'coordinator'; out: string; in?: string; side?: string };
  speak?: { playerId: number; teamId: number; kind: SpeakEvent };
  room?: { teamId: number; coachId: number; text: string };
  mentor?: { mentorId: number; discipleId: number; homeId: number; awayId: number };
  /** One of the reader's club's public storylines: the beat it tells, and the story's men. */
  storyline?: {
    beat: BeatKind;
    how?: string;
    playerId?: number;
    other?: number;
    /** Steps since the story's first public beat (weeks, in season). */
    since: number;
    /** The beat is this step's: its game is this week's. */
    now: boolean;
    coach?: { name: string; side: string };
  };
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

/** A leadership event's in-season mail ids: its own, or a roundup whose range holds it. */
const leadershipTold = (have: Set<string>, season: number, week: number, id: number) =>
  have.has(`leadership:${season}:${id}`) ||
  [...have].some((x) => {
    const [kind, s, w, range] = x.split(':');
    if (kind !== 'leadership-week' || Number(s) !== season || Number(w) !== week) return false;
    if (!range) return true;
    const [from, to] = range.split('-').map(Number);
    return id >= from && id <= to;
  });

/**
 * The week's other public news: a division lead changing hands, trades and rumors (by the rules that decide today's
 * trade news), a head coach, GM or coordinator out at another club, and the three items SNN files on its own today.
 * Nothing already told, under its own key or the id of the mail it replaces.
 */
export function newsCandidates(l: League, week: number, have: Set<string>): Candidate[] {
  if (week > 18) return [];
  const out: Candidate[] = [];
  const after = recordsBefore(l, week + 1);
  const pct = (id: number) => recordPct(after.get(id) ?? { w: 0, l: 0, t: 0, streak: 0 });
  const fresh = (c: Candidate) => !have.has(c.key) && !(c.covers ?? []).some((id) => have.has(id));
  const has = (suffix: string) => [...have].some((id) => id.endsWith(suffix));

  const lead = divisionLeadChange(l, week);
  if (lead)
    out.push({
      key: `division:${l.season}:${week}:${lead.leaderId}`,
      covers: [`press:${l.season}:${week}:division:${lead.leaderId}`],
      kind: 'division',
      angle: 'leadChange',
      tier: 2,
      clubId: lead.leaderId,
      teams: [lead.leaderId, lead.formerId],
      stakes: pct(lead.leaderId) + pct(lead.formerId),
      division: { leaderId: lead.leaderId, formerId: lead.formerId, week },
    });

  if (week <= TRADE_DEADLINE_WEEK) {
    // On deadline day (the last trading week is played) the day's own deals are dated the week to come: they are
    // this edition's news too, and SNN files one mail at that step, not an edition and a deadline story.
    const lastWeek = week === TRADE_DEADLINE_WEEK && isDeadlineDay(l) ? week + 1 : week;
    for (const t of reportableTrades(l, week, lastWeek)) {
      if (has(`trade:${t.key}`)) continue;
      // A club that has already sent a player away this season for nothing but picks is selling again.
      const earlierSales = (l.market?.history ?? []).filter(
        (r) =>
          r !== t.deal &&
          r.season === l.season &&
          r.phase === 'regular' &&
          (r.week < t.deal.week ||
            (r.week === t.deal.week &&
              r !== t.deal &&
              (l.market?.history ?? []).indexOf(r) < (l.market?.history ?? []).indexOf(t.deal))) &&
          r.sides.some((s) => s.teamId === t.sellerId && s.players.length > 0) &&
          r.sides.some((s) => s.teamId !== t.sellerId && s.players.length === 0),
      ).length;
      const angle =
        earlierSales && !t.swap ? 'secondSale' : t.swap ? 'swap' : pct(t.buyerId) >= 0.6 ? 'contender' : 'sale';
      out.push({
        key: `trade:${t.key}`,
        kind: 'trade',
        angle,
        // A star deal leads. A first-round pick changing hands is real news. Any other deal worth reporting ranks with
        // a good game story: at the bottom tier it never reached a tile.
        tier: t.star ? 1 : t.pick?.round === 1 ? 3 : 4,
        clubId: angle === 'secondSale' || angle === 'sale' ? t.sellerId : t.buyerId,
        teams: [t.buyerId, t.sellerId],
        stakes: pct(t.buyerId) + pct(t.sellerId),
        trade: { ...t, week, earlierSales },
      });
    }
    const rumor = reportableRumors(l, week, week)[0];
    if (rumor && !has(`rumor:${rumor.key}`))
      out.push({
        key: `rumor:${rumor.key}`,
        kind: 'rumor',
        angle: rumor.shopping ? 'shopping' : 'interest',
        tier: 5,
        clubId: rumor.clubId,
        teams: [rumor.clubId, ...(rumor.askerId === undefined ? [] : [rumor.askerId])],
        stakes: pct(rumor.clubId),
        rumor: { ...rumor, week },
      });
  }

  // A head coach, a GM or a coordinator out at another club, one story a club. Any change of the season not yet told
  // is a candidate (an owner acts after the week's games, so his move is dated the week to come): one from a week the
  // reader skipped, or one an earlier edition had no room for, still reaches him.
  const events = l.leadership.events.filter(
    (e) =>
      e.date.season === l.season &&
      e.date.phase === 'regular' &&
      e.date.week <= week + 1 &&
      e.teamId !== l.userTeamId &&
      ['coachInterim', 'gmDismissed', 'gmHired', 'coachRelieved'].includes(e.kind) &&
      !leadershipTold(have, e.date.season, e.date.week, e.id),
  );
  for (const teamId of new Set(events.map((e) => e.teamId))) {
    const mine = events.filter((e) => e.teamId === teamId);
    const coach = mine.find((e) => e.kind === 'coachInterim');
    const gm = mine.find((e) => e.kind === 'gmDismissed');
    const relieved = mine.find((e) => e.kind === 'coachRelieved');
    const nameOf = (x?: { firstName: string; lastName: string }) => (x ? `${x.firstName} ${x.lastName}` : '');
    let leader: Candidate['leader'];
    // The story tells one change, and marks only that one told: a club that lets its head coach and its GM go in one
    // week gets the coach's story now and the GM's in the next edition.
    let about: typeof mine = [];
    if (coach) {
      // The event names the interim; the man he replaces is in its public line.
      const gone = /dismissed (.+?) and named/.exec(coach.report)?.[1] ?? '';
      leader = { teamId, role: 'headCoach', out: gone, in: nameOf(l.coaches[coach.coachId!]) };
      about = mine.filter((e) => e.kind === 'coachInterim');
    } else if (gm) {
      const next = mine.find((e) => e.kind === 'gmHired');
      leader = { teamId, role: 'gm', out: nameOf(l.gms[gm.gmId!]), in: next ? nameOf(l.gms[next.gmId!]) : undefined };
      about = mine.filter((e) => e.kind === 'gmDismissed' || e.kind === 'gmHired');
    } else if (relieved) {
      const c = l.coaches[relieved.coachId!] ?? l.retiredCoaches?.[relieved.coachId!];
      const side = c?.role === 'offCoord' ? 'offensive' : c?.role === 'defCoord' ? 'defensive' : 'special teams';
      leader = { teamId, role: 'coordinator', out: nameOf(c), side };
      about = mine.filter((e) => e.kind === 'coachRelieved');
    }
    if (!leader?.out) continue;
    // News from an earlier week no longer leads the page: it runs among the week's other stories.
    const old = about.every((e) => e.date.week < week);
    out.push({
      key: `leaderOut:${l.season}:${Math.min(...about.map((e) => e.id))}`,
      covers: about.map((e) => `leadership:${e.date.season}:${e.id}`),
      kind: 'leaderOut',
      angle: leader.role === 'coordinator' ? 'coordinatorOut' : leader.role === 'gm' ? 'gmOut' : 'coachOut',
      tier: leader.role === 'coordinator' || old ? 4 : 1,
      clubId: teamId,
      teams: [teamId],
      stakes: pct(teamId),
      leader,
    });
  }

  for (const f of speakFacts(l, have))
    out.push({
      key: f.id,
      kind: 'speak',
      angle: f.kind,
      tier: 4,
      clubId: f.teamId,
      teams: [f.teamId],
      stakes: pct(f.teamId),
      speak: { playerId: f.playerId, teamId: f.teamId, kind: f.kind },
    });
  const room = snnRumor(l, have);
  if (room)
    out.push({
      key: room.key,
      kind: 'room',
      angle: 'room',
      tier: 4,
      clubId: room.teamId,
      teams: [room.teamId],
      stakes: pct(room.teamId),
      room: { teamId: room.teamId, coachId: room.coachId, text: room.text },
    });
  for (const m of mentorFacts(l, week + 1, have))
    out.push({
      key: m.id,
      kind: 'mentor',
      angle: 'mentor',
      tier: 5,
      clubId: m.homeId,
      teams: [m.homeId, m.awayId],
      stakes: pct(m.homeId) + pct(m.awayId),
      mentor: { mentorId: m.mentorId, discipleId: m.discipleId, homeId: m.homeId, awayId: m.awayId },
    });
  return out.filter(fresh);
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

/** How many stories of one angle an edition runs among its lead and tiles. */
const SAME_ANGLE = 2;
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
  // The reader's own game leads only when it is real news (the top three tiers): a plain week's order is a coin toss,
  // and his game has its own slot anyway.
  const leadYours = !!own && ranked[0] === own && own.tier <= 3;
  const lead = leadYours ? own! : ranked.find((x) => !mine(x) && x.clubId !== userTeamId);
  if (!lead) {
    // Only the reader's own club made news (a bye week's lone candidate, a one-game round): it leads.
    return { lead: ranked[0], leadYours: userTeamId !== null, tiles: [] };
  }
  const club = leadYours ? undefined : own;
  // A star of the reader's club lost in its game rides in that game's story, never in a tile of its own.
  const clubExtra =
    userTeamId === null ? undefined : ranked.find((x) => x.clubId === userTeamId && x.kind === 'starOut');
  const used = new Set<number>([lead.clubId]);
  // The biggest other news about the reader's club (first place taken, a man speaking out, a run) has a tile by right:
  // his game's story cannot carry it, and nobody else will tell it. One a week, so the page stays the league's.
  const ownNews =
    userTeamId === null
      ? undefined
      : ranked.find((x) => x.clubId === userTeamId && x !== lead && x !== club && x !== clubExtra && !mine(x));
  // The limit is on tiles: a trade that leads does not use it up.
  let trades = ownNews?.kind === 'trade' ? 1 : 0;
  const picked: Candidate[] = ownNews ? [ownNews] : [];
  // Variety: an edition tells one angle twice at most among its lead and tiles (three "scores three" stories read as
  // one story three times).
  const told = new Map<string, number>([[lead.angle, 1]]);
  if (ownNews) told.set(ownNews.angle, (told.get(ownNews.angle) ?? 0) + 1);
  for (const x of ranked) {
    if (picked.length >= TILES + (leadYours ? 1 : 0)) break;
    if (x === lead || x === club || mine(x) || x.clubId === userTeamId || used.has(x.clubId)) continue;
    if ((told.get(x.angle) ?? 0) >= SAME_ANGLE) continue;
    if (x.kind === 'trade' && trades >= 1 && x.tier !== 1) continue;
    if (x.kind === 'trade') trades++;
    used.add(x.clubId);
    told.set(x.angle, (told.get(x.angle) ?? 0) + 1);
    picked.push(x);
  }
  // In the order the week ranked them.
  const tiles = picked.sort((p, q) => ranked.indexOf(p) - ranked.indexOf(q));
  return { lead, leadYours, club, clubExtra, tiles };
}

export const SNN = 'SNN — Sports News Network';
const ROUNDS: Record<string, string> = {
  WC: 'Wild Card',
  DIV: 'Divisional round',
  CONF: 'Conference finals',
  FINAL: 'The final',
};

/** The edition's id for a week: `snn:{season}:w{week}`, or `snn:{season}:p{round}` in the playoffs. */
export function editionId(l: League, week: number): string {
  const round = gamesInWeek(l, week).find((g) => g.season === l.season)?.playoffRound;
  return round ? `snn:${l.season}:p${round}` : `snn:${l.season}:w${week}`;
}

const recText = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
/** The league as it stood once `week` was played. */
const through = (l: League, week: number): League => ({
  ...l,
  games: l.games.filter((g) => g.season !== l.season || g.week <= week),
});

/** The reader's division after the week: each club's record, its result this week and who it plays next. */
function raceOf(l: League, week: number, userTeamId: number): Edition['race'] {
  const now = through(l, week);
  const table = divisionStandings(now, computeRecords(now))[l.teams[userTeamId].division];
  const game = (teamId: number, w: number) =>
    l.games.find((g) => g.season === l.season && g.week === w && (g.homeId === teamId || g.awayId === teamId));
  return {
    division: table.division.name,
    rows: table.teams.map((r) => {
      const g = game(r.teamId, week);
      const home = g?.homeId === r.teamId;
      const [us, them] = !g?.result
        ? [0, 0]
        : home
          ? [g.result.homeScore, g.result.awayScore]
          : [g.result.awayScore, g.result.homeScore];
      const n = week < 18 ? game(r.teamId, week + 1) : undefined;
      const opp = n ? l.teams[n.homeId === r.teamId ? n.awayId : n.homeId].abbrev : '';
      return {
        teamId: r.teamId,
        w: r.w,
        l: r.l,
        t: r.t,
        last: g?.result ? `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}–${them}` : 'bye',
        next: n ? `${n.homeId === r.teamId ? '' : 'at '}${opp}` : 'bye',
      };
    }),
  };
}

/** Public beats an edition prints, and the ways a public dispute can end that are worth a line. */
const TELLS: BeatKind[] = ['sat', 'backIn', 'settled', 'left', 'leaked', 'disputeEnd'];
const ENDINGS = ['traded', 'withdrawn', 'promise', 'signed', 'released'];
const SETTLED = ['earned', 'chart', 'earnedBack', 'chartBack'];

/**
 * The reader's club's public storylines as candidates (spec 2 §2): a man left off the lineup, a trade request that
 * leaked, and how each ended, from the story store's public beats (`SNN_OUTLET`); and a coordinator he relieved. One
 * candidate a story, for its latest public beat not yet printed; what an edition printed is kept in its `covered`
 * keys, so nothing is written to the store from here.
 */
export function storylineCandidates(l: League, week: number, have: Set<string>): Candidate[] {
  if (!employed(l)) return [];
  const user = l.userTeamId;
  const out: Candidate[] = [];
  const base = { kind: 'storyline' as const, clubId: user, teams: [user], stakes: 0 };
  for (const s of [...(l.stories?.open ?? []), ...(l.stories?.closed ?? [])]) {
    const pub = s.beats.filter((b) => SNN_OUTLET.sees(l, s, b) && TELLS.includes(b.kind));
    const keyOf = (b: (typeof pub)[number]) => `storyline:${s.id}:${b.at}:${b.kind}`;
    const fresh = pub.filter((b) => !have.has(keyOf(b)));
    const b = fresh.at(-1);
    const p = s.playerId === undefined ? undefined : l.players[s.playerId];
    if (!b || !p) continue;
    // An ending nobody outside could read (an injury settling it, a holdout drifting back) is not a story.
    if (b.kind === 'settled' && !SETTLED.includes(b.how ?? '')) continue;
    if (b.kind === 'disputeEnd' && !ENDINGS.includes(b.how ?? '')) continue;
    out.push({
      ...base,
      key: keyOf(b),
      covers: fresh.map(keyOf),
      angle: b.kind,
      // A quarterback losing his job is the biggest thing a club can do in season short of firing its coach.
      tier: p.position === 'QB' && b.kind === 'sat' ? 2 : 4,
      storyline: {
        beat: b.kind,
        ...(b.how !== undefined ? { how: b.how } : {}),
        playerId: p.id,
        ...(s.other !== undefined ? { other: s.other } : {}),
        since: b.at - (pub[0]?.at ?? b.at),
        now: b.at === l.moraleAt,
      },
    });
  }
  for (const e of l.leadership.events) {
    if (e.teamId !== user || e.kind !== 'coachRelieved' || e.date.season !== l.season || e.date.week > week + 1)
      continue;
    const key = `storyline:relieved:${e.id}`;
    const c = e.coachId === undefined ? undefined : (l.coaches[e.coachId] ?? l.retiredCoaches?.[e.coachId]);
    if (have.has(key) || !c) continue;
    const side = c.role === 'offCoord' ? 'offensive' : c.role === 'defCoord' ? 'defensive' : 'special teams';
    out.push({
      ...base,
      key,
      angle: 'relieved',
      tier: 4,
      storyline: { beat: 'relieved', since: 0, now: false, coach: { name: `${c.firstName} ${c.lastName}`, side } },
    });
  }
  return out;
}

/** This season's Columns that the inbox still holds, newest first: the week each ran, its claim and its club. */
function columnsRan(l: League): { week: number; key: string; clubId: number }[] {
  return (l.inbox ?? [])
    .filter((m) => m.edition && m.season === l.season && m.phase === 'regular')
    .flatMap((m) =>
      m.edition!.tiles.filter((s) => s.kind === 'column').map((s) => ({ week: m.week, key: s.key, clubId: s.clubId })),
    )
    .sort((a, b) => b.week - a.week);
}

/** The week's Column, or none (`pickColumn`): never about a club the page's other stories already cover. */
function weekColumn(
  l: League,
  week: number,
  editionId: string,
  user: number | null,
  have: Set<string>,
  cut: NonNullable<ReturnType<typeof cutEdition>>,
): Claim | null {
  const ran = columnsRan(l).filter((r) => r.week < week);
  const taken = new Set([cut.lead, ...cut.tiles].map((x) => x.clubId));
  if (cut.club && user !== null) taken.add(cut.club.clubId);
  const yours = ran.filter((r) => r.clubId === user);
  return pickColumn(columnClaims(l, week, have), {
    taken,
    userTeamId: user,
    yoursTold: yours.length,
    yoursLastWeek: yours.some((r) => r.week === week - 1),
    editionId,
    week,
    ran,
  });
}

/** The edition for a completed week, or null while a game of it is unplayed. */
export function buildEdition(l: League, week: number): Edition | null {
  const all = gamesInWeek(l, week).filter((g) => g.season === l.season);
  if (!all.length || all.some((g) => !g.result)) return null;
  const user = employed(l) ? l.userTeamId : null;
  const id = editionId(l, week);
  const bye = user === null ? null : byeCandidate(l, week, user);
  // What SNN has told already, under an edition's keys or the ids of the mails an edition replaces.
  const have = toldKeys(l);
  const told = (c: Candidate) => c.kind !== 'game' && (have.has(c.key) || !!c.covers?.some((x) => have.has(x)));
  const ranked = rankCandidates(
    [
      ...gameCandidates(l, week),
      ...runCandidates(l, week),
      ...starOutCandidates(l, week),
      ...newsCandidates(l, week, have),
      // Not in the playoffs: there is no race or page for them there, and the season's questions are closed.
      ...(week <= 18 ? storylineCandidates(l, week, have) : []),
      ...(bye ? [bye] : []),
    ].filter((c) => !told(c)),
    id,
  );
  const cut = cutEdition(ranked, user);
  if (!cut) return null;
  // Around everything SNN has said this league year, and everything this edition says as it goes.
  const at = { editionId: id, said: [...seasonSaid(l, SNN, 'snn:')] };
  const yours = user === null ? {} : { yours: user, extra: cut.clubExtra };
  const lead = writeStory(l, cut.lead, at, cut.leadYours ? yours : {});
  const club = cut.club ? writeStory(l, cut.club, at, yours) : undefined;
  const round = all[0].playoffRound;
  // The Column, in the regular season: chosen before the tiles are written, so the one it replaces says nothing.
  const column = round ? null : weekColumn(l, week, id, user, have, cut);
  const kept =
    column && cut.tiles.length >= TILES + (cut.leadYours ? 1 : 0)
      ? // The lowest-ranked tile makes way, never the reader's own club's news.
        cut.tiles.filter((x) => x !== [...cut.tiles].reverse().find((t) => user === null || t.clubId !== user))
      : cut.tiles;
  // A tile about the reader's own club stands beside his club's story: it says its news and stops.
  const tiles = kept.map((x) =>
    writeStory(l, x, at, { quote: false, ...(user !== null && x.clubId === user ? { brief: true as const } : {}) }),
  );
  if (column) tiles.push(columnStory(l, column, at));
  const scores: EditionScore[] = all.map((g) => ({
    gameId: g.id,
    homeId: g.homeId,
    awayId: g.awayId,
    home: g.result!.homeScore,
    away: g.result!.awayScore,
    ...(g.result!.overtime ? { overtime: true as const } : {}),
  }));
  const edition: Edition = {
    label: round ? (ROUNDS[round] ?? 'Playoffs') : `Week ${week}`,
    scores,
    lead,
    ...(club ? { club } : {}),
    tiles,
  };
  if (round === 'FINAL') {
    // The final's page: the lead told as a championship, the awards as a tile, and the season's lists.
    const title = titleEdition(l, all[0], lead, at.said);
    edition.lead = title.lead;
    edition.tiles = [...edition.tiles, ...title.tiles];
    if (title.lists.length) edition.lists = title.lists;
  }
  if (round) {
    // The round's results, and who meets next once the next round is drawn.
    const next = l.games.filter((g) => g.season === l.season && g.week === week + 1 && g.playoffRound && !g.result);
    edition.bracket = { results: scores, next: next.map((g) => ({ homeId: g.homeId, awayId: g.awayId })) };
  } else {
    if (user !== null) edition.race = raceOf(l, week, user);
    const records = computeRecords(through(l, week));
    const best = gameOfWeek(l, week + 1, records);
    if (best)
      edition.next = {
        gameId: best.id,
        homeId: best.homeId,
        awayId: best.awayId,
        home: recText(records.get(best.homeId)!),
        away: recText(records.get(best.awayId)!),
      };
  }
  return edition;
}

/** The longest a subject line runs. */
export const SUBJECT = 60;
/** A headline cut at a word, for the mail's subject. */
export const short = (text: string, max = 48) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).replace(/[,.]$/, '')}…`;
};

/**
 * SNN's edition for the latest completed week, as mail: filed at its moment only (a long advance gets one edition, not
 * a backlog), once. Its body holds every paragraph it printed, for search and so the next edition steps around them;
 * `covered` names what it told, under its own keys and the ids of the mails it replaces.
 */
export function editionMail(l: League): Draft[] {
  if (!['regular', 'playoffs', 'complete'].includes(l.phase)) return [];
  const played = l.games.filter((g) => g.season === l.season && g.result);
  const week = Math.max(0, ...played.map((g) => g.week));
  if (!week) return [];
  const id = editionId(l, week);
  if (toldKeys(l).has(id)) return [];
  const edition = buildEdition(l, week);
  if (!edition) return [];
  const stories = [edition.lead, ...(edition.club ? [edition.club] : []), ...edition.tiles];
  const round = gamesInWeek(l, week).find((g) => g.season === l.season)?.playoffRound;
  return [
    {
      id,
      season: l.season,
      phase: round ? 'playoffs' : 'regular',
      week,
      from: SNN,
      category: 'league',
      // The week and its lead story: the rest is on the page.
      subject: `${edition.label} · ${short(edition.lead.headline, SUBJECT - edition.label.length - 3)}`,
      body: stories.flatMap((s) => [...s.paragraphs, ...(s.quote ? [s.quote.text] : [])]).join('\n\n'),
      edition,
      covered: [...new Set(stories.flatMap((s) => [s.key, ...(s.covers ?? [])]))],
      // Each story carries its own buttons.
      actions: [],
    },
  ];
}
