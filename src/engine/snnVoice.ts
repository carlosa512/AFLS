/**
 * The words of SNN's weekly edition: one story from one candidate (`snnWeek.ts`), in a beat writer's voice. A story does
 * four jobs in order (what happened, why, what it means, what is next) and its angle decides which facts fill them.
 * Every sentence is a line chosen by a condition on public facts through `say` (`voice.ts`): the most specific that
 * fits, a stable tie-break, none said before this league year. Spec §3 has the writing rules; `storyRules.ts` holds the
 * ones a test can.
 *
 * Lines name people and clubs with tokens (`{M:12}`, `{C:3}`) and `resolve` turns them into names in the order the
 * story reads, so a man's first mention is his full name whichever lines were chosen.
 */
import { weeklyAwards, HONOR_SLOTS } from './awards';
import { teamCoaches } from './coaching';
import { injuryLabel } from './injuries';
import { cap, possessive, referrer, type Referrer } from './refer';
import { divisionStandings, computeRecords, type TeamRecord } from './season/standings';
import { startsOf, type Unit } from './slump';
import type { Claim, ClubContext } from './snnColumn';
import { CUT, type ClubRecord, type GameFacts } from './snnStory';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import type { Candidate } from './snnWeek';
import type { EditionScore, EditionStory, Game, GameResult, InboxAction, League, Player, StatLine } from './types';
import { around, say, sentencesOf, stableHash, type Line } from './voice';

// ───────── names as tokens ─────────

const M = (id: number) => `{M:${id}}`;
/** A club: its nickname the first time, its city after. */
const C = (id: number) => `{C:${id}}`;
/** A club by its short form whatever came before. */
const c = (id: number) => `{c:${id}}`;
/** A club's bare nickname, for "the 7–1 Squall": it counts as the club's first mention. */
const N = (id: number) => `{N:${id}}`;

