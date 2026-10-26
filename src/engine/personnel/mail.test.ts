import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { deliverMail, mailSubject } from '../inbox';
import { practiceSquad, activeRoster } from '../roster';
import type { League } from '../types';
import type { Elevation, WaiverResult } from './types';
import { ensureWaivers } from './waivers';

const template = createLeague({ seed: 'personnel-mail', personnel: true, userTeamId: 0 });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let l: League;
beforeEach(() => {
  l = copy(template);
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
const mail = (prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));
/** Delivered, reloaded, delivered again: nothing doubles up. */
function twice() {
  deliverMail(l);
  l = copy(l);
  deliverMail(l);
}

describe('personnel mail', () => {
  it('your waiver claim won, once', () => {
    ensureWaivers(l).results.push(result({ entryId: 7 }));
    twice();
    expect(mail('waiverClaim:')).toHaveLength(1);
    expect(mail('waiverClaim:')[0].subject).toMatch(/claimed/i);
    expect(mailSubject(mail('waiverClaim:')[0])?.kind).toBe('waiverClaim');
  });

  it('your waiver claim lost, once, with the reason', () => {
    ensureWaivers(l).results.push(
      result({ entryId: 8, toTeamId: 9, userReason: 'A club with higher waiver priority won.' }),
    );
    twice();
    expect(mail('waiverClaim:')).toHaveLength(1);
    expect(mail('waiverClaim:')[0].body).toContain('higher waiver priority');
  });

  it('your released player claimed or cleared, once each', () => {
    const a = activeRoster(l, 0)[40].id;
    const b = activeRoster(l, 0)[41].id;
    ensureWaivers(l).results.push(
      result({ entryId: 10, playerId: a, fromTeamId: 0, toTeamId: 4 }),
      result({ entryId: 11, playerId: b, fromTeamId: 0, toTeamId: null }),
    );
    twice();
    const out = mail('waiverOut:');
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.subject).join(' ')).toMatch(/claimed/i);
    expect(out.map((m) => m.subject).join(' ')).toMatch(/cleared/i);
  });

  it("a squad player's third call-up used, once", () => {
    const p = practiceSquad(l, 0)[0];
    const records: Elevation[] = [0, 1, 2].map((g) => ({
      playerId: p.id,
      teamId: 0,
      gameId: l.games.filter((x) => x.homeId === 0 || x.awayId === 0)[g].id,
      status: 'reverted',
      additionalCap: 0,
      weeklyPay: 13.75,
    }));
    l.personnel!.elevations = { season: l.season, records, blocked: {} };
    twice();
    expect(mail('callups:')).toHaveLength(1);
    expect(mail('callups:')[0].body).toMatch(/contract/);
  });
});
