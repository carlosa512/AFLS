import { beforeEach, describe, expect, it } from 'vitest';
import { releasePreview } from './finance/cap';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { ROSTER_TEMPLATE } from './positions';
import { activeRoster } from './roster';
import { perceive } from './scouting';
import type { League, Player, Position } from './types';
import type { WaiverResult } from './personnel/types';
import { ensureWaivers, queueWaiver, setWaiverClaim, waiverOrder } from './personnel/waivers';
import { tradeContext } from './trade/context';
import { starterLine } from './trade/plans';
import { wireChance, wireClaim } from './waiverMail';

const BANNED = /marble|\btraits?\b|z-score/i;
const template = createLeague({ seed: 'personnel-mail', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
  l.phase = 'regular';
  l.week = 3;
});
const result = (r: Partial<WaiverResult>): WaiverResult => ({
  entryId: 1,
  playerId: activeRoster(l, 5)[40].id,
  fromTeamId: 5,
  toTeamId: 0,
  season: l.season,
  batch: 0,
  ...r,
});
const letters = () => (l.inbox ?? []).filter((m) => m.id.startsWith('waivers:'));
/** Delivered, reloaded, delivered again: nothing doubles up. */
function twice() {
  deliverMail(l);
  l = copy(l);
  deliverMail(l);
}
/** Our bodies at a position, cut to `keep` by moving the rest to another club. */
function thinOut(pos: Position, keep: number) {
  for (const p of activeRoster(l, 0)
    .filter((x) => x.position === pos)
    .slice(keep))
    p.teamId = 31;
}
/** Another club waives one of its players. */
function waive(teamId: number, pick: (p: Player) => boolean): Player {
  const p = activeRoster(l, teamId).find(pick)!;
  queueWaiver(l, p, releasePreview(l, p));
  return p;
}