/** Names for tokens, in reading order, then a capital at the start of each sentence. */
function resolve(text: string, ref: Referrer): string {
  const named = text.replace(/\{(M|C|c|N):(\d+)\}/g, (_, kind: string, n: string) => {
    const id = Number(n);
    if (kind === 'N') {
      ref.club(id);
      return ref.nickname(id);
    }
    return kind === 'M' ? ref.man(id) : kind === 'c' ? ref.city(id) : ref.club(id);
  });
  return named.replace(/(^|[.?!] )([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
}
/** Every man a text names, in order. */
const menIn = (text: string) => [...text.matchAll(/\{M:(\d+)\}/g)].map((m) => Number(m[1]));

// ───────── small words ─────────

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** A count as a beat writer writes it: words under ten. */
const w = (n: number) => (Number.isInteger(n) && n >= 0 && n < 10 ? SMALL[n] : String(n));
const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const NTH2 = ['eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth'];
const nth = (n: number) => NTH[n] ?? NTH2[n - 11] ?? `${n}th`;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
/** A yardage total as it is printed: 2,924. */
const num = (n: number) => n.toLocaleString('en-US');
const POSITION: Record<string, string> = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'wide receiver',
  TE: 'tight end',
  OL: 'offensive lineman',
  DT: 'defensive tackle',
  EDGE: 'edge rusher',
  LB: 'linebacker',
  CB: 'cornerback',
  S: 'safety',
  K: 'kicker',
  P: 'punter',
};
const rec = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
const QUARTER = ['', 'first', 'second', 'third', 'fourth'];
/** "Torn ACL" as a sentence has it: "a torn ACL", "a concussion", "back spasms". */
function injuryPhrase(type: string): string {
  const label = injuryLabel(type);
  const lower = /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
  if (/[^s]s$/.test(lower)) return lower;
  return `${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

// ───────── the league around a story ─────────

/** The league as it stood once `week` was played. */
const through = (l: League, week: number): League => ({
  ...l,
  games: l.games.filter((g) => g.season !== l.season || g.week <= week),
});

interface Standing {
  row: TeamRecord;
  place: number;
  division: string;
  /** Games ahead of second for a leader, behind the leader otherwise. */
  gap: number;
  leaderId: number;
}
function standingOf(l: League, week: number, teamId: number): Standing {
  const now = through(l, week);
  const table = divisionStandings(now, computeRecords(now))[l.teams[teamId].division];
  const rows = table.teams;
  const i = rows.findIndex((r) => r.teamId === teamId);
  const behind = (a: TeamRecord, b: TeamRecord) => (a.w - b.w + (b.l - a.l)) / 2;
  const gap = i === 0 ? (rows[1] ? behind(rows[0], rows[1]) : 0) : behind(rows[0], rows[i]);
  return { row: rows[i], place: i + 1, division: table.division.name, gap, leaderId: rows[0].teamId };
}
const games = (n: number) =>
  n === 0.5
    ? 'half a game'
    : n === 1
      ? 'a game'
      : Number.isInteger(n)
        ? `${w(n)} games`
        : `${w(Math.floor(n))} and a half games`;

/**
 * Where a club stands after the week, in a sentence. `form` picks one of three ways in, so a page of stories does not
 * open every such sentence alike; `won` (true, false, or null for a tie or a week off) lets one of them say what the
 * result did.
 */
function standingLine(l: League, week: number, teamId: number, form: number, won: boolean | null): string {
  const s = standingOf(l, week, teamId);
  const id = c(teamId);
  if (week > 18) return `${id} are ${rec(s.row)}.`;
  // A week into the season a place in the table says nothing yet.
  if (week === 1) return '';
  const where =
    s.place === 1
      ? s.gap > 0
        ? `lead the ${s.division} by ${games(s.gap)}`
        : `share the lead in the ${s.division}`
      : s.gap === 0
        ? `are level with ${c(s.leaderId)} at the top of the ${s.division}`
        : `are ${games(s.gap)} behind ${c(s.leaderId)} in the ${s.division}`;
  const are = where.startsWith('are ') ? where.slice(4) : where;
  // After "leaves them at 5–4": one sentence, so nothing nameless is left to be said twice in a season.
  const tail =
    s.place === 1
      ? s.gap > 0
        ? `, ${games(s.gap)} clear in the ${s.division}`
        : ` and level at the top of the ${s.division}`
      : s.gap === 0
        ? `, level with ${c(s.leaderId)} at the top of the ${s.division}`
        : `, ${games(s.gap)} behind ${c(s.leaderId)} in the ${s.division}`;
  switch (won === null ? form % 2 : form % 3) {
    case 0:
      return `${id} are ${rec(s.row)} and ${are}.`;
    case 1:
      return `At ${rec(s.row)}, ${id} ${where}.`;
    default:
      return `The ${won ? 'win' : 'loss'} leaves ${id} at ${rec(s.row)}${tail}.`;
  }
}

/** A club's next game after `week`: who, and where. */
function nextOf(l: League, teamId: number, week: number): { oppId: number; home: boolean; week: number } | null {
  const g = l.games
    .filter((x) => x.season === l.season && x.week > week && (x.homeId === teamId || x.awayId === teamId))
    .sort((a, b) => a.week - b.week)[0];
  return g ? { oppId: g.homeId === teamId ? g.awayId : g.homeId, home: g.homeId === teamId, week: g.week } : null;
}
/** "Minnesota go to San Francisco next." for one club, or both of a game's. `form` picks one of three ways in. */
function nextLine(l: League, week: number, ids: number[], form = 0): string {
  const parts = ids.flatMap((id) => {
    const n = nextOf(l, id, week);
    if (!n) return [];
    const bye = n.week > week + 1;
    const plays = n.home ? `host ${c(n.oppId)}` : `go to ${c(n.oppId)}`;
    return [{ text: `${c(id)} ${bye ? `have a bye and then ${plays}` : plays}`, n, id, bye }];
  });
  if (!parts.length) return '';
  const [a, b] = parts;
  // "next" says nothing after "have a bye and then".
  const next = (x: (typeof parts)[number]) => `${x.text}${x.bye ? '' : ' next'}`;
  if (!b) return `${next(a)}.`;
  // A week off in the sentence is enough to carry: it takes the plain form.
  switch (a.bye || b.bye ? 0 : form % 3) {
    case 0:
      return `${next(a)}. ${b.bye ? b.text : next(b)}.`.replace(/ next\. (.*) next\.$/, ' next. $1.');
    case 1:
      return `Next, ${a.text} and ${b.text}.`;
    default:
      return a.n.home ? `${c(a.n.oppId)} visit ${c(a.id)} next, and ${b.text}.` : `${a.text} next, and ${b.text}.`;
  }
}

const headCoach = (l: League, teamId: number) => teamCoaches(l, teamId).find((x) => x.role === 'headCoach');

/** A weekly award this man won in the last four weeks, as a clause: "the conference's Offensive Player of the Week two weeks ago". */
function recentAward(l: League, playerId: number, week: number): string {
  const weeks = weeklyAwards(l, l.season)?.weeks ?? {};
  for (let back = 1; back <= 4; back++) {
    const slot = (weeks[week - back] ?? []).findIndex((x) => x?.playerId === playerId);
    if (slot < 0) continue;
    const side = HONOR_SLOTS[slot]?.side === 'defense' ? 'Defensive' : 'Offensive';
    const when = back === 1 ? 'last week' : `${w(back)} weeks ago`;
    return `the conference's ${side} Player of the Week ${when}`;
  }
  return '';
}

// ───────── a game's sheet: everything a line may read ─────────

interface GameSheet {
  l: League;
  g: Game;
  r: GameResult;
  f: GameFacts;
  week: number;
  /** Winner and loser; the home and away clubs on a tie. */
  W: number;
  L: number;
  ws: number;
  ls: number;
  margin: number;
  score: string;
  /** The score as a sentence about the result says it: "52–45 in overtime" when it went there. */
  final: string;
  wBefore: ClubRecord;
  lBefore: ClubRecord;
  wq: number[];
  lq: number[];
  wT: GameResult['home'];
  lT: GameResult['home'];
  day?: { p: Player; s: StatLine; mark: keyof typeof CUT.day; value: number; won: boolean; phrase: string };
  qb?: { starter: Player; backup: Player; backupLine: StatLine; teamId: number; injury: string; quarter: string };
  /** The loser's passer when he was picked off twice or more, and who ran one back. */
  picked?: { p: Player; ints: number; sacked: number; returnedBy?: Player };
  /** The winner's passer and best runner, for a story with no bigger why. */
  passer?: { p: Player; s: StatLine };
  runner?: { p: Player; s: StatLine };
  /** The club the story is told for (the reader's, in his club's story). */
  focus: number;
}

function tdPhrase(s: StatLine): string {
  const [a, b] = [s.rushTd ?? 0, s.recTd ?? 0];
  const other = (s.krTd ?? 0) + (s.prTd ?? 0) + (s.defTd ?? 0);
  if (a && b && !other) {
    if (b === 1) return `ran for ${w(a)} ${plural(a, 'touchdown')} and caught ${a === 2 ? 'a third' : 'another'}`;
    if (a === 1) return `caught ${w(b)} touchdown passes and ran for ${b === 2 ? 'a third' : 'another'}`;
    return `ran for ${w(a)} touchdowns and caught ${w(b)}`;
  }
  if (a && !b && !other) return `ran for ${w(a)} touchdowns`;
  if (b && !a && !other) return `caught ${w(b)} touchdown passes`;
  return `scored ${w(a + b + other)} touchdowns`;
}
function dayPhrase(mark: keyof typeof CUT.day, value: number, s: StatLine): string {
  switch (mark) {
    case 'td':
      return tdPhrase(s);
    case 'scrimmage': {
      const td = (s.rushTd ?? 0) + (s.recTd ?? 0);
      return `gained ${value} yards from scrimmage${td >= 2 ? ` and scored ${w(td)} touchdowns` : ''}`;
    }
    case 'passYds':
      return `threw for ${num(value)} yards${(s.passTd ?? 0) >= 2 ? ` and ${w(s.passTd!)} touchdowns` : ''}`;
    case 'passTd':
      return `threw ${w(value)} touchdown passes`;
    case 'sacks':
      return `had ${w(value)} sacks`;
    case 'int':
      return `intercepted ${w(value)} passes`;
  }
}

function gameSheet(l: League, cand: Candidate, focus: number): GameSheet {
  const f = cand.game!;
  const g = l.games.find((x) => x.id === f.gameId)!;
  const r = g.result!;
  const homeWon = r.homeScore >= r.awayScore;
  const [W, L] = homeWon ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
  const [ws, ls] = homeWon ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  const [wT, lT] = homeWon ? [r.home, r.away] : [r.away, r.home];
  const [wq, lq] = homeWon ? [r.quarters.home, r.quarters.away] : [r.quarters.away, r.quarters.home];
  const [wBefore, lBefore] = homeWon ? [f.before.home, f.before.away] : [f.before.away, f.before.home];
  const lines = Object.entries(r.playerStats).map(([id, s]) => ({
    id: Number(id),
    s,
    team: r.playerTeams[Number(id)],
  }));
  const man = (id: number) => l.players[id];
  const sheet: GameSheet = {
    l,
    g,
    r,
    f,
    week: f.week,
    W,
    L,
    ws,
    ls,
    margin: ws - ls,
    score: `${ws}–${ls}`,
    final: `${ws}–${ls}${r.overtime && ws !== ls ? ' in overtime' : ''}`,
    wBefore,
    lBefore,
    wq,
    lq,
    wT,
    lT,
    focus,
  };
  if (f.day && man(f.day.playerId)) {
    const s = r.playerStats[f.day.playerId];
    sheet.day = {
      p: man(f.day.playerId),
      s,
      mark: f.day.mark,
      value: f.day.value,
      won: f.day.teamId === W && ws !== ls,
      phrase: dayPhrase(f.day.mark, f.day.value, s),
    };
  }
  if (f.qbLost && man(f.qbLost.starterId) && man(f.qbLost.backupId)) {
    const hurt = (r.injuries ?? []).find((i) => i.playerId === f.qbLost!.starterId)!;
    sheet.qb = {
      starter: man(f.qbLost.starterId),
      backup: man(f.qbLost.backupId),
      backupLine: r.playerStats[f.qbLost.backupId],
      teamId: f.qbLost.teamId,
      injury: injuryPhrase(hurt.type),
      quarter: QUARTER[hurt.quarter] ?? 'fourth',
    };
  }
  const loserPasser = lines
    .filter((x) => x.team === L && (x.s.passInt ?? 0) >= 2 && man(x.id))
    .sort((a, b) => (b.s.passAtt ?? 0) - (a.s.passAtt ?? 0))[0];
  if (loserPasser && ws !== ls) {
    const back = lines.find((x) => x.team === W && (x.s.defTd ?? 0) > 0 && (x.s.defInt ?? 0) > 0 && man(x.id));
    sheet.picked = {
      p: man(loserPasser.id),
      ints: loserPasser.s.passInt!,
      sacked: loserPasser.s.sacked ?? 0,
      returnedBy: back ? man(back.id) : undefined,
    };
  }
  const best = (team: number, key: 'passAtt' | 'rushYds') =>
    lines
      .filter((x) => x.team === team && (x.s[key] ?? 0) > 0 && man(x.id))
      .sort((a, b) => (b.s[key] ?? 0) - (a.s[key] ?? 0))[0];
  const p = best(W, 'passAtt');
  if (p) sheet.passer = { p: man(p.id), s: p.s };
  const ru = best(W, 'rushYds');
  if (ru && (ru.s.rushYds ?? 0) >= 100) sheet.runner = { p: man(ru.id), s: ru.s };
  return sheet;
}

type GL = Line<GameSheet>;
const line = (text: (s: GameSheet) => string, when?: (s: GameSheet) => boolean, reads = when ? 1 : 0): GL => ({
  text,
  when,
  reads,
});
const beat = (s: GameSheet) =>
  s.margin <= 3 ? 'edged' : s.margin <= 8 ? 'held off' : s.margin >= CUT.rout ? 'routed' : 'beat';
const streakLen = (s: GameSheet) => Math.abs(s.f.streak?.length ?? 0);
/** Where a comeback turned: the quarter the winner was furthest behind, and the score from there on. */
function turn(s: GameSheet): { w: number; l: number; after: string; rest: string } {
  const upTo = (q: number[], n: number) => q.slice(0, n).reduce((a, b) => a + b, 0);
  let at = 1;
  for (const n of [1, 2, 3]) if (upTo(s.lq, n) - upTo(s.wq, n) > upTo(s.lq, at) - upTo(s.wq, at)) at = n;
  return {
    w: s.ws - upTo(s.wq, at),
    l: s.ls - upTo(s.lq, at),
    after: ['', 'the first quarter', 'halftime', 'the third quarter'][at],
    rest: ['', 'the last three quarters', 'the second half', 'the fourth quarter'][at],
  };
}

// ───────── what happened ─────────

const LEDE: Record<GameFacts['angle'], GL[]> = {
  day: [
    line(
      (s) =>
        `${M(s.day!.p.id)}, ${s.day!.p.age} and in his ${nth(s.day!.p.experience + 1)} season, ${s.day!.phrase} as ${C(s.W)} beat ${C(s.L)} ${s.final}.`,
      (s) => s.day!.won && s.day!.p.age >= 31,
      3,
    ),
    line(
      (s) => `Rookie ${M(s.day!.p.id)} ${s.day!.phrase} as ${C(s.W)} beat ${C(s.L)} ${s.final}.`,
      (s) => s.day!.won && s.day!.p.experience === 0,
      3,
    ),
    line(
      (s) => `${M(s.day!.p.id)} ${s.day!.phrase} as ${C(s.W)} beat ${C(s.L)} ${s.final}.`,
      (s) => s.day!.won,
      2,
    ),
    line(
      (s) => `${C(s.W)} beat ${C(s.L)} ${s.final} behind ${M(s.day!.p.id)}, who ${s.day!.phrase}.`,
      (s) => s.day!.won,
      2,
    ),
    line(
      (s) => `${M(s.day!.p.id)} ${s.day!.phrase}, and ${C(s.W)} beat ${C(s.L)} ${s.final}.`,
      (s) => s.day!.won,
      2,
    ),
    line(
      (s) => `${M(s.day!.p.id)} ${s.day!.phrase} for ${C(s.L)}, who still lost ${s.final} to ${C(s.W)}.`,
      (s) => !s.day!.won && s.ws !== s.ls,
      2,
    ),
    line(
      (s) =>
        `${C(s.W)} beat ${C(s.L)} ${s.final} on a day when ${M(s.day!.p.id)} ${s.day!.phrase} for the losing side.`,
      (s) => !s.day!.won && s.ws !== s.ls,
      2,
    ),
    line((s) => `${M(s.day!.p.id)} ${s.day!.phrase} in a ${s.final} tie between ${C(s.W)} and ${C(s.L)}.`),
  ],
  unbeatenFalls: [
    line((s) => `${C(s.L)} lost for the first time this season, ${s.final} to ${C(s.W)}.`),
    line((s) => `${C(s.W)} beat ${C(s.L)} ${s.final} and ended their unbeaten start at ${w(s.lBefore.w)} games.`),
    line((s) => `${C(s.L)} had won all ${w(s.lBefore.w)} of their games. ${C(s.W)} beat them ${s.final}.`),
  ],
  winlessWins: [
    line((s) => `${C(s.W)} won for the first time this season, ${s.final} over ${C(s.L)}.`),
    line((s) => `After ${w(s.wBefore.l)} straight losses to open the season, ${C(s.W)} beat ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.W)} beat ${C(s.L)} ${s.final} for their first win in ${w(s.wBefore.l + 1)} games.`),
  ],
  upset: [
    line((s) => `${C(s.W)}, ${rec(s.wBefore)} coming in, beat the ${rec(s.lBefore)} ${N(s.L)} ${s.final}.`),
    line((s) => `${C(s.W)} were ${rec(s.wBefore)} and ${C(s.L)} were ${rec(s.lBefore)}. ${c(s.W)} won ${s.final}.`),
    line((s) => `${C(s.L)} came in at ${rec(s.lBefore)} and lost ${s.final} to ${C(s.W)}, who were ${rec(s.wBefore)}.`),
  ],
  tie: [
    line((s) => `${C(s.W)} and ${C(s.L)} tied ${s.score}.`),
    line((s) => `Overtime settled nothing between ${C(s.W)} and ${C(s.L)}, who finished ${s.score}.`),
  ],
  streakEnds: [
    line(
      (s) => `${C(s.W)} beat ${C(s.L)} ${s.final} and ended their winning streak at ${w(streakLen(s))}.`,
      (s) => s.f.streak!.length > 0,
      1,
    ),
    line(
      (s) => `${C(s.L)} had won ${w(streakLen(s))} in a row. ${C(s.W)} beat them ${s.final}.`,
      (s) => s.f.streak!.length > 0,
      1,
    ),
    line(
      (s) => `${C(s.W)} beat ${C(s.L)} ${s.final} and ended a run of ${w(streakLen(s))} straight losses.`,
      (s) => s.f.streak!.length < 0,
      1,
    ),
    line(
      (s) => `After ${w(streakLen(s))} losses in a row, ${C(s.W)} beat ${C(s.L)} ${s.final}.`,
      (s) => s.f.streak!.length < 0,
      1,
    ),
  ],
  comeback: [
    line((s) => `${C(s.W)} trailed by ${s.f.deficit} and beat ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.W)} came from ${s.f.deficit} points down to beat ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.L)} led by ${s.f.deficit} and lost ${s.final} to ${C(s.W)}.`),
  ],
  yardage: [
    line((s) => `${C(s.L)} gained ${-s.f.yards!} more yards than ${C(s.W)} and lost ${s.final}.`),
    line((s) => `${C(s.W)} were outgained by ${-s.f.yards!} yards and beat ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.W)} beat ${C(s.L)} ${s.final} with ${-s.f.yards!} fewer yards.`),
  ],
  qbLost: [
    line(
      (s) =>
        `${C(s.qb!.teamId)} lost quarterback ${M(s.qb!.starter.id)} to ${s.qb!.injury} in the ${s.qb!.quarter} quarter and ${s.qb!.teamId === s.W ? 'still beat' : 'lost to'} ${C(s.qb!.teamId === s.W ? s.L : s.W)} ${s.final}.`,
      (s) => s.ws !== s.ls,
      1,
    ),
    line(
      (s) =>
        `${C(s.W)} beat ${C(s.L)} ${s.final} in a game ${c(s.qb!.teamId)} finished without quarterback ${M(s.qb!.starter.id)}, who left in the ${s.qb!.quarter} quarter with ${s.qb!.injury}.`,
      (s) => s.ws !== s.ls,
      1,
    ),
    line(
      (s) =>
        `${C(s.qb!.teamId)} lost quarterback ${M(s.qb!.starter.id)} to ${s.qb!.injury} in the ${s.qb!.quarter} quarter of a ${s.final} tie.`,
    ),
  ],
  rout: [
    line((s) => `${C(s.W)} beat ${C(s.L)} ${s.final} and led after every quarter.`),
    line((s) => `${C(s.W)} routed ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.L)} never led in a ${s.final} loss to ${C(s.W)}.`),
  ],
  overtime: [
    line((s) => `${C(s.W)} beat ${C(s.L)} ${s.score} in overtime.`),
    line((s) => `${C(s.W)} needed overtime to beat ${C(s.L)} ${s.score}.`),
  ],
  result: [
    line((s) => `${C(s.W)} ${beat(s)} ${C(s.L)} ${s.final}.`),
    line((s) => `${C(s.W)} won ${s.final} over ${C(s.L)}.`),
    line((s) => `${C(s.L)} lost ${s.final} to ${C(s.W)}.`),
  ],
};

// ───────── headlines ─────────

const last = (p: Player) => p.lastName;
const nick = (s: GameSheet, id: number) => s.l.teams[id].name;
const town = (s: GameSheet, id: number) => {
  const t = s.l.teams[id];
  return s.l.teams.filter((x) => x.city === t.city).length > 1 ? `the ${t.name}` : t.city;
};
const dayHead = (s: GameSheet): string => {
  const d = s.day!;
  switch (d.mark) {
    case 'td':
      return `scores ${w(d.value)}`;
    case 'scrimmage':
      return `gains ${d.value} yards`;
    case 'passYds':
      return `throws for ${d.value}`;
    case 'passTd':
      return `throws ${w(d.value)} touchdowns`;
    case 'sacks':
      return `has ${w(d.value)} sacks`;
    case 'int':
      return `picks off ${w(d.value)}`;
  }
};
const HEAD: Record<GameFacts['angle'], GL[]> = {
  day: [
    line(
      (s) => `${last(s.day!.p)}, ${s.day!.p.age}, ${dayHead(s)} as the ${nick(s, s.W)} beat ${town(s, s.L)}`,
      (s) => s.day!.won && s.day!.p.age >= 31,
      2,
    ),
    line(
      (s) => `${last(s.day!.p)} ${dayHead(s)} as the ${nick(s, s.W)} beat ${town(s, s.L)}`,
      (s) => s.day!.won,
      1,
    ),
    line(
      (s) => `${last(s.day!.p)} ${dayHead(s)} in the ${possessive(nick(s, s.W))} ${s.score} win`,
      (s) => s.day!.won,
      1,
    ),
    line(
      (s) => `${last(s.day!.p)} ${dayHead(s)} and the ${nick(s, s.L)} still lose`,
      (s) => !s.day!.won && s.ws !== s.ls,
      1,
    ),
    line((s) => `${last(s.day!.p)} ${dayHead(s)} in a ${s.score} tie`),
  ],
  unbeatenFalls: [
    line((s) => `${nick(s, s.L)} lose for the first time`),
    line((s) => `${nick(s, s.W)} hand the ${nick(s, s.L)} their first loss`),
  ],
  winlessWins: [
    line((s) => `${nick(s, s.W)} win for the first time`),
    line((s) => `${nick(s, s.W)} get their first win, ${s.score} over ${town(s, s.L)}`),
  ],
  upset: [
    line((s) => `${nick(s, s.W)}, ${rec(s.wBefore)}, beat the ${rec(s.lBefore)} ${nick(s, s.L)}`),
    line((s) => `The ${rec(s.wBefore)} ${nick(s, s.W)} beat the ${rec(s.lBefore)} ${nick(s, s.L)}`),
  ],
  tie: [line((s) => `${nick(s, s.W)} and ${nick(s, s.L)} tie, ${s.score}`)],
  streakEnds: [
    line(
      (s) => `${nick(s, s.W)} end the ${possessive(nick(s, s.L))} run at ${w(streakLen(s))}`,
      (s) => s.f.streak!.length > 0,
      1,
    ),
    line(
      (s) => `${nick(s, s.W)} win after ${w(streakLen(s))} straight losses`,
      (s) => s.f.streak!.length < 0,
      1,
    ),
  ],
  comeback: [
    line((s) => `${nick(s, s.W)} come from ${s.f.deficit} down to beat the ${nick(s, s.L)}`),
    line((s) => `${nick(s, s.L)} lead by ${s.f.deficit} and lose to ${town(s, s.W)}`),
  ],
  yardage: [
    line((s) => `${nick(s, s.L)} outgain ${town(s, s.W)} by ${-s.f.yards!} yards and lose`),
    line((s) => `${nick(s, s.W)} win with ${-s.f.yards!} fewer yards`),
  ],
  qbLost: [
    line(
      (s) =>
        `${last(s.qb!.starter)} hurt as the ${nick(s, s.qb!.teamId)} ${s.qb!.teamId === s.W ? 'beat' : 'lose to'} ${town(s, s.qb!.teamId === s.W ? s.L : s.W)}`,
    ),
  ],
  rout: [
    line((s) => `${nick(s, s.W)} rout the ${nick(s, s.L)}, ${s.score}`),
    line((s) => `${nick(s, s.W)} lead all day and beat ${town(s, s.L)} ${s.score}`),
  ],
  overtime: [line((s) => `${nick(s, s.W)} beat the ${nick(s, s.L)} in overtime`)],
  result: [
    line((s) => `${nick(s, s.W)} beat the ${nick(s, s.L)}, ${s.score}`),
    line((s) => `${nick(s, s.W)} ${s.margin <= 3 ? 'edge' : s.margin <= 8 ? 'hold off' : 'beat'} ${town(s, s.L)}`),
  ],
};

// ───────── why ─────────

/** One sentence each, most telling first. A story takes the first two its angle has not already said. */
const WHY: { id: string; skip?: GameFacts['angle'][]; when: (s: GameSheet) => boolean; bank: GL[] }[] = [
  {
    id: 'qb',
    skip: ['qbLost'],
    when: (s) => !!s.qb,
    bank: [
      line(
        (s) =>
          `${c(s.qb!.teamId)} lost quarterback ${M(s.qb!.starter.id)} to ${s.qb!.injury} in the ${s.qb!.quarter} quarter.`,
      ),
      line(
        (s) =>
          `Quarterback ${M(s.qb!.starter.id)} left in the ${s.qb!.quarter} quarter with ${s.qb!.injury} and ${c(s.qb!.teamId)} played on without him.`,
      ),
    ],
  },
  {
    id: 'backup',
    when: (s) => !!s.qb && (s.qb.backupLine.passYds ?? 0) > 0,
    bank: [
      line((s) => `${M(s.qb!.backup.id)} threw for ${s.qb!.backupLine.passYds} yards in relief.`),
      line((s) => `${M(s.qb!.backup.id)} came in and threw for ${s.qb!.backupLine.passYds} yards.`),
      line(
        (s) => `Rookie ${M(s.qb!.backup.id)} threw for ${s.qb!.backupLine.passYds} yards in relief.`,
        (s) => s.qb!.backup.experience === 0,
        2,
      ),
    ],
  },
  {
    id: 'picked',
    when: (s) => !!s.picked,
    bank: [
      line(
        (s) =>
          `${M(s.picked!.p.id)} threw ${w(s.picked!.ints)} interceptions, one of them run back for a touchdown by ${M(s.picked!.returnedBy!.id)}, and was sacked ${w(s.picked!.sacked)} times.`,
        (s) => !!s.picked!.returnedBy && s.picked!.sacked >= 4,
        3,
      ),
      line(
        (s) =>
          `${M(s.picked!.p.id)} threw ${w(s.picked!.ints)} interceptions and ${M(s.picked!.returnedBy!.id)} ran one of them back for a touchdown.`,
        (s) => !!s.picked!.returnedBy,
        2,
      ),
      line(
        (s) =>
          `${M(s.picked!.p.id)} threw ${w(s.picked!.ints)} interceptions and was sacked ${w(s.picked!.sacked)} times.`,
        (s) => s.picked!.sacked >= 4,
        2,
      ),
      line((s) => `${M(s.picked!.p.id)} threw ${w(s.picked!.ints)} interceptions.`),
      line(
        (s) =>
          `${c(s.W)} intercepted ${M(s.picked!.p.id)} ${s.picked!.ints === 2 ? 'twice' : `${w(s.picked!.ints)} times`}.`,
      ),
    ],
  },
  {
    id: 'turnovers',
    when: (s) => s.ws !== s.ls && s.lT.turnovers >= 3 && !s.picked,
    bank: [
      line((s) => `${c(s.L)} gave the ball away ${w(s.lT.turnovers)} times.`),
      line((s) => `${c(s.L)} turned it over ${w(s.lT.turnovers)} times.`),
    ],
  },
  {
    // How a comeback turned: the score from the quarter it was furthest behind.
    id: 'turn',
    when: (s) => s.f.angle === 'comeback' && s.ws !== s.ls,
    bank: [
      line((s) => `${c(s.W)} outscored them ${turn(s).w}–${turn(s).l} after ${turn(s).after}.`),
      line((s) => `${c(s.W)} won ${turn(s).rest} ${turn(s).w}–${turn(s).l}.`),
    ],
  },
  {
    id: 'scoreless',
    when: (s) => s.ws === s.ls && s.r.overtime && (s.wq[4] ?? 0) === 0 && (s.lq[4] ?? 0) === 0,
    bank: [line(() => `Neither side scored in overtime.`)],
  },
  {
    id: 'comeback',
    skip: ['comeback'],
    when: (s) => s.f.fits.includes('comeback'),
    bank: [
      line((s) => `${c(s.W)} trailed by ${s.f.deficit} before turning it around.`),
      line((s) => `${c(s.L)} led by ${s.f.deficit} at one point.`),
    ],
  },
  {
    id: 'fourth',
    when: (s) =>
      s.ws !== s.ls && s.f.angle !== 'comeback' && (s.wq[3] ?? 0) >= 14 && (s.wq[3] ?? 0) - (s.lq[3] ?? 0) >= 10,
    bank: [
      line((s) => `${c(s.W)} closed with ${s.wq[3]} points in the fourth quarter.`),
      line((s) => `${c(s.W)} scored ${s.wq[3]} points in the fourth quarter.`),
    ],
  },
  {
    id: 'yards',
    skip: ['yardage'],
    when: (s) => s.f.fits.includes('yardage'),
    bank: [line((s) => `${c(s.L)} outgained ${c(s.W)} by ${-s.f.yards!} yards.`)],
  },
  {
    id: 'sacks',
    when: (s) => s.ws !== s.ls && s.lT.sacked >= 5 && !(s.picked && s.picked.sacked >= 4),
    bank: [
      line((s) => `${c(s.W)} had ${w(s.lT.sacked)} sacks.`),
      line((s) => `${c(s.W)} sacked the quarterback ${w(s.lT.sacked)} times.`),
    ],
  },
  {
    id: 'day',
    skip: ['day'],
    when: (s) => !!s.day,
    bank: [
      line((s) => `${M(s.day!.p.id)} ${s.day!.phrase} for ${c(s.day!.won ? s.W : s.L)}.`),
      line((s) => `For ${c(s.day!.won ? s.W : s.L)}, ${M(s.day!.p.id)} ${s.day!.phrase}.`),
    ],
  },
  {
    id: 'runner',
    when: (s) => !!s.runner && s.runner.p.id !== s.day?.p.id,
    bank: [
      line((s) => `${M(s.runner!.p.id)} ran for ${s.runner!.s.rushYds} yards for ${c(s.W)}.`),
      line((s) => `${c(s.W)} got ${s.runner!.s.rushYds} rushing yards from ${M(s.runner!.p.id)}.`),
    ],
  },
  {
    id: 'passer',
    when: (s) => !!s.passer && s.passer.p.id !== s.day?.p.id && (s.passer.s.passYds ?? 0) >= 220 && s.ws !== s.ls,
    bank: [
      line(
        (s) =>
          `${M(s.passer!.p.id)} threw for ${s.passer!.s.passYds} yards and ${w(s.passer!.s.passTd ?? 0)} ${plural(s.passer!.s.passTd ?? 0, 'touchdown')} for ${c(s.W)}.`,
        (s) => (s.passer!.s.passTd ?? 0) >= 1,
        1,
      ),
      line((s) => `${M(s.passer!.p.id)} threw for ${s.passer!.s.passYds} yards for ${c(s.W)}.`),
    ],
  },
  {
    id: 'possession',
    when: (s) => s.ws !== s.ls && s.wT.top >= 35 * 60,
    bank: [line((s) => `${c(s.W)} held the ball for ${clock(s.wT.top)}.`)],
  },
];

// ───────── what it means ─────────

/** One callback at most, from the public record: an award, an earlier meeting, a run. */
function callback(s: GameSheet): string {
  if (s.day) {
    const award = recentAward(s.l, s.day.p.id, s.week);
    if (award) return `${M(s.day.p.id)} was ${award}.`;
  }
  const earlier = s.l.games.find(
    (x) =>
      x.season === s.l.season &&
      x.result &&
      x.week < s.week &&
      !x.playoffRound &&
      x.id !== s.g.id &&
      ((x.homeId === s.W && x.awayId === s.L) || (x.homeId === s.L && x.awayId === s.W)),
  );
  if (earlier && s.ws !== s.ls) {
    const wonFirst =
      (earlier.homeId === s.W) === earlier.result!.homeScore > earlier.result!.awayScore &&
      earlier.result!.homeScore !== earlier.result!.awayScore;
    return wonFirst
      ? `It was the second time ${c(s.W)} have beaten ${c(s.L)} this season.`
      : `${c(s.L)} won the first meeting in Week ${earlier.week}.`;
  }
  if (s.ws !== s.ls && s.lBefore.streak <= -2 && !s.f.fits.includes('winlessWins'))
    return `${c(s.L)} have lost ${w(-s.lBefore.streak + 1)} in a row.`;
  if (s.ws !== s.ls && s.wBefore.streak >= 2 && s.wBefore.streak + 1 !== CUT.streak)
    return `${c(s.W)} have won ${w(s.wBefore.streak + 1)} straight.`;
  return '';
}

// ───────── a quote: the head coach of the story's club, on a fact that is in the story ─────────

interface QuoteSheet extends GameSheet {
  /** The club whose coach speaks. */
  club: number;
}
const won = (s: QuoteSheet) => s.club === s.W && s.ws !== s.ls;
const lost = (s: QuoteSheet) => s.club === s.L && s.ws !== s.ls;
const q = (text: string, when: (s: QuoteSheet) => boolean, reads: number): Line<QuoteSheet> => ({
  text: () => text,
  when,
  reads,
});
/**
 * Plain coach-speak, each line a judgment on a fact its condition reads, never an event the sim did not make. No name
 * and no number in any of them, so the no-repeat rule lets a coach's line be said once a league year by anyone: a quote
 * that comes round again with another man's name in it is the repetition this is built to avoid. When every line that
 * fits has been said, the story runs without one.
 */
const QUOTE: Line<QuoteSheet>[] = [
  q(
    "He's past thirty and he was our best player in the fourth quarter.",
    (s) => won(s) && !!s.day?.won && s.day.p.age >= 31 && (s.wq[3] ?? 0) >= 14,
    4,
  ),
  q('He was the best player on the field today.', (s) => won(s) && !!s.day?.won, 2),
  q('We leaned on him and he delivered.', (s) => won(s) && !!s.day?.won, 2),
  q('He made the plays we needed.', (s) => won(s) && !!s.day?.won, 2),
  q(
    'We kept giving him the ball because nobody was stopping him.',
    (s) => won(s) && !!s.day?.won && (s.day.s.rushAtt ?? 0) >= 20,
    3,
  ),
  q(
    'For a rookie he played like he had been here for years.',
    (s) => won(s) && !!s.day?.won && s.day.p.experience === 0,
    3,
  ),
  q(
    'We moved the ball all day and kept giving it back to them.',
    (s) => lost(s) && s.f.fits.includes('yardage') && s.lT.turnovers >= 3,
    3,
  ),
  q("You don't win when you turn it over that many times.", (s) => lost(s) && s.lT.turnovers >= 3, 2),
  q('We gave them short fields all afternoon.', (s) => lost(s) && s.lT.turnovers >= 3, 2),
  q('We were behind early and kept playing our game.', (s) => won(s) && s.f.fits.includes('comeback'), 2),
  q('Nobody on our sideline panicked when we were behind.', (s) => won(s) && s.f.fits.includes('comeback'), 2),
  q('We had the lead and we let them back in it.', (s) => lost(s) && s.f.fits.includes('comeback'), 2),
  q("It's one win. We needed it.", (s) => won(s) && s.f.fits.includes('winlessWins'), 2),
  q(
    'We were not going to win them all. We have to play better than that.',
    (s) => lost(s) && s.f.fits.includes('unbeatenFalls'),
    2,
  ),
  q(
    'We have played better than our record. Today it showed on the scoreboard.',
    (s) => won(s) && s.f.fits.includes('upset'),
    2,
  ),
  q('We knew we could play with them.', (s) => won(s) && s.f.fits.includes('upset'), 2),
  q('We lost to a team that played harder than we did.', (s) => lost(s) && s.f.fits.includes('upset'), 2),
  q('We will know more about him this week.', (s) => !!s.qb && s.club === s.qb.teamId, 2),
  q(
    'You lose your quarterback and the plan changes. We did not adjust well enough.',
    (s) => !!s.qb && s.club === s.qb.teamId && lost(s),
    3,
  ),
  q(
    'The streak was going to end some time. I would rather it ended in a better game than that.',
    (s) => lost(s) && s.f.angle === 'streakEnds' && s.f.streak!.length > 0,
    3,
  ),
  q(
    'That one has been a long time coming for this group.',
    (s) => won(s) && s.f.angle === 'streakEnds' && s.f.streak!.length < 0,
    3,
  ),
  q('We were ahead early and stayed there.', (s) => won(s) && s.f.fits.includes('rout'), 1),
  q('We were second best in every part of that game.', (s) => lost(s) && s.f.fits.includes('rout'), 1),
  q('We could not protect the quarterback, and it showed.', (s) => lost(s) && s.lT.sacked >= 6, 2),
  q('Our front won that game.', (s) => won(s) && s.lT.sacked >= 6, 2),
];

// ───────── assembling a game story ─────────

interface Wording {
  editionId: string;
  said: string[];
}
/** A line as it reads once everyone in it has been named: surnames and cities. A full-name telling of it contains this. */
function shortened(l: League, text: string): string {
  const ref = referrer(l, { playerIds: menIn(text) });
  for (const id of menIn(text)) ref.man(id);
  for (const m of text.matchAll(/\{[CcN]:(\d+)\}/g)) ref.club(Number(m[1]));
  return resolve(text, ref);
}
/** Whether any sentence of this text has been said already this league year, whoever was named first then. */
const saidAlready = (l: League, at: Wording, text: string) => {
  const { skip } = around(l, at.said);
  return skip(text) || skip(shortened(l, text));
};
/**
 * The line for one slot, and a note that it has been said. `once`: nothing at all when every way of saying it has been
 * used (a quote or a callback is better left out than repeated; a story's lede has to be written whatever).
 */
function pickLine<S>(
  l: League,
  bank: readonly Line<S>[],
  sheet: S,
  at: Wording,
  key: string,
  slot: string,
  once = false,
): string {
  // A wording is stepped around when it has been said as written or as it prints once its people have been named
  // (the same passer throwing two interceptions in two games is told two ways).
  const base = around(l, at.said);
  const skip = (t: string) => base.skip(t) || base.skip(shortened(l, t));
  const text = say(bank, sheet, { key: `${at.editionId}:${key}`, slot, skip });
  if (!text || (once && saidAlready(l, at, text))) return '';
  at.said.push(...sentencesOf(text));
  return text;
}
const scoreOf = (g: Game): EditionScore => ({
  gameId: g.id,
  homeId: g.homeId,
  awayId: g.awayId,
  home: g.result!.homeScore,
  away: g.result!.awayScore,
  ...(g.result!.overtime ? { overtime: true as const } : {}),
});
function kickerOf(l: League, ids: number[]): string {
  const [a, b] = ids.map((id) => l.teams[id]);
  if (b && a.division === b.division) return l.divisions[a.division].name;
  const conf = (t: typeof a) => l.conferences[l.divisions[t.division].conference].name;
  return !b || conf(a) === conf(b) ? conf(a) : 'Around the league';
}
function chipsOf(s: GameSheet): EditionStory['numbers'] {
  const out: EditionStory['numbers'] = [];
  const d = s.day;
  if (d && s.f.angle === 'day') {
    const scr = (d.s.rushYds ?? 0) + (d.s.recYds ?? 0);
    const td = (d.s.rushTd ?? 0) + (d.s.recTd ?? 0) + (d.s.krTd ?? 0) + (d.s.prTd ?? 0) + (d.s.defTd ?? 0);
    if (d.mark === 'td' || d.mark === 'scrimmage') {
      out.push({ value: String(scr), label: 'Scrimmage yards' }, { value: String(td), label: plural(td, 'Touchdown') });
      if (d.s.rec) out.push({ value: String(d.s.rec), label: plural(d.s.rec, 'Catch', 'Catches') });
      else if (d.s.rushAtt) out.push({ value: String(d.s.rushAtt), label: 'Carries' });
    } else if (d.mark === 'passYds' || d.mark === 'passTd') {
      out.push(
        { value: String(d.s.passYds ?? 0), label: 'Passing yards' },
        { value: String(d.s.passTd ?? 0), label: 'Touchdowns' },
        { value: `${d.s.passCmp ?? 0}/${d.s.passAtt ?? 0}`, label: 'Passing' },
      );
    } else if (d.mark === 'sacks') {
      out.push({ value: String(d.value), label: 'Sacks' }, { value: String(d.s.tackles ?? 0), label: 'Tackles' });
    } else
      out.push(
        { value: String(d.value), label: 'Interceptions' },
        { value: String(d.s.passDef ?? 0), label: 'Passes defensed' },
      );
    return out.slice(0, 3);
  }
  if (s.f.angle === 'comeback') out.push({ value: String(s.f.deficit), label: 'Points down' });
  // Ours first when the story is told for one club; the winner's first otherwise.
  const [a, b] = s.focus === s.L ? [s.lT, s.wT] : [s.wT, s.lT];
  out.push({ value: `${a.totalYds}–${b.totalYds}`, label: 'Total yards' });
  out.push({ value: `${a.turnovers}–${b.turnovers}`, label: 'Turnovers' });
  if (out.length < 3) out.push({ value: `${a.sacked}–${b.sacked}`, label: 'Sacks allowed' });
  return out.slice(0, 3);
}

export interface StoryOptions {
  /** The reader's club: the story is told for it, and marked his. */
  yours?: number;
  /** The biggest other public thing about the reader's club, told inside his club's story. */
  extra?: Candidate;
  /** False for a tile: only the lead and the reader's club carry a quote, so a page is not a wall of them. */
  quote?: false;
  /**
   * A second story about the reader's club says its news and stops: where the club stands and whom it plays next are
   * in its own story on the same page.
   */
  brief?: true;
}

/**
 * The reader's own club is the subject of its own story: "The Blizzard lost 24–21 to the Outlaws", never the other
 * club's win. Only where the angle is the plain result (a rout, overtime, the score): a run ending, an upset or a
 * man's day reads the same whoever it is told for.
 */
const OWN: GL[] = [
  line(
    (s) => `${C(s.focus)} ${beat(s)} ${C(s.L)} ${s.final}.`,
    (s) => s.focus === s.W,
  ),
  line(
    (s) => `${C(s.focus)} won ${s.final} over ${C(s.L)}.`,
    (s) => s.focus === s.W,
  ),
  line(
    (s) => `${C(s.focus)} beat ${C(s.L)} ${s.final} and led after every quarter.`,
    (s) => s.focus === s.W && s.f.angle === 'rout',
    2,
  ),
  line(
    (s) => `${C(s.focus)} beat ${C(s.L)} ${s.score} in overtime.`,
    (s) => s.focus === s.W && s.f.angle === 'overtime',
    2,
  ),
  line(
    (s) => `${C(s.focus)} lost ${s.final} to ${C(s.W)}.`,
    (s) => s.focus === s.L,
  ),
  line(
    (s) => `${C(s.focus)} were beaten ${s.final} by ${C(s.W)}.`,
    (s) => s.focus === s.L,
  ),
  line(
    (s) => `${C(s.focus)} lost ${s.final} to ${C(s.W)} and trailed after every quarter.`,
    (s) => s.focus === s.L && s.f.angle === 'rout',
    2,
  ),
  line(
    (s) => `${C(s.focus)} lost ${s.score} to ${C(s.W)} in overtime.`,
    (s) => s.focus === s.L && s.f.angle === 'overtime',
    2,
  ),
];
const OWN_HEAD: GL[] = [
  line(
    (s) => `${nick(s, s.focus)} beat ${town(s, s.L)}, ${s.score}`,
    (s) => s.focus === s.W,
  ),
  line(
    (s) => `${nick(s, s.focus)} rout ${town(s, s.L)}, ${s.score}`,
    (s) => s.focus === s.W && s.f.angle === 'rout',
    2,
  ),
  line(
    (s) => `${nick(s, s.focus)} beat ${town(s, s.L)} in overtime`,
    (s) => s.focus === s.W && s.f.angle === 'overtime',
    2,
  ),
  line(
    (s) => `${nick(s, s.focus)} lose ${s.score} to ${town(s, s.W)}`,
    (s) => s.focus === s.L,
  ),
  line(
    (s) => `${nick(s, s.focus)} lose to ${town(s, s.W)} in overtime`,
    (s) => s.focus === s.L && s.f.angle === 'overtime',
    2,
  ),
];
const PLAIN: GameFacts['angle'][] = ['result', 'rout', 'overtime'];

/** What a playoff result means: who goes on, to what, and who is out. */
function playoffLine(s: GameSheet): string {
  switch (s.g.playoffRound) {
    case 'WC':
      return `${c(s.W)} go on to the divisional round, and ${c(s.L)} are out.`;
    case 'DIV':
      return `${c(s.W)} go on to their conference final, and ${c(s.L)} are out.`;
    case 'CONF':
      return `${c(s.W)} will play for the championship, and ${c(s.L)} are out.`;
    default:
      return `${c(s.W)} are the league's champions.`;
  }
}

/**
 * A story's paragraphs: what happened and why as one, what it means and what is next as the other. A sentence to a
 * paragraph reads as a list of points; a story is prose. With nothing for one of the two, the first sentence stands
 * alone and the rest follow it.
 */
function prose(first: string[], second: string[]): string[] {
  const [a, b] = [first.filter(Boolean), second.filter(Boolean)];
  if (a.length && b.length) return [a.join(' '), b.join(' ')];
  const all = [...a, ...b];
  return all.length > 1 ? [all[0], all.slice(1).join(' ')] : all;
}

/**
 * Two short facts as one sentence. A shared subject is said once ("had five sacks and got 130 rushing yards from…"), and
 * a club is not named at the end of one clause and the start of the next. Two sentences that already hold an "and" are
 * left as two: joined, they run on.
 */
export function joined(a: string, b: string): string[] {
  const subjectOf = (x: string) => /^(\{c:\d+\}) /.exec(x)?.[1];
  const forClub = (x: string) => / for (\{c:\d+\})\.$/.exec(x)?.[1];
  const drop = (x: string) => x.replace(/ for \{c:\d+\}\.$/, '.');
  // "For Chicago, …" opens a sentence: after "and" it is no longer the start of one.
  const inside = (x: string) => x.replace(/^For /, 'for ');
  const [sa, sb] = [subjectOf(a), subjectOf(b)];
  if (/ and /.test(a) || / and /.test(b)) {
    // Too long to join. Still no club named at the end of one sentence and the start of the next.
    if (sb && forClub(a) === sb) return [b, drop(a)];
    return [a, sa && forClub(b) === sa ? drop(b) : b];
  }
  // "X threw for 235 yards for Baltimore" then "Baltimore held the ball…": the club's own fact first, his without it.
  if (sb && forClub(a) === sb) return [`${b.replace(/\.$/, '')}, and ${inside(drop(a))}`];
  const second = sa && forClub(b) === sa ? drop(b) : b;
  const head = a.replace(/\.$/, '');
  if (sa && second.startsWith(`${sa} `)) return [`${head} and ${second.slice(sa.length + 1)}`];
  return [`${head}, and ${inside(second)}`];
}

function gameStory(l: League, cand: Candidate, at: Wording, opt: StoryOptions): EditionStory {
  const focus = opt.yours ?? cand.clubId;
  const s = gameSheet(l, cand, focus);
  const a = s.f.angle;
  const own = opt.yours !== undefined && PLAIN.includes(a) && s.ws !== s.ls;
  const lede = pickLine(l, own ? OWN : LEDE[a], s, at, cand.key, 'lede');

  // Why: the two most telling facts the lede has not already used, as one sentence.
  const whys: string[] = [];
  for (const y of WHY) {
    if (whys.length >= 2) break;
    if (y.skip?.includes(a) || !y.when(s)) continue;
    // A backup's line follows the man he replaced: it is not a reason by itself.
    if (y.id === 'backup' && !whys.length && a !== 'qbLost') continue;
    // A reason is optional: one that could only be told in words already used is left out.
    const text = pickLine(l, y.bank, s, at, cand.key, `why:${y.id}`, true);
    if (text) whys.push(text);
  }
  const why =
    whys.length === 2 && sentencesOf(whys[0]).length === 1 && sentencesOf(whys[1]).length === 1
      ? joined(whys[0], whys[1])
      : whys;
  if (opt.extra?.kind === 'starOut' && opt.extra.out) {
    const p = l.players[opt.extra.out.playerId];
    const hurt = (s.r.injuries ?? []).find((i) => i.playerId === p?.id);
    if (p && hurt) {
      const award = recentAward(l, p.id, s.week);
      why.push(
        `${cap(POSITION[p.position] ?? 'player')} ${M(p.id)} left with ${injuryPhrase(hurt.type)} and will miss ${layoffSpan(s.week, hurt.estimate[0])}.${award ? ` He was ${award}.` : ''}`,
      );
    }
  }

  // What it means: where the story's club stands, and one callback. A callback said before is left out.
  const meanId = s.ws === s.ls ? s.W : focus === s.L ? s.L : s.W;
  const form = stableHash(`${at.editionId}:${cand.key}:form`);
  // In the playoffs a record no longer moves: what the result does is send one club on and the other home.
  const stand = s.g.playoffRound
    ? playoffLine(s)
    : standingLine(l, s.week, meanId, form, s.ws === s.ls ? null : meanId === s.W);
  const back = callback(s);
  const means = [stand, back ? pickLine(l, [{ text: () => back }], s, at, cand.key, 'callback', true) : '']
    .filter(Boolean)
    .join(' ');
  // What is next.
  const next = nextLine(l, s.week, focus === s.L ? [s.L, s.W] : [s.W, s.L], form >> 3);
  const raw = prose([lede, ...why], [means, next]);
  // A story has two paragraphs at least: a game with nothing behind it and nothing ahead says where it left them.
  if (raw.length < 2) raw.push(`${c(s.W)} are ${rec(standingOf(l, s.week, s.W).row)}.`);

  const club = opt.yours ?? cand.clubId;
  const coach = headCoach(l, club);
  const quoteText = coach && opt.quote !== false ? pickLine(l, QUOTE, { ...s, club }, at, cand.key, 'quote', true) : '';

  const cast = [...new Set(raw.flatMap(menIn))];
  const ref = referrer(l, { playerIds: cast });
  const paragraphs = raw.map((p) => resolve(p, ref));
  // As printed, so the next story and the next edition step around it.
  at.said.push(...paragraphs.flatMap((p) => sentencesOf(p)));
  const headline = pickLine(l, own ? OWN_HEAD : HEAD[a], s, at, cand.key, 'head');
  const links: InboxAction[] = [{ kind: 'game', gameId: s.g.id }];
  const star = a === 'day' ? s.day?.p : a === 'qbLost' ? s.qb?.starter : undefined;
  if (star) links.push({ kind: 'player', playerId: star.id });
  links.push({ kind: 'team', teamId: focus }, { kind: 'standings' });
  return {
    key: cand.key,
    kind: 'game',
    angle: a,
    tier: cand.tier,
    clubId: cand.clubId,
    ...(opt.yours !== undefined ? { yours: true as const } : {}),
    kicker: kickerOf(l, [s.g.homeId, s.g.awayId]),
    headline,
    // A closed tile: what happened, and the first reason for it when the story has one.
    summary: sentencesOf(paragraphs[0])
      .slice(0, why.length ? 2 : 1)
      .join(' '),
    picture: star ? { playerId: star.id, gameId: s.g.id } : { teamIds: [s.W, s.L], gameId: s.g.id },
    score: scoreOf(s.g),
    cast,
    numbers: chipsOf(s),
    paragraphs,
    ...(quoteText && coach
      ? {
          quote: {
            coachId: coach.id,
            name: `${coach.firstName} ${coach.lastName}`,
            role: `${l.teams[club].name} head coach`,
            text: quoteText,
          },
        }
      : {}),
    links,
  };
}

// ───────── the reader's club on its bye ─────────

function byeStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const id = cand.clubId;
  const week = Number(cand.key.split(':')[2]);
  const st = standingOf(l, week, id);
  const where = standingLine(l, week, id, 0, null).replace(`${c(id)} are`, 'They are');
  const raw = [`${C(id)} did not play this week.${where ? ` ${where}` : ''}`];
  const next = nextLine(l, week, [id]);
  raw.push(next || `${c(id)} have no game left to play.`);
  const ref = referrer(l, { playerIds: [] });
  const paragraphs = raw.map((p) => resolve(p, ref));
  at.said.push(...paragraphs.flatMap((p) => sentencesOf(p)));
  const place = st.place === 1 ? 'lead' : `sit ${nth(st.place)} in`;
  return {
    key: cand.key,
    kind: 'game',
    angle: 'bye',
    tier: 5,
    clubId: id,
    yours: true,
    kicker: st.division,
    headline: `${l.teams[id].name} ${place} the ${st.division} on their bye`,
    summary: paragraphs[0],
    picture: { teamIds: [id] },
    cast: [],
    numbers: [
      { value: rec(st.row), label: 'Record' },
      { value: nth(st.place), label: st.division },
    ],
    paragraphs,
    links: [{ kind: 'standings' }, { kind: 'team', teamId: id }],
  };
}

