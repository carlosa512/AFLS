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
import { bestKnown } from './tradeNews';
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

/** The deal's lead man on our scouts' read, "First Last", the way a story would name it: never a throw-in. */
const leadName = (league: League, m: YouMoment): string => {
  const id = bestKnown(league, [...(m.got?.players ?? []), ...(m.gave?.players ?? [])]);
  const p = id === undefined ? undefined : league.players[id];
  return p ? `${p.firstName} ${p.lastName}` : '';
};

/** How long ago, for his words: this league year's is "recently" (a GM doesn't say "this year" about the last round of talks). */
const whenWords = (seasons: number): string => (seasons <= 0 ? 'recently' : ago(seasons));

/**
 * The one thing he'd mention: the latest trade a season on has judged (not an even one) from the last two seasons, else a
 * final no or being led on from this season or last. A deal whose men are gone from the league is passed over.
 */
function memoryOf(league: League, gm: GeneralManager | undefined): MemoryFact | undefined {
  const moments: YouMoment[] = gm?.withYou ?? [];
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if (m.kind !== 'trade' || !m.verdict || m.verdict === 'even' || league.season - m.season > 2) continue;
    const player = leadName(league, m);
    if (player) return { kind: m.verdict, player, when: whenWords(league.season - m.season) };
  }
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if ((m.kind === 'finalNo' || m.kind === 'ledOn') && league.season - m.season <= 1)
      return { kind: m.kind, player: '', when: whenWords(league.season - m.season) };
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

  // Each feeling keeps at least six lines that fit every kind of letter (an enquiry or a price ask has no terms to point at).
  { when: band('warm'), reads: 1, text: () => "You've been straight with me, so I'll come to you first." },
  {
    when: (f) => f.band === 'warm' && terms(f),
    reads: 1,
    text: () => "It's always a good conversation with you, so here's one for you.",
  },
  { when: band('warm'), reads: 1, text: () => "You'll hear this from me before anyone else." },
  { when: band('warm'), reads: 1, text: () => "I'd rather work this out with you than anyone else in the league." },
  { when: band('warm'), reads: 1, text: () => "You're the first call I wanted to make on this." },
  { when: band('warm'), reads: 1, text: () => 'Always good to deal with you, so I will skip the formalities.' },
  { when: band('warm'), reads: 1, text: () => "I figured you'd want to hear this one early." },
  { when: band('easy'), reads: 1, text: () => "We've dealt fine before, so I'll keep it simple." },
  { when: band('easy'), reads: 1, text: () => 'No games on this one.' },
  { when: band('easy'), reads: 1, text: () => 'Thought of you for this one.' },
  { when: band('easy'), reads: 1, text: () => "Hope the week's treating you well." },
  { when: band('easy'), reads: 1, text: () => 'Nothing complicated here.' },
  { when: band('easy'), reads: 1, text: () => 'We get along fine, so I will keep this easy.' },
  { when: band('easy'), reads: 1, text: () => 'Wanted to run something by you.' },
  { when: band('cool'), reads: 1, text: () => 'Getting right to it.' },
  { when: band('cool'), reads: 1, text: () => "I'll lay it out plainly." },
  { when: (f) => f.band === 'cool' && terms(f), reads: 1, text: () => "Here's what I can do." },
  { when: band('cool'), reads: 1, text: () => "I'll be plain about it." },
  { when: band('cool'), reads: 1, text: () => 'No small talk this time.' },
  { when: band('cool'), reads: 1, text: () => "Here's why I'm writing." },
  { when: band('cool'), reads: 1, text: () => "Let's keep this businesslike." },
  { when: band('cool'), reads: 1, text: () => 'Plainly put.' },
  { when: band('sour'), reads: 1, text: () => "I'll keep this short." },
  {
    when: (f) => f.band === 'sour' && terms(f),
    reads: 1,
    text: () => "Here's the offer. Don't make me chase it.",
  },
  { when: band('sour'), reads: 1, text: () => "Don't make me chase this one." },
  { when: band('sour'), reads: 1, text: () => "I'll be brief." },
  { when: band('sour'), reads: 1, text: () => 'No long preamble this time.' },
  { when: band('sour'), reads: 1, text: () => "I'll skip the pleasantries." },
  { when: band('sour'), reads: 1, text: () => 'One read should be enough.' },

  // A moment's lines join the neutral pool (reads 0) so a neutral GM always has at least six to draw from.
  { when: at('deadline'), text: () => "Deadline's close, so no time to be coy." },
  { when: (f) => f.moment === 'deadline' && terms(f), text: () => "With the deadline on us, here's my best shot." },
  { when: at('deadline'), text: () => "The window's nearly shut. Quick one." },
  { when: at('draft'), text: () => "The draft's moving, so I'll be quick." },
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

