import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { simToEndOfSeason } from './league';
import { offMarketMail } from './offMarketMail';
import { advanceOffseason, beginOffseason } from './offseason';
import { seenOvr } from './scouting';
import type { League } from './types';

/** Free agency's first day, after one season: the window's re-signings and tags are in the log. */
let opened: string;
beforeAll(() => {
  const l = createLeague({ seed: 'off-market', personnel: true });
  simToEndOfSeason(l);
  beginOffseason(l);
  advanceOffseason(l);
  expect(l.phase).toBe('freeAgency');
  opened = JSON.stringify(l);
});
const fresh = (): League => JSON.parse(opened);
const rowsOf = (l: League) => offMarketMail(l, new Set())[0]?.sections?.[0].rows ?? [];

describe('off the market', () => {
  it('files once when free agency opens, listing other clubs’ re-signings and tags', () => {
    const l = fresh();
    deliverMail(l);
    deliverMail(l);
    const mail = (l.inbox ?? []).filter((m) => m.id.startsWith('offMarket:'));
    expect(mail).toHaveLength(1);
    expect(mail[0].from).toBe('SNN league desk');
    expect(mail[0].subject).toMatch(/^Off the market: \d+ re-signed(, \d+ tagged)? before free agency$/);
    for (const r of mail[0].sections![0].rows.filter((x) => x.playerId !== undefined)) {
      const p = l.players[r.playerId!];
      expect(p.teamId).not.toBe(l.userTeamId);
      expect(r.cells[2]).toBe(l.teams[p.teamId!].abbrev);
      expect(r.cells[3]).toEqual(
        p.contract!.kind === 'tag' ? 'Franchise tag' : expect.stringMatching(/^\d yr, \$\d+\.\dM$/),
      );
    }
  });

  it('orders by our scouts’ read, not the truth', () => {
    const l = fresh();
    const seen = rowsOf(l).map((r) => seenOvr(l, l.userTeamId, l.players[r.playerId!]));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
  });

  it('leaves out extensions and our own club', () => {
    const l = fresh();
    const first = rowsOf(l).find((r) => r.cells[3] !== 'Franchise tag')!.playerId!;
    for (const t of l.transactions) if (t.playerId === first) t.text = t.text.replace(' re-signed ', ' extended ');
    const mine = l.transactions.find((t) => t.phase === 'resign' && t.season === l.season && t.playerId !== undefined)!;
    mine.teamIds = [l.userTeamId];
    const ids = rowsOf(l).map((r) => r.playerId);
    expect(ids).not.toContain(first);
    expect(ids).not.toContain(mine.playerId);
  });

  it('a save from before v90 (no player ids) files nothing and doesn’t throw', () => {
    const l = fresh();
    for (const t of l.transactions) delete t.playerId;
    expect(offMarketMail(l, new Set())).toEqual([]);
  });

  it('twelve rows, then and N more', () => {
    const l = fresh();
    const rows = rowsOf(l);
    expect(rows.length).toBeLessThanOrEqual(12);
    const n = Number(
      /^Off the market: (\d+) re-signed(?:, (\d+) tagged)?/
        .exec(offMarketMail(l, new Set())[0].subject)!
        .slice(1)
        .reduce((a, x) => a + Number(x ?? 0), 0),
    );
    if (n > 12) expect(rows.at(-1)!.note).toBe(`and ${n - 12} more`);
  });
});
