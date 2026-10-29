import { beforeAll, describe, expect, it } from 'vitest';
import { contractDecision, liveCall, signAtAskProblem } from './contractMail';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { simToEndOfSeason } from './league';
import { beginOffseason, setLettingWalk } from './offseason';
import { applyFranchiseTag, expiringPlayers, resignCall, tagBlocker } from './offseason/ai';
import { askOffer, demand, makeOffer } from './offseason/negotiation';
import type { InboxMessage, League } from './types';

const BANNED = /marble|\btraits?\b|z-score|undefined|NaN/i;
let base = '';
beforeAll(() => {
  const l = createLeague({ seed: 'contract-mail' });
  simToEndOfSeason(l);
  deliverMail(l);
  beginOffseason(l);
  base = JSON.stringify(l);
});
const fresh = (): League => JSON.parse(base);
const letters = (l: League) => (l.inbox ?? []).filter((m) => m.id.startsWith('expiring:'));
const words = (m: InboxMessage) =>
  [m.body, ...(m.sections ?? []).flatMap((s) => [s.title, ...s.rows.flatMap((r) => [...r.cells, r.note ?? ''])])].join(
    ' ',
  );

describe('the contracts letter', () => {
  it('files once as the window opens, one row per expiring player, and no letter per player', () => {
    const l = fresh();
    deliverMail(l);
    deliverMail(l);
    expect(letters(l)).toHaveLength(1);
    const [m] = letters(l);
    expect(mailSubject(m)).toEqual({ kind: 'expiring', season: l.season });
    expect(l.inbox!.filter((x) => x.id.startsWith(`contracts:${l.season}:`))).toHaveLength(0);
    const expiring = expiringPlayers(l, l.userTeamId);
    const rows = m.sections![0].rows;
    expect(rows.map((r) => r.playerId).sort()).toEqual(expiring.map((p) => p.id).sort());
    expect(m.covered!.sort()).toEqual(expiring.map((p) => `contracts:${l.season}:${p.id}`).sort());
    for (const r of rows) expect(r.contract).toEqual({ playerId: r.playerId });
    expect(words(m)).not.toMatch(BANNED);
  });

  it('sorts by the call: keep, then tag, then let walk', () => {
    const l = fresh();
    deliverMail(l);
    const order = { Keep: 0, Tag: 1, 'Let walk': 2 } as const;
    const calls = letters(l)[0].sections![0].rows.map((r) => order[r.cells.at(-1) as keyof typeof order]);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    for (const r of letters(l)[0].sections![0].rows) {
      const call = resignCall(l, l.userTeamId, l.players[r.playerId!]).call;
      expect(r.cells.at(-1)).toBe(call === 'keep' ? 'Keep' : call === 'tag' ? 'Tag' : 'Let walk');
      expect(r.note).toBeTruthy();
    }
  });

  it('needs you until every player has a decision', () => {
    const l = fresh();
    deliverMail(l);
    const [m] = letters(l);
    expect(needsYou(l, m)).toBe(true);
    const [first, ...rest] = expiringPlayers(l, l.userTeamId);
    for (const p of rest) setLettingWalk(l, p.id, true);
    expect(contractDecision(l, rest[0].id)).toBe('walking');
    expect(needsYou(l, m)).toBe(true);
    if (tagBlocker(l, first)) setLettingWalk(l, first.id, true);
    else {
      applyFranchiseTag(l, first);
      expect(contractDecision(l, first.id)).toBe('tagged');
    }
    expect(needsYou(l, m)).toBe(false);
  });

  it('reads a signing made anywhere, the Re-sign screen included', () => {
    const l = fresh();
    deliverMail(l);
    // The first player who takes his own ask (a full roster or cap can stop one).
    const p = expiringPlayers(l, l.userTeamId).find((x) => {
      const probe = fresh();
      return makeOffer(
        probe,
        probe.players[x.id],
        probe.userTeamId,
        askOffer(demand(probe, probe.players[x.id], probe.userTeamId)),
      ).accepted;
    });
    if (!p) return;
    makeOffer(l, p, l.userTeamId, askOffer(demand(l, p, l.userTeamId)));
    expect(contractDecision(l, p.id)).toBe('signed');
  });

  it('files nothing new for a save whose window already filed the old letters', () => {
    const l = fresh();
    for (const p of expiringPlayers(l, l.userTeamId))
      l.inbox!.push({
        id: `contracts:${l.season}:${p.id}`,
        season: l.season,
        phase: 'resign',
        week: 0,
        from: 'x',
        category: 'contracts',
        subject: '',
        body: '',
        read: true,
        actions: [],
      });
    deliverMail(l);
    expect(letters(l)).toHaveLength(0);
  });

  it("Sign at ask says when he won't take his own ask, and only then", () => {
    const l = fresh();
    for (const p of expiringPlayers(l, l.userTeamId)) {
      const probe = fresh();
      const q = probe.players[p.id];
      const problem = signAtAskProblem(probe, q);
      const r = makeOffer(probe, q, probe.userTeamId, askOffer(demand(probe, q, probe.userTeamId)));
      expect(r.accepted, `${q.lastName}: ${problem}`).toBe(problem === null);
    }
  });

  it('a Tag call reads as Keep once the tag is spent', () => {
    const l = fresh();
    const [a, b] = expiringPlayers(l, l.userTeamId).filter((p) => !tagBlocker(l, p));
    if (!a || !b) return;
    expect(liveCall(l, b.id, 'Tag')).toBe('Tag');
    applyFranchiseTag(l, a);
    expect(liveCall(l, b.id, 'Tag')).toBe('Keep');
    expect(liveCall(l, b.id, 'Let walk')).toBe('Let walk');
  });
});
