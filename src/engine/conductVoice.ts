/**
 * Discipline in words (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`, "Your call on team-rules
 * trouble"): the head coach's row about a man in trouble, how he tells an answer he gave for you, the league's ruling as
 * he passes it on, and the league office's own letter. Every sentence is whole and written by hand, with slots only for
 * facts (a name, a game, a week), chosen by `say` on what the writer can see: the most specific line that fits wins and
 * nothing is said twice in a league year. The head coach is direct and dry, the league office neutral: it starts with
 * its news and stops on a fact. No numeral in the coach's lines, nothing about traits or odds. A leaf: types only.
 */
import type { ConductKind } from './types';
import type { Line } from './voice';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const ORDINAL = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
export const countWord = (n: number) => WORDS[n] ?? String(n);
export const ordinalWord = (n: number) => ORDINAL[n] ?? `${n}th`;
const gameWord = (n: number) => `${countWord(n)} game${n === 1 ? '' : 's'}`;

/** The kinds a head coach is asked about. */
export const TEAM_RULES: readonly ConductKind[] = ['curfew', 'meeting', 'late', 'teamEvent', 'spat', 'practiceScuffle'];

/** An incident as a noun phrase, for a card's list and the coach's notes. */
export const INCIDENT: Record<ConductKind, string> = {
  curfew: 'a missed curfew',
  meeting: 'a missed team meeting',
  late: 'a late arrival at practice',
  teamEvent: 'a skipped team event',
  spat: 'a public spat',
  practiceScuffle: 'a scuffle at practice',
  fight: 'a fight off the field',
  ejected: 'an ejection',
  dangerousFouls: 'a run of dangerous fouls',
};

// ───────── the coach's row ─────────

export interface ConductFact {
  kind: ConductKind;
  last: string;
  /** Earlier team-rules trouble of his in this league year. */
  times: number;
  /** Nothing at all on his record in the last two league years. */
  clean: boolean;
  /** How you settled his last trouble. */
  lastOutcome?: 'fine' | 'sat' | 'letGo';
  starter: boolean;
  rookie: boolean;
  veteran: boolean;
  inSeason: boolean;
}

const of = (kind: ConductKind, reads: number, texts: string[], when?: (f: ConductFact) => boolean) =>
  texts.map(
    (t): Line<ConductFact> => ({
      when: (f) => f.kind === kind && (!when || when(f)),
      reads,
      text: () => t,
    }),
  );
const again = (f: ConductFact) => f.times > 0;
const week = (f: ConductFact) => f.inSeason && f.times === 0;
const plain = (f: ConductFact) => f.times === 0;

/** What he did, in words that follow his name. */
export const CONDUCT_LEAD: readonly Line<ConductFact>[] = [
  ...of(
    'curfew',
    1,
    ['was out past curfew.', 'broke curfew and the staff heard about it.', 'came in after curfew.'],
    plain,
  ),
  ...of('curfew', 1, ['was out past curfew this week.', 'broke curfew this week.'], week),
  ...of('curfew', 2, ['broke curfew again.', 'was out past curfew once more.'], again),
  ...of(
    'meeting',
    1,
    [
      'missed a team meeting.',
      'did not show for a team meeting and gave no reason.',
      'was not in the room for a team meeting.',
    ],
    plain,
  ),
  ...of(
    'meeting',
    1,
    ['missed a team meeting this week.', 'skipped a team meeting this week and offered no reason.'],
    week,
  ),
  ...of('meeting', 2, ['missed another team meeting.', 'was absent from a team meeting again.'], again),
  ...of(
    'late',
    1,
    [
      'was late to practice.',
      'showed up late to practice.',
      'came in late for practice and the position coach noticed.',
    ],
    plain,
  ),
  ...of('late', 1, ['was late to practice this week.', 'walked into practice late this week.'], week),
  ...of('late', 2, ['was late to practice again.', 'was late again and the position coach noticed.'], again),
  ...of(
    'teamEvent',
    1,
    [
      'skipped a team event he was expected at.',
      'did not show up to a team event.',
      'stayed away from a team event and people noticed.',
    ],
    plain,
  ),
  ...of('teamEvent', 1, ['skipped a team event this week.', 'stayed away from a team event this week.'], week),
  ...of('teamEvent', 2, ['skipped another team event.', 'stayed away from a team event again.'], again),
  ...of(
    'spat',
    1,
    [
      'got into a public spat.',
      'got into a public argument and it got out.',
      'said something in public that he should have kept to himself.',
    ],
    plain,
  ),
  ...of('spat', 1, ['got into a public spat this week.', 'had a public argument this week and it got out.'], week),
  ...of('spat', 2, ['got into another public spat.', 'was in a public argument again.'], again),
  ...of(
    'practiceScuffle',
    1,
    [
      'got into a scuffle at practice.',
      'lost his temper at practice and it turned into a scuffle.',
      'got into it at practice and the coaches broke it up.',
    ],
    plain,
  ),
  ...of(
    'practiceScuffle',
    1,
    ['got into a scuffle at practice this week.', 'was in a scuffle at practice this week.'],
    week,
  ),
  ...of('practiceScuffle', 2, ['was in another scuffle at practice.', 'got into it at practice again.'], again),
];

