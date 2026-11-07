/**
 * An AI general manager in words: his reputation (the dials, said plainly), what the league has noticed about how he
 * works (his habit log, read as one man's story) and the director's tip on a deal. The fog rule: nothing here names a
 * habit, an archetype, a grip or a number. A line is chosen by the facts the log shows (once, a habit, faded), steady
 * within a season through `say`.
 */
import { archetypeOf, draftedBy, HABIT_IDS, type HabitId } from './gmHabits';
import { ARCHETYPE_ACTIVITY } from './gmTraits';
import { POSITION_NAMES } from './positions';
import { pron } from './pronouns';
import { starters } from './roster';
import { tradeContext } from './trade/context';
import { STAR } from './trade/judge';
import { marketValue } from './trade/value';
import type { GeneralManager, HabitMove, League, Position, Team, TradeSide } from './types';
import { say, type Line } from './voice';

export type Evidence = 'once' | 'habit' | 'faded';

export interface HabitFact {
  habit: HabitId;
  evidence: Evidence;
  pos?: Position;
  /** Seasons since his latest use. */
  ago: number;
  /** Uses in the last four seasons. */
  count: number;
  name: string;
  his: string;
  /** His pronouns (hers, for a woman): every line about him reads them from here. */
  p: Pron;
}

type Pron = ReturnType<typeof pron>;
const RECENT = 3;
const NAME_OF = (gm: GeneralManager) => `${gm.firstName} ${gm.lastName}`;

export const ago = (seasons: number, unit?: 'draft'): string => {
  if (seasons <= 0) return 'this year';
  if (seasons === 1) return 'last year';
  if (seasons === 2) return unit === 'draft' ? 'two drafts ago' : 'two years ago';
  return 'a few years back';
};

const SPAN = ['no time', 'a year', 'two years', 'three years', 'four years'];
const spanOf = (n: number) => SPAN[n] ?? 'a few years';

/** His log as facts, most recent first. A move whose player has left the league is dropped, never guessed at. */
export function habitFacts(league: League, gm: GeneralManager): HabitFact[] {
  const by = new Map<HabitId, HabitMove[]>();
  for (const m of gm.habitLog ?? []) {
    if (!HABIT_IDS.includes(m.habit as HabitId)) continue;
    if (m.playerId !== undefined && !league.players[m.playerId]) continue;
    const list = by.get(m.habit as HabitId);
    if (list) list.push(m);
    else by.set(m.habit as HabitId, [m]);
  }
  const out: HabitFact[] = [];
  for (const [habit, moves] of by) {
    const latest = moves.reduce((a, b) => (b.season > a.season ? b : a));
    const count = moves.filter((m) => m.season >= league.season - RECENT).length;
    out.push({
      habit,
      evidence: count >= 2 ? 'habit' : count === 1 ? 'once' : 'faded',
      pos: habit === 'gunShy' ? (latest.pos ?? [...moves].reverse().find((m) => m.pos)?.pos) : undefined,
      ago: league.season - latest.season,
      count,
      name: NAME_OF(gm),
      his: pron(gm).his,
      p: pron(gm),
    });
  }
  return out.sort((a, b) => a.ago - b.ago || HABIT_IDS.indexOf(a.habit) - HABIT_IDS.indexOf(b.habit));
}

// ---- reputation ----

type Dial = 'activity' | 'stubbornness' | 'winNow' | 'loyalty' | 'capAggression';
const HIGH = 0.65;
const LOW = 0.35;

/** `$his` is filled from the GM's pronouns. */
export const PHRASES: Record<Dial, { high: readonly string[]; low: readonly string[] }> = {
  activity: {
    high: ['always on the phone', 'works the phones every week'],
    low: ['hard to get on the phone', 'rarely makes a call'],
  },
  stubbornness: {
    high: ['drives a hard bargain', "doesn't give an inch"],
    low: ['easy to deal with', 'meets you halfway'],
  },
  winNow: {
    high: ['always chasing this year', 'plays for today'],
    low: ['plays the long game', 'builds for three years out'],
  },
  loyalty: {
    high: ['pays $his own', 'takes care of $his players'],
    low: ['lets players walk', 'never overpays to keep anyone'],
  },
  capAggression: {
    high: ['lives on the edge of the cap', 'pushes money down the road'],
    low: ['keeps a clean cap sheet', 'never borrows from next year'],
  },
};