// ───────── a club's run ─────────

function runStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const run = cand.run!;
  const id = run.teamId;
  const mine = l.games
    .filter((g) => g.season === l.season && !g.playoffRound && g.result && (g.homeId === id || g.awayId === id))
    .sort((a, b) => a.week - b.week);
  const latest = mine.at(-1)!;
  const week = latest.week;
  const opp = latest.homeId === id ? latest.awayId : latest.homeId;
  const [us, them] =
    latest.homeId === id
      ? [latest.result!.homeScore, latest.result!.awayScore]
      : [latest.result!.awayScore, latest.result!.homeScore];
  const n = Math.abs(run.length);
  const span = mine.slice(-n);
  const [pf, pa] = span.reduce(
    ([f, a], g) => {
      const home = g.homeId === id;
      return [
        f + (home ? g.result!.homeScore : g.result!.awayScore),
        a + (home ? g.result!.awayScore : g.result!.homeScore),
      ];
    },
    [0, 0],
  );
  const first: string[] = [];
  let headline: string;
  if (run.faded) {
    headline = `The ${l.teams[id].name} were ${n}–0. They have lost two of three.`;
    first.push(`${C(id)} started ${n}–0 and have lost two of their last three, the latest ${them}–${us} to ${C(opp)}.`);
  } else if (run.length > 0) {
    headline = `${l.teams[id].name} have won ${w(n)} straight`;
    first.push(`${C(id)} beat ${C(opp)} ${us}–${them} for their ${nth(n)} win in a row.`);
    first.push(`They have outscored opponents ${pf}–${pa} in that run.`);
  } else {
    headline = `${l.teams[id].name} have lost ${w(n)} straight`;
    first.push(`${C(id)} lost ${them}–${us} to ${C(opp)}, their ${nth(n)} defeat in a row.`);
    first.push(`They have been outscored ${pa}–${pf} in that run.`);
  }
  const stand = standingLine(l, week, id, stableHash(`${at.editionId}:${cand.key}`), null);
  const next = nextLine(l, week, [id]);
  const raw = prose(first, [stand, next]);
  const ref = referrer(l, { playerIds: [] });
  const paragraphs = raw.map((p) => resolve(p, ref));
  at.said.push(...paragraphs.flatMap((p) => sentencesOf(p)));
  const st = standingOf(l, week, id);
  return {
    key: cand.key,
    kind: 'run',
    angle: cand.angle,
    tier: cand.tier,
    clubId: id,
    kicker: st.division,
    headline,
    summary: sentencesOf(paragraphs[0])[0],
    picture: { teamIds: [id] },
    cast: [],
    numbers: run.faded
      ? [
          { value: rec(st.row), label: 'Record' },
          { value: `${n}–0`, label: 'Start' },
        ]
      : [
          { value: String(n), label: run.length > 0 ? 'Straight wins' : 'Straight losses' },
          { value: `${pf}–${pa}`, label: 'Points in the run' },
          { value: rec(st.row), label: 'Record' },
        ],
    paragraphs,
    links: [{ kind: 'team', teamId: id }, { kind: 'standings' }],
  };
}

