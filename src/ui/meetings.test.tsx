import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { answerMeeting, requestMeeting } from '../engine/meetings';
import { meetingsView } from '../engine/meetings/mail';
import type { League } from '../engine/types';
import { MeetingChoices } from './meetings';
import { NavContext, type Nav } from './nav';
import { LockerRoom } from './screens/LockerRoom';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;

const base = (() => {
  const l = createLeague({ seed: 'meeting-ui' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const locker = (l: League) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <LockerRoom league={l} />
    </NavContext.Provider>,
  );

describe('meetings on screen', () => {
  it('asks the coach’s three questions with labels only, and waits for each pick', () => {
    const l = fresh();
    const s = requestMeeting(l, 'DL')!;
    const html = renderToStaticMarkup(<MeetingChoices league={l} s={s} />);
    expect(html).toContain('How should I put it?');
    expect(html).toContain('What can I tell them?');
    expect(html).toContain('When?');
    expect(html).toContain('Say it straight');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Go ahead/);
    expect(html).toContain('Not now');
    expect(html).toContain('Let the coach handle these himself');
  });

  it('shows what you went ahead with once it is held', () => {
    const l = fresh();
    const s = requestMeeting(l, 'DL')!;
    answerMeeting(l, { approach: 'straight', backing: 'words', timing: 'monday' });
    const html = renderToStaticMarkup(<MeetingChoices league={l} s={s} />);
    expect(html).toMatch(/You went ahead: Say it straight · Nothing, just words · Monday, in film/);
    expect(html).not.toContain('Go ahead</button>');
  });

  it('the Locker Room offers each room a meeting, and says why not while one waits', () => {
    const l = fresh();
    expect(locker(l)).toContain('Ask the coach to meet with them');
    expect(locker(l)).toContain('Ask the coach to talk to the team');
    requestMeeting(l, 'DL');
    const html = locker(l);
    expect(html).toContain('The coach wants your call on a word with the D-line');
    // Said once, by the team's ask, not on every room.
    expect(html.match(/>Answer what the coach suggested first\.</g)).toHaveLength(1);
  });

  it('the Locker Room lists what we told a room and still owe it', () => {
    const l = fresh();
    // The secondary has a man who wants a new deal in this world: talks are on offer.
    const s = requestMeeting(l, 'DB')!;
    expect(s.backings).toContain('talks');
    answerMeeting(l, { approach: 'straight', backing: 'talks', timing: 'monday' });
    const owed = meetingsView(l)!.rooms.find((r) => r.scope === 'DB')!.owed;
    expect(owed).toHaveLength(1);
    expect(owed[0].text).toMatch(/^We told them /);
    expect(owed[0].text).not.toMatch(/\d/);
    // The men it names are links to their cards, inside the sentence.
    const html = locker(l);
    const line = html.match(/<p class="room-owed small">(.*?)<\/p>/)![1];
    expect(line).toMatch(/^We told them /);
    expect(owed[0].named.length).toBeGreaterThan(0);
    for (const id of owed[0].named.slice(0, 2)) {
      const named = l.players[id];
      expect(owed[0].text).toContain(named.lastName);
      expect(line).toMatch(new RegExp(`<button[^>]*class="linklike"[^>]*><span>${named.lastName}</span></button>`));
    }
  });
});
