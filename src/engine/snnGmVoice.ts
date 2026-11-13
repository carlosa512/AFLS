/**
 * SNN's Column on a general manager, written as a piece (spec
 * `docs/superpowers/specs/2026-11-13-gm-column-voice-design.md`): whole paragraphs built on what he did, in place of
 * four slotted sentences that argued from the record alone. A piece is a lead (the strongest finding, told with its
 * names, picks, prices and years), a turn (the record said once, and a second finding from another family) and a close
 * (the judgment its rung allows). Every sentence is chosen by a condition on the finding, a time word included, so a
 * piece is reproducible from the league and says nothing the record does not hold.
 *
 * Variety is by construction: a family has two lead shapes or more that open on different subjects, a rung has
 * several closes, and what a piece used goes into its edition's `covered` keys (`gmShapeKey`), so no shape or close
 * runs twice in a league year while another is left.
 *
 * Its rules are its own (`storyRules.ts`): two to four paragraphs, two numbers a sentence, one short sentence a
 * paragraph, a last sentence that may be a judgment and names the man or the team, and a figure of speech only in
 * the close.
 */
import type { Finding, FindingFamily, Honor, PickFact } from './gmFindings';
import { gmSeasons } from './gmFindings';
import { POSITION_NAMES } from './positions';
import { pron } from './pronouns';
import { possessive } from './refer';
import { gmLeadKey, type Claim } from './snnColumn';
import type { GmMove, League, MoveSide } from './types';
import { OFFSEASON_PHASES } from './types';
import { stableHash } from './voice';

// ───────── names and small words ─────────

