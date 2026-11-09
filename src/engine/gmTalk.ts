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
import { isDeadlineDay } from './trade/rules';
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

export function talkFacts(league: League, team: Team, opts?: { final?: boolean }): TalkFacts {
  const gm = aiGm(league, team);
  return {
    team,
    gm,
    manner: mannerOf(team, gm),
    band: standingBand(standingWith(league, gm)),
    memory: memoryOf(league, gm),
    moment: momentOf(league),
    final: !!opts?.final,
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
const at = (m: TalkMoment) => (f: TalkFacts) => f.moment === m;

/** Neutral pool first (no condition, so it always fits), then lines that lean on his feeling for you or the moment. */
export const OPENERS: readonly Line<TalkFacts>[] = [
  { text: () => 'Wanted to get this in front of you before the week gets away.' },
  { text: () => "I'd rather write than play phone tag, so here it is." },
  { text: () => "Got something I'd like you to look at." },
  { text: () => 'Been going through my roster and this came up.' },
  { text: () => "Have a minute? This one's worth a look." },
  { text: () => "I've been working through my list and your club came up." },
  { text: () => 'Straight to it.' },

  { when: band('warm'), reads: 1, text: () => "You've been straight with me, so I'll come to you first." },
  { when: band('warm'), reads: 1, text: () => "It's always a good conversation with you, so here's one for you." },
  { when: band('warm'), reads: 1, text: () => "You'll hear this from me before anyone else." },
  { when: band('warm'), reads: 1, text: () => "I'd rather work this out with you than anyone else in the league." },
  { when: band('easy'), reads: 1, text: () => "We've dealt fine before, so I'll keep it simple." },
  { when: band('easy'), reads: 1, text: () => 'No games on this one.' },
  { when: band('easy'), reads: 1, text: () => 'Thought of you for this one.' },
  { when: band('easy'), reads: 1, text: () => "Hope the week's treating you well. Here's what I have." },
  { when: band('cool'), reads: 1, text: () => 'Getting right to it.' },
  { when: band('cool'), reads: 1, text: () => "I'll lay it out plainly." },
  { when: band('cool'), reads: 1, text: () => "Here's what I can do." },
  { when: band('sour'), reads: 1, text: () => "I'll keep this short." },
  { when: band('sour'), reads: 1, text: () => "Here's the offer. Don't make me chase it." },
  { when: band('sour'), reads: 1, text: () => "I'll be brief." },
  { when: band('sour'), reads: 1, text: () => 'No long preamble this time.' },

  { when: at('deadline'), reads: 1, text: () => "Deadline's close, so no time to be coy." },
  { when: at('deadline'), reads: 1, text: () => "With the deadline on us, here's my best shot." },
  { when: at('deadline'), reads: 1, text: () => "The window's nearly shut. Quick one." },
  { when: at('draft'), reads: 1, text: () => "We're on the clock, so I'll be quick." },
  { when: at('draft'), reads: 1, text: () => "The room's moving fast, so here's mine." },
  { when: at('leagueYear'), reads: 1, text: () => "New league year, new roster math. Here's an idea." },
  { when: at('leagueYear'), reads: 1, text: () => "Now that the books are open, I've got a thought." },
  { when: at('freeAgency'), reads: 1, text: () => "The market's moving, so I'll be quick." },
  { when: at('freeAgency'), reads: 1, text: () => 'Free agency has me looking at my depth, and at yours.' },
  { when: at('camp'), reads: 1, text: () => "Camp's got me looking hard at depth." },
  { when: at('camp'), reads: 1, text: () => "Camp's showing me where I'm short." },
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
    when: is('both'),
    reads: 2,
    text: (f) => `Both of us came out of the ${surname(f)} deal fine. Here's the next one.`,
  },
  { when: is('youWon'), reads: 2, text: (f) => `You got the better of me on the ${surname(f)} deal. Not this time.` },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `I'll admit the ${surname(f)} deal went your way, so I've come with a better number.`,
  },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went your way ${f.memory!.when}. I'd like to even it up.`,
  },
  {
    when: is('brokeDown'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't go the way anyone hoped. Let's try for a better one.`,
  },
  {
    when: is('brokeDown'),
    reads: 2,
    text: (f) => `After how the ${surname(f)} deal went, I'm being careful, but I'd still like to talk.`,
  },
  {
    when: is('brokeDown'),
    reads: 2,
    text: (f) => `Nobody planned on the ${surname(f)} deal turning out like that. This one's cleaner.`,
  },
  { when: is('finalNo'), reads: 2, text: () => "I know my last number didn't work for you. This one's different." },
  {
    when: is('finalNo'),
    reads: 2,
    text: (f) => `You passed on my final offer ${f.memory!.when}, fair enough. Here's another way in.`,
  },
  {
    when: is('finalNo'),
    reads: 2,
    text: () => "Last time I put my best number down and you said no. I'm not holding it against you.",
  },
  {
    when: is('ledOn'),
    reads: 2,
    text: () => 'Last time we went back and forth and got nowhere. Let me try a cleaner one.',
  },
  {
    when: is('ledOn'),
    reads: 2,
    text: (f) => `Our talks ${f.memory!.when} went nowhere, so this time I'm putting it plainly.`,
  },
  { when: is('ledOn'), reads: 2, text: () => "I'd like to skip the back and forth this time." },
];

