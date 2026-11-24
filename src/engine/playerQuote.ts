/**
 * Players in their own words (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`, "Players talk"): the one
 * quote a story may give the player it is about, in the voice his personality gives him (`personalityOf` on his true
 * character: a person shows himself in what he says). The lines are whole sentences written by hand
 * (`playerQuoteLines.ts`); this chooses among them by the most specific one that fits, through `say` (`voice.ts`), and
 * steps around every sentence already said this league year. When a personality has said all it has at a moment, the
 * plain voice speaks; when that has been said too there is no quote at all, never a repeat. Mail-side only: nothing in
 * the sim reads it and nothing here draws. A quote never names a trait or a label (`playerQuote.test.ts` holds it).
 */
import { ordinal } from './opposition';
import { personalityOf, trueCharacter, type PersonalityName } from './personality';
import { PLAIN, VOICES, type Cond, type QuoteMoment } from './playerQuoteLines';
import { POSITION_NAMES } from './positions';
import type { EditionStory, League, Player, Position } from './types';
import { around, say, sentencesOf, stableHash, toldKeys, type Line } from './voice';

export type { QuoteMoment } from './playerQuoteLines';

/**
 * A stable draw from a key, 0 up to `n` - 1: who in a story speaks, and whether he does. The hash's low bit only says
 * whether an odd number of its characters are odd, so a draw by two reads higher bits.
 */
export const draw = (key: string, n: number) => (stableHash(key) >>> 7) % n;

/** What a line may read: facts the story already tells, and a key for the stable tie-break. */
export interface QuoteFacts {
  /** The story's key: the same story always picks the same line. */
  key: string;
  /** The edition being written and what it has said so far (this league year's sentences); the quote is noted in it. */
  at?: { editionId: string; said: string[] };
  /** His team's nickname ("Tarpons") and city. */
  team?: string;
  city?: string;
  /** Drafted: where, in what round, and how far his place was from the consensus board's. */
  pick?: number;
  round?: number;
  slid?: boolean;
  /** Signed: back to a team he has played for, or the richest deal of the market. */
  returning?: boolean;
  rich?: boolean;
  /** Suspended: how many games. */
  games?: number;
  /** The other team's nickname. */
  opp?: string;
  /** Trouble: on the field (a flag, an ejection) or off it, and whether the ruling was a fine. */
  onField?: boolean;
  fined?: boolean;
  /** Trouble: heated (a flag, a fight, an argument), minor (an event missed, a team sit, an argument), a league ruling. */
  heated?: boolean;
  minor?: boolean;
  league?: boolean;
  /** A game: the team has another game to play (no quote may promise next week without one). */
  next?: boolean;
  /** His position, filled in from the player. */
  pos?: Position;
  /** A good-side story: what kind. */
  kind?: 'community' | 'family' | 'teammate';
}

const WORDS = [
  'zero',
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
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const spell = (n: number): string =>
  n < 20 ? WORDS[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? `-${WORDS[n % 10]}` : '') : String(n);
/** "third", "twenty-first": the pick said as a person says it; past the first hundred, the numeral. */
const ORD_UNIT = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
];
const ORD_TENS = [
  '',
  '',
  'twentieth',
  'thirtieth',
  'fortieth',
  'fiftieth',
  'sixtieth',
  'seventieth',
  'eightieth',
  'ninetieth',
];
export function spellOrdinal(n: number): string {
  if (n < 20) return ORD_UNIT[n];
  if (n >= 100) return ordinal(n);
  return n % 10 ? `${TENS[Math.floor(n / 10)]}-${ORD_UNIT[n % 10]}` : ORD_TENS[Math.floor(n / 10)];
}
const ROUND = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];