export function reputation(league: League, gm: GeneralManager, form: 'sentence' | 'fragment' = 'sentence'): string {
  const p = pron(gm);
  const t = gm.teamId === null ? gm.traits : league.teams[gm.teamId]?.gm;
  const dials: Record<Dial, number> = {
    activity: ARCHETYPE_ACTIVITY[archetypeOf(league, gm)] ?? 0.5,
    stubbornness: t?.stubbornness ?? 0.5,
    winNow: t?.winNow ?? 0.5,
    loyalty: t?.loyalty ?? 0.5,
    capAggression: t?.capAggression ?? 0.5,
  };
  const said = (Object.keys(dials) as Dial[])
    .filter((d) => dials[d] >= HIGH || dials[d] <= LOW)
    .sort((a, b) => Math.abs(dials[b] - 0.5) - Math.abs(dials[a] - 0.5))
    .slice(0, 2)
    .map((d) => {
      const bank: Line<null>[] = PHRASES[d][dials[d] >= HIGH ? 'high' : 'low'].map((s) => ({ text: () => s }));
      return say(bank, null, { key: `gm:${gm.id}`, slot: d }).replace('$his', p.his);
    });
  if (!said.length) return form === 'sentence' ? 'Hard to pin down.' : 'hard to pin down';
  if (form === 'fragment') return said.join('; ');
  return said.length === 1 ? `${p.He}'s ${said[0]}.` : `${p.He}'s ${said[0]}, and ${said[1]}.`;
}

// ---- what the league has noticed ----

const P = (f: HabitFact) => (f.pos ? POSITION_NAMES[f.pos].toLowerCase() : 'veteran');
const L = (habit: HabitId, evidence: Evidence, ...texts: ((f: HabitFact) => string)[]): Line<HabitFact>[] =>
  texts.map((text) => ({ when: (f) => f.habit === habit && f.evidence === evidence, reads: 2, text }));
const D = (f: HabitFact) => ago(f.ago, 'draft');
const A = (f: HabitFact) => ago(f.ago);

