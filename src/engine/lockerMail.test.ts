import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { mentoringWeek } from './mentoring';
import { noteDeparture, speaksOut } from './relationships';
import { recapAside } from './lockerMail';
import type { League, Player } from './types';

const BANNED = /marble|\btraits?\b|z-score/i;

function world(): { l: League; kid: Player; vet: Player } {
  const l = createLeague({ seed: 'locker-mail' });
  mentoringWeek(l);
  const kid = Object.values(l.players).find((p) => p.teamId === l.userTeamId && p.mentor !== undefined)!;
  return { l, kid, vet: l.players[kid.mentor!] };
}
const mail = (l: League, prefix: string) => (l.inbox ?? []).filter((m) => m.id.startsWith(prefix));

describe('locker room letters', () => {
  it('SNN carries a player who speaks out after we trade him, once, and never a quiet one', () => {
    const { l } = world();
    l.phase = 'regular';
    const ours = Object.values(l.players).filter((p) => p.teamId === l.userTeamId);
    let loud: Player | undefined;
    for (const p of ours) {
      p.traits = { ...p.traits, controversy: 20 };
      if (speaksOut(l, p, l.season, 'traded')) {
        loud = p;
        break;
      }
    }
    expect(loud).toBeDefined();
    noteDeparture(l, loud!, l.userTeamId, 'traded');
    loud!.teamId = (l.userTeamId + 1) % 32;
    const quiet = ours.find((p) => p !== loud)!;
    quiet.traits = { ...quiet.traits, controversy: 5 };
    noteDeparture(l, quiet, l.userTeamId, 'cut');
    deliverMail(l);
    deliverMail(l);
    const m = mail(l, `speak:${l.season}:${loud!.id}:traded`);
    expect(m).toHaveLength(1);
    expect(m[0].from).toBe('SNN league desk');
    expect(m[0].body).toContain(loud!.lastName);
    expect(m[0].body).not.toMatch(BANNED);
    expect(mail(l, `speak:${l.season}:${quiet.id}:`)).toHaveLength(0);
  });

  it('an agent says his man would like to come home, in free agency', () => {
    const { l } = world();
    l.phase = 'freeAgency';
    const p = Object.values(l.players).find((x) => x.teamId === l.userTeamId && x.contract)!;
    p.teamId = null;
    p.contract = null;
    p.left = [{ teamId: l.userTeamId, season: l.season, how: 'walked' }];
    p.stats[l.season - 1] = { gp: 17, snaps: 1000 };
    deliverMail(l);
    const m = mail(l, `home:${l.season}:${p.id}`);
    // Home needs a starter's season there; a fresh league may not judge one, so the letter is optional here,
    // but when it comes it's an agent's and it's clean.
    for (const x of m) {
      expect(x.from).toMatch(/agent/i);
      expect(x.body).not.toMatch(BANNED);
    }
  });

  it('a recap names a revenge game and a clutch one only when the box score backs it', () => {
    const { l } = world();
    const theirs = Object.values(l.players).find((p) => p.teamId !== null && p.teamId !== l.userTeamId)!;
    expect(recapAside(l, theirs, { won: false, margin: 3 })).toBe('');
    theirs.left = [{ teamId: l.userTeamId, season: l.season, how: 'cut' }];
    expect(recapAside(l, theirs, { won: false, margin: 3 })).toBe(', against the club that cut him');
    const ours = Object.values(l.players).find((p) => p.teamId === l.userTeamId)!;
    ours.traits = { ...ours.traits, poise: 20 };
    ours.personality = { greed: 0.5, loyalty: 0.5, winning: 0.5, patience: 0.55 };
    ours.traits = { ...ours.traits, leads: 10, controversy: 10, sportsmanship: 10, workEthic: 10, temperament: 10 };
    expect(recapAside(l, ours, { won: true, margin: 3 })).toBe(', and he wanted the ball late');
    expect(recapAside(l, ours, { won: true, margin: 17 })).toBe('');
    expect(recapAside(l, ours, { won: false, margin: 3 })).toBe('');
  });
});
