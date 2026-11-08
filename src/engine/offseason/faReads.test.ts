import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { outlookRead } from '../outlook';
import { teamStaff } from '../staff';
import type { League } from '../types';
import { faReadCache, faReads } from './faReads';
import { advanceOffseason, beginOffseason } from './index';
import { freeAgents } from './negotiation';

const base = (() => {
  const l = createLeague({ seed: 'fa-reads' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const offseason = (l: League) => {
  while (l.phase !== 'regular') advanceOffseason(l, { autoUser: true });
  return JSON.stringify(l);
};

afterEach(() => {
  faReadCache.on = true;
});

describe("free agency's kept reads", () => {
  it('plays an offseason exactly as reading every free agent each pass does', () => {
    faReadCache.on = false;
    const without = offseason(fresh());
    faReadCache.on = true;
    expect(offseason(fresh())).toBe(without);
  }, 120_000);

  it('reads a man again once what the read uses has moved: his game, his age, the club’s scouts', () => {
    const l = fresh();
    const fa = freeAgents(l).find((p) => p.age < 25) ?? freeAgents(l)[0];
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const kept = () => faReads(l)(team.id, fa);
    expect(kept()).toEqual(outlookRead(l, team.id, fa));
    for (const k of Object.keys(fa.ratings) as (keyof typeof fa.ratings)[])
      fa.ratings[k] = Math.min(20, fa.ratings[k] + 3);
    expect(kept()).toEqual(outlookRead(l, team.id, fa));
    fa.age += 6;
    expect(kept()).toEqual(outlookRead(l, team.id, fa));
    for (const s of teamStaff(l, team.id)) {
      s.evaluation = 20;
      s.projection = 20;
    }
    expect(kept()).toEqual(outlookRead(l, team.id, fa));
  });
});