export const NOTICED: readonly Line<HabitFact>[] = [
  ...L(
    'bridgeQb',
    'once',
    (f) => `Brought in a veteran to hold the quarterback job while ${f.p.his} young one learns.`,
    () => 'Signed an older quarterback to keep the seat warm for the kid.',
  ),
  ...L(
    'bridgeQb',
    'habit',
    (f) => `${f.p.He} likes a veteran at quarterback while the young one learns. Every year, it seems.`,
    (f) => `There is always an older quarterback in the room with ${f.p.him}, keeping the seat warm.`,
  ),
  ...L(
    'bridgeQb',
    'faded',
    (f) => `${f.p.He} used to lean on veteran quarterbacks. The young ones get the ball now.`,
    (f) => `${f.p.He} once kept an old hand at quarterback every year. Not anymore.`,
  ),
  ...L(
    'tradeUpQb',
    'once',
    (f) => `Jumped the board for a quarterback ${D(f)}.`,
    (f) => `Moved up for a quarterback ${D(f)}.`,
  ),
  ...L(
    'tradeUpQb',
    'habit',
    (f) => `${f.p.He}'s not shy about jumping the board for a quarterback.`,
    (f) => `When there is a quarterback ${f.p.he} wants, ${f.p.he} goes and gets ${f.p.him}.`,
  ),
  ...L(
    'tradeUpQb',
    'faded',
    (f) => `${f.p.He} was the one always jumping up for a quarterback. Lately ${f.p.he}'s let them come to ${f.p.him}.`,
    (f) => `${f.p.He} used to move up for ${f.p.his} quarterback. Now ${f.p.he} waits.`,
  ),
  ...L(
    'extendEarly',
    'once',
    (f) => `Paid one of ${f.p.his} starters a year before ${f.p.he} had to.`,
    () => 'Got a starter signed a year before the deal was up.',
  ),
  ...L(
    'extendEarly',
    'habit',
    (f) => `${f.p.He} pays ${f.p.his} starters before the market sets the price.`,
    (f) => `${f.p.He} doesn't wait for a deal to run out. ${f.p.His} starters are signed early.`,
  ),
  ...L(
    'extendEarly',
    'faded',
    (f) => `${f.p.He} used to get ahead of the market on ${f.p.his} own players. Not lately.`,
    (f) => `${f.p.He} used to sign ${f.p.his} starters early. These days ${f.p.he} waits and sees.`,
  ),
  ...L(
    'sellsEarly',
    'once',
    (f) => `Moved a starter rather than pay ${f.p.his} second contract.`,
    () => 'Sold a starter before the big deal came due.',
  ),
  ...L(
    'sellsEarly',
    'habit',
    (f) => `${f.p.He}'d rather sell a year early than a year late.`,
    (f) => `${f.p.He} doesn't keep a starter past the first contract if ${f.p.he} can help it.`,
  ),
  ...L(
    'sellsEarly',
    'faded',
    (f) => `${f.p.He} sold starters early for a while. ${f.p.He}'s holding them now.`,
    (f) => `${f.p.He} used to move ${f.p.his} starters before they got expensive. ${f.p.He} keeps them now.`,
  ),
  ...L(
    'hisGuys',
    'once',
    (f) => `Brought back a player ${f.p.he} drafted.`,
    (f) => `Went and got one of ${f.p.his} own draftees back.`,
  ),
  ...L(
    'hisGuys',
    'habit',
    (f) => `${f.p.He} likes to bring back players ${f.p.he} drafted.`,
    (f) => `The players ${f.p.he} drafted tend to find their way back to ${f.p.him}.`,
  ),
  ...L(
    'hisGuys',
    'faded',
    (f) => `${f.p.He} went back for ${f.p.his} own draftees once. Not anymore.`,
    (f) => `${f.p.He} used to bring ${f.p.his} draftees home. ${f.p.He} lets them go now.`,
  ),
  ...L(
    'firstsForStars',
    'once',
    (f) => `Sent two firsts for one player ${A(f)}.`,
    (f) => `Paid two first-round picks for one man ${A(f)}.`,
  ),
  ...L(
    'firstsForStars',
    'habit',
    (f) => `When ${f.p.he} wants a star, ${f.p.he} pays in firsts.`,
    (f) => `${f.p.He}'ll give up first-round picks for the right player, and ${f.p.he} has.`,
  ),
  ...L(
    'firstsForStars',
    'faded',
    (f) => `${f.p.He} mortgaged a draft or two for stars once. ${f.p.He}'s keeping ${f.p.his} picks now.`,
    (f) => `${f.p.He} used to pay in firsts for a star. The picks stay home now.`,
  ),
  ...L(
    'swaps',
    'once',
    (f) => `Made a straight player swap ${A(f)}.`,
    (f) => `Traded a player for a player ${A(f)}, nothing else in it.`,
  ),
  ...L(
    'swaps',
    'habit',
    (f) => `${f.p.He}'d sooner swap players than haggle over picks.`,
    (f) => `${f.p.His} deals tend to be a player for a player.`,
  ),
  ...L(
    'swaps',
    'faded',
    (f) => `${f.p.He} used to deal player for player. ${f.p.He} talks picks now.`,
    (f) => `The straight swaps have dried up. It is picks with ${f.p.him} now.`,
  ),
  ...L(
    'bpa',
    'once',
    (f) => `Took the best player on ${f.p.his} board over a need ${D(f)}.`,
    (f) => `Passed on a need for the best player left on ${f.p.his} board ${D(f)}.`,
  ),
  ...L(
    'bpa',
    'habit',
    (f) => `${f.p.He} drafts the best player on ${f.p.his} board and sorts out the depth chart later.`,
    (f) => `${f.p.He} doesn't draft for need. The best name on ${f.p.his} list goes first.`,
  ),
  ...L(
    'bpa',
    'faded',
    (f) => `${f.p.He} used to draft the board. ${f.p.He}'s drafting needs now.`,
    (f) => `${f.p.He} took the best man left, once. Now ${f.p.he} fills holes.`,
  ),
  ...L(
    'tagsFirst',
    'once',
    (f) => `Tagged ${f.p.his} man before ${f.p.he} talked money.`,
    () => 'Put the tag on a player before sitting down to talk a contract.',
  ),
  ...L(
    'tagsFirst',
    'habit',
    (f) => `The tag comes first with ${f.p.him}, the deal after.`,
    (f) => `${f.p.He} tags ${f.p.his} man first and talks money second.`,
  ),
  ...L(
    'tagsFirst',
    'faded',
    (f) => `${f.p.He} used to tag first and talk later. The deals come first now.`,
    (f) => `${f.p.He} used to reach for the tag right away. ${f.p.He} talks first now.`,
  ),
  ...L(
    'youngQb',
    'once',
    (f) => `Stuck with ${f.p.his} young quarterback through a losing year.`,
    (f) => `Kept ${f.p.his} young quarterback in the job through a bad season.`,
  ),
  ...L(
    'youngQb',
    'habit',
    (f) => `${f.p.He} sticks with the quarterback ${f.p.he} drafted, whatever the record says.`,
    (f) => `The quarterback ${f.p.he} drafted keeps the job. The record doesn't change that.`,
  ),
  ...L(
    'youngQb',
    'faded',
    (f) => `${f.p.He} used to ride ${f.p.his} young quarterback through anything. Less patient now.`,
    (f) => `${f.p.He} once gave ${f.p.his} young quarterback all the time ${f.p.he} wanted. That has run short.`,
  ),
  ...L(
    'gunShy',
    'once',
    (f) => `Got burned on a big ${P(f)} deal, and it shows.`,
    (f) => `A big ${P(f)} contract went bad on ${f.p.him}, and ${f.p.he} remembers.`,
  ),
  ...L(
    'gunShy',
    'habit',
    (f) => `${f.p.He}'s been burned at ${P(f)} and doesn't pay there anymore.`,
    (f) => `${f.p.He} won't spend big at ${P(f)} again after what happened.`,
  ),
  ...L(
    'gunShy',
    'faded',
    (f) => `A big ${P(f)} deal went bad on ${f.p.him} a few years back. ${f.p.He}'s over it.`,
    (f) => `${f.p.He} was burned at ${P(f)} a while ago. It doesn't seem to weigh on ${f.p.him} now.`,
  ),
];