const M = (id: number) => `{M:${id}}`;
/** The team: its nickname the first time a piece names it, its city after. */
const C = (id: number) => `{C:${id}}`;
/** A team by its short form whatever came before. */
const c = (id: number) => `{c:${id}}`;
/** A team's bare nickname ("Tarpons"): write the article yourself. */
const N = (id: number) => `{N:${id}}`;
/** The general manager: his full name the first time a piece names him, his surname after (`nameGm`). */
const G = '{G}';
const Gs = '{Gs}';

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const w = (n: number) => (Number.isInteger(n) && n >= 0 && n < 10 ? SMALL[n] : String(n));
const NTH = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${tail}`;
};
const nth = (n: number) => NTH[n] ?? ordinal(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
/** "the first pick", "the 11th pick". */
const pickWords = (n: number) => `the ${nth(n)} pick`;
const posOf = (l: League, id: number) => {
  const pos = l.players[id].position;
  return pos === 'OL' ? 'offensive lineman' : POSITION_NAMES[pos].toLowerCase();
};
/** $K over a deal as a headline figure: "$43 million". */
const money = (total: number) => `$${Math.round(total / 1000)} million`;
const coachName = (l: League, id: number) => {
  const x = l.coaches[id] ?? l.retiredCoaches[id];
  return x ? `${x.firstName} ${x.lastName}` : '';
};

/** "a", "a and b", "a, b and c". */
const listOf = (parts: string[]) =>
  parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
/** Picks by round, the earliest first: "a first-round pick", "two second-round picks". */
function pickParts(picks: MoveSide['picks']): string[] {
  const by = new Map<number, number>();
  for (const p of picks) by.set(p.round, (by.get(p.round) ?? 0) + 1);
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([round, n]) => (n === 1 ? `a ${nth(round)}-round pick` : `${w(n)} ${nth(round)}-round picks`));
}
/**
 * What one side gave in a trade: any players by name, then the picks ("wide receiver Bryan Oliver and a first-round
 * pick"). A price that leaves a player out understates it.
 */
function priceWords(l: League, side: MoveSide): string {
  const men = side.players.filter((id) => l.players[id]);
  const players = men.length > 2 ? [`${w(men.length)} players`] : men.map((id) => `${posOf(l, id)} ${M(id)}`);
  return listOf([...players, ...pickParts(side.picks)]);
}
const firstsIn = (picks: MoveSide['picks']) => picks.filter((p) => p.round === 1).length;
const firstsWords = (n: number) => (n === 1 ? 'a first-round pick' : `${w(n)} first-round picks`);

// ───────── the sheet ─────────

/** What a shape may read about the man, his team and the claim, besides the finding itself. */
export interface GmSheet {
  l: League;
  teamId: number;
  /** "George Sutton", "Sutton". */
  gm: string;
  surname: string;
  /** "2–6". */
  rec: string;
  /** His finished seasons here, oldest first. */
  past: { season: number; w: number; l: number }[];
  season: number;
  rung: 2 | 3;
  dir: 'blame' | 'credit';
  /** Why he is credited (`claim.facts.why`). */
  why?: string;
  /** Two teams share this city: a headline names the team by its nickname. */
  shared: boolean;
  /** The team in a headline: its city, or "the Knights" where the city is shared. */
  town: string;
  /** "in Jacksonville", "with the Knights". */
  where: string;
  /** Losing seasons in a row behind him, counting back from last season. */
  lostRun: number;
  /** Wins over his finished seasons here. */
  wins: number;
  /** His pronouns, or hers: a general manager can be a woman (`pronouns.ts`). */
  p: ReturnType<typeof pron>;
  /** Winning seasons in a row behind him, counting back from last season. */
  winRun: number;
  /** Last season's record here. */
  last?: { w: number; l: number };
  /** How far the team went last season, when he is credited for following a deep run (`claim.facts.run`). */
  run?: string;
}

function sheetOf(l: League, claim: Claim, gmId: number): GmSheet {
  const gm = l.gms[gmId];
  const team = l.teams[claim.teamId];
  const past = gmSeasons(l, gmId, claim.teamId);
  const shared = l.teams.filter((t) => t.city === team.city).length > 1;
  let lostRun = 0;
  for (let i = past.length - 1; i >= 0 && past[i].w < past[i].l; i--) lostRun++;
  let winRun = 0;
  for (let i = past.length - 1; i >= 0 && past[i].w > past[i].l; i--) winRun++;
  const ctx = claim.context;
  return {
    l,
    teamId: claim.teamId,
    gm: `${gm.firstName} ${gm.lastName}`,
    surname: gm.lastName,
    rec: `${ctx.w}–${ctx.l}${ctx.t ? `–${ctx.t}` : ''}`,
    past,
    season: l.season,
    rung: claim.rung === 3 ? 3 : 2,
    dir: claim.dir === 'credit' ? 'credit' : 'blame',
    ...(typeof claim.facts.why === 'string' ? { why: claim.facts.why } : {}),
    shared,
    town: shared ? `the ${team.name}` : team.city,
    where: shared ? `with the ${team.name}` : `in ${team.city}`,
    lostRun,
    wins: past.reduce((n, s) => n + s.w, 0),
    winRun,
    p: pron(gm),
    ...(past.length ? { last: { w: past.at(-1)!.w, l: past.at(-1)!.l } } : {}),
    ...(typeof claim.facts.run === 'string' ? { run: claim.facts.run } : {}),
  };
}

// ───────── facts into words ─────────

/** "this season", "last season", or "in 2027": never "last season" for anything older. */
const when = (s: GmSheet, season: number) =>
  season === s.season ? 'this season' : season === s.season - 1 ? 'last season' : `in ${season}`;
/** A trade's moment against the season it belongs to. */
const tradeWhen = (m: Extract<GmMove, { kind: 'trade' }>) =>
  (OFFSEASON_PHASES as readonly string[]).includes(m.phase)
    ? `before the ${m.season} season`
    : `during the ${m.season} season`;
/** The honor a sentence should tell: an award before an All-League team, then the newest. */
const bestHonor = (honors: Honor[]) =>
  [...honors].sort((a, b) => Number(isTeam(a)) - Number(isTeam(b)) || b.season - a.season)[0];
const isTeam = (h: Honor) => h.what.endsWith('All-League');
const AWARD_WORDS: Record<string, string> = {
  'Most Valuable Player': "the league's most valuable player",
  'Offensive Player of the Year': 'the offensive player of the year',
  'Defensive Player of the Year': 'the defensive player of the year',
  'Offensive Rookie of the Year': 'the offensive rookie of the year',
  'Defensive Rookie of the Year': 'the defensive rookie of the year',
  'Comeback Player of the Year': 'the comeback player of the year',
};
/** "was the defensive player of the year", "made the first All-League team". */
const honorClause = (h: Honor) =>
  isTeam(h)
    ? `made the ${h.what.startsWith('first') ? 'first' : 'second'} All-League team`
    : `was ${AWARD_WORDS[h.what] ?? h.what.toLowerCase()}`;
/** Whether he has played a snap in any season the league has on record. */
const neverPlayed = (l: League, id: number) => Object.values(l.players[id].stats).every((line) => !line.snaps);
/** Where a player is now, as the end of a sentence about him. */
function nowClause(s: GmSheet, id: number, here: boolean): string {
  const p = s.l.players[id];
  if (here) return 'is not in the starting lineup this season';
  return p.teamId !== null && !p.retired ? `plays for ${c(p.teamId)} now` : 'is no longer with the team';
}
const LEFT_VERB = { traded: 'traded', cut: 'released', walked: 'did not re-sign' } as const;
const LEFT_HIM = { traded: 'traded him', cut: 'released him', walked: 'let him leave as a free agent' } as const;
/** "none", "one", "two"… of his picks, and the verb that agrees. */
const startWord = (n: number) => (n === 0 ? 'none' : w(n));
const startVerb = (n: number) => (n >= 2 ? 'start' : 'starts');

type Of<F extends FindingFamily> = Extract<Finding, { family: F }>;
/** A shape reads its own family's finding. */
const of =
  <F extends FindingFamily, R>(fn: (s: GmSheet, f: Of<F>) => R) =>
  (s: GmSheet, f: Finding) =>
    fn(s, f as Of<F>);
/** The first-round pick a sentence should single out: the highest one that does not start. */
const benched = (picks: PickFact[]) => [...picks].filter((p) => !p.starts).sort((a, b) => a.pick - b.pick)[0];
/** His quarterbacks in the order they first led the team. */
const passersOf = (f: Of<'qbs'>) => [...new Set(f.passers.map((p) => p.playerId))];

// ───────── shapes ─────────

export interface Shape {
  id: string;
  /** The finding it tells; a record sentence has none. */
  family?: FindingFamily;
  side: 'blame' | 'credit';
  /** A lead is a paragraph or two, a turn a sentence or two inside the second paragraph, the record one sentence. */
  role: 'lead' | 'turn' | 'record';
  when?: (s: GmSheet, f: Finding) => boolean;
  /** A lead may return a second paragraph: it opens the piece's second, ahead of the record and the turn. */
  text: (s: GmSheet, f: Finding) => string[];
  headline?: (s: GmSheet, f: Finding) => string;
  /** It gives the team's record itself: the piece adds no record sentence. */
  record?: true;
}

const BLAME_LEADS: Shape[] = [
  {
    id: 'b:qbPicks:1',
    family: 'qbPicks',
    side: 'blame',
    role: 'lead',
    when: of<'qbPicks', boolean>((_, f) => f.picks.length === 2),
    text: of<'qbPicks', string[]>((s, f) => {
      const [a, b] = f.picks;
      const later = b.season - a.season === 1 ? 'A year later' : `In ${b.season}`;
      const unplayed = neverPlayed(s.l, b.playerId) ? ', who has not played a snap' : '';
      const bench = f.picks.some((p) => p.starts) ? '' : ' Neither is the starter.';
      const third = !f.signed
        ? ''
        : f.signed.before
          ? ` Before either pick ${s.p.he} had signed a third, ${M(f.signed.playerId)}, to a ${w(f.signed.years)}-year contract.`
          : ` ${s.p.He} has also signed a third, ${M(f.signed.playerId)}, to a ${w(f.signed.years)}-year contract.`;
      return [
        `${G} used ${pickWords(a.pick)} of the ${a.season} draft on quarterback ${M(a.playerId)}. ${later} ${s.p.he} used ${pickWords(b.pick)} on another quarterback, ${M(b.playerId)}${unplayed}.${bench}${third}`,
      ];
    }),
    headline: of<'qbPicks', string>(
      (s, f) => `${s.surname} has drafted ${w(f.picks.length)} quarterbacks and ${s.town} are ${s.rec}`,
    ),
  },
  {
    id: 'b:qbPicks:2',
    family: 'qbPicks',
    side: 'blame',
    role: 'lead',
    text: of<'qbPicks', string[]>((s, f) => {
      const [a, b] = f.picks.slice(-2);
      const gap = b.season - a.season;
      const after = gap === 0 ? 'in the same draft as' : `${gap === 1 ? 'a year' : `${w(gap)} years`} after`;
      const many =
        f.picks.length > 2 ? `all ${w(f.picks.length)} of the team's first-round quarterbacks` : 'both picks';
      const bench = f.picks.some((p) => p.starts)
        ? ''
        : f.picks.length > 2
          ? ', and none of them is the starter'
          : ', and neither is the starter';
      return [
        `Quarterback ${M(b.playerId)} was ${pickWords(b.pick)} of the ${b.season} draft. ${C(s.teamId)} took him ${after} using ${pickWords(a.pick)} on ${M(a.playerId)}, who is also a quarterback. ${G} made ${many}${bench}.`,
      ];
    }),
    headline: of<'qbPicks', string>((s) => `${cap(s.town)} drafted a quarterback, then another, and are ${s.rec}`),
  },
  {
    id: 'b:left:1',
    family: 'left',
    side: 'blame',
    role: 'lead',
    text: of<'left', string[]>((s, f) => {
      const h = bestHonor(f.honors);
      return [
        `${cap(posOf(s.l, f.playerId))} ${M(f.playerId)} ${honorClause(h)} ${when(s, h.season)}, with ${c(h.teamId)}. ${C(s.teamId)} ${LEFT_HIM[f.how]} in ${f.season}, a decision ${G} made.`,
      ];
    }),
    headline: of<'left', string>(
      (s, f) => `${s.l.players[f.playerId].lastName} left ${s.town} and ${honorClause(bestHonor(f.honors))}`,
    ),
  },
  {
    id: 'b:left:2',
    family: 'left',
    side: 'blame',
    role: 'lead',
    text: of<'left', string[]>((s, f) => {
      const h = bestHonor(f.honors);
      return [
        `${G} ${LEFT_VERB[f.how]} ${posOf(s.l, f.playerId)} ${M(f.playerId)} in ${f.season}. ${M(f.playerId)} ${honorClause(h)} ${when(s, h.season)} with ${c(h.teamId)}.`,
      ];
    }),
    headline: of<'left', string>(
      (s, f) => `${s.surname} ${LEFT_VERB[f.how]} ${s.l.players[f.playerId].lastName}, and ${s.town} are ${s.rec}`,
    ),
  },
  {
    id: 'b:starTrade:1',
    family: 'starTrade',
    side: 'blame',
    role: 'lead',
    text: of<'starTrade', string[]>((s, f) => [
      `${G} sent ${c(f.move.otherId)} ${priceWords(s.l, f.move.gave)} for ${posOf(s.l, f.playerId)} ${M(f.playerId)} ${tradeWhen(f.move)}. ${M(f.playerId)} ${nowClause(s, f.playerId, f.here)}.`,
    ]),
    headline: of<'starTrade', string>(
      (s, f) =>
        `${s.surname} paid ${firstsWords(firstsIn(f.move.gave.picks))} for ${s.l.players[f.playerId].lastName}, and ${s.town} are ${s.rec}`,
    ),
  },
  {
    id: 'b:starTrade:2',
    family: 'starTrade',
    side: 'blame',
    role: 'lead',
    text: of<'starTrade', string[]>((s, f) => {
      const p = s.l.players[f.playerId];
      const since = f.here
        ? `${M(f.playerId)} does not start`
        : p.teamId !== null && !p.retired
          ? `${M(f.playerId)} has since left for ${c(p.teamId)}`
          : `${M(f.playerId)} is no longer with the team`;
      return [
        `${C(s.teamId)} gave up ${priceWords(s.l, f.move.gave)} to get ${posOf(s.l, f.playerId)} ${M(f.playerId)} ${tradeWhen(f.move)}. It was ${Gs} trade, and ${since}.`,
      ];
    }),
    headline: of<'starTrade', string>(
      (s, f) =>
        `${cap(s.town)} gave up ${firstsWords(firstsIn(f.move.gave.picks))} for ${s.l.players[f.playerId].lastName}`,
    ),
  },
  {
    id: 'b:contract:1',
    family: 'contract',
    side: 'blame',
    role: 'lead',
    text: of<'contract', string[]>((s, f) => [
      `${G} gave ${posOf(s.l, f.move.playerId)} ${M(f.move.playerId)} ${money(f.move.total)} over ${w(f.move.years)} ${plural(f.move.years, 'year')} in ${f.move.season}. ${M(f.move.playerId)} plays for ${c(f.nowTeamId!)} now.`,
    ]),
    headline: of<'contract', string>(
      (s, f) => `${s.l.players[f.move.playerId].lastName} got ${money(f.move.total)} from ${s.town} and is gone`,
    ),
  },
  {
    id: 'b:contract:2',
    family: 'contract',
    side: 'blame',
    role: 'lead',
    text: of<'contract', string[]>((s, f) => [
      `${cap(posOf(s.l, f.move.playerId))} ${M(f.move.playerId)} plays for ${c(f.nowTeamId!)}. In ${f.move.season} ${C(s.teamId)} signed him for ${money(f.move.total)} over ${w(f.move.years)} ${plural(f.move.years, 'year')}, a contract ${G} gave him.`,
    ]),
    headline: of<'contract', string>(
      (s, f) =>
        `${possessive(s.l.players[f.move.playerId].lastName)} ${money(f.move.total)} deal with ${s.town} did not last`,
    ),
  },
  {
    id: 'b:firsts:1',
    family: 'firsts',
    side: 'blame',
    role: 'lead',
    text: of<'firsts', string[]>((s, f) => {
      const x = benched(f.picks);
      return [
        `${G} has made ${w(f.picks.length)} first-round picks for ${C(s.teamId)}. ${cap(startWord(f.starting))} of them ${startVerb(f.starting)}. ${cap(posOf(s.l, x.playerId))} ${M(x.playerId)}, ${pickWords(x.pick)} in ${x.season}, ${nowClause(s, x.playerId, x.here)}.`,
      ];
    }),
    headline: of<'firsts', string>(
      (s, f) =>
        `${cap(startWord(f.starting))} of ${possessive(s.surname)} ${w(f.picks.length)} first-round picks ${startVerb(f.starting)} for ${s.town}`,
    ),
  },
  {
    id: 'b:firsts:2',
    family: 'firsts',
    side: 'blame',
    role: 'lead',
    text: of<'firsts', string[]>((s, f) => {
      const x = benched(f.picks);
      const p = s.l.players[x.playerId];
      const now = x.here
        ? `He does not start for ${C(s.teamId)}.`
        : p.teamId !== null && !p.retired
          ? `He plays for ${c(p.teamId)} now.`
          : `He is no longer with ${C(s.teamId)}.`;
      const count =
        f.starting === 0 ? 'none of them starts' : f.starting === 1 ? 'only one starts' : `${w(f.starting)} start`;
      return [
        `${cap(posOf(s.l, x.playerId))} ${M(x.playerId)} was ${pickWords(x.pick)} of the ${x.season} draft. ${now} He is one of ${w(f.picks.length)} first-round picks ${G} has made, and ${count}.`,
      ];
    }),
    headline: of<'firsts', string>((s, f) => {
      const x = benched(f.picks);
      return `${cap(s.town)} used ${pickWords(x.pick)} on ${s.l.players[x.playerId].lastName}, who ${x.here ? 'does not start' : 'is gone'}`;
    }),
  },
  {
    id: 'b:qbs:1',
    family: 'qbs',
    side: 'blame',
    role: 'lead',
    text: of<'qbs', string[]>((s, f) => {
      const d = passersOf(f);
      const list =
        d.length === 3 && f.passers.length === 3
          ? `${M(d[0])} was followed by ${M(d[1])}, and ${M(d[1])} by ${M(d[2])}.`
          : `The latest is ${M(d.at(-1)!)}.`;
      return [
        `${cap(w(d.length))} different quarterbacks have led ${C(s.teamId)} in passing in ${Gs} ${w(f.passers.length)} seasons. ${list}`,
      ];
    }),
    headline: of<'qbs', string>(
      (s, f) => `${cap(s.town)} are on their ${nth(passersOf(f).length)} quarterback under ${s.surname}`,
    ),
  },
  {
    id: 'b:qbs:2',
    family: 'qbs',
    side: 'blame',
    role: 'lead',
    // He is the newest of them: the count is his place in the line.
    when: of<'qbs', boolean>((_, f) => passersOf(f).at(-1) === f.passers.at(-1)!.playerId),
    text: of<'qbs', string[]>((s, f) => {
      const d = passersOf(f);
      const before =
        d.length === 3
          ? `${M(d[0])} and ${M(d[1])} came before him.`
          : `${cap(w(d.length - 1))} others came before him.`;
      return [
        `${M(d.at(-1)!)} is the ${nth(d.length)} quarterback to lead ${C(s.teamId)} in passing in ${w(f.passers.length)} seasons under ${G}. ${before}`,
      ];
    }),
    headline: of<'qbs', string>((s, f) =>
      `${w(passersOf(f).length)} quarterbacks in ${w(f.passers.length)} seasons under ${s.surname}`.replace(/^./, (x) =>
        x.toUpperCase(),
      ),
    ),
  },
  {
    id: 'b:coaches:1',
    family: 'coaches',
    side: 'blame',
    role: 'lead',
    text: of<'coaches', string[]>((s, f) => [
      `${coachName(s.l, f.coachIds.at(-1)!)} is the ${nth(f.coachIds.length)} head coach ${C(s.teamId)} have had in ${w(s.past.length + 1)} seasons. ${G} has been the general manager for all of them.`,
    ]),
    headline: of<'coaches', string>(
      (s, f) => `${s.surname} is on ${s.p.his} ${nth(f.coachIds.length)} head coach ${s.where}`,
    ),
  },
  {
    id: 'b:coaches:2',
    family: 'coaches',
    side: 'blame',
    role: 'lead',
    text: of<'coaches', string[]>((s, f) => {
      const k = f.coachIds.length;
      const times = k - 1 === 2 ? 'twice' : `${w(k - 1)} times`;
      const names =
        k === 3
          ? `${f.coachIds
              .slice(0, 2)
              .map((id) => coachName(s.l, id))
              .join(', ')} and ${coachName(s.l, f.coachIds[2])} have each had the job.`
          : `${coachName(s.l, f.coachIds.at(-1)!)} has the job now.`;
      return [
        `${C(s.teamId)} have changed head coaches ${times} in ${w(s.past.length + 1)} seasons under general manager ${G}. ${names}`,
      ];
    }),
    headline: of<'coaches', string>(
      (s, f) => `${cap(s.town)} have had ${w(f.coachIds.length)} head coaches and one general manager`,
    ),
  },
];

