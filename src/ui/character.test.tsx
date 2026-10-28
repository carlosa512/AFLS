import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { personalityRead } from '../engine/personality';
import { CharacterFact, lockerLine } from './scouting';
import { LockerRoom } from './screens/LockerRoom';
import { nameCaptains } from '../engine/personality';
import { mentoringWeek } from '../engine/mentoring';

describe('the character block', () => {
  const league = createLeague({ seed: 'character-card' });

  it('names your player and says one sentence, in place of the work and temper tags', () => {
    const p = Object.values(league.players).find((x) => x.teamId === league.userTeamId)!;
    const read = personalityRead(league, league.userTeamId, p)!;
    const html = renderToStaticMarkup(<CharacterFact league={league} player={p} />);
    expect(html).toContain(read.name);
    expect(html).toContain(read.line);
    for (const tag of ['Model pro', 'Driven', 'Coasts', 'Needs a push', 'Hothead', 'Even-keeled'])
      expect(html).not.toContain(`>${tag}<`);
  });

  it('says Unknown for a player your scouts have not met', () => {
    const p = Object.values(league.players).find((x) => !personalityRead(league, league.userTeamId, x))!;
    const html = renderToStaticMarkup(<CharacterFact league={league} player={p} />);
    expect(html).toContain('Unknown');
  });
});

describe('the locker room', () => {
  const league = createLeague({ seed: 'locker-room' });
  nameCaptains(league);
  mentoringWeek(league);
  const ours = Object.values(league.players).filter((p) => p.teamId === league.userTeamId);

  it('lists the captains and each young player with his mentor, in words', () => {
    const html = renderToStaticMarkup(<LockerRoom league={league} />);
    const c = league.teams[league.userTeamId].captains!;
    for (const id of [c.offense, c.defense, c.specialTeams]) expect(html).toContain(league.players[id].lastName);
    const kid = ours.find((p) => p.mentor !== undefined)!;
    expect(html).toContain(kid.lastName);
    expect(html).toContain(league.players[kid.mentor!].lastName);
    expect(html).toContain('early days');
    expect(html).toContain('Let the coaches handle it');
    expect(html).not.toMatch(/\b\d+\.\d+\b/); // no numbers from under the hood
  });

  it('gives the card one line about his mentor, now or before', () => {
    const kid = ours.find((p) => p.mentor !== undefined)!;
    expect(lockerLine(league, kid)).toBe(
      `Learning from ${league.players[kid.mentor!].firstName} ${league.players[kid.mentor!].lastName}`,
    );
    const vet = league.players[kid.mentor!];
    const past = { ...kid, mentor: undefined, mentoredBy: [{ id: vet.id, from: 2027, to: 2029 }] };
    expect(lockerLine(league, past)).toBe(`Learned from ${vet.firstName} ${vet.lastName} (2027–29)`);
    const plain = ours.find((p) => p.mentor === undefined && !p.mentoredBy)!;
    expect(lockerLine(league, plain)).toBeNull();
  });
});