describe('the waiver letter', () => {
  it("files the day's results as one letter", () => {
    const [a, b] = activeRoster(l, 0).slice(40);
    ensureWaivers(l).results.push(
      result({ entryId: 10, playerId: a.id, fromTeamId: 0, toTeamId: 4 }),
      result({ entryId: 11, playerId: b.id, fromTeamId: 0, toTeamId: null }),
      result({ entryId: 12, toTeamId: 9, userReason: 'A club with higher waiver priority won.' }),
    );
    twice();
    expect(letters()).toHaveLength(1);
    const [m] = letters();
    expect(mailSubject(m)?.kind).toBe('waivers');
    const rows = m.sections!.find((s) => s.title === 'What happened')!.rows;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.cells.at(-1)).join(' ')).toMatch(/contract went with him/);
    expect(rows.map((r) => r.cells.at(-1)).join(' ')).toMatch(/higher waiver priority/);
    expect(m.body).not.toMatch(BANNED);
  });

  it('never retells a result an old letter told', () => {
    ensureWaivers(l).results.push(
      result({ entryId: 13, playerId: activeRoster(l, 0)[40].id, fromTeamId: 0, toTeamId: 4 }),
    );
    l.inbox = [
      {
        id: `waiverOut:${l.season}:13`,
        season: l.season,
        phase: 'regular',
        week: 2,
        from: 'x',
        category: 'contracts',
        subject: '',
        body: '',
        read: true,
        actions: [],
      },
    ];
    deliverMail(l);
    expect(letters()).toHaveLength(0);
  });

  it('lists who is worth a claim: thin spots, high ceilings on our read, never our own', () => {
    thinOut('S', 2);
    const young = waive(7, (p) => p.position === 'S');
    const ours = waive(0, (p) => p.position === 'S');
    const deep = waive(8, (p) => p.position === 'WR');
    deliverMail(l);
    const wire = letters()[0]?.sections?.find((s) => s.title === 'On the wire now');
    const listed = wire?.rows.map((r) => r.playerId) ?? [];
    expect(listed).not.toContain(ours.id);
    expect(listed).not.toContain(deep.id);
    const v = perceive(l, 0, young);
    const weakest = Math.min(
      ...activeRoster(l, 0)
        .filter((x) => x.position === 'S')
        .map((x) => perceive(l, 0, x).ovr),
    );
    const upside = v.potMid - v.ovr >= 1.5 && v.potMid >= weakest + 0.5;
    if (v.knowledge >= 0.35) expect(listed.includes(young.id)).toBe(upside);
    expect(listed.length).toBeLessThanOrEqual(3);
    for (const r of wire?.rows ?? []) {
      expect(r.claim).toBeDefined();
      expect(r.note).toBeTruthy();
      expect(r.note).not.toMatch(BANNED);
    }
  });

  it('needs you until we claim, and the claim is the waiver screen’s', () => {
    thinOut('S', 1);
    for (const t of [3, 4, 6, 7, 8, 9, 10, 11]) waive(t, (p) => p.position === 'S');
    deliverMail(l);
    const m = letters()[0];
    const row = m?.sections?.find((s) => s.title === 'On the wire now')?.rows[0];
    expect(row).toBeDefined();
    expect(needsYou(l, m)).toBe(true);
    for (const r of m.sections!.find((s) => s.title === 'On the wire now')!.rows)
      setWaiverClaim(l, { entryId: r.claim!.entryId, teamId: 0, cutIds: [], preference: 0 });
    expect(needsYou(l, m)).toBe(false);
  });

  it('reads the chance from the clubs ahead of us that are thin there too', () => {
    const p = waive(7, (x) => x.position === 'S');
    const entry = ensureWaivers(l).pending.find((e) => e.playerId === p.id)!;
    const order = waiverOrder(l);
    const ahead = order.slice(0, order.indexOf(0));
    for (const t of ahead)
      for (const q of activeRoster(l, t)
        .filter((x) => x.position === 'S')
        .slice(1))
        q.teamId = 31;
    const c = wireChance(l, entry);
    expect(c.place).toBe(order.indexOf(0) + 1);
    expect(c.word).toBe(ahead.length >= 3 ? 'long shot' : ahead.length >= 1 ? 'maybe' : 'good chance');
    expect(ROSTER_TEMPLATE.S).toBeGreaterThan(1);
  });

  it("the letter's Claim is ours on that entry, says why when it can't go in, and knows once it has", () => {
    const p = waive(7, (x) => x.position === 'S');
    const entry = ensureWaivers(l).pending.find((e) => e.playerId === p.id)!;
    const before = wireClaim(l, entry.id);
    expect(before.claim).toMatchObject({ entryId: entry.id, teamId: 0, cutIds: [] });
    expect(before.claimed).toBe(false);
    if (!before.problem) {
      setWaiverClaim(l, before.claim);
      expect(wireClaim(l, entry.id).claimed).toBe(true);
    }
    // A full 53: the claim needs a roster move first, and the button says so.
    const full = copy(l);
    while (activeRoster(full, 0).length < 53) {
      const extra = activeRoster(full, 9).find((x) => x.position === 'WR')!;
      extra.teamId = 0;
    }
    expect(wireClaim(full, entry.id).problem).toMatch(/roster move/);
  });

  it('a raw young player with a real ceiling at a thin spot makes the list', () => {
    // A depth ceiling, not a starter's: past our weakest tight end, short of a typical starter.
    thinOut('TE', 2);
    const raw = activeRoster(l, 12)
      .filter((x) => x.position === 'TE')
      .sort((a, b) => perceive(l, 0, a).ovr - perceive(l, 0, b).ovr)[0];
    const kid = waive(12, (x) => x.id === raw.id);
    kid.age = 22;
    l.knowledge[kid.id] = 0.9;
    // Three points of ceiling over what we read today, whatever the world made him: well past the 1.5 a scout
    // wants, still short of a starter's.
    kid.potential = Math.round(perceive(l, 0, kid).ovr) + 3;
    deliverMail(l);
    const wire = letters()[0]?.sections?.find((s) => s.title === 'On the wire now');
    const v = perceive(l, 0, kid);
    expect(v.potMid - v.ovr).toBeGreaterThanOrEqual(1.5);
    expect(v.potMid).toBeLessThan(starterLine(tradeContext(l)).TE);
    expect(wire?.rows.map((r) => r.playerId)).toContain(kid.id);
  });

  it('files a second letter when a later batch settles in the same offseason phase', () => {
    l.phase = 'preseason';
    l.week = 0;
    ensureWaivers(l).results.push(
      result({ entryId: 21, playerId: activeRoster(l, 0)[40].id, fromTeamId: 0, toTeamId: 4 }),
    );
    deliverMail(l);
    ensureWaivers(l).batch++;
    ensureWaivers(l).results.push(
      result({ entryId: 22, playerId: activeRoster(l, 0)[41].id, fromTeamId: 0, toTeamId: 5, batch: 1 }),
    );
    deliverMail(l);
    expect(letters()).toHaveLength(2);
  });
});
