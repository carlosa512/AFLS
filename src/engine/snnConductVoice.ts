/**
 * The words of SNN's stories about players in trouble and players doing good (`snnConduct.ts` chooses them, this
 * writes them). Every sentence is a whole line written by hand with slots only for facts (a name, a team, a number,
 * a place) and chosen by a condition on public facts through `say` (`voice.ts`): the most specific that fits, a stable
 * tie-break, none said before this league year. `say` takes only the most specific group that fits, so each cell a story
 * commonly lands in (an ejection for fighting that won or lost the game, a fine, a ruling off the field) holds several
 * lines with different openings. A story is two paragraphs: what happened and why, then what it means and what is
 * next. The tone stops at a fight and a missed curfew, and a man's character is never named: only what he did. No line
 * claims a weekday, a time of year or a record the sim does not hold, and a good deed never carries the team's record.
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
import { draw, spellOrdinal, speaks, type QuoteMoment } from './playerQuote';
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
  /** No quote at all (a tile). */
  quote?: false;
  brief?: true;
  /** The player may speak though no head coach does (a good deed has no word from the coach). */
  voice?: true;
}

// ───────── tokens and small words ─────────

const M = (id: number) => `{M:${id}}`;
const C = (id: number) => `{C:${id}}`;
const c = (id: number) => `{c:${id}}`;
/** A team's bare nickname ("Squall"): write the article yourself. */
const N = (id: number) => `{N:${id}}`;
/**
 * Tokens as a story prints them. The story's own team is named one way throughout (its nickname: "the Tarpons"), never
 * by nickname in one sentence and by city in the next; any other team is a city, or the referrer's choice.
 */
