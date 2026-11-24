/**
 * The words of SNN's stories about players in trouble and players doing good (`snnConduct.ts` chooses them, this
 * writes them). Every sentence is a whole line written by hand with slots only for facts (a name, a team, a number,
 * a place) and chosen by a condition on public facts through `say` (`voice.ts`): the most specific that fits, a stable
 * tie-break, none said before this league year. A story is two paragraphs: what happened and why, then what it means
 * and what is next. The tone stops at a fight and a missed curfew, and a man's character is never named: only what he
 * did. Written to `storyRules.ts` and the house rules in `docs/NEWS.md`.
 *
 * A team sitting a man for a private kind of trouble is told as the NFL's teams tell it: held out "for a violation of
 * team rules", never the incident. The head coach's quote is the existing mechanism (`EditionStory.quote`); a
 * player's own words come with the quotes.
 */
import { teamCoaches } from './coaching';
import { REVIEW } from './conduct';
import type { Candidate } from './snnWeek';
import { ordinal } from './opposition';
import { POSITION_NAMES } from './positions';
import { draftedHigh, publicRecord } from './publicStanding';
import { referrer } from './refer';
import { computeRecords, divisionStandings } from './season/standings';
import type { ConductFacts } from './snnConduct';
import { statLine } from './stats';
import type { EditionStory, League, Player } from './types';
import { around, say, sentencesOf, stableHash, type Line } from './voice';

interface Wording {
  editionId: string;
  said: string[];
}
interface Options {
  quote?: false;
  brief?: true;
}

// ───────── tokens and small words ─────────

