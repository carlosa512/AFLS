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
import { CUT, type ClubRecord, type GameFacts } from './snnStory';
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
function joined(a: string, b: string): string[] {
  const subjectOf = (x: string) => /^(\{c:\d+\}) /.exec(x)?.[1];
  const forClub = (x: string) => / for (\{c:\d+\})\.$/.exec(x)?.[1];
  const drop = (x: string) => x.replace(/ for \{c:\d+\}\.$/, '.');
  const [sa, sb] = [subjectOf(a), subjectOf(b)];
  if (/ and /.test(a) || / and /.test(b)) {
    // Too long to join. Still no club named at the end of one sentence and the start of the next.
    if (sb && forClub(a) === sb) return [b, drop(a)];
    return [a, sa && forClub(b) === sa ? drop(b) : b];
  }
  // "X threw for 235 yards for Baltimore" then "Baltimore held the ball…": the club's own fact first, his without it.
  if (sb && forClub(a) === sb) return [`${b.replace(/\.$/, '')}, and ${drop(a)}`];
  const second = sa && forClub(b) === sa ? drop(b) : b;
  const head = a.replace(/\.$/, '');
  if (sa && second.startsWith(`${sa} `)) return [`${head} and ${second.slice(sa.length + 1)}`];
  return [`${head}, and ${second}`];
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
        `${cap(POSITION[p.position] ?? 'player')} ${M(p.id)} left with ${injuryPhrase(hurt.type)} and will miss the rest of the season.${award ? ` He was ${award}.` : ''}`,
      );
    }
  }

  // What it means: where the story's club stands, and one callback. A callback said before is left out.
  const meanId = s.ws === s.ls ? s.W : focus === s.L ? s.L : s.W;
  const form = stableHash(`${at.editionId}:${cand.key}:form`);
  const stand = standingLine(l, s.week, meanId, form, s.ws === s.ls ? null : meanId === s.W);
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
    `${C(id)} lost ${POSITION[p.position] ?? 'player'} ${M(p.id)} to ${injuryPhrase(hurt.type)} in the ${QUARTER[hurt.quarter] ?? 'fourth'} quarter of their ${result} ${C(opp)}. He will miss the rest of the season.`,
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
    summary: sentencesOf(paragraphs[0]).slice(0, 2).join(' '),
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

/** One story from one candidate. Every sentence it uses goes onto `at.said`, so an edition never repeats itself. */
export function writeStory(l: League, cand: Candidate, at: Wording, opt: StoryOptions = {}): EditionStory {
  if (cand.kind === 'run') return runStory(l, cand, at);
  if (cand.kind === 'starOut') return starOutStory(l, cand, at);
  if (cand.angle === 'bye') return byeStory(l, cand, at);
  return gameStory(l, cand, at, opt);
}