const resolveTokens = (text: string, ref: ReturnType<typeof referrer>, own: { id: number; name: string }) =>
  text
    .replace(/\{(M|C|c|N):(\d+)\}/g, (_, kind: string, n: string) => {
      const id = Number(n);
      if (id === own.id && kind !== 'M') return kind === 'N' ? own.name : `the ${own.name}`;
      if (kind === 'N') {
        ref.club(id);
        return ref.nickname(id);
      }
      return kind === 'M' ? ref.man(id) : kind === 'c' ? ref.city(id) : ref.club(id);
    })
    .replace(/(^|[.?!] )([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
const menIn = (text: string) => [...text.matchAll(/\{M:(\d+)\}/g)].map((m) => Number(m[1]));
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const w = (n: number) => (Number.isInteger(n) && n >= 0 && n < SMALL.length ? SMALL[n] : String(n));
const nth = (n: number) => (n >= 1 && n < 100 ? spellOrdinal(n) : ordinal(n));
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
  /** One of the three captains his team named this year. */
  captain: boolean;
  angle: string;
  /** The round he was drafted in by this team this year, or 0. */
  round: number;
  /** His seasons with the club, this one counted. */
  seasons: number;
  nth: number;
  bans: number;
  /** Games of the ruling, and the games still to miss as of the edition. */
  games: number;
  left: number;
  fined: boolean;
  prior: { fine: boolean; ban: boolean };
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
  age: number;
  /** His seasons in the league, this one counted. */
  exp: number;
  /** When and in what round this team drafted him, in any year, or null. */
  drafted: { season: number; round: number } | null;
  /** What last season's record said of him, as the rest of a sentence about him ("was named All-League last season"), or ''. */
  honor: string;
  /** In a good story: a place, a count of teammates, an event. */
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

function sheetOf(l: League, cand: Candidate): Sheet {
  const x = cand.conduct!;
  const p = l.players[x.playerId];
  const club = cand.clubId;
  const asOf = x.asOf;
  const game = x.gameId === undefined ? undefined : l.games.find((g) => g.id === x.gameId);
  const home = game?.homeId === club;
  const r = game?.result;
  const [us, them] = !r ? [0, 0] : home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  // The record and the next game are the edition's: a story told a week late is told from this week.
  const now = through(l, Math.max(1, asOf));
  const records = computeRecords(now);
  const row = records.get(club)!;
  const table = divisionStandings(now, records)[l.teams[club].division];
  const nextGame = l.games
    .filter((g) => g.season === l.season && g.week > asOf && (g.homeId === club || g.awayId === club))
    .sort((a, b) => a.week - b.week)[0];
  const seasons = Object.entries(p.statTeams ?? {}).filter(
    ([s, ids]) => Number(s) <= l.season && ids.includes(club),
  ).length;
  const caps = l.teams[club].captains;
  return {
    id: p.id,
    club,
    pos: posWord(p),
    who: `${posWord(p)} ${M(p.id)}`,
    star: x.star,
    rookie: p.experience === 0,
    angle: x.angle,
    captain: !!caps && (caps.offense === p.id || caps.defense === p.id || caps.specialTeams === p.id),
    round: p.draft && p.draft.season === l.season && p.draft.teamId === club ? p.draft.round : 0,
    seasons: Math.max(1, seasons),
    nth: x.nth,
    bans: x.bans,
    games: x.games ?? 1,
    // A man already part way through it (a story told a week late) has less left to miss.
    left: p.suspension ? p.suspension.games : x.week < asOf ? 0 : (x.games ?? 1),
    fined: x.outcome === 'leagueFine',
    prior: x.prior,
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
          bye: nextGame.week > asOf + 1,
        }
      : null,
    fact: factOf(l, p),
    age: p.age,
    exp: p.experience + 1,
    drafted: p.draft && p.draft.teamId === club ? { season: p.draft.season, round: p.draft.round } : null,
    honor: '',
    place: PLACES[hash(`${cand.key}:place`) % PLACES.length],
    mates: 4 + (hash(`${cand.key}:mates`) % 9),
    event: EVENTS[hash(`${cand.key}:event`) % EVENTS.length],
  };
}

// ───────── phrases ─────────

const qtrIn = (s: Sheet) => (s.qtr > 4 ? 'in overtime' : `in the ${QUARTER[s.qtr]} quarter`);
/** Where his team's game was: "at home against Denver", "at Denver". */
const where = (s: Sheet) => (s.home ? `at home against ${c(s.opp)}` : `at ${c(s.opp)}`);
const nextWhere = (s: Sheet) =>
  !s.next ? '' : s.next.home ? `at home against ${c(s.next.opp)}` : `at ${c(s.next.opp)}`;
const gw = (s: Sheet) => games(s.games);
/** The same length as an adjective: "a two-game suspension". */
const gwAdj = (s: Sheet) => `${s.games === 1 ? 'one' : w(s.games)}-game`;
const score = (s: Sheet) => `${s.ws}–${s.ls}`;
const lost = (s: Sheet) => s.won === false;
const won = (s: Sheet) => s.won === true;
/** What the league did, after the man is named: "fined him", "suspended him for two games". */
const him = (s: Sheet) => (s.fined ? 'fined him' : `suspended him for ${gw(s)}`);

type Bank<S = Sheet> = readonly Line<S>[];
function L<S = Sheet>(text: (s: S) => string, reads = 0, when?: (s: S) => boolean): Line<S> {
  return { text, reads, ...(when ? { when } : {}) };
}

// ───────── what happened: the lede ─────────

/**
 * What the league did, as a sentence of its own that names the man (a sentence with no name in it is the same in every
 * story, and one said rules out every line that holds it): four ways to say it, so a bank's lines do not share one.
 */
const RULED: readonly ((s: Sheet) => string)[] = [
  (s) => (s.fined ? `The league fined ${M(s.id)}.` : `The league suspended ${M(s.id)} for ${gw(s)}.`),
  (s) => (s.fined ? `${M(s.id)} was fined by the league.` : `${M(s.id)} was suspended by the league for ${gw(s)}.`),
  (s) => (s.fined ? `The league gave ${M(s.id)} a fine.` : `The league gave ${M(s.id)} a ${gwAdj(s)} suspension.`),
  (s) => (s.fined ? `The league fined ${M(s.id)} for it.` : `The league ruled ${M(s.id)} out for ${gw(s)}.`),
];

const FIGHT: Bank = [
  L((s) => `The league suspended ${s.who} for ${gw(s)}. He was ejected ${qtrIn(s)} ${where(s)} for fighting.`),
  L((s) => `${s.who} was ejected for fighting ${qtrIn(s)} ${where(s)}, and the league has suspended him for ${gw(s)}.`),
  L((s) => `${s.who} will miss ${gw(s)} after a fight ${qtrIn(s)} ${where(s)}. The league reviewed his ejection.`),
  L((s) => `${s.who} will sit out ${gw(s)} after the league ruled on his ejection for fighting ${where(s)}.`),
  L(
    (s) =>
      `The league gave ${s.who} a ${gwAdj(s)} suspension for fighting ${qtrIn(s)} ${where(s)}, where he was ejected.`,
  ),
  // A game his team lost, a game it won, and a name: each its own cell, with several lines.
  L(
    (s) =>
      `${s.who} was ejected for fighting ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. ${RULED[0](s)}`,
    1,
    lost,
  ),
  L(
    (s) => `In a ${score(s)} loss ${where(s)}, ${s.who} was thrown out ${qtrIn(s)} for fighting. ${RULED[1](s)}`,
    1,
    lost,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} after he was ejected for fighting in a ${score(s)} loss ${where(s)}.`,
    1,
    lost,
  ),
  L(
    (s) =>
      `${s.who} was thrown out for fighting ${qtrIn(s)} ${where(s)}, and ${c(s.club)} still won ${score(s)}. ${RULED[2](s)}`,
    1,
    won,
  ),
  L(
    (s) =>
      `${c(s.club)} won ${score(s)} ${where(s)}, but ${s.who} did not finish it. He was ejected ${qtrIn(s)} for fighting, and the league suspended him for ${gw(s)}.`,
    1,
    won,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} after he was ejected for fighting in a ${score(s)} win ${where(s)}.`,
    1,
    won,
  ),
  L(
    (s) =>
      `${c(s.club)} will be without ${s.who} for ${gw(s)}. He was ejected for fighting ${qtrIn(s)} ${where(s)}, and the league suspended him.`,
    1,
    (s) => s.star && s.won === null,
  ),
  L(
    (s) =>
      `${s.who} is suspended for ${gw(s)}. The league ruled after he was ejected for fighting ${qtrIn(s)} ${where(s)}.`,
    1,
    (s) => s.star && s.won === null,
  ),
  L(
    (s) =>
      `${s.who} will serve a ${gwAdj(s)} suspension. He was ejected for fighting ${where(s)}, his ${nth(s.nth)} ejection this season.`,
    2,
    (s) => s.nth >= 2,
  ),
  L(
    (s) =>
      `${s.who} has now been thrown out of ${w(s.nth)} games this season. This one was for fighting ${where(s)}, and the league suspended him for ${gw(s)}.`,
    2,
    (s) => s.nth >= 2,
  ),
  L(
    (s) =>
      `The league gave ${s.who} a ${gwAdj(s)} suspension, longer than his last, for fighting ${qtrIn(s)} ${where(s)}. It is his ${nth(s.bans)} suspension in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} for fighting ${where(s)}, longer than his last suspension. That makes ${w(s.bans)} suspensions for ${M(s.id)} in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
];

const TWO: Bank = [
  L((s) =>
    s.fined
      ? `The league fined ${s.who} after he was ejected ${qtrIn(s)} ${where(s)}. It was his second unsportsmanlike conduct penalty of the game.`
      : `The league suspended ${s.who} for ${gw(s)}. He was ejected ${qtrIn(s)} ${where(s)} after his second unsportsmanlike conduct penalty.`,
  ),
  L(
    (s) =>
      `${s.who} picked up two unsportsmanlike conduct penalties ${where(s)} and was ejected ${qtrIn(s)}. ${RULED[0](s)}`,
  ),
  L((s) => `Two unsportsmanlike conduct penalties got ${s.who} ejected ${qtrIn(s)} ${where(s)}. ${RULED[1](s)}`),
  L(
    (s) =>
      `${s.who} was ejected ${qtrIn(s)} ${where(s)} for a second unsportsmanlike conduct penalty, and the league ${him(s)}.`,
  ),
  L((s) => `After ${s.who} was ejected ${where(s)} for two unsportsmanlike conduct penalties, the league ${him(s)}.`),
  L((s) => `${s.who} was ejected ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. ${RULED[2](s)}`, 1, lost),
  L(
    (s) =>
      `${c(s.club)} lost ${score(s)} ${where(s)}, and ${s.who} was ejected ${qtrIn(s)} after two unsportsmanlike conduct penalties. ${RULED[3](s)}`,
    1,
    lost,
  ),
  L(
    (s) =>
      `In a ${score(s)} loss ${where(s)}, a second unsportsmanlike conduct penalty got ${s.who} ejected, and the league ${him(s)}.`,
    1,
    lost,
  ),
  L(
    (s) =>
      `${s.who} was ejected ${qtrIn(s)} ${where(s)} for a second unsportsmanlike conduct penalty, though ${c(s.club)} went on to win ${score(s)}. ${RULED[1](s)}`,
    1,
    won,
  ),
  L(
    (s) =>
      `${c(s.club)} won ${score(s)} ${where(s)}, but ${s.who} was ejected ${qtrIn(s)} after two unsportsmanlike conduct penalties. ${RULED[2](s)}`,
    1,
    won,
  ),
  L(
    (s) =>
      `A second unsportsmanlike conduct penalty got ${s.who} ejected in a ${score(s)} win ${where(s)}. ${RULED[3](s)}`,
    1,
    won,
  ),
  L(
    (s) =>
      `It was the second ejection of the season for ${s.who}, this time for two unsportsmanlike conduct penalties ${where(s)}. ${RULED[0](s)}`,
    3,
    (s) => s.nth >= 2 && !s.fined,
  ),
  L(
    (s) =>
      `${s.who} has been ejected twice this season. The latest came ${where(s)} after two unsportsmanlike conduct penalties, and the league suspended him for ${gw(s)}.`,
    3,
    (s) => s.nth >= 2 && !s.fined,
  ),
];

const FLAGRANT: Bank = [
  L((s) =>
    s.fined
      ? `The league fined ${s.who} after he was ejected ${qtrIn(s)} ${where(s)} for a flagrant hit.`
      : `The league suspended ${s.who} for ${gw(s)}. He was ejected ${qtrIn(s)} ${where(s)} for a flagrant hit.`,
  ),
  L((s) => `${s.who} was ejected ${qtrIn(s)} ${where(s)} for a hit the officials called flagrant. ${RULED[0](s)}`),
  L((s) => `A hit the officials called flagrant got ${s.who} ejected ${where(s)}. ${RULED[1](s)}`),
  L(
    (s) =>
      `The league ${s.fined ? 'fined' : 'suspended'} ${s.who}${s.fined ? '' : ` for ${gw(s)}`} after a flagrant hit ${qtrIn(s)} ${where(s)} got him ejected.`,
  ),
  L(
    (s) =>
      `A hit the officials called flagrant got ${s.who} thrown out ${qtrIn(s)} ${where(s)}, and ${c(s.club)} lost ${score(s)}. ${RULED[2](s)}`,
    1,
    lost,
  ),
  L(
    (s) =>
      `${c(s.club)} lost ${score(s)} ${where(s)}, and ${s.who} was ejected ${qtrIn(s)} for a flagrant hit. ${RULED[3](s)}`,
    1,
    lost,
  ),
  L(
    (s) => `In a ${score(s)} loss ${where(s)}, ${s.who} was ejected for a flagrant hit, and the league ${him(s)}.`,
    1,
    lost,
  ),
  L(
    (s) =>
      `${s.who} was ejected for a flagrant hit ${qtrIn(s)} ${where(s)}, though ${c(s.club)} held on to win ${score(s)}. ${RULED[1](s)}`,
    1,
    won,
  ),
  L(
    (s) =>
      `${c(s.club)} won ${score(s)} ${where(s)}, but ${s.who} was ejected ${qtrIn(s)} for a flagrant hit. ${RULED[2](s)}`,
    1,
    won,
  ),
  L((s) => `A flagrant hit got ${s.who} ejected in a ${score(s)} win ${where(s)}. ${RULED[3](s)}`, 1, won),
  L(
    (s) => `${s.who} was ejected for a flagrant hit, his ${nth(s.nth)} ejection of the season. ${RULED[0](s)}`,
    3,
    (s) => s.nth >= 2 && !s.fined,
  ),
];

const FINED = `${w(REVIEW.fouls)} dangerous fouls in ${w(REVIEW.span)} games`;

const FINE: Bank = [
  L(
    (s) =>
      `The league fined ${s.who} after his latest dangerous foul ${where(s)}. It was his ${nth(REVIEW.fouls)} in ${w(REVIEW.span)} games.`,
  ),
  L(
    (s) =>
      `${s.who} was fined by the league for a run of dangerous fouls, ${w(REVIEW.fouls)} of them in ${w(REVIEW.span)} games. ${M(s.id)} was not suspended.`,
  ),
  L(
    (s) =>
      `The league fined ${s.who} for a dangerous foul ${where(s)}, the ${nth(REVIEW.fouls)} he has been flagged for in ${w(REVIEW.span)} games. The league did not suspend ${M(s.id)}.`,
  ),
  L(
    (s) =>
      `${s.who} has been flagged for ${FINED} and was fined for the latest ${where(s)}. The league did not suspend him.`,
  ),
  L((s) => `${s.who} was fined by the league for his hit ${where(s)}. ${M(s.id)} has been flagged for ${FINED}.`),
  L(
    (s) =>
      `${s.who} was fined by the league after another dangerous foul ${where(s)}, a ${score(s)} ${lost(s) ? 'loss' : 'win'}. That makes ${FINED} for ${M(s.id)}.`,
    1,
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
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} after a dangerous foul ${where(s)}, the latest in a run of them.`,
  ),
  L(
    (s) =>
      `${s.who} will sit out ${gw(s)} after the league ruled that his run of dangerous fouls had gone too far. The latest came ${where(s)}.`,
  ),
  L(
    (s) =>
      `${s.who} will miss ${gw(s)} after a dangerous foul ${where(s)}. The league suspended him for the run of them he has had.`,
  ),
  L(
    (s) =>
      `${c(s.club)} will be without ${s.who} for ${gw(s)}. The league suspended him for his pattern of dangerous fouls, the latest of them ${where(s)}.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)} after another dangerous foul ${where(s)}. It had already fined him for a run of them.`,
    2,
    (s) => s.prior.fine && !s.prior.ban,
  ),
  L(
    (s) =>
      `${s.who} was suspended for ${gw(s)} after a dangerous foul ${where(s)}, and the league had fined him for his fouls before. ${c(s.club)} lost that game ${score(s)}.`,
    3,
    (s) => s.prior.fine && !s.prior.ban && lost(s),
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)}, longer than his last suspension. The latest dangerous foul came ${where(s)}, and it is his ${nth(s.bans)} suspension in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) =>
      `${s.who} was suspended for ${gw(s)} after a dangerous foul ${where(s)}. ${c(s.club)} lost that game ${score(s)}.`,
    1,
    lost,
  ),
];

