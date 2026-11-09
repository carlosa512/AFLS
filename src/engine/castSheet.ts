/**
 * The cast sheet: what a line of mail may say about one of your players, about the coach writing and about the moment
 * in the season (docs/superpowers/specs/2026-11-09-storylines-design.md, section 2). Words and booleans only, never a
 * number (the id apart), and each fact comes through a reader screens already use, so the fog of war holds: his
 * personality as your staff read it, the habits they have seen, his mood in words, never a rating or a trait.
 */
import { gameStory } from './gameStory';
import { yearsLeft } from './finance/contract';
import { marketApy } from './finance/market';
import { credibilityRead, type CredibilityRead } from './meetings/credibility';
import { styleOf, yearsPhrase, type Style } from './meetings/facts';
import { actualRole, expectedRole, FAIR_PAY, isCaptain, moraleView, YEAR, type MoraleContext } from './morale';
import { personalityRead } from './personality';
import { POSITION_NAMES } from './positions';
import { QUIRKS } from './quirks';
import { clubFeeling } from './relationships';
import { teamPlayers } from './roster';
import { quirkNotes, seasonNote } from './scouting';
import { computeRecords } from './season/standings';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { standingView, type Sound, type Tier } from './standing';
import { manner } from './manner';
import { traitOf } from './coachTraits';
import { isDeadlineDay } from './trade/rules';
import type { Coach, CoachRoom, Game, League, Player, TalkCause, TalkReply } from './types';
import { mottoOf } from './voice';

const NUMBER_WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
/** A small count as a word; "many" past twelve, so a line never prints a numeral. */
const countWord = (n: number) => NUMBER_WORDS[n] ?? 'many';

// Morale's clock: a league year is 32 steps, the offseason's first, camp at 7, then a step a week from 8.
const CAMP = 7;
const DRAFT = 6;
const FIRST_WEEK = 8;

/**
 * A morale clock in the coach's words: "in week 8", "at camp", "over the winter", "last season". An offseason step
 * before camp is the winter, the draft and camp their own moments, a week past the regular season the playoffs.
 */
export function whenWords(league: League, clock: number): string {
  const season = Math.floor(clock / YEAR);
  const step = clock - season * YEAR;
  if (season < league.season) return 'last season';
  if (step === CAMP) return 'at camp';
  if (step === DRAFT) return 'around the draft';
  if (step < DRAFT || step >= YEAR - 1) return 'over the winter';
  const week = step - FIRST_WEEK + 1;
  return week > REGULAR_SEASON_WEEKS ? 'in the playoffs' : `in week ${week}`;
}

export interface ManSheet {
  id: number;
  first: string;
  last: string;
  pos: string;
  years: string;
  role: 'starter' | 'rotation' | 'depth';
  captain: boolean;
  personality: { name: string; hedged: boolean } | null;
  loud: boolean;
  calm: boolean;
  lean: 'money' | 'winning' | 'loyal' | null;
  tier: Tier | null;
  sound: Sound | null;
  friends: string[];
  feud: { with: string; why?: string } | null;
  mentor: string | null;
  mentee: string | null;
  habit: { label: string; clause: string } | null;
  lastSeason: string | null;
  backFromInjury: boolean;
  finalYear: boolean;
  rookieDeal: boolean;
  underpaid: boolean;
  asks: 'first' | 'second' | 'again';
  lastAnswer: { reply: TalkReply | 'ignored'; when: string; cause?: TalkCause } | null;
  kept: boolean;
  broken: boolean;
  dispute: boolean;
  draftedHere: boolean;
  homecoming: boolean;
  grudgeGame: boolean;
  mood: string | null;
  reason: string | null;
}

/** His agent's lean: the one dial a quarter clear of the other two, else none. */
function leanOf(p: Player): ManSheet['lean'] {
  const { greed, winning, loyalty } = p.personality;
  const dials: [NonNullable<ManSheet['lean']>, number][] = [
    ['money', greed],
    ['winning', winning],
    ['loyal', loyalty],
  ];
  dials.sort((a, b) => b[1] - a[1]);
  return dials[0][1] - dials[1][1] >= 0.25 ? dials[0][0] : null;
}

