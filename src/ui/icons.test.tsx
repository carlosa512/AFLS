import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_NAMES } from './icons';

describe('icons', () => {
  it('draws every icon on the 24 grid at the size of its text', () => {
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={name} />);
      expect(html, name).toContain('viewBox="0 0 24 24"');
      expect(html, name).toContain('width="1em"');
      expect(html, name).toMatch(/<(path|polyline|line|rect|polygon)\b/);
    }
  });

  it('hides a decorative icon and names one that carries meaning', () => {
    const plain = renderToStaticMarkup(<Icon name="close" />);
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).not.toContain('role=');
    const named = renderToStaticMarkup(<Icon name="caret-up" label="Up 3" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Up 3"');
    expect(named).not.toContain('aria-hidden');
  });

  it('draws in the colour of its text, so dark mode follows', () => {
    const src = readFileSync('src/ui/icons.tsx', 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/rgba?\(/);
  });
});