/** At most two things the league has noticed about him, the latest first. */
export function noticed(league: League, gm: GeneralManager): string[] {
  return habitFacts(league, gm)
    .map((f) => say(NOTICED, f, { key: `gm:${gm.id}:${f.habit}:${league.season}`, slot: 'noticed' }))
    .filter(Boolean)
    .slice(0, 2);
}

// ---- a pattern, when he does it again ----

const N = (m: { name: string }) => m.name;
type PatternFact = { name: string; ago: string; span: string; p: Pron };
const pat = (habit: string, ...texts: ((f: PatternFact) => string)[]) => texts.map((text) => ({ habit, text }));
export const PATTERN = [
  ...pat(
    'firstsForStars',
    (f) => `${N(f)} has been here before: two firsts for one man, ${f.ago} as well.`,
    (f) => `${N(f)} paid this way ${f.ago}, too. Two firsts, one player.`,
  ),
  ...pat(
    'swaps',
    (f) => `${N(f)} has made a habit of this: another straight player swap, ${f.p.his} second in ${f.span}.`,
    (f) => `${N(f)} likes these. Another player-for-player swap, and the last was ${f.ago}.`,
  ),
  ...pat(
    'sellsEarly',
    (f) => `It's not the first time ${N(f)} has sold a starter a year early.`,
    (f) => `${N(f)} sold a starter ahead of ${f.p.his} big deal ${f.ago}, too.`,
  ),
  ...pat(
    'hisGuys',
    (f) => `${N(f)} went and got one of ${f.p.his} own draftees again.`,
    (f) => `${N(f)} brought back another player ${f.p.he} drafted. ${f.p.He} did the same ${f.ago}.`,
  ),
];