const FIGHT_OFF: Bank = [
  L((s) => `The league suspended ${s.who} for ${gw(s)} after a fight off the field.`),
  L((s) => `${s.who} was in a fight off the field, and the league has suspended him for ${gw(s)}.`),
  L((s) => `${s.who} will miss ${gw(s)} after a fight off the field, the league ruled.`),
  L((s) => `The league ruled that ${s.who} will sit out ${gw(s)} for a fight off the field.`),
  L((s) => `The league gave ${s.who} a ${gwAdj(s)} suspension for a fight off the field.`),
  L(
    (s) =>
      `${c(s.club)} will play without ${s.who} for ${gw(s)}. The league suspended him after a fight off the field.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${gw(s)}, longer than his last suspension, for a fight off the field. It is his ${nth(s.bans)} ruling in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
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
    (s) => !!s.next,
  ),
  L(
    (s) =>
      `${C(s.club)} will play ${nextWhere(s)} without ${s.who}. The team held him out for a violation of team rules.`,
    1,
    (s) => !!s.next,
  ),
  L(
    (s) =>
      `The team held ${s.who} out of its next game for a violation of team rules. ${C(s.club)} will play ${nextWhere(s)} without him.`,
    1,
    (s) => !!s.next && s.rookie,
  ),
];

const SPAT: Bank = [
  L((s) => `${s.who} got into a public argument with someone on his own team this week.`),
  L((s) => `An argument between ${s.who} and someone on his own team spilled into public view this week.`),
  L((s) => `${s.who} took a disagreement with someone on his own team public this week.`),
  L((s) => `${s.who} and someone on the ${N(s.club)} traded words in public this week.`),
  L(
    (s) => `The ${N(s.club)} have a public disagreement to settle, and ${s.who} is part of it.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) => `${s.who} is in the news again, this time for a public argument with someone on his own team.`,
    3,
    (s) => s.again >= 1,
  ),
];