const M = (id: number) => `{M:${id}}`;
const C = (id: number) => `{C:${id}}`;
const c = (id: number) => `{c:${id}}`;
/** A team's bare nickname ("Squall"): write the article yourself. */
const N = (id: number) => `{N:${id}}`;
const resolveTokens = (text: string, ref: ReturnType<typeof referrer>) =>
  text
    .replace(/\{(M|C|c|N):(\d+)\}/g, (_, kind: string, n: string) => {
      const id = Number(n);
      if (kind === 'N') {
        ref.club(id);
        return ref.nickname(id);
      }
      return kind === 'M' ? ref.man(id) : kind === 'c' ? ref.city(id) : ref.club(id);
    })
    .replace(/(^|[.?!] )([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
const menIn = (text: string) => [...text.matchAll(/\{M:(\d+)\}/g)].map((m) => Number(m[1]));
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const w = (n: number) => (Number.isInteger(n) && n >= 0 && n < 10 ? SMALL[n] : String(n));
const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const nth = (n: number) => NTH[n] ?? ordinal(n);
const games = (n: number) => (n === 1 ? 'one game' : `${w(n)} games`);
const QUARTER = ['', 'first', 'second', 'third', 'fourth'];
const posWord = (p: Player) => (p.position === 'OL' ? 'offensive lineman' : POSITION_NAMES[p.position].toLowerCase());
const hash = (key: string) => stableHash(key);

// ───────── the sheet: what a line may read ─────────

interface Next {
  opp: number;
  home: boolean;
  /** A week off first. */
  bye: boolean;
}

interface Sheet {
  id: number;
  club: number;
  pos: string;
  /** "defensive end {M:12}", the way a story first names him. */
  who: string;
  star: boolean;
  rookie: boolean;
  captain: boolean;
  angle: string;
  /** The round he was drafted in by this team this year, or 0. */
  round: number;
  /** His seasons with the club, this one counted. */
  seasons: number;
  nth: number;
  bans: number;
  games: number;
  fined: boolean;
  /** The ejection's quarter (5 is overtime), and the game it happened in. */
  qtr: number;
  opp: number;
  home: boolean;
  /** The result of that game for his team: null when it is not a game of his story. */
  won: boolean | null;
  ws: number;
  ls: number;
  close: boolean;
  /** Other public troubles this league year before this one. */
  again: number;
  w: number;
  l: number;
  rec: string;
  leading: boolean;
  division: string;
  leaderId: number;
  next: Next | null;
  /** A season line worth one sentence ("six sacks this season"), or ''. */
  fact: string;
  /** Who he is in a good story: a place, a count of teammates, an event. */
  place: string;
  mates: number;
  event: 'son' | 'daughter' | 'wedding' | 'engaged';
}

const through = (l: League, week: number): League => ({
  ...l,
  games: l.games.filter((g) => g.season !== l.season || g.week <= week),
});

/** One sentence of his season that stands out, from the stats a fan reads. */
function factOf(l: League, p: Player): string {
  const s = statLine(p, l.season);
  if (!s) return '';
  const n = (k: keyof typeof s) => s[k] ?? 0;
  if (['EDGE', 'DT', 'LB'].includes(p.position) && n('sacks') >= 3) return `${w(n('sacks'))} sacks this season`;
  if (['CB', 'S'].includes(p.position) && n('defInt') >= 2) return `${w(n('defInt'))} interceptions this season`;
  if (['WR', 'TE'].includes(p.position) && n('rec') >= 20)
    return `${n('rec')} catches for ${n('recYds')} yards this season`;
  if (p.position === 'RB' && n('rushYds') >= 250) return `${n('rushYds')} rushing yards this season`;
  if (p.position === 'QB' && n('passTd') >= 8) return `${n('passTd')} touchdown passes this season`;
  return '';
}

const PLACES = [
  "the children's hospital",
  'a local food bank',
  'a youth football camp',
  'his old high school',
  "a veterans' home",
  'a neighborhood youth center',
];
const EVENTS: Sheet['event'][] = ['son', 'daughter', 'wedding', 'engaged'];

function sheetOf(l: League, cand: Candidate, week: number): Sheet {
  const x = cand.conduct!;
  const p = l.players[x.playerId];
  const club = cand.clubId;
  const game = x.gameId === undefined ? undefined : l.games.find((g) => g.id === x.gameId);
  const home = game?.homeId === club;
  const r = game?.result;
  const [us, them] = !r ? [0, 0] : home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  const now = through(l, Math.max(1, week));
  const records = computeRecords(now);
  const row = records.get(club)!;
  const table = divisionStandings(now, records)[l.teams[club].division];
  const nextGame = l.games
    .filter((g) => g.season === l.season && g.week > week && (g.homeId === club || g.awayId === club))
    .sort((a, b) => a.week - b.week)[0];
  const seasons = Object.entries(p.statTeams ?? {}).filter(
    ([s, ids]) => Number(s) <= l.season && ids.includes(club),
  ).length;
  const key = `${cand.key}`;
  return {
    id: p.id,
    club,
    pos: posWord(p),
    who: `${posWord(p)} ${M(p.id)}`,
    star: x.star,
    rookie: p.experience === 0,
    angle: x.angle,
    captain: Object.values(l.teams[club].captains ?? {}).includes(p.id),
    round: p.draft && p.draft.season === l.season && p.draft.teamId === club ? p.draft.round : 0,
    seasons: Math.max(1, seasons),
    nth: x.nth,
    bans: x.bans,
    games: x.games ?? 1,
    fined: x.outcome === 'leagueFine',
    qtr: x.quarter ?? 0,
    opp: game ? (home ? game.awayId : game.homeId) : club,
    home,
    won: !r || us === them ? null : us > them,
    ws: Math.max(us, them),
    ls: Math.min(us, them),
    close: !!r && Math.abs(us - them) <= 7,
    again: x.again,
    w: row.w,
    l: row.l,
    rec: `${row.w}–${row.l}${row.t ? `–${row.t}` : ''}`,
    leading: table.teams[0]?.teamId === club,
    division: table.division.name,
    leaderId: table.teams[0]?.teamId ?? club,
    next: nextGame
      ? {
          opp: nextGame.homeId === club ? nextGame.awayId : nextGame.homeId,
          home: nextGame.homeId === club,
          bye: nextGame.week > week + 1,
        }
      : null,
    fact: factOf(l, p),
    place: PLACES[hash(`${key}:place`) % PLACES.length],
    mates: 4 + (hash(`${key}:mates`) % 9),
    event: EVENTS[hash(`${key}:event`) % EVENTS.length],
  };
}

// ───────── phrases ─────────

const qtrIn = (s: Sheet) => (s.qtr > 4 ? 'in overtime' : `in the ${QUARTER[s.qtr]} quarter`);
/** Where his team's game was: "at home against Denver", "at Denver". */
const where = (s: Sheet) => (s.home ? `at home against ${c(s.opp)}` : `at ${c(s.opp)}`);
const nextWhere = (s: Sheet) =>
  !s.next ? '' : s.next.home ? `at home against ${c(s.next.opp)}` : `at ${c(s.next.opp)}`;
const gw = (s: Sheet) => games(s.games);
const score = (s: Sheet) => `${s.ws}–${s.ls}`;
const lost = (s: Sheet) => s.won === false;
const won = (s: Sheet) => s.won === true;

type Bank = readonly Line<Sheet>[];
const L = (text: (s: Sheet) => string, reads = 0, when?: (s: Sheet) => boolean): Line<Sheet> => ({
  text,
  reads,
  ...(when ? { when } : {}),
});

// ───────── what happened: the lede, a line or two ─────────

const FIGHT: Bank = [
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} on Tuesday. He was ejected ${qtrIn(s)} ${where(s)} for fighting.`,
  ),
  L(
    (s) =>
      `${c(s.club)} will be without ${s.who} for ${gw(s)}. The league ruled on Tuesday after he was ejected for fighting ${qtrIn(s)} ${where(s)}.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `${s.who} will serve a suspension of ${gw(s)}, the league ruled on Tuesday. He was ejected for fighting ${where(s)}, his ${nth(s.nth)} ejection this season.`,
    2,
    (s) => s.nth >= 2,
  ),
  L(
    (s) =>
      `${s.who} was ejected for fighting ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. The league suspended him for ${gw(s)}.`,
    1,
    (s) => lost(s),
  ),
  L(
    (s) =>
      `${s.who} was thrown out for fighting ${qtrIn(s)} ${where(s)}, and ${c(s.club)} still won ${score(s)}. The league suspended him for ${gw(s)}.`,
    1,
    (s) => won(s),
  ),
  L(
    (s) =>
      `The league gave ${s.who} a suspension of ${gw(s)} on Tuesday, longer than his last, for fighting ${qtrIn(s)} ${where(s)}. It is his ${nth(s.bans)} suspension in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) =>
      `A fight ${qtrIn(s)} ${where(s)} cost ${s.who} a game and then some. The league ruled on Tuesday that he will sit out ${gw(s)}.`,
    0,
    (s) => s.games > 1,
  ),
];

const TWO: Bank = [
  L((s) =>
    s.fined
      ? `The league fined ${s.who} on Tuesday after he was ejected ${qtrIn(s)} ${where(s)}. It was his second unsportsmanlike conduct penalty of the game.`
      : `The league suspended ${s.who} for ${gw(s)} on Tuesday. He was ejected ${qtrIn(s)} ${where(s)} after his second unsportsmanlike conduct penalty.`,
  ),
  L(
    (s) =>
      `${s.who} picked up two unsportsmanlike conduct penalties ${where(s)} and was ejected ${qtrIn(s)}. The league ruled on Tuesday and ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    1,
    (s) => !s.star,
  ),
  L(
    (s) =>
      `${s.who} was ejected ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    2,
    (s) => lost(s),
  ),
  L(
    (s) =>
      `${s.who} was ejected ${qtrIn(s)} ${where(s)} for a second unsportsmanlike conduct penalty, though ${c(s.club)} went on to win ${score(s)}. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    2,
    (s) => won(s),
  ),
  L(
    (s) =>
      `It was the second ejection of the season for ${s.who}, this time for two unsportsmanlike conduct penalties ${where(s)}. The league suspended him for ${gw(s)} on Tuesday.`,
    3,
    (s) => s.nth >= 2 && !s.fined,
  ),
  L(
    (s) =>
      `${c(s.club)} lost ${s.who} ${qtrIn(s)} ${where(s)}, when his second unsportsmanlike conduct penalty got him ejected. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    1,
    (s) => s.star,
  ),
];

const FLAGRANT: Bank = [
  L((s) =>
    s.fined
      ? `The league fined ${s.who} on Tuesday after he was ejected ${qtrIn(s)} ${where(s)} for a flagrant hit.`
      : `The league suspended ${s.who} for ${gw(s)} on Tuesday. He was ejected ${qtrIn(s)} ${where(s)} for a flagrant hit.`,
  ),
  L(
    (s) =>
      `${s.who} was ejected ${qtrIn(s)} ${where(s)} for a hit the officials called flagrant. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`} on Tuesday.`,
    1,
    (s) => !s.star,
  ),
  L(
    (s) =>
      `A hit the officials called flagrant got ${s.who} thrown out ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    2,
    (s) => lost(s),
  ),
  L(
    (s) =>
      `${s.who} was ejected for a flagrant hit ${qtrIn(s)} ${where(s)}, though ${c(s.club)} held on to win ${score(s)}. The league ${s.fined ? 'fined him' : `suspended him for ${gw(s)}`}.`,
    2,
    (s) => won(s) && s.close,
  ),
  L(
    (s) =>
      `${s.who} was ejected for a flagrant hit, his ${nth(s.nth)} ejection of the season. The league suspended him for ${gw(s)}.`,
    3,
    (s) => s.nth >= 2 && !s.fined,
  ),
];

const FINED = `${w(REVIEW.fouls)} dangerous fouls in ${w(REVIEW.span)} games`;

const FINE: Bank = [
  L(
    (s) =>
      `The league fined ${s.who} on Tuesday. It was his ${nth(REVIEW.fouls)} dangerous foul in ${w(REVIEW.span)} games, and the league reviews a pattern like that.`,
  ),
  L(
    (s) =>
      `${s.who} was fined by the league on Tuesday for a run of dangerous fouls, ${w(REVIEW.fouls)} of them in ${w(REVIEW.span)} games. There was no suspension.`,
    1,
  ),
  L(
    (s) =>
      `The league fined ${s.who} for a hit ${where(s)}, the ${nth(REVIEW.fouls)} dangerous foul he has been flagged for in ${w(REVIEW.span)} games. There was no suspension.`,
    2,
    (s) => !lost(s) || s.close,
  ),
  L(
    (s) =>
      `${s.who} drew a fine from the league after another dangerous foul ${where(s)}, ${c(s.club)}'s ${score(s)} ${lost(s) ? 'loss' : won(s) ? 'win' : 'game'}. He has been flagged for ${FINED}.`,
    2,
    (s) => s.won !== null,
  ),
  L(
    (s) =>
      `The league fined ${s.who} after his latest dangerous foul. He has ${FINED}, and the next run like it will bring more than a fine.`,
    1,
    (s) => s.star,
  ),
];

const BAN: Bank = [
  L((s) =>
    s.games === 1
      ? `The league suspended ${s.who} for one game on Tuesday. It was his latest dangerous foul ${where(s)}, and the league had already fined him for a run of them.`
      : `The league suspended ${s.who} for ${gw(s)} on Tuesday after another dangerous foul ${where(s)}. He had been fined for a run of them before.`,
  ),
  L(
    (s) =>
      `${s.who} will sit out ${gw(s)} after the league ruled on Tuesday that his run of dangerous fouls had gone too far. The latest came ${where(s)}.`,
    1,
  ),
  L(
    (s) =>
      `${c(s.club)} will be without ${s.who} for ${gw(s)}. The league suspended him on Tuesday for his pattern of dangerous fouls, the latest of them ${where(s)}.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} on Tuesday, longer than his last suspension. The latest dangerous foul came ${where(s)}, and it is his ${nth(s.bans)} ban in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) =>
      `${s.who} was suspended for ${gw(s)} after a dangerous foul ${where(s)}, the latest in a run of them. ${c(s.club)} lost that game ${score(s)}.`,
    2,
    (s) => lost(s),
  ),
];

const FIGHT_OFF: Bank = [
  L((s) =>
    s.games === 1
      ? `The league suspended ${s.who} for one game after a fight away from the stadium. It ruled on Tuesday.`
      : `The league suspended ${s.who} for ${gw(s)} after a fight away from the stadium. It ruled on Tuesday.`,
  ),
  L(
    (s) => `${s.who} was in a fight away from the stadium, and the league suspended him for ${gw(s)}.`,
    0,
    (s) => !s.star,
  ),
  L(
    (s) =>
      `${c(s.club)} will play without ${s.who} for ${gw(s)}. The league ruled on Tuesday after a fight away from the stadium.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `The league gave ${s.who} ${gw(s)}, longer than his last suspension, for a fight away from the stadium. It is his ${nth(s.bans)} ruling in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) => `A fight away from the stadium has cost ${s.who} ${gw(s)}. The league suspended him on Tuesday.`,
    1,
    (s) => s.l > s.w,
  ),
];

const SAT: Bank = [
  L((s) =>
    s.next
      ? `${C(s.club)} will play without ${s.who} ${nextWhere(s)}. The team said this week that he was held out for a violation of team rules.`
      : `${C(s.club)} held ${s.who} out for a violation of team rules, the team said this week.`,
  ),
  L(
    (s) =>
      `${s.who} will not play ${nextWhere(s)}. ${C(s.club)} are holding him out for a violation of team rules, the team said.`,
    1,
    (s) => !!s.next && s.star,
  ),
  L(
    (s) =>
      `${C(s.club)} sat ${s.who} for a violation of team rules, and he has been in the news before this season. He will miss the game ${nextWhere(s)}.`,
    2,
    (s) => !!s.next && s.again >= 1,
  ),
  L(
    (s) =>
      `${s.who} was held out of the next game for a violation of team rules, ${C(s.club)} announced. The team plays ${nextWhere(s)}.`,
    1,
    (s) => !!s.next && s.w > s.l,
  ),
  L(
    (s) =>
      `${C(s.club)} will play ${nextWhere(s)} without ${s.who}. The team held him out for a violation of team rules.`,
    1,
    (s) => !!s.next && s.l > s.w,
  ),
  L(
    (s) =>
      `The team held ${s.who} out of its next game for a violation of team rules. ${C(s.club)} will play ${nextWhere(s)} without him.`,
    0,
    (s) => !!s.next && s.rookie,
  ),
];

const SPAT: Bank = [
  L((s) => `${s.who} got into a public argument with someone on his own team this week.`),
  L(
    (s) => `${C(s.club)} have a public argument to settle, and ${s.who} is in the middle of it.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `A disagreement between ${s.who} and someone on his own team became public this week, with ${c(s.club)} at ${s.rec}.`,
    1,
    (s) => s.w > s.l,
  ),
  L(
    (s) =>
      `${s.who} took a disagreement inside the ${N(s.club)} locker room public this week, and the team is ${s.rec}.`,
    1,
    (s) => s.l > s.w,
  ),
  L(
    (s) => `${s.who} is in the news again, this time for a public argument with someone on his own team.`,
    3,
    (s) => s.again >= 1,
  ),
  L(
    (s) => `An argument between ${s.who} and someone on his own team spilled into public view this week.`,
    0,
    (s) => !s.star,
  ),
];

const EVENT: Bank = [
  L((s) => `${s.who} skipped a team event this week, and ${C(s.club)} know it.`),
  L(
    (s) => `${s.who} was not at a ${N(s.club)} team event this week. The team has not said why.`,
    1,
    (s) => !s.star,
  ),
  L(
    (s) => `${s.who} did not turn up for a ${N(s.club)} team event this week, and the team is ${s.rec}.`,
    1,
    (s) => s.l > s.w,
  ),
  L(
    (s) =>
      `This is not the first time ${s.who} has been in the news this season, and he skipped a ${N(s.club)} team event this week.`,
    3,
    (s) => s.again >= 1,
  ),
  L(
    (s) => `One of the ${N(s.club)} stars, ${s.who}, did not go to a team event this week.`,
    2,
    (s) => s.star,
  ),
  L(
    (s) => `A ${N(s.club)} team event went on without ${s.who} this week, with the team at ${s.rec}.`,
    1,
    (s) => s.w > s.l,
  ),
];

// ───────── the good side ─────────

const COMMUNITY: Bank = [
  L((s) => `${s.who} spent his day off at ${s.place}, and he brought ${w(s.mates)} teammates with him.`),
  L(
    (s) =>
      `${s.who} has made ${s.place} a regular stop in his ${nth(s.seasons)} season with ${c(s.club)}, and this week he brought ${w(s.mates)} teammates along.`,
    2,
    (s) => s.seasons >= 4,
  ),
  L(
    (s) => `With a game to prepare for, ${s.who} still found the time on his day off to visit ${s.place}.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) => `${s.who} made time this week to visit ${s.place}, and ${c(s.club)} are ${s.rec}.`,
    1,
    (s) => s.w > s.l,
  ),
  L(
    (s) =>
      `${c(s.club)} are ${s.rec}, and ${s.who} still spent his day off at ${s.place} with ${w(s.mates)} of his teammates.`,
    1,
    (s) => s.l > s.w,
  ),
  L(
    (s) => `${s.who}, a rookie, spent his day off at ${s.place}, one of his first visits as a professional.`,
    2,
    (s) => s.rookie,
  ),
];

const FAMILY: Bank = [
  L(
    (s) => `${s.who} became a father this week when his son was born on Monday.`,
    1,
    (s) => s.event === 'son',
  ),
  L(
    (s) => `${s.who} became a father this week when his daughter was born on Monday.`,
    1,
    (s) => s.event === 'daughter',
  ),
  L(
    (s) => `${s.who} got married on Monday, his day off.`,
    1,
    (s) => s.event === 'wedding',
  ),
  L(
    (s) => `${s.who} announced his engagement this week.`,
    1,
    (s) => s.event === 'engaged',
  ),
  L(
    (s) => `${s.who} and his family welcomed a son this week, and ${c(s.club)} are ${s.rec}.`,
    2,
    (s) => s.event === 'son' && s.w > s.l,
  ),
  L(
    (s) => `${s.who} spent his day off at the hospital with his newborn daughter.`,
    2,
    (s) => s.event === 'daughter' && s.l >= s.w,
  ),
  L(
    (s) => `${s.who} was married on Monday in front of his family and a few of his ${N(s.club)} teammates.`,
    2,
    (s) => s.event === 'wedding' && s.seasons >= 3,
  ),
  L(
    (s) => `${s.who} is engaged, he announced this week, a few months into his first season with ${c(s.club)}.`,
    2,
    (s) => s.event === 'engaged' && s.rookie,
  ),
];

const TEAMMATE: Bank = [
  L((s) => `${s.who} is the player the rest of the ${N(s.club)} locker room goes to first, teammates say.`),
  L(
    (s) => `After ${w(s.seasons)} seasons with ${c(s.club)}, ${s.who} is the teammate other players want next to them.`,
    2,
    (s) => s.seasons >= 5,
  ),
  L(
    (s) => `${s.who} is only a rookie, but his teammates on ${c(s.club)} already go to him first.`,
    2,
    (s) => s.rookie,
  ),
  L(
    (s) => `Teammates on ${c(s.club)} keep pointing to ${s.who} when they explain why the team is ${s.rec}.`,
    1,
    (s) => s.w > s.l,
  ),
  L(
    (s) =>
      `${c(s.club)} are ${s.rec}, and teammates keep pointing to ${s.who} as the one who has held the locker room together.`,
    1,
    (s) => s.l > s.w,
  ),
  L(
    (s) =>
      `${s.who} is one of the ${N(s.club)} captains, and players around the locker room say he is the one they want beside them.`,
    3,
    (s) => s.captain,
  ),
];

/** A line about the man himself, for a good story, which has no game behind it. */
const ABOUT: Bank = [
  L(
    (s) => `He is in his ${nth(s.seasons)} season with ${c(s.club)}.`,
    1,
    (s) => s.seasons >= 2,
  ),
  L(
    (s) => `He was drafted by ${c(s.club)} in the ${nth(s.round)} round this year.`,
    2,
    (s) => s.rookie && s.round > 0,
  ),
  L(
    (s) => `He is one of the three captains ${c(s.club)} named this year.`,
    3,
    (s) => s.captain && s.angle !== 'goodTeammate',
  ),
];

// ───────── what it means: a fact, then where the team stands, then what is next ─────────

/** After the lede, one line of context about the man or what comes of it. */
const MISS: Bank = [
  L(
    (s) => `He will miss the game ${nextWhere(s)}.`,
    0,
    (s) => !!s.next && !s.next.bye && s.games === 1,
  ),
  L(
    (s) => `He will miss the next ${w(s.games)} games, the first of them ${nextWhere(s)} after the bye week.`,
    2,
    (s) => !!s.next?.bye && s.games > 1,
  ),
  L(
    (s) => `He will miss the game ${nextWhere(s)} after the bye week.`,
    1,
    (s) => !!s.next?.bye && s.games === 1,
  ),
  L(
    (s) => `He will miss the next ${w(s.games)} games, starting ${nextWhere(s)}.`,
    2,
    (s) => !!s.next && s.games > 1 && !s.next.bye,
  ),
  L(
    (s) => `${c(s.club)} will play ${nextWhere(s)} without him.`,
    1,
    (s) => !!s.next && !s.next.bye && s.w >= s.l && s.games === 1,
  ),
  L(
    (s) => `The suspension begins with the game ${nextWhere(s)}.`,
    1,
    (s) => !!s.next && !s.next.bye && s.games === 1,
  ),
];

/** A line of his season that stands out. */
const FACT: Bank = [
  L(
    (s) => `${M(s.id)} has ${s.fact}.`,
    1,
    (s) => !!s.fact,
  ),
  L(
    (s) => `So far he has ${s.fact}.`,
    1,
    (s) => !!s.fact && s.star,
  ),
];

const STAND: Bank = [
  L((s) => `${c(s.club)} are ${s.rec}.`),
  L(
    (s) => `${c(s.club)} are ${s.rec} and lead the ${s.division}.`,
    2,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `${c(s.club)} are ${s.rec} and trail ${c(s.leaderId)} in the ${s.division}.`,
    2,
    (s) => !s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `At ${s.rec}, ${c(s.club)} lead the ${s.division}.`,
    2,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `At ${s.rec}, ${c(s.club)} sit behind ${c(s.leaderId)} in the ${s.division}.`,
    2,
    (s) => !s.leading && s.w + s.l > 1,
  ),
];

const STAND_NOREC: Bank = [
  L(
    (s) => `${c(s.club)} lead the ${s.division}.`,
    1,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `${c(s.club)} trail ${c(s.leaderId)} in the ${s.division}.`,
    1,
    (s) => !s.leading && s.w + s.l > 1,
  ),
];

const ALSO: Bank = [L((s) => `${c(s.club)} also held him out of the next game.`, 0)];

const NEXT: Bank = [
  L(
    (s) => `${c(s.club)} ${s.next!.home ? 'host' : 'go to'} ${c(s.next!.opp)} next.`,
    0,
    (s) => !!s.next && !s.next.bye,
  ),
  L(
    (s) => `${c(s.club)} have a bye and then ${s.next!.home ? 'host' : 'go to'} ${c(s.next!.opp)}.`,
    1,
    (s) => !!s.next?.bye,
  ),
  L(
    (s) => `Next, ${c(s.club)} ${s.next!.home ? 'play at home against' : 'travel to'} ${c(s.next!.opp)}.`,
    0,
    (s) => !!s.next && !s.next.bye,
  ),
];

// ───────── headlines and the head coach's word ─────────

interface HeadSheet extends Sheet {
  last: string;
  club_: string;
}
const HEADS: Record<string, readonly Line<HeadSheet>[]> = {
  ejectFight: [
    { text: (s) => `${s.last} suspended ${gw(s)} after ejection for fighting` },
    { text: (s) => `${s.last} gets ${gw(s)} for fighting`, reads: 0 },
    { text: (s) => `${s.last} suspended again after another ejection`, reads: 2, when: (s) => s.nth >= 2 },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} out ${gw(s)} after a fight`, reads: 0 },
  ],
  ejectTwo: [
    { text: (s) => (s.fined ? `${s.last} fined after ejection` : `${s.last} suspended ${gw(s)} after ejection`) },
    {
      text: (s) =>
        s.fined ? `${s.last} fined for two unsportsmanlike penalties` : `${s.last} suspended after two penalties`,
      reads: 0,
    },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} ejected for a second foul`, reads: 0 },
  ],
  ejectFlagrant: [
    {
      text: (s) => (s.fined ? `${s.last} fined for a flagrant hit` : `${s.last} suspended ${gw(s)} for a flagrant hit`),
    },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} ejected for a hit`, reads: 0 },
    {
      text: (s) => (s.fined ? `${s.last} fined after being ejected` : `${s.last} out ${gw(s)} after flagrant hit`),
      reads: 0,
    },
  ],
  fine: [
    { text: (s) => `${s.last} fined for his dangerous fouls` },
    { text: (s) => `League fines ${s.club_} ${s.pos} ${s.last}`, reads: 0 },
    { text: (s) => `${s.last} fined as the league watches his fouls`, reads: 1, when: (s) => s.star },
  ],
  ban: [
    { text: (s) => `${s.last} suspended ${gw(s)} for dangerous fouls` },
    { text: (s) => `${s.last} out ${gw(s)} after a run of fouls`, reads: 0 },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} suspended`, reads: 0 },
  ],
  banFight: [
    { text: (s) => `${s.last} suspended ${gw(s)} after a fight` },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} gets ${gw(s)}`, reads: 0 },
    { text: (s) => `${s.last} suspended again`, reads: 2, when: (s) => s.bans >= 2 },
  ],
  sat: [
    { text: (s) => `${s.club_} sit ${s.last} for a violation of team rules` },
    { text: (s) => `${s.last} held out for a violation of team rules`, reads: 0 },
    { text: (s) => `${s.club_} hold ${s.last} out of their next game`, reads: 0 },
  ],
  spat: [
    { text: (s) => `${s.last} in a public argument inside the ${s.club_} locker room` },
    { text: (s) => `${s.club_} deal with a public argument over ${s.last}`, reads: 0 },
    { text: (s) => `${s.last} goes public with a disagreement`, reads: 0 },
  ],
  teamEvent: [
    { text: (s) => `${s.last} skips a ${s.club_} team event` },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} misses a team event`, reads: 0 },
    { text: (s) => `${s.last} stays away from a team event`, reads: 0 },
  ],
  goodCommunity: [
    { text: (s) => `${s.last} spends his day off at ${s.place}` },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} gives his day off away`, reads: 0 },
    { text: (s) => `${s.last} takes ${w(s.mates)} teammates to ${s.place}`, reads: 0 },
  ],
  goodFamily: [
    {
      text: (s) =>
        s.event === 'son' || s.event === 'daughter'
          ? `${s.last} becomes a father`
          : s.event === 'wedding'
            ? `${s.last} gets married`
            : `${s.last} announces his engagement`,
    },
    {
      text: (s) =>
        s.event === 'son' || s.event === 'daughter'
          ? `${s.club_} ${s.pos} ${s.last} welcomes a ${s.event}`
          : s.event === 'wedding'
            ? `${s.club_} ${s.pos} ${s.last} marries`
            : `${s.club_} ${s.pos} ${s.last} is engaged`,
      reads: 0,
    },
  ],
  goodTeammate: [
    { text: (s) => `${s.last} is the teammate everyone wants` },
    { text: (s) => `${s.club_} locker room points to ${s.last}`, reads: 0 },
    { text: (s) => `${s.last} holds the ${s.club_} together`, reads: 0 },
  ],
};

