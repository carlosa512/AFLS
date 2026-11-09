/**
 * An AI general manager's own words in a letter to you (spec 2026-11-07-gm-memory-voice, §3): who it's signed by, how it
 * opens and how it closes. The offer in the middle stays plain and exact (`offerWords`); this module only wraps it. Each
 * slot is chosen through `say` from a small fact sheet (his manner, how he feels about you as a band, the one moment he'd
 * mention, the market moment), so a letter is a pure function of the league: no draws, the same words every time it is
 * read. The fog rule: no number, habit, archetype, band name or "trust" in any line; he only quotes what he lived through.
 */
import { aiGm } from './gmHabits';
import { standingBand, standingWith, type StandingBand } from './gmMemory';
import { ago } from './gmVoice';
import { pron } from './pronouns';
import { isDeadlineDay, type TradeProposal } from './trade/rules';
import type { GeneralManager, League, Team, TradeOffer, YouMoment } from './types';
import { recentBodies, say, type Line } from './voice';

export type Manner = 'firm' | 'urgent' | 'careful' | 'easy' | 'plain';
export type TalkMoment = 'deadline' | 'week' | 'leagueYear' | 'freeAgency' | 'camp' | 'draft' | 'offseason';

export interface MemoryFact {
  kind: 'heWon' | 'both' | 'youWon' | 'brokeDown' | 'finalNo' | 'ledOn';
  /** The deal's best-known man, "First Last"; empty for a final no or being led on, which name no deal. */
  player: string;
  /** "last year", "two years ago": how long since. */
  when: string;
}

export interface TalkFacts {
  team: Team;
  gm?: GeneralManager;
  manner: Manner;
  band: StandingBand;
  memory?: MemoryFact;
  moment: TalkMoment;
  final: boolean;
  /** What kind of letter it is, when it is one of his offers (the trade table's lines leave it out). */
  reason?: TradeOffer['reason'];
  p: ReturnType<typeof pron>;
}

/** His makeup as a manner of writing, the first that fits: stubborn, in a hurry, careful with money, easygoing. */
function mannerOf(team: Team, gm: GeneralManager | undefined): Manner {
  if (!gm) return 'plain';
  const t = team.gm;
  if (t.stubbornness >= 0.7) return 'firm';
  if (t.winNow >= 0.7) return 'urgent';
  if (t.capAggression <= 0.3) return 'careful';
  if (t.stubbornness <= 0.3) return 'easy';
  return 'plain';
}

const nameOf = (league: League, ids: number[] | undefined): string => {
  const p = ids?.length ? league.players[ids[0]] : undefined;
  return p ? `${p.firstName} ${p.lastName}` : '';
};

/**
 * The one thing he'd mention: the latest trade a season on has judged (not an even one) from the last two seasons, else a
 * final no or being led on from this season or last. A deal whose men are gone from the league is passed over.
 */
function memoryOf(league: League, gm: GeneralManager | undefined): MemoryFact | undefined {
  const moments: YouMoment[] = gm?.withYou ?? [];
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if (m.kind !== 'trade' || !m.verdict || m.verdict === 'even' || league.season - m.season > 2) continue;
    const player = nameOf(league, m.got?.players) || nameOf(league, m.gave?.players);
    if (player) return { kind: m.verdict, player, when: ago(league.season - m.season) };
  }
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if ((m.kind === 'finalNo' || m.kind === 'ledOn') && league.season - m.season <= 1)
      return { kind: m.kind, player: '', when: ago(league.season - m.season) };
  }
  return undefined;
}

function momentOf(league: League): TalkMoment {
  switch (league.phase) {
    case 'regular':
      return isDeadlineDay(league) ? 'deadline' : 'week';
    case 'resign':
      return 'leagueYear';
    case 'freeAgency':
      return 'freeAgency';
    case 'preseason':
      return 'camp';
    case 'draft':
      return 'draft';
    default:
      return 'offseason';
  }
}

