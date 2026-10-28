import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Fact, Facts, OfficeHero, Pill } from './office';

describe('office kit', () => {
  it('draws an urgent hero with its eyebrow, headline and facts', () => {
    const html = renderToStaticMarkup(
      <OfficeHero eyebrow="Trade desk" headline="2 offers need an answer" urgent>
        <Facts>
          <Fact label="Offers waiting">2</Fact>
        </Facts>
      </OfficeHero>,
    );
    expect(html).toContain('office-hero is-urgent');
    expect(html).toContain('Trade desk');
    expect(html).toContain('2 offers need an answer');
    expect(html).toContain('<span class="eyebrow">Offers waiting</span>');
  });
  it('maps a pill tone to its class and leaves a plain pill plain', () => {
    expect(renderToStaticMarkup(<Pill tone="warn">Hole</Pill>)).toBe('<span class="tag-pill tag-warn">Hole</span>');
    expect(renderToStaticMarkup(<Pill>CB</Pill>)).toBe('<span class="tag-pill">CB</span>');
  });
});
