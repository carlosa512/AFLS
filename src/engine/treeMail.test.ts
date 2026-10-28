import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { liveTrees } from './trees';
import type { League } from './types';

const BANNED = /marble|\btraits?\b|z-score/i;
const mail = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));

describe('tree news', () => {
  it('SNN marks the first meeting of a mentor and his disciple as head coaches, once', () => {
    const l = createLeague({ seed: 'tree-news' });
    l.phase = 'regular';
    const t = liveTrees(l).find(
      (x) => l.coaches[x.rootId]?.role === 'headCoach' && l.coaches[x.rootId].teamId !== null,
    );
    expect(t).toBeDefined(); // this seed has a founding root still coaching
    const root = l.coaches[t!.rootId];
    const d = l.coaches[t!.disciples[0]];
    const g = l.games.find((x) => x.week === l.week && !x.result)!;
    g.homeId = root.teamId!;
    g.awayId = d.teamId!;
    deliverMail(l);
    deliverMail(l);
    const m = mail(l, `tree:meet:${root.id}:${d.id}`);
    expect(m).toHaveLength(1);
    expect(m[0].from).toBe('SNN league desk');
    expect(m[0].body).not.toMatch(BANNED);
  });

  it('SNN marks a tree born when a second disciple becomes a head coach', () => {
    const l = createLeague({ seed: 'tree-born' });
    const t = liveTrees(l)[0];
    // Make the second disciple's head-coaching start this season.
    const d = l.coaches[t.disciples[1]];
    d.career = [{ season: l.season, teamId: d.teamId!, role: 'headCoach' }];
    const first = l.coaches[t.disciples[0]];
    first.career = [{ season: l.season - 2, teamId: first.teamId!, role: 'headCoach' }];
    deliverMail(l);
    expect(mail(l, `tree:${l.season}:born:${t.rootId}`)).toHaveLength(1);
  });
});
