import { beliefOf, beliefRead, runnerOf } from '../belief';
import { chairHolder, teamCoaches } from '../coaching';
import { traitOf } from '../coachTraits';
import { yearsLeft } from '../finance/contract';
import { moraleContext, type MoraleContext } from '../morale';
import { STARTERS } from '../positions';
import { computeRecords } from '../season/standings';
import { unitRead } from '../standing';
import type {
  Backing,
  CoachRoom,
  League,
  MeetingScope,
  MeetingSuggestion,
  Moment,
  Player,
  MeetingTopic,
  TalkCause,
} from '../types';
import { credibilityRead, type CredibilityRead } from './credibility';

/**
 * What a meeting's letters may read (L2, spec §5): your club only, in words and flags. The letters' lines are picked
 * from these (`meetings/voice.ts`); nothing here is shown as a number.
 */

/** How the head coach talks: a disciplinarian terse, a players' coach warm (the same lines as `ai.ts` reads). */
export type Style = 'terse' | 'plain' | 'warm';
export const styleOf = (discipline: number): Style => (discipline >= 14 ? 'terse' : discipline <= 7 ? 'warm' : 'plain');

/** A room as the coach names it. */
export const SCOPE_NOUN: Record<MeetingScope, string> = {
  QB: 'the quarterbacks',
  RB: 'the backs',
  WR: 'the receivers',
  OL: 'the offensive line',
  DL: 'the D-line',
  LB: 'the linebackers',
  DB: 'the secondary',
  team: 'the team',
};

const ORDINAL = ['', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** "a rookie", "a third-year man", "an eight-year veteran", "a long-time veteran". */
export function yearsPhrase(experience: number): string {
  if (experience <= 0) return 'a rookie';
  if (experience <= 3) return `a ${ORDINAL[experience]}-year man`;
  const words = ['', '', '', '', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  return experience < words.length
    ? `${experience === 8 || experience === 11 ? 'an' : 'a'} ${words[experience]}-year veteran`
    : 'a long-time veteran';
}

/** A man as the coach sees him. */
export interface ManFact {
  id: number;
  first: string;
  last: string;
  years: string;
  starting: boolean;
  rookieDeal: boolean;
  finalYear: boolean;
}

export function manFact(league: League, p: Player): ManFact {
  const chart = p.teamId === null ? [] : (league.teams[p.teamId].depthChart[p.position] ?? []);
  return {
    id: p.id,
    first: p.firstName,
    last: p.lastName,
    years: yearsPhrase(p.experience),
    starting: chart.slice(0, STARTERS[p.position]).includes(p.id),
    rookieDeal: p.contract?.kind === 'rookie',
    finalYear: !!p.contract && yearsLeft(p.contract, league.season) <= 1,
  };
}

export type Record3 = 'winning' | 'losing' | 'even';

/** The head coach's read of a suggestion: what it's about, who's driving it, and the club's week. */
export interface SuggestFact {
  style: Style;
  scope: MeetingScope;
  noun: string;
  kind: MeetingSuggestion['kind'];
  moment?: Moment;
  topic: MeetingTopic;
  /** The room's read, when it's a room's trouble. */
  word?: 'Split' | 'Down';
  driver?: ManFact;
  leader?: ManFact;
  /** The men a talks commitment would name. */
  dealMen: ManFact[];
  snapsMan?: ManFact;
  feud?: [ManFact, ManFact];
  record: Record3;
  /** Losses in a row, three or more. */
  losingRun: boolean;
  credibility: CredibilityRead;
  /** You asked for it: his letter opens by answering you. */
  asked?: boolean;
  /** The commitment that answers the topic, when one is on offer: the coach's advice names it. */
  advice?: Exclude<Backing, 'words'>;
  /** A room in doubt about whoever runs its side (L4): his last name, and whether they've given up on him. */
  coord?: { last: string; lost: boolean };
}

function recordOf(league: League, teamId: number): { record: Record3; losingRun: boolean } {
  const r = computeRecords(league).get(teamId);
  const games = r ? r.w + r.l + r.t : 0;
  const share = games >= 3 && r ? (r.w + r.t / 2) / games : 0.5;
  const streak = r?.streak ?? '';
  return {
    record: share >= 0.6 ? 'winning' : share <= 0.4 ? 'losing' : 'even',
    losingRun: streak[0] === 'L' && Number(streak.slice(1)) >= 3,
  };
}

const ANSWERS: Record<TalkCause, Exclude<Backing, 'words'>> = {
  deal: 'talks',
  snaps: 'snaps',
  feud: 'feud',
  losing: 'move',
  benched: 'snaps',
};

export function suggestFact(league: League, teamId: number, s: MeetingSuggestion, ctx?: MoraleContext): SuggestFact {
  const hc = chairHolder(teamCoaches(league, teamId), { role: 'headCoach' });
  const man = (id?: number) =>
    id === undefined || !league.players[id] ? undefined : manFact(league, league.players[id]);
  const read =
    s.scope !== 'team' && s.kind === 'trouble'
      ? unitRead(league, teamId, s.scope as CoachRoom, ctx ?? moraleContext(league))
      : null;
  const named = s.namedFor ?? {};
  const answer = s.topic !== 'none' && s.topic !== 'coordinator' ? ANSWERS[s.topic] : undefined;
  return {
    style: styleOf(hc ? traitOf(hc, 'discipline') : 10.5),
    scope: s.scope,
    noun: SCOPE_NOUN[s.scope],
    kind: s.kind,
    ...(s.asked ? { asked: true } : {}),
    ...(s.moment ? { moment: s.moment } : {}),
    topic: s.topic,
    ...(read && (read.word === 'Split' || read.word === 'Down') ? { word: read.word } : {}),
    ...(man(s.driver) ? { driver: man(s.driver) } : {}),
    ...(man(s.leader) ? { leader: man(s.leader) } : {}),
    dealMen: (named.talks ?? []).flatMap((id) => man(id) ?? []),
    ...(named.snaps?.length && man(named.snaps[0]) ? { snapsMan: man(named.snaps[0]) } : {}),
    ...(named.feud?.length === 2 && man(named.feud[0]) && man(named.feud[1])
      ? { feud: [man(named.feud[0])!, man(named.feud[1])!] as [ManFact, ManFact] }
      : {}),
    ...recordOf(league, teamId),
    credibility: hc ? credibilityRead(hc) : 'steady',
    ...(answer && s.backings.includes(answer) ? { advice: answer } : {}),
    ...coordFact(league, teamId, s),
  };
}

function coordFact(league: League, teamId: number, s: MeetingSuggestion): Pick<SuggestFact, 'coord'> {
  if (s.topic !== 'coordinator' || s.scope === 'team') return {};
  const runner = runnerOf(league, teamId, s.scope);
  return runner ? { coord: { last: runner.lastName, lost: beliefRead(beliefOf(runner, s.scope)) === 'lost' } } : {};
}
