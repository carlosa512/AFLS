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

  it('SNN marks a tree born the second season two of his men run clubs side by side, and not for a founding tree', () => {
    const founded = createLeague({ seed: 'tree-born' });
    deliverMail(founded);
    expect((founded.inbox ?? []).filter((m) => m.id.includes(':born:'))).toHaveLength(0); // founding trees are older
    const l = createLeague({ seed: 'tree-born' });
    for (const c of Object.values(l.coaches)) delete c.pastUnder;
    const heads = Object.values(l.coaches).filter((c) => c.role === 'headCoach' && c.teamId !== null);
    const [root, a, b] = heads;
    const s = l.season;
    // A winner: a tree grows only from a .500 head coach.
    const record = { fromWeek: 1, throughWeek: 18, regular: { w: 11, l: 6, t: 0 }, playoffs: null, champion: false };
    root.career = [s - 7, s - 6, s - 5, s - 4].map((x) => ({
      season: x,
      teamId: 20,
      role: 'headCoach' as const,
      record,
    }));
    a.career = [
      ...[s - 6, s - 5, s - 4].map((x) => ({ season: x, teamId: 20, role: 'offCoord' as const })),
      { season: s - 2, teamId: a.teamId!, role: 'headCoach' as const },
      { season: s - 1, teamId: a.teamId!, role: 'headCoach' as const },
    ];
    b.career = [
      ...[s - 6, s - 5, s - 4].map((x) => ({ season: x, teamId: 20, role: 'defCoord' as const })),
      { season: s - 2, teamId: b.teamId!, role: 'headCoach' as const },
      { season: s - 1, teamId: b.teamId!, role: 'headCoach' as const },
    ];
    deliverMail(l);
    expect(mail(l, `tree:${l.season}:born:${root.id}`)).toHaveLength(1);
  });
});
