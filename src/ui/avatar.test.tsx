import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TEAM_SEEDS } from '../engine/data/teams';
import type { Player, Team } from '../engine/types';
import { contrast, kitFor, mix, readableOn } from './color';
import { PlayerAvatar } from './components';

const BLUE = { id: 0, colors: ['#1D4ED8', '#FFFFFF'] } as Team;
const pearson = { firstName: 'Mario', lastName: 'Pearson', jersey: 7 } as Player;
const html = (size: number, player = pearson) => renderToStaticMarkup(<PlayerAvatar player={player} team={BLUE} size={size} />);
const seeds = TEAM_SEEDS.map((t) => ({ abbrev: t.abbrev, primary: t.colors[0], secondary: t.colors[1] }));

describe('color', () => {
  it('matches WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#1D4ED8', '#1D4ED8')).toBe(1);
  });
  it('keeps a readable secondary and swaps an unreadable one', () => {
    expect(readableOn('#0B2265', '#FFFFFF')).toBe('#FFFFFF'); // navy + white
    expect(readableOn('#FFFFFF', '#FFD700')).toBe('#0F172A'); // white + gold
    expect(readableOn('#101820', '#203731')).toBe('#F8FAFC'); // black + dark green
    expect(readableOn('#003594', '#869397')).toBe('#F8FAFC'); // royal + silver: 3.4:1 is too faint for a small number
  });
  it('always finds a readable colour, even on mid grey', () => {
    for (let v = 0; v < 256; v++) {
      const grey = '#' + v.toString(16).padStart(2, '0').repeat(3);
      // light or dark: the pair bottoms out near 4.2:1 on mid grey
      expect(contrast(grey, readableOn(grey, grey))).toBeGreaterThanOrEqual(4);
    }
  });
  it('mixes', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('kits', () => {
  it('letters every team readably', () => {
    for (const t of seeds) {
      const kit = kitFor(t);
      expect(contrast(kit.jersey, kit.ink), t.abbrev).toBeGreaterThanOrEqual(4);
    }
  });
  it('keeps a secondary that cannot carry the number as its twill and stripe', () => {
    const buffalo = kitFor({ primary: '#00338d', secondary: '#c60c30' }); // red doesn't read on royal blue
    expect(buffalo).toEqual({ jersey: '#00338d', ink: '#F8FAFC', trim: '#c60c30', accent: '#c60c30' });
    const jets = kitFor({ primary: '#125740', secondary: '#ffffff' }); // white reads on green: no twill colour needed
    expect(jets.ink).toBe('#ffffff');
    expect(jets.trim).not.toBe('#ffffff');
  });
});

describe('PlayerAvatar', () => {
  it('adds detail as it grows', () => {
    expect(html(24)).not.toContain('<text');
    expect(html(32)).toContain('>7</text>');
    expect(html(32)).not.toContain('PEARSON');
    expect(html(96)).toContain('PEARSON');
  });
  it('is decorative: the name always sits beside it', () => {
    expect(html(48)).toContain('aria-hidden="true"');
  });
  it('keeps a long surname on the jersey', () => {
    const long = html(128, { ...pearson, lastName: 'Washington-Reyes' });
    const width = Number(long.match(/textLength="([\d.]+)"/)![1]);
    expect(width).toBeGreaterThan(30);
    expect(width).toBeLessThanOrEqual(40);
  });
  it('gives every avatar its own clip id', () => {
    const two = renderToStaticMarkup(
      <>
        <PlayerAvatar player={pearson} team={BLUE} />
        <PlayerAvatar player={pearson} team={null} />
      </>,
    );
    const ids = [...two.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
  it("shows a mod's portrait instead", () => {
    expect(html(48, { ...pearson, portrait: 'p.png' })).toContain('<img');
  });
});
