import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { mentoringWeek } from './mentoring';
import { nameCaptains } from './personality';
import { noteDeparture, speaksOut } from './relationships';
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
  it('your position coach says when a mentor is taking, once', () => {
    const { l, kid, vet } = world();
    l.phase = 'resign';
    kid.mentoredBy = [{ id: vet.id, from: l.season - 1, to: l.season - 1 }];
    kid.shiftedLast = { season: l.season, workEthic: 0.6 };
    deliverMail(l);
    deliverMail(l);
    const m = mail(l, `mentor:${l.season}:took:${kid.id}`);
    expect(m).toHaveLength(1);
    expect(m[0].from).toMatch(/coach/i);
    expect(m[0].body).toContain(vet.lastName);
    expect(m[0].body).not.toMatch(BANNED);
  });

  it('the head coach says when a young player loses his mentor to another club', () => {
    const { l, kid, vet } = world();
    l.phase = 'regular';
    kid.lostMentor = { id: vet.id, season: l.season, week: l.week };
    deliverMail(l);
    deliverMail(l);
    const m = mail(l, `mentor:${l.season}:${l.week}:gone:${kid.id}`);
    expect(m).toHaveLength(1);
    expect(m[0].from).toMatch(/Head coach/);
    expect(m[0].body).not.toMatch(BANNED);
  });

  it('notes a young player who has grown up', () => {
    const { l, kid } = world();
    l.phase = 'resign';
    kid.traits = { ...kid.traits, workEthic: 6, temperament: 10, poise: 10, sportsmanship: 10, leads: 10 };
    kid.personality = { greed: 0.5, loyalty: 0.5, winning: 0.5, patience: 0.55 };
    kid.shifts = { workEthic: 1 };
    kid.shiftedLast = { season: l.season, workEthic: 1 };
    deliverMail(l);
    const m = mail(l, `persona:${l.season}:${kid.id}`);
    expect(m).toHaveLength(1);
    expect(m[0].body).toMatch(/grown up/);
  });

  it('the head coach names the captains once camp has', () => {
    const { l } = world();
    l.phase = 'preseason';
    nameCaptains(l);
    deliverMail(l);
    deliverMail(l);
    const m = mail(l, `captains:${l.season}`);
    expect(m).toHaveLength(1);
    const c = l.teams[l.userTeamId].captains!;
    for (const id of [c.offense, c.defense, c.specialTeams]) expect(m[0].body).toContain(l.players[id].lastName);
  });

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
});
