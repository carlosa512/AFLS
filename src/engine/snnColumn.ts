/**
 * The ladder of SNN's Column: what an opinion piece may claim about a unit, a head coach or a general manager, and when.
 * A claim is a fact pattern in the public record (results, box scores, who holds a job, past seasons' records), never a
 * rating or a mood, and never more than a club's owner could act on (`leadershipWeek`). Mail-side: nothing in the sim
 * reads this, and it draws from no stream. Spec: docs/superpowers/specs/2026-11-11-snn-column-and-storylines-design.md.
 *
 * What the Column has said is remembered as keys in the edition's `covered` (`column:{season}:{subject}:{rung}{+|-}`),
 * so "no claim twice", "one rung at a time" and corrections are lookups in what the inbox has told (`toldKeys`).
 */
import { teamCoaches } from './coaching';
import { FORM, lowIsBetter, unitForm, unitMan, UNITS, type ManWhat, type Unit, type UnitForm } from './slump';
import { computeRecords, conferenceSeeds, divisionStandings, type TeamRecord } from './season/standings';
import type { EditionStory, League } from './types';
import { stableHash } from './voice';

/**
 * The bars. First guesses until the owner sets them from the counts (`npm run editions -- --seasons`); the blame rungs
 * follow the owners' own clock in `leadershipWeek` and must never run ahead of it.
 */
export const LADDER = {
  /** "Fair to ask" about a head coach: this winning percentage or worse… */
  coachPct: 0.3,
  /** …through this many games. */
  coachGames: 6,
  /** "It's time" only after this week is played: when an owner can act in season. */
  timeAfterWeek: 11,
  /**
   * Losing seasons already finished under a GM before it is fair to ask (with this one going the same way, that is
   * three in a row), and before it is time.
   */
  gmFair: 2,
  gmTime: 3,
  /** A turnaround: this many wins or fewer last season, this percentage or better through this many games. */
  turnWins: 6,
  turnPct: 0.75,
  turnGames: 8,
  /** Columns about the reader's club in a season. */
  yoursASeason: 3,
  /** Straight wins (or losses) that reverse a claim about a man. */
  fixWins: 4,
  /** A good season under way: this winning percentage through `turnGames`. */
  goodPct: 0.6,
  /** Winning seasons already finished under a GM before he is credited with building it (this one makes three). */
  gmBuilt: 2,
  /** Editions between two Columns: it never runs two weeks running (the owner's rule G). */
  rest: 1,
  /** A man's job (blame for a head coach or a GM) comes up in one Column of this many at most. */
  jobIn: 3,
};

export type Subject =
  | { kind: 'unit'; teamId: number; unit: Unit }
  | { kind: 'coach'; teamId: number; coachId: number }
  | { kind: 'gm'; teamId: number; gmId: number };

/** Where a club is in its season, from the public table: what the same four games mean depends on it. */
export interface ClubContext {
  w: number;
  l: number;
  t: number;
  /** Its place in the division, and the games it leads by (in first) or trails by. */
  place: number;
  gap: number;
  /** Holding a playoff place or within a game of one, within two, or further back than that. */
  race: 'in' | 'edge' | 'out';
  /** Through Week 8, through Week 13, then the run-in. */
  stage: 'early' | 'middle' | 'runIn';
  /** Regular-season games left. */
  left: number;
  /** Last season's record; null in a league's first season. */
  last: { w: number; l: number } | null;
  /** Its record over its last four games, and before them. */
  span: { w: number; l: number };
  before: { w: number; l: number };
}

export interface Claim {
  key: string;
  subject: Subject;
  rung: 1 | 2 | 3;
  dir: 'blame' | 'credit' | 'fix';
  teamId: number;
  /** How far past its bar, as a share of it: what ranks two claims of one rung. */
  margin: number;
  numbers: EditionStory['numbers'];
  table: { head: string[]; rows: string[][] };
  /** What a line may read: names, values and weeks, already in words and digits. */
  facts: Record<string, string | number>;
  context: ClubContext;
  /** The week it holds after. */
  week: number;
  /** The one man a unit's span points at, when the box scores single one out (`unitMan`). */
  man?: { playerId: number; what: ManWhat; n: number } | null;
  /** The claim a correction takes back. */
  of?: string;
}

