import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Gear, Player } from '../engine/types';
import { GearLayer } from './gearArt';
import { playerLook } from './playerLook';

const qb = { id: 12, position: 'QB', heightIn: 75, weightLb: 225 } as Player;
const KC = { primary: '#e31837', secondary: '#ffb81c' };
const render = (gear: Gear) =>
  renderToStaticMarkup(
    <svg>
      <GearLayer id="t" figure={playerLook(qb, 128).figure} gear={gear} colors={KC} />
    </svg>,
  );

describe('GearLayer', () => {
  it('draws a padded sleeve with its honeycomb, on either arm or both, with no NaN', () => {
    for (const side of ['left', 'right', 'both'] as const)
      for (const length of ['padded', 'paddedElbow'] as const) {
        const svg = render({ sleeve: { length, color: 'black', side } });
        expect(svg).toContain('<pattern');
        expect(svg).not.toContain('NaN');
        expect((svg.match(/<pattern/g) ?? []).length, `${length} ${side}`).toBe(side === 'both' ? 2 : 1); // a pad per arm
      }
  });
  it('draws the play-call wristband on either wrist, the card behind its window', () => {
    for (const side of ['left', 'right'] as const) {
      const svg = render({ wristband: { side, color: 'white' } });
      expect(svg).toContain('#EEF2F5');
      expect(svg).not.toContain('NaN');
    }
  });
});