/** A second finding, told in a sentence or two after the record. */
const BLAME_TURNS: Shape[] = [
  {
    id: 'b:contract:turn',
    family: 'contract',
    side: 'blame',
    role: 'turn',
    text: of<'contract', string[]>((_, f) => [
      `The money has gone the same way. ${M(f.move.playerId)} got ${money(f.move.total)} over ${w(f.move.years)} ${plural(f.move.years, 'year')} in ${f.move.season} and plays for ${c(f.nowTeamId!)} now.`,
    ]),
  },
  {
    id: 'b:left:turn',
    family: 'left',
    side: 'blame',
    role: 'turn',
    text: of<'left', string[]>((s, f) => {
      const h = bestHonor(f.honors);
      return [
        `A good player has left in that time as well. ${M(f.playerId)} ${honorClause(h)} ${when(s, h.season)} with ${c(h.teamId)}.`,
      ];
    }),
  },
  {
    id: 'b:starTrade:turn',
    family: 'starTrade',
    side: 'blame',
    role: 'turn',
    text: of<'starTrade', string[]>((s, f) => [
      `${G} also paid ${c(f.move.otherId)} ${priceWords(s.l, f.move.gave)} for ${posOf(s.l, f.playerId)} ${M(f.playerId)}, who ${nowClause(s, f.playerId, f.here)}.`,
    ]),
  },
  {
    id: 'b:firsts:turn',
    family: 'firsts',
    side: 'blame',
    role: 'turn',
    text: of<'firsts', string[]>((s, f) => [
      `${G} has made ${w(f.picks.length)} first-round picks for ${c(s.teamId)}, and ${startWord(f.starting)} of them ${startVerb(f.starting)}.`,
    ]),
  },
  {
    id: 'b:qbs:turn',
    family: 'qbs',
    side: 'blame',
    role: 'turn',
    text: of<'qbs', string[]>((s, f) => [
      `${cap(w(passersOf(f).length))} different quarterbacks have led ${c(s.teamId)} in passing in that time.`,
    ]),
  },
  {
    id: 'b:coaches:turn',
    family: 'coaches',
    side: 'blame',
    role: 'turn',
    text: of<'coaches', string[]>((s, f) => [
      `${coachName(s.l, f.coachIds.at(-1)!)} is the ${nth(f.coachIds.length)} head coach ${c(s.teamId)} have had in that time.`,
    ]),
  },
  {
    id: 'b:qbPicks:turn',
    family: 'qbPicks',
    side: 'blame',
    role: 'turn',
    text: of<'qbPicks', string[]>((_, f) => [
      f.picks.length === 2
        ? `${G} has also used two first-round picks on quarterbacks, ${M(f.picks[0].playerId)} and ${M(f.picks[1].playerId)}.`
        : `${G} has also used ${w(f.picks.length)} first-round picks on quarterbacks.`,
    ]),
  },
];