const EVENT: Bank = [
  L((s) => `${s.who} was not at a ${N(s.club)} team event this week.`),
  L((s) => `${s.who} skipped a team event this week.`),
  L((s) => `${s.who} did not turn up for a ${N(s.club)} team event this week.`),
  L((s) => `A ${N(s.club)} team event went ahead this week without ${s.who}.`),
  L(
    (s) =>
      `This is not the first time ${s.who} has been in the news this season. He skipped a ${N(s.club)} team event this week.`,
    3,
    (s) => s.again >= 1,
  ),
  L(
    (s) => `One of the ${N(s.club)} stars, ${s.who}, did not go to a team event this week.`,
    2,
    (s) => s.star,
  ),
];

// ───────── the good side: no record, no weekday ─────────

const COMMUNITY: Bank = [
  L((s) => `${s.who} spent an afternoon at ${s.place} this week, and he brought ${w(s.mates)} teammates with him.`),
  L(
    (s) =>
      `${s.who} led a trip to ${s.place} this week, and ${w(s.mates)} of his ${N(s.club)} teammates went with him.`,
  ),
  L((s) => `${s.who} took ${w(s.mates)} of his teammates to ${s.place} this week.`),
  L(
    (s) =>
      `${s.who} had a game to prepare for and still found the time this week to visit ${s.place} with ${w(s.mates)} of his teammates.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `${s.who}, in his ${nth(s.seasons)} season with ${c(s.club)}, took ${w(s.mates)} teammates to ${s.place} this week.`,
    1,
    (s) => s.seasons >= 4,
  ),
  L(
    (s) => `${s.who}, a rookie, visited ${s.place} this week with ${w(s.mates)} of his teammates.`,
    2,
    (s) => s.rookie,
  ),
  L(
    (s) =>
      `${s.who}, one of the three captains the ${N(s.club)} named, led a visit to ${s.place} this week with ${w(s.mates)} of his teammates.`,
    3,
    (s) => s.captain,
  ),
];

const FAMILY: Bank = [
  L(
    (s) => `${s.who} became a father this week when his son was born.`,
    1,
    (s) => s.event === 'son',
  ),
  L(
    (s) => `${s.who} and his family welcomed a son this week.`,
    1,
    (s) => s.event === 'son',
  ),
  L(
    (s) => `${s.who} became a father this week when his daughter was born.`,
    1,
    (s) => s.event === 'daughter',
  ),
  L(
    (s) => `A daughter was born to ${s.who} this week.`,
    1,
    (s) => s.event === 'daughter',
  ),
  L(
    (s) => `${s.who} got married this week.`,
    1,
    (s) => s.event === 'wedding',
  ),
  L(
    (s) => `${s.who} was married this week, with a few of his ${N(s.club)} teammates there.`,
    1,
    (s) => s.event === 'wedding',
  ),
  L(
    (s) => `${s.who} announced his engagement this week.`,
    1,
    (s) => s.event === 'engaged',
  ),
  L(
    (s) => `${s.who} is engaged, he announced this week.`,
    1,
    (s) => s.event === 'engaged',
  ),
];

const TEAMMATE: Bank = [
  L((s) => `${s.who} is the kind of teammate a locker room wants, and the ${N(s.club)} have one in him.`),
  L((s) => `Few players are as popular in the ${N(s.club)} locker room as ${s.who}.`),
  L(
    (s) => `After ${w(s.seasons)} seasons with ${c(s.club)}, ${s.who} is the teammate other players want next to them.`,
    2,
    (s) => s.seasons >= 5,
  ),
  L(
    (s) =>
      `${s.who} is only a rookie, and he is already one of the most popular players in the ${N(s.club)} locker room.`,
    2,
    (s) => s.rookie,
  ),
  L(
    (s) =>
      `${s.who} is one of the three captains the ${N(s.club)} named this year, and the locker room has few players it would rather have beside it.`,
    3,
    (s) => s.captain,
  ),
];

/** A line about the man's career, for a good story, which has no game behind it. */
const ABOUT: Bank = [
  L(
    (s) => `He is in his ${nth(s.seasons)} season with ${c(s.club)}.`,
    1,
    (s) => s.seasons >= 2,
  ),
  L(
    (s) => `He is in his first season with ${c(s.club)}.`,
    1,
    (s) => s.seasons === 1 && s.round === 0,
  ),
  L(
    (s) => `He is ${s.age} and in his ${nth(s.exp)} season in the league.`,
    1,
    (s) => s.exp >= 3,
  ),
  L(
    (s) => `${c(s.club)} drafted him in the ${nth(s.drafted!.round)} round in ${s.drafted!.season}.`,
    2,
    (s) => !!s.drafted && !s.rookie,
  ),
  L(
    (s) => `He was drafted by ${c(s.club)} in the ${nth(s.round)} round this year.`,
    3,
    (s) => s.rookie && s.round > 0,
  ),
];

/** What the public record says of him: an honor, or the team's own word for him. */
const HONOR: Bank = [
  L(
    (s) => `${M(s.id)} ${s.honor}.`,
    2,
    (s) => !!s.honor,
  ),
  L(
    (s) => `The ${N(s.club)} named ${M(s.id)} one of their three captains this year.`,
    3,
    (s) => s.captain,
  ),
  L(
    (s) => `${M(s.id)} is one of the three captains the ${N(s.club)} named this year.`,
    3,
    (s) => s.captain,
  ),
];

const STAT_WORDS: Record<string, string> = {
  passYds: 'passing yards',
  rushYds: 'rushing yards',
  recYds: 'receiving yards',
  sacks: 'sacks',
  defInt: 'interceptions',
};
/** Last season's honor as the rest of a sentence about a man already named, or ''. */
function honorOf(l: League, p: Player): string {
  const why = publicRecord(l).why(p);
  if (!why) return '';
  return why.kind === 'award'
    ? "won one of the league's awards last season"
    : why.kind === 'allLeague'
      ? 'was named All-League last season'
      : why.kind === 'passer'
        ? 'was the quarterback of a winning team last season'
        : `was in the league's top five in ${STAT_WORDS[why.stat] ?? 'his category'} last season`;
}

// ───────── what it means: what he misses, a fact, where the team stands, what is next ─────────

const MISS: Bank = [
  L(
    (s) => `He will miss the game ${nextWhere(s)}.`,
    0,
    (s) => !!s.next && !s.next.bye && s.left === 1,
  ),
  L(
    (s) => `He will miss the game ${nextWhere(s)} after the bye week.`,
    1,
    (s) => !!s.next?.bye && s.left === 1,
  ),
  L(
    (s) => `He will miss the next ${w(s.left)} games, starting ${nextWhere(s)}.`,
    2,
    (s) => !!s.next && s.left > 1 && !s.next.bye,
  ),
  L(
    (s) => `He will miss the next ${w(s.left)} games, the first of them ${nextWhere(s)} after the bye week.`,
    2,
    (s) => !!s.next?.bye && s.left > 1,
  ),
  L(
    (s) => `${c(s.club)} will play ${nextWhere(s)} without him.`,
    1,
    (s) => !!s.next && !s.next.bye && s.w >= s.l && s.left === 1,
  ),
  L(
    (s) => `The suspension begins with the game ${nextWhere(s)}.`,
    1,
    (s) => !!s.next && !s.next.bye && s.left === 1,
  ),
];

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
    (s) => !s.leading && s.w + s.l > 1 && s.leaderId !== s.opp && s.leaderId !== s.next?.opp,
  ),
  L(
    (s) => `At ${s.rec}, ${c(s.club)} lead the ${s.division}.`,
    2,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `At ${s.rec}, ${c(s.club)} sit behind ${c(s.leaderId)} in the ${s.division}.`,
    2,
    (s) => !s.leading && s.w + s.l > 1 && s.leaderId !== s.opp && s.leaderId !== s.next?.opp,
  ),
];
/** The team was just named: it is "the team" now. */
const STAND_PRON: Bank = [
  L((s) => `The team is ${s.rec}.`),
  L(
    (s) => `The team is ${s.rec} and leads the ${s.division}.`,
    2,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `The team is ${s.rec} and trails ${c(s.leaderId)} in the ${s.division}.`,
    2,
    (s) => !s.leading && s.w + s.l > 1 && s.leaderId !== s.opp && s.leaderId !== s.next?.opp,
  ),
];
/** The record is already said: where the team stands in its division. */
const STAND_NOREC: Bank = [
  L(
    (s) => `${c(s.club)} lead the ${s.division}.`,
    1,
    (s) => s.leading && s.w + s.l > 1,
  ),
  L(
    (s) => `${c(s.club)} trail ${c(s.leaderId)} in the ${s.division}.`,
    1,
    (s) => !s.leading && s.w + s.l > 1 && s.leaderId !== s.opp && s.leaderId !== s.next?.opp,
  ),
];