export function talkFacts(
  league: League,
  team: Team,
  opts?: { final?: boolean; reason?: TradeOffer['reason'] },
): TalkFacts {
  const gm = aiGm(league, team);
  return {
    team,
    gm,
    manner: mannerOf(team, gm),
    band: standingBand(standingWith(league, gm)),
    memory: memoryOf(league, gm),
    moment: momentOf(league),
    final: !!opts?.final,
    reason: opts?.reason,
    p: pron(gm ?? ({ woman: undefined } as GeneralManager)),
  };
}

/** Who a letter is from: him by name, so his letters remember each other, or the front office when the chair is empty. */
export function letterFrom(league: League, team: Team): string {
  const gm = aiGm(league, team);
  return gm ? `${gm.firstName} ${gm.lastName}, ${team.name} GM` : `${team.city} ${team.name} front office`;
}

// ---- openers ----

const band = (b: StandingBand) => (f: TalkFacts) => f.band === b;
const reason = (r: TradeOffer['reason']) => (f: TalkFacts) => f.reason === r;
/** A letter that puts terms on the table: an enquiry and a price ask have none, so lines about "the offer" skip them. */
const terms = (f: TalkFacts) => f.reason !== 'enquiry' && f.reason !== 'ask';
const inSeason = (f: TalkFacts) => f.moment === 'week' || f.moment === 'deadline';
const at = (m: TalkMoment) => (f: TalkFacts) => f.moment === m;

/** Neutral pool first (no condition, so it always fits), then lines that lean on his feeling for you or the moment. */
export const OPENERS: readonly Line<TalkFacts>[] = [
  { when: inSeason, text: () => 'Wanted to get this in front of you before the week gets away.' },
  { text: () => "I'd rather write than play phone tag, so here it is." },
  { text: () => "Got something I'd like you to look at." },
  { text: () => 'Been going through my roster and this came up.' },
  { text: () => "Have a minute? This one's worth a look." },
  { text: () => "I've been working through my list and your club came up." },
  { text: () => 'Straight to it.' },

  { when: band('warm'), reads: 1, text: () => "You've been straight with me, so I'll come to you first." },
  {
    when: (f) => f.band === 'warm' && terms(f),
    reads: 1,
    text: () => "It's always a good conversation with you, so here's one for you.",
  },
  { when: band('warm'), reads: 1, text: () => "You'll hear this from me before anyone else." },
  { when: band('warm'), reads: 1, text: () => "I'd rather work this out with you than anyone else in the league." },
  { when: band('easy'), reads: 1, text: () => "We've dealt fine before, so I'll keep it simple." },
  { when: band('easy'), reads: 1, text: () => 'No games on this one.' },
  { when: band('easy'), reads: 1, text: () => 'Thought of you for this one.' },
  { when: band('easy'), reads: 1, text: () => "Hope the week's treating you well." },
  { when: band('easy'), reads: 1, text: () => 'Nothing complicated here.' },
  { when: band('cool'), reads: 1, text: () => 'Getting right to it.' },
  { when: band('cool'), reads: 1, text: () => "I'll lay it out plainly." },
  { when: (f) => f.band === 'cool' && terms(f), reads: 1, text: () => "Here's what I can do." },
  { when: band('cool'), reads: 1, text: () => "I'll be plain about it." },
  { when: band('sour'), reads: 1, text: () => "I'll keep this short." },
  {
    when: (f) => f.band === 'sour' && terms(f),
    reads: 1,
    text: () => "Here's the offer. Don't make me chase it.",
  },
  { when: band('sour'), reads: 1, text: () => "Don't make me chase this one." },
  { when: band('sour'), reads: 1, text: () => "I'll be brief." },
  { when: band('sour'), reads: 1, text: () => 'No long preamble this time.' },

  // A moment's lines join the neutral pool (reads 0) so a neutral GM always has at least six to draw from.
  { when: at('deadline'), text: () => "Deadline's close, so no time to be coy." },
  { when: (f) => f.moment === 'deadline' && terms(f), text: () => "With the deadline on us, here's my best shot." },
  { when: at('deadline'), text: () => "The window's nearly shut. Quick one." },
  { when: at('draft'), text: () => "We're on the clock, so I'll be quick." },
  { when: (f) => f.moment === 'draft' && terms(f), text: () => "The room's moving fast, so here's mine." },
  { when: at('leagueYear'), text: () => "New league year, new roster math. Here's an idea." },
  { when: at('leagueYear'), text: () => "Now that the books are open, I've got a thought." },
  { when: at('freeAgency'), text: () => "The market's moving, so I'll be quick." },
  { when: at('freeAgency'), text: () => 'Free agency has me looking at my depth, and at yours.' },
  { when: at('camp'), text: () => "Camp's got me looking hard at depth." },
  { when: at('camp'), text: () => "Camp's showing me where I'm short." },
];

