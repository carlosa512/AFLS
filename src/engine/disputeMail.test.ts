import { describe, expect, it } from 'vitest';
import { answerDispute, disputeCard, disputeStep, endDispute } from './disputes';
import { yearsLeft } from './finance/contract';
import { leagueMarket, marketApy } from './finance/market';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { moraleContext } from './morale';
import { talkStep } from './playerTalks';
import { activeRoster, setTeam } from './roster';
import type { League, Player } from './types';

const YEAR = 32;
/** Morale's clock at a week of this league year. */
const at = (l: League, week: number) => l.season * YEAR + week;

/**
 * Your veteran holding out over his deal since the re-sign window's step, in the re-sign window: two years or fewer
 * left, paid half his market and minding money, so his deal is his worst grievance.
 */
function yourHoldout(seed = 'dispute-mail') {
  const l = createLeague({ seed });
  l.phase = 'resign';
  l.moraleAt = at(l, 1);
  const p = activeRoster(l, l.userTeamId).find(
    (x) =>
      x.morale &&
      !x.injury &&
      x.contract?.kind === 'veteran' &&
      yearsLeft(x.contract, l.season) <= 2 &&
      yearsLeft(x.contract, l.season) >= 1,
  )!;
  p.contract!.apy = Math.round(0.5 * marketApy(leagueMarket(l), p));
  p.personality.greed = 1;
  p.morale = { level: -5, jolts: [] };
  p.morale.dispute = { kind: 'holdOut', cause: 'deal', since: at(l, 1), club: l.userTeamId };
  return { l, p };
}
const letters = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));
const startId = (l: League, p: Player) => `dispute:${l.season}:${at(l, 1)}:${p.id}`;
const endId = (l: League, p: Player) => `dispute-end:${l.season}:${at(l, 1)}:${p.id}`;

describe('dispute letters (G4)', () => {
  it('files one letter when a dispute starts and one when it ends, from the head coach, never twice', () => {
    const { l, p } = yourHoldout();
    deliverMail(l);
    deliverMail(l);
    expect(letters(l, startId(l, p))).toHaveLength(1);
    const start = letters(l, startId(l, p))[0];
    expect(start.from).toMatch(/Head coach|Coaching staff/);
    expect(start.body).toContain(p.lastName);
    expect(mailSubject(start)).toMatchObject({ kind: 'dispute', since: at(l, 1), playerId: p.id });
    endDispute(l, p, 'gaveIn', at(l, 9));
    deliverMail(l);
    deliverMail(l);
    expect(letters(l, endId(l, p))).toHaveLength(1);
    expect(letters(l, endId(l, p))[0].body).toContain(p.lastName);
    expect(needsYou(l, letters(l, endId(l, p))[0])).toBe(false);
  });

  it('needs you while it waits on your answer, and says what you told him once you have', () => {
    const { l, p } = yourHoldout();
    deliverMail(l);
    const start = letters(l, startId(l, p))[0];
    expect(needsYou(l, start)).toBe(true);
    expect(disputeCard(l, { since: at(l, 1), playerId: p.id }).state).toBe('open');
    expect(answerDispute(l, p.id, 'firm')).toBe(true);
    expect(needsYou(l, start)).toBe(false);
    const card = disputeCard(l, { since: at(l, 1), playerId: p.id });
    expect(card.state).toBe('answered');
    expect(card.said).toMatch(/firm/i);
    // One answer a dispute: a second is refused.
    expect(answerDispute(l, p.id, 'shop')).toBe(false);
  });

  it('offers talks, a promise, holding firm and shopping him; past four broken promises his word is gone', () => {
    const { l, p } = yourHoldout();
    const card = disputeCard(l, { since: at(l, 1), playerId: p.id });
    expect(card.kind).toBe('holdOut');
    expect(card.choices).toEqual(['negotiate', 'promise', 'firm', 'shop']);
    expect(card.trust).toBe(true);
    expect(answerDispute(l, p.id, 'refuse')).toBe(false);
    p.morale!.talk = { club: l.userTeamId, broken: 4 };
    expect(disputeCard(l, { since: at(l, 1), playerId: p.id }).trust).toBe(false);
    expect(answerDispute(l, p.id, 'promise')).toBe(false);
  });

  it('ends on your promise of a deal by week 1, and broken, starts again at once', () => {
    const { l, p } = yourHoldout();
    expect(answerDispute(l, p.id, 'promise')).toBe(true);
    expect(p.morale!.dispute).toBeUndefined();
    expect(p.morale!.disputeEnd?.how).toBe('promise');
    expect(p.morale!.talk!.promise).toMatchObject({ kind: 'deal', dispute: 'holdOut', due: at(l, 8) });
    // Week 1 comes without a deal: the promise breaks, and he's out again the same step.
    l.phase = 'regular';
    l.moraleAt = at(l, 8);
    const ctx = moraleContext(l);
    talkStep(l, ctx, at(l, 8), 8, false);
    disputeStep(l, ctx, at(l, 8), 8, false);
    expect(p.morale!.dispute).toMatchObject({ kind: 'holdOut', since: at(l, 8), out: true });
  });

  it('closes when you lose the job or he leaves, and his club answers it from the next step', () => {
    const fired = yourHoldout();
    fired.l.gms[fired.l.userGmId].teamId = null;
    expect(disputeCard(fired.l, { since: at(fired.l, 1), playerId: fired.p.id }).state).toBe('closed');
    expect(answerDispute(fired.l, fired.p.id, 'firm')).toBe(false);
    fired.l.moraleAt = at(fired.l, 2);
    disputeStep(fired.l, moraleContext(fired.l), at(fired.l, 2), 2, false);
    const d = fired.p.morale!.dispute;
    expect(d ? d.answered?.choice : fired.p.morale!.disputeEnd?.how).toMatch(/firm|signed/);

    const traded = yourHoldout();
    setTeam(traded.l, traded.p, (traded.l.userTeamId + 1) % 32);
    expect(disputeCard(traded.l, { since: at(traded.l, 1), playerId: traded.p.id }).state).toBe('closed');
  });
});