const pctOf = (r: { w: number; l: number; t?: number }) => {
  const games = r.w + r.l + (r.t ?? 0);
  return games ? (r.w + (r.t ?? 0) / 2) / games : 0;
};
const recText = (r: { w: number; l: number; t?: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
/** The league as it stood once `week` was played. */
const asOf = (l: League, week: number): League => ({
  ...l,
  games: l.games.filter((g) => g.season !== l.season || g.week <= week),
});
/** Games one record is ahead of another. */
const ahead = (a: TeamRecord, b: TeamRecord) => (a.w - b.w + (b.l - a.l)) / 2;

export function clubContext(l: League, teamId: number, week: number): ClubContext {
  const now = asOf(l, week);
  const records = computeRecords(now);
  const me = records.get(teamId)!;
  const team = l.teams[teamId];
  const division = divisionStandings(now, records)[team.division].teams;
  const place = division.findIndex((r) => r.teamId === teamId) + 1;
  const gap = place === 1 ? (division[1] ? ahead(me, division[1]) : 0) : ahead(division[0], me);
  const left = l.games.filter(
    (g) => g.season === l.season && !g.playoffRound && g.week > week && (g.homeId === teamId || g.awayId === teamId),
  ).length;
  const seeds = conferenceSeeds(now, team.conference, records);
  const last = records.get(seeds[seeds.length - 1]);
  const behind = seeds.includes(teamId) || !last ? 0 : ahead(last, me);
  const race: ClubContext['race'] = behind > left ? 'out' : behind <= 1 ? 'in' : behind <= 2 ? 'edge' : 'out';
  const was = l.history.find((h) => h.season === l.season - 1)?.records[teamId];
  const form = unitForm(l, teamId, 'run game', week);
  return {
    w: me.w,
    l: me.l,
    t: me.t,
    place,
    gap,
    race,
    stage: week <= 8 ? 'early' : week <= 13 ? 'middle' : 'runIn',
    left,
    last: was ? { w: was.w, l: was.l } : null,
    span: { w: form?.won ?? 0, l: form?.lost ?? 0 },
    before: { w: form?.before?.won ?? 0, l: form?.before?.lost ?? 0 },
  };
}

// ───────── units ─────────

const UNIT_LABEL: Record<Unit, string> = {
  'offensive line': 'Dropbacks ending in a sack',
  'pass rush': 'Dropbacks ending in a sack',
  'run game': 'Yards a carry',
  'run defense': 'Yards a carry allowed',
  'passing game': 'Yards a pass',
  coverage: 'Yards a pass allowed',
};
const unitText = (unit: Unit, value: number) =>
  unit === 'offensive line' || unit === 'pass rush' ? `${(value * 100).toFixed(1)}%` : value.toFixed(1);

function unitEvidence(l: League, teamId: number, unit: Unit, f: UnitForm): Pick<Claim, 'numbers' | 'table' | 'facts'> {
  const label = UNIT_LABEL[unit];
  const numbers = [
    { value: unitText(unit, f.value), label: `${label}, last ${f.games}` },
    { value: ordinal(f.rank), label: 'In the league in that span' },
    { value: `${f.won}–${f.lost}`, label: 'Record in that span' },
  ];
  const table = f.before
    ? {
        head: ['', `Weeks 1–${f.from - 1}`, 'Since'],
        rows: [
          [label, unitText(unit, f.before.value), unitText(unit, f.value)],
          ['Record', `${f.before.won}–${f.before.lost}`, `${f.won}–${f.lost}`],
          ['League average since', '—', unitText(unit, f.league)],
        ],
      }
    : {
        head: [`Last ${f.games} games`, 'League', l.teams[teamId].city],
        rows: [
          [label, unitText(unit, f.league), unitText(unit, f.value)],
          ['Place in the league', '—', ordinal(f.rank)],
        ],
      };
  return {
    numbers,
    table,
    facts: {
      unit,
      value: unitText(unit, f.value),
      before: f.before ? unitText(unit, f.before.value) : '',
      league: unitText(unit, f.league),
      rank: f.rank,
      from: f.from,
      to: f.to,
      won: f.won,
      lost: f.lost,
      games: f.games,
      low: lowIsBetter(unit) ? 1 : 0,
    },
  };
}

// ───────── the men in charge ─────────

const headOf = (l: League, teamId: number) => teamCoaches(l, teamId).find((c) => c.role === 'headCoach');
const fullName = (x: { firstName: string; lastName: string }) => `${x.firstName} ${x.lastName}`;

/** Losing seasons in a row under this GM at this club, counting back from last season. */
function runOfSeasons(
  l: League,
  gmId: number,
  teamId: number,
  counts: (r: { w: number; l: number }) => boolean,
): { season: number; w: number; l: number }[] {
  const gm = l.gms[gmId];
  const out: { season: number; w: number; l: number }[] = [];
  for (let season = l.season - 1; ; season--) {
    const mine = gm?.career.find((c) => c.season === season && c.teamId === teamId);
    const rec = mine?.record?.regular ?? (mine ? l.history.find((h) => h.season === season)?.records[teamId] : null);
    if (!rec || !counts(rec)) break;
    out.push({ season, w: rec.w, l: rec.l });
  }
  return out;
}
const losingSeasons = (l: League, gmId: number, teamId: number) => runOfSeasons(l, gmId, teamId, (r) => r.w < r.l);
/** Winning seasons in a row under this GM at this club, counting back from last season. */
const winningSeasons = (l: League, gmId: number, teamId: number) => runOfSeasons(l, gmId, teamId, (r) => r.w > r.l);

/** How far a club went last season, when it went deep: the conference final, the final, or the title. */
function deepRun(l: League, teamId: number): 'conference final' | 'final' | 'title' | null {
  const last = l.history.find((h) => h.season === l.season - 1);
  if (!last) return null;
  if (last.championId === teamId) return 'title';
  const round = last.playoffs?.[teamId]?.round;
  if (last.runnerUpId === teamId || round === 'FINAL') return 'final';
  return round === 'CONF' ? 'conference final' : null;
}

/** A club's season in a table, against the league: what a Column about its head coach rests on. */
function seasonEvidence(l: League, teamId: number, me: TeamRecord, records: Map<number, TeamRecord>) {
  const games = Math.max(1, me.w + me.l + me.t);
  let pf = 0;
  let n = 0;
  for (const r of records.values()) {
    pf += r.pf;
    n += r.w + r.l + r.t;
  }
  const league = n ? (pf / n).toFixed(1) : '—';
  return {
    head: ['', 'League', l.teams[teamId].city],
    rows: [
      ['Points a game', league, (me.pf / games).toFixed(1)],
      ['Points allowed a game', league, (me.pa / games).toFixed(1)],
      ['Record', '—', recText(me)],
    ],
  };
}
const streakOf = (r: TeamRecord) => ({ won: r.streak[0] === 'W', n: Number(r.streak.slice(1)) || 0 });

/**
 * Every claim that holds once `week` is played and has not been made. `have` is what the inbox has told (`toldKeys`):
 * this league year's keys and last year's.
 */
export function columnClaims(l: League, week: number, have: Set<string>): Claim[] {
  const out: Claim[] = [];
  const season = l.season;
  const records = computeRecords(asOf(l, week));
  const contexts = new Map<number, ClubContext>();
  const ctx = (teamId: number) => {
    if (!contexts.has(teamId)) contexts.set(teamId, clubContext(l, teamId, week));
    return contexts.get(teamId)!;
  };
  const add = (c: Omit<Claim, 'context' | 'week'>) => {
    if (!have.has(c.key)) out.push({ ...c, context: ctx(c.teamId), week });
  };
  const told = (key: string) => have.has(key);
  const ever = (subject: string, tail: string) =>
    told(`column:${season}:${subject}:${tail}`) || told(`column:${season - 1}:${subject}:${tail}`);

  for (const t of l.teams) {
    const me = records.get(t.id)!;
    const games = me.w + me.l + me.t;
    const pct = pctOf(me);
    const streak = streakOf(me);

    // Rung 1: a unit, four games of it, and results that agree.
    for (const unit of UNITS) {
      const f = unitForm(l, t.id, unit, week);
      if (!f) continue;
      const subject = `unit:${t.id}:${unit}`;
      const base = { subject: { kind: 'unit' as const, teamId: t.id, unit }, rung: 1 as const, teamId: t.id };
      const bad = f.rank > l.teams.length - FORM.quarter && f.lost >= FORM.results;
      const good = f.rank <= FORM.quarter && f.won >= FORM.results;
      // A club that is out of the race has its problems told once: after that the Column is about the men in charge.
      const again = ctx(t.id).race === 'out' && UNITS.some((u) => told(`column:${season}:unit:${t.id}:${u}:1-`));
      if (bad && !again)
        add({
          ...base,
          key: `column:${season}:${subject}:1-`,
          dir: 'blame',
          man: unitMan(l, t.id, unit, week, 'blame'),
          margin: (f.rank - (l.teams.length - FORM.quarter)) / FORM.quarter,
          ...unitEvidence(l, t.id, unit, f),
        });
      if (good)
        add({
          ...base,
          key: `column:${season}:${subject}:1+`,
          dir: 'credit',
          man: unitMan(l, t.id, unit, week, 'credit'),
          margin: (FORM.quarter + 1 - f.rank) / FORM.quarter,
          ...unitEvidence(l, t.id, unit, f),
        });
      // A correction: what was said about this unit no longer holds.
      const fix = `column:${season}:${subject}:fix`;
      const wasBad = told(`column:${season}:${subject}:1-`) && f.rank <= l.teams.length / 2 && f.won >= FORM.results;
      const wasGood = told(`column:${season}:${subject}:1+`) && f.rank > l.teams.length - FORM.quarter;
      if (wasBad || wasGood)
        add({
          ...base,
          key: fix,
          dir: 'fix',
          margin: 1,
          of: `column:${season}:${subject}:1${wasBad ? '-' : '+'}`,
          ...unitEvidence(l, t.id, unit, f),
        });
    }

    const hc = headOf(l, t.id);
    const before = l.history.find((h) => h.season === season - 1)?.records[t.id];
    const struggling = games >= LADDER.coachGames && pct <= LADDER.coachPct + 1e-9;
    const turned = !!before && before.w <= LADDER.turnWins && games >= LADDER.turnGames && pct >= LADDER.turnPct - 1e-9;
    const numbers = [
      { value: recText(me), label: 'Record' },
      ...(before ? [{ value: recText(before), label: `${season - 1} record` }] : []),
    ];
    const turnTable = before
      ? {
          head: ['', String(season - 1), String(season)],
          rows: [
            ['Record', recText(before), recText(me)],
            ['Winning percentage', pctOf(before).toFixed(3).replace(/^0/, ''), pct.toFixed(3).replace(/^0/, '')],
          ],
        }
      : { head: ['', '', ''], rows: [] };

    // A head coach. An interim is never named, and a man in his first season in the job never above the first rung.
    const settled =
      !!hc &&
      !hc.interim &&
      (hc.career ?? []).some((c) => c.role === 'headCoach' && c.teamId === t.id && c.season < season);
    if (hc && !hc.interim) {
      const subject = `coach:${hc.id}`;
      const base = {
        subject: { kind: 'coach' as const, teamId: t.id, coachId: hc.id },
        teamId: t.id,
        facts: { name: fullName(hc), surname: hc.lastName, record: recText(me), streak: streak.n },
      };
      const fair = `column:${season}:${subject}:2-`;
      if (settled && struggling) {
        const evidence = {
          numbers: [
            ...numbers,
            ...(!streak.won && streak.n >= 3 ? [{ value: String(streak.n), label: 'Straight losses' }] : []),
          ].slice(0, 3),
          table: seasonEvidence(l, t.id, me, records),
        };
        add({
          ...base,
          key: fair,
          rung: 2,
          dir: 'blame',
          margin: (LADDER.coachPct - pct) / LADDER.coachPct,
          ...evidence,
        });
        // "It's time": only where the owner could act, and only after it was fair to ask.
        if (week > LADDER.timeAfterWeek && !streak.won && ever(subject, '2-'))
          add({
            ...base,
            key: `column:${season}:${subject}:3-`,
            rung: 3,
            dir: 'blame',
            margin: (LADDER.coachPct - pct) / LADDER.coachPct,
            ...evidence,
          });
      }
      if (settled && turned)
        add({
          ...base,
          key: `column:${season}:${subject}:2+`,
          rung: 2,
          dir: 'credit',
          margin: (pct - LADDER.turnPct) / (1 - LADDER.turnPct),
          numbers,
          table: turnTable,
        });
      const blamed = told(fair) || told(`column:${season}:${subject}:3-`);
      const praised = told(`column:${season}:${subject}:2+`);
      if (
        (blamed && streak.won && streak.n >= LADDER.fixWins) ||
        (praised && !streak.won && streak.n >= LADDER.fixWins)
      )
        add({
          ...base,
          key: `column:${season}:${subject}:fix`,
          rung: 2,
          dir: 'fix',
          margin: 1,
          of: blamed ? (told(fair) ? fair : `column:${season}:${subject}:3-`) : `column:${season}:${subject}:2+`,
          numbers: [
            ...numbers,
            { value: String(streak.n), label: streak.won ? 'Straight wins' : 'Straight losses' },
          ].slice(0, 3),
          table: seasonEvidence(l, t.id, me, records),
        });
    }

    // A general manager: judged by seasons, not weeks.
    const gm = t.gmId == null ? undefined : l.gms[t.gmId];
    if (gm && !gm.appointments.at(-1)?.interim) {
      const subject = `gm:${gm.id}`;
      const base = {
        subject: { kind: 'gm' as const, teamId: t.id, gmId: gm.id },
        teamId: t.id,
        facts: { name: fullName(gm), surname: gm.lastName, record: recText(me), streak: streak.n },
      };
      const lost = losingSeasons(l, gm.id, t.id);
      const years = {
        head: ['Season', 'Record', 'Pct'],
        rows: [
          ...lost
            .slice(0, 3)
            .reverse()
            .map((s) => [String(s.season), recText(s), pctOf(s).toFixed(3).replace(/^0/, '')]),
          [String(season), recText(me), pct.toFixed(3).replace(/^0/, '')],
        ],
      };
      const seasonsLost = [
        { value: recText(me), label: 'Record' },
        { value: String(lost.length), label: 'Losing seasons before this one' },
      ];
      const fair = `column:${season}:${subject}:2-`;
      if (struggling && lost.length >= LADDER.gmFair)
        add({
          ...base,
          key: fair,
          rung: 2,
          dir: 'blame',
          margin: (LADDER.coachPct - pct) / LADDER.coachPct,
          numbers: seasonsLost,
          table: years,
        });
      if (struggling && lost.length >= LADDER.gmTime && week > LADDER.timeAfterWeek && ever(subject, '2-'))
        add({
          ...base,
          key: `column:${season}:${subject}:3-`,
          rung: 3,
          dir: 'blame',
          margin: (LADDER.coachPct - pct) / LADDER.coachPct,
          numbers: seasonsLost,
          table: years,
        });
      // A turnaround under a head coach in his first season is the general manager's hire.
      const hired =
        !!hc && !hc.interim && !settled && gm.career.some((c) => c.season === season - 1 && c.teamId === t.id);
      // Credit for a GM, one Column a season, for the strongest of three reasons: he followed a deep playoff run
      // with another good year, he has built a run of winning seasons, or his new head coach has turned the club.
      const good = games >= LADDER.turnGames && pct >= LADDER.goodPct - 1e-9;
      const here = gm.career.some((c) => c.season === season - 1 && c.teamId === t.id);
      const won = winningSeasons(l, gm.id, t.id);
      const run = here ? deepRun(l, t.id) : null;
      const credit = {
        ...base,
        key: `column:${season}:${subject}:2+`,
        rung: 2 as const,
        dir: 'credit' as const,
      };
      if (good && run && before)
        add({
          ...credit,
          margin: (pct - LADDER.goodPct) / (1 - LADDER.goodPct),
          numbers: [
            { value: recText(me), label: 'Record' },
            { value: recText(before), label: `${season - 1} record` },
          ],
          table: {
            head: ['', String(season - 1), String(season)],
            rows: [
              ['Record', recText(before), recText(me)],
              [
                'Finish',
                run === 'title' ? 'Won the title' : run === 'final' ? 'Lost the final' : 'Conference final',
                '—',
              ],
            ],
          },
          facts: { ...base.facts, why: 'run', run },
        });
      // Said in the season the run reaches three, not again in every winning year after it.
      else if (good && won.length === LADDER.gmBuilt)
        add({
          ...credit,
          margin: (pct - LADDER.goodPct) / (1 - LADDER.goodPct),
          numbers: [
            { value: recText(me), label: 'Record' },
            { value: String(won.length), label: 'Winning seasons before this one' },
          ],
          table: {
            head: ['Season', 'Record', 'Pct'],
            rows: [
              ...won
                .slice(0, 3)
                .reverse()
                .map((s) => [String(s.season), recText(s), pctOf(s).toFixed(3).replace(/^0/, '')]),
              [String(season), recText(me), pct.toFixed(3).replace(/^0/, '')],
            ],
          },
          facts: { ...base.facts, why: 'built', seasons: won.length },
        });
      else if (turned && hired)
        add({
          ...credit,
          margin: (pct - LADDER.turnPct) / (1 - LADDER.turnPct),
          numbers,
          table: turnTable,
          facts: { ...base.facts, why: 'hire', coach: hc ? fullName(hc) : '' },
        });
      const blamed = told(fair) || told(`column:${season}:${subject}:3-`);
      if (blamed && streak.won && streak.n >= LADDER.fixWins)
        add({
          ...base,
          key: `column:${season}:${subject}:fix`,
          rung: 2,
          dir: 'fix',
          margin: 1,
          of: told(fair) ? fair : `column:${season}:${subject}:3-`,
          numbers: [
            { value: recText(me), label: 'Record' },
            { value: String(streak.n), label: 'Straight wins' },
          ],
          table: years,
        });
      // And credit taken back, as a head coach's is.
      const praised = `column:${season}:${subject}:2+`;
      if (told(praised) && !streak.won && streak.n >= LADDER.fixWins)
        add({
          ...base,
          key: `column:${season}:${subject}:fix`,
          rung: 2,
          dir: 'fix',
          margin: 1,
          of: praised,
          numbers: [
            { value: recText(me), label: 'Record' },
            { value: String(streak.n), label: 'Straight losses' },
          ],
          table: seasonEvidence(l, t.id, me, records),
        });
    }
  }
  return out;
}

/** What is at stake in a claim: a contender's weakness and a surprise outrank a struggling club's latest problem. */
function stakes(c: Claim): number {
  const { race, last } = c.context;
  if (c.dir === 'blame' && race === 'in') return 3;
  if (last && ((c.dir === 'credit' && last.w < last.l) || (c.dir === 'blame' && last.w >= 10))) return 2;
  return race === 'edge' ? 1 : 0;
}

/** A Column that has run this season, read back from its key. */
const dirOf = (key: string): Claim['dir'] => (key.endsWith(':fix') ? 'fix' : key.endsWith('+') ? 'credit' : 'blame');
const jobKey = (key: string) => /^column:\d+:(coach|gm):/.test(key) && key.endsWith('-');
const isJob = (c: Claim) => c.subject.kind !== 'unit' && c.dir === 'blame';

/**
 * The week's Column, or none. How often it runs and about what is the owner's rule (set from five seasons of counts):
 * never two weeks running, blame and credit in turn, and a man's job in one Column of three at most. Among what that
 * leaves: a correction first, then the highest rung, then what is at stake, then the margin, then a stable hash. A club
 * the page already covers is passed over, and the reader's club is held to its limits.
 *
 * `ran` is this season's Columns so far, newest first, by the week of their edition.
 */
export function pickColumn(
  claims: Claim[],
  opt: {
    taken: Set<number>;
    userTeamId: number | null;
    yoursTold: number;
    yoursLastWeek: boolean;
    editionId: string;
    week: number;
    ran: { week: number; key: string }[];
  },
): Claim | null {
  if (opt.ran.some((r) => opt.week - r.week <= LADDER.rest && r.week < opt.week)) return null;
  // A correction takes no turn: the Column before it still decides whose turn it is.
  const lastDir = opt.ran.map((r) => dirOf(r.key)).find((d) => d !== 'fix');
  const jobLately = opt.ran.slice(0, LADDER.jobIn - 1).some((r) => jobKey(r.key));
  const open = claims.filter((c) => {
    if (opt.taken.has(c.teamId)) return false;
    if (c.dir !== 'fix' && c.dir === lastDir) return false;
    if (isJob(c) && jobLately) return false;
    const yours = opt.userTeamId !== null && c.teamId === opt.userTeamId;
    return !yours || (opt.yoursTold < LADDER.yoursASeason && !opt.yoursLastWeek);
  });
  const fixed = (c: Claim) => (c.dir === 'fix' ? 1 : 0);
  // Losing seasons one after another point at the man who built the roster before the man who coaches it: on a rung
  // they share, the general manager is asked about first (the owner's call; a coach always outranked him otherwise).
  const builder = (c: Claim) => (c.subject.kind === 'gm' && c.dir === 'blame' ? 1 : 0);
  open.sort(
    (a, b) =>
      fixed(b) - fixed(a) ||
      (fixed(a) ? 0 : b.rung - a.rung) ||
      (fixed(a) ? 0 : builder(b) - builder(a)) ||
      stakes(b) - stakes(a) ||
      b.margin - a.margin ||
      stableHash(`${opt.editionId}:${a.key}`) - stableHash(`${opt.editionId}:${b.key}`),
  );
  return open[0] ?? null;
}