// ---- sign-offs ----

const manner = (m: Manner) => (f: TalkFacts) => f.manner === m && !f.final;

/** His manner in the last line; a final offer says so in his words and beats the manner. */
export const SIGNOFFS: readonly Line<TalkFacts>[] = [
  { when: manner('firm'), reads: 1, text: () => "That's where we are." },
  { when: manner('firm'), reads: 1, text: () => "That's the number." },
  { when: manner('firm'), reads: 1, text: () => "It's a fair price and I'm not going to move much." },
  { when: manner('firm'), reads: 1, text: () => "I'll hold where I am." },
  { when: manner('firm'), reads: 1, text: () => 'You know where I stand on this.' },
  { when: manner('firm'), reads: 1, text: () => 'Call me if you can meet it.' },
  { when: manner('urgent'), reads: 1, text: () => 'I need an answer this week.' },
  { when: manner('urgent'), reads: 1, text: () => 'Get back to me soon.' },
  { when: manner('urgent'), reads: 1, text: () => "I'd like to know quickly." },
  { when: manner('urgent'), reads: 1, text: () => "The window's short, so let me know." },
  { when: manner('urgent'), reads: 1, text: () => 'Sooner is better on my end.' },
  { when: manner('urgent'), reads: 1, text: () => "I'm on a clock, so call me when you've looked at it." },
  { when: manner('careful'), reads: 1, text: () => 'It has to fit under my cap, so keep that in mind.' },
  { when: manner('careful'), reads: 1, text: () => "The cap's tight on my end, so I can't stretch it." },
  { when: manner('careful'), reads: 1, text: () => "I can't go further on the money." },
  { when: manner('careful'), reads: 1, text: () => 'Mind the cap numbers when you reply.' },
  { when: manner('careful'), reads: 1, text: () => "Money's the limit on my side." },
  { when: manner('careful'), reads: 1, text: () => 'Run it past your cap people and call me.' },
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
  const f = talkFacts(league, team, { final: offer.final });
  const recent = earlierBodies(league, letterFrom(league, team), offer);
  const at = { key: `${offer.season}:${offer.id}`, recent };
  // A memory is quoted at most every other letter: not when his last letter already told it.
  const told = f.memory
    ? MEMORY_OPENERS.some((l) => (!l.when || l.when(f)) && !!recent[0]?.includes(l.text(f)))
    : false;
  const memory = f.memory && !told ? say(MEMORY_OPENERS, f, { ...at, slot: 'memory' }) : '';
  const opener = memory || say(OPENERS, f, { ...at, slot: 'opener' });
  return [opener, core, say(SIGNOFFS, f, { ...at, slot: 'signoff' })].filter(Boolean).join(' ');
}