const allLosing = (s: GmSheet) => s.lostRun === s.past.length;

/** The record, said once. The table beside the piece has the seasons row by row, so this never recites them. */
const BLAME_RECORDS: Shape[] = [
  {
    id: 'b:record:combined',
    side: 'blame',
    role: 'record',
    when: (s) => allLosing(s) && s.past.length >= 2 && s.past.length <= 4,
    text: (s) => [
      `The ${N(s.teamId)} won ${w(s.wins)} ${plural(s.wins, 'game')} in ${Gs} first ${w(s.past.length)} seasons combined and are ${s.rec} in ${s.p.his} ${nth(s.past.length + 1)}.`,
    ],
  },
  {
    id: 'b:record:run',
    side: 'blame',
    role: 'record',
    text: (s) => [`${C(s.teamId)} are ${s.rec} after ${w(s.lostRun)} losing seasons in a row under ${G}.`],
  },
  {
    id: 'b:record:each',
    side: 'blame',
    role: 'record',
    when: allLosing,
    text: (s) => [
      `${G} is in ${s.p.his} ${nth(s.past.length + 1)} season with ${C(s.teamId)}, who are ${s.rec} and had a losing record in each of the others.`,
    ],
  },
];

// ───────── credit ─────────

/** The honor to tell of a man he brought in or drafted: an award before an All-League team, then the first he won. */
const firstHonor = (honors: Honor[]) =>
  [...honors].sort((a, b) => Number(isTeam(a)) - Number(isTeam(b)) || a.season - b.season)[0];
/** When a pick's honor came, against his draft year: a rookie award says so itself. */
const sinceDraft = (s: GmSheet, drafted: number, h: Honor) =>
  h.what.includes('Rookie') ? '' : h.season === drafted ? ' as a rookie' : ` ${when(s, h.season)}`;
const offseason = (m: Extract<GmMove, { kind: 'trade' }>) => (OFFSEASON_PHASES as readonly string[]).includes(m.phase);
const bothOrAll = (n: number) => (n === 2 ? 'both' : `all ${w(n)}`);
const coachLast = (l: League, id: number) => (l.coaches[id] ?? l.retiredCoaches[id])?.lastName ?? '';
/** The newest of his first-round picks, and the highest. */
const newestPick = (picks: PickFact[]) => [...picks].sort((a, b) => b.season - a.season || a.pick - b.pick)[0];
const highestPick = (picks: PickFact[]) => [...picks].sort((a, b) => a.pick - b.pick)[0];