// ───────── a star out for the season ─────────

/** The final is played in week 22. */
const FINAL_WEEK = 22;
/**
 * What a layoff costs a man hurt in `week`, from the shortest the doctors expect: his season only when it runs past the
 * final. Hurt late in the year, he may be back for a playoff game, and a story says only what is sure.
 */
export const layoffSpan = (week: number, low: number) =>
  low >= FINAL_WEEK - week ? 'the rest of the season' : 'the rest of the regular season';

function starOutStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const p = l.players[cand.out!.playerId];
  const g = l.games.find((x) => x.id === cand.out!.gameId)!;
  const hurt = g.result!.injuries!.find((i) => i.playerId === p.id)!;
  const id = hurt.teamId;
  const opp = g.homeId === id ? g.awayId : g.homeId;
  const [us, them] =
    g.homeId === id ? [g.result!.homeScore, g.result!.awayScore] : [g.result!.awayScore, g.result!.homeScore];
  const result = us > them ? `${us}–${them} win over` : us < them ? `${them}–${us} loss to` : `${us}–${them} tie with`;
  const tot: Record<string, number> = {};
  let played = 0;
  for (const x of l.games) {
    const sline =
      x.season === l.season && !x.playoffRound && x.week <= g.week ? x.result?.playerStats[p.id] : undefined;
    if (!sline) continue;
    played++;
    for (const k of [
      'passYds',
      'passTd',
      'rushYds',
      'rushTd',
      'rec',
      'recYds',
      'recTd',
      'sacks',
      'tackles',
      'defInt',
    ] as const)
      tot[k] = (tot[k] ?? 0) + (sline[k] ?? 0);
  }
  const did =
    (tot.passYds ?? 0) >= 500
      ? `had thrown for ${num(tot.passYds)} yards and ${tot.passTd ?? 0} touchdowns`
      : (tot.rushYds ?? 0) >= (tot.recYds ?? 0) && (tot.rushYds ?? 0) > 0
        ? `had run for ${num(tot.rushYds)} yards and ${w(tot.rushTd ?? 0)} ${plural(tot.rushTd ?? 0, 'touchdown')}`
        : (tot.recYds ?? 0) > 0
          ? `had ${tot.rec} catches for ${num(tot.recYds)} yards`
          : (tot.sacks ?? 0) > 0
            ? `had ${w(tot.sacks)} ${plural(tot.sacks, 'sack')} and ${tot.tackles ?? 0} tackles`
            : `had ${tot.tackles ?? 0} tackles`;
  const first = [
    `${C(id)} lost ${POSITION[p.position] ?? 'player'} ${M(p.id)} to ${injuryPhrase(hurt.type)} in the ${QUARTER[hurt.quarter] ?? 'fourth'} quarter of their ${result} ${C(opp)}, and he will miss ${layoffSpan(g.week, hurt.estimate[0])}.`,
  ];
  const award = recentAward(l, p.id, g.week);
  first.push(`${M(p.id)} ${did} this season.${award ? ` He was ${award}.` : ''}`);
  const stand = standingLine(l, g.week, id, stableHash(`${at.editionId}:${cand.key}`), null);
  const next = nextLine(l, g.week, [id]);
  const raw = prose(first, [stand, next]);
  const ref = referrer(l, { playerIds: [p.id] });
  const paragraphs = raw.map((x) => resolve(x, ref));
  at.said.push(...paragraphs.flatMap((x) => sentencesOf(x)));
  return {
    key: cand.key,
    kind: 'starOut',
    angle: 'starOut',
    tier: cand.tier,
    clubId: id,
    kicker: standingOf(l, g.week, id).division,
    headline: `${l.teams[id].name} lose ${p.lastName} for the season`,
    summary: sentencesOf(paragraphs[0])[0],
    picture: { playerId: p.id, gameId: g.id },
    cast: [p.id],
    numbers:
      (tot.passYds ?? 0) >= 500
        ? [
            { value: num(tot.passYds), label: 'Passing yards' },
            { value: String(tot.passTd ?? 0), label: 'Touchdowns' },
            { value: String(played), label: plural(played, 'Game') },
          ]
        : (tot.rushYds ?? 0) >= (tot.recYds ?? 0) && (tot.rushYds ?? 0) > 0
          ? [
              { value: num(tot.rushYds), label: 'Rushing yards' },
              { value: String(tot.rushTd ?? 0), label: 'Touchdowns' },
              { value: String(played), label: plural(played, 'Game') },
            ]
          : (tot.recYds ?? 0) > 0
            ? [
                { value: String(tot.rec), label: 'Catches' },
                { value: num(tot.recYds), label: 'Receiving yards' },
                { value: String(played), label: plural(played, 'Game') },
              ]
            : [
                { value: String(tot.sacks ?? 0), label: 'Sacks' },
                { value: String(tot.tackles ?? 0), label: 'Tackles' },
                { value: String(played), label: plural(played, 'Game') },
              ],
    paragraphs,
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: id },
      { kind: 'game', gameId: g.id },
    ],
  };
}

