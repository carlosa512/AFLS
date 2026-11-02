import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TEAM_SEEDS } from '../engine/data/teams';
import type { HelmetDesign, HelmetModel } from '../engine/types';
import { tint } from './color';
import { Flag } from './flags';
import { HELMET_LABEL, PATHWAY_FLAGS, type FlagCode } from './helmet';
import { HelmetLayer, helmetLift, MaskLayer } from './helmetArt';

const KC_DESIGN = TEAM_SEEDS.find((s) => s.abbrev === 'KC')!.helmet!;
const render = (p: {
  model: HelmetModel;
  design: HelmetDesign;
  detail: boolean;
  decals: { flags: FlagCode[]; dot: boolean } | null;
}) =>
  renderToStaticMarkup(
    <svg>
      <HelmetLayer id="t" number={12} {...p} />
    </svg>,
  );

describe('helmetArt', () => {
  it('draws every shell, plain or detailed, with no NaN', () => {
    for (const model of Object.keys(HELMET_LABEL) as HelmetModel[])
      for (const detail of [false, true]) {
        const svg = render({ model, design: KC_DESIGN, detail, decals: null });
        expect(svg).toContain('class="helmet"');
        expect(svg, `${model} ${detail}`).not.toContain('NaN');
        if (!detail)
          expect(svg).not.toContain('#16181c'); // no clips on a list-size helmet
        else expect(svg).toContain('#16181c');
      }
  });
  it('stacks the flags and adds the green dot only when asked', () => {
    const one = render({ model: 'modern', design: KC_DESIGN, detail: true, decals: { flags: ['US'], dot: false } });
    const two = render({
      model: 'modern',
      design: KC_DESIGN,
      detail: true,
      decals: { flags: ['US', 'JP'], dot: true },
    });
    expect(one).toContain('#B22234');
    expect(one).not.toContain('#BC002D');
    expect(one).not.toContain('#22B14C');
    expect(two).toContain('#BC002D');
    expect(two).toContain('#22B14C');
  });
  it('draws every flag', () => {
    for (const code of ['US', ...Object.values(PATHWAY_FLAGS)] as FlagCode[])
      expect(
        renderToStaticMarkup(
          <svg>
            <Flag code={code} x={0} y={0} />
          </svg>,
        ),
        code,
      ).toMatch(/<rect|<circle|<path/);
  });
  it('rims a dark shell, and keeps an outline on a white one', () => {
    const dark = { ...KC_DESIGN, shell: '#101820' };
    const gold = { ...KC_DESIGN, shell: '#ffb612' };
    expect(render({ model: 'modern', design: dark, detail: true, decals: null })).toContain(tint('#101820', 0.6));
    expect(render({ model: 'modern', design: gold, detail: true, decals: null })).not.toContain(tint('#ffb612', 0.6));
    const white = { ...KC_DESIGN, shell: '#F2F4F6' };
    expect(render({ model: 'modern', design: white, detail: false, decals: null })).toContain('stroke="#0F172A"');
  });
  it('sets the bumper a little above the collar, higher on heavier builds', () => {
    expect(helmetLift('modern', 0)).toBeCloseTo(-1.48, 2);
    expect(helmetLift('modern', 3)).toBeCloseTo(-2.98, 2);
    expect(helmetLift('modern', -0.6)).toBeCloseTo(helmetLift('modern', 0), 5); // lean builds don't sit lower
  });
  it('draws the mask by kind', () => {
    for (const mask of ['qb', 'skill', 'hybrid', 'line', 'kicker'] as const)
      expect(
        renderToStaticMarkup(
          <svg>
            <MaskLayer model="modern" mask={mask} color="#9AA3AD" />
          </svg>,
        ),
      ).toContain('#9AA3AD');
  });
});