const CREDIT_LEADS: Shape[] = [
  {
    id: 'c:starTrade:1',
    family: 'starTrade',
    side: 'credit',
    role: 'lead',
    text: of<'starTrade', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      const time = h.season === f.move.season ? 'that year' : when(s, h.season);
      const title = f.title === h.season ? `, and ${c(s.teamId)} won the title` : '';
      const later =
        f.title !== null && f.title !== h.season ? ` ${C(s.teamId)} won the title ${when(s, f.title)}.` : '';
      const first = `${G} sent ${c(f.move.otherId)} ${priceWords(s.l, f.move.gave)} for ${posOf(s.l, f.playerId)} ${M(f.playerId)} ${tradeWhen(f.move)}. ${M(f.playerId)} ${honorClause(h)} ${time}${title}.${later}`;
      const a = f.again;
      if (!a) return [first];
      const then = a.season === s.season && offseason(a) ? 'This spring' : cap(tradeWhen(a));
      const whom = a.otherId === f.move.otherId ? 'the same team' : c(a.otherId);
      const got = a.got.players[0];
      return [
        first,
        `Trades like that usually look expensive by the second year. ${G} made another one instead. ${then} ${s.p.he} paid ${whom} ${priceWords(s.l, a.gave)} for ${posOf(s.l, got)} ${M(got)}.`,
      ];
    }),
    headline: of<'starTrade', string>((s, f) => {
      const last = s.l.players[f.playerId].lastName;
      return f.title !== null
        ? `${s.surname} paid for ${last} and ${s.town} got a title`
        : `The trade for ${last} has paid off ${s.where}`;
    }),
  },
  {
    id: 'c:starTrade:2',
    family: 'starTrade',
    side: 'credit',
    role: 'lead',
    text: of<'starTrade', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      const title = f.title === h.season ? `, and ${c(s.teamId)} won the title` : '';
      return [
        `${cap(posOf(s.l, f.playerId))} ${M(f.playerId)} ${honorClause(h)} ${when(s, h.season)}${title}. ${C(s.teamId)} got him from ${c(f.move.otherId)} ${tradeWhen(f.move)} for ${priceWords(s.l, f.move.gave)}, in a trade ${G} made.`,
      ];
    }),
    headline: of<'starTrade', string>(
      (s, f) =>
        `${s.l.players[f.playerId].lastName} has been worth ${firstsWords(firstsIn(f.move.gave.picks))} to ${s.town}`,
    ),
  },
  {
    id: 'c:class:1',
    family: 'class',
    side: 'credit',
    role: 'lead',
    text: of<'class', string[]>((s, f) => {
      const [a, b, third] = f.picks;
      const [ha, hb] = [firstHonor(a.honors), firstHonor(b.honors)];
      const same = b.season === a.season;
      const where = same ? 'of the same draft' : b.season - a.season === 1 ? 'a year later' : `in ${b.season}`;
      const extra = (() => {
        if (!third) return '';
        const h = firstHonor(third.honors);
        const together = third.season === a.season;
        // "A year later" leans on the draft year the paragraph opened with.
        const time =
          together && h.season === a.season + 1 && !h.what.includes('Rookie')
            ? ' a year later'
            : sinceDraft(s, third.season, h);
        return ` ${M(third.playerId)}, a ${nth(third.round)}-round pick${together ? '' : ` in ${third.season}`}, ${honorClause(h)}${time}.`;
      })();
      return [
        `${c(s.teamId)} took ${posOf(s.l, a.playerId)} ${M(a.playerId)} in the ${nth(a.round)} round in ${a.season}. He ${honorClause(ha)}${sinceDraft(s, a.season, ha)}. ${M(b.playerId)} went in the ${nth(b.round)} round ${where} and ${honorClause(hb)}${sinceDraft(s, b.season, hb)}.${extra}`,
        `${G} made ${f.picks.length === 2 ? 'both picks' : 'all three picks'}.`,
      ];
    }),
    headline: of<'class', string>((s) => `${cap(s.town)} keep winning with ${possessive(s.surname)} draft picks`),
  },
  {
    id: 'c:class:2',
    family: 'class',
    side: 'credit',
    role: 'lead',
    text: of<'class', string[]>((s, f) => {
      const [a, b] = f.picks;
      const [ha, hb] = [firstHonor(a.honors), firstHonor(b.honors)];
      const where = b.season === a.season ? 'of the same draft' : `in ${b.season}`;
      return [
        `${G} has drafted ${w(f.picks.length)} players who have won league honors with ${C(s.teamId)}. ${cap(posOf(s.l, a.playerId))} ${M(a.playerId)}, a ${nth(a.round)}-round pick in ${a.season}, ${honorClause(ha)}${sinceDraft(s, a.season, ha)}. ${M(b.playerId)}, taken in the ${nth(b.round)} round ${where}, ${honorClause(hb)}${sinceDraft(s, b.season, hb)}.`,
      ];
    }),
    headline: of<'class', string>(
      (s, f) => `${cap(w(f.picks.length))} of ${possessive(s.surname)} draft picks have won league honors ${s.where}`,
    ),
  },
  {
    id: 'c:lateFind:1',
    family: 'lateFind',
    side: 'credit',
    role: 'lead',
    text: of<'lateFind', string[]>((s, f) => {
      const h = firstHonor(f.pick.honors);
      return [
        `${cap(posOf(s.l, f.pick.playerId))} ${M(f.pick.playerId)} was the ${ordinal(f.pick.pick)} player taken in the ${f.pick.season} draft. He ${honorClause(h)}${sinceDraft(s, f.pick.season, h)}. ${G} found him in the ${nth(f.pick.round)} round.`,
      ];
    }),
    headline: of<'lateFind', string>(
      (s, f) => `${s.surname} found ${s.l.players[f.pick.playerId].lastName} in the ${nth(f.pick.round)} round`,
    ),
  },
  {
    id: 'c:lateFind:2',
    family: 'lateFind',
    side: 'credit',
    role: 'lead',
    text: of<'lateFind', string[]>((s, f) => {
      const h = firstHonor(f.pick.honors);
      return [
        `${G} took ${posOf(s.l, f.pick.playerId)} ${M(f.pick.playerId)} in the ${nth(f.pick.round)} round of the ${f.pick.season} draft, after ${f.pick.pick - 1} other players had gone. ${M(f.pick.playerId)} ${honorClause(h)}${sinceDraft(s, f.pick.season, h)}.`,
      ];
    }),
    headline: of<'lateFind', string>(
      (s, f) =>
        `${s.l.players[f.pick.playerId].lastName}, a ${nth(f.pick.round)}-round pick, ${honorClause(firstHonor(f.pick.honors))}`,
    ),
  },
  {
    id: 'c:qbs:1',
    family: 'qbs',
    side: 'credit',
    role: 'lead',
    text: of<'qbs', string[]>((s, f) => [
      `${cap(w(passersOf(f).length))} different quarterbacks have led ${C(s.teamId)} in passing in ${Gs} ${w(f.passers.length)} seasons. The team had a winning record in every one of those it has finished.`,
    ]),
    headline: of<'qbs', string>((s) => `${cap(s.town)} keep winning whoever plays quarterback`),
  },
  {
    id: 'c:qbs:2',
    family: 'qbs',
    side: 'credit',
    role: 'lead',
    when: of<'qbs', boolean>((_, f) => passersOf(f).at(-1) === f.passers.at(-1)!.playerId),
    text: of<'qbs', string[]>((s, f) => {
      const d = passersOf(f);
      return [
        `${M(d.at(-1)!)} is the ${nth(d.length)} quarterback to lead ${C(s.teamId)} in passing in ${w(f.passers.length)} seasons under ${G}. None of the changes has stopped the winning.`,
      ];
    }),
    headline: of<'qbs', string>((s) => `${s.surname} keeps changing quarterbacks and ${s.town} keep winning`),
  },
  {
    id: 'c:contract:1',
    family: 'contract',
    side: 'credit',
    role: 'lead',
    text: of<'contract', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      const time = h.season === f.move.season ? 'that season' : when(s, h.season);
      return [
        `${G} gave ${posOf(s.l, f.move.playerId)} ${M(f.move.playerId)} ${money(f.move.total)} over ${w(f.move.years)} ${plural(f.move.years, 'year')} in ${f.move.season}. ${M(f.move.playerId)} ${honorClause(h)} ${time} and starts for ${C(s.teamId)}.`,
      ];
    }),
    headline: of<'contract', string>(
      (s, f) => `${s.l.players[f.move.playerId].lastName} has been worth ${money(f.move.total)} to ${s.town}`,
    ),
  },
  {
    id: 'c:contract:2',
    family: 'contract',
    side: 'credit',
    role: 'lead',
    text: of<'contract', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      return [
        `${cap(posOf(s.l, f.move.playerId))} ${M(f.move.playerId)} ${honorClause(h)} ${when(s, h.season)}. He came to ${C(s.teamId)} in ${f.move.season} on a ${w(f.move.years)}-year contract worth ${money(f.move.total)}, which ${G} gave him.`,
      ];
    }),
    headline: of<'contract', string>(
      (s, f) => `${possessive(s.surname)} ${money(f.move.total)} signing has paid off ${s.where}`,
    ),
  },
  {
    id: 'c:firsts:1',
    family: 'firsts',
    side: 'credit',
    role: 'lead',
    text: of<'firsts', string[]>((s, f) => {
      const x = newestPick(f.picks);
      return [
        `${G} has made ${w(f.picks.length)} first-round picks for ${C(s.teamId)}, and ${bothOrAll(f.picks.length)} start. The latest, ${posOf(s.l, x.playerId)} ${M(x.playerId)}, was ${pickWords(x.pick)} ${x.season === s.season ? 'this year' : `in ${x.season}`}.`,
      ];
    }),
    headline: of<'firsts', string>(
      (s, f) => `${cap(bothOrAll(f.picks.length))} of ${possessive(s.surname)} first-round picks start for ${s.town}`,
    ),
  },
  {
    id: 'c:firsts:2',
    family: 'firsts',
    side: 'credit',
    role: 'lead',
    text: of<'firsts', string[]>((s, f) => {
      const x = highestPick(f.picks);
      const rest = f.picks.length - 1;
      const others = rest === 1 ? 'does the other first-round pick' : `do the other ${w(rest)} first-round picks`;
      return [
        `${cap(posOf(s.l, x.playerId))} ${M(x.playerId)} was ${pickWords(x.pick)} of the ${x.season} draft and starts for ${C(s.teamId)}. So ${others} ${G} has made.`,
      ];
    }),
    headline: of<'firsts', string>((s) => `${s.surname} has not missed in the first round ${s.where}`),
  },
  {
    id: 'c:coaches:1',
    family: 'coaches',
    side: 'credit',
    role: 'lead',
    record: true,
    when: of<'coaches', boolean>((s, f) => !!f.newCoach && !!s.last),
    text: of<'coaches', string[]>((s, f) => [
      `${G} hired ${coachName(s.l, f.coachIds[0])} as head coach before this season. ${C(s.teamId)} won ${w(s.last!.w)} ${plural(s.last!.w, 'game')} last season and are ${s.rec} under ${coachLast(s.l, f.coachIds[0])}.`,
    ]),
    headline: of<'coaches', string>(
      (s, f) => `${s.surname} hired ${coachLast(s.l, f.coachIds[0])} and ${s.town} are ${s.rec}`,
    ),
  },
  {
    id: 'c:coaches:2',
    family: 'coaches',
    side: 'credit',
    role: 'lead',
    record: true,
    when: of<'coaches', boolean>((s, f) => !!f.newCoach && !!s.last),
    text: of<'coaches', string[]>((s, f) => [
      `${coachName(s.l, f.coachIds[0])} is in his first season as head coach of ${C(s.teamId)}, who are ${s.rec}. ${G} hired him after a ${s.last!.w}–${s.last!.l} season.`,
    ]),
    headline: of<'coaches', string>(
      (s, f) => `${coachLast(s.l, f.coachIds[0])} is ${s.rec} in his first season ${s.where}`,
    ),
  },
  {
    id: 'c:coaches:3',
    family: 'coaches',
    side: 'credit',
    role: 'lead',
    record: true,
    when: of<'coaches', boolean>((_, f) => f.hiredFirst),
    text: of<'coaches', string[]>((s, f) => [
      `In ${s.past[0].season} ${G} hired ${coachName(s.l, f.coachIds[0])} as head coach, in ${s.p.his} first year with ${C(s.teamId)}. ${coachLast(s.l, f.coachIds[0])} is still the head coach, and ${c(s.teamId)} are ${s.rec}.`,
    ]),
    headline: of<'coaches', string>(
      (s, f) =>
        `${s.surname} and ${coachLast(s.l, f.coachIds[0])} are in their ${nth(s.past.length + 1)} season together ${s.where}`,
    ),
  },
  {
    id: 'c:coaches:4',
    family: 'coaches',
    side: 'credit',
    role: 'lead',
    record: true,
    when: of<'coaches', boolean>((_, f) => f.hiredFirst),
    text: of<'coaches', string[]>((s, f) => [
      `${coachName(s.l, f.coachIds[0])} has been head coach of ${C(s.teamId)} for ${w(s.past.length + 1)} seasons, all of them under ${G}, who hired him. The team is ${s.rec} this season.`,
    ]),
    headline: of<'coaches', string>(
      (s, f) =>
        `${coachLast(s.l, f.coachIds[0])} was ${possessive(s.surname)} first hire ${s.where}, and is still winning`,
    ),
  },
];