const ALSO: Bank = [
  L((s) => `${c(s.club)} also held him out of the next game.`),
  L(() => `The team also sat him for its next game.`),
  L(() => `He will not play in the team's next game either, the team said.`),
];

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
/** On a big day of the offseason: the season's first game. */
const OPEN: Bank = [
  L((s) => `${c(s.club)} open the season ${nextWhere(s)}.`),
  L((s) => `The first game of the season for ${c(s.club)} is ${nextWhere(s)}.`),
];

// ───────── headlines and the head coach's word ─────────

interface HeadSheet extends Sheet {
  last: string;
  club_: string;
}
const HEADS: Record<string, readonly Line<HeadSheet>[]> = {
  ejectFight: [
    { text: (s) => `${s.last} suspended ${gw(s)} after ejection for fighting` },
    { text: (s) => `${s.last} gets a ${gwAdj(s)} suspension for fighting`, reads: 0 },
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
    { text: (s) => `${s.club_} ${s.pos} ${s.last} gets a ${gwAdj(s)} suspension`, reads: 0 },
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
    { text: (s) => `${s.last} spends an afternoon at ${s.place}` },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} gives his time away`, reads: 0 },
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
    { text: (s) => `${s.last} is a favorite in the ${s.club_} locker room`, reads: 0 },
    { text: (s) => `${s.club_} ${s.pos} ${s.last} is the teammate everyone wants`, reads: 0 },
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
/** The head coach's word: a fined man (an ejection or a pattern of fouls) gets the fine's, never the suspension's. */
function quoteBank(angle: string, fined: boolean): keyof typeof QUOTES | undefined {
  if (angle === 'sat') return 'sat';
  if (angle === 'fine' || (fined && angle.startsWith('eject'))) return 'fine';
  return ['ejectFight', 'ejectTwo', 'ejectFlagrant', 'ban', 'banFight'].includes(angle) ? 'ban' : undefined;
}

// ───────── the player's own words ─────────

/** The moment a story's player speaks at: a suspension, other trouble (a fine, a team matter, an ejection), or a good deed. */
const momentOf = (angle: string, fined: boolean): QuoteMoment =>
  angle.startsWith('good') ? 'goodSide' : OUT_ANGLES.has(angle) && !fined ? 'suspended' : 'trouble';
/** The angles whose man the league suspends for games. */
const OUT_ANGLES = new Set(['ejectFight', 'ejectTwo', 'ejectFlagrant', 'ban', 'banFight']);
const quoteFacts = (s: Sheet, key: string, at: Wording, angle: string, good: boolean) => ({
  key,
  at,
  games: s.games,
  onField: angle.startsWith('eject') || angle === 'fine' || angle === 'ban',
  // An outburst (a flag, a fight, an argument), a small matter (an event missed, a team sit, an argument) and a league ruling.
  heated: angle !== 'sat' && angle !== 'teamEvent',
  minor: angle === 'sat' || angle === 'spat' || angle === 'teamEvent',
  league: angle !== 'sat' && angle !== 'spat' && angle !== 'teamEvent',
  fined: s.fined || angle === 'fine',
  ...(good
    ? {
        kind:
          angle === 'goodCommunity'
            ? ('community' as const)
            : angle === 'goodFamily'
              ? ('family' as const)
              : ('teammate' as const),
      }
    : {}),
});

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
const OUT = OUT_ANGLES;
/** Sentences after the lede: enough to mean something, few enough to stay one angle. */
const AFTER_MAX = 3;

/** One story from a conduct candidate (a week's edition, or a good deed on a big day when `x.asOf` is 0). */
export function conductStory(l: League, cand: Candidate, at: Wording, opt: Options = {}): EditionStory {
  const x: ConductFacts = cand.conduct!;
  const s = sheetOf(l, cand);
  const p = l.players[s.id];
  const angle = x.angle;
  const good = angle.startsWith('good');
  const offseason = x.asOf === 0;
  const key = cand.key;
  const lede = pick(l, LEDES[angle], s, at, key, 'lede');
  const out = OUT.has(angle) && !s.fined && s.left > 0;
  const sat = angle === 'spat' || angle === 'teamEvent' ? x.outcome === 'sat' : false;
  const miss = out ? pick(l, MISS, s, at, key, 'miss') : sat ? pick(l, ALSO, s, at, key, 'also') : '';
  // A good deed is about the man, the deed and his career: no record, no standing and no next game.
  if (good) s.honor = honorOf(l, p);
  const about = good ? pick(l, ABOUT, s, at, key, 'about') : '';
  // A captain named in the lede is not named again.
  const honor = good ? pick(l, HONOR, { ...s, captain: s.captain && !/captain/.test(lede) }, at, key, 'honor') : '';
  const fact = pick(l, FACT, s, at, key, 'fact');
  // The record said in the lede or the fact is not said again, and a team just named is "the team".
  const saysRec = [lede, fact].some((t) => t.includes(s.rec));
  const named = [lede, miss, about, fact].join(' ').includes(c(s.club));
  const stand =
    offseason || good ? '' : pick(l, saysRec ? STAND_NOREC : named ? STAND_PRON : STAND, s, at, key, 'stand');
  const told = [lede, miss, about, fact, stand].join(' ');
  const next =
    s.next && !out && !good && !told.includes(c(s.next.opp))
      ? pick(l, offseason ? OPEN : NEXT, s, at, key, 'next')
      : '';
  // At most three: what he misses, where the team stands and what is next come first; a season line and a line about
  // the man fill what is left, in the order they read.
  const order = good ? [about, honor, fact] : [miss, stand, next, fact, about];
  const keep = new Set(order.filter(Boolean).slice(0, AFTER_MAX));
  const second = (good ? [about, honor, fact] : [miss, about, fact, stand, next]).filter((t) => t && keep.has(t));
  const first = [lede];
  if (!second.length)
    second.push(
      good
        ? `${M(s.id)} plays for ${c(s.club)}.`
        : offseason
          ? s.next
            ? `${c(s.club)} open the season ${nextWhere(s)}.`
            : `${M(s.id)} plays for ${c(s.club)}.`
          : `${c(s.club)} are ${s.rec}.`,
    );

  const ref = referrer(l, { playerIds: [...new Set([lede, ...second].flatMap(menIn))] });
  const own = { id: s.club, name: l.teams[s.club].name };
  const parts = [...first, ...second].map((t) => resolveTokens(t, ref, own));
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
  // One quote a story: the player it is about, or his head coach. The player speaks in one story of two, and the
  // coach in the other half of the trouble stories (a good one has no word from him).
  const coach = teamCoaches(l, s.club).find((k) => k.role === 'headCoach');
  const bank = quoteBank(angle, s.fined);
  const manSpeaks = (opt.quote !== false || opt.voice) && draw(`${at.editionId}:${key}:who`, 2) !== 0;
  const man = manSpeaks
    ? speaks(l, p, momentOf(angle, s.fined), quoteFacts(s, key, at, angle, good), s.club)
    : undefined;
  // A coach who talks of next week needs a game there: no bye, no season's end, no playoff exit (`s.next`).
  const gameNextWeek = !!s.next && !s.next.bye;
  const fresh = bank
    ? QUOTES[bank].filter((t) => !saidAlready(l, at, t) && (gameNextWeek || !/\bnext week\b/i.test(t)))
    : [];
  const quoteLine =
    !man && coach && fresh.length && opt.quote !== false
      ? fresh[hash(`${at.editionId}:${key}:quote`) % fresh.length]
      : '';
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
      : offseason || good
        ? []
        : [{ value: s.rec, label: 'Record' }],
    paragraphs,
    ...(man
      ? { quote: man }
      : quoteLine && coach
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

const OFF_LEDE: Bank<Off> = [
  L(
    (s) =>
      `The league suspended ${s.who} for ${games(s.games)} after a fight off the field. He will serve it when the season begins.`,
  ),
  L(
    (s) =>
      `${c(s.club)} will open the season without ${s.who}. The league suspended him for ${games(s.games)} after a fight off the field.`,
    1,
    (s) => s.star,
  ),
  L(
    (s) =>
      `${s.who} will miss ${games(s.games)} of the coming season after a fight off the field. The league ruled before a game has been played.`,
    1,
    (s) => !s.star,
  ),
  L(
    (s) =>
      `The league suspended ${s.who} for ${games(s.games)}, longer than his last suspension, for a fight off the field. It is his ${nth(s.bans)} ruling in two seasons.`,
    3,
    (s) => s.bans >= 2 && s.games > 1,
  ),
  L(
    (s) =>
      `${s.who}, a rookie, has been suspended for ${games(s.games)} by the league before he has played a game, after a fight off the field.`,
    2,
    (s) => s.rookie,
  ),
];
const OFF_AFTER: Bank<Off> = [
  L(
    (s) => `He will miss the season opener ${openerWhere(s)}.`,
    1,
    (s) => !!s.opener && s.games === 1,
  ),
  L(
    (s) => `He will miss the first ${w(s.games)} games, starting with the opener ${openerWhere(s)}.`,
    2,
    (s) => !!s.opener && s.games > 1,
  ),
  L(
    (s) => `${c(s.club)} open the season ${openerWhere(s)}, and he will not be there.`,
    1,
    (s) => !!s.opener,
  ),
  L((s) => `He will begin serving it with the first game ${c(s.club)} play this season.`),
];
const OFF_HEAD: Bank<Off & { last: string }> = [
  L((s) => `${s.last} suspended ${games(s.games)} before the season`),
  L((s) => `${s.last} will miss ${s.games === 1 ? 'the opener' : `the first ${games(s.games)}`}`),
  L((s) => `League suspends ${s.last} after a fight`),
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
  const paragraphs = [lede, after].map((t) => resolveTokens(t, ref, { id: club, name: l.teams[club].name }));
  at.said.push(...paragraphs.flatMap((t) => sentencesOf(t)));
  const head = pick(l, OFF_HEAD, { ...s, last: p.lastName }, at, c0.key, 'head');
  const quote =
    draw(`${at.editionId}:${c0.key}:who`, 2) === 0
      ? undefined
      : speaks(
          l,
          p,
          'suspended',
          { key: c0.key, at, games: s.games, onField: false, heated: true, league: true },
          club,
        );
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
    ...(quote ? { quote } : {}),
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: club },
    ],
  };
}

/** A good deed on a big day's page: the same banks as the week's, with no record and the season's first game next. */
export function goodDayStory(
  l: League,
  c0: { key: string; clubId: number; playerId: number; tier: 1 | 2 | 3 | 4 | 5; kind: string },
  at: Wording,
): EditionStory {
  const p = l.players[c0.playerId];
  const angle = c0.kind === 'community' ? 'goodCommunity' : c0.kind === 'family' ? 'goodFamily' : 'goodTeammate';
  const cand = {
    key: c0.key,
    kind: 'conduct',
    angle,
    tier: c0.tier,
    clubId: c0.clubId,
    teams: [c0.clubId],
    stakes: 0,
    conduct: {
      playerId: p.id,
      angle,
      week: 0,
      asOf: 0,
      prior: { fine: false, ban: false },
      nth: 0,
      bans: 0,
      again: 0,
      star: publicRecord(l).why(p) !== null || draftedHigh(l, p),
    },
  } as Candidate;
  return conductStory(l, cand, at, { quote: false, voice: true });
}