/** Fond enough to forgive: only these GMs say "no hard feelings"; a cool or sour one never does. */
const gentle = (f: TalkFacts) => f.band === 'warm' || f.band === 'easy' || f.band === 'neutral';
const curt = (f: TalkFacts) => !gentle(f);
const kindIs = (k: MemoryFact['kind'], keep: (f: TalkFacts) => boolean) => (f: TalkFacts) =>
  f.memory?.kind === k && keep(f);
const anyBand = () => true;

/**
 * What he remembers of a dealing with you: two facts read (the kind of memory, that there is one), three when his feeling
 * decides how he takes it. A cool or sour GM never forgives in words ("no hard feelings", "that's fair"): he is curt about
 * a final no, being led on, losing a deal and a deal that broke down, and still never rude.
 */
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
  { when: is('heWon'), reads: 2, text: (f) => `The ${surname(f)} trade was good for us, so I thought of you.` },
  {
    when: is('heWon'),
    reads: 2,
    text: (f) => `I still like how the ${surname(f)} deal turned out. Worth another look.`,
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
  {
    when: is('both'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal worked for both of us, and I'd like another like it.`,
  },
  { when: is('both'), reads: 2, text: (f) => `I thought the ${surname(f)} deal was fair to us both, so I'm back.` },

  // Losing a deal leaves him wary, not forgiving: none of these says anything kind, so every feeling may use them.
  { when: is('youWon'), reads: 2, text: (f) => `You got the better of me on the ${surname(f)} deal. Not this time.` },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went your way ${f.memory!.when}. I'd like to even it up.`,
  },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `I'll admit the ${surname(f)} deal went your way, so I'm more careful now.`,
  },
  {
    when: is('youWon'),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went your way, so I'm weighing this one closely.`,
  },
  {
    when: kindIs('youWon', curt),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went your way. I haven't forgotten it.`,
  },
  {
    when: kindIs('youWon', curt),
    reads: 2,
    text: (f) => `I've been more careful since the ${surname(f)} deal. Keep that in mind.`,
  },
  {
    when: kindIs('youWon', curt),
    reads: 2,
    text: (f) => `After the ${surname(f)} deal, I'm checking everything twice with you.`,
  },

  {
    when: (f) => kindIs('brokeDown', gentle)(f) && terms(f),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't go the way anyone hoped. Let's try for a better one.`,
  },
  {
    when: kindIs('brokeDown', gentle),
    reads: 2,
    text: (f) => `After how the ${surname(f)} deal went, I'm being careful, but I'd still like to talk.`,
  },
  {
    when: (f) => kindIs('brokeDown', gentle)(f) && terms(f),
    reads: 2,
    text: (f) => `Nobody planned on the ${surname(f)} deal turning out like that. This one's cleaner.`,
  },
  {
    when: kindIs('brokeDown', gentle),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't go the way anyone hoped, and I'd still like to keep talking.`,
  },
  {
    when: kindIs('brokeDown', gentle),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't turn out for either of us, but I think we can do better.`,
  },
  {
    when: kindIs('brokeDown', gentle),
    reads: 2,
    text: (f) => `I still think about how the ${surname(f)} deal went. Let's see if we can do better.`,
  },
  {
    when: kindIs('brokeDown', curt),
    reads: 2,
    text: (f) => `The ${surname(f)} deal went badly, and I'm being careful because of it.`,
  },
  {
    when: kindIs('brokeDown', curt),
    reads: 2,
    text: (f) => `I haven't forgotten how the ${surname(f)} deal ended. I'll keep this tight.`,
  },
  {
    when: kindIs('brokeDown', curt),
    reads: 2,
    text: (f) => `After the ${surname(f)} deal, I'm cautious. Judge this one on its merits.`,
  },
  {
    when: kindIs('brokeDown', curt),
    reads: 2,
    text: (f) => `The ${surname(f)} deal didn't work out for us. I'm treading carefully.`,
  },

  {
    when: (f) => kindIs('finalNo', anyBand)(f) && terms(f),
    reads: 2,
    text: () => "I know my last number didn't work for you. This one's different.",
  },
  {
    when: (f) => kindIs('finalNo', gentle)(f) && terms(f),
    reads: 2,
    text: (f) => `You passed on my final offer ${f.memory!.when}, fair enough. Here's another way in.`,
  },
  {
    when: (f) => kindIs('finalNo', gentle)(f) && terms(f),
    reads: 2,
    text: () => "Last time I put my best number down and you said no. I'm not holding it against you.",
  },
  {
    when: kindIs('finalNo', gentle),
    reads: 2,
    text: (f) => `We didn't get there ${f.memory!.when}, and that's fair. I'd like to try again.`,
  },
  {
    when: kindIs('finalNo', gentle),
    reads: 2,
    text: () => "I know the last one didn't work for you. No hard feelings.",
  },
  {
    when: kindIs('finalNo', gentle),
    reads: 2,
    text: () => "We couldn't land the last one, but I'd like to try again.",
  },
  {
    when: kindIs('finalNo', gentle),
    reads: 2,
    text: () => "I'd rather try again than leave it where we left it.",
  },
  {
    when: (f) => kindIs('finalNo', curt)(f) && terms(f),
    reads: 2,
    text: (f) => `You passed on my final offer ${f.memory!.when}. I'd think hard about this one.`,
  },
  {
    when: kindIs('finalNo', curt),
    reads: 2,
    text: (f) => `You passed on my last one ${f.memory!.when}. I remember it.`,
  },
  {
    when: kindIs('finalNo', curt),
    reads: 2,
    text: (f) => `You said no to me ${f.memory!.when}. I'd rather not go through that again.`,
  },
  {
    when: kindIs('finalNo', curt),
    reads: 2,
    text: () => "I put my best down last time and you passed. I'll be careful this time.",
  },
  { when: kindIs('finalNo', curt), reads: 2, text: () => "You passed on the last one. I'll keep this one simple." },
  {
    when: kindIs('finalNo', curt),
    reads: 2,
    text: () => "My last try went nowhere with you. Let's see if this one does.",
  },

  {
    when: (f) => kindIs('ledOn', anyBand)(f) && terms(f),
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
    when: kindIs('ledOn', gentle),
    reads: 2,
    text: (f) => `We went in circles ${f.memory!.when}. Let's not do that again.`,
  },
  { when: kindIs('ledOn', gentle), reads: 2, text: () => "We got nowhere last time, and I'd like to fix that." },
  {
    when: kindIs('ledOn', gentle),
    reads: 2,
    text: () => "I'd rather we got somewhere this time than go in circles.",
  },
  {
    when: kindIs('ledOn', curt),
    reads: 2,
    text: (f) => `We went in circles ${f.memory!.when}. I won't do that again.`,
  },
  {
    when: kindIs('ledOn', curt),
    reads: 2,
    text: (f) => `You kept me waiting ${f.memory!.when}. I'd like a straight answer this time.`,
  },
  { when: kindIs('ledOn', curt), reads: 2, text: () => "I haven't got time for another round of nothing." },
  {
    when: kindIs('ledOn', curt),
    reads: 2,
    text: () => 'Last time went nowhere. Let me know where you stand this time.',
  },
];