const OUTCOME_LAST: Record<'fine' | 'sat' | 'letGo', string> = {
  fine: 'We fined him for the last one.',
  sat: 'We sat him for the last one.',
  letGo: 'I let the last one go.',
};

/** What came before with him, when there is something to say; the line is optional. */
export const CONDUCT_BEFORE: readonly Line<ConductFact>[] = [
  { when: (f) => f.clean, reads: 1, text: () => 'He has not given us trouble before.' },
  { when: (f) => f.clean, reads: 1, text: () => 'This is the first time his name has come up.' },
  {
    when: (f) => f.times === 1 && !f.lastOutcome,
    reads: 1,
    text: () => 'It is the second time this season.',
  },
  {
    when: (f) => f.times === 1 && !!f.lastOutcome,
    reads: 2,
    text: (f) => `It is the second time this season. ${OUTCOME_LAST[f.lastOutcome!]}`,
  },
  {
    when: (f) => f.times === 2,
    reads: 1,
    text: () => 'It is the third time this season.',
  },
  {
    when: (f) => f.times === 2 && !!f.lastOutcome,
    reads: 2,
    text: (f) => `It is the third time this season. ${OUTCOME_LAST[f.lastOutcome!]}`,
  },
  { when: (f) => f.times >= 3, reads: 1, text: () => 'He has been in trouble more than three times this season.' },
  { when: (f) => f.times >= 3, reads: 1, text: () => 'This has happened to us again and again this season.' },
];

/** The coach's read, before your answer. */
export const CONDUCT_READ: readonly Line<ConductFact>[] = [
  { reads: 0, text: () => 'The rest of the team is waiting to see what we do.' },
  { reads: 0, text: () => 'Everyone will notice what we do here.' },
  { reads: 0, text: () => 'How we answer this sets the standard for the rest of the team.' },
  { reads: 0, text: () => 'He knows what the rules are, and so does everyone around him.' },
  { when: (f) => f.rookie, reads: 2, text: () => 'He is young and still learning what is expected here.' },
  { when: (f) => f.rookie, reads: 2, text: () => 'He is a rookie, and he is learning what the job asks of him.' },
  {
    when: (f) => f.veteran && f.starter,
    reads: 3,
    text: () => 'He is a veteran and a starter, so he knows better and the room knows it.',
  },
  {
    when: (f) => f.veteran && f.starter,
    reads: 3,
    text: () => 'He starts for us and has been here long enough to know the rules.',
  },
  {
    when: (f) => f.starter && !f.rookie,
    reads: 2,
    text: () => 'He starts for us, so a game without him would cost us on the field.',
  },
  { when: (f) => f.veteran && !f.starter, reads: 2, text: () => 'He has been around long enough to know better.' },
  {
    when: (f) => f.kind === 'spat' || f.kind === 'teamEvent',
    reads: 1,
    text: () => 'It is public, so people outside the team will read how we answer.',
  },
  {
    when: (f) => f.kind === 'spat' || f.kind === 'teamEvent',
    reads: 1,
    text: () => 'Everyone has seen it, so they will see what we do.',
  },
];

/** The headline of a letter that opens on his trouble: a few words. */
export const CONDUCT_HEAD: readonly Line<{ kind: ConductKind; last: string }>[] = [
  { when: (f) => f.kind === 'curfew', text: (f) => `${f.last} broke curfew` },
  { when: (f) => f.kind === 'meeting', text: (f) => `${f.last} missed a meeting` },
  { when: (f) => f.kind === 'late', text: (f) => `${f.last} was late to practice` },
  { when: (f) => f.kind === 'teamEvent', text: (f) => `${f.last} skipped a team event` },
  { when: (f) => f.kind === 'spat', text: (f) => `${f.last}'s public spat` },
  { when: (f) => f.kind === 'practiceScuffle', text: (f) => `${f.last}'s scuffle at practice` },
];

// ───────── what he did about it, and what the league did ─────────

export interface NoteFact {
  kind: ConductKind;
  last: string;
  answer?: 'fine' | 'sat' | 'letGo';
  /** The league's ruling, when it is the league's. */
  ruling?: 'leagueFine' | 'suspended';
  games?: number;
  /** Earlier team-rules trouble of his in this league year. */
  times: number;
}