/** The weeks after a layoff a man still counts as just back. */
const JUST_BACK = 4;

/** Healthy again after an injury that ended in the last few weeks of this league year's games. */
function backFromInjury(league: League, p: Player): boolean {
  if (p.injury || p.ir || league.phase !== 'regular') return false;
  const last = p.injuries?.[p.injuries.length - 1];
  if (!last || last.season !== league.season) return false;
  const since = league.week - (last.week + last.weeks);
  return since >= 0 && since < JUST_BACK;
}

/** Your next game this season, when there is one. */
function nextGame(league: League): Game | undefined {
  const user = league.userTeamId;
  return league.games
    .filter((g) => g.season === league.season && !g.result && (g.homeId === user || g.awayId === user))
    .sort((a, b) => a.week - b.week)[0];
}

/** The club across from you in your next game, regular season only (the offseason has no Sunday). */
function opponentId(league: League): number | null {
  if (league.phase !== 'regular') return null;
  const g = nextGame(league);
  return g ? (g.homeId === league.userTeamId ? g.awayId : g.homeId) : null;
}

/** What a line may say about one of your players; null for anyone else's (the fog of war). */
export function manSheet(league: League, p: Player, ctx: MoraleContext): ManSheet | null {
  const user = league.userTeamId;
  if (p.teamId !== user || p.retired) return null;
  const role = actualRole(league, p, ctx) ?? expectedRole(p, ctx);
  const read = personalityRead(league, user, p);
  const standing = standingView(league, p, ctx);
  const roster = teamPlayers(league, user);
  const lastName = (id: number) => {
    const o = league.players[id];
    return o && o.teamId === user ? o.lastName : null;
  };
  const friends = (p.ties ?? []).filter((t) => t.kind === 'friend').flatMap((t) => lastName(t.with) ?? []);
  const feudTie = (p.ties ?? []).find((t) => t.kind === 'feud' && lastName(t.with));
  const mentee = roster.find((o) => o.mentor === p.id);
  const habit = quirkNotes(league, user, p).notes[0];
  const talk = p.morale?.talk;
  const answered = talk?.answered && talk.answered.at >= league.season * YEAR ? talk.answered : null;
  const mood = moraleView(league, p, ctx);
  const opp = opponentId(league);
  const feeling = opp === null ? null : clubFeeling(league, p, opp);
  const ratio = p.contract ? p.contract.apy / Math.max(1, marketApy(ctx.market, p)) : 1;
  return {
    id: p.id,
    first: p.firstName,
    last: p.lastName,
    pos: POSITION_NAMES[p.position].toLowerCase(),
    years: yearsPhrase(p.experience),
    role: role >= 2 ? 'starter' : role === 1 ? 'rotation' : 'depth',
    captain: isCaptain(league, p),
    personality: read ? { name: read.name, hedged: read.hedged } : null,
    ...manner(p),
    lean: leanOf(p),
    tier: standing?.tier ?? null,
    sound: standing?.sound ?? null,
    friends,
    feud: feudTie ? { with: lastName(feudTie.with)!, ...(feudTie.why ? { why: feudTie.why } : {}) } : null,
    mentor: p.mentor !== undefined ? lastName(p.mentor) : null,
    mentee: mentee?.lastName ?? null,
    habit: habit ? { label: habit.label, clause: QUIRKS[habit.id].clause } : null,
    lastSeason: seasonNote(league, p),
    backFromInjury: backFromInjury(league, p),
    finalYear: !!p.contract && yearsLeft(p.contract, league.season) <= 1,
    rookieDeal: p.contract?.kind === 'rookie',
    underpaid: !!p.contract && ratio < FAIR_PAY,
    asks: !answered ? 'first' : (talk?.reassured ?? 0) >= 2 ? 'again' : 'second',
    lastAnswer: answered
      ? {
          reply: answered.reply,
          when: whenWords(league, answered.at),
          ...(answered.cause ? { cause: answered.cause } : {}),
        }
      : null,
    kept: (talk?.kept ?? 0) > 0,
    broken: (talk?.broken ?? 0) > 0,
    dispute: !!p.morale?.dispute,
    draftedHere: p.draft?.teamId === user,
    homecoming: feeling === 'home',
    grudgeGame: feeling === 'grudge',
    mood: mood?.word ?? null,
    reason: mood?.reasons[0] ?? null,
  };
}