const { disputeView } = await import('./disputes');

/** Your man asking to be traded over `cause` since the step before, his letter not yet filed. */
function yourRequest(cause: 'snaps' | 'losing' | 'deal', seed = 'request-mail') {
  const l = createLeague({ seed });
  l.moraleAt = at(l, 10);
  const p = activeRoster(l, l.userTeamId).find((x) => x.morale && !x.injury && x.contract)!;
  p.morale = { level: -5, jolts: [] };
  p.morale.dispute = { kind: 'trade', cause, since: at(l, 9), club: l.userTeamId };
  return { l, p };
}
const requestId = (l: League, p: Player) => `dispute:${l.season}:${at(l, 9)}:${p.id}`;

describe('trade request letters (G4b)', () => {
  it('files a letter when he asks, offering shop, refuse and the promise his cause allows', () => {
    const snaps = yourRequest('snaps');
    deliverMail(snaps.l);
    deliverMail(snaps.l);
    const letter = letters(snaps.l, requestId(snaps.l, snaps.p));
    expect(letter).toHaveLength(1);
    expect(letter[0].subject).toContain(snaps.p.lastName);
    expect(needsYou(snaps.l, letter[0])).toBe(true);
    const card = disputeCard(snaps.l, { since: at(snaps.l, 9), playerId: snaps.p.id });
    expect(card).toMatchObject({
      state: 'open',
      kind: 'trade',
      choices: ['shop', 'refuse', 'promise'],
      promise: 'snaps',
    });
    const losing = yourRequest('losing');
    expect(disputeCard(losing.l, { since: at(losing.l, 9), playerId: losing.p.id }).choices).toEqual([
      'shop',
      'refuse',
    ]);
    const deal = yourRequest('deal');
    expect(disputeCard(deal.l, { since: at(deal.l, 9), playerId: deal.p.id }).promise).toBe('deal');
  });

  it('a promise of snaps ends it and holds him to the games; refusing is on file', () => {
    const { l, p } = yourRequest('snaps');
    expect(answerDispute(l, p.id, 'promise')).toBe(true);
    expect(p.morale!.dispute).toBeUndefined();
    expect(p.morale!.disputeEnd).toMatchObject({ kind: 'trade', how: 'promise' });
    expect(p.morale!.talk!.promise).toMatchObject({ kind: 'snaps', dispute: 'trade', left: 4 });
    const refused = yourRequest('losing');
    expect(answerDispute(refused.l, refused.p.id, 'promise')).toBe(false);
    expect(answerDispute(refused.l, refused.p.id, 'refuse')).toBe(true);
    expect(refused.p.morale!.dispute!.refused).toBe(true);
    expect(disputeCard(refused.l, { since: at(refused.l, 9), playerId: refused.p.id }).said).toMatch(/refused/i);
  });

  it('files one letter when it leaks and one when it ends', () => {
    const { l, p } = yourRequest('snaps');
    deliverMail(l);
    p.morale!.dispute!.public = at(l, 10);
    deliverMail(l);
    deliverMail(l);
    expect(letters(l, `dispute-leak:${l.season}:${at(l, 9)}:${p.id}`)).toHaveLength(1);
    endDispute(l, p, 'withdrawn', at(l, 11));
    deliverMail(l);
    deliverMail(l);
    const end = letters(l, `dispute-end:${l.season}:${at(l, 9)}:${p.id}`);
    expect(end).toHaveLength(1);
    expect(end[0].body).toContain(p.lastName);
  });

  it("shows Wants a trade on another club's player only once it's public; his own club sees it private", () => {
    const { l, p } = yourRequest('snaps');
    expect(disputeView(l, p)?.label).toBe('Wants a trade');
    const theirs = activeRoster(l, (l.userTeamId + 1) % 32).find((x) => x.morale)!;
    theirs.morale!.dispute = { kind: 'trade', cause: 'snaps', since: at(l, 9), club: theirs.teamId! };
    expect(disputeView(l, theirs)).toBeNull();
    theirs.morale!.dispute.public = at(l, 10);
    expect(disputeView(l, theirs)).toMatchObject({ kind: 'trade', label: 'Wants a trade' });
  });
});
