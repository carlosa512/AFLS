import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { personalityRead } from '../engine/personality';
import { CharacterFact, lockerPills } from './scouting';
import { LockerRoom } from './screens/LockerRoom';
import { nameCaptains } from '../engine/personality';
import { mentoringWeek } from '../engine/mentoring';
import { addTie } from '../engine/relationships';

describe('the character block', () => {
  const league = createLeague({ seed: 'character-card' });

  it('names your player, with what it means kept for the hover, in place of the work and temper tags', () => {
    const p = Object.values(league.players).find((x) => x.teamId === league.userTeamId)!;
    const read = personalityRead(league, league.userTeamId, p)!;
    const html = renderToStaticMarkup(<CharacterFact league={league} player={p} />);
    expect(html).toContain(read.name);
    // Like a habit or a coach's quirk: the name on the card, the meaning only when you look into it.
    expect(html).not.toContain(read.line);
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

  it("names a leader's personality as a pill you hover for its meaning", () => {
    const html = renderToStaticMarkup(<LockerRoom league={league} />);
    const c = league.teams[league.userTeamId].captains!;
    const read = personalityRead(league, league.userTeamId, league.players[c.offense]);
    if (!read) return;
    expect(html).toMatch(new RegExp(`<button[^>]*>${read.name}`));
    expect(html).not.toContain(read.line);
  });

  it('leaves his mentor to the Locker Room screen: the card gives no pill for it', () => {
    const kid = ours.find((p) => p.mentor !== undefined && !p.ties?.length)!;
    expect(lockerPills(league, kid)).toEqual([]);
  });

  it('shows friendships and feuds in the room, and the card makes each a pill', () => {
    const l = createLeague({ seed: 'locker-ties' });
    mentoringWeek(l);
    const mine = Object.values(l.players).filter((p) => p.teamId === l.userTeamId);
    const kid = mine.find((p) => p.mentor !== undefined)!;
    const room = mine.filter((p) => p.position === kid.position && p.id !== kid.id && p.id !== kid.mentor);
    addTie(l, kid, room[0], 'feud');
    const [x, y] = mine.filter((p) => p.position === 'OL');
    addTie(l, x, y, 'friend');
    const html = renderToStaticMarkup(<LockerRoom league={l} />);
    expect(html).toContain('In the room');
    expect(html).toContain('don’t see eye to eye');
    expect(html).toContain(room[0].lastName);
    expect(html).toContain('close');
    // On the card each is a pill, the sentence behind it in its note.
    expect(lockerPills(l, kid)).toContainEqual({
      label: 'Feud in the room',
      tip: `Doesn’t see eye to eye with ${room[0].firstName} ${room[0].lastName}.`,
      tone: 'warn',
    });
    expect(lockerPills(l, x)).toContainEqual({
      label: 'Close friend',
      tip: `Close with ${y.firstName} ${y.lastName}.`,
      tone: 'good',
    });
    // Another club's man: only a grudge against us shows.
    const theirs = Object.values(l.players).find((p) => p.teamId !== null && p.teamId !== l.userTeamId)!;
    expect(lockerPills(l, theirs)).toEqual([]);
    theirs.left = [{ teamId: l.userTeamId, season: l.season, how: 'cut' }];
    expect(lockerPills(l, theirs)).toEqual([
      { label: 'Holds a grudge', tip: 'Still sore about how we let him go.', tone: 'warn' },
    ]);
  });
});