// ---- sign-offs ----

/** The moments a deadline-ish word is true: games being played, or free agency's market running. */
const live = (f: TalkFacts) => inSeason(f) || f.moment === 'freeAgency';
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
  // A clock only means something while games or the market are live: the offseason and the draft get no "this week".
  { when: (f) => manner('urgent')(f) && inSeason(f), reads: 1, text: () => 'I need an answer this week.' },
  { when: manner('urgent'), reads: 1, text: () => 'Get back to me soon.' },
  { when: manner('urgent'), reads: 1, text: () => "I'd like to know quickly." },
  { when: (f) => manner('urgent')(f) && live(f), reads: 1, text: () => "The window's short, so let me know." },
  { when: (f) => manner('urgent')(f) && live(f), reads: 1, text: () => 'Sooner is better on my end.' },
  {
    when: (f) => manner('urgent')(f) && live(f),
    reads: 1,
    text: () => "I'm on a clock, so call me when you've looked at it.",
  },
  { when: manner('urgent'), reads: 1, text: () => 'I like to settle things early, so let me know.' },
  { when: manner('urgent'), reads: 1, text: () => "Don't sit on this one too long." },
  { when: manner('urgent'), reads: 1, text: () => 'The earlier I hear, the better.' },
  { when: manner('urgent'), reads: 1, text: () => "I'd like an answer before I make other calls." },
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
  {
    when: (f) => manner('easy')(f) && gentle(f),
    reads: 1,
    text: () => "If it doesn't work for you, no hard feelings.",
  },
  { when: manner('easy'), reads: 1, text: () => 'Whenever you get to it is fine.' },
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
  { when: reason('enquiry'), reads: 2, text: () => 'A short answer is fine.' },

  // Two conditions read (a final offer, a manner's absence of choice): it outranks any manner line.
  { when: (f) => f.final, reads: 2, text: () => "That's as far as I go." },
  { when: (f) => f.final, reads: 2, text: () => "This is my final offer. I won't come back with another." },
  { when: (f) => f.final, reads: 2, text: () => "That's my last number on it." },
  { when: (f) => f.final, reads: 2, text: () => "There's no more room in it on my end. That's final." },
  { when: (f) => f.final, reads: 2, text: () => "I'm done moving on this. It's my final word." },
  { when: (f) => f.final, reads: 2, text: () => "That's the best I can do, and it's the last you'll hear on it." },
];