const THING: Record<ConductKind, string> = {
  curfew: 'breaking curfew',
  meeting: 'missing a team meeting',
  late: 'being late to practice',
  teamEvent: 'skipping a team event',
  spat: 'the public spat',
  practiceScuffle: 'the scuffle at practice',
  fight: 'the fight off the field',
  ejected: 'his ejection',
  dangerousFouls: 'his dangerous fouls',
};

const ans = (a: NoteFact['answer'], texts: ((f: NoteFact) => string)[], reads = 1, more?: (f: NoteFact) => boolean) =>
  texts.map(
    (text): Line<NoteFact> => ({
      when: (f) => f.answer === a && (!more || more(f)),
      reads,
      text,
    }),
  );

/** How the head coach tells you what he settled himself, one sentence in a note. */
export const CONDUCT_DONE: readonly Line<NoteFact>[] = [
  ...ans('fine', [
    (f) => `I fined ${f.last} for ${THING[f.kind]}.`,
    (f) => `${f.last} is fined for ${THING[f.kind]}, and I made it clear that it stops here.`,
    (f) => `${f.last} gets a fine for ${THING[f.kind]}, and he knows where we stand.`,
  ]),
  ...ans('sat', [
    (f) => `${f.last} sits the next game for ${THING[f.kind]}.`,
    (f) => `I am sitting ${f.last} for a game over ${THING[f.kind]}.`,
    (f) => `I sat ${f.last} down for a game over ${THING[f.kind]}.`,
  ]),
  ...ans('letGo', [
    (f) => `I let ${f.last} off for ${THING[f.kind]} this time.`,
    (f) => `${f.last} gets a pass for ${THING[f.kind]}, and I will watch him closely.`,
    (f) => `I did not punish ${f.last} for ${THING[f.kind]}, and he knows I am watching.`,
  ]),
  ...ans(
    'letGo',
    [
      (f) => `I let ${f.last} off for ${THING[f.kind]} again, and that cannot go on.`,
      (f) => `${f.last} got another pass for ${THING[f.kind]}, and I am running out of reasons.`,
    ],
    2,
    (f) => f.times > 0,
  ),
];

/** The league's ruling on one of your players, as the head coach passes it on. */
export const CONDUCT_RULED: readonly Line<NoteFact>[] = [
  {
    when: (f) => f.ruling === 'leagueFine',
    text: (f) => `The league fined ${f.last} for ${THING[f.kind]}. There is no suspension.`,
  },
  {
    when: (f) => f.ruling === 'leagueFine',
    text: (f) => `${f.last} was fined by the league for ${THING[f.kind]}, and nothing more.`,
  },
  {
    when: (f) => f.ruling === 'suspended',
    text: (f) => `The league suspended ${f.last} for ${gameWord(f.games ?? 1)} over ${THING[f.kind]}.`,
  },
  {
    when: (f) => f.ruling === 'suspended',
    text: (f) => `${f.last} is suspended by the league for ${gameWord(f.games ?? 1)}, and we play without him.`,
  },
];

// ───────── the league office ─────────

export interface LeagueFact {
  full: string;
  last: string;
  kind: ConductKind;
  ruling: 'leagueFine' | 'suspended';
  games: number;
  /** Why he was thrown out, when the game's record says. */
  why?: 'fight' | 'twoUnsportsmanlike' | 'flagrant';
  /** The quarter in words, and where it was: "at Miami", "at home against New England". */
  quarter?: string;
  where?: string;
  /** His ejections this league year and his league suspensions in two, this one counted. */
  ejections: number;
  bans: number;
  /** The next game he misses, "at home against New England", and the week he is back, when the schedule says. */
  next?: string;
  back?: number;
}

const gameLine = (f: LeagueFact) => !!f.quarter && !!f.where;
const at = (f: LeagueFact) => `in the ${f.quarter} quarter ${f.where}`;
const ruled = (f: LeagueFact) => f.ruling === 'suspended';
const lg = (
  pick: (f: LeagueFact) => boolean,
  reads: number,
  ...texts: ((f: LeagueFact) => string)[]
): Line<LeagueFact>[] => texts.map((text) => ({ when: pick, reads, text }));