const QUOTES: Record<string, readonly string[]> = {
  sat: [
    'He knows what he did. He will be back with us next week.',
    'That is a team matter, and we are handling it inside the locker room.',
    'We have standards here, and everyone is held to them.',
    'It is one game, and it is the right call for our team.',
  ],
  ban: [
    'We respect the league’s decision, and we will move on.',
    'He knows he let his teammates down, and he will answer for that.',
    'We will be ready with the next player up.',
    'Emotions ran high. We expect him to handle it better.',
  ],
  fine: [
    'We will talk about it as a team and learn from it.',
    'He plays hard, and we want him to keep his head clear.',
    'We have talked, and he understands where the line is.',
  ],
};
const QUOTE_BANK: Record<string, keyof typeof QUOTES> = {
  sat: 'sat',
  ejectFight: 'ban',
  ejectTwo: 'ban',
  ejectFlagrant: 'ban',
  ban: 'ban',
  banFight: 'ban',
  fine: 'fine',
};

// ───────── assembling ─────────

/** A paragraph stops on a fact: a number, a man of the story or a team (`storyRules.ts`). */
function endsOnFact(l: League, text: string, cast: number[]): boolean {
  const last = sentencesOf(text).at(-1) ?? '';
  const names = [...cast.map((id) => l.players[id].lastName), ...l.teams.flatMap((t) => [t.name, t.city])];
  return /\d/.test(last) || names.some((n) => last.includes(n));
}