/** What a man has done this season through `week`, from the box scores, as a clause after "has": or '' with nothing to show. */
function seasonSoFar(l: League, playerId: number, week: number): string {
  const tot: Record<string, number> = {};
  for (const x of l.games) {
    const line =
      x.season === l.season && !x.playoffRound && x.week <= week ? x.result?.playerStats[playerId] : undefined;
    if (!line) continue;
    for (const k of ['passYds', 'passTd', 'rushYds', 'rushTd', 'rec', 'recYds', 'sacks', 'tackles', 'defInt'] as const)
      tot[k] = (tot[k] ?? 0) + (line[k] ?? 0);
  }
  if ((tot.passYds ?? 0) >= 300)
    return `thrown for ${num(tot.passYds)} yards and ${w(tot.passTd ?? 0)} ${plural(tot.passTd ?? 0, 'touchdown')}`;
  if ((tot.rushYds ?? 0) >= 100 && (tot.rushYds ?? 0) >= (tot.recYds ?? 0)) return `run for ${num(tot.rushYds)} yards`;
  if ((tot.recYds ?? 0) >= 100) return `caught ${tot.rec} passes for ${num(tot.recYds)} yards`;
  if ((tot.sacks ?? 0) >= 2) return `${w(tot.sacks)} sacks`;
  if ((tot.defInt ?? 0) >= 2) return `intercepted ${w(tot.defInt)} passes`;
  if ((tot.tackles ?? 0) >= 20) return `made ${tot.tackles} tackles`;
  return '';
}
/** Where a club stands, or its bare record a week into the season when a place says nothing yet. */
const placed = (l: League, week: number, teamId: number, form: number) =>
  standingLine(l, week, teamId, form, null) || `${c(teamId)} are ${rec(standingOf(l, week, teamId).row)}.`;
/** How far off the trade deadline is, said once an edition: or '' when it has passed or been said. */
function deadlineLine(l: League, at: Wording, cand: Candidate, week: number): string {
  const left = TRADE_DEADLINE_WEEK - week;
  if (left < 0) return '';
  const text =
    left === 0
      ? `The trade deadline follows the Week ${TRADE_DEADLINE_WEEK + 1} games.`
      : left === 1
        ? 'The trade deadline is a week away.'
        : `The trade deadline is ${w(left)} weeks away.`;
  return pickLine(l, [{ text: () => text }], null, at, cand.key, 'deadline', true);
}

// ───────── the week's other news ─────────

/** A story that is not a game's: its sentences resolved in order, noted as said, and the fields every story has. */
function compose(
  l: League,
  cand: Candidate,
  at: Wording,
  parts: { first: string[]; second: string[]; headline: string; kicker: string } & Pick<
    EditionStory,
    'picture' | 'numbers' | 'links'
  > & { quote?: EditionStory['quote']; summary?: number },
): EditionStory {
  const raw = prose(parts.first, parts.second);
  const cast = [...new Set(raw.flatMap(menIn))];
  const ref = referrer(l, { playerIds: cast });
  const paragraphs = raw.map((x) => resolve(x, ref));
  at.said.push(...paragraphs.flatMap((x) => sentencesOf(x)));
  return {
    key: cand.key,
    kind: cand.kind,
    angle: cand.angle,
    tier: cand.tier,
    clubId: cand.clubId,
    kicker: parts.kicker,
    headline: parts.headline,
    summary: sentencesOf(paragraphs[0])
      .slice(0, parts.summary ?? 2)
      .join(' '),
    picture: parts.picture,
    cast,
    numbers: parts.numbers,
    paragraphs,
    ...(parts.quote ? { quote: parts.quote } : {}),
    links: parts.links,
  };
}
const form = (at: Wording, cand: Candidate) => stableHash(`${at.editionId}:${cand.key}`);
const nickOf = (l: League, id: number) => l.teams[id].name;
const townOf = (l: League, id: number) =>
  l.teams.filter((x) => x.city === l.teams[id].city).length > 1 ? `the ${l.teams[id].name}` : l.teams[id].city;
const lastWord = (name: string) => name.split(' ').at(-1) ?? name;
/** A club's game in a week, from its own side. */
function resultOf(l: League, teamId: number, week: number) {
  const g = l.games.find(
    (x) => x.season === l.season && x.week === week && x.result && (x.homeId === teamId || x.awayId === teamId),
  );
  if (!g) return null;
  const home = g.homeId === teamId;
  const [us, them] = home ? [g.result!.homeScore, g.result!.awayScore] : [g.result!.awayScore, g.result!.homeScore];
  return { g, us, them, oppId: home ? g.awayId : g.homeId };
}

function divisionStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const { leaderId, formerId, week } = cand.division!;
  const st = standingOf(l, week, leaderId);
  const mine = resultOf(l, leaderId, week);
  const theirs = resultOf(l, formerId, week);
  const first: string[] = [];
  if (mine && mine.us > mine.them)
    first.push(
      `${C(leaderId)} took over first place in the ${st.division} with a ${mine.us}–${mine.them} win over ${C(mine.oppId)}.`,
    );
  else if (mine && mine.us < mine.them)
    first.push(
      `${C(leaderId)} moved into first place in the ${st.division} despite a ${mine.them}–${mine.us} loss to ${C(mine.oppId)}.`,
    );
  else first.push(`${C(leaderId)} moved into first place in the ${st.division} without winning this week.`);
  if (theirs && theirs.us < theirs.them && theirs.oppId !== leaderId)
    first.push(`${C(formerId)} gave up the lead with a ${theirs.them}–${theirs.us} loss to ${C(theirs.oppId)}.`);
  else if (theirs?.oppId !== leaderId) first.push(`${C(formerId)} had led the division.`);
  return compose(l, cand, at, {
    first,
    second: [
      standingLine(l, week, leaderId, form(at, cand), null),
      nextLine(l, week, [leaderId, formerId], form(at, cand) >> 3),
    ],
    headline: `${nickOf(l, leaderId)} take first in the ${st.division}`,
    kicker: st.division,
    picture: { teamIds: [leaderId, formerId] },
    numbers: [
      { value: rec(st.row), label: 'Record' },
      {
        value: st.gap ? String(st.gap) : 'Level',
        label: st.gap ? plural(st.gap, 'Game clear', 'Games clear') : 'At the top',
      },
    ],
    links: [{ kind: 'standings' }, { kind: 'team', teamId: leaderId }],
  });
}

function tradeStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const t = cand.trade!;
  const p = l.players[t.playerId];
  const [B, S] = [t.buyerId, t.sellerId];
  const position = POSITION[p.position] ?? 'player';
  const price = t.pick ? `a ${t.pick.season} ${nth(t.pick.round)}-round pick` : t.price.replace(/ \([A-Z]+\)/g, '');
  // What he was to the club that let him go: every game of theirs, when that is so.
  const theirGames = l.games.filter(
    (g) =>
      g.season === l.season &&
      !g.playoffRound &&
      g.result &&
      g.week <= t.deal.week &&
      (g.homeId === S || g.awayId === S),
  );
  const hisGames = theirGames.filter(
    (g) => g.result!.playerTeams[p.id] === S && (g.result!.playerStats[p.id]?.snaps ?? 0) > 0,
  ).length;
  const every =
    theirGames.length >= 3 && hisGames === theirGames.length ? 'who played every game for them this season, ' : '';
  const recS = standingOf(l, t.week, S).row;
  const first: string[] = [];
  let headline: string;
  if (cand.angle === 'secondSale') {
    first.push(
      `${C(S)} are ${rec(recS)} and selling.`,
      `${M(p.id)}, ${p.age}, ${every}went to ${C(B)} for ${price}.`,
      `He is the ${nth(t.earlierSales + 1)} player ${c(S)} have traded away this season.`,
    );
    headline = t.pick
      ? `${nickOf(l, S)} sell ${p.lastName} to ${townOf(l, B)} for a ${nth(t.pick.round)}`
      : `${nickOf(l, S)} sell again, ${p.lastName} to ${townOf(l, B)}`;
  } else if (cand.angle === 'swap') {
    first.push(`${C(B)} and ${C(S)} swapped players, with ${position} ${M(p.id)} going to ${c(B)}.`);
    headline = `${nickOf(l, B)} get ${p.lastName} in a swap with ${townOf(l, S)}`;
  } else if (cand.angle === 'contender') {
    first.push(`${C(B)} added ${position} ${M(p.id)} from ${C(S)} for ${price}.`);
    headline = `${nickOf(l, B)} add ${p.lastName} from ${townOf(l, S)}`;
  } else {
    first.push(`${C(S)} traded ${position} ${M(p.id)} to ${C(B)} for ${price}.`);
    headline = t.pick
      ? `${nickOf(l, S)} sell ${p.lastName} to ${townOf(l, B)} for a ${nth(t.pick.round)}`
      : `${nickOf(l, S)} trade ${p.lastName} to ${townOf(l, B)}`;
  }
  const has = seasonSoFar(l, p.id, t.week);
  if (has) first.push(`${M(p.id)} has ${has} this season.`);
  const window = deadlineLine(l, at, cand, t.week);
  return compose(l, cand, at, {
    first,
    // The standing last: a story ends on a name or a number.
    second: [window, placed(l, t.week, B, form(at, cand))],
    headline,
    kicker: 'Trade',
    picture: { playerId: p.id },
    numbers: [
      { value: String(p.age), label: 'Age' },
      ...(t.pick ? [{ value: `${t.pick.season}`, label: `${cap(nth(t.pick.round))}-round pick` }] : []),
    ],
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: B },
      { kind: 'team', teamId: S },
      { kind: 'trades' },
    ],
  });
}

function rumorStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const r = cand.rumor!;
  const p = l.players[r.playerId];
  const position = POSITION[p.position] ?? 'player';
  // Attributed interest, never an agreement or an offer nobody recorded.
  const lede =
    r.shopping || r.askerId === undefined
      ? `${C(r.clubId)} are listening to offers for ${position} ${M(p.id)}, according to reports.`
      : `${C(r.askerId)} have asked ${C(r.clubId)} about ${position} ${M(p.id)}, according to reports.`;
  return compose(l, cand, at, {
    first: [lede, `${M(p.id)} remains with ${c(r.clubId)}.`],
    second: [deadlineLine(l, at, cand, r.week), placed(l, r.week, r.clubId, form(at, cand))],
    headline:
      r.shopping || r.askerId === undefined
        ? `${nickOf(l, r.clubId)} listening on ${p.lastName}`
        : `${nickOf(l, r.askerId)} ask about ${p.lastName}`,
    kicker: 'Trade talk',
    picture: { playerId: p.id },
    numbers: [{ value: String(p.age), label: 'Age' }],
    links: [{ kind: 'player', playerId: p.id }, { kind: 'team', teamId: r.clubId }, { kind: 'trades' }],
  });
}

function leaderOutStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const x = cand.leader!;
  const id = x.teamId;
  const week = Math.max(
    1,
    ...l.games.filter((g) => g.season === l.season && g.result && !g.playoffRound).map((g) => g.week),
  );
  // The change and the record he leaves. Nothing on whether it was right: this spec reports, it does not judge.
  const lede =
    x.role === 'headCoach'
      ? `${C(id)} dismissed head coach ${x.out}${x.in ? ` and named ${x.in} interim head coach` : ''}.`
      : x.role === 'gm'
        ? `${C(id)} dismissed general manager ${x.out}.${x.in ? ` ${x.in} takes over.` : ''}`
        : `${C(id)} relieved ${x.side} coordinator ${x.out} of his duties.`;
  const st = standingOf(l, week, id);
  return compose(l, cand, at, {
    first: [lede],
    second: [standingLine(l, week, id, form(at, cand), null), nextLine(l, week, [id])],
    headline:
      x.role === 'coordinator'
        ? `${nickOf(l, id)} relieve ${x.side} coordinator ${lastWord(x.out)}`
        : `${nickOf(l, id)} dismiss ${x.role === 'gm' ? 'general manager' : 'head coach'} ${lastWord(x.out)}`,
    kicker: st.division,
    picture: { teamIds: [id] },
    numbers: [{ value: rec(st.row), label: 'Record' }],
    links: [{ kind: 'team', teamId: id }, { kind: 'gms' }],
    summary: 1,
  });
}

const SPOKE: Record<string, { about: string; head: string; quote: string }> = {
  benched: {
    about: 'losing his starting job with',
    head: 'his benching',
    quote: 'I think I am a starter in this league, and I intend to show it.',
  },
  traded: { about: 'being traded by', head: 'his trade', quote: 'I gave that club everything I had.' },
  cut: { about: 'his release by', head: 'his release', quote: 'I never felt I got a real chance there.' },
  snubbed: {
    about: 'the contracts handed out by',
    head: 'his contract',
    quote: 'You look at who gets paid and you draw your own conclusions.',
  },
};
function speakStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const x = cand.speak!;
  const p = l.players[x.playerId];
  const w0 = SPOKE[x.kind] ?? SPOKE.benched;
  const week = Math.max(
    1,
    ...l.games.filter((g) => g.season === l.season && g.result && !g.playoffRound).map((g) => g.week),
  );
  return compose(l, cand, at, {
    first: [
      `${cap(POSITION[p.position] ?? 'player')} ${M(p.id)} spoke out this week about ${w0.about} ${C(x.teamId)}.`,
    ],
    second: [standingLine(l, week, x.teamId, form(at, cand), null), nextLine(l, week, [x.teamId])],
    headline: `${p.lastName} speaks out about ${w0.head}`,
    kicker: standingOf(l, week, x.teamId).division,
    picture: { playerId: p.id },
    numbers: [],
    // His own words are the story: the one player an edition quotes.
    quote: {
      playerId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      role: POSITION[p.position] ?? 'player',
      text: w0.quote,
    },
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: x.teamId },
    ],
    summary: 1,
  });
}

function roomStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const x = cand.room!;
  const week = Math.max(
    1,
    ...l.games.filter((g) => g.season === l.season && g.result && !g.playoffRound).map((g) => g.week),
  );
  const st = standingOf(l, week, x.teamId);
  return compose(l, cand, at, {
    first: [x.text],
    second: [standingLine(l, week, x.teamId, form(at, cand), null), nextLine(l, week, [x.teamId])],
    headline: `Talk of a room slipping away in ${townOf(l, x.teamId)}`,
    kicker: st.division,
    picture: { coachId: x.coachId, teamIds: [x.teamId] },
    numbers: [{ value: rec(st.row), label: 'Record' }],
    links: [{ kind: 'team', teamId: x.teamId }, { kind: 'standings' }],
    summary: 1,
  });
}

function mentorStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const x = cand.mentor!;
  const name = (id: number) => {
    const k = l.coaches[id];
    return k ? `${k.firstName} ${k.lastName}` : 'his old boss';
  };
  const dTeam = l.coaches[x.discipleId]?.teamId ?? x.awayId;
  const mTeam = dTeam === x.homeId ? x.awayId : x.homeId;
  const week = Math.max(
    1,
    ...l.games.filter((g) => g.season === l.season && g.result && !g.playoffRound).map((g) => g.week),
  );
  const [a, b] = [standingOf(l, week, dTeam).row, standingOf(l, week, mTeam).row];
  return compose(l, cand, at, {
    first: [
      `${name(x.discipleId)} of ${C(dTeam)} faces ${name(x.mentorId)} of ${C(mTeam)} next week, the first time the two have met as head coaches.`,
      `He worked under him for years.`,
    ],
    second: [`${c(dTeam)} are ${rec(a)} and ${c(mTeam)} are ${rec(b)}.`, `${c(x.homeId)} are at home.`],
    headline: `${lastWord(name(x.mentorId))} meets his old assistant`,
    kicker: kickerOf(l, [x.homeId, x.awayId]),
    picture: { teamIds: [x.awayId, x.homeId] },
    numbers: [],
    links: [
      { kind: 'team', teamId: dTeam },
      { kind: 'team', teamId: mTeam },
    ],
  });
}

/** One story from one candidate. Every sentence it uses goes onto `at.said`, so an edition never repeats itself. */
export function writeStory(l: League, cand: Candidate, at: Wording, opt: StoryOptions = {}): EditionStory {
  let story = write(l, cand, at, opt);
  if (opt.brief) {
    // What is not printed is not held against the stories after it.
    for (const cut of story.paragraphs.slice(1).flatMap((x) => sentencesOf(x))) {
      const i = at.said.lastIndexOf(cut);
      if (i >= 0) at.said.splice(i, 1);
    }
    story = { ...story, paragraphs: story.paragraphs.slice(0, 1), brief: true };
  }
  return cand.covers?.length ? { ...story, covers: cand.covers } : story;
}
function write(l: League, cand: Candidate, at: Wording, opt: StoryOptions): EditionStory {
  if (cand.kind === 'division') return divisionStory(l, cand, at);
  if (cand.kind === 'trade') return tradeStory(l, cand, at);
  if (cand.kind === 'rumor') return rumorStory(l, cand, at);
  if (cand.kind === 'leaderOut') return leaderOutStory(l, cand, at);
  if (cand.kind === 'speak') return speakStory(l, cand, at);
  if (cand.kind === 'room') return roomStory(l, cand, at);
  if (cand.kind === 'mentor') return mentorStory(l, cand, at);
  if (cand.kind === 'storyline') return storylineStory(l, cand, at);
  if (cand.kind === 'run') return runStory(l, cand, at);
  if (cand.kind === 'starOut') return starOutStory(l, cand, at);
  if (cand.angle === 'bye') return byeStory(l, cand, at);
  return gameStory(l, cand, at, opt);
}

// ───────── the Column ─────────

/**
 * How a unit's number reads in a sentence: what it has done over the span ("have allowed a sack on 9.4% of their
 * dropbacks"), the same in the past for the weeks before it, and the word the Column calls the unit by.
 */
const UNIT_SAYS: Record<Unit, { noun: string; did: (v: string) => string; was: (v: string) => string }> = {
  'offensive line': {
    noun: 'pass protection',
    did: (v) => `have allowed a sack on ${v} of their dropbacks`,
    was: (v) => `allowed a sack on ${v} of their dropbacks`,
  },
  'pass rush': {
    noun: 'pass rush',
    did: (v) => `have sacked the quarterback on ${v} of his dropbacks`,
    was: (v) => `sacked the quarterback on ${v} of his dropbacks`,
  },
  'run game': {
    noun: 'run game',
    did: (v) => `have averaged ${v} yards a carry`,
    was: (v) => `averaged ${v} yards a carry`,
  },
  'run defense': {
    noun: 'run defense',
    did: (v) => `have allowed ${v} yards a carry`,
    was: (v) => `allowed ${v} yards a carry`,
  },
  'passing game': {
    noun: 'passing game',
    did: (v) => `have averaged ${v} yards a pass`,
    was: (v) => `averaged ${v} yards a pass`,
  },
  coverage: {
    noun: 'coverage',
    did: (v) => `have allowed ${v} yards a pass`,
    was: (v) => `allowed ${v} yards a pass`,
  },
};

/** What a Column's line may read: the claim's facts in words, and where its club is in the season. */
interface ColumnSheet {
  id: number;
  rec: string;
  race: ClubContext['race'];
  stage: ClubContext['stage'];
  /** A losing record last season, a winning one, or no last season to go by. */
  lastYear: 'losing' | 'winning' | 'none';
  lastRec: string;
  lastWins: number;
  lastLosses: number;
  /** "five games left", or '' when the regular season is over. */
  left: string;
  /** "at home to {c:4}" or "away to {c:4}", or '' with no game to come. */
  next: string;
  division: string;
  place: number;
  gap: number;
  played: number;
  wins: number;
  spanRec: string;
  // A unit.
  noun: string;
  did: string;
  was: string;
  around: string;
  /** Against the weeks before the span: it got worse, got better, was much the same, or there were too few to say. */
  change: 'worse' | 'better' | 'same' | 'none';
  /** The club was not losing before the span. */
  wasWinning: boolean;
  /** Before the span the unit was already worse than the league has been since. */
  wasPoor: boolean;
  games: number;
  won: number;
  lost: number;
  /** The one man the unit's numbers point at, as a clause after its fact (", and … himself"), or ''. */
  man: string;
  // A man.
  name: string;
  surname: string;
  streak: number;
  /** His seasons in the job at this club, this one included. */
  seasons: number;
  /** Losing seasons finished under a GM. */
  lostSeasons: number;
  /** Winning seasons finished under a GM, and how far the club went last season ("reached their conference final"). */
  wonSeasons: number;
  ran: string;
  coach: string;
  coachSurname: string;
}
type CL = Line<ColumnSheet>;
const col = (text: (s: ColumnSheet) => string, when?: (s: ColumnSheet) => boolean, reads = when ? 1 : 0): CL => ({
  text,
  when,
  reads,
});
/** The games still to play and the next of them, as one clause: "five games left, the next of them at home to Denver". */
const ahead = (s: ColumnSheet) => `${s.left}, the next of them ${s.next}`;
/** Four games are most of what a club has played: only then is the sample the thing to say. */
const early = (s: ColumnSheet) => s.played <= 6 && !!s.left;
const over = (s: ColumnSheet) => !s.left;

/** The last sentence of a Column that finds fault: what is at stake, by the race and the stage of the season. */
const BLAME_STAKES: CL[] = [
  col((s) => `Four games is a small sample, and ${c(s.id)} have ${ahead(s)}, to change it.`, early, 3),
  col(
    (s) => `${c(s.id)} have ${ahead(s)}, and the ${s.noun} has to hold up in them if they are to stay in the race.`,
    (s) => s.race === 'in' && !!s.left,
    2,
  ),
  col(
    (s) =>
      `${c(s.id)} have ${s.left} to get into the playoffs, the next of them ${s.next}, and the ${s.noun} has to be better in them.`,
    (s) => s.race === 'edge' && !!s.left,
    2,
  ),
  col(
    (s) => `${c(s.id)} are playing for next season now, and with ${ahead(s)}, this is the first thing to fix for it.`,
    (s) => s.race === 'out' && !!s.left,
    2,
  ),
  col(
    (s) => `${c(s.id)} finished ${s.rec}, and the ${s.noun} goes into the playoffs as the thing to fix.`,
    (s) => over(s) && s.race === 'in',
    3,
  ),
  col((s) => `${c(s.id)} finished ${s.rec}, and fixing the ${s.noun} is where next season starts.`, over, 2),
];
/** The last sentence of a Column that gives credit. */
const CREDIT_STAKES: CL[] = [
  col((s) => `Four games is a small sample, and ${c(s.id)} have ${ahead(s)}, to show it is real.`, early, 3),
  col(
    (s) => `${c(s.id)} have ${ahead(s)}, and this is what they will lean on in them to stay in the race.`,
    (s) => s.race === 'in' && !!s.left,
    2,
  ),
  col(
    (s) =>
      `${c(s.id)} have ${s.left} to get into the playoffs, the next of them ${s.next}, and this is the unit that gives them a chance.`,
    (s) => s.race === 'edge' && !!s.left,
    2,
  ),
  col(
    (s) => `${c(s.id)} have ${ahead(s)}, and it is something to build on for next season.`,
    (s) => s.race === 'out' && !!s.left,
    2,
  ),
  col(
    (s) => `${c(s.id)} finished ${s.rec}, and they take it into the playoffs with them.`,
    (s) => over(s) && s.race === 'in',
    3,
  ),
  col((s) => `${c(s.id)} finished ${s.rec}, and it is something to build on for next season.`, over, 2),
];