/** The slots a line may name, and what fills each one: a slot whose fact is missing leaves its line out. */
const SLOTS: Record<string, (f: QuoteFacts) => string | undefined> = {
  team: (f) => f.team,
  city: (f) => f.city,
  nth: (f) => (f.pick === undefined ? undefined : spellOrdinal(f.pick)),
  before: (f) => (f.pick === undefined || f.pick < 2 ? undefined : spell(f.pick - 1)),
  round: (f) => (f.round === undefined ? undefined : ROUND[f.round]),
  opp: (f) => f.opp,
  games: (f) => (f.games === undefined ? undefined : f.games === 1 ? 'one game' : `${spell(f.games)} games`),
};
const slotsIn = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
const fill = (text: string, f: QuoteFacts) =>
  text
    .replace(/\{(\w+)\}/g, (_, k: string) => SLOTS[k](f) ?? '')
    // A slot at the start of a sentence ("{before} teams") opens it with a capital.
    .replace(/(^|[.?!] )([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
const fits = (text: string, f: QuoteFacts) => slotsIn(text).every((k) => SLOTS[k](f) !== undefined);

const COND: Record<Cond, (f: QuoteFacts) => boolean> = {
  first: (f) => f.round === 1,
  down: (f) => !!f.slid || (f.round ?? 0) >= 4,
  home: (f) => !!f.returning,
  rich: (f) => !!f.rich,
  community: (f) => f.kind === 'community',
  family: (f) => f.kind === 'family',
  onField: (f) => f.onField === true,
  offField: (f) => f.onField === false,
  fined: (f) => !!f.fined,
  deed: (f) => f.kind !== undefined && f.kind !== 'family',
  next: (f) => f.next === true,
  one: (f) => f.games === 1,
  many: (f) => (f.games ?? 0) > 1,
  skill: (f) => ['QB', 'RB', 'WR', 'TE'].includes(f.pos ?? ''),
  receiver: (f) => ['WR', 'TE', 'RB'].includes(f.pos ?? ''),
  heated: (f) => f.heated === true,
  minor: (f) => f.minor === true,
  league: (f) => f.league === true,
};

/**
 * The cases that say something particular (a first-round pick, a return, the richest deal, a kind of deed): their
 * lines are chosen ahead of the rest. The other conditions only keep a line from printing where it would be wrong (no
 * game to follow, one game out, an event missed), so those lines compete evenly with the rest.
 */
const FLAVOUR: ReadonlySet<Cond> = new Set<Cond>(['first', 'down', 'home', 'rich', 'community', 'family']);

/** A personality's lines for a moment as a bank for `say`: its own at reads 1, a narrow case at 2, the plain voice at 0. */
export function bankFor(
  name: PersonalityName,
  moment: QuoteMoment,
  /** Told which line each filled text came from (for the no-repeat rule by line). */
  seen?: Map<string, string>,
): Line<QuoteFacts>[] {
  const make = (text: string, reads: number, cond?: Cond): Line<QuoteFacts> => ({
    reads,
    when: (f: QuoteFacts) => fits(text, f) && (!cond || COND[cond](f)),
    text: (f: QuoteFacts) => {
      const out = fill(text, f);
      seen?.set(out, text);
      return out;
    },
  });
  const own = VOICES[name][moment].map((e) => {
    const [cond, text] = typeof e === 'string' ? [undefined, e] : e;
    return make(text, cond && FLAVOUR.has(cond) ? 2 : 1, cond);
  });
  return [...own, ...PLAIN[moment].map((text) => make(text, 0))];
}

/** Every line a personality can say at a moment, as written (slots shown), for the preview and the tests. */
export const linesOf = (name: PersonalityName, moment: QuoteMoment): string[] =>
  VOICES[name][moment].map((e) => (typeof e === 'string' ? e : e[1]));

export const MOMENTS: readonly QuoteMoment[] = [
  'drafted',
  'signed',
  'bigWin',
  'badLoss',
  'trouble',
  'suspended',
  'back',
  'goodSide',
];
export const PERSONALITIES = Object.keys(VOICES) as PersonalityName[];

/**
 * What this player says at this moment, or null when everything he and the plain voice could say has been said this
 * league year. The chosen sentences are noted in `facts.at.said`, so the next story steps around them.
 */
export function playerQuote(league: League, p: Player, moment: QuoteMoment, facts: QuoteFacts): string | null {
  return quoteWithLine(league, p, moment, facts)?.text ?? null;
}

/** The key a line is kept under in an edition's `covered`, so it is said once a league year across editions. */
export const quoteLineKey = (season: number, moment: QuoteMoment, raw: string) =>
  `quote:${season}:${moment}:${stableHash(raw).toString(36)}`;

/** `playerQuote`, with the key of the line it chose (for the story to keep in its edition's `covered`). */
function quoteWithLine(
  league: League,
  p: Player,
  moment: QuoteMoment,
  facts: QuoteFacts,
): { text: string; line: string } | null {
  const name = personalityOf(trueCharacter(p));
  const base = facts.at ? around(league, facts.at.said) : undefined;
  const lines = new Map<string, string>();
  const marked = (raw: string | undefined) => (raw ? `⟦${moment}:${raw}⟧` : '');
  // Lines an earlier edition of this league year kept in its `covered` (the in-edition marker is below).
  const told = facts.at ? toldKeys(league) : undefined;
  // A line is said once a league year however many teams it names: its template is noted as well as its sentences.
  const heard = (t: string) => {
    if (base?.skip(t)) return true;
    const raw = lines.get(t);
    return (
      !!facts.at &&
      raw !== undefined &&
      (facts.at.said.includes(marked(raw)) || !!told?.has(quoteLineKey(league.season, moment, raw)))
    );
  };
  const text = say(
    bankFor(name, moment, lines),
    { ...facts, pos: p.position },
    {
      // `say` breaks ties on the key's hash, whose low bits only count its odd characters: a mixed key spreads the picks.
      key: String(stableHash(`${facts.at?.editionId ?? ''}:${facts.key}`) >>> 3),
      slot: `quote:${moment}`,
      ...(facts.at ? { skip: heard } : {}),
    },
  );
  if (!text || heard(text)) return null;
  const raw = lines.get(text) ?? text;
  facts.at?.said.push(...sentencesOf(text), marked(raw));
  return { text, line: quoteLineKey(league.season, moment, raw) };
}

/** "rookie cornerback", "offensive lineman": how a quote's byline names a position. */
const posName = (p: Player) =>
  `${p.experience === 0 ? 'rookie ' : ''}${p.position === 'OL' ? 'offensive lineman' : POSITION_NAMES[p.position].toLowerCase()}`;

/**
 * The story's quote for this player, ready to file (`EditionStory.quote`): his words, his name and his team's. His
 * team's nickname and city are filled in from `teamId`, the team the story is told for. Nothing when every line has
 * been said.
 */
export function speaks(
  league: League,
  p: Player,
  moment: QuoteMoment,
  facts: QuoteFacts,
  teamId: number,
): EditionStory['quote'] | undefined {
  const team = league.teams[teamId];
  const said = quoteWithLine(league, p, moment, { team: team.name, city: team.city, ...facts });
  if (!said) return undefined;
  return {
    playerId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    role: `${team.name} ${posName(p)}`,
    text: said.text,
    line: said.line,
  };
}
