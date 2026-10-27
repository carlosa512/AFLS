import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CFL_ORIGIN, ORIGINS, PATHWAY_ORIGINS } from '../engine/data/origins';
import type { Player } from '../engine/types';
import { OriginTag } from './origin';

const html = (origin?: number) => renderToStaticMarkup(<OriginTag player={{ origin } as Player} />);

describe('OriginTag', () => {
  it('renders a college as plain text', () => {
    expect(html(0)).toBe('Alabama');
  });

  it('renders Pathway and CFL players as their own pills', () => {
    const country = ORIGINS[PATHWAY_ORIGINS[0]].name;
    expect(html(PATHWAY_ORIGINS[0])).toBe(`<span class="tag-pill tag-pathway">Pathway · ${country}</span>`);
    expect(html(CFL_ORIGIN)).toBe('<span class="tag-pill tag-cfl">CFL</span>');
  });

  it('renders nothing for no origin or an id a mod removed', () => {
    expect(html()).toBe('');
    expect(html(99999)).toBe('');
  });
});