const CREDIT_TURNS: Shape[] = [
  {
    id: 'c:starTrade:turn',
    family: 'starTrade',
    side: 'credit',
    role: 'turn',
    text: of<'starTrade', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      return [
        `${G} also paid ${c(f.move.otherId)} ${priceWords(s.l, f.move.gave)} for ${posOf(s.l, f.playerId)} ${M(f.playerId)}, who ${honorClause(h)} ${when(s, h.season)}.`,
      ];
    }),
  },
  {
    id: 'c:class:turn',
    family: 'class',
    side: 'credit',
    role: 'turn',
    text: of<'class', string[]>((s, f) => [
      `${M(f.picks[0].playerId)} and ${M(f.picks[1].playerId)}, both drafted by ${G}, have won league honors with ${c(s.teamId)}.`,
    ]),
  },
  {
    id: 'c:lateFind:turn',
    family: 'lateFind',
    side: 'credit',
    role: 'turn',
    text: of<'lateFind', string[]>((s, f) => {
      const h = firstHonor(f.pick.honors);
      return [
        `${M(f.pick.playerId)}, a ${nth(f.pick.round)}-round pick in ${f.pick.season}, ${honorClause(h)}${sinceDraft(s, f.pick.season, h)}.`,
      ];
    }),
  },
  {
    id: 'c:qbs:turn',
    family: 'qbs',
    side: 'credit',
    role: 'turn',
    text: of<'qbs', string[]>((s, f) => [
      `${cap(w(passersOf(f).length))} different quarterbacks have led ${c(s.teamId)} in passing in that time, and the winning has not stopped.`,
    ]),
  },
  {
    id: 'c:contract:turn',
    family: 'contract',
    side: 'credit',
    role: 'turn',
    text: of<'contract', string[]>((s, f) => {
      const h = firstHonor(f.honors);
      return [
        `${M(f.move.playerId)} signed for ${money(f.move.total)} in ${f.move.season} and ${honorClause(h)} ${when(s, h.season)}.`,
      ];
    }),
  },
  {
    id: 'c:firsts:turn',
    family: 'firsts',
    side: 'credit',
    role: 'turn',
    text: of<'firsts', string[]>((s, f) => [
      `${G} has made ${w(f.picks.length)} first-round picks for ${c(s.teamId)}, and ${bothOrAll(f.picks.length)} start.`,
    ]),
  },
  {
    id: 'c:coaches:turn',
    family: 'coaches',
    side: 'credit',
    role: 'turn',
    text: of<'coaches', string[]>((s, f) => [
      f.newCoach
        ? `${G} hired ${coachName(s.l, f.coachIds[0])} as head coach before this season.`
        : `${coachName(s.l, f.coachIds[0])} has been the head coach for all of it, and ${G} hired him.`,
    ]),
  },
];

/** The record in a credit piece: what he is credited for decides which one, so each claim has one way to say it. */
const CREDIT_RECORDS: Shape[] = [
  {
    id: 'c:record:run',
    side: 'credit',
    role: 'record',
    when: (s) => s.why === 'run',
    text: (s) => {
      const ran =
        s.run === 'title'
          ? 'won the title'
          : s.run === 'final'
            ? 'reached the final'
            : 'reached their conference final';
      return [`The ${N(s.teamId)} ${ran} last season and are ${s.rec} now.`];
    },
  },
  {
    id: 'c:record:built',
    side: 'credit',
    role: 'record',
    when: (s) => s.why === 'built',
    text: (s) => [`${C(s.teamId)} are ${s.rec} after ${w(s.winRun)} winning seasons in a row under ${G}.`],
  },
  {
    id: 'c:record:turn',
    side: 'credit',
    role: 'record',
    when: (s) => s.why === 'hire' && !!s.last,
    text: (s) => [`${C(s.teamId)} won ${w(s.last!.w)} ${plural(s.last!.w, 'game')} last season and are ${s.rec} now.`],
  },
  {
    id: 'c:record:now',
    side: 'credit',
    role: 'record',
    when: (s) => !['run', 'built', 'hire'].includes(s.why ?? '') || (s.why === 'hire' && !s.last),
    text: (s) => [`${C(s.teamId)} are ${s.rec} in ${Gs} ${nth(s.past.length + 1)} season.`],
  },
];