/** The first sentence of the league's letter: the ruling and what it was for. */
export const LEAGUE_RULING: readonly Line<LeagueFact>[] = [
  ...lg(
    (f) => ruled(f) && f.kind === 'ejected' && f.why === 'fight' && gameLine(f),
    3,
    (f) => `The league has suspended ${f.full} for ${gameWord(f.games)} for fighting ${at(f)}. He was ejected for it.`,
    (f) =>
      `${f.full} is suspended for ${gameWord(f.games)} by the league for fighting ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => ruled(f) && f.kind === 'ejected' && f.why === 'twoUnsportsmanlike' && gameLine(f),
    3,
    (f) =>
      `The league has suspended ${f.full} for ${gameWord(f.games)} for a second unsportsmanlike conduct foul ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => ruled(f) && f.kind === 'ejected' && f.why === 'flagrant' && gameLine(f),
    3,
    (f) =>
      `The league has suspended ${f.full} for ${gameWord(f.games)} for a flagrant hit ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => ruled(f) && f.kind === 'ejected' && !gameLine(f),
    1,
    (f) => `The league has suspended ${f.full} for ${gameWord(f.games)} after his ejection.`,
  ),
  ...lg(
    (f) => ruled(f) && f.kind === 'fight',
    2,
    (f) => `The league has suspended ${f.full} for ${gameWord(f.games)} for a fight off the field.`,
    (f) => `${f.full} is suspended for ${gameWord(f.games)} by the league after a fight off the field.`,
  ),
  ...lg(
    (f) => ruled(f) && f.kind === 'dangerousFouls',
    2,
    (f) => `The league has suspended ${f.full} for ${gameWord(f.games)} after a run of dangerous fouls this season.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'ejected' && f.why === 'fight' && gameLine(f),
    3,
    (f) => `The league has fined ${f.full} for fighting ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'ejected' && f.why === 'twoUnsportsmanlike' && gameLine(f),
    3,
    (f) => `The league has fined ${f.full} for a second unsportsmanlike conduct foul ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'ejected' && f.why === 'flagrant' && gameLine(f),
    3,
    (f) => `The league has fined ${f.full} for a flagrant hit ${at(f)}. He was ejected for it.`,
    (f) => `${f.full} is fined by the league for a flagrant hit ${at(f)}. He was ejected for it.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'ejected' && !gameLine(f),
    1,
    (f) => `The league has fined ${f.full} after his ejection.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'dangerousFouls',
    2,
    (f) => `The league has fined ${f.full} for a run of dangerous fouls this season.`,
  ),
  ...lg(
    (f) => !ruled(f) && f.kind === 'fight',
    2,
    (f) => `The league has fined ${f.full} for a fight off the field.`,
  ),
];

/** The sentence after it: how this one stands on his record. Optional. */
export const LEAGUE_RECORD: readonly Line<LeagueFact>[] = [
  ...lg(
    (f) => f.kind === 'ejected' && ruled(f),
    2,
    (f) => `It is his ${ordinalWord(f.ejections)} ejection this season and his ${ordinalWord(f.bans)} suspension.`,
  ),
  ...lg(
    (f) => f.kind === 'ejected' && !ruled(f),
    2,
    (f) => `It is his ${ordinalWord(f.ejections)} ejection this season.`,
  ),
  ...lg(
    (f) => f.kind !== 'ejected' && ruled(f) && f.bans === 1,
    1,
    () => 'It is his first suspension.',
  ),
  ...lg(
    (f) => f.kind !== 'ejected' && ruled(f) && f.bans > 1,
    1,
    (f) => `It is his ${ordinalWord(f.bans)} suspension in two years.`,
  ),
  ...lg(
    (f) => f.kind === 'dangerousFouls' && !ruled(f),
    2,
    () => 'There is no suspension, and another run of them would bring one.',
  ),
  ...lg(
    (f) => f.kind === 'ejected' && !ruled(f),
    3,
    () => 'There is no suspension, and a second ejection this season would bring one.',
  ),
];

/** The last sentence of a suspension: the games he misses and when he is back. */
export const LEAGUE_MISSES: readonly Line<LeagueFact>[] = [
  ...lg(
    (f) => ruled(f) && f.games === 1 && !!f.next && f.back !== undefined,
    3,
    (f) => `He will miss the game ${f.next} and is eligible to return in week ${f.back}.`,
  ),
  ...lg(
    (f) => ruled(f) && f.games > 1 && !!f.next && f.back !== undefined,
    3,
    (f) =>
      `He will miss the next ${countWord(f.games)} games, starting with the game ${f.next}, and is eligible to return in week ${f.back}.`,
  ),
  ...lg(
    (f) => ruled(f) && !f.next,
    1,
    (f) =>
      `He will serve ${f.games === 1 ? 'it' : 'them'} in the first ${f.games === 1 ? 'game' : 'games'} of next season.`,
  ),
  ...lg(
    (f) => ruled(f) && !!f.next && f.back === undefined,
    2,
    (f) => `He will miss the game ${f.next}, and the rest of his suspension carries over to next season.`,
  ),
];

export const LEAGUE_SUBJECT: readonly Line<LeagueFact>[] = [
  { when: (f) => ruled(f), text: (f) => `${f.full} suspended ${gameWord(f.games)}` },
  { when: (f) => !ruled(f), text: (f) => `${f.full} fined` },
];
