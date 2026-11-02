/**
 * The head coach's words on a dispute (G4, `disputeMail.ts`): direct, as he writes everything. Every sentence is chosen
 * by `say` from what the club can see (who he is, the kind of dispute, how it ended), so the same league always writes
 * the same letter.
 */
import type { Dispute, DisputeChoice, DisputeHow, DisputeKind } from './types';
import type { Line } from './voice';

export interface DisputeFact {
  /** His last name; `full` his whole. */
  name: string;
  full: string;
  kind: DisputeKind;
  /** Outspoken: he says it to anyone who'll listen. */
  loud: boolean;
  veteran: boolean;
  starter: boolean;
  how?: DisputeHow;
}

export const DISPUTE_SUBJECT: Record<'holdIn' | 'holdOut', (name: string) => string> = {
  holdOut: (name) => `${name} is holding out`,
  holdIn: (name) => `${name} is holding in`,
};

/** The letter when it starts. */
export const DISPUTE_START: readonly Line<DisputeFact>[] = [
  {
    when: (f) => f.kind === 'holdOut',
    reads: 1,
    text: (f) =>
      `${f.full} isn't reporting. He wants a new deal, and he'll stay away until he has one or it costs him more than he's willing to lose. Camp fines start when camp does.`,
  },
  {
    when: (f) => f.kind === 'holdOut',
    reads: 1,
    text: (f) =>
      `${f.full} has told us he won't report without a new deal. Every day of camp he misses is a fine, and every game check after that he doesn't get.`,
  },
  {
    when: (f) => f.kind === 'holdOut' && f.loud,
    reads: 2,
    text: (f) =>
      `${f.full} won't report without a new deal, and he's made sure everyone knows it. Every day of camp he misses costs him, and he doesn't seem to care yet.`,
  },
  {
    when: (f) => f.kind === 'holdIn',
    reads: 1,
    text: (f) =>
      `${f.full} is in the building, but he won't practice until his deal is sorted. He'll sit in meetings and nothing more until the games count.`,
  },
  {
    when: (f) => f.kind === 'holdIn',
    reads: 1,
    text: (f) =>
      `${f.full} reported, but he's not practicing. He wants a new deal first. He'll play when the season starts either way, but he's losing the work.`,
  },
  {
    when: (f) => f.kind === 'holdIn' && f.veteran && f.starter,
    reads: 3,
    text: (f) =>
      `${f.full} is holding in. He's been around long enough to know how this works: he shows up, he doesn't practice, and he waits on a new deal.`,
  },
];

/** What he wants from you, closing the letter. */
export const DISPUTE_ASK: readonly Line<DisputeFact>[] = [
  { text: () => 'How do you want to handle it?' },
  { text: () => 'Your call on how we answer him.' },
  { text: () => "Tell me how you want to play it and I'll pass it on." },
];

const END_SUBJECT: Record<DisputeHow, (name: string) => string> = {
  signed: (n) => `${n} is back, deal done`,
  promise: (n) => `${n} takes your word`,
  gaveIn: (n) => `${n} has reported`,
  week1: (n) => `${n} is practicing again`,
  traded: (n) => `${n}'s dispute is over`,
  released: (n) => `${n}'s dispute is over`,
  withdrawn: (n) => `${n} has let it go`,
  newYear: (n) => `${n}'s dispute is behind us`,
};
export const disputeEndSubject = (name: string, how: DisputeHow) => END_SUBJECT[how](name);

/** The letter when it ends. */
export const DISPUTE_END: readonly Line<DisputeFact>[] = [
  {
    when: (f) => f.how === 'signed',
    reads: 1,
    text: (f) => `${f.full} is back at work. With his new deal done, there's nothing hanging over him.`,
  },
  {
    when: (f) => f.how === 'promise',
    reads: 1,
    text: (f) =>
      `${f.full} took your word on a new deal and he's back at work. He'll be watching for it, and so will the room.`,
  },
  {
    when: (f) => f.how === 'gaveIn',
    reads: 1,
    text: (f) =>
      `${f.full} has reported. He gave in, he didn't get what he wanted, and he isn't happy about it. I'd keep an eye on him.`,
  },
  {
    when: (f) => f.how === 'week1',
    reads: 1,
    text: (f) =>
      `${f.full} practiced today. The games count now and he's playing, but nothing's been settled for him, and he knows it.`,
  },
  {
    when: (f) => f.how === 'newYear',
    reads: 1,
    text: (f) => `${f.full}'s dispute is behind us with the new league year. We start over with him.`,
  },
  { text: (f) => `${f.full}'s dispute is over.` },
];

/** What you told him, as the letter shows it once you've answered. */
export const DISPUTE_SAID: Record<DisputeChoice, string> = {
  negotiate: 'You opened contract talks with him.',
  promise: 'You promised him a new deal.',
  firm: 'You held firm.',
  shop: 'You put him on the trade block.',
  refuse: 'You refused him.',
};

/** A dispute in two words, wherever it shows: the report, the Locker Room, the card. */
export const DISPUTE_LABEL: Record<DisputeKind, string> = {
  holdIn: 'Holding in',
  holdOut: 'Holding out',
  trade: 'Wants a trade',
};

/** Where a running dispute stands, for the locker room report: where he is, what it has cost him, your answer. */
export function disputeStanding(d: Dispute): string {
  const where =
    d.kind === 'holdOut'
      ? d.out
        ? 'Not reporting.'
        : 'Staying away from the spring program.'
      : 'In the building, not practicing.';
  const cost = d.lost ? ` It has cost him $${(d.lost / 1000).toFixed(1)}M.` : '';
  const answer = d.answered ? ` ${DISPUTE_SAID[d.answered.choice]}` : ' He waits on your answer.';
  return `${where}${cost}${answer}`;
}