export const SHAPES: readonly Shape[] = [
  ...BLAME_LEADS,
  ...BLAME_TURNS,
  ...BLAME_RECORDS,
  ...CREDIT_LEADS,
  ...CREDIT_TURNS,
  ...CREDIT_RECORDS,
];

// ───────── closes ─────────

export interface Close {
  id: string;
  /** The rung and side it closes: "fair to ask", "it is time", credit. */
  on: '2-' | '3-' | '+';
  /** Tied to the lead's family: it picks up what the lead said. */
  family?: FindingFamily;
  /**
   * It is built on a second finding of this family, which must be on the record (and, unless `leadToo`, must not be
   * the lead itself): the piece then tells that finding here and not as its turn.
   */
  also?: FindingFamily;
  leadToo?: true;
  /** It gives the team's record itself: the piece adds no record sentence. */
  record?: true;
  text: (s: GmSheet, lead: Finding, also?: Finding) => string;
}

/** How many tries at a quarterback the finding counts: his first-round picks and a long contract. */
const tries = (f: Of<'qbPicks'>) => f.picks.length + (f.signed ? 1 : 0);

export const CLOSES: readonly Close[] = [
  {
    id: 'b2:1',
    on: '2-',
    text: (s) =>
      `None of this is bad luck. These were ${Gs} decisions, and it is fair to ask how many more of them ${c(s.teamId)} can afford.`,
  },
  {
    id: 'b2:2',
    on: '2-',
    text: (s) =>
      `One losing season can happen to anyone. ${cap(w(s.lostRun + 1))} in a row is a pattern, and it is fair to ask how long ${G} gets to change it.`,
  },
  {
    id: 'b2:3',
    on: '2-',
    text: (s) =>
      `The roster that is ${s.rec} is the one ${G} built. It is fair to ask whether ${c(s.teamId)} should let ${s.p.him} build the next one.`,
  },
  {
    id: 'b2:4',
    on: '2-',
    text: (s) =>
      `General managers are judged over seasons, not weeks. ${G} has had ${w(s.past.length + 1)} of them, and it is fair to ask what ${c(s.teamId)} would get from another.`,
  },
  {
    id: 'b2:5',
    on: '2-',
    text: (s) =>
      `Every losing team is told that it takes time. ${G} has had ${w(s.past.length + 1)} seasons, and it is fair to ask what they have bought ${c(s.teamId)}.`,
  },
  {
    id: 'b2:qbPicks',
    on: '2-',
    family: 'qbPicks',
    text: of<'qbPicks', string>(
      (s, f) =>
        `A general manager gets one try at a quarterback before the questions start. ${s.p.He} has had ${w(tries(f))}. It is fair to ask whether ${G} gets another season to find one.`,
    ),
  },
  {
    id: 'b2:starTrade',
    on: '2-',
    family: 'starTrade',
    text: of<'starTrade', string>((s, f) => {
      const n = firstsIn(f.move.gave.picks);
      return `A first-round pick is how a losing team gets better. ${G} spent ${n === 1 ? 'one' : w(n)} on ${M(f.playerId)}, and the team is ${s.rec}. It is fair to ask whether ${c(s.teamId)} should trust ${s.p.him} with the next one.`;
    }),
  },
  {
    id: 'b3:1',
    on: '3-',
    text: (s) =>
      `This column asked about ${G} a year ago. A ${s.rec} record is the answer, and it is time for ${c(s.teamId)} to find a new general manager.`,
  },
  {
    id: 'b3:2',
    on: '3-',
    text: (s) =>
      `The losing has now lasted ${w(s.lostRun + 1)} seasons under ${G}. It is time for ${c(s.teamId)} to let someone else try.`,
  },
  {
    id: 'b3:3',
    on: '3-',
    text: (s) => `None of this is new, which is the problem. It is time for a change in the front office ${s.where}.`,
  },
  {
    id: 'b3:4',
    on: '3-',
    text: (s) =>
      `A year ago the question was whether ${G} should stay. ${c(s.teamId)} have their answer at ${s.rec}, and it is time to act on it.`,
  },
  {
    id: 'b3:qbPicks',
    on: '3-',
    family: 'qbPicks',
    text: of<'qbPicks', string>(
      (s, f) =>
        `A general manager gets one try at a quarterback, and ${G} has had ${w(tries(f))}. It is time for ${c(s.teamId)} to let someone else make the next one.`,
    ),
  },
  {
    id: 'b3:starTrade',
    on: '3-',
    family: 'starTrade',
    text: of<'starTrade', string>((s, f) => {
      const n = firstsIn(f.move.gave.picks);
      return `${G} spent ${firstsWords(n)} on ${M(f.playerId)}, and the team is ${s.rec}. It is time for ${c(s.teamId)} to let someone else make the next trade.`;
    }),
  },
  {
    id: 'c+:1',
    on: '+',
    text: (s) =>
      `Good teams are built in the offseason, when nobody is watching. ${G} has had ${w(s.past.length + 1)} of them with ${c(s.teamId)}, and the standings show how ${s.p.he} used them.`,
  },
  {
    id: 'c+:2',
    on: '+',
    text: (s) =>
      `The head coach and the quarterback get the credit when a team wins. Some of it belongs to ${G}, who found the players for ${c(s.teamId)}.`,
  },
  {
    id: 'c+:3',
    on: '+',
    text: (s) => `None of this is luck. These were ${Gs} decisions, and ${c(s.teamId)} are ${s.rec} because of them.`,
  },
  {
    id: 'c+:4',
    on: '+',
    text: (s) =>
      `Every team in the league is looking for the same players. ${G} keeps finding them first, and ${c(s.teamId)} are ${s.rec} for it.`,
  },
  {
    id: 'c+:starTrade',
    on: '+',
    family: 'starTrade',
    record: true,
    text: of<'starTrade', string>((s, f) => {
      const deals = [f.move, ...(f.again ? [f.again] : [])];
      const firsts = deals.reduce((n, d) => n + firstsIn(d.gave.picks), 0);
      const mvp = f.honors.some((h) => h.what === 'Most Valuable Player' && h.season === s.season - 1);
      const passer = mvp && s.l.players[f.playerId].position === 'QB';
      const open =
        deals.length === 2
          ? `That is ${w(firsts)} first-round picks for two players.`
          : firsts === 1
            ? 'A first-round pick is a high price for one player.'
            : `${cap(w(firsts))} first-round picks is a high price for one player.`;
      return `${open} The ${N(s.teamId)} are ${s.rec}${passer ? " with last season's most valuable player at quarterback" : ''}, and nobody ${s.where} is asking for the ${firsts === 1 ? 'pick' : 'picks'} back.`;
    }),
  },
  {
    id: 'c+:class',
    on: '+',
    family: 'class',
    text: (s) =>
      `Draft picks are the cheapest way to build a team and the hardest to get right. ${G} keeps getting them right, and ${c(s.teamId)} are ${s.rec} because of it.`,
  },
  {
    id: 'c+:qbs',
    on: '+',
    also: 'qbs',
    text: (s, _lead, also) => {
      const f = also as Of<'qbs'>;
      const d = passersOf(f).length;
      const each =
        d === f.passers.length
          ? `have started a different one in each of ${Gs} ${w(d)} seasons`
          : `have started ${w(d)} of them in ${Gs} ${w(f.passers.length)} seasons`;
      return `Plenty of teams win for a year on a quarterback. ${c(s.teamId)} ${each} and kept winning, which says the roster is doing it.`;
    },
  },
  {
    id: 'c+:coaches',
    on: '+',
    also: 'coaches',
    leadToo: true,
    record: true,
    text: (s, lead, also) => {
      const f = also as Of<'coaches'>;
      // The lead has given his full name when the piece opened on the hire.
      const name = lead === also ? coachLast(s.l, f.coachIds[0]) : coachName(s.l, f.coachIds[0]);
      const turned = f.newCoach && s.last && s.last.w < s.last.l;
      const now = turned
        ? `have gone from ${w(s.last!.w)} ${plural(s.last!.w, 'win')} last season to ${s.rec}`
        : `are ${s.rec}`;
      return `A general manager makes no bigger decision than the head coach. ${G} chose ${name}, and ${c(s.teamId)} ${now}.`;
    },
  },
];