/** The line for a move he has made before: `earlier` is the previous use. Empty for a habit with no pattern line. */
export function patternLine(_league: League, gm: GeneralManager, move: HabitMove, earlier: HabitMove): string {
  const lines = PATTERN.filter((p) => p.habit === move.habit);
  if (!lines.length) return '';
  const gap = Math.max(0, move.season - earlier.season);
  const fact: PatternFact = { name: NAME_OF(gm), ago: ago(gap), span: spanOf(gap), p: pron(gm) };
  const bank: Line<PatternFact>[] = lines.map((p) => ({ text: p.text }));
  return say(bank, fact, { key: `gm:${gm.id}:pattern:${move.season}`, slot: move.habit });
}

// ---- the director's tip ----

interface TipFact {
  hisGuy: string | null;
  star: boolean;
  swap: boolean;
  p: Pron;
  rookieStarter: boolean;
  has: Set<HabitId>;
}

export const TIPS: readonly Line<TipFact>[] = [
  {
    when: (f) => !!f.hisGuy && f.has.has('hisGuys'),
    reads: 4,
    text: (f) =>
      `${f.p.He} has tended to pay for players ${f.p.he} drafted. We may be able to ask more for ${f.hisGuy}.`,
  },
  {
    when: (f) => f.star && f.has.has('firstsForStars'),
    reads: 3,
    text: (f) => `${f.p.He}'s paid in firsts for a star before. I wouldn't take the first offer.`,
  },
  {
    when: (f) => f.swap && f.has.has('swaps'),
    reads: 2,
    text: (f) => `${f.p.He} likes a straight swap. The price may be better than it looks.`,
  },
  {
    when: (f) => f.rookieStarter && f.has.has('sellsEarly'),
    reads: 1,
    text: (f) => `${f.p.He} sells a year early by habit; this may not be about the player.`,
  },
];

/** A hedged word from the director on a deal with this partner, from what his log shows, or null. */
export function directorTip(league: League, partner: Team, sides: readonly [TradeSide, TradeSide]): string | null {
  const gm = partner.gmId === null ? undefined : league.gms[partner.gmId];
  if (!gm) return null;
  const facts = habitFacts(league, gm);
  if (!facts.length) return null;
  const has = new Set(facts.map((f) => f.habit));
  const ours = sides.find((s) => s.teamId !== partner.id) ?? sides[0];
  const theirs = sides.find((s) => s !== ours) ?? sides[1];
  const ctx = tradeContext(league);
  const our = ours.players.map((id) => league.players[id]).filter((p) => !!p);
  // only a man we send back to him: one on his own roster is no leverage
  const drafted = our.find((p) => draftedBy(gm, p));
  const tip: TipFact = {
    hisGuy: drafted ? `${drafted.firstName} ${drafted.lastName}` : null,
    star: our.some((p) => marketValue(ctx, partner, p) >= STAR),
    swap: ours.players.length > 0 && theirs.players.length > 0 && ours.picks.length === 0 && theirs.picks.length === 0,
    rookieStarter: theirs.players
      .map((id) => league.players[id])
      .some((p) => !!p && p.contract?.kind === 'rookie' && starters(league, partner, p.position).includes(p)),
    has,
    p: pron(gm),
  };
  return say(TIPS, tip, { key: `tip:${partner.id}:${league.season}`, slot: 'tip' }) || null;
}