/** The deal's man, by name: "Jefferson" out of "Marcus Jefferson" (a suffix or a double name stays whole). */
const surname = (f: TalkFacts) => f.memory!.player.split(' ').slice(1).join(' ') || f.memory!.player;
const is = (k: MemoryFact['kind']) => (f: TalkFacts) => f.memory?.kind === k;

/** What he remembers of a dealing with you: two facts read (the kind of memory, that there is one). */
export const MEMORY_OPENERS: readonly Line<TalkFacts>[] = [
  { when: is('heWon'), reads: 2, text: (f) => `The ${surname(f)} deal worked out for us, so let's talk again.` },
  {
    when: is('heWon'),
    reads: 2,
    text: (f) => `We did the ${surname(f)} deal ${f.memory!.when}, and it's treated us well.`,
  },
  {
    when: is('heWon'),
    reads: 2,
    text: (f) => `I haven't regretted the ${surname(f)} trade, which is why I'm writing.`,
  },
  {
    when: is('both'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal helped us both, so I figure there's another in it.`,
  },
  {
    when: is('both'),
    reads: 2,
    text: (f) => `I'd call the ${surname(f)} deal fair to each side. Let's do one like it.`,
  },
  {
    when: (f) => is('both')(f) && terms(f),
    reads: 2,
    text: (f) => `Both of us came out of the ${surname(f)} deal fine. Here's the next one.`,
  },
  { when: is('youWon'), reads: 2, text: (f) => `You got the better of me on the ${surname(f)} deal. Not this time.` },
  {
    when: (f) => is('youWon')(f) && terms(f),
    reads: 2,
    text: (f) => `I'll admit the ${surname(f)} deal went your way, so I've come with a better number.`,
  },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went your way ${f.memory!.when}. I'd like to even it up.`,
  },
  {
    when: (f) => is('brokeDown')(f) && terms(f),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't go the way anyone hoped. Let's try for a better one.`,
  },
  {
    when: is('brokeDown'),
    reads: 2,
    text: (f) => `After how the ${surname(f)} deal went, I'm being careful, but I'd still like to talk.`,
  },
  {
    when: (f) => is('brokeDown')(f) && terms(f),
    reads: 2,
    text: (f) => `Nobody planned on the ${surname(f)} deal turning out like that. This one's cleaner.`,
  },
  {
    when: (f) => is('finalNo')(f) && terms(f),
    reads: 2,
    text: () => "I know my last number didn't work for you. This one's different.",
  },
  {
    when: (f) => is('finalNo')(f) && terms(f),
    reads: 2,
    text: (f) => `You passed on my final offer ${f.memory!.when}, fair enough. Here's another way in.`,
  },
  {
    when: (f) => is('finalNo')(f) && terms(f),
    reads: 2,
    text: () => "Last time I put my best number down and you said no. I'm not holding it against you.",
  },
  {
    when: (f) => is('ledOn')(f) && terms(f),
    reads: 2,
    text: () => 'Last time we went back and forth and got nowhere. Let me try a cleaner one.',
  },
  {
    when: is('ledOn'),
    reads: 2,
    text: (f) => `Our talks ${f.memory!.when} went nowhere, so this time I'm putting it plainly.`,
  },
  { when: is('ledOn'), reads: 2, text: () => "I'd like to skip the back and forth this time." },
  {
    when: is('finalNo'),
    reads: 2,
    text: (f) => `We didn't get there ${f.memory!.when}, and that's fair. I'd like to try again.`,
  },
  { when: is('finalNo'), reads: 2, text: () => "I know the last one didn't work for you. No hard feelings." },
  {
    when: is('brokeDown'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't go the way anyone hoped, and I'd still like to keep talking.`,
  },
];

// ---- sign-offs ----

const manner = (m: Manner) => (f: TalkFacts) => f.manner === m && !f.final;
/** A letter that carries a price (everything but an enquiry): the only place a number, the money or the cap is spoken of. */
const priced = (m: Manner) => (f: TalkFacts) => manner(m)(f) && f.reason !== 'enquiry';

/** His manner in the last line; a final offer says so in his words and beats the manner. */
export const SIGNOFFS: readonly Line<TalkFacts>[] = [
  { when: manner('firm'), reads: 1, text: () => "That's where we are." },
  { when: priced('firm'), reads: 1, text: () => "That's the number." },
  { when: priced('firm'), reads: 1, text: () => "It's a fair price and I'm not going to move much." },
  { when: manner('firm'), reads: 1, text: () => "I'll hold where I am." },
  { when: manner('firm'), reads: 1, text: () => 'You know where I stand on this.' },
  { when: priced('firm'), reads: 1, text: () => 'Call me if you can meet it.' },
  { when: manner('urgent'), reads: 1, text: () => 'I need an answer this week.' },
  { when: manner('urgent'), reads: 1, text: () => 'Get back to me soon.' },
  { when: manner('urgent'), reads: 1, text: () => "I'd like to know quickly." },
  { when: manner('urgent'), reads: 1, text: () => "The window's short, so let me know." },
  { when: manner('urgent'), reads: 1, text: () => 'Sooner is better on my end.' },
  { when: manner('urgent'), reads: 1, text: () => "I'm on a clock, so call me when you've looked at it." },
  { when: priced('careful'), reads: 1, text: () => 'It has to fit under my cap, so keep that in mind.' },
  { when: priced('careful'), reads: 1, text: () => "The cap's tight on my end, so I can't stretch it." },
  { when: priced('careful'), reads: 1, text: () => "I can't go further on the money." },
  { when: priced('careful'), reads: 1, text: () => 'Mind the cap numbers when you reply.' },
  { when: priced('careful'), reads: 1, text: () => "Money's the limit on my side." },
  { when: priced('careful'), reads: 1, text: () => 'Run it past your cap people and call me.' },
  { when: manner('easy'), reads: 1, text: () => 'No rush on this one.' },
  { when: manner('easy'), reads: 1, text: () => 'Think it over and let me know.' },
  { when: manner('easy'), reads: 1, text: () => 'Take your time.' },
  { when: manner('easy'), reads: 1, text: () => "I'm easy on timing. Call when you're ready." },
  { when: manner('easy'), reads: 1, text: () => 'Sleep on it if you want.' },
  { when: manner('easy'), reads: 1, text: () => "If it doesn't work for you, no hard feelings." },
  { when: manner('plain'), reads: 1, text: () => 'Let me know.' },
  { when: manner('plain'), reads: 1, text: () => "Give me a call when you've looked at it." },
  { when: manner('plain'), reads: 1, text: () => 'Let me know where you land.' },
  { when: manner('plain'), reads: 1, text: () => 'Get back to me when you can.' },
  { when: manner('plain'), reads: 1, text: () => 'Looking forward to hearing from you.' },
  { when: manner('plain'), reads: 1, text: () => 'Call if you want to talk it through.' },

  // An enquiry asks nothing yet: no price, no money, no final word. Beats any manner line.
  { when: reason('enquiry'), reads: 2, text: () => "No rush, but I'd like to hear back." },
  { when: reason('enquiry'), reads: 2, text: () => 'Let me know either way.' },
  { when: reason('enquiry'), reads: 2, text: () => "If he's not available, just say so." },
  { when: reason('enquiry'), reads: 2, text: () => 'A quick reply is all I need.' },
  { when: reason('enquiry'), reads: 2, text: () => "Call me if it's worth a conversation." },

  // Two conditions read (a final offer, a manner's absence of choice): it outranks any manner line.
  { when: (f) => f.final, reads: 2, text: () => "That's as far as I go." },
  { when: (f) => f.final, reads: 2, text: () => "This is my final offer. I won't come back with another." },
  { when: (f) => f.final, reads: 2, text: () => "That's my last number on it." },
  { when: (f) => f.final, reads: 2, text: () => "There's no more room in it on my end. That's final." },
  { when: (f) => f.final, reads: 2, text: () => "I'm done moving on this. It's my final word." },
  { when: (f) => f.final, reads: 2, text: () => "That's the best I can do, and it's the last you'll hear on it." },
];

// ---- wrapping ----

/** What he'd sent before this letter: a letter already filed is read as it was written, never against its own words. */
function earlierBodies(league: League, from: string, offer: TradeOffer): string[] {
  const inbox = league.inbox ?? [];
  const prefix = `offer:${offer.season}:${offer.id}`;
  const own = inbox.findIndex((m) => m.id === prefix || m.id.startsWith(`${prefix}:`));
  return recentBodies(own < 0 ? league : { ...league, inbox: inbox.slice(0, own) }, from);
}

/** [opener, the offer as it is, sign-off], joined by spaces, any empty part dropped. */
export function wrapLetter(league: League, offer: TradeOffer, core: string): string {
  const team = league.teams[offer.teamId];
  const f = talkFacts(league, team, { final: offer.final, reason: offer.reason });
  const recent = earlierBodies(league, letterFrom(league, team), offer);
  const at = { key: `${offer.season}:${offer.id}`, recent };
  // A memory is quoted at most every other letter: not when his last letter already told it.
  const told = f.memory
    ? MEMORY_OPENERS.some((l) => (!l.when || l.when(f)) && !!recent[0]?.includes(l.text(f)))
    : false;
  const memory = f.memory && !told && f.reason !== 'counter' ? say(MEMORY_OPENERS, f, { ...at, slot: 'memory' }) : '';
  // His reply to your counter opens on its own words ("We've looked at your counter"): any opener would only echo it.
  const opener = f.reason === 'counter' ? '' : memory || say(OPENERS, f, { ...at, slot: 'opener' });
  return [opener, core, say(SIGNOFFS, f, { ...at, slot: 'signoff' })].filter(Boolean).join(' ');
}

// ---- the trade table ----

export type TableBand = 'accept' | 'close' | 'short' | 'far';
type TableFacts = TalkFacts & { table: TableBand };

const tb = (t: TableBand) => (f: TableFacts) => f.table === t;
const tbBand = (t: TableBand, b: StandingBand) => (f: TableFacts) => f.table === t && f.band === b;
const tbMoment = (t: TableBand, m: TalkMoment) => (f: TableFacts) => f.table === t && f.moment === m;

/**
 * His reply to the deal on your table, by how near it is. First person, no figure (a "close" points at a small add, never
 * at an amount). The plain pool fits every GM; his feeling for you picks a few of his own and a sour GM is curt, never rude.
 */
export const TABLE_LINES: readonly Line<TableFacts>[] = [
  { when: tb('accept'), text: () => "That works for me. I'd do it as it stands." },
  { when: tb('accept'), text: () => "I can live with that. Send it over and I'll say yes." },
  { when: tb('accept'), text: () => 'Fair enough. Go ahead and put it forward.' },
  { when: tb('accept'), text: () => 'Yes, that one works on my end.' },
  { when: tb('accept'), text: () => 'I like where that lands. We have a deal if you send it.' },
  { when: tb('accept'), text: () => "That's a deal I'm happy to make." },
  { when: tbMoment('accept', 'deadline'), text: () => "With the deadline close, I'm glad to take that." },
  { when: tbBand('accept', 'warm'), reads: 1, text: () => 'Happy to do that with you. Send it over.' },
  { when: tbBand('accept', 'warm'), reads: 1, text: () => "You've always been straight with me. Yes, that works." },
  { when: tbBand('accept', 'warm'), reads: 1, text: () => "That's good for both of us. Let's do it." },
  { when: tbBand('accept', 'warm'), reads: 1, text: () => "Gladly. Put it forward and it's done." },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => "That's fine with me. Send it when you're ready." },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'No problem on my end. It works.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'Sounds good to me. Go ahead.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => "I'm fine with that. Make it official." },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'That works. Send it.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => "I'll do that one." },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'Acceptable. Put it forward.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'That one I can sign off on.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => 'Fine. Send it.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => 'That works. Leave it as it is.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => "Acceptable. Don't change it." },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => "I'll take it. Send it over." },

  { when: tb('close'), text: () => "Close. Put a late pick on it and I'll do it." },
  { when: tb('close'), text: () => "We're nearly there. A little more from your side and I'm in." },
  { when: tb('close'), text: () => "I'm almost there. Add something small and we have a deal." },
  { when: tb('close'), text: () => 'Just short. A small piece more and I will say yes.' },
  { when: tb('close'), text: () => 'Nearly. Sweeten it a touch and it works for me.' },
  { when: tb('close'), text: () => 'One small add and I can get this done.' },
  { when: tbMoment('close', 'deadline'), text: () => "The clock's running, but a small add gets us there." },
  {
    when: tbBand('close', 'warm'),
    reads: 1,
    text: () => "We're close, and I'd like to get this done with you. A small add will do it.",
  },
  {
    when: tbBand('close', 'warm'),
    reads: 1,
    text: () => "So near. Give me a little more and I'll find a way to say yes.",
  },
  { when: tbBand('close', 'warm'), reads: 1, text: () => 'I want this one to work. Add a small piece and it does.' },
  { when: tbBand('close', 'warm'), reads: 1, text: () => "Almost there. I'd gladly finish this with you." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => 'Pretty close. A small add and we can both walk away happy.' },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "Not far off at all. Add a little and I'm in." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "We're almost there. Toss in something small." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "It's close. A little more and I'll do it." },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Close, but not there. A small add.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Almost. I need a little more.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => "It's near. Add something modest." },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'A bit short. Add a small piece.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Close. Add a little more.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Almost. One small add.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Not quite. A bit more.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Nearly. Make it a little better.' },

  { when: tb('short'), text: () => "It's not enough yet. I'd need to see more from your side." },
  { when: tb('short'), text: () => "That's light for me. Come back with something more." },
  { when: tb('short'), text: () => "I'm not there yet. Add real value and I'll look again." },
  { when: tb('short'), text: () => 'Short of what I need. Build it up and try me again.' },
  { when: tb('short'), text: () => "I can't do it at that level. It needs more." },
  { when: tb('short'), text: () => "Not enough for me yet, but I'm willing to keep talking." },
  { when: tbMoment('short', 'deadline'), text: () => "I'd like to help with the clock running, but it needs more." },
  {
    when: tbBand('short', 'warm'),
    reads: 1,
    text: () => "It's light, but I'd like to find something with you. Add more.",
  },
  {
    when: tbBand('short', 'warm'),
    reads: 1,
    text: () => "I'm not there, though I want to be. Give me more to work with.",
  },
  { when: tbBand('short', 'warm'), reads: 1, text: () => 'Not yet, but I think we can get there. Add something.' },
  { when: tbBand('short', 'warm'), reads: 1, text: () => "It's a start. I'd need more to say yes." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "It's a bit light. Add some and we'll see." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "Not quite enough for me, but it's a fair start." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "I'd need more than that. Take another run at it." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "Can't quite do that one. Add something and ask again." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => 'Not enough. I need more.' },
  { when: tbBand('short', 'cool'), reads: 1, text: () => "That's light. Add value." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => "I'm not there. It needs to be better." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => 'It falls short for me.' },
  { when: tbBand('short', 'sour'), reads: 1, text: () => 'Not enough.' },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "That's light. Add more." },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "Short. I'd need more." },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "No, that's not enough." },

  { when: tb('far'), text: () => "That's a long way from where I'd be. I'd start over." },
  { when: tb('far'), text: () => "We're too far apart on that one." },
  { when: tb('far'), text: () => "It isn't close for me. Try a different shape." },
  { when: tb('far'), text: () => "That doesn't work for me. Rethink it." },
  { when: tb('far'), text: () => "I can't see a path from that to a deal." },
  { when: tb('far'), text: () => "Not at that price. It's well short of what I'd do." },
  { when: tbMoment('far', 'deadline'), text: () => "Time's short, and that's too far off to fix." },
  {
    when: tbBand('far', 'warm'),
    reads: 1,
    text: () => "That's too far for me, though I'd happily try another shape with you.",
  },
  {
    when: tbBand('far', 'warm'),
    reads: 1,
    text: () => "I wish I could, but it's a long way off. Let's find another angle.",
  },
  { when: tbBand('far', 'warm'), reads: 1, text: () => "Not that one, I'm afraid. Come back with a different idea." },
  { when: tbBand('far', 'warm'), reads: 1, text: () => "It's well off, but I'm glad to keep trying with you." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "That's quite a way off for me. Try another approach." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "Can't do that one. Maybe something else." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "We're not close on that. Start from somewhere else." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "That's too far from what I need. Take another look." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "That's not close. Try something else." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "No. It's well short." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "That isn't a deal for me. Rework it." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => 'Too far off. Try again.' },
  { when: tbBand('far', 'sour'), reads: 1, text: () => "No. That's nowhere near it." },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'Not close. Try again.' },
  { when: tbBand('far', 'sour'), reads: 1, text: () => "That won't work. Not even near." },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'No. Far off.' },
];

/** Sorted ids of every player and pick on both sides: the same deal reads the same however its sides were listed. */
const dealIds = (proposal: TradeProposal): string =>
  proposal.sides
    .flatMap((s) => [...s.players.map((p) => `p${p}`), ...s.picks.map((k) => `k${k}`)])
    .sort()
    .join(',');

/** His reply on the trade table, steady for a deal within a market moment. */
export function tableLine(league: League, ai: Team, band: TableBand, proposal: TradeProposal): string {
  const f = { ...talkFacts(league, ai), table: band };
  return say(TABLE_LINES, f, { key: `${ai.id}:${league.market?.moment ?? 0}:${dealIds(proposal)}`, slot: 'table' });
}

// ---- his refusal ----

const refuse = (b: StandingBand) => (f: TalkFacts) => f.band === b;

/** Why he won't hear another proposal right now: curt when he's sour, warm when he's fond, never a reason in numbers. */
export const REFUSALS: readonly Line<TalkFacts>[] = [
  { text: () => "I think we've covered enough for now. Let's pick this up later." },
  { text: () => "That's all I can take on for the moment." },
  { text: () => "I've got to stop there for now. We can talk again soon." },
  { text: () => "I've heard enough proposals for now. Give it some time." },
  { text: () => "Let's leave it there. Come back to me later." },
  { text: () => "I'm done talking for now. Try me again in a while." },
  { when: refuse('warm'), reads: 1, text: () => "I'd gladly keep going, but I have to stop for now. Come back soon." },
  { when: refuse('warm'), reads: 1, text: () => "Let's pause there. I'll be glad to pick it up again with you." },
  { when: refuse('warm'), reads: 1, text: () => "I've run out of room for now, but my door's open." },
  { when: refuse('warm'), reads: 1, text: () => "That's all I can do for now. Let's talk again before long." },
  { when: refuse('easy'), reads: 1, text: () => "I think that's enough for now. Catch me again later." },
  { when: refuse('easy'), reads: 1, text: () => "Let's give it a rest for a bit, then try again." },
  { when: refuse('easy'), reads: 1, text: () => "I'm out of time on this for now. Check back with me." },
  { when: refuse('easy'), reads: 1, text: () => "That's plenty for now. We'll talk again." },
  { when: refuse('cool'), reads: 1, text: () => "That's enough for now." },
  { when: refuse('cool'), reads: 1, text: () => "I'm finished with this for the moment." },
  { when: refuse('cool'), reads: 1, text: () => "We'll leave it there. Try me later." },
  { when: refuse('cool'), reads: 1, text: () => 'No more for now.' },
  { when: refuse('sour'), reads: 1, text: () => "That's enough." },
  { when: refuse('sour'), reads: 1, text: () => "I'm done for now." },
  { when: refuse('sour'), reads: 1, text: () => 'Not now.' },
  { when: refuse('sour'), reads: 1, text: () => 'No more today. Try me later.' },
];

/** His refusal to hear more, in his words; steady within a market moment. */
export function refusalLine(league: League, ai: Team): string {
  const f = talkFacts(league, ai);
  return say(REFUSALS, f, { key: `${ai.id}:${league.market?.moment ?? 0}`, slot: 'refusal' });
}

// ---- your director's note ----

/**
 * Your scouting director's one hedged sentence on what he's seen of your dealings with this GM. Hedged because he only
 * sees it from outside: "I think", "I'd guess". Names the man when there is one, never a figure.
 */
export const HISTORY: readonly Line<TalkFacts>[] = [
  {
    when: is('heWon'),
    reads: 1,
    text: (f) => `${f.p.He} came out of the ${surname(f)} deal ahead, and I'd guess ${f.p.he} knows it.`,
  },
  {
    when: is('heWon'),
    reads: 1,
    text: (f) => `I think ${f.p.he} still counts the ${surname(f)} deal as a good one for ${f.p.his} side.`,
  },
  {
    when: is('heWon'),
    reads: 1,
    text: (f) => `${f.p.He} seems pleased with how the ${surname(f)} deal went ${f.memory!.when}.`,
  },
  {
    when: is('both'),
    reads: 1,
    text: (f) => `${f.p.He} seems to think the ${surname(f)} deal treated you both fairly.`,
  },
  {
    when: is('both'),
    reads: 1,
    text: (f) => `I'd say the ${surname(f)} deal left ${f.p.him} with a decent impression of you.`,
  },
  {
    when: is('both'),
    reads: 1,
    text: (f) =>
      `The ${surname(f)} deal ${f.memory!.when} worked for both sides, and I think ${f.p.he} remembers that.`,
  },
  { when: is('youWon'), reads: 1, text: (f) => `${f.p.He} hasn't forgotten the ${surname(f)} deal.` },
  { when: is('youWon'), reads: 1, text: (f) => `I'd guess the ${surname(f)} deal still stings a little.` },
  {
    when: is('youWon'),
    reads: 1,
    text: (f) => `The ${surname(f)} deal went your way ${f.memory!.when}, and I suspect ${f.p.he} remembers.`,
  },
  {
    when: is('brokeDown'),
    reads: 1,
    text: (f) =>
      `The ${surname(f)} deal didn't end the way either side wanted, and I'd expect ${f.p.him} to remember that.`,
  },
  { when: is('brokeDown'), reads: 1, text: (f) => `I think the ${surname(f)} deal still sits with ${f.p.him}.` },
  {
    when: is('brokeDown'),
    reads: 1,
    text: (f) => `${f.p.He} may still be turning over how the ${surname(f)} deal went.`,
  },
  {
    when: is('finalNo'),
    reads: 1,
    text: (f) =>
      `${f.p.He} put ${f.p.his} best offer to you and you turned it down, and I'd expect that to stay with ${f.p.him}.`,
  },
  { when: is('finalNo'), reads: 1, text: (f) => `I think ${f.p.he} took your no on ${f.p.his} final offer to heart.` },
  {
    when: is('finalNo'),
    reads: 1,
    text: (f) => `${f.p.He} won't have forgotten you passing on ${f.p.his} last offer ${f.memory!.when}.`,
  },
  {
    when: is('ledOn'),
    reads: 1,
    text: (f) => `${f.p.He} felt the last round of talks went nowhere, and I think it's stayed with ${f.p.him}.`,
  },
  {
    when: is('ledOn'),
    reads: 1,
    text: (f) => `I'd guess ${f.p.he} is still a little wary after talks that led nowhere ${f.memory!.when}.`,
  },
  { when: is('ledOn'), reads: 1, text: (f) => `${f.p.He} remembers being kept waiting, I think.` },
];

/** The director's line on your history with this GM, or null when there's nothing he'd have seen. */
export function historyNote(league: League, gm: GeneralManager): string | null {
  const team = gm.teamId === null ? undefined : league.teams[gm.teamId];
  if (!team) return null;
  const f = talkFacts(league, team);
  if (!f.memory) return null;
  return say(HISTORY, f, { key: `${gm.id}:${league.season}`, slot: 'history' }) || null;
}