// ───────── the piece ─────────

/** What an edition keeps (in `covered`) of a shape or close a piece used, so it does not run again that league year. */
export const gmShapeKey = (season: number, id: string) => `gmshape:${season}:${id}`;

export interface GmPiece {
  headline: string;
  /** In the edition's tokens: `compose` names the players and the teams. */
  paragraphs: string[];
  /** The claim, the family it led with, and every shape and close it used. */
  covers: string[];
}

/** The players a finding is about. A second finding about any of the lead's players is the same story told twice. */
function playersOf(f: Finding): number[] {
  switch (f.family) {
    case 'qbPicks':
      return [...f.picks.map((p) => p.playerId), ...(f.signed ? [f.signed.playerId] : [])];
    case 'firsts':
    case 'class':
      return f.picks.map((p) => p.playerId);
    case 'lateFind':
      return [f.pick.playerId];
    case 'starTrade':
    case 'left':
      return [f.playerId];
    case 'contract':
      return [f.move.playerId];
    default:
      // Who led the team in passing, and who coached it, are counts: they retell nobody.
      return [];
  }
}
const HEADLINE = 70;

/** His name where the tokens stand: in full the first time the piece names him, his surname after. */
function nameGm(paragraphs: string[], s: GmSheet): string[] {
  let named = false;
  return paragraphs.map((p) =>
    p.replace(/\{Gs?\}/g, (token) => {
      const name = named ? s.surname : s.gm;
      named = true;
      return token === Gs ? possessive(name) : name;
    }),
  );
}

/**
 * The piece for a GM's claim, or null when the claim has no finding to build on. `have` is what SNN has told
 * (`toldKeys`): a shape or close it holds is passed over while another is left.
 */
export function gmPiece(l: League, claim: Claim, have: Set<string>): GmPiece | null {
  const findings = claim.findings ?? [];
  if (claim.subject.kind !== 'gm' || !findings.length) return null;
  const gmId = claim.subject.gmId;
  const s = sheetOf(l, claim, gmId);
  const used = (id: string) => have.has(gmShapeKey(s.season, id));
  const order = <T extends { id: string }>(xs: T[]) =>
    [...xs].sort((a, b) => stableHash(claim.key + a.id) - stableHash(claim.key + b.id));
  const shapesFor = (f: Finding | null, role: Shape['role']) =>
    order(
      SHAPES.filter(
        (x) =>
          x.side === s.dir && x.role === role && x.family === f?.family && (!x.when || x.when(s, f ?? findings[0])),
      ),
    );

  // The lead: the first finding with a shape SNN has not used this year, else the first with any.
  const leads = findings.map((f) => ({ f, shapes: shapesFor(f, 'lead') })).filter((x) => x.shapes.length);
  const fresh = leads.find((x) => x.shapes.some((sh) => !used(sh.id)));
  const lead = fresh ?? leads[0];
  if (!lead) return null;
  // Not the shape or the close his last piece used a year ago, while there is another: a family may lead again when it
  // has a new fact, and it should not read as last year's piece did.
  const lastYear = (id: string) => have.has(gmShapeKey(s.season - 1, id));
  const ledLast = have.has(gmLeadKey(s.season - 1, gmId, claim.teamId, lead.f.family));
  const leadShape =
    lead.shapes.find((sh) => !used(sh.id) && !(ledLast && lastYear(sh.id))) ??
    lead.shapes.find((sh) => !used(sh.id)) ??
    lead.shapes[0];

  // The close first: one built on a second finding takes that finding, and one that gives the record replaces it.
  const on = s.dir === 'credit' ? '+' : s.rung === 3 ? '3-' : '2-';
  const alsoOf = (x: Close) => findings.find((f) => f.family === x.also && (x.leadToo || f !== lead.f));
  const closes = order(
    CLOSES.filter((x) => x.on === on && (!x.family || x.family === lead.f.family) && (!x.also || alsoOf(x))),
  );
  const plain = (x: Close) => !x.family && !x.also;
  const close =
    closes.find((x) => x.also && !used(x.id)) ??
    closes.find((x) => x.family && !used(x.id) && !lastYear(x.id)) ??
    closes.find((x) => plain(x) && !used(x.id) && !lastYear(x.id)) ??
    closes.find((x) => !x.also && !used(x.id)) ??
    closes[0];
  if (!close) return null;
  const also = close.also ? alsoOf(close) : undefined;

  // The record, then a second finding from another family about other players, only in a shape not used this year.
  const told = new Set(playersOf(lead.f));
  const records = leadShape.record || close.record ? [] : shapesFor(null, 'record');
  const record = records.find((sh) => !used(sh.id)) ?? records[0];
  const turn = findings
    .filter((f) => f.family !== lead.f.family && f !== also && !playersOf(f).some((id) => told.has(id)))
    .flatMap((f) =>
      shapesFor(f, 'turn')
        .filter((sh) => !used(sh.id))
        .map((sh) => ({ f, sh })),
    )[0];

  const [first, ...tail] = leadShape.text(s, lead.f);
  const second = [...tail, ...(record ? record.text(s, lead.f) : []), ...(turn ? turn.sh.text(s, turn.f) : [])].join(
    ' ',
  );
  const closing = close.text(s, lead.f, also);
  // The record alone opens the close: a paragraph of one sentence reads as a caption.
  // A second point with nothing beside it joins the lead: a paragraph of one sentence reads as a caption.
  const lone = !!turn && !record && !tail.length;
  const body = !second
    ? [first, closing]
    : lone
      ? [`${first} ${second}`, closing]
      : turn || tail.length
        ? [first, second, closing]
        : [first, `${second} ${closing}`];
  const made = leadShape.headline?.(s, lead.f) ?? '';
  const fallback =
    s.dir === 'credit'
      ? s.why === 'run'
        ? `${s.surname} has kept it together ${s.where}`
        : s.why === 'hire'
          ? `${s.surname} got it right ${s.where}`
          : `${s.surname} built this ${s.where}`
      : s.rung === 3
        ? `It is time for a change in the front office ${s.where}`
        : `The losing ${s.where} points at ${s.surname}`;
  return {
    headline: made && made.length <= HEADLINE ? made : fallback,
    paragraphs: nameGm(body.slice(0, 4), s),
    covers: [
      claim.key,
      gmLeadKey(s.season, gmId, claim.teamId, lead.f.family),
      ...[leadShape.id, ...(record ? [record.id] : []), ...(turn ? [turn.sh.id] : []), close.id].map((id) =>
        gmShapeKey(s.season, id),
      ),
    ],
  };
}