/** Said already this league year, as written or as it prints once its people are named. */
function saidAlready(l: League, at: Wording, text: string): boolean {
  const { skip } = around(l, at.said);
  return skip(text);
}

function pick<S>(l: League, bank: readonly Line<S>[], sheet: S, at: Wording, key: string, slot: string): string {
  const base = around(l, at.said);
  const text = say(bank, sheet, { key: `${at.editionId}:${key}`, slot, skip: base.skip });
  if (text) at.said.push(...sentencesOf(text));
  return text;
}

export const LEDES: Record<string, Bank> = {
  ejectFight: FIGHT,
  ejectTwo: TWO,
  ejectFlagrant: FLAGRANT,
  fine: FINE,
  ban: BAN,
  banFight: FIGHT_OFF,
  sat: SAT,
  spat: SPAT,
  teamEvent: EVENT,
  goodCommunity: COMMUNITY,
  goodFamily: FAMILY,
  goodTeammate: TEAMMATE,
};
/** The angles whose man is out for games: the second paragraph says which one he misses. */
const OUT = new Set(['ejectFight', 'ejectTwo', 'ejectFlagrant', 'ban', 'banFight']);

/** One story from a conduct candidate. */
export function conductStory(l: League, cand: Candidate, at: Wording, opt: Options = {}): EditionStory {
  const x: ConductFacts = cand.conduct!;
  const week = x.week;
  const s = sheetOf(l, cand, week);
  const p = l.players[s.id];
  const angle = x.angle;
  const good = angle.startsWith('good');
  const key = cand.key;
  const lede = pick(l, LEDES[angle], s, at, key, 'lede');
  const out = OUT.has(angle) && !(s.fined && x.outcome === 'leagueFine');
  const sat = angle === 'spat' || angle === 'teamEvent' ? x.outcome === 'sat' : false;
  const miss = out ? pick(l, MISS, s, at, key, 'miss') : sat ? pick(l, ALSO, s, at, key, 'also') : '';
  const about = good ? pick(l, ABOUT, s, at, key, 'about') : '';
  const fact = pick(l, FACT, s, at, key, 'fact');
  // The record said in the lede or the fact is not said again, and the next game is said once.
  const saysRec = [lede, fact].some((t) => t.includes(s.rec));
  const stand = pick(l, saysRec ? STAND_NOREC : STAND, s, at, key, 'stand');
  const told = [lede, miss, about, fact, stand].join(' ');
  const next = s.next && !out && !told.includes(c(s.next.opp)) ? pick(l, NEXT, s, at, key, 'next') : '';
  const second = [miss, about, fact, stand, next].filter(Boolean);
  // A story needs two paragraphs: a lede of two sentences splits at its first, else the standing stays alone.
  const first = [lede];
  if (!second.length) second.push(`${c(s.club)} are ${s.rec}.`);

  const ref = referrer(l, { playerIds: [...new Set([...[lede, ...second].flatMap(menIn)])] });
  const parts = [...first, ...second].map((t) => resolveTokens(t, ref));
  const cast = [...new Set([lede, ...second].flatMap(menIn))];
  // A story about your own team's second slot stands as one paragraph (`brief`), and a story stops on a fact: the
  // lede takes the lines after it until it does.
  let split = first.length;
  if (opt.brief) while (split < parts.length && !endsOnFact(l, parts.slice(0, split).join(' '), cast)) split++;
  const paragraphs = [parts.slice(0, split).join(' '), parts.slice(split).join(' ')].filter(Boolean);
  at.said.push(...paragraphs.flatMap((t) => sentencesOf(t)));

  const head = pick(
    l,
    HEADS[angle] as readonly Line<HeadSheet>[],
    { ...s, last: p.lastName, club_: l.teams[s.club].name },
    at,
    key,
    'head',
  );
  const coach = teamCoaches(l, s.club).find((k) => k.role === 'headCoach');
  const bank = QUOTE_BANK[angle];
  const fresh = bank ? QUOTES[bank].filter((t) => !saidAlready(l, at, t)) : [];
  const quoteLine =
    coach && fresh.length && opt.quote !== false ? fresh[hash(`${at.editionId}:${key}:quote`) % fresh.length] : '';
  if (quoteLine) at.said.push(...sentencesOf(quoteLine));

  return {
    key,
    kind: 'conduct',
    angle,
    tier: cand.tier,
    clubId: s.club,
    kicker: good ? 'Around the league' : s.division,
    headline: head,
    summary: sentencesOf(paragraphs[0]).slice(0, 2).join(' '),
    picture: { playerId: s.id },
    cast,
    numbers: out
      ? [{ value: String(s.games), label: s.games === 1 ? 'Game' : 'Games' }]
      : [{ value: s.rec, label: 'Record' }],
    paragraphs,
    ...(quoteLine && coach
      ? {
          quote: {
            coachId: coach.id,
            name: `${coach.firstName} ${coach.lastName}`,
            role: `${l.teams[s.club].name} head coach`,
            text: quoteLine,
          },
        }
      : {}),
    links: [
      { kind: 'player', playerId: s.id },
      { kind: 'team', teamId: s.club },
    ],
  };
}