/**
 * When the chair is empty the letter comes from the club, not a man: no opener (nobody to remember you, nobody to come to
 * you first) and a sign-off in the first person plural, never "I".
 */
export const FRONT_OFFICE_SIGNOFFS: readonly Line<TalkFacts>[] = [
  { text: () => 'Let us know.' },
  { text: () => 'Get back to us when you can.' },
  { text: () => 'We would like to hear from you.' },
  { text: () => "Call us when you've looked at it." },
  { text: () => 'Let us know where you land.' },
  { text: () => 'Our door is open if you want to talk it through.' },
  { when: reason('enquiry'), reads: 1, text: () => 'Let us know either way.' },
  { when: reason('enquiry'), reads: 1, text: () => "If he's not available, just tell us." },
  { when: reason('enquiry'), reads: 1, text: () => 'A short reply is all we need.' },
  { when: reason('enquiry'), reads: 1, text: () => "Call us if it's worth a conversation." },
  { when: reason('enquiry'), reads: 1, text: () => "No rush, but we'd like to hear back." },
  { when: reason('enquiry'), reads: 1, text: () => 'Tell us if he is in play at all.' },
  { when: (f) => f.final, reads: 2, text: () => "That's as far as we go." },
  { when: (f) => f.final, reads: 2, text: () => "This is our final offer. We won't come back with another." },
  { when: (f) => f.final, reads: 2, text: () => "That's our last word on it." },
  { when: (f) => f.final, reads: 2, text: () => "There's no more room in it on our end. That's final." },
  { when: (f) => f.final, reads: 2, text: () => "We're done moving on this. It's our final word." },
  { when: (f) => f.final, reads: 2, text: () => "That's the best we can do, and it's the last you'll hear on it." },
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
  // No man in the chair: the club writes, with no opener and a plural sign-off.
  if (!f.gm) return [core, say(FRONT_OFFICE_SIGNOFFS, f, { ...at, slot: 'signoff' })].filter(Boolean).join(' ');
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
  { when: tbBand('accept', 'warm'), reads: 1, text: () => "You've earned a quick yes. It works for me." },
  { when: tbBand('accept', 'warm'), reads: 1, text: () => 'Good for me, and good to do business with you.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => "That's fine with me. Send it when you're ready." },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'No problem on my end. It works.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'Sounds good to me. Go ahead.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => "I'm fine with that. Make it official." },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'Works for me. Go ahead and send it.' },
  { when: tbBand('accept', 'easy'), reads: 1, text: () => 'Fine by me. Put it forward.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'That works. Send it.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => "I'll do that one." },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'Acceptable. Put it forward.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'That one I can sign off on.' },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => "That's workable. Send it." },
  { when: tbBand('accept', 'cool'), reads: 1, text: () => 'Yes. Put it forward.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => 'Fine. Send it.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => 'That works. Leave it as it is.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => "Acceptable. Don't change it." },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => "I'll take it. Send it over." },

  { when: tbBand('accept', 'sour'), reads: 1, text: () => 'Yes. Send it.' },
  { when: tbBand('accept', 'sour'), reads: 1, text: () => "That's fine. Leave it alone." },
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
  {
    when: tbBand('close', 'warm'),
    reads: 1,
    text: () => "I'm nearly there, and I'd like to get it done with you. One small add.",
  },
  { when: tbBand('close', 'warm'), reads: 1, text: () => "Almost. Give me a little more and we're done." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => 'Pretty close. A small add and we can both walk away happy.' },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "Not far off at all. Add a little and I'm in." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "We're almost there. Toss in something small." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "It's close. A little more and I'll do it." },
  { when: tbBand('close', 'easy'), reads: 1, text: () => 'Close enough that a small add settles it.' },
  { when: tbBand('close', 'easy'), reads: 1, text: () => "Not far at all. A touch more and I'm in." },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Close, but not there. A small add.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Almost. I need a little more.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => "It's near. Add something modest." },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'A bit short. Add a small piece.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Nearly. A small add and it works.' },
  { when: tbBand('close', 'cool'), reads: 1, text: () => 'Short by a little. Add something small.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Close. Add a little more.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Almost. One small add.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Not quite. A bit more.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Nearly. Make it a little better.' },

  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Close. A little more.' },
  { when: tbBand('close', 'sour'), reads: 1, text: () => 'Not there. Add a small piece.' },
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
  {
    when: tbBand('short', 'warm'),
    reads: 1,
    text: () => "I'd like to say yes, but it's short. Add something and I'll look again.",
  },
  { when: tbBand('short', 'warm'), reads: 1, text: () => "Not enough yet, though I'd like it to work. Build it up." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "It's a bit light. Add some and we'll see." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "Not quite enough for me, but it's a fair start." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "I'd need more than that. Take another run at it." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => "Can't quite do that one. Add something and ask again." },
  { when: tbBand('short', 'easy'), reads: 1, text: () => 'A little short for me. Add something and try again.' },
  { when: tbBand('short', 'easy'), reads: 1, text: () => 'Not enough yet. Build on it a bit.' },
  { when: tbBand('short', 'cool'), reads: 1, text: () => 'Not enough. I need more.' },
  { when: tbBand('short', 'cool'), reads: 1, text: () => "That's light. Add value." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => "I'm not there. It needs to be better." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => 'It falls short for me.' },
  { when: tbBand('short', 'cool'), reads: 1, text: () => "It's short. Add more." },
  { when: tbBand('short', 'cool'), reads: 1, text: () => 'I need more than that.' },
  { when: tbBand('short', 'sour'), reads: 1, text: () => 'Not enough.' },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "That's light. Add more." },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "Short. I'd need more." },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "No, that's not enough." },

  { when: tbBand('short', 'sour'), reads: 1, text: () => 'Not there. Add more.' },
  { when: tbBand('short', 'sour'), reads: 1, text: () => "That's short. Try again." },
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
  {
    when: tbBand('far', 'warm'),
    reads: 1,
    text: () => "Too far off for me, though I'd like to find a way with you. Try another shape.",
  },
  {
    when: tbBand('far', 'warm'),
    reads: 1,
    text: () => "I can't get there from that, but I'm happy to keep looking with you.",
  },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "That's quite a way off for me. Try another approach." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "Can't do that one. Maybe something else." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "We're not close on that. Start from somewhere else." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "That's too far from what I need. Take another look." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => "That's well off for me. Try another way in." },
  { when: tbBand('far', 'easy'), reads: 1, text: () => 'Too far for me. Start over from something else.' },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "That's not close. Try something else." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "No. It's well short." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "That isn't a deal for me. Rework it." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => 'Too far off. Try again.' },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "That's well off. Start over." },
  { when: tbBand('far', 'cool'), reads: 1, text: () => "No. It's too far from what I need." },
  { when: tbBand('far', 'sour'), reads: 1, text: () => "No. That's nowhere near it." },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'Not close. Try again.' },
  { when: tbBand('far', 'sour'), reads: 1, text: () => "That won't work. Not even near." },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'No. Far off.' },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'No. Start over.' },
  { when: tbBand('far', 'sour'), reads: 1, text: () => 'Nowhere near. Try something else.' },
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
  {
    when: refuse('warm'),
    reads: 1,
    text: () => "I'd gladly say more, but I have to stop there. Let's talk again soon.",
  },
  { when: refuse('warm'), reads: 1, text: () => "I'm out of room for now. Come back to me soon." },
  { when: refuse('easy'), reads: 1, text: () => "I think that's enough for now. Catch me again later." },
  { when: refuse('easy'), reads: 1, text: () => "Let's give it a rest for a bit, then try again." },
  { when: refuse('easy'), reads: 1, text: () => "I'm out of time on this for now. Check back with me." },
  { when: refuse('easy'), reads: 1, text: () => "That's plenty for now. We'll talk again." },
  { when: refuse('easy'), reads: 1, text: () => "Let's call it there for now. Try me again later." },
  { when: refuse('easy'), reads: 1, text: () => "That's all I can handle for now. We'll pick it up again." },
  { when: refuse('cool'), reads: 1, text: () => "That's enough for now." },
  { when: refuse('cool'), reads: 1, text: () => "I'm finished with this for the moment." },
  { when: refuse('cool'), reads: 1, text: () => "We'll leave it there. Try me later." },
  { when: refuse('cool'), reads: 1, text: () => 'No more for now.' },
  { when: refuse('cool'), reads: 1, text: () => "I'm done for now. Try me later." },
  { when: refuse('cool'), reads: 1, text: () => "We'll leave it at that for now." },
  { when: refuse('sour'), reads: 1, text: () => "That's enough." },
  { when: refuse('sour'), reads: 1, text: () => "I'm done for now." },
  { when: refuse('sour'), reads: 1, text: () => 'Not now.' },
  { when: refuse('sour'), reads: 1, text: () => 'No more today. Try me later.' },
  { when: refuse('sour'), reads: 1, text: () => 'Enough for now.' },
  { when: refuse('sour'), reads: 1, text: () => "I'm finished. Try me later." },
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
