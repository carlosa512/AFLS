import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartingGmFields } from './screens/NewGame';

describe('New Game: your GM', () => {
  it('folds out the GM name and age, with ages limited to 30–45', () => {
    const html = renderToStaticMarkup(
      <StartingGmFields value={{ firstName: 'Ada', lastName: 'Lovelace', age: 33 }} onChange={() => {}} />,
    );
    expect(html).toContain('<details');
    expect(html).toContain('Ada Lovelace, 33');
    expect(html).toContain('value="Lovelace"');
    expect(html).toMatch(/type="number"[^>]*min="30"[^>]*max="45"|min="30"[^>]*max="45"[^>]*type="number"/);
  });

  it('says what is wrong instead of starting with a bad age', () => {
    const html = renderToStaticMarkup(
      <StartingGmFields value={{ firstName: 'Ada', lastName: 'Lovelace', age: 52 }} onChange={() => {}} />,
    );
    expect(html).toContain('30 to 45');
  });
});