// ───────── the offseason's ruling, on a big day ─────────

interface Off extends Pick<Sheet, 'id' | 'club' | 'who' | 'star' | 'rookie' | 'games' | 'bans'> {
  /** Week 1's game, from his team's side. */
  opener: { opp: number; home: boolean } | null;
}
const openerWhere = (s: Off) =>
  !s.opener ? '' : s.opener.home ? `at home against ${c(s.opener.opp)}` : `at ${c(s.opener.opp)}`;

const OFF_LEDE: readonly Line<Off>[] = [
  L2(
    (s) =>
      `The league suspended ${s.who} for ${games(s.games)} after a fight away from the stadium. He will serve it when the season begins.`,
  ),
  L2(
    (s) =>
      `${c(s.club)} will open the season without ${s.who}. The league suspended him for ${games(s.games)} after a fight away from the stadium.`,
    1,
    (s) => s.star,
  ),
  L2(
    (s) =>
      `A fight away from the stadium has cost ${s.who} ${games(s.games)} of the coming season. The league ruled before a game has been played.`,
    1,
    (s) => !s.star,
  ),
  L2(
    (s) =>
      `The league gave ${s.who} ${games(s.games)}, longer than his last suspension, for a fight away from the stadium. It is his ${nth(s.bans)} ruling in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L2(
    (s) =>
      `${s.who}, a rookie, has been suspended for ${games(s.games)} by the league before he has played a game, after a fight away from the stadium.`,
    2,
    (s) => s.rookie,
  ),
];
const OFF_AFTER: readonly Line<Off>[] = [
  L2(
    (s) => `He will miss the season opener ${openerWhere(s)}.`,
    1,
    (s) => !!s.opener && s.games === 1,
  ),
  L2(
    (s) => `He will miss the first ${w(s.games)} games, starting with the opener ${openerWhere(s)}.`,
    2,
    (s) => !!s.opener && s.games > 1,
  ),
  L2(
    (s) => `${c(s.club)} open the season ${openerWhere(s)}, and he will not be there.`,
    1,
    (s) => !!s.opener,
  ),
  L2((s) => `He will begin serving it with the first game ${c(s.club)} play this season.`),
];
function L2<S>(text: (s: S) => string, reads = 0, when?: (s: S) => boolean): Line<S> {
  return { text, reads, ...(when ? { when } : {}) };
}
const OFF_HEAD: readonly Line<Off & { last: string }>[] = [
  { text: (s) => `${s.last} suspended ${games(s.games)} before the season` },
  { text: (s) => `${s.last} will miss ${s.games === 1 ? 'the opener' : `the first ${games(s.games)}`}`, reads: 0 },
  { text: (s) => `League suspends ${s.last} after a fight`, reads: 0 },
];

/** A suspension ruled in the offseason, as a big-day story: what the league did, and the game he starts the season out of. */
export function conductOffseasonStory(
  l: League,
  c0: { key: string; clubId: number; playerId: number; n?: number; tier: 1 | 2 | 3 | 4 | 5 },
  at: Wording,
  kicker: string,
): EditionStory {
  const p = l.players[c0.playerId];
  const club = c0.clubId;
  const opener = l.games.find((g) => g.season === l.season && g.week === 1 && (g.homeId === club || g.awayId === club));
  const entries = p.discipline?.entries ?? [];
  const s: Off = {
    id: p.id,
    club,
    who: `${posWord(p)} ${M(p.id)}`,
    star: publicRecord(l).why(p) !== null || draftedHigh(l, p),
    rookie: p.experience === 0,
    games: c0.n ?? 1,
    bans: entries.filter((e) => e.outcome === 'suspended' && e.season >= l.season - 1).length,
    opener: opener
      ? { opp: opener.homeId === club ? opener.awayId : opener.homeId, home: opener.homeId === club }
      : null,
  };
  const lede = pick(l, OFF_LEDE, s, at, c0.key, 'lede');
  const after = pick(l, OFF_AFTER, s, at, c0.key, 'after');
  const ref = referrer(l, { playerIds: [p.id] });
  const paragraphs = [lede, after].map((t) => resolveTokens(t, ref));
  at.said.push(...paragraphs.flatMap((t) => sentencesOf(t)));
  const head = pick(l, OFF_HEAD, { ...s, last: p.lastName }, at, c0.key, 'head');
  return {
    key: c0.key,
    kind: 'conduct',
    angle: 'banFight',
    tier: c0.tier,
    clubId: club,
    kicker,
    headline: head,
    summary: sentencesOf(paragraphs[0]).slice(0, 2).join(' '),
    picture: { playerId: p.id },
    cast: [p.id],
    numbers: [{ value: String(s.games), label: s.games === 1 ? 'Game' : 'Games' }],
    paragraphs,
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: club },
    ],
  };
}