interface ColumnBank {
  claim: CL[];
  fact: CL[];
  reason: CL[];
  stakes: CL[];
  headline: (s: ColumnSheet, l: League) => string;
}
/** A club in a headline: its city, or its nickname where two clubs share one. */
const shared = (l: League, id: number) => l.teams.filter((x) => x.city === l.teams[id].city).length > 1;
const whose = (l: League, id: number) =>
  shared(l, id)
    ? `The ${possessive(l.teams[id].name)} problem is their`
    : `${possessive(l.teams[id].city)} problem is its`;
const whereOf = (l: League, id: number) => (shared(l, id) ? `with the ${l.teams[id].name}` : `in ${l.teams[id].city}`);

/** Why a unit is a problem: what it was before the span decides whether the trouble is new. */
const UNIT_REASON: CL[] = [
  col(
    (s) => `Before this run ${c(s.id)} ${s.was}, so the trouble is new and it arrived with the losing.`,
    (s) => s.change === 'worse' && !s.wasPoor && s.wasWinning,
    4,
  ),
  col(
    (s) => `Before this run ${c(s.id)} ${s.was}, so this is a change and not what they have been all season.`,
    (s) => s.change === 'worse' && !s.wasPoor,
    3,
  ),
  col(
    (s) => `Before this run ${c(s.id)} ${s.was}, so a weakness has become something worse.`,
    (s) => s.change === 'worse',
    2,
  ),
  col(
    (s) => `Before this run ${c(s.id)} ${s.was}, so it is not new and it has been there all season.`,
    (s) => s.change === 'better' || s.change === 'same',
    2,
  ),
  col((s) => `The rest of the league ${s.around} in the weeks ${c(s.id)} played those games.`),
];
const OWNERS_CALL: CL[] = [
  col(
    (s) => `The decision is the owner's to make, and with ${ahead(s)}, he has seen enough of this season to make it.`,
    (s) => !!s.left,
    1,
  ),
  col((s) => `The decision is the owner's to make, and ${c(s.id)} finished ${s.rec}.`),
];

const COLUMN: Record<string, ColumnBank> = {
  'unit-': {
    claim: [
      // In the first weeks a record says little about the race: the claim is about the start.
      col(
        (s) => `${C(s.id)} are ${s.rec}, and the ${s.noun} is the first place to look for why.`,
        (s) => s.stage === 'early' && s.wins <= s.played / 2,
        3,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec}, and the ${s.noun} is the one part of the start that should worry them.`,
        (s) => s.stage === 'early',
        3,
      ),
      col(
        (s) =>
          `${C(s.id)} are ${s.rec} and in the race, and the ${s.noun} is the part of this team that could cost them.`,
        (s) => s.race === 'in',
        2,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec}, and if the race gets away from them the ${s.noun} will be the reason.`,
        (s) => s.race === 'in',
        2,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec} and on the edge of the race, and the ${s.noun} is what is keeping them there.`,
        (s) => s.race === 'edge',
        2,
      ),
      col(
        (s) => `${C(s.id)} have lost ${w(s.lost)} of their last ${w(s.games)} games, and the ${s.noun} is why.`,
        (s) => s.race === 'out',
        2,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec}, and the ${s.noun} is the first thing that has to change.`,
        (s) => s.race === 'out',
        2,
      ),
    ],
    fact: [
      col((s) => `${c(s.id)} ${s.did} in their last ${w(s.games)} games${s.man}.`),
      col((s) => `Over their last ${w(s.games)} games ${c(s.id)} ${s.did}${s.man}.`),
    ],
    reason: UNIT_REASON,
    stakes: BLAME_STAKES,
    headline: (s, l) => `${whose(l, s.id)} ${s.noun}`,
  },
  'unit+': {
    claim: [
      col(
        (s) => `${C(s.id)} are ${s.rec}, and the ${s.noun} is the biggest reason for the start they have made.`,
        (s) => s.stage === 'early' && s.wins > s.played / 2 && s.lastYear !== 'losing',
        3,
      ),
      col(
        (s) =>
          `${C(s.id)} had a losing record last season and are ${s.rec} now, and the ${s.noun} is the biggest reason.`,
        (s) => s.lastYear === 'losing' && s.wins > s.played / 2,
        3,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec}, and the ${s.noun} is the best reason to think it will last.`,
        (s) => s.race === 'in' && s.wins > s.played / 2,
        3,
      ),
      col(
        (s) => `${C(s.id)} are ${s.rec} and in the race, and the ${s.noun} is the reason they are.`,
        (s) => s.race === 'in',
        2,
      ),
      col(
        (s) =>
          `${C(s.id)} are ${s.rec} and still in touch with the race, and the ${s.noun} is what has kept them there.`,
        (s) => s.race === 'edge',
        2,
      ),
      col(
        (s) =>
          `${C(s.id)} are ${s.rec} and out of the race, but the ${s.noun} is one part of the team that is working.`,
        (s) => s.race === 'out',
        2,
      ),
    ],
    fact: [
      // With one man to name, the fact is his; the games won are in the band.
      col(
        (s) => `${c(s.id)} ${s.did} over their last ${w(s.games)} games${s.man}.`,
        (s) => !!s.man,
        2,
      ),
      col((s) => `${c(s.id)} ${s.did} over their last ${w(s.games)} games and won ${w(s.won)} of them.`),
      col((s) => `Over their last ${w(s.games)} games ${c(s.id)} ${s.did}, and they won ${w(s.won)} of them.`),
    ],
    reason: [
      col(
        (s) => `Before this run ${c(s.id)} ${s.was}, so this is a unit that has got better as the season has gone on.`,
        (s) => s.change === 'better',
        2,
      ),
      col(
        (s) => `Before this run ${c(s.id)} ${s.was}, so it is no hot streak and it has been there all season.`,
        (s) => s.change === 'worse' || s.change === 'same',
        2,
      ),
      col((s) => `The rest of the league ${s.around} in the weeks ${c(s.id)} played those games.`),
    ],
    stakes: CREDIT_STAKES,
    headline: (s, l) =>
      `The ${s.noun} is carrying ${shared(l, s.id) ? `the ${l.teams[s.id].name}` : l.teams[s.id].city}`,
  },
  'coach2-': {
    claim: [
      col((s) => `${C(s.id)} are ${s.rec}, and it is fair to ask whether ${s.name} is the man to turn it around.`),
      col((s) => `${C(s.id)} are ${s.rec} under ${s.name}, and it is fair to ask whether that is going to change.`),
    ],
    fact: [
      col(
        (s) => `${c(s.id)} have lost ${w(s.streak)} games in a row under ${s.surname}.`,
        (s) => s.streak >= 3,
        2,
      ),
      col((s) => `${c(s.id)} have won ${w(s.wins)} of their ${w(s.played)} games this season under ${s.surname}.`),
    ],
    reason: [
      col(
        (s) =>
          `${c(s.id)} were ${s.lastRec} last season as well, so this is not one bad year, and ${s.surname} has been in charge for both.`,
        (s) => s.lastYear === 'losing',
        2,
      ),
      col(
        (s) =>
          `${c(s.id)} were ${s.lastRec} a year ago with ${s.surname} in charge, which is why this season is so hard to explain.`,
        (s) => s.lastYear === 'winning',
        2,
      ),
      col(
        (s) =>
          `${s.surname} is in his ${nth(s.seasons)} season with ${c(s.id)}, so this is his team and not one he has just inherited.`,
      ),
    ],
    stakes: [
      col(
        (s) => `The owner has ${ahead(s)}, to watch before any decision is his to make.`,
        (s) => !!s.left && s.stage !== 'runIn',
        2,
      ),
      col(
        (s) => `There are ${ahead(s)}, and they are ${possessive(s.surname)} chance to answer the question.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and what happens next is the owner's to decide.`),
    ],
    headline: (s, l) => `It is fair to ask about ${s.surname} ${whereOf(l, s.id)}`,
  },
  'coach3-': {
    claim: [col((s) => `${C(s.id)} are ${s.rec}, and it is time for a change at head coach.`)],
    fact: [
      col(
        (s) => `${possessive(s.name)} team has lost ${w(s.streak)} games in a row.`,
        (s) => s.streak >= 2,
        2,
      ),
      col((s) => `${possessive(s.name)} team has won ${w(s.wins)} of its ${w(s.played)} games this season.`),
    ],
    reason: [
      col(
        (s) =>
          `This column has already asked whether ${s.surname} could turn it around, and a ${s.spanRec} record over the last four games is the answer.`,
      ),
    ],
    stakes: OWNERS_CALL,
    headline: (s, l) => `It is time for a change ${whereOf(l, s.id)}`,
  },
  'gm2-': {
    claim: [
      col(
        (s) =>
          `${C(s.id)} are ${s.rec} after ${w(s.lostSeasons)} losing seasons in a row, and it is fair to ask about general manager ${s.name}.`,
      ),
    ],
    fact: [col((s) => `${s.surname} has been in charge of the roster for every one of them.`)],
    reason: [
      col(
        (s) =>
          `One bad season can be put down to coaching, but ${w(s.lostSeasons + 1)} in a row point at the roster, and the roster is ${possessive(s.surname)} work.`,
      ),
    ],
    stakes: [
      col(
        (s) =>
          `${c(s.id)} have ${ahead(s)}, and none of them will change what the last ${w(s.lostSeasons)} seasons say.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and what happens next is the owner's to decide.`),
    ],
    headline: (s, l) => `The losing ${whereOf(l, s.id)} points at ${s.surname}`,
  },
  'gm3-': {
    claim: [col((s) => `${C(s.id)} are ${s.rec}, and it is time for a change in the front office.`)],
    fact: [
      col(
        (s) =>
          `${s.name} has had ${w(s.lostSeasons)} full seasons as general manager, and ${c(s.id)} had a losing record in every one.`,
      ),
    ],
    reason: [
      col(
        (s) =>
          `This column has already asked about ${s.surname}, and a ${s.rec} record in a ${nth(s.lostSeasons + 1)} season is the answer.`,
      ),
    ],
    stakes: OWNERS_CALL,
    headline: (s, l) => `It is time for a change in the front office ${whereOf(l, s.id)}`,
  },
  'coach2+': {
    claim: [
      col(
        (s) =>
          `${C(s.id)} won ${w(s.lastWins)} games last season and are ${s.rec} now, and ${s.name} deserves the credit.`,
      ),
    ],
    fact: [
      col(
        (s) => `${c(s.id)} lead the ${s.division} by ${games(s.gap)}.`,
        (s) => s.place === 1 && s.gap > 0,
        2,
      ),
      col(
        (s) => `${c(s.id)} share the lead in the ${s.division} after ${w(s.played)} games.`,
        (s) => s.place === 1,
        1,
      ),
      col((s) => `${c(s.id)} are ${nth(s.place)} in the ${s.division} and in the playoff race.`),
    ],
    reason: [
      col(
        (s) =>
          `It is much the same club that lost ${w(s.lastLosses)} times a year ago, and ${s.surname} is in his ${nth(s.seasons)} season with it, so the change is his.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, and they are playing for a place in the playoffs in them.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and they take it into the playoffs with them.`),
    ],
    headline: (s, l) => `${s.surname} deserves the credit ${whereOf(l, s.id)}`,
  },
  'gm2+': {
    claim: [
      col(
        (s) =>
          `${C(s.id)} won ${w(s.lastWins)} games last season and are ${s.rec} now, and general manager ${s.name} deserves the credit for it.`,
      ),
    ],
    fact: [col((s) => `${s.surname} hired ${s.coach} as head coach before this season.`)],
    reason: [
      col(
        (s) =>
          `${s.coachSurname} is in his first season, so the turn belongs as much to the man who chose him, and that is ${s.surname}.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, and they are playing for a place in the playoffs in them.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and they take it into the playoffs with them.`),
    ],
    headline: (s, l) => `${s.surname} got it right ${whereOf(l, s.id)}`,
  },
  'gmBuilt+': {
    claim: [
      col(
        (s) =>
          `${C(s.id)} are ${s.rec} after ${w(s.wonSeasons)} winning seasons in a row, and general manager ${s.name} deserves the credit for building it.`,
      ),
    ],
    fact: [col((s) => `${s.surname} has been in charge of the roster for every one of those seasons.`)],
    reason: [
      col(
        (s) =>
          `One good season can be a hot quarterback or a kind schedule, but ${w(s.wonSeasons + 1)} in a row are a roster, and the roster is ${possessive(s.surname)} work.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, and they are playing for a place in the playoffs in them.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and they take it into the playoffs with them.`),
    ],
    headline: (s, l) => `${s.surname} built this ${whereOf(l, s.id)}`,
  },
  'gmRun+': {
    claim: [
      col(
        (s) =>
          `${C(s.id)} ${s.ran} last season and are ${s.rec} now, and general manager ${s.name} deserves the credit for keeping it together.`,
      ),
    ],
    fact: [col((s) => `${s.surname} was in charge of the roster for both of those seasons.`)],
    reason: [
      col(
        (s) =>
          `Clubs that go that far often fall back the next year, and ${c(s.id)} have not, which is the work of the man who builds the roster.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, and they are playing for a place in the playoffs in them.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and they take it into the playoffs with them.`),
    ],
    headline: (s, l) => `${s.surname} has kept it together ${whereOf(l, s.id)}`,
  },
  // Corrections: what an earlier Column said no longer holds.
  'fixunit-': {
    claim: [
      col((s) => `This column called the ${s.noun} the problem for ${C(s.id)}, and the games since say otherwise.`),
    ],
    fact: [col((s) => `${c(s.id)} ${s.did} in their last ${w(s.games)} games and won ${w(s.won)} of them.`)],
    reason: [
      col(
        (s) =>
          `What was written was true of those weeks, but ${c(s.id)} have fixed it since, and that should be said as plainly as the criticism was.`,
      ),
    ],
    stakes: CREDIT_STAKES,
    headline: (s, l) => `A correction on the ${s.noun} ${whereOf(l, s.id)}`,
  },
  'fixunit+': {
    claim: [col((s) => `This column said the ${s.noun} was carrying ${C(s.id)}, and the games since say otherwise.`)],
    fact: [col((s) => `${c(s.id)} ${s.did} in their last ${w(s.games)} games and lost ${w(s.lost)} of them.`)],
    reason: [
      col((s) => `What was written was true of those weeks, but it has not lasted, and ${c(s.id)} are ${s.rec} now.`),
    ],
    stakes: BLAME_STAKES,
    headline: (s, l) => `A correction on the ${s.noun} ${whereOf(l, s.id)}`,
  },
  'fixman-': {
    claim: [
      col(
        (s) =>
          `This column asked about ${possessive(s.name)} future with ${C(s.id)}, and ${w(s.streak)} wins in a row are an answer of a kind.`,
      ),
    ],
    fact: [col((s) => `${c(s.id)} are ${s.rec} after them.`)],
    reason: [
      col(
        (s) =>
          `The record is still a losing one, but a club that had stopped winning has started again, and that is the first thing asked of ${s.surname}.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, and the question can wait for them.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and the question can wait for next season.`),
    ],
    headline: (s, l) => `A correction on ${s.surname} ${whereOf(l, s.id)}`,
  },
  'fixman+': {
    claim: [
      col(
        (s) =>
          `This column gave ${s.name} the credit for the season ${C(s.id)} were having, and ${w(s.streak)} losses in a row have taken some of it back.`,
      ),
    ],
    fact: [col((s) => `${c(s.id)} are ${s.rec} after them.`)],
    reason: [
      col(
        (s) =>
          `The turnaround was real, but it has stalled, and ${s.surname} now has to show it was more than a good start.`,
      ),
    ],
    stakes: [
      col(
        (s) => `${c(s.id)} have ${ahead(s)}, to do it.`,
        (s) => !!s.left,
        1,
      ),
      col((s) => `${c(s.id)} finished ${s.rec}, and next season will say which it was.`),
    ],
    headline: (s, l) => `A correction on ${s.surname} ${whereOf(l, s.id)}`,
  },
};

