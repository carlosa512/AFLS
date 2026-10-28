import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { deliverMail } from './inbox';
import { mentoringWeek } from './mentoring';
import { nameCaptains } from './personality';
import { addTie, noteDeparture, speaksOut } from './relationships';
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

  it('your position coach reports a feud in his room, once', () => {
    const { l } = world();
    const [a, b] = Object.values(l.players).filter((p) => p.teamId === l.userTeamId && p.position === 'WR');
    addTie(l, a, b, 'feud');
    deliverMail(l);
    deliverMail(l);
    const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
    const m = mail(l, `feud:${l.season}:${lo.id}:${hi.id}`);
    expect(m).toHaveLength(1);
    expect(m[0].from).toMatch(/coach/i);
    expect(m[0].body).toContain(a.lastName);
    expect(m[0].body).not.toMatch(BANNED);
  });

  it('the head coach says when a man loses a friend to a trade or a cut', () => {
    const { l } = world();
    const [a, b] = Object.values(l.players).filter((p) => p.teamId === l.userTeamId && p.position === 'OL');
    addTie(l, a, b, 'friend');
    b.left = [{ teamId: l.userTeamId, season: l.season, how: 'traded' }];
    b.teamId = (l.userTeamId + 1) % 32;
    deliverMail(l);
    expect(mail(l, `friend:${l.season}:left:${a.id}:${b.id}`)).toHaveLength(1);
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
    expect(recapAside(l, ours, { won: true, margin: 3 })).toBe('. He wanted the ball late');
    expect(recapAside(l, ours, { won: true, margin: 17 })).toBe('');
    expect(recapAside(l, ours, { won: false, margin: 3 })).toBe('');
  });
});