export interface CoachSheet {
  name: string;
  style: Style;
  motto: string;
  isNew: boolean;
  word: CredibilityRead;
  room?: CoachRoom;
}

/** What a line may say about the coach writing it. */
export function coachSheet(league: League, c: Coach): CoachSheet {
  return {
    name: `${c.firstName} ${c.lastName}`,
    style: styleOf(traitOf(c, 'discipline')),
    motto: mottoOf(c.id),
    isNew: c.since === league.season,
    word: credibilityRead(c),
    ...(c.room ? { room: c.room } : {}),
  };
}

export interface MomentSheet {
  record: 'winning' | 'losing' | 'even';
  streak: { kind: 'won' | 'lost'; games: string } | null;
  lastGame: string | null;
  rival: boolean;
  seasonOver: boolean;
  week: 'camp' | 'deadline' | 'push' | 'bye' | 'regular' | 'playoffs' | 'offseason';
}

/** The last weeks of the regular season, when a club is in its push. */
const PUSH_WEEKS = 3;

/** Our season is over: the league year is complete, or we have no game left in the playoffs. */
function seasonDone(league: League): boolean {
  if (league.phase === 'complete') return true;
  if (league.phase !== 'playoffs') return false;
  const user = league.userTeamId;
  return !league.games.some((g) => g.season === league.season && !g.result && (g.homeId === user || g.awayId === user));
}

/** Where the season stands, in words. */
export function momentSheet(league: League): MomentSheet {
  const user = league.userTeamId;
  const rec = computeRecords(league).get(user);
  const played = rec ? rec.w + rec.l + rec.t : 0;
  const share = rec && played ? (rec.w + rec.t / 2) / played : 0.5;
  const run = rec?.streak.match(/^([WL])(\d+)$/);
  const mine = league.games
    .filter((g) => g.season === league.season && g.result && (g.homeId === user || g.awayId === user))
    .sort((a, b) => b.week - a.week)[0];
  let lastGame: string | null = null;
  if (mine?.result) {
    const home = mine.homeId === user;
    const swing = gameStory(mine.result, home).swing.trim();
    const [us, them] = home
      ? [mine.result.homeScore, mine.result.awayScore]
      : [mine.result.awayScore, mine.result.homeScore];
    if (swing && us !== them) lastGame = `we ${us > them ? 'won' : 'lost'} ${swing}`;
  }
  const opp = opponentId(league);
  const rival =
    opp !== null &&
    league.teams[opp].division === league.teams[user].division &&
    league.teams[opp].conference === league.teams[user].conference;
  const phase = league.phase;
  const week: MomentSheet['week'] =
    phase === 'preseason'
      ? 'camp'
      : phase === 'playoffs'
        ? 'playoffs'
        : phase !== 'regular'
          ? 'offseason'
          : !league.games.some(
                (g) => g.season === league.season && g.week === league.week && (g.homeId === user || g.awayId === user),
              )
            ? 'bye'
            : isDeadlineDay(league)
              ? 'deadline'
              : league.week > REGULAR_SEASON_WEEKS - PUSH_WEEKS
                ? 'push'
                : 'regular';
  return {
    record: played < 3 ? 'even' : share >= 0.6 ? 'winning' : share <= 0.4 ? 'losing' : 'even',
    streak:
      run && Number(run[2]) >= 2 ? { kind: run[1] === 'W' ? 'won' : 'lost', games: countWord(Number(run[2])) } : null,
    lastGame,
    rival,
    seasonOver: seasonDone(league),
    week,
  };
}
