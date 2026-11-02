import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { createLeague } from '../engine/generate';
import { MORALE_WORDS, moraleLevel, type MoraleStep } from '../engine/morale';
import { activeRoster } from '../engine/roster';
import { MoodFace, MoodPill, moodSortValue } from './morale';
import { NavContext, type Nav } from './nav';
import { Roster } from './screens/Roster';
import { LockerRoom } from './screens/LockerRoom';

const nav = { openPlayer: () => {}, openTeam: () => {}, go: () => {} } as unknown as Nav;
const render = (el: ReactElement) => renderToStaticMarkup(<NavContext.Provider value={nav}>{el}</NavContext.Provider>);
const league = createLeague({ seed: 'morale-ui' });

describe('the smiley', () => {
  it('draws every step in its colour, with its word as the label', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 7] as MoraleStep[]) {
      const html = render(<MoodFace step={step} />);
      expect(html).toContain(`aria-label="${MORALE_WORDS[step]}"`);
      expect(html).toContain(`var(--mood-${step})`);
      expect(html).toContain('role="img"');
    }
  });

  it('puts the reasons in the label when given', () => {
    const html = render(<MoodFace step={2} title="Wants a new deal" />);
    expect(html).toContain('aria-label="Very poor: Wants a new deal"');
  });

  it('shows the word as a pill', () => {
    const p = activeRoster(league, league.userTeamId)[0];
    p.morale = { level: -4, jolts: [] };
    expect(render(<MoodPill league={league} player={p} />)).toContain('Very poor');
  });
});

describe('the Mood column', () => {
  it('shows a face per row on your roster, and nothing on another club’s', () => {
    const mine = render(<Roster league={league} teamId={league.userTeamId} />);
    expect(mine).toContain('>Mood<');
    const faces = mine.match(/class="mood-face"/g)?.length ?? 0;
    expect(faces).toBeGreaterThanOrEqual(45);
    const theirs = render(<Roster league={league} teamId={(league.userTeamId + 1) % 32} />);
    expect(theirs).not.toContain('>Mood<');
    expect(theirs).not.toContain('mood-face');
  });

  it('sorts by the mood itself', () => {
    const roster = activeRoster(league, league.userTeamId);
    roster.forEach((p, i) => (p.morale = { level: ((i * 7) % 19) - 9, jolts: [] }));
    const byView = [...roster].sort((a, b) => moodSortValue(league, b) - moodSortValue(league, a));
    const byLevel = [...roster].sort((a, b) => moraleLevel(league, b) - moraleLevel(league, a));
    expect(byView.map((p) => moraleLevel(league, p))).toEqual(byLevel.map((p) => moraleLevel(league, p)));
    // Another club's player sorts nowhere: there's no mood to read.
    expect(moodSortValue(league, activeRoster(league, (league.userTeamId + 1) % 32)[0])).toBe(-Infinity);
  });
});

describe('the Locker Room’s Morale section', () => {
  it('leads with the room’s mood and lists who is unhappy', () => {
    const roster = activeRoster(league, league.userTeamId);
    roster.forEach((p) => (p.morale = { level: 2, jolts: [] }));
    roster[0].morale = { level: -7, jolts: [] };
    const html = render(<LockerRoom league={league} />);
    expect(html).toContain('<h3>Morale</h3>');
    expect(html.indexOf('<h3>Morale</h3>')).toBeLessThan(html.indexOf('<h3>Leaders</h3>'));
    expect(html).toContain('mood-room-word');
    expect(html).toContain('Abysmal');
    expect(html).toContain(roster[0].lastName);
  });

  it('gathers what is on the room’s mind, each reason with the men who feel it', () => {
    const roster = activeRoster(league, league.userTeamId);
    roster.forEach((p) => (p.morale = { level: 2, jolts: [] }));
    roster[1].morale = { level: 1, jolts: [{ kind: 'paid', size: 3, at: league.season * 32 + 8 }] };
    const html = render(<LockerRoom league={league} />);
    expect(html).toContain('On their minds');
    const at = html.indexOf('Just got paid');
    expect(at).toBeGreaterThan(-1);
    expect(html.indexOf(roster[1].lastName, at)).toBeGreaterThan(at);
    expect(html).toContain('mood-strip');
    // His makeup is a reason on his own row, never a topic of the room.
    const minds = html.slice(html.indexOf('On their minds'), html.indexOf('Needs a word'));
    expect(minds).not.toMatch(/Hard to please|Takes things in stride/);
  });
});

describe('the Locker Room’s word on what moods do (G2)', () => {
  it('says once what moods do, and marks whom it costs and lifts', () => {
    const l = createLeague({ seed: 'morale-ui-effects' });
    const roster = activeRoster(l, l.userTeamId);
    roster.forEach((p) => (p.morale = { level: 2, jolts: [] }));
    roster[0].morale = { level: -4, jolts: [] };
    roster[1].morale = { level: -2, jolts: [] };
    roster[2].morale = { level: 5, jolts: [] };
    const html = render(<LockerRoom league={l} />);
    const count = (s: string) => html.split(s).length - 1;
    expect(count('mood moves how he practices, grows and plays, and what he asks for in a new deal')).toBe(1);
    expect(count('costing him in practice and on game day')).toBe(1);
    expect(count('lifting his practice and his play')).toBe(1);
    // On his own row: after his name, before the next man's.
    const costing = html.indexOf('costing him in practice');
    expect(html.lastIndexOf(roster[0].lastName, costing)).toBeGreaterThan(
      html.lastIndexOf(roster[1].lastName, costing),
    );
    const lifting = html.indexOf('lifting his practice');
    expect(html.lastIndexOf(roster[2].lastName, lifting)).toBeGreaterThan(-1);
  });
});

describe('the Locker Room’s promises (G3)', () => {
  it('lists an open promise with the games left, and hides the block with none', () => {
    const l = createLeague({ seed: 'morale-ui-promises' });
    const roster = activeRoster(l, l.userTeamId);
    roster.forEach((p) => (p.morale = { level: 2 }));
    expect(render(<LockerRoom league={l} />)).not.toContain('<h4>Promises</h4>');
    roster[0].morale = {
      level: -2,
      talk: {
        club: l.userTeamId,
        promise: { kind: 'snaps', made: l.moraleAt!, role: 2, left: 3, games: 1, snaps: 10 },
      },
    };
    const html = render(<LockerRoom league={l} />);
    expect(html).toContain('<h4>Promises</h4>');
    expect(html).toContain('More snaps: three games left');
    expect(html).toContain(roster[0].lastName);
  });
});

describe('the Locker Room: who runs the room', () => {
  it('shows who the room follows and the units, in words', () => {
    const html = render(<LockerRoom league={league} />);
    expect(html).toContain('Who the room follows');
    expect(html).toContain('The units');
    for (const label of ['Offensive line', 'Secondary']) expect(html).toContain(label);
    expect(html).toMatch(/>(Tight|Settled|Restless|Down|Split)</);
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\bweight\b|\btiers?\b|faction|cohesion|influence/i);
  });
});