/**
 * The one man a unit's numbers point at, as a clause joined to the unit's fact. Only when the box scores single him
 * out (`unitMan`): a problem shared around the group names nobody.
 */
function manClause(l: League, claim: Claim): string {
  const m = claim.man;
  const p = m ? l.players[m.playerId] : undefined;
  if (!m || !p) return '';
  // One number a sentence: the unit's rate is the digit, so his count is in words.
  const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
  const n = m.n < 10 ? w(m.n) : (TEENS[m.n - 10] ?? 'more than sixteen');
  switch (m.what) {
    case 'lineSacks':
      return `, and ${POSITION[p.position] ?? 'lineman'} ${M(p.id)} was charged with ${n} of the sacks himself`;
    case 'turnovers':
      return `, and ${M(p.id)} has turned the ball over ${n} times in them`;
    case 'passTds':
      return `, and ${M(p.id)} has thrown ${n} touchdown passes in them`;
    case 'carries':
      return `, and ${M(p.id)} has carried most of the load`;
    case 'rushSacks':
      return `, and ${M(p.id)} has ${n} of the sacks himself`;
    case 'picks':
      return `, and ${M(p.id)} has ${n} interceptions in them`;
  }
}

/** Which bank a claim is written from. */
function columnBank(claim: Claim): string {
  const sign = claim.dir === 'blame' ? '-' : '+';
  if (claim.dir === 'fix') {
    const was = claim.of?.endsWith('+') ? '+' : '-';
    return claim.subject.kind === 'unit' ? `fixunit${was}` : `fixman${was}`;
  }
  // A general manager is credited for one of three things, each with its own argument.
  if (claim.subject.kind === 'gm' && claim.dir === 'credit' && claim.facts.why === 'built') return 'gmBuilt+';
  if (claim.subject.kind === 'gm' && claim.dir === 'credit' && claim.facts.why === 'run') return 'gmRun+';
  return claim.subject.kind === 'unit' ? `unit${sign}` : `${claim.subject.kind}${claim.rung}${sign}`;
}

/**
 * SNN's Column: a claim and its evidence, in a columnist's voice. Two paragraphs: the claim and its strongest fact, then
 * the argument (why, and what is at stake where the club is in its season). The numbers sit in the band and the table;
 * a sentence carries one at most, and each leans on the one before it rather than standing beside it.
 */
export function columnStory(l: League, claim: Claim, at: Wording): EditionStory {
  const id = claim.teamId;
  const ctx = claim.context;
  const f = claim.facts;
  const unit = claim.subject.kind === 'unit' ? UNIT_SAYS[claim.subject.unit] : null;
  const num1 = (x: string | number | undefined) => parseFloat(String(x ?? ''));
  const [now, before] = [num1(f.value), num1(f.before)];
  const worse = f.low ? now > before : now < before;
  const change: ColumnSheet['change'] =
    !unit || !f.before || Number.isNaN(before)
      ? 'none'
      : Math.abs(now - before) <= Math.abs(before) * 0.1
        ? 'same'
        : worse
          ? 'worse'
          : 'better';
  const nx = nextOf(l, id, claim.week);
  const hc = teamCoaches(l, id).find((x) => x.role === 'headCoach');
  const man = claim.subject.kind === 'coach' ? l.coaches[claim.subject.coachId] : undefined;
  const seasons =
    1 + (man?.career ?? []).filter((x) => x.role === 'headCoach' && x.teamId === id && x.season < l.season).length;
  const st = standingOf(l, claim.week, id);
  const sheet: ColumnSheet = {
    id,
    rec: rec(ctx),
    race: ctx.race,
    stage: ctx.stage,
    lastYear: !ctx.last ? 'none' : ctx.last.w < ctx.last.l ? 'losing' : 'winning',
    lastRec: ctx.last ? `${ctx.last.w}–${ctx.last.l}` : '',
    lastWins: ctx.last?.w ?? 0,
    lastLosses: ctx.last?.l ?? 0,
    left: ctx.left && nx ? `${w(ctx.left)} ${plural(ctx.left, 'game')} left` : '',
    next: nx ? `${nx.home ? 'at home to' : 'away to'} ${c(nx.oppId)}` : '',
    division: st.division,
    place: ctx.place,
    gap: ctx.gap,
    played: ctx.w + ctx.l + ctx.t,
    wins: ctx.w,
    spanRec: `${ctx.span.w}–${ctx.span.l}`,
    noun: unit?.noun ?? '',
    did: unit ? unit.did(String(f.value)) : '',
    was: unit && f.before ? unit.was(String(f.before)) : '',
    around: unit ? unit.was(String(f.league)) : '',
    change,
    wasWinning: ctx.before.w >= ctx.before.l,
    wasPoor: !Number.isNaN(before) && (f.low ? before > num1(f.league) : before < num1(f.league)),
    man: manClause(l, claim),
    games: Number(f.games ?? 0),
    won: Number(f.won ?? 0),
    lost: Number(f.lost ?? 0),
    name: String(f.name ?? ''),
    surname: String(f.surname ?? ''),
    streak: Number(f.streak ?? 0),
    seasons,
    lostSeasons: Number(claim.numbers.find((n) => n.label.startsWith('Losing seasons'))?.value ?? 0),
    wonSeasons: Number(f.seasons ?? 0),
    ran:
      f.run === 'title' ? 'won the title' : f.run === 'final' ? 'reached the final' : 'reached their conference final',
    coach: String(f.coach ?? (hc ? `${hc.firstName} ${hc.lastName}` : '')),
    coachSurname: hc?.lastName ?? '',
  };
  const named = claim.man && l.players[claim.man.playerId] ? claim.man : null;
  const bank = COLUMN[columnBank(claim)];
  const line = (slot: keyof Omit<ColumnBank, 'headline'>) => pickLine(l, bank[slot], sheet, at, claim.key, slot);
  const cand: Candidate = {
    key: claim.key,
    kind: 'column',
    angle: claim.dir === 'fix' ? 'fix' : `${claim.rung}${claim.dir === 'blame' ? '-' : '+'}`,
    tier: 3,
    clubId: id,
    teams: [id],
    stakes: 0,
  };
  const story = compose(l, cand, at, {
    first: [line('claim'), line('fact')],
    second: [line('reason'), line('stakes')],
    headline: bank.headline(sheet, l),
    kicker: 'Column',
    picture:
      claim.subject.kind === 'coach'
        ? { coachId: claim.subject.coachId, teamIds: [id] }
        : named
          ? { playerId: named.playerId, teamIds: [id] }
          : { teamIds: [id] },
    numbers: claim.numbers.slice(0, 3),
    links: [
      ...(named ? [{ kind: 'player' as const, playerId: named.playerId }] : []),
      { kind: 'team', teamId: id },
      claim.subject.kind === 'gm' ? { kind: 'gms' } : { kind: 'standings' },
    ],
    summary: 1,
  });
  return { ...story, table: claim.table, covers: [claim.key] };
}

// ───────── your club's storylines ─────────

/**
 * How much a man had played before the news, said the way the count calls for: every game, all but a few, about half,
 * hardly any. Two wordings each, chosen by a stable hash, so two storylines in a season do not read alike.
 */
function startsLine(
  l: League,
  cand: Candidate,
  playerId: number,
  starts: number,
  played: number,
  verb: 'had' | 'has',
): string[] {
  if (starts <= 0 || played <= 0) return [];
  const who = M(playerId);
  const city = possessive(l.teams[cand.clubId].city);
  const missed = played - starts;
  const forms =
    missed === 0
      ? [`${who} ${verb} started every game this season.`, `${who} ${verb} not missed a start this season.`]
      : missed <= 2
        ? [
            `${who} ${verb} started all but ${w(missed)} of ${city} games this season.`,
            `${who} ${verb} started ${w(starts)} of ${city} ${w(played)} games.`,
          ]
        : starts * 2 <= played
          ? [
              `${who} ${verb} started ${w(starts)} ${plural(starts, 'game')} this season.`,
              `${who} ${verb} made ${w(starts)} ${plural(starts, 'start')} in ${city} ${w(played)} games.`,
            ]
          : [
              `${who} ${verb} started ${w(starts)} of ${city} ${w(played)} games.`,
              `${who} ${verb} ${w(starts)} starts this season.`,
            ];
  return [forms[stableHash(cand.key) % forms.length]];
}

/**
 * One of the reader's club's public storylines as a brief: who was left out of the lineup and for whom, a trade request
 * "according to reports", and how each ended. Only what the league could see: the lineup, the box scores and the
 * transaction. Nothing of what was said between the man and his club.
 */
function storylineStory(l: League, cand: Candidate, at: Wording): EditionStory {
  const x = cand.storyline!;
  const id = cand.clubId;
  const week = Math.max(
    1,
    ...l.games.filter((g) => g.season === l.season && g.result && !g.playoffRound).map((g) => g.week),
  );
  const st = standingOf(l, week, id);
  const nick = nickOf(l, id);
  if (x.beat === 'relieved' && x.coach) {
    return compose(l, cand, at, {
      first: [
        `${C(id)} relieved ${x.coach.side} coordinator ${x.coach.name} of his duties. ${c(id)} are ${rec(st.row)}.`,
      ],
      second: [],
      headline: `${nick} relieve ${x.coach.side} coordinator ${lastWord(x.coach.name)}`,
      kicker: 'Your club',
      picture: { teamIds: [id] },
      numbers: [],
      links: [{ kind: 'team', teamId: id }],
      summary: 2,
    });
  }
  const p = l.players[x.playerId!];
  const o = x.other === undefined ? undefined : l.players[x.other];
  const pos = POSITION[p.position] ?? 'player';
  const game = x.now ? resultOf(l, id, week) : null;
  const vs = game ? ` against ${C(game.oppId)}` : '';
  const starts = startsOf(l, p.id, week);
  const played = st.row.w + st.row.l + st.row.t;
  const weeks = `${w(Math.max(1, x.since))} ${plural(Math.max(1, x.since), 'week')}`;
  let first: string[];
  let headline: string;
  switch (x.beat) {
    case 'sat':
      first = [
        o
          ? `${C(id)} benched ${pos} ${M(p.id)}${vs} and started ${M(o.id)} in his place.`
          : `${C(id)} left ${pos} ${M(p.id)} out of the starting lineup${vs}.`,
        ...startsLine(l, cand, p.id, starts, played, 'had'),
      ];
      headline = `${nick} bench ${p.lastName}`;
      break;
    case 'backIn':
      first = [
        `${cap(pos)} ${M(p.id)} was back in the starting lineup for ${C(id)}${vs}, ${weeks} after losing his place.`,
      ];
      headline = `${p.lastName} is back in the ${nick} lineup`;
      break;
    case 'settled':
      if ((x.how === 'earned' || x.how === 'chart') && o) {
        first = [
          `${M(o.id)} has kept the starting job at ${pos} for ${C(id)}, and ${M(p.id)} has not started since he was benched.`,
        ];
        headline = `${o.lastName} keeps the ${nick} job`;
      } else {
        first = [
          `${cap(pos)} ${M(p.id)} has his starting job back with ${C(id)}.`,
          ...(o ? [`${M(o.id)} started in his place for ${weeks}.`] : []),
        ];
        headline = `${p.lastName} wins his job back`;
      }
      break;
    case 'left':
      first = [
        `${cap(pos)} ${M(p.id)}, who lost his starting job with ${C(id)} this season, is no longer with the club.`,
      ];
      headline = `${p.lastName} leaves the ${nick}`;
      break;
    case 'leaked':
      first = [
        `${cap(pos)} ${M(p.id)} has asked ${C(id)} for a trade, according to reports.`,
        ...startsLine(l, cand, p.id, starts, played, 'has'),
      ];
      headline = `${p.lastName} asks the ${nick} for a trade`;
      break;
    default:
      // A leaked request, ended.
      if (x.how === 'traded') {
        first = [`${C(id)} have traded ${pos} ${M(p.id)}, who had asked to leave.`];
        headline = `${nick} trade ${p.lastName}`;
      } else if (x.how === 'released') {
        first = [`${C(id)} have released ${pos} ${M(p.id)}, who had asked for a trade.`];
        headline = `${nick} release ${p.lastName}`;
      } else if (x.how === 'signed') {
        first = [`${cap(pos)} ${M(p.id)} has a new contract with ${C(id)}, which ends his trade request.`];
        headline = `${p.lastName} signs a new deal with the ${nick}`;
      } else {
        first = [
          `${cap(pos)} ${M(p.id)} has withdrawn his trade request and stays with ${C(id)}, according to reports.`,
        ];
        headline = `${p.lastName} withdraws his trade request`;
      }
  }
  // A brief is one paragraph: its sentences run together.
  return compose(l, cand, at, {
    first: [first.join(' ')],
    second: [],
    headline,
    kicker: 'Your club',
    picture: { playerId: p.id },
    numbers: [],
    links: [
      { kind: 'player', playerId: p.id },
      { kind: 'team', teamId: id },
    ],
    summary: 2,
  });
}
